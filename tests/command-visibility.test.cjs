'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliText(args, cliImpl = cli) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cliImpl.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return stdout;
}

async function captureCliJson(args, cliImpl = cli) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cliImpl.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('help markdown does not expose emb-attach as an official command', () => {
  const helpPath = path.join(repoRoot, 'commands', 'emb', 'help.md');
  const content = fs.readFileSync(helpPath, 'utf8');

  assert.doesNotMatch(content, /\$emb-attach/);
});

test('commands list hides legacy attach alias', async () => {
  const listed = await captureCliJson(['commands', 'list']);

  assert.ok(Array.isArray(listed));
  assert.equal(listed.length, 13);
  assert.ok(listed.includes('help'));
  assert.ok(listed.includes('init'));
  assert.ok(listed.includes('review'));
  assert.ok(!listed.includes('workflow'));
  assert.ok(!listed.includes('attach'));
  assert.ok(!listed.includes('init-project'));
  assert.ok(!listed.includes('adapter'));
});

test('commands show keeps legacy attach alias accessible', async () => {
  const shown = await captureCliJson(['commands', 'show', 'attach']);

  assert.equal(shown.name, 'attach');
  assert.equal(shown.path, 'commands/emb/attach.md');
  assert.match(shown.content, /legacy alias kept for compatibility/);
});

test('commands show keeps hidden init-project command accessible', async () => {
  const shown = await captureCliJson(['commands', 'show', 'init-project']);

  assert.equal(shown.name, 'init-project');
  assert.match(shown.content, /Initialize the current project/);
});

test('commands show keeps hidden advanced workflow command accessible', async () => {
  const shown = await captureCliJson(['commands', 'show', 'workflow']);

  assert.equal(shown.name, 'workflow');
  assert.match(shown.content, /project-local workflow authoring/);
});

test('agents list and show resolve source-layout markdown files', async () => {
  const listed = await captureCliJson(['agents', 'list']);
  const shown = await captureCliJson(['agents', 'show', 'emb-hw-scout']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('emb-hw-scout'));
  assert.equal(shown.name, 'emb-hw-scout');
  assert.equal(shown.path, 'agents/emb-hw-scout.md');
  assert.match(shown.content, /hardware truth/);
});

test('commands show resolves source-layout command markdown files', async () => {
  const shown = await captureCliJson(['commands', 'show', 'help']);

  assert.equal(shown.name, 'help');
  assert.equal(shown.path, 'commands/emb/help.md');
  assert.match(shown.content, /shortest onboarding path/);
});

test('help markdown stays focused on core workflow commands', async () => {
  const helpPath = path.join(repoRoot, 'commands', 'emb', 'help.md');
  const content = fs.readFileSync(helpPath, 'utf8');

  assert.match(content, /\$emb-init/);
  assert.match(content, /\$emb-next/);
  assert.match(content, /\$emb-task/);
  assert.doesNotMatch(content, /\$emb-orchestrate/);
  assert.doesNotMatch(content, /emb-agent\.cjs/);
  assert.doesNotMatch(content, /<runtime-cli>/);
  assert.match(content, /help advanced/);
});

test('next run resolves and enters the recommended stage directly', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-next-run-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['question', 'add', 'why irq misses']);

    const next = await captureCliJson(['next']);
    const run = await captureCliJson(['next', 'run']);

    assert.equal(next.next.command, 'debug');
    assert.equal(next.workflow_stage.name, 'execution');
    assert.equal(next.workflow_stage.primary_command, 'debug');
    assert.equal(run.source, 'next');
    assert.equal(run.requested_action, 'next');
    assert.equal(run.resolved_action, 'debug');
    assert.equal(run.workflow_stage.name, 'execution');
    assert.equal(run.workflow_stage.primary_command, 'debug');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'next run');
    assert.ok(Array.isArray(run.hypotheses));
    assert.ok(Array.isArray(run.checks));

    await cli.main(['question', 'clear']);
    await cli.main(['focus', 'set', 'close loop after irq fix']);
    await cli.main(['do']);
    const runAfterDo = await captureCliJson(['next', 'run']);
    assert.equal(runAfterDo.resolved_action, 'verify');
    assert.equal(runAfterDo.workflow_stage.name, 'closure');
    assert.equal(runAfterDo.execution.kind, 'action');
    assert.ok(Array.isArray(runAfterDo.checklist));
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('dispatch run executes the resolved action instead of returning only the contract', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-run-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['question', 'add', 'why irq misses']);

    const run = await captureCliJson(['dispatch', 'run', 'next']);

    assert.equal(run.source, 'next');
    assert.equal(run.requested_action, 'next');
    assert.equal(run.resolved_action, 'debug');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'dispatch run next');
    assert.ok(Array.isArray(run.hypotheses));
    assert.ok(Array.isArray(run.checks));
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('orchestrate run preserves orchestration metadata while executing the target', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-run-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const run = await captureCliJson(['orchestrate', 'run']);

    assert.equal(run.mode, 'lightweight-action-orchestrator');
    assert.equal(run.source, 'next');
    assert.equal(run.resolved_action, 'health');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'orchestrate run next');
    assert.equal(run.workflow.strategy, 'inline');
    assert.ok(Array.isArray(run.checks));
    assert.ok(Array.isArray(run.orchestrator_steps));
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('default help stays concise and advanced help exposes the full surface', async () => {
  const compact = await captureCliText(['help']);
  const advanced = await captureCliText(['help', 'advanced']);
  const allFlag = await captureCliText(['--help', '--all']);

  assert.match(compact, /Core workflow:/);
  assert.match(compact, /declare hardware/);
  assert.match(compact, /next \[run\]/);
  assert.match(compact, /bootstrap \[run \[--confirm\]\]/);
  assert.match(compact, /help advanced/);
  assert.doesNotMatch(compact, /adapter source add/);
  assert.doesNotMatch(compact, /workspace link/);
  assert.doesNotMatch(compact, /thread /);
  assert.doesNotMatch(compact, /spec /);
  assert.doesNotMatch(compact, /workflow /);
  assert.doesNotMatch(compact, /skills list/);
  assert.doesNotMatch(compact, /memory stack/);

  assert.match(advanced, /Advanced commands:/);
  assert.match(advanced, /adapter source add/);
  assert.match(advanced, /bootstrap \[run \[--confirm\]\]/);
  assert.match(advanced, /context compress \[note\]/);
  assert.match(advanced, /skills list/);
  assert.match(advanced, /memory stack/);
  assert.match(advanced, /spec list/);
  assert.match(advanced, /workflow init/);
  assert.match(advanced, /workflow new pack/);
  assert.doesNotMatch(advanced, /workspace link/);
  assert.doesNotMatch(advanced, /thread /);
  assert.match(advanced, /commands list/);
  assert.equal(advanced, allFlag);
});

test('help fast path does not eagerly load emb-agent-main', async () => {
  const cliPath = path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs');
  const mainPath = path.join(repoRoot, 'runtime', 'lib', 'emb-agent-main.cjs');

  delete require.cache[require.resolve(cliPath)];
  delete require.cache[require.resolve(mainPath)];

  const freshCli = require(cliPath);
  assert.equal(require.cache[require.resolve(mainPath)], undefined);

  await captureCliText(['help'], freshCli);

  assert.equal(require.cache[require.resolve(mainPath)], undefined);
});
