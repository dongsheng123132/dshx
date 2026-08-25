/** core.mjs 单测。
 *
 * 假 exe 策略：Node ≥20 出于 CVE-2024-27980 禁止 spawn .cmd/.bat；桥接层铁律也是
 * 「不过 shell」。所以测试里的「exe」一律用 **node.exe 直连一个 shim 脚本**，
 * 行为由 shim 文件名决定。runAction/fetchManifest 的 argv 是固定的
 * ['action','run',id,...] / ['action','manifest',...] —— 为了让 node.exe 能当
 * 「U-King exe」用，shim 通过 **UKING_SHIM 转发脚本**模式工作：
 *   node forward.mjs action manifest ...   →  forward 按 env 选真 shim 并转发全部参数
 * forward.mjs 就是测试中的 exePath 替身（node.exe），argv 形状与生产完全一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXCLUDED_IDS, fetchManifest, resolveExe, runAction } from '../lib/core.mjs';

const NODE = process.execPath;

test('EXCLUDED_IDS 与计划 §2 的 7 个排除项一致', () => {
  assert.equal(EXCLUDED_IDS.size, 7);
  for (const id of ['runtime.provider.delete', 'runtime.identity.secret_set']) {
    assert.ok(EXCLUDED_IDS.has(id));
  }
});

test('resolveExe：环境变量优先，存在才返回', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ukingbridge-'));
  const fake = join(dir, 'fake.exe');
  writeFileSync(fake, 'placeholder (existence check only)');
  const prev = process.env.UKING_MINI_PATH;
  try {
    process.env.UKING_MINI_PATH = fake;
    assert.equal(resolveExe(undefined), fake);
    delete process.env.UKING_MINI_PATH;
    if (!process.env.LOCALAPPDATA) assert.equal(resolveExe(undefined), null);
  } finally {
    if (prev === undefined) delete process.env.UKING_MINI_PATH; else process.env.UKING_MINI_PATH = prev;
  }
});

// ---- 真 spawn 行为测试：直接对 node.exe 跑「形状一致」的命令 ----
// fetchManifest/runAction 内部 spawn(exePath, ['action', ...])；
// 这里用 node.exe 作为 exePath、把 shim 放进 UKING_TEST_FORWARD 环境不可行 ——
// core.mjs 不支持 argv 注入。因此这两个函数的集成验证放到 apply.test.mjs 的
// 「真 exe 实测」（对本仓库真实构建产物 u-king-mini.exe 跑），那里才是契约真身。

test('fetchManifest：exe 不存在 → null 不抛', async () => {
  const r = await fetchManifest('Z:/definitely/not/here.exe', undefined);
  assert.equal(r, null);
});

test('runAction：.cmd/.bat 直接拒绝（CVE-2024-27980 防线）', async () => {
  const out = await runAction('C:/somewhere/evil.cmd', null, 'x.y', undefined, undefined);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'spawn_failed');
  const out2 = await runAction('C:/somewhere/evil.bat', null, 'x.y', undefined, undefined);
  assert.equal(out2.ok, false);
});

test('runAction：spawn 失败 → spawn_failed 结构化错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ukingbridge-'));
  // 存在但不是可执行文件：Windows 上 spawn 会成功创建进程失败 → close('error')
  const notExe = join(dir, 'not-an-exe.txt');
  writeFileSync(notExe, 'hello');
  const out = await runAction(notExe, { execution: { timeout_ms: 2000 } }, 'x.y', undefined, undefined);
  assert.equal(out.ok, false);
  assert.ok(['spawn_failed'].includes(out.error.code));
});
