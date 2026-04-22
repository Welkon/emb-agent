'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('settings facade manages profile specs and preferences together', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-settings-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['settings', 'set', 'profile', 'rtos-iot']);
    cli.main(['settings', 'set', 'specs', 'sensor-node,connected-appliance']);
    cli.main(['settings', 'set', 'plan_mode', 'always']);
    cli.main(['settings', 'set', 'verification_mode', 'strict']);

    let session = cli.loadSession();
    assert.equal(session.project_profile, 'rtos-iot');
    assert.deepEqual(session.active_specs, ['sensor-node', 'connected-appliance']);
    assert.equal(session.preferences.plan_mode, 'always');
    assert.equal(session.preferences.verification_mode, 'strict');

    cli.main(['settings', 'reset']);
    session = cli.loadSession();
    assert.equal(session.project_profile, 'baremetal-8bit');
    assert.deepEqual(session.active_specs, []);
    assert.equal(session.preferences.plan_mode, 'auto');
    assert.equal(session.preferences.verification_mode, 'lean');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('settings show includes runtime host bridge visibility', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-settings-host-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  let stdout = '';

  try {
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    stdout = '';
    cli.main(['settings', 'show']);
    const view = JSON.parse(stdout);

    assert.equal(view.host.runtime_host, 'codex');
    assert.equal(view.host.subagent_bridge.available, true);
    assert.equal(view.host.subagent_bridge.mode, 'mock');
    assert.equal(view.host.subagent_bridge.source, 'env');
  } finally {
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('status and session show expose session state paths', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-settings-session-state-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    const status = cli.buildStatus();
    assert.ok(status.session_state);
    assert.equal(status.session_state.storage_mode, 'primary');
    assert.equal(status.session_state.session.storage_mode, 'primary');
    assert.equal(status.session_state.session.exists, true);
    assert.match(status.session_state.session.path, /\.json$/);

    stdout = '';
    cli.main(['session', 'show']);
    const sessionView = JSON.parse(stdout);

    assert.ok(sessionView.session_state);
    assert.equal(sessionView.session_state.storage_mode, 'primary');
    assert.equal(sessionView.session_state.session.exists, true);
    assert.equal(sessionView.session_state.session.path, status.session_state.session.path);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
