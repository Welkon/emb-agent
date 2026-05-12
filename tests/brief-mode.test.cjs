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
  assert.equal('action_card' in output, false);
  assert.ok(output.agent_protocol);
  assert.ok(Array.isArray(output.next_actions));
  assert.ok(output.next_actions.length <= 5);
  assert.ok(output.runtime_events);
  assert.ok(['pending', 'ok'].includes(output.runtime_events.status));
  assert.ok(output.runtime_events.total >= 1);
  assert.ok(Array.isArray(output.runtime_events.types));
  assert.ok(output.runtime_events.types.includes('workflow-next'));
  assert.ok(output.board_evidence);
  assert.equal(output.board_evidence.blocking, false);
  assert.equal(output.board_evidence.can_continue, true);
});

test('action --brief surfaces agent protocol and followups', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-action-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const output = await captureCliJson(['capability', 'run', 'scan', '--brief']);

    assert.equal(output.output_mode, 'brief');
    assert.ok(output.workflow_stage);
    assert.equal(output.workflow_stage.name, 'selection');
    assert.equal('action_card' in output, false);
    assert.equal(output.agent_protocol.recommendation.command, 'capability run plan');
    assert.match(output.agent_protocol.recommendation.reason, /Action=scan/);
    assert.match(output.agent_protocol.recommendation.cli, /emb-agent\.cjs capability run plan$/);
    assert.ok(Array.isArray(output.next_actions));
    assert.ok(output.next_actions.length > 0);
    assert.ok(output.next_actions.some(item => item.startsWith('instruction=')));
    assert.ok(output.next_actions.some(item => item.startsWith('command=')));
  } finally {
    process.chdir(currentCwd);
  }
});

test('action --brief keeps action reasons in agent protocol', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-action-reason-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['question', 'add', 'why irq misses after wake']);

    const output = await captureCliJson(['capability', 'run', 'debug', '--brief']);

    assert.equal(output.output_mode, 'brief');
    assert.equal('action_card' in output, false);
    assert.equal(output.workflow_stage.primary_command, 'debug');
    assert.match(output.agent_protocol.recommendation.reason, /Action=debug/);
    assert.match(output.next_actions.join('\n'), /decision_point=/);
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
    assert.equal(created.alignment.status, 'needs-human-alignment');
    assert.equal(created.agent_protocol.gate.kind, 'alignment');
    assert.equal(created.agent_protocol.recommendation.command, 'ai-host clarify-prd-task-alignment');
    assert.match(created.agent_protocol.ai_instruction.ask_user, /不明确|一致/);
    assert.equal(created.task_convergence.recommended_path, 'scan-first');
    assert.match(created.task_convergence.prd_path, /docs\/prd\/tasks\/converge-comparator-timing\.md$/);
    assert.match(created.task_convergence.next_cli, /task activate converge-comparator-timing$/);
    assert.match(created.task_convergence.then_cli, /emb-agent\.cjs capability run scan$/);

    const activated = await captureCliJson(['task', 'activate', 'converge-comparator-timing', '--brief']);
    assert.equal(activated.output_mode, 'brief');
    assert.equal(activated.activated, true);
    assert.equal(activated.task.status, 'in_progress');
    assert.equal(activated.workspace_policy.mode, 'main');
    assert.equal(activated.workspace_policy.edits_apply_directly, true);
    assert.equal(activated.workspace_policy.merge_required, false);
    assert.equal(activated.task_convergence.recommended_path, 'scan-first');
    assert.match(activated.task_convergence.next_cli, /emb-agent\.cjs capability run scan$/);
    assert.match(activated.task_convergence.then_cli, /emb-agent\.cjs capability run plan$/);

    const next = await captureCliJson(['next', '--brief']);
    assert.equal(next.output_mode, 'brief');
    assert.equal(next.next.command, 'scan');
    assert.equal(next.task.name, 'converge-comparator-timing');
    assert.equal(next.task_convergence.recommended_path, 'scan-first');
    assert.match(next.task_convergence.prd_path, /docs\/prd\/tasks\/converge-comparator-timing\.md$/);
    assert.ok(next.next_actions.some(item => item.startsWith('task_route=scan-first')));
  } finally {
    process.chdir(currentCwd);
  }
});
