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

test('external start exposes minimal driver protocol before init', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-start-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const start = await captureCliJson(['external', 'start']);

    assert.equal(start.protocol, 'emb-agent.external/1');
    assert.equal(start.entrypoint, 'start');
    assert.match(start.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(start.immediate.cli, / init$/);
    assert.equal(start.initialized, false);
    assert.equal('project_root' in start, false);
    assert.equal('handoff_present' in start, false);
    assert.equal('hardware_identity' in start, false);
    assert.equal('active_task' in start, false);
    assert.equal('next' in start, false);
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
    assert.match(health.next.cli, / init$/);
    assert.equal(health.status, 'fail');
    assert.equal(health.bootstrap.status, 'ready');
    assert.equal(health.bootstrap.stage, 'project-init');
    assert.match(health.next.cli, / init$/);
    assert.ok(Array.isArray(health.blocking_checks));
    assert.ok(health.blocking_checks.length > 0);
    assert.equal('project_root' in health, false);
    assert.equal('checks' in health, false);
    assert.equal('chip_support' in health, false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('external init and next expose fixed driver payload for external agents', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-next-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const initialized = await captureCliJson(['external', 'init', '--runtime', 'external', '--user', 'welkon']);
    const next = await captureCliJson(['external', 'next']);
    const status = await captureCliJson(['external', 'status']);

    assert.equal(initialized.protocol, 'emb-agent.external/1');
    assert.equal(initialized.entrypoint, 'init');
    assert.match(initialized.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(initialized.next.cli, / next$/);
    assert.equal('project_root' in initialized, false);
    assert.equal('project_dir' in initialized, false);
    assert.equal('reused_existing' in initialized, false);
    assert.equal('session' in initialized, false);
    assert.equal('bootstrap_task' in initialized, false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'external-agent.md')), true);

    assert.equal(next.protocol, 'emb-agent.external/1');
    assert.equal(next.entrypoint, 'next');
    assert.match(next.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(next.next.cli, / scan$/);
    assert.equal(next.workflow_stage.name, 'selection');
    assert.equal(next.workflow_stage.primary_command, 'scan');
    assert.equal('project_root' in next, false);
    assert.equal('project_profile' in next, false);
    assert.equal('focus' in next, false);
    assert.equal('active_task' in next, false);

    assert.equal(status.protocol, 'emb-agent.external/1');
    assert.equal(status.entrypoint, 'status');
    assert.match(status.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(status.next.cli, / next$/);
    assert.equal('project_root' in status, false);
    assert.equal('active_task' in status, false);
    assert.equal('project_profile' in status, false);
    assert.equal('focus' in status, false);
    assert.equal('developer' in status, false);
    assert.equal('memory_summary' in status, false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('external dispatch-next exposes minimal execution decision protocol', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-external-dispatch-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    await captureCliJson(['external', 'init', '--runtime', 'external', '--user', 'welkon']);
    const dispatch = await captureCliJson(['external', 'dispatch-next']);

    assert.equal(dispatch.protocol, 'emb-agent.external/1');
    assert.equal(dispatch.entrypoint, 'dispatch-next');
    assert.match(dispatch.runtime_cli, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(dispatch.next.cli, / scan$/);
    assert.equal(dispatch.next.kind, 'action');
    assert.match(dispatch.next.cli, / scan$/);
    assert.equal(dispatch.execution.mode, 'inline');
    assert.equal(dispatch.execution.dispatch_ready, true);
    assert.equal(dispatch.workflow_stage.name, 'selection');
    assert.equal(dispatch.workflow_stage.primary_command, 'scan');
    assert.equal('project_root' in dispatch, false);
    assert.equal('project_profile' in dispatch, false);
    assert.equal('focus' in dispatch, false);
    assert.equal('resolved_action' in dispatch, false);
  } finally {
    process.chdir(currentCwd);
  }
});
