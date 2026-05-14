'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(repoRoot, 'runtime', 'templates', 'pi-extension.ts.tpl');

test('pi extension template consumes installer-provided hook runtime plans with node fallback', () => {
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /const HOOK_RUNTIME = \{\{HOOK_RUNTIME_JSON\}\}/);
  assert.match(template, /function getHookRuntimePlan\(name\)/);
  assert.match(template, /function runResolvedHook\(name, payload, timeoutMs, nodeHookFile\)/);
  assert.match(template, /runCommandString\(plan\.command, payload, timeoutMs\)/);
  assert.match(template, /runCommandString\(plan\.fallback, payload, timeoutMs\)/);
  assert.match(template, /runNodeHook\(nodeHookFile, payload, timeoutMs\)/);

  assert.match(template, /runResolvedHook\("session_start"/);
  assert.match(template, /runResolvedHook\("statusline"/);
  assert.doesNotMatch(template, /IS_SOURCE_RUNTIME/);
  assert.doesNotMatch(template, /function shouldUseRustHooks\(\)/);
  assert.doesNotMatch(template, /function runRustHook\(/);
});
