'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('orchestrator defaults to next and stays inline for empty project context', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-next-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.mode, 'lightweight-action-orchestrator');
    assert.equal(orchestrator.source, 'next');
    assert.equal(orchestrator.resolved_action, 'scan');
    assert.equal(orchestrator.workflow.strategy, 'inline');
    assert.equal(orchestrator.workflow.next_skill, '$emb-scan');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'inline-action'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'integrate'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator upgrades to primary-first when plan is recommended', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-plan-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['risk', 'add', 'irq race']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'plan');
    assert.equal(orchestrator.workflow.strategy, 'primary-first');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-hw-scout');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-hw-scout');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'launch-primary'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator exposes arch-review contract as primary-first flow', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-arch-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', '芯片选型与PoC转量产预审']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'arch-review');
    assert.equal(orchestrator.workflow.strategy, 'primary-first');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-arch-reviewer');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-arch-reviewer');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'launch-primary'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
