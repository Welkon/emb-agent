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

test('orchestrator routes drift-style failures to forensics contract', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-forensics-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'why flow keeps drifting after resume']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'forensics');
    assert.equal(orchestrator.workflow.strategy, 'primary-first');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-bug-hunter');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-bug-hunter');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'launch-primary'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator exposes tool-first step when scan has ready tool recommendation', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, 'emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);
    cli.main(['question', 'add', 'tm2 prescaler 和 pwm 公式怎么算']);

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

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'scan');
    assert.equal(orchestrator.workflow.strategy, 'inline-tool-first');
    assert.equal(orchestrator.workflow.tool_first, true);
    assert.equal(orchestrator.tool_execution.tool, 'timer-calc');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'run-tool'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
