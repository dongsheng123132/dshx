import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const VERSION = "0.1.0";
const MIN_NODE = [22, 19, 0];
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TASK_CHARS = 24_000;
const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;

const HELP = `dshx — machine-friendly DeepSeek Harness adapter

Usage:
  dshx run [options] "task"
  dshx run --stdin [options]
  dshx doctor [options]

Options:
  -C, --cwd <path>       workspace directory (default: current directory)
      --stdin            read the task from stdin
      --json             emit one JSON object to stdout
      --timeout <ms>     timeout in milliseconds; 0 disables it (default: 1800000)
  -q, --quiet            suppress diagnostics on stderr
  -v, --verbose          mirror dsh diagnostics to stderr while running
      --no-input         assert non-interactive operation (run is always non-interactive)
  -h, --help             show help
  -V, --version          show dshx version

Examples:
  dshx run -C ./repo "run tests and fix the failure"
  type task.md | dshx run --stdin --json
  dshx doctor --json
`;

function stripAnsi(value) {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function nodeTuple(version = process.versions.node) {
  return version.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function nodeSupported(version = process.versions.node) {
  const [major, minor, patch] = nodeTuple(version);
  if (major >= 24) return true;
  if (major !== MIN_NODE[0]) return false;
  if (minor > MIN_NODE[1]) return true;
  return minor === MIN_NODE[1] && patch >= MIN_NODE[2];
}

function ensureSupportedNode() {
  if (process.env.DSHX_ALLOW_UNSUPPORTED_NODE === "1") return;
  if (!nodeSupported()) {
    throw new UsageError(`Node.js ${process.versions.node} is too old; dshx and DeepSeek Harness require Node.js 22.19+ or 24+`);
  }
}

class UsageError extends Error {}

function outputJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function failUsage(message, json) {
  if (json) {
    outputJson({ ok: false, exit_code: 2, reason: "invalid_input", error: message });
  } else {
    process.stderr.write(`dshx: ${message}\nTry 'dshx --help' for usage.\n`);
  }
  process.exitCode = 2;
}

function parseCli(argv) {
  const jsonRequested = argv.includes("--json");
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        cwd: { type: "string", short: "C" },
        stdin: { type: "boolean" },
        json: { type: "boolean" },
        timeout: { type: "string" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean", short: "v" },
        "no-input": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" }
      }
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const command = parsed.positionals.shift();
  return { ...parsed, command, jsonRequested };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveWorkspace(value) {
  const cwd = resolve(value || process.cwd());
  if (!existsSync(cwd)) throw new UsageError(`workspace does not exist: ${cwd}`);
  if (!statSync(cwd).isDirectory()) throw new UsageError(`workspace is not a directory: ${cwd}`);
  return cwd;
}

function resolveDsh() {
  const override = process.env.DSHX_DSH_BIN;
  if (override) {
    const path = resolve(override);
    if (!existsSync(path)) throw new Error(`DSHX_DSH_BIN does not exist: ${path}`);
    return { bin: path, version: "override" };
  }
  const manifestPath = require.resolve("@deepseek-ai/dsh/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    bin: resolve(dirname(manifestPath), manifest.bin?.dsh || "lib/bin.js"),
    version: typeof manifest.version === "string" ? manifest.version : "unknown"
  };
}

function appendBounded(current, chunk) {
  const next = current + chunk;
  if (next.length <= MAX_CAPTURE_CHARS) return { text: next, overflow: false };
  return { text: next.slice(0, MAX_CAPTURE_CHARS), overflow: true };
}

function stopProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

async function runDsh({ bin, task, cwd, timeoutMs, verbose }) {
  const started = Date.now();
  const child = spawn(process.execPath, [bin, "--profile", "headless", task], {
    cwd,
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let interrupted = false;
  let overflow = false;

  child.stdout.on("data", (chunk) => {
    const appended = appendBounded(stdout, chunk);
    stdout = appended.text;
    overflow ||= appended.overflow;
    if (appended.overflow) stopProcessTree(child);
  });
  child.stderr.on("data", (chunk) => {
    const appended = appendBounded(stderr, chunk);
    stderr = appended.text;
    overflow ||= appended.overflow;
    if (verbose) process.stderr.write(chunk);
    if (appended.overflow) stopProcessTree(child);
  });

  const onInterrupt = () => {
    interrupted = true;
    stopProcessTree(child);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  let timer;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child);
    }, timeoutMs);
    timer.unref?.();
  }

  const { code, signal, spawnError } = await new Promise((resolveResult) => {
    child.once("error", (error) => resolveResult({ code: 1, signal: null, spawnError: error }));
    child.once("close", (code, signal) => resolveResult({ code: code ?? 1, signal, spawnError: null }));
  });

  if (timer) clearTimeout(timer);
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);

  const text = stripAnsi(stdout).trim();
  const diagnostics = stripAnsi(stderr).trim();
  const reason = timedOut ? "timeout" : interrupted ? "interrupted" : overflow ? "output_limit" : code === 0 ? "completed" : "failed";
  const ok = reason === "completed";
  const error = spawnError
    ? `failed to start dsh: ${spawnError.message}`
    : timedOut
      ? `dsh timed out after ${timeoutMs} ms`
      : interrupted
        ? "dsh was interrupted"
        : overflow
          ? `dsh output exceeded ${MAX_CAPTURE_CHARS} characters`
          : code === 0
            ? null
            : `dsh exited with code ${code}${signal ? ` (${signal})` : ""}`;

  return {
    ok,
    exit_code: ok ? 0 : 1,
    upstream_exit_code: code,
    reason,
    cwd,
    text,
    diagnostics: diagnostics || null,
    error,
    duration_ms: Date.now() - started
  };
}

async function runCommand(parsed) {
  ensureSupportedNode();
  const cwd = resolveWorkspace(parsed.values.cwd);
  const positionalTask = parsed.positionals.join(" ");
  if (parsed.values.stdin && positionalTask.trim()) {
    throw new UsageError("use either a positional task or --stdin, not both");
  }
  let task = parsed.values.stdin ? await readStdin() : positionalTask;
  task = task.trim();
  if (!task) throw new UsageError("task is empty; pass text after 'run' or use --stdin");
  if (task.length > MAX_TASK_CHARS) {
    throw new UsageError(`task is ${task.length} characters; upstream dsh currently accepts argv only, so keep it under ${MAX_TASK_CHARS} characters or place long instructions in a workspace file`);
  }

  const rawTimeout = parsed.values.timeout ?? String(DEFAULT_TIMEOUT_MS);
  if (!/^\d+$/.test(rawTimeout)) throw new UsageError("--timeout must be a non-negative integer in milliseconds");
  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isSafeInteger(timeoutMs)) throw new UsageError("--timeout is too large");
  const dsh = resolveDsh();
  const result = await runDsh({ bin: dsh.bin, task, cwd, timeoutMs, verbose: !!parsed.values.verbose });

  if (parsed.values.json) {
    outputJson({ ...result, dsh_version: dsh.version });
  } else {
    if (result.text) process.stdout.write(`${result.text}\n`);
    if (!parsed.values.quiet && result.diagnostics && !parsed.values.verbose) {
      process.stderr.write(`${result.diagnostics}\n`);
    }
    if (!result.ok && !parsed.values.quiet) process.stderr.write(`dshx: ${result.error}\n`);
  }
  process.exitCode = result.exit_code;
}

function doctorCommand(parsed) {
  const cwd = resolveWorkspace(parsed.values.cwd);
  let dsh = null;
  let dshError = null;
  try {
    dsh = resolveDsh();
  } catch (error) {
    dshError = error instanceof Error ? error.message : String(error);
  }
  const report = {
    ok: nodeSupported() && !!dsh,
    exit_code: nodeSupported() && dsh ? 0 : 1,
    node_version: process.versions.node,
    node_supported: nodeSupported(),
    dsh_available: !!dsh,
    dsh_version: dsh?.version ?? null,
    dsh_bin: dsh?.bin ?? null,
    api_key_present: Boolean(process.env.DEEPSEEK_API_KEY),
    base_url_present: Boolean(process.env.DEEPSEEK_BASE_URL),
    cwd,
    error: dshError
  };

  if (parsed.values.json) {
    outputJson(report);
  } else {
    for (const [key, value] of Object.entries(report)) {
      process.stdout.write(`${key}\t${value ?? ""}\n`);
    }
  }
  process.exitCode = report.exit_code;
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseCli(argv);
    if (parsed.values.version) {
      process.stdout.write(`${VERSION}\n`);
      return;
    }
    if (parsed.values.help || !parsed.command) {
      process.stdout.write(HELP);
      return;
    }
    if (parsed.command === "run") return await runCommand(parsed);
    if (parsed.command === "doctor") return doctorCommand(parsed);
    throw new UsageError(`unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      failUsage(error.message, parsed?.values?.json ?? argv.includes("--json"));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (parsed?.values?.json ?? argv.includes("--json")) {
      outputJson({ ok: false, exit_code: 1, reason: "runtime_error", error: message });
    } else {
      process.stderr.write(`dshx: ${message}\n`);
    }
    process.exitCode = 1;
  }
}

export { MAX_TASK_CHARS, nodeSupported, parseCli, runDsh, stripAnsi };
