---
name: dshx
description: Delegate bounded, non-interactive tasks to DeepSeek Harness through the dshx machine adapter with explicit cwd, stdin, timeouts, and stable JSON results. Use when an agent should ask DeepSeek Harness to inspect code, run tests, perform a contained implementation task, or provide a second opinion without opening the DSH web UI.
---

# dshx

Use `dshx` as the machine boundary around the upstream `dsh --profile headless` runtime. Keep the task bounded and make the workspace explicit.

## Readiness

Run:

```bash
dshx doctor --json
```

Require `node_supported`, `dsh_available`, and `api_key_present` to be true before delegating paid/model work. Never print credential values.

If `dshx` is missing, explain the pinned install command and run it only with user authorization:

```bash
npm install -g @hfshfg/dshx@0.2.1
```

## Delegate one task

Prefer stdin so task text does not depend on shell quoting:

```bash
dshx run --stdin --cwd ./workspace --timeout 1800000 --json
```

Pipe or redirect the task into stdin. For instructions longer than 24,000 characters, write the source material inside the authorized workspace and send a short task that references that file.

Choose a timeout proportional to the task. Keep the default 30 minutes for normal coding work; use a shorter bound for diagnosis. Do not set an unbounded timeout unless the user explicitly asks for persistent execution.

## Interpret results

- `ok: true`, `reason: completed`: return or summarize `text` and report `duration_ms`.
- `reason: failed`: report the upstream exit code and concise diagnostics.
- `reason: timeout`: explain that the process tree was terminated at the declared bound; do not claim the task completed.
- `reason: output_limit`: narrow the task or ask DSH to write a result file in the workspace.
- Exit code 2 means local parameter/input error; fix the invocation before retrying.

Treat stdout as the result channel and stderr as diagnostics. Do not parse ANSI or spinner output; `dshx` removes it from machine results.

## Boundaries

- Delegate only work inside the user-authorized workspace.
- Do not include API keys or other secrets in task text, argv, or output summaries.
- Do not use `dsh web` for agent-to-agent delegation; it is the human-facing browser UI.
- Review DSH changes and test evidence before presenting them as complete.
- Remember that DeepSeek Harness is Developer Preview and dshx 0.2.1 pins `@deepseek-ai/dsh` 0.1.0-rc.6.
