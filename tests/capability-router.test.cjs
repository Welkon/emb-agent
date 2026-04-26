'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function muteStdout() {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  return () => {
    process.stdout.write = originalWrite;
  };
}

test('next exposes capability routing as generator-first metadata', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-next-'));
  const currentCwd = process.cwd();
  const restoreStdout = muteStdout();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const next = cli.buildNextContext();

    assert.equal(next.capability_route.capability, next.next.command);
    assert.equal(next.capability_route.product_role, 'template-workflow-generator');
    assert.equal(next.capability_route.repository_layout, 'generator-templates-plus-runtime');
    assert.equal(next.next.capability_route.primary_entry.kind, 'capability');
    assert.equal(next.next.capability_route.primary_entry.name, next.next.command);
    assert.equal(next.next.capability_route.compatibility_command, undefined);
    assert.ok(Array.isArray(next.capability_route.notes));
    assert.ok(next.capability_route.route_strategy.length > 0);
  } finally {
    process.chdir(currentCwd);
    restoreStdout();
  }
});

test('dispatch next exposes capability route for the resolved action', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-dispatch-next-'));
  const currentCwd = process.cwd();
  const restoreStdout = muteStdout();

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip', '--package', 'sop8']);
    await cli.main(['question', 'add', 'why irq misses']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.capability_route.capability, dispatch.resolved_action);
    assert.equal(dispatch.capability_route.primary_entry.name, dispatch.resolved_action);
    assert.equal(dispatch.capability_route.product_role, 'template-workflow-generator');
  } finally {
    process.chdir(currentCwd);
    restoreStdout();
  }
});

test('action output exposes capability route without requiring a local skills directory', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-action-'));
  const currentCwd = process.cwd();
  const restoreStdout = muteStdout();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const output = cli.buildActionOutput('plan');

    assert.equal(output.capability_route.capability, 'plan');
    assert.equal(output.capability_route.primary_entry.name, 'plan');
    assert.equal(output.capability_route.product_role, 'template-workflow-generator');
    assert.equal(output.capability_route.generator_owner, 'emb-agent');
    assert.ok(!output.capability_route.host_targets.includes('compat-command'));
    assert.equal(output.capability_route.compatibility_command, undefined);
    assert.ok(output.capability_route.materialization_state.length > 0);
    assert.ok(output.capability_route.generated_surfaces.some(item => item.kind === 'host-skill'));
    assert.ok(Array.isArray(output.capability_route.generated_surfaces));
  } finally {
    process.chdir(currentCwd);
    restoreStdout();
  }
});

test('status exposes current and recommended capability routes for generator-first consumers', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-status-'));
  const currentCwd = process.cwd();
  const restoreStdout = muteStdout();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const status = cli.buildStatus();

    assert.equal(status.capability_route.capability, 'status');
    assert.equal(status.capability_route.category, 'runtime-surface');
    assert.equal(status.capability_route.materialization_state, 'runtime-native');
    assert.equal(status.next_action.command, 'scan');
    assert.equal(status.next_capability_route.capability, status.next_action.command);
    assert.equal(status.next_capability_route.route_strategy, 'capability-first');
    assert.equal(status.next_capability_route.product_role, 'template-workflow-generator');
  } finally {
    process.chdir(currentCwd);
    restoreStdout();
  }
});
