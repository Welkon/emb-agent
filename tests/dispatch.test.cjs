'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

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
    assert.match(dispatch.cli, / plan$/);
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
    assert.match(dispatch.cli, / debug$/);
    assert.equal(dispatch.workflow_stage.name, 'execution');
    assert.equal(dispatch.workflow_stage.primary_command, 'debug');
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-bug-hunter');
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'default');
    assert.ok(dispatch.reason.includes('Open questions'));
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
    cli.main(['focus', 'set', 'chip selection and PoC to production preflight']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.resolved_action, 'arch-review');
    assert.match(dispatch.cli, / arch-review$/);
    assert.equal(dispatch.workflow_stage.name, 'planning');
    assert.equal(dispatch.workflow_stage.primary_command, 'arch-review');
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-arch-reviewer');
    assert.equal(dispatch.agent_execution.dispatch_contract.auto_invoke_when_recommended, true);
    assert.equal(dispatch.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'default');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next routes hardware formula questions to scan before debug', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-scan-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'how should tm2 prescaler and pwm formulas be calculated']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.resolved_action, 'scan');
    assert.match(dispatch.cli, / scan$/);
    assert.ok(dispatch.reason.includes('scan'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next exposes direct tool execution when scan has ready recommendation', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);
    cli.main(['question', 'add', 'how should tm2 prescaler and pwm formulas be calculated']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({ devices: ['vendor-chip'] }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'profiles', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        vendor: 'VendorName',
        family: 'vendor-family',
        sample: false,
        series: 'SeriesName',
        package: 'qfp32',
        architecture: '8-bit',
        runtime_model: 'main_loop_plus_isr',
        description: 'External chip profile.',
        source_refs: ['mcu/vendor-chip', 'mcu/vendor-chip-registers'],
        component_refs: [],
        summary: {},
        capabilities: ['timer16'],
        docs: [],
        related_tools: ['timer-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  runTool() {',
        "    return { status: 'ok' };",
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc'],
        source_refs: ['mcu/vendor-family-overview'],
        component_refs: [],
        clock_sources: ['sysclk'],
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc'],
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer16',
            params: {
              default_timer: 'tm16',
              default_clock_source: 'sysclk',
              prescalers: [1, 4, 16],
              interrupt_bits: [8, 9]
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.resolved_action, 'scan');
    assert.equal(dispatch.tool_execution.tool, 'timer-calc');
    assert.equal(dispatch.tool_execution.status, 'ready');
    assert.equal(dispatch.action_context.recommended_sources[0].id, 'mcu/vendor-chip-registers');
    assert.match(dispatch.tool_execution.cli, /tool run timer-calc/);
    assert.deepEqual(dispatch.tool_execution.missing_inputs, ['clock-hz', 'target-us or target-hz']);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next keeps current context focused on session carry-over', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-session-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'why irq misses']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.current.open_questions[0], 'why irq misses');
    assert.equal(dispatch.workspace, undefined);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next routes drift-style failures to review', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-review-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'why flow keeps drifting after resume']);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.resolved_action, 'review');
    assert.match(dispatch.cli, / review$/);
    assert.equal(dispatch.agent_execution.primary_agent, 'emb-hw-scout');
    assert.ok(dispatch.reason.includes('review'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('dispatch next exposes structured executor signal when latest executor failed', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dispatch-executor-signal-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);
    session.diagnostics.latest_executor = {
      name: 'bench',
      status: 'failed',
      risk: 'high',
      exit_code: 5,
      duration_ms: 1200,
      ran_at: '2026-04-09T12:30:00.000Z',
      cwd: '.',
      argv: ['node', 'scripts/bench-runner.cjs'],
      evidence_hint: ['docs/VERIFICATION.md'],
      stdout_preview: 'bench start',
      stderr_preview: 'timeout'
    };
    runtime.writeJson(statePaths.sessionPath, session);

    const dispatch = cli.buildDispatchContext('next');

    assert.equal(dispatch.diagnostics.latest_executor.name, 'bench');
    assert.equal(dispatch.executor_signal.present, true);
    assert.equal(dispatch.executor_signal.failed, true);
    assert.equal(dispatch.executor_signal.requires_forensics, true);
    assert.equal(dispatch.executor_signal.recommended_action, 'review');
    assert.match(dispatch.executor_signal.summary, /bench failed, exit=5/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
