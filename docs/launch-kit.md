# dshx launch kit

## 一句话

给 DeepSeek Harness 补上一条机器可走的路：显式 cwd、stdin、timeout、稳定 JSON 和只读 doctor。

## 30 秒演示

```bash
npm install -g @hfshfg/dshx
dshx doctor --json
dshx run --cwd ./my-project "运行测试并总结失败原因"
cat task.md | dshx run --stdin --cwd ./my-project --json
```

演示时重点展示：同一业务入口同时服务人类 CLI、脚本、CI 和其它 Agent；非 TTY 不输出 spinner/ANSI；失败仍返回稳定 JSON 和简单退出码。

## 中文首发稿

### 标题

DeepSeek Harness 已经有 CLI，我给它补了一条真正适合机器调用的路

### 正文

DeepSeek Harness 的 `dsh` 能从终端启动，但脚本和其它 Agent 还需要更稳定的外部契约：工作目录必须显式、任务能从 stdin 进入、等待必须有超时、stdout 只能放结果、失败也要返回稳定 JSON。

`dshx` 就做这一层薄适配，不复制 DeepSeek Harness 的业务逻辑：

- `--cwd`
- `--stdin`
- `--timeout`
- `--json`
- `doctor --json`

```bash
npm install -g @hfshfg/dshx
dshx doctor --json
```

它已经发布到 npm、GitHub Release、Codex 插件市场和 skills.sh。欢迎拿 CI、Codex、Claude Code、OpenClaw 或自己的 Agent 跑真实任务，重点反馈超时、进程树清理和 JSON 兼容性。

- GitHub: https://github.com/dongsheng123132/dshx
- npm: https://www.npmjs.com/package/@hfshfg/dshx
- skills.sh: https://skills.sh/dongsheng123132/dshx/dshx

## English launch copy

### Show HN title

Show HN: dshx – make DeepSeek Harness scriptable

### Body

DeepSeek Harness already ships a CLI, but scripts and other agents need a stricter external contract: an explicit working directory, stdin, bounded waiting, machine-only stdout, stable JSON on both success and failure, and predictable exit codes.

`dshx` is a thin adapter around the upstream `dsh`; it does not reimplement the harness. It adds `--cwd`, `--stdin`, `--timeout`, `--json`, process-tree cleanup, and a read-only `doctor` that reports credential presence without printing values.

```bash
npm install -g @hfshfg/dshx
dshx doctor --json
```

The project is also packaged as a Codex plugin and a portable Agent Skill. Feedback from real CI and multi-agent integrations is especially useful.

- GitHub: https://github.com/dongsheng123132/dshx
- npm: https://www.npmjs.com/package/@hfshfg/dshx

## 短文案

### X / 即刻 / 朋友圈

`dsh` 给人用，`dshx` 给脚本和其它 Agent 用：cwd、stdin、timeout、稳定 JSON、doctor。安装：`npm i -g @hfshfg/dshx`。

### GitHub Discussion

dshx 0.2.1 is ready for CI and agent integrations. Please share reproducible cases around timeouts, child-process cleanup, non-TTY output, and JSON consumers. Never include API key values in reports.

## 推荐发布顺序

1. 先在 DeepSeek Harness 上游社区用“可复现缺口 + 30 秒演示”介绍，不冒充官方工具。
2. 再发 Show HN；项目可直接安装，无需注册，符合可试玩要求。
3. 中文渠道优先 V2EX、掘金、知乎和公众号，避免只有口号没有命令。
4. 与 Harness Doctor 交叉链接：一个负责机器调用，一个负责环境诊断。
5. 不刷 Star、下载量或评论，不在无关 Issue 下推广。
