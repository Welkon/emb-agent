'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('manager view aggregates next handoff settings threads and reports', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['settings', 'set', 'profile', 'rtos-iot']);
    cli.main(['thread', 'add', 'Track OTA rollback issue']);
    cli.main(['pause', 'resume ota rollback']);
    cli.main(['forensics', 'why ota flow keeps drifting']);
    cli.main(['session-report', 'capture ota status']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.mode, 'manager-lite');
    assert.equal(manager.session.profile, 'rtos-iot');
    assert.equal(typeof manager.health.status, 'string');
    assert.equal(manager.handoff.next_action, 'resume ota rollback');
    assert.equal(manager.threads.open, 2);
    assert.match(manager.session.active_thread.title, /Forensics:/);
    assert.ok(manager.reports.forensics.length >= 1);
    assert.ok(manager.reports.sessions.length >= 1);
    assert.equal(manager.diagnostics.latest_forensics.highest_severity, 'high');
    assert.ok(manager.recommended_actions.some(item => item.type === 'resume'));
    assert.ok(manager.recommended_actions.some(item => item.type === 'session-report'));
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    const threadIndex = manager.recommended_actions.findIndex(item => item.type === 'thread');
    assert.ok(threadIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(threadIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager surfaces health next commands before generic next action', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-health-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.ok(Array.isArray(manager.health.next_commands));
    assert.ok(manager.health.next_commands.some(item => item.cli.includes('adapter source add default-pack')));
    const healthIndex = manager.recommended_actions.findIndex(
      item => item.type === 'health' && item.cli.includes('adapter source add default-pack')
    );
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(healthIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(healthIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager view surfaces tool execution before generic next action when ready', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-tool-'));
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

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.next.command, 'scan');
    assert.equal(manager.tool_execution.tool, 'timer-calc');
    assert.equal(manager.tool_execution.status, 'ready');
    const toolIndex = manager.recommended_actions.findIndex(item => item.type === 'tool');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(toolIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(toolIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
