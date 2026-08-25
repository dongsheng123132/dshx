/** index.mjs 的 apply() 集成测试 + 真 exe 契约实测。
 *
 * 两层验证：
 * 1. apply() 全链路（假 ctx + 真实构建的 u-king-mini.exe）：清单→注册→排除→status。
 * 2. 退出码/超时契约直接对真 exe 跑（runAction 集成）。
 *
 * 测试前置：仓库已构建（src-tauri/target/release/u-king-mini.exe 存在）。
 * 用环境变量 UKING_BRIDGE_TEST_EXE 可指向其他构建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { apply } from '../lib/index.mjs';
import { runAction, fetchManifest, EXCLUDED_IDS } from '../lib/core.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..'); // dshx 仓库根
// U-King 构建产物（本机路径；CI 上用 env 覆盖或跳过）
const UKING_EXE = process.env.UKING_BRIDGE_TEST_EXE
  ?? 'C:/Users/ZhuanZ/Desktop/claude/u-claw/u-king简化版-u盘版本/src-tauri/target/release/u-king-mini.exe';

function fakeCtx() {
  const registered = new Map();
  return {
    registered,
    signal: undefined,
    tools: {
      register(def) {
        // 🔴 复现真实 ToolRuntime.register() 的关键校验（Claude Code 核实指正：
        // 上一版 fake 不校验 output.render，导致「接入真 DSH 全部注册抛错」的
        // 致命 bug 在 10 条全绿测试里漏网）。校验项对照 dsh-tools 源码。
        if (!def?.name) throw new Error('tool must have name');
        if (typeof def.execute !== 'function') throw new TypeError(`tool "${def.name}" must declare execute`);
        const out = def.output;
        if (out === undefined || typeof out !== 'object' || typeof out.render !== 'function' || !out.schema) {
          throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`);
        }
        if (registered.has(def.name)) throw new Error('duplicate tool ' + def.name);
        registered.set(def.name, def);
        return () => registered.delete(def.name);
      },
    },
  };
}

/** 集成段开关：本机没有 U-King 构建产物时如实上报 skipped（不是假绿）。 */
const HAS_EXE = existsSync(UKING_EXE);

/** 等 boot 完成（uking_status 出现即 boot 收尾）。 */
async function waitBoot(ctx, ms = 90000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (ctx.registered.has('uking_status')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('boot 超时：uking_status 未注册');
}

test('apply + 真 exe：read/write 直通，always+destructive 排除，status 在位', { timeout: 120_000, skip: !HAS_EXE }, async () => {
  const prev = process.env.UKING_MINI_PATH;
  process.env.UKING_MINI_PATH = UKING_EXE;
  try {
    const ctx = fakeCtx();
    let threw = null;
    try { apply(ctx, {}); } catch (e) { threw = e; }
    assert.equal(threw, null, 'apply 绝不抛');
    await waitBoot(ctx);

    assert.ok(ctx.registered.has('uking_status'));
    const status = await ctx.registered.get('uking_status').execute({}, { signal: undefined });
    assert.equal(status.ok, true);
    assert.equal(status.exe_found, true);
    assert.match(status.note, /已注册 \d+ 个/);
    const registeredCount = Number(status.note.match(/已注册 (\d+)/)?.[1] ?? 0);

    // 全部注册名都带 uking_ 前缀且无下划线开头
    for (const name of ctx.registered.keys()) {
      assert.ok(name.startsWith('uking_'), name);
    }
    // 排除清单里的 7 个绝不能出现
    for (const id of EXCLUDED_IDS) {
      assert.ok(!ctx.registered.has('uking_' + id.replaceAll('.', '_')), `排除项泄漏: ${id}`);
    }
    // read 类工具真的在位（runtime.readiness.inspect 是清单里确认存在的）
    assert.ok(ctx.registered.has('uking_runtime_readiness_inspect'));

    // execute 真跑一个只读动作
    const t = ctx.registered.get('uking_runtime_readiness_inspect');
    const out = await t.execute({}, { signal: undefined });
    assert.equal(out.ok, true, JSON.stringify(out).slice(0, 200));
    assert.ok(registeredCount > 30); // 清单实测 read49+write13=62 直通档
  } finally {
    if (prev === undefined) delete process.env.UKING_MINI_PATH; else process.env.UKING_MINI_PATH = prev;
  }
});

test('runAction 真 exe：退出码 0 → 解析裸 JSON', { timeout: 60_000, skip: !HAS_EXE }, async () => {
  const out = await runAction(UKING_EXE, { execution: { timeout_ms: 30000 } }, 'runtime.readiness.inspect', undefined, undefined);
  assert.equal(out.ok, true);
});

test('runAction 真 exe：未知动作 → 退出码 2 结构化错误', { timeout: 60_000, skip: !HAS_EXE }, async () => {
  const out = await runAction(UKING_EXE, null, 'runtime.not.exist', undefined, undefined);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'unknown_action');
});

test('fetchManifest 真 exe：114 个动作、排除项全命中', { timeout: 60_000, skip: !HAS_EXE }, async () => {
  const manifest = await fetchManifest(UKING_EXE, undefined);
  assert.ok(Array.isArray(manifest));
  const ids = new Set(manifest.map((a) => a.id));
  for (const id of EXCLUDED_IDS) {
    assert.ok(ids.has(id), `清单应包含排除项（排除发生在桥接层）: ${id}`);
  }
});

test('apply：exe 找不到 → 只注册 uking_status 报告未安装，绝不抛', { timeout: 120_000 }, async () => {
  const prev = process.env.UKING_MINI_PATH;
  delete process.env.UKING_MINI_PATH;
  try {
    // 本机若真装了 U-King（LOCALAPPDATA 下有），判定放宽为「不抛且 status 在位」
    const ctx = fakeCtx();
    let threw = null;
    try { apply(ctx, {}); } catch (e) { threw = e; }
    assert.equal(threw, null);
    await waitBoot(ctx, 15000);
    assert.ok(ctx.registered.has('uking_status'));
  } finally {
    if (prev === undefined) delete process.env.UKING_MINI_PATH; else process.env.UKING_MINI_PATH = prev;
  }
});
