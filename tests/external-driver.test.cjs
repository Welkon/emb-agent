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
    assert.equal(start.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(start.driver.recommended_command, 'init');
    assert.match(start.driver.recommended_cli, / init$/);
    assert.equal(start.initialized, false);
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
    assert.equal(health.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(health.driver.recommended_command, 'init');
    assert.match(health.driver.recommended_cli, / init$/);
    assert.equal(health.status, 'fail');
    assert.equal(health.bootstrap.status, 'ready');
    assert.equal(health.next.command, 'init');
    assert.match(health.next.cli, / init$/);
    assert.ok(Array.isArray(health.blocking_checks));
    assert.ok(health.blocking_checks.length > 0);
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
    assert.equal(initialized.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(initialized.driver.recommended_command, 'next');
    assert.match(initialized.driver.recommended_cli, / next$/);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'external-agent.md')), true);

    assert.equal(next.protocol, 'emb-agent.external/1');
    assert.equal(next.entrypoint, 'next');
    assert.equal(next.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(next.driver.preferred_local_cli, 'node ./.emb-agent/runtime/bin/emb-agent.cjs');
    assert.equal(next.next.command, 'scan');
    assert.match(next.next.cli, / scan$/);
    assert.equal(next.workflow_stage.name, 'selection');

    assert.equal(status.protocol, 'emb-agent.external/1');
    assert.equal(status.entrypoint, 'status');
    assert.equal(status.driver.recommended_command, 'next');
    assert.equal(status.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(status.project_root, tempProject);
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
    assert.equal(dispatch.driver.protocol_file, '.emb-agent/external-agent.md');
    assert.equal(dispatch.driver.recommended_command, 'scan');
    assert.match(dispatch.driver.recommended_cli, / scan$/);
    assert.equal(dispatch.resolved_action, 'scan');
    assert.equal(dispatch.next.kind, 'action');
    assert.equal(dispatch.next.command, 'scan');
    assert.match(dispatch.next.cli, / scan$/);
    assert.equal(dispatch.execution.mode, 'inline');
    assert.equal(dispatch.workflow_stage.name, 'selection');
  } finally {
    process.chdir(currentCwd);
  }
});
