'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('session-report writes lightweight session report with next guidance', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['focus', 'set', 'capture bring-up summary']);
    await cli.main(['question', 'add', 'is pwm divider restored after sleep']);
    await cli.main(['risk', 'add', 'resume path may skip timer reload']);
    await cli.main(['workspace', 'add', 'Bring-up lane', '--type', 'flow']);
    await cli.main(['workspace', 'activate', 'bring-up-lane']);
    await cli.main(['thread', 'add', 'Track PWM divider restore issue']);
    await cli.main(['session-report', 'capture current bring-up handoff']);

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /# Emb-Agent Session Report/);
    assert.match(content, /capture current bring-up handoff/);
    assert.match(content, /Bring-up lane/);
    assert.match(content, /is pwm divider restored after sleep/);
    assert.match(content, /resume path may skip timer reload/);
    assert.match(content, /active_workspace: bring-up-lane \(Bring-up lane\)/);
    assert.match(content, /## Workspace/);
    assert.match(content, /- name: bring-up-lane/);
    assert.match(content, /next_command: forensics/);
    assert.match(content, /open: 1/);
    assert.equal(cli.loadSession().last_command, 'session-report');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('session-report records tool recommendation when scan tool is ready', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip']);
    await cli.main(['question', 'add', 'tm2 prescaler 和 pwm 公式怎么算']);

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

    await cli.main(['session-report', 'capture timer formula path']);

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /next_command: scan/);
    assert.match(content, /tool_recommendation: timer-calc/);
    assert.match(content, /tool_status: ready/);
    assert.match(content, /tool_trust: usable \(74\/100\), executable=yes/);
    assert.match(content, /adapter_health: timer-calc usable \(74\/100\), executable=yes, action=add-source-refs/);
    assert.match(content, /tool run timer-calc/);
    assert.match(content, /clock-hz, target-us or target-hz/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
