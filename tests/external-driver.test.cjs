'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('external start auto-initializes and exposes the next driver step', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-start-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const start = await captureCliJson(['external', 'start']);

    assert.equal(start.protocol, 'emb-agent.external/1');
    assert.equal(start.entrypoint, 'start');
    assert.match(start.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(start.status, 'ready');
    assert.match(start.next.cli, / next$/);
    assert.equal('initialized' in start, false);
    assert.equal('immediate' in start, false);
    assert.equal('bootstrap' in start, false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'external-agent.md')), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('external health exposes fixed bootstrap protocol before init', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-health-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const health = await captureCliJson(['external', 'health']);

    assert.equal(health.protocol, 'emb-agent.external/1');
    assert.equal(health.entrypoint, 'health');
    assert.match(health.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(health.next.cli, / start$/);
    assert.equal(health.status, 'fail');
    assert.ok(Array.isArray(health.blocking_checks));
    assert.ok(health.blocking_checks.length > 0);
    assert.equal('bootstrap' in health, false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('external init and next expose fixed driver payload for external agents', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-next-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const initialized = await captureCliJson(['external', 'init', '--user', 'welkon']);
    const next = await captureCliJson(['external', 'next']);
    const status = await captureCliJson(['external', 'status']);

    assert.equal(initialized.protocol, 'emb-agent.external/1');
    assert.equal(initialized.entrypoint, 'init');
    assert.match(initialized.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(initialized.status, 'needs-project-definition');
    assert.match(initialized.next.cli, / next$/);
    assert.equal('initialized' in initialized, false);
    assert.equal('bootstrap' in initialized, false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'external-agent.md')), false);

    assert.equal(next.protocol, 'emb-agent.external/1');
    assert.equal(next.entrypoint, 'next');
    assert.match(next.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(next.status, 'selection');
    assert.match(next.next.cli, / scan$/);
    assert.equal('workflow_stage' in next, false);

    assert.equal(status.protocol, 'emb-agent.external/1');
    assert.equal(status.entrypoint, 'status');
    assert.match(status.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(status.status, 'inspection');
    assert.match(status.summary, /Use next/);
    assert.ok(status.session_state);
    assert.equal(status.session_state.storage_mode, 'primary');
    assert.equal(status.session_state.session.exists, true);
    assert.match(status.next.cli, / next$/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('external dispatch-next exposes minimal execution decision protocol', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-dispatch-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    await captureCliJson(['external', 'init', '--user', 'welkon']);
    const dispatch = await captureCliJson(['external', 'dispatch-next']);

    assert.equal(dispatch.protocol, 'emb-agent.external/1');
    assert.equal(dispatch.entrypoint, 'dispatch-next');
    assert.match(dispatch.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(dispatch.status, 'inline');
    assert.match(dispatch.next.cli, / scan$/);
    assert.equal(dispatch.next.kind, 'action');
    assert.equal('execution' in dispatch, false);
    assert.equal('workflow_stage' in dispatch, false);
    assert.equal('health' in dispatch, false);
    assert.equal('permission_gates' in dispatch, false);
    assert.equal('executor_signal' in dispatch, false);
  } finally {
    process.chdir(currentCwd);
  }
});
