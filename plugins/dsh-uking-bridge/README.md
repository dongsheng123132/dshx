# dsh-uking-bridge

[DSH](https://github.com/deepseek-ai/deepseek-harness) 桥接插件：把
[U-King](https://www.u-king.org) 影核动作（`u-king-mini.exe action …`）实时暴露成
DSH tools。

属于《U-King DSH 内核化》计划的 **P1 · 桥接插件**（加法，零风险）：不改 U-King 的
动作核心，不做任何快照——启动时实时拉 `action manifest --json --no-input`，
按每个动作自带的 `effects` 元数据决定暴露策略（**effects 驱动 + fail-closed**：元数据缺失或枚举未知一律不注册；7 个显式排除 id 是纵深防御，不是黑名单策略本体）。

## 策略（全部由清单元数据驱动，无黑名单）

| 动作形状 | 处置 |
|---|---|
| `class=read, confirmation=never` | 注册为工具，并发安全 |
| `class=write, confirmation=never` | 注册为工具（互斥），透传 `expected_state_version` |
| `confirmation=always`（含 external 花钱档） | **P1 不注册** —— 留 P2 接 ApprovalService 审批门 |
| `class=destructive` 或 7 个显式排除 id | **永不出现** |

排除项：`runtime.provider.delete` / `runtime.footprint.remove` /
`runtime.backup.restore` / `runtime.aitool.uninstall` /
`runtime.device.key_rotate` / `runtime.device.key_adopt` /
`runtime.identity.secret_set`。

## 行为契约

- **找不到 exe 绝不抛**：只注册一个 `uking_status` 工具报告现状，DSH shell 照常起。
- 进程直连 `spawn(exe, args)`；**拒绝 .cmd/.bat**（CVE-2024-27980 + GBK 防线）。
- 超时 = 清单 `execution.timeout_ms` + 30s 余量；`exec.signal` 中止会真的杀子进程。
- 退出码契约（2026-08-25 对 v1.0.10 全量实测）：
  - `0` → 成功，stdout 是裸结果对象 → 包装为 `{ok:true, action, result}` 信封；
  - `2` → 失败，结构化错误 JSON 在 **stderr** → 原样透传 `{ok:false, error{...}}`。
- exe 定位顺序：`UKING_MINI_PATH` 环境变量 → 配置 `exePath` →
  `%LOCALAPPDATA%\Programs\U-King\u-king-mini.exe` → `%LOCALAPPDATA%\u-king\…`。

## 测试

```bash
npm install   # 本插件零运行时依赖；测试需要本机已构建 u-king-mini.exe
npm test      # 12 条：单元（拒绝面/协议边界）+ 集成（真 exe 契约实测，无构建产物自动 skip）
```

集成测试默认指向本仓库工作区的 U-King 构建产物，可用
`UKING_BRIDGE_TEST_EXE=<路径>` 覆盖；没有构建产物时自动跳过集成段。

## 许可

MIT
