import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../bin/dshx.mjs", import.meta.url));
const fake = fileURLToPath(new URL("./fixtures/fake-dsh.mjs", import.meta.url));
const env = {
  ...process.env,
  DSHX_DSH_BIN: fake,
  DSHX_ALLOW_UNSUPPORTED_NODE: "1",
  DEEPSEEK_API_KEY: ""
};

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    ...options
  });
}

test("CLI version stays aligned with package metadata", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("prints a clean text result", () => {
  const result = run(["run", "hello"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "answer:hello\n");
  assert.equal(result.stderr, "");
});

test("reads stdin and emits the stable JSON envelope", () => {
  const result = run(["run", "--stdin", "--json"], { input: "from pipe\n" });
  assert.equal(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.exit_code, 0);
  assert.equal(body.reason, "completed");
  assert.equal(body.text, "answer:from pipe");
  assert.equal(body.dsh_version, "override");
});

test("normalizes upstream failure to exit code 1", () => {
  const result = run(["run", "fail", "--json"]);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.exit_code, 1);
  assert.equal(body.upstream_exit_code, 7);
  assert.equal(body.diagnostics, "fixture failure");
});

test("strips ANSI from machine output", () => {
  const result = run(["run", "ansi", "--json"]);
  assert.equal(JSON.parse(result.stdout).text, "clean answer");
});

test("enforces a bounded timeout", () => {
  const result = run(["run", "hang", "--timeout", "100", "--json"], { timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, "timeout");
});

test("parameter errors use exit code 2 and JSON when requested", () => {
  const result = run(["run", "--stdin", "also positional", "--json"], { input: "pipe" });
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.exit_code, 2);
  assert.equal(body.reason, "invalid_input");
});

test("doctor never exposes credential values", () => {
  const result = run(["doctor", "--json"]);
  const body = JSON.parse(result.stdout);
  assert.equal(body.dsh_available, true);
  assert.equal(body.api_key_present, false);
  assert.equal(result.stdout.includes("sk-"), false);
});
