# dshx

[![npm version](https://img.shields.io/npm/v/@hfshfg/dshx)](https://www.npmjs.com/package/@hfshfg/dshx)
[![skills.sh](https://skills.sh/b/dongsheng123132/dshx)](https://skills.sh/dongsheng123132/dshx/dshx)

![dshx — DeepSeek Harness, made scriptable](https://raw.githubusercontent.com/dongsheng123132/dshx/main/assets/social-preview.png)

`dshx` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的机器友好调用层。

DeepSeek 负责 Harness Core；`dshx` 补齐脚本和其他 AI 更容易依赖的外部契约：

- `--cwd`：显式工作目录
- `--stdin`：从管道读任务
- `--json`：稳定 JSON 结果
- `--timeout`：有界等待和进程树清理
- `doctor`：检查 Node、dsh、凭据是否就绪，但绝不打印 Key
- stdout 只放结果，stderr 只放诊断；非 TTY 不输出 spinner/ANSI

> DeepSeek Harness 仍处于 Developer Preview，可能发生破坏性变化。`dshx 0.2.1` 锁定 `@deepseek-ai/dsh 0.1.0-rc.6`，升级前必须重新跑测试。

## 安装

从 npm 安装：

```bash
npm install -g @hfshfg/dshx
```

也可以锁定 GitHub Release 安装：

```bash
npm install -g github:dongsheng123132/dshx#v0.2.1
```

需要 Node.js 22.19+ 或 24+。

### 安装到 Codex 插件市场

```bash
codex plugin marketplace add dongsheng123132/dshx --ref v0.2.1
codex plugin add dshx@dshx
```

### 安装为通用 Agent Skill

```bash
npx skills add dongsheng123132/dshx --skill dshx --full-depth
```

该 Skill 已公开收录到 [skills.sh](https://skills.sh/dongsheng123132/dshx/dshx)，可被 Codex、Claude Code、Cursor、Kimi Code、OpenCode 等支持 Agent Skills 的客户端发现和安装。

## 相关工具

安装或运行环境不确定时，先用 [`harness-doctor`](https://github.com/dongsheng123132/harness-doctor) 做只读体检；它能同时检查 DSH、Claude Code、Codex 和 OpenClaw，并生成脱敏支持包。

需要对外介绍本项目时，可直接复用 [`docs/launch-kit.md`](docs/launch-kit.md) 中的中英文首发文案和 30 秒演示脚本。

## 使用

一次性任务：

```bash
dshx run --cwd ./my-project "运行测试，定位失败原因并修复"
```

管道输入和 JSON：

```bash
cat task.md | dshx run --stdin --cwd ./my-project --json
```

PowerShell：

```powershell
Get-Content .\task.md -Raw | dshx run --stdin --cwd .\my-project --json
```

体检：

```bash
dshx doctor --json
```

## JSON 契约

成功：

```json
{
  "ok": true,
  "exit_code": 0,
  "upstream_exit_code": 0,
  "reason": "completed",
  "cwd": "D:\\project",
  "text": "任务完成……",
  "diagnostics": null,
  "error": null,
  "duration_ms": 12345,
  "dsh_version": "0.1.0-rc.6"
}
```

失败仍在 stdout 输出一个 JSON 对象，进程退出码为 `1`；参数错误退出码为 `2`。稳定的 `reason` 当前包括：

- `completed`
- `failed`
- `timeout`
- `interrupted`
- `output_limit`
- `invalid_input`
- `runtime_error`

## 凭据

Headless 模式沿用 DeepSeek Harness 的环境变量：

```bash
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://...   # 可选
```

`dshx doctor` 只报告凭据是否存在，不会输出凭据内容。任务文本也不会被写入日志或 JSON 之外的额外文件。

## 当前限制

官方 headless profile 目前只接受一个命令行位置参数。`dshx --stdin` 能让管道调用更方便，但内部仍需把任务交给上游 argv，因此暂时把任务限制在 24,000 字符以内。更长的说明请放进工作目录中的文件，再让任务引用该文件。

`dshx` 不提供持续聊天 TUI。人类交互请使用：

```bash
dsh web
```

## 开发

```bash
npm test
npm run check
```

测试使用假的 dsh fixture，不消耗 API Key，也不会修改真实工作目录。

## License

MIT。DeepSeek Harness 是 DeepSeek AI 的独立开源项目，`dshx` 不是官方产品。
