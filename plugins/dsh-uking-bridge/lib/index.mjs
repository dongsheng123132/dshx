/**
 * dsh-uking-bridge 插件入口 —— cordis Plugin.Function。
 *
 * `apply(ctx, config)` 在 DSH 装载本插件时执行：拉清单 → 逐动作 defineTool 注册。
 * **apply 绝不抛**：exe 不在 / 清单拉不到都降级为注册一个 uking_status 工具，
 * 让模型能回答「U-King 没装/没找到」，而 shell 照常启动。
 *
 * 审批门（P1 简化实现）：`confirmation === 'always'` 或 class ∈ {destructive, external}
 * 的动作**不注册**为工具——P1 的验收标准是「排除项不出现在工具列表」，审批弹窗
 * 属于 ApprovalService 集成，放 P2（需要 dsh-user-approval 的 UI 面）。
 * 这样 P1 工具面 = read/never + write/never 两档，全部低风险可直通。
 */
import {
  EXCLUDED_IDS,
  fetchManifest,
  resolveExe,
  runAction,
} from './core.mjs';

/** 动作 id → DSH 工具名。DSH 工具名惯例是点分小写，与 action id 同形即可读性最好。 */
function toolName(actionId) {
  return 'uking_' + actionId.replaceAll('.', '_');
}

/** 一句话描述：用清单自带的 description，前面挂产品标。 */
function toolDescription(a) {
  const risk = a?.effects?.risk ?? 'unknown';
  return `[U-King] ${a?.description ?? a?.id} (risk: ${risk})`;
}

export function apply(ctx, config) {
  // 整个 apply 包在异步任务里：清单拉取不能阻塞插件装载（DSH 启动速度红线）。
  // cordis fiber 会等 plugin 函数返回；我们把重活丢到 ctx.effect 里自己管生命周期。
  let disposed = false;
  const disposers = [];

  const boot = (async () => {
    const exePath = resolveExe(config);

    if (!exePath) {
      // 找不到 exe：注册 status 工具报告现状，绝不抛。
      disposers.push(ctx.tools.register(makeStatusTool(null, 'U-King 未安装或未找到 u-king-mini.exe')));
      return;
    }

    const manifest = await fetchManifest(exePath, ctx.signal ?? undefined);
    if (disposed) return;

    if (!manifest || manifest.length === 0) {
      disposers.push(ctx.tools.register(makeStatusTool(exePath, 'U-King 已找到但动作清单拉取失败')));
      return;
    }

    let registered = 0;
    let excluded = 0;
    for (const a of manifest) {
      if (disposed) break;
      const id = a?.id;
      if (!id || typeof id !== 'string') continue;
      // 双保险排除：显式清单 ∪ destructive 类
      if (EXCLUDED_IDS.has(id) || a.effects?.class === 'destructive') { excluded++; continue; }
      // P1 只直通低风险：confirmation=always（含 external）留 P2 接审批门
      if (a.effects?.confirmation === 'always') { excluded++; continue; }

      try {
        disposers.push(ctx.tools.register(makeActionTool(exePath, a)));
        registered++;
      } catch { /* 单个注册失败不拖垮其余 */ }
    }

    // 自检工具永远注册：模型随时能问「桥接层现在什么状态」
    disposers.push(ctx.tools.register(makeStatusTool(exePath, `已注册 ${registered} 个 U-King 工具，排除 ${excluded} 个高风险动作`)));
  })().catch(() => { /* 兜底：boot 失败静默，shell 照常 */ });

  // 卸载清理：disposer 全部执行 + 中止未完成的 boot
  return () => {
    disposed = true;
    for (const d of disposers.reverse()) {
      try { d?.(); } catch { /* ignore */ }
    }
  };
}

/** 用原生 ToolDefinition 形状造一个动作工具（绕开 defineTool 的 schema DSL——我们手里已是 JSON Schema）。 */
function makeActionTool(exePath, a) {
  const def = {
    name: toolName(a.id),
    description: toolDescription(a),
    parameters: sanitizeJsonSchema(a.input_schema),
    output: {
      type: 'object',
      additionalProperties: true,
      description: '动作的结构化结果；ok=false 时带 error{code,message,blame,retriable}',
    },
    execute: async (args, exec) => {
      // exec.signal 必须被观察：中止时杀子进程
      return runAction(exePath, a, a.id, args, exec.signal);
    },
    timeoutMs: Math.min((Number(a.execution?.timeout_ms) || 60_000) + 30_000, 86_400_000),
    isConcurrencySafe: () => a.effects?.class === 'read',
  };
  return def;
}

/** status 工具：桥接层健康自查。 */
function makeStatusTool(exePath, note) {
  return {
    name: 'uking_status',
    description:
      '[U-King] 查询 U-King 桥接层状态：exe 是否找到、可用工具数量、诊断信息。' +
      '当其他 uking_* 工具不可用或结果异常时先用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { type: 'object', additionalProperties: true },
    async execute() {
      return {
        ok: true,
        exe_found: Boolean(exePath),
        exe_path: exePath ?? null,
        note,
      };
    },
  };
}

/**
 * 把 exe 给的 JSON Schema 洗成 DSH ToolSchema.parameters 可接受的普通对象。
 * 关键约束（dsh-llm ToolSchema）：parameters 是 Record<string, unknown> 的 JSON Schema 对象。
 * 这里只做保守清洗：非对象/缺 type 时补 object 壳，其余原样透传。
 */
function sanitizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  if (!schema.type) return { ...schema, type: 'object' };
  return schema;
}
