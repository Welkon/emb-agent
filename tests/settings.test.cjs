'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('settings facade manages profile packs and preferences together', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-settings-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['settings', 'set', 'profile', 'rtos-iot']);
    cli.main(['settings', 'set', 'packs', 'sensor-node,connected-appliance']);
    cli.main(['settings', 'set', 'plan_mode', 'always']);
    cli.main(['settings', 'set', 'verification_mode', 'strict']);

    let session = cli.loadSession();
    assert.equal(session.project_profile, 'rtos-iot');
    assert.deepEqual(session.active_packs, ['sensor-node', 'connected-appliance']);
    assert.equal(session.preferences.plan_mode, 'always');
    assert.equal(session.preferences.verification_mode, 'strict');

    cli.main(['settings', 'reset']);
    session = cli.loadSession();
    assert.equal(session.project_profile, 'baremetal-8bit');
    assert.deepEqual(session.active_packs, ['sensor-node']);
    assert.equal(session.preferences.plan_mode, 'auto');
    assert.equal(session.preferences.verification_mode, 'lean');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
