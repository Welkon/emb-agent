'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('dispatch show returns direct action contract for plan', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-plan-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const dispatch = cli.buildDispatchContext('plan');

    assert.equal(dispatch.source, 'action');
    assert.equal(dispatch.requested_action, 'plan');
    assert.equal(dispatch.resolved_action, 'plan');
    assert.equal(dispatch.skill, '$emb-plan');
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-hw-scout');
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.agent, 'emb-hw-scout');
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'explorer');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next follows next routing and returns debug contract when question exists', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-next-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'why irq misses']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.source, 'next');
    assert.equal(dispatch.requested_action, 'next');
    assert.equal(dispatch.resolved_action, 'debug');
    assert.equal(dispatch.skill, '$emb-debug');
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-bug-hunter');
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'default');
    assert.ok(dispatch.reason.includes('未决问题'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next returns arch-review contract when focus triggers architecture review', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-arch-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', '芯片选型与PoC转量产预审']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.resolved_action, 'arch-review');
    assert.equal(dispatch.skill, '$emb-arch-review');
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-arch-reviewer');
    assert.equal(dispatch.agent_execution.dispatch_contract.auto_invoke_when_recommended, true);
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'default');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
