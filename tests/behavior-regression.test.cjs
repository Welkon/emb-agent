'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

function withTempProject(prefix, runner) {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    runner(tempProject);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
}

function setupExecutableToolFixture(projectEmbDir) {
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
}

test('behavior regression sentinel: next routes to health in empty project', () => {
  withTempProject('emb-agent-behavior-health-', () => {
    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.source, 'next');
    assert.equal(orchestrator.resolved_action, 'health');
    assert.equal(orchestrator.workflow.strategy, 'inline');
    assert.match(orchestrator.workflow.next_cli, / health$/);
  });
});

test('behavior regression sentinel: next routes to plan when risks exist', () => {
  withTempProject('emb-agent-behavior-plan-', () => {
    cli.main(['risk', 'add', 'irq race']);
    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'plan');
    assert.equal(orchestrator.workflow.strategy, 'primary-first');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-hw-scout');
  });
});

test('behavior regression sentinel: next routes drift to review', () => {
  withTempProject('emb-agent-behavior-review-', () => {
    cli.main(['question', 'add', 'why flow keeps drifting after resume']);
    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'review');
    assert.equal(orchestrator.workflow.strategy, 'primary-plus-parallel');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-hw-scout');
  });
});

test('behavior regression sentinel: next routes failed executor to review', () => {
  withTempProject('emb-agent-behavior-executor-review-', tempProject => {
    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);
    session.diagnostics.latest_executor = {
      name: 'build',
      status: 'failed',
      risk: 'normal',
      exit_code: 2,
      duration_ms: 1400,
      ran_at: '2026-04-09T12:10:00.000Z',
      cwd: '.',
      argv: ['make', '-C', 'firmware'],
      evidence_hint: [],
      stdout_preview: 'building',
      stderr_preview: 'link failed'
    };
    runtime.writeJson(statePaths.sessionPath, session);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'review');
    assert.equal(orchestrator.workflow.strategy, 'primary-plus-parallel');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-hw-scout');
    assert.equal(orchestrator.executor_signal.present, true);
    assert.equal(orchestrator.executor_signal.failed, true);
    assert.equal(orchestrator.executor_signal.requires_forensics, true);
    assert.equal(orchestrator.executor_signal.recommended_action, 'review');
  });
});

test('behavior regression sentinel: next keeps inline-tool-first when tool is executable', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-behavior-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);
    cli.main(['question', 'add', 'tm2 prescaler and pwm formula']);
    setupExecutableToolFixture(projectEmbDir);

    const orchestrator = cli.buildOrchestratorContext('next');
    const runToolStep = orchestrator.orchestrator_steps.find(item => item.id === 'run-tool');

    assert.equal(orchestrator.resolved_action, 'scan');
    assert.equal(orchestrator.workflow.strategy, 'inline-tool-first');
    assert.equal(orchestrator.workflow.tool_first, true);
    assert.equal(orchestrator.tool_execution.tool, 'timer-calc');
    assert.ok(runToolStep);
    assert.equal(runToolStep.required, true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
