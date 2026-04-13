'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installTargetsModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-targets.cjs'));

function createTargets() {
  return installTargetsModule.createInstallTargets({
    os,
    path,
    process
  });
}

test('codex target resolves expected local/global directories', () => {
  const targets = createTargets();
  const codex = targets.resolveInstallTarget('codex');

  assert.equal(codex.supported, true);
  assert.equal(
    targets.resolveTargetDir(codex, { local: true, global: false, configDir: '' }),
    path.join(process.cwd(), '.codex')
  );
  assert.equal(
    targets.resolveTargetDir(codex, { local: false, global: true, configDir: '' }),
    process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex')
  );
  assert.equal(
    targets.resolveTargetDir(codex, { local: false, global: true, configDir: '/tmp/emb-agent-target' }),
    path.resolve('/tmp/emb-agent-target')
  );
});

test('install target registry keeps future runtimes declared but disabled', () => {
  const targets = createTargets();
  const claude = targets.resolveInstallTarget('claude');
  const cursor = targets.resolveInstallTarget('cursor');
  const knownTargets = targets.listInstallTargets().map(item => item.name).sort();

  assert.deepEqual(knownTargets, ['augment', 'claude', 'codex', 'copilot', 'cursor', 'gemini', 'windsurf']);
  assert.equal(claude.supported, true);
  assert.equal(claude.configFileName, 'settings.json');
  assert.equal(claude.agentMode, 'markdown');
  assert.equal(cursor.supported, true);
  assert.equal(cursor.configFileName, 'settings.json');
  assert.equal(cursor.agentMode, 'markdown');
  assert.equal(cursor.hookMode, 'cursor-settings');
});
