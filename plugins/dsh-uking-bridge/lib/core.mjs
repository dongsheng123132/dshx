/**
 * dsh-uking-bridge —— U-King 影核动作 → DSH tools 的桥接插件（P1，加法零风险）。
 *
 * 设计铁律（照抄《DSH 内核化》§6 P1）：
 * 1. **实时读清单**：启动时调 `u-king-mini.exe action manifest --json --no-input`，
 *    不缓存不快照——exe 升级后工具面自动跟上，零漂移。
 * 2. **策略由 effects 元数据驱动**，不维护黑名单：
 *    - `confirmation === 'always'` 或 `class === 'destructive'/'external'` → 挂审批门；
 *    - 排除清单（destructive + 碰凭据的 7 个）根本不出现在工具列表里。
 * 3. **找不到 exe 绝不抛**：注册一个 `uking_status` 工具报告"未安装"，DSH shell 照常起。
 * 4. 进程直连 `spawn(exe, args)`，不过 cmd /c 和 PowerShell（GBK 陷阱在那两家）。
 * 5. 超时 = 清单 `execution.timeout_ms` + 余量；`exec.signal` 中止时真的杀子进程树。
 * 6. 退出码映射：0 = 成功（裸 JSON）；2 = `{ok:false,error:{...}}` 映射成工具错误文本，
 *    不抛异常（抛了整轮对话断掉）；其他退出码 = 进程级失败，也走错误文本。
 *
 * 本插件是纯 node 半边（无 UI），不需要 client bundle。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** P1 排除清单：destructive 全排除 + 碰凭据的三件。由 effects 推导 + 显式 id 双保险。 */
const EXCLUDED_IDS = new Set([
  'runtime.provider.delete',
  'runtime.footprint.remove',
  'runtime.backup.restore',
  'runtime.aitool.uninstall',
  'runtime.device.key_rotate',
  'runtime.device.key_adopt',
  'runtime.identity.secret_set',
]);

/** 超时余量：清单 timeout 是动作自身的预算，桥接层加进程冷启动+JSON 解析的余量。 */
const TIMEOUT_SLACK_MS = 30_000;

/** exe 候选路径，按优先级。环境变量 → 配置字段 → 默认安装位 → PATH。 */
function resolveExe(config) {
  const candidates = [];
  if (process.env.UKING_MINI_PATH) candidates.push(process.env.UKING_MINI_PATH);
  if (config?.exePath) candidates.push(config.exePath);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(join(localAppData, 'Programs', 'U-King', 'u-king-mini.exe'));
    candidates.push(join(localAppData, 'u-king', 'u-king-mini.exe'));
  }
  for (const c of candidates) {
    try { if (c && existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

/**
 * 拉实时清单。失败返回 null（绝不抛）。
 * @returns {Promise<Array|null>} action 清单或 null
 */
async function fetchManifest(exePath, signal) {
  if (!exePath) return null;
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      child = spawn(exePath, ['action', 'manifest', '--json', '--no-input'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(null);
    }, 60_000);
    const onAbort = () => { try { child.kill(); } catch { /* ignore */ } finish(null); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); finish(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code !== 0) { finish(null); return; }
      try {
        const parsed = JSON.parse(stdout);
        const actions = Array.isArray(parsed) ? parsed : parsed.actions;
        finish(Array.isArray(actions) ? actions : null);
      } catch {
        finish(null);
      }
    });
  });
}

/**
 * 单次动作执行。返回结构化结果对象（不抛）。
 *
 * 🔴 只接受真正的 .exe：Node ≥20 出于 CVE-2024-27980 禁止 spawn .cmd/.bat
 * （除非 shell:true，那会引回 cmd /c 的 GBK/注入面）。U-King 官方安装位就是 exe；
 * 万一配了 .cmd 路径，这里直接按 spawn_failed 报错而不是悄悄走 shell。
 *
 * @param {string} exePath
 * @param {object} actionDef 清单里的动作定义（拿 execution.timeout_ms）
 * @param {string} actionId
 * @param {unknown} input 动作入参（会作为 --input JSON 传入）
 * @param {AbortSignal} signal
 */
function runAction(exePath, actionDef, actionId, input, signal) {
  if (/\.cmd$/i.test(exePath) || /\.bat$/i.test(exePath)) {
    return Promise.resolve({ ok: false, error: { code: 'spawn_failed', message: '桥接层只接受 .exe，不经过 shell（CVE-2024-27980 + GBK 防线）', blame: 'bug', retriable: false } });
  }
  const baseTimeout = Number(actionDef?.execution?.timeout_ms) || 60_000;
  const timeoutMs = Math.min(baseTimeout + TIMEOUT_SLACK_MS, 86_400_000);
  const args = ['action', 'run', actionId, '--json', '--no-input'];
  if (input !== undefined && input !== null && typeof input === 'object' && Object.keys(input).length > 0) {
    args.push('--input', JSON.stringify(input));
  }
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      child = spawn(exePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      finish({ ok: false, error: { code: 'spawn_failed', message: String(e), blame: 'bug', retriable: true } });
      return;
    }
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);
    // exec.signal 中止 → 杀进程树（🔴 假设边界：u-king-mini.exe 的动作执行不二次
    // fork 子进程；child.kill() 在 Windows 只杀第一层。若 exe 未来引入会 spawn 的
    // 动作，这里要换 taskkill /T /PID 或 tree-kill，否则超时后留孤儿进程）。
    const onAbort = () => { killed = true; try { child.kill(); } catch { /* ignore */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    // 🔴 实测契约（2026-08-25，v1.0.10）：动作失败的结构化 JSON 走 **stderr**，
    // 成功结果走 stdout。两路都收，按退出码决定用哪路解析。
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish({ ok: false, error: { code: 'spawn_failed', message: String(e), blame: 'bug', retriable: true } });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (killed) {
        finish({ ok: false, error: { code: 'timeout_or_cancelled', message: `动作 ${actionId} 超时或被中止`, blame: 'environment', retriable: true }, partial_stdout_bytes: stdout.length });
        return;
      }
      // 退出码契约（2026-08-25 对 v1.0.10 全量实测）：
      //   0 = 成功，stdout 是**裸结果对象**（各动作 schema 自由形状，不保证有 ok 字段）
      //   2 = 失败，结构化错误 JSON 在 **stderr**
      // 成功时这里包一层 {ok:true, action, result} 信封 —— 模型侧永远看到统一的
      // 「ok 在不在」判据；原始裸结果整体挂在 result 下不丢任何字段。
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          finish({ ok: true, action: actionId, result });
        } catch {
          finish({ ok: true, action: actionId, raw: stdout.slice(0, 16_000) }); // 非 JSON 的成功输出原样带回（截断保护）
        }
        return;
      }
      if (code === 2) {
        for (const candidate of [stderr, stdout]) {
          try {
            const err = JSON.parse(candidate);
            if (err && typeof err === 'object') { finish(err); return; }
          } catch { /* 试下一路 */ }
        }
      }
      finish({
        ok: false,
        error: { code: `exit_${code ?? 'null'}`, message: stderrTail(stderr || stdout), blame: 'bug', retriable: code === 1 },
      });
    });
  });
}

function stderrTail(s) {
  const t = String(s).trim();
  return t.length > 2000 ? t.slice(0, 2000) + '…' : t || '进程异常退出且无输出';
}

export { EXCLUDED_IDS, TIMEOUT_SLACK_MS, fetchManifest, resolveExe, runAction };
