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

async function captureCliTtyOutput(args, cliImpl = cli) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutIsTty = process.stdout.isTTY;
  const originalStderrIsTty = process.stderr.isTTY;
  let stdout = '';
  let stderr = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = chunk => {
    stderr += String(chunk);
    return true;
  };
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;

  try {
    await cliImpl.main(args);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.stdout.isTTY = originalStdoutIsTty;
    process.stderr.isTTY = originalStderrIsTty;
  }

  return { stdout, stderr };
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
  assert.ok(listed.includes('start'));
  assert.ok(listed.includes('review'));
  assert.ok(!listed.includes('init'));
  assert.ok(!listed.includes('workflow'));
  assert.ok(!listed.includes('attach'));
  assert.ok(!listed.includes('init-project'));
  assert.ok(!listed.includes('adapter'));
});

test('commands list --all exposes installed advanced commands', async () => {
  const listed = await captureCliJson(['commands', 'list', '--all']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('help'));
  assert.ok(listed.includes('workflow'));
  assert.ok(listed.includes('support'));
  assert.ok(!listed.includes('adapter'));
  assert.ok(listed.includes('dispatch'));
  assert.ok(listed.includes('orchestrate'));
  assert.ok(listed.includes('attach'));
  assert.ok(listed.includes('init-project'));
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

test('commands show resolves support command markdown directly', async () => {
  const shown = await captureCliJson(['commands', 'show', 'support']);

  assert.equal(shown.name, 'support');
  assert.equal(shown.path, 'commands/emb/support.md');
  assert.doesNotMatch(shown.content, /Compatibility alias/);
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

  assert.match(content, /## Fast Path/);
  assert.match(content, /\$emb-start/);
  assert.match(content, /\$emb-next/);
  assert.match(content, /\$emb-task/);
  assert.doesNotMatch(content, /\$emb-init/);
  assert.doesNotMatch(content, /\$emb-orchestrate/);
  assert.doesNotMatch(content, /emb-agent\.cjs/);
  assert.doesNotMatch(content, /<runtime-cli>/);
  assert.doesNotMatch(content, /## Default Flow/);
  assert.doesNotMatch(content, /doc lookup --chip/);
  assert.match(content, /next --brief/);
  assert.match(content, /external start\|next\|status\|health\|dispatch-next/);
  assert.match(content, /task worktree status\|show/);
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

    assert.equal(next.next.command, 'scan');
    assert.equal(next.workflow_stage.name, 'selection');
    assert.equal(next.workflow_stage.primary_command, 'scan');
    assert.equal(run.source, 'next');
    assert.equal(run.requested_action, 'next');
    assert.equal(run.resolved_action, 'scan');
    assert.equal(run.workflow_stage.name, 'selection');
    assert.equal(run.workflow_stage.primary_command, 'scan');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'next run');

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
    assert.equal(run.resolved_action, 'scan');
    assert.equal(run.workflow_stage.name, 'selection');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'dispatch run next');
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
    assert.equal(run.resolved_action, 'scan');
    assert.equal(run.execution.kind, 'action');
    assert.equal(run.execution.entered_via, 'orchestrate run next');
    assert.equal(run.workflow.strategy, 'inline');
    assert.equal(run.workflow_stage.name, 'selection');
    assert.ok(Array.isArray(run.relevant_files));
    assert.ok(Array.isArray(run.open_questions));
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

  assert.match(compact, /Start here:/);
  assert.match(compact, /Import truth:/);
  assert.match(compact, /Execute current work:/);
  assert.match(compact, /Close and hand off:/);
  assert.match(compact, /start/);
  assert.match(compact, /declare hardware/);
  assert.match(compact, /next \[run\]/);
  assert.match(compact, /ingest schematic --file <path>/);
  assert.match(compact, /bootstrap \[run \[--confirm\]\]/);
  assert.match(compact, /task worktree <list\|status\|show\|create\|cleanup> \[name\]/);
  assert.match(compact, /external <start\|status\|next\|health\|dispatch-next>/);
  assert.match(compact, /Global option: --brief .*runtime_events/);
  assert.match(compact, /help advanced/);
  assert.doesNotMatch(compact, /adapter source add/);
  assert.doesNotMatch(compact, /workspace link/);
  assert.doesNotMatch(compact, /thread /);
  assert.doesNotMatch(compact, /spec /);
  assert.doesNotMatch(compact, /workflow /);
  assert.doesNotMatch(compact, /skills list/);
  assert.doesNotMatch(compact, /memory stack/);

  assert.match(advanced, /Advanced commands:/);
  assert.match(advanced, /Truth and document intake:/);
  assert.match(advanced, /Bootstrap and project state:/);
  assert.match(advanced, /Execution support and closure:/);
  assert.match(advanced, /Task, skills, and memory:/);
  assert.match(advanced, /Workflow and scaffold authoring:/);
  assert.match(advanced, /Delegation and chip support runtime:/);
  assert.match(advanced, /Inspection and discovery:/);
  assert.match(advanced, /support source add/);
  assert.match(advanced, /support analysis init --chip <name>/);
  assert.match(advanced, /support export \[<source>\]/);
  assert.match(advanced, /support publish \[<source>\]/);
  assert.doesNotMatch(advanced, /support promote \[<source>\]/);
  assert.doesNotMatch(advanced, /adapter source add/);
  assert.match(advanced, /bootstrap \[run \[--confirm\]\]/);
  assert.match(advanced, /ingest schematic --file <path>/);
  assert.match(advanced, /doc lookup \[--chip <name>/);
  assert.match(advanced, /doc fetch --url <http\(s\)-url>/);
  assert.match(advanced, /component lookup \[--file <schematic>/);
  assert.match(advanced, /context compress \[note\]/);
  assert.match(advanced, /skills list/);
  assert.match(advanced, /memory stack/);
  assert.match(advanced, /external <start\|status\|next\|health\|dispatch-next>/);
  assert.match(advanced, /Global option: --brief .*runtime_events/);
  assert.match(advanced, /spec list/);
  assert.match(advanced, /workflow init/);
  assert.match(advanced, /workflow new pack/);
  assert.doesNotMatch(advanced, /workspace link/);
  assert.doesNotMatch(advanced, /thread /);
  assert.match(advanced, /commands list/);
  assert.match(advanced, /commands list --all/);
  assert.equal(advanced, allFlag);
});

test('help supports explicit json output mode', async () => {
  const compact = await captureCliJson(['help', '--json']);
  const advanced = await captureCliJson(['--json', 'help', 'advanced']);

  assert.equal(compact.entry, 'help');
  assert.equal(compact.mode, 'compact');
  assert.ok(Array.isArray(compact.global_options));
  assert.ok(compact.global_options.some(item => item.flag === '--json'));
  assert.ok(Array.isArray(compact.sections));
  assert.equal(compact.sections[0].title, 'Start here');
  assert.ok(compact.followups.includes('help advanced'));

  assert.equal(advanced.entry, 'help');
  assert.equal(advanced.mode, 'advanced');
  assert.ok(advanced.sections.some(section => section.title === 'Delegation and chip support runtime'));
  assert.ok(
    advanced.sections.some(
      section => section.title === 'Inspection and discovery' && section.entries.includes('commands list --all')
    )
  );
});

test('explicit --json keeps command payloads machine-readable', async () => {
  const start = await captureCliJson(['--json', 'start']);

  assert.equal(start.entry, 'start');
  assert.ok(start.summary);
  assert.ok(start.workflow);
});

test('unknown command returns structured json when --json is requested', async () => {
  const originalExitCode = process.exitCode;
  try {
    const payload = await captureCliJson(['--json', 'not-a-command']);

    assert.equal(process.exitCode, 1);
    assert.equal(payload.entry, 'help');
    assert.equal(payload.status, 'error');
    assert.equal(payload.error.code, 'unknown-command');
    assert.match(payload.error.message, /Unknown command/);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('start returns a linear default workflow for project and task execution', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-start-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const start = await captureCliJson(['start']);

    assert.equal(start.entry, 'start');
    assert.equal(start.summary.initialized, true);
    assert.equal(start.summary.default_package, '');
    assert.equal(start.summary.active_package, '');
    assert.equal(start.immediate.command, 'next');
    assert.equal(start.workflow.mode, 'linear-default');
    assert.ok(Array.isArray(start.workflow.steps));
    assert.equal(start.workflow.steps[0].title, 'Project bootstrap');
    assert.equal(start.workflow.steps[1].title, 'Task bootstrap');
    assert.equal(start.workflow.steps[2].title, 'Execution loop');
    assert.equal(start.bootstrap.status, 'needs-project-definition');
    assert.equal(start.bootstrap.stage, 'define-project-constraints');
    assert.equal(start.next.command, 'scan');
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('start and next expose package-aware monorepo entry context', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-start-package-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    fs.writeFileSync(
      path.join(tempProject, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', ''].join('\n'),
      'utf8'
    );
    fs.mkdirSync(path.join(tempProject, 'packages', 'app'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'packages', 'fw'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: '@demo/app' }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, 'packages', 'fw', 'package.json'),
      JSON.stringify({ name: '@demo/fw' }, null, 2) + '\n',
      'utf8'
    );

    await captureCliJson(['init']);

    const start = await captureCliJson(['start']);
    assert.equal(start.summary.default_package, 'app');
    assert.equal(start.summary.active_package, 'app');

    const startTty = await captureCliTtyOutput(['start']);
    assert.equal(startTty.stdout.trim(), '');
    assert.match(startTty.stderr, /Project: .*emb-agent-start-package-/);
    assert.match(startTty.stderr, /Package: app/);
    assert.match(startTty.stderr, /Bootstrap: define-project-constraints/);
    assert.match(startTty.stderr, /First: Open \.emb-agent\/req\.yaml/);

    const output = await captureCliTtyOutput(['next']);
    assert.equal(output.stdout.trim(), '');
    assert.match(output.stderr, /Package: app/);
    assert.match(output.stderr, /Next: scan/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('next does not skip hardware bootstrap when identity is still missing', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-next-hw-gate-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'src', 'main.c'), '// bring-up\n', 'utf8');

    await captureCliJson(['init']);

    const next = await captureCliJson(['next']);
    assert.equal(next.next.command, 'scan');
    assert.match(next.next.reason, /Hardware identity is still missing/i);
    assert.doesNotMatch(next.next.reason, /Context is already sufficient/i);
  } finally {
    process.chdir(currentCwd);
  }
});

test('text mode next surfaces runtime event summary in tty output', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-next-tty-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await captureCliJson(['init']);

    const output = await captureCliTtyOutput(['next']);

    assert.match(output.stderr, /Workflow: selection/);
    assert.match(output.stderr, /Next: scan/);
    assert.match(output.stderr, /Events: ok \/ 1 \(workflow-next\)/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('help fast path does not eagerly load emb-agent-main', async () => {
  const cliPath = path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs');
  const mainPath = path.join(repoRoot, 'runtime', 'lib', 'emb-agent-main.cjs');

  delete require.cache[require.resolve(cliPath)];
  delete require.cache[require.resolve(mainPath)];

  const freshCli = require(cliPath);
  assert.equal(require.cache[require.resolve(mainPath)], undefined);

  await captureCliText(['help'], freshCli);
  await captureCliJson(['help', '--json'], freshCli);

  assert.equal(require.cache[require.resolve(mainPath)], undefined);
});
