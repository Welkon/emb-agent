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

test('next --brief returns condensed next context', async () => {
  const output = await captureCliJson(['next', '--brief']);

  assert.equal(output.output_mode, 'brief');
  assert.ok(output.current);
  assert.ok(output.next);
  assert.ok(output.action_card);
  assert.ok(Array.isArray(output.next_actions));
  assert.ok(output.next_actions.length <= 5);
  assert.ok(output.runtime_events);
  assert.ok(['pending', 'ok'].includes(output.runtime_events.status));
  assert.ok(output.runtime_events.total >= 1);
  assert.ok(Array.isArray(output.runtime_events.types));
  assert.ok(output.runtime_events.types.includes('workflow-next'));
});

test('action --brief surfaces unified action cards and followups', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-action-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const output = await captureCliJson(['scan', '--brief']);

    assert.equal(output.output_mode, 'brief');
    assert.ok(output.workflow_stage);
    assert.equal(output.workflow_stage.name, 'selection');
    assert.ok(output.action_card);
    assert.equal(output.action_card.stage, 'scan');
    assert.equal(output.action_card.summary, 'Action=scan. Lock the real change surface before mutation.');
    assert.match(output.action_card.then_cli, /emb-agent\.cjs verify/);
    assert.ok(Array.isArray(output.next_actions));
    assert.ok(output.next_actions.length > 0);
    assert.ok(output.next_actions.some(item => item.startsWith('instruction=')));
    assert.ok(output.next_actions.some(item => item.startsWith('command=')));
  } finally {
    process.chdir(currentCwd);
  }
});

test('action --brief keeps action card reasons in key-value form', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-action-reason-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['question', 'add', 'why irq misses after wake']);

    const output = await captureCliJson(['debug', '--brief']);

    assert.equal(output.output_mode, 'brief');
    assert.ok(output.action_card);
    assert.equal(output.action_card.stage, 'debug');
    assert.equal(output.action_card.summary, 'Action=debug. Eliminate hypotheses one by one before patching.');
    assert.match(output.action_card.reason, /^primary_agent=/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task lifecycle --brief exposes convergence summary', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-task-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const created = await captureCliJson(['task', 'add', 'Converge comparator timing', '--brief']);
    assert.equal(created.output_mode, 'brief');
    assert.equal(created.created, true);
    assert.equal(created.task.status, 'planning');
    assert.equal(created.task_convergence.recommended_path, 'scan-first');
    assert.match(created.task_convergence.prd_path, /\.emb-agent\/tasks\/converge-comparator-timing\/prd\.md$/);
    assert.match(created.task_convergence.next_cli, /task activate converge-comparator-timing$/);
    assert.match(created.task_convergence.then_cli, /emb-agent\.cjs scan$/);

    const activated = await captureCliJson(['task', 'activate', 'converge-comparator-timing', '--brief']);
    assert.equal(activated.output_mode, 'brief');
    assert.equal(activated.activated, true);
    assert.equal(activated.task.status, 'in_progress');
    assert.equal(activated.task_convergence.recommended_path, 'scan-first');
    assert.match(activated.task_convergence.next_cli, /emb-agent\.cjs scan$/);
    assert.match(activated.task_convergence.then_cli, /emb-agent\.cjs plan$/);
  } finally {
    process.chdir(currentCwd);
  }
});
