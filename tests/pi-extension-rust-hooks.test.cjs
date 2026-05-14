'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(repoRoot, 'runtime', 'templates', 'pi-extension.ts.tpl');

test('pi extension template defaults to rust hooks in source runtime with node fallback', () => {
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /const RUNTIME_ROOT = path\.dirname\(path\.dirname\(RUNTIME_CLI_PATH\)\)/);
  assert.match(template, /const SOURCE_ROOT = path\.dirname\(RUNTIME_ROOT\)/);
  assert.match(template, /const RUST_HOOK_BINARY = path\.join\(SOURCE_ROOT, "target", "debug"/);
  assert.match(template, /const IS_SOURCE_RUNTIME = path\.basename\(RUNTIME_ROOT\) === "runtime"/);
  assert.match(template, /function shouldUseRustHooks\(\)/);
  assert.match(template, /process\.env\.EMB_AGENT_RUST_HOOKS/);
  assert.match(template, /process\.env\.EMB_AGENT_RUST_HOOK_CMD/);
  assert.match(template, /return IS_SOURCE_RUNTIME/);

  assert.match(template, /runRustHook\(\["hook", "session-start", "--cwd"/);
  assert.match(template, /runRustHook\(\["hook", "statusline", "--cwd"/);
  assert.match(template, /runNodeHook\(SESSION_START_HOOK/);
  assert.match(template, /runNodeHook\(STATUSLINE_HOOK/);
});
