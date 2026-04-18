'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

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
    await cli.main(['session-report', 'capture current bring-up handoff']);

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /# Emb-Agent Session Report/);
    assert.match(content, /capture current bring-up handoff/);
    assert.match(content, /is pwm divider restored after sleep/);
    assert.match(content, /resume path may skip timer reload/);
    assert.match(content, /next_command: review/);
    assert.doesNotMatch(content, /## Workspace/);
    assert.doesNotMatch(content, /## Threads/);
    assert.equal(cli.loadSession().last_command, 'session-report');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('session-report also performs auto-memory extraction at session boundary', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-memory-'));
  const currentCwd = process.cwd();

  async function runQuiet(args) {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;

    try {
      await cli.main(args);
    } finally {
      process.stdout.write = originalWrite;
    }
  }

  async function captureJson(args) {
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

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await runQuiet(['init']);
    await runQuiet(['focus', 'set', 'capture closure summary']);
    await runQuiet(['risk', 'add', 'resume path may skip timer reload']);

    const report = await captureJson(['session-report', 'capture closure summary']);
    assert.equal(report.generated, true);
    assert.ok(report.session_state);
    assert.equal(report.session_state.storage_mode, 'primary');
    assert.equal(report.session_state.session.exists, true);
    assert.ok(report.auto_memory);
    assert.equal(report.auto_memory.remembered, true);

    const listed = await captureJson(['memory', 'list']);
    assert.ok(listed.length >= 1);
    const shown = await captureJson(['memory', 'show', listed[0].name]);
    assert.match(shown.content, /session-report: capture closure summary/);
  } finally {
    process.chdir(currentCwd);
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
    await cli.main(['question', 'add', 'how should tm2 prescaler and pwm formulas be calculated']);

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
    assert.match(content, /chip_support_health: reuse=reusable, tool=timer-calc, trust=usable \(74\/100\), executable=yes, action=add-source-refs/);
    assert.match(content, /tool run timer-calc/);
    assert.match(content, /clock-hz, target-us or target-hz/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('session-report records walkthrough recommendation for broad peripheral exercise', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-walkthrough-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip', '--package', 'qfp32']);

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
        capabilities: ['timer', 'pwm', 'comparator', 'adc'],
        docs: [],
        related_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'].forEach(toolName => {
      fs.writeFileSync(
        path.join(projectEmbDir, 'extensions', 'tools', `${toolName}.cjs`),
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
    });
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
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
        supported_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer',
            params: {
              default_timer: 'tmr0',
              default_clock_source: 'sysclk',
              prescalers: [1]
            }
          },
          'pwm-calc': {
            algorithm: 'vendor-pwm',
            params: {
              default_output_pin: 'pa3',
              default_clock_source: 'sysclk',
              output_pins: {
                pa3: { pin: 'pa3' }
              },
              clock_sources: {
                sysclk: { label: 'SYSCLK' }
              }
            }
          },
          'comparator-threshold': {
            algorithm: 'vendor-cmp',
            params: {
              default_positive_source: 'vr',
              default_negative_source: 'cmp0n',
              positive_sources: {
                vr: {}
              },
              negative_sources: {
                cmp0n: {}
              }
            }
          },
          'adc-scale': {
            algorithm: 'vendor-adc',
            params: {
              default_reference_source: 'vdd',
              default_channel: 'an0',
              default_resolution: 12,
              supported_resolutions: [12],
              reference_sources: {
                vdd: { label: 'VDD' }
              },
              channels: {
                an0: { name: 'AN0' }
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'vendor-chip',
      '--package', 'qfp32',
      '--signal', 'PWM_OUT',
      '--pin', 'PA3',
      '--dir', 'output',
      '--note', '20kHz PWM output',
      '--confirmed', 'true',
      '--signal', 'ADC_IN',
      '--pin', 'PA0',
      '--dir', 'input',
      '--note', 'ADC sampling input',
      '--confirmed', 'true',
      '--peripheral', 'PWM',
      '--usage', '20kHz 50% duty output',
      '--peripheral', 'Comparator',
      '--usage', 'Threshold compare',
      '--peripheral', 'ADC',
      '--usage', 'Voltage sampling'
    ]);
    await cli.main([
      'task', 'add', '--confirm',
      'Exercise all supported vendor-chip peripherals',
      '--type', 'implement',
      '--scope', 'peripherals',
      '--priority', 'P1'
    ]);
    await cli.main(['task', 'activate', '--confirm', 'exercise-all-supported-vendor-chip-peripherals']);

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);
    session.diagnostics.walkthrough_runtime = {
      kind: 'peripheral-walkthrough',
      status: 'running',
      ordered_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
      current_index: 1,
      completed_count: 1,
      total_steps: 4,
      last_tool: 'timer-calc',
      last_summary: 'Walkthrough step timer-calc completed.',
      steps: [
        {
          tool: 'timer-calc',
          status: 'ok',
          cli: 'tool run timer-calc --target-us 50',
          argv: ['tool', 'run', 'timer-calc', '--target-us', '50'],
          missing_inputs: [],
          summary: 'Walkthrough step timer-calc completed.',
          updated_at: '2026-04-17T10:00:00.000Z'
        },
        {
          tool: 'pwm-calc',
          status: 'pending',
          cli: 'tool run pwm-calc --target-hz 20000 --duty 50',
          argv: ['tool', 'run', 'pwm-calc', '--target-hz', '20000', '--duty', '50'],
          missing_inputs: [],
          summary: '',
          updated_at: ''
        }
      ],
      updated_at: '2026-04-17T10:00:00.000Z'
    };
    runtime.writeJson(statePaths.sessionPath, session);
    await cli.main(['session-report', 'capture peripheral walkthrough']);

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /walkthrough_mode: peripheral-walkthrough/);
    assert.match(content, /walkthrough_tools: timer-calc -> pwm-calc -> comparator-threshold -> adc-scale/);
    assert.match(content, /walkthrough_status: running/);
    assert.match(content, /walkthrough_progress: 1\/4/);
    assert.match(content, /walkthrough_current: pwm-calc/);
    assert.match(content, /walkthrough_last: Walkthrough step timer-calc completed\./);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('session-report records latest executor summary and routes failed executor to review', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-executor-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);
    session.diagnostics.latest_executor = {
      name: 'bench',
      status: 'failed',
      risk: 'high',
      exit_code: 7,
      duration_ms: 2600,
      ran_at: '2026-04-09T12:00:00.000Z',
      cwd: '.',
      argv: ['node', 'scripts/bench-runner.cjs', '--case', 'resume'],
      evidence_hint: ['docs/VERIFICATION.md'],
      stdout_preview: 'resume bench started',
      stderr_preview: 'device handshake timeout'
    };
    runtime.writeJson(statePaths.sessionPath, session);

    const reportResult = cli.runSessionReport('capture failed executor context');

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /capture failed executor context/);
    assert.match(content, /## Diagnostics/);
    assert.match(content, /latest_executor: bench failed, exit=7, risk=high/);
    assert.match(content, /latest_executor_argv: node scripts\/bench-runner\.cjs --case resume/);
    assert.match(content, /latest_executor_stderr_preview: device handshake timeout/);
    assert.match(content, /next_command: review/);
    assert.match(content, /Latest executor: bench failed/);
    assert.equal(reportResult.executor_signal.present, true);
    assert.equal(reportResult.executor_signal.failed, true);
    assert.equal(reportResult.executor_signal.requires_forensics, true);
    assert.equal(reportResult.executor_signal.recommended_action, 'review');
    assert.match(reportResult.executor_signal.summary, /bench failed, exit=7/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('session-report includes delegation runtime summary from latest orchestrated run', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-delegation-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    await cli.main(['init']);
    await cli.main(['risk', 'add', 'irq race']);
    await cli.main(['orchestrate', 'run', 'next']);
    await cli.main(['session-report', 'capture delegation runtime']);

    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /delegation_pattern: coordinator/);
    assert.match(content, /delegation_strategy: primary-first/);
    assert.match(content, /delegation_action: next -> plan/);
    assert.match(content, /delegation_phases: research -> synthesis -> execution -> integration/);
    assert.match(content, /delegation_launches: emb-hw-scout:research:spawn-fresh/);
    assert.match(content, /delegation_synthesis: ready, owner=Current main thread/);
    assert.match(content, /delegation_worker_results: emb-hw-scout:research:ok/);
    assert.match(content, /delegation_integration: completed-inline, owner=Current main thread, kind=action/);
    assert.match(content, /delegation_review: stage_a=passed, stage_b=main-thread-review-required, redispatch=no/);
  } finally {
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
