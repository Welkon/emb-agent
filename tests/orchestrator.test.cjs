'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

async function captureCliJson(args) {
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

test('orchestrator defaults to selection scan and stays inline for empty project context', () => {
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
    assert.match(orchestrator.workflow.next_cli, / scan$/);
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
    assert.equal(orchestrator.dispatch_contract.delegation_pattern, 'coordinator');
    assert.equal(orchestrator.dispatch_contract.synthesis_required, true);
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-hw-scout');
    assert.equal(orchestrator.dispatch_contract.review_contract.stage_a.id, 'contract-review');
    assert.equal(orchestrator.dispatch_contract.review_contract.stage_b.id, 'quality-review');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'synthesize'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'contract-review'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'quality-review'));
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
    cli.main(['focus', 'set', 'chip selection and PoC to production preflight']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'arch-review');
    assert.equal(orchestrator.workflow.strategy, 'primary-first');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-arch-reviewer');
    assert.equal(orchestrator.dispatch_contract.delegation_pattern, 'coordinator');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-arch-reviewer');
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'synthesize'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'contract-review'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'quality-review'));
    assert.ok(orchestrator.orchestrator_steps.some(item => item.id === 'launch-primary'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator routes drift-style failures to review contract', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-review-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['question', 'add', 'why flow keeps drifting after resume']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.resolved_action, 'review');
    assert.equal(orchestrator.workflow.strategy, 'primary-plus-parallel');
    assert.equal(orchestrator.workflow.primary_agent, 'emb-hw-scout');
    assert.equal(orchestrator.dispatch_contract.primary.agent, 'emb-hw-scout');
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
    assert.equal(orchestrator.adapter_health.primary.tool, 'timer-calc');
    assert.equal(orchestrator.adapter_health.primary.executable, true);
    const runToolStep = orchestrator.orchestrator_steps.find(item => item.id === 'run-tool');
    assert.ok(runToolStep);
    assert.equal(runToolStep.trust.grade, 'usable');
    assert.equal(runToolStep.recommended_action, 'add-source-refs');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator exposes structured executor signal when latest executor failed', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-executor-signal-'));
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
      name: 'build',
      status: 'failed',
      risk: 'normal',
      exit_code: 2,
      duration_ms: 1500,
      ran_at: '2026-04-09T12:40:00.000Z',
      cwd: '.',
      argv: ['make', '-C', 'firmware'],
      evidence_hint: [],
      stdout_preview: 'building',
      stderr_preview: 'link failed'
    };
    runtime.writeJson(statePaths.sessionPath, session);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.diagnostics.latest_executor.name, 'build');
    assert.equal(orchestrator.executor_signal.present, true);
    assert.equal(orchestrator.executor_signal.failed, true);
    assert.equal(orchestrator.executor_signal.requires_forensics, true);
    assert.equal(orchestrator.executor_signal.recommended_action, 'review');
    assert.match(orchestrator.executor_signal.summary, /build failed, exit=2/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrate run exposes delegation runtime synthesis and integration artifacts', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-runtime-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['risk', 'add', 'irq race']);

    const run = await captureCliJson(['orchestrate', 'run', 'next']);
    const session = cli.loadSession();
    const delegationRuntime = session.diagnostics.delegation_runtime;

    assert.equal(run.delegation_runtime.pattern, 'coordinator');
    assert.equal(run.delegation_runtime.strategy, 'primary-first');
    assert.equal(run.delegation_runtime.requested_action, 'next');
    assert.equal(run.delegation_runtime.resolved_action, 'plan');
    assert.equal(run.delegation_runtime.synthesis.required, true);
    assert.equal(run.delegation_runtime.synthesis.status, 'blocked-no-host-bridge');
    assert.match(run.delegation_runtime.synthesis.rule, /Synthesize, do not delegate understanding/);
    assert.equal(run.delegation_runtime.integration.status, 'completed-inline');
    assert.equal(run.delegation_runtime.integration.execution_kind, 'action');
    assert.equal(run.delegation_runtime.review.required, true);
    assert.equal(run.delegation_runtime.review.stage_a.id, 'contract-review');
    assert.equal(run.delegation_runtime.review.stage_a.status, 'blocked-no-worker-results');
    assert.equal(run.delegation_runtime.review.stage_b.status, 'blocked-by-stage-a');
    assert.equal(run.redispatch_required, false);
    assert.ok(run.delegation_runtime.launch_requests.some(item => item.agent === 'emb-hw-scout'));
    assert.equal(delegationRuntime.pattern, 'coordinator');
    assert.equal(delegationRuntime.strategy, 'primary-first');
    assert.equal(delegationRuntime.integration.entered_via, 'orchestrate run next');
  } finally {
    process.chdir(currentCwd);
  }
});

test('orchestrate run invokes configured host sub-agent bridge and keeps worker results visible', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-worker-'));
  const currentCwd = process.cwd();
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;

  try {
    process.chdir(tempProject);
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    await cli.main(['init']);
    await cli.main(['risk', 'add', 'irq race']);

    const run = await captureCliJson(['orchestrate', 'run', 'next']);
    const session = cli.loadSession();
    const delegationRuntime = session.diagnostics.delegation_runtime;

    assert.equal(run.subagent_bridge.status, 'ok');
    assert.equal(run.worker_results.length, 1);
    assert.equal(run.worker_results[0].agent, 'emb-hw-scout');
    assert.equal(run.delegation_runtime.synthesis.status, 'ready');
    assert.equal(run.delegation_runtime.review.stage_a.status, 'passed');
    assert.equal(run.delegation_runtime.review.stage_b.status, 'main-thread-review-required');
    assert.equal(run.redispatch_required, false);
    assert.equal(delegationRuntime.worker_results.length, 1);
    assert.equal(delegationRuntime.worker_results[0].status, 'ok');
  } finally {
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
  }
});

test('orchestrate launch keeps orchestration metadata while async jobs are collected later', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-launch-'));
  const currentCwd = process.cwd();
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const delayedBridge = `${process.execPath} ${path.join(repoRoot, 'tests', 'fixtures', 'delayed-subagent-bridge.cjs')} --delay-ms 200`;

  try {
    process.chdir(tempProject);
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = delayedBridge;
    await cli.main(['init']);
    await cli.main(['risk', 'add', 'irq race']);

    const launch = await captureCliJson(['orchestrate', 'launch', 'next']);

    assert.equal(launch.mode, 'lightweight-action-orchestrator');
    assert.equal(launch.execution.kind, 'delegation-launch');
    assert.equal(launch.subagent_bridge.status, 'launched');
    assert.equal(launch.workflow.strategy, 'primary-first');
    assert.equal(launch.delegation_runtime.pattern, 'coordinator');
    assert.equal(launch.delegation_runtime.jobs.length, 1);
    assert.equal(launch.delegation_runtime.synthesis.status, 'running');

    await new Promise(resolve => setTimeout(resolve, 450));

    const collected = await captureCliJson(['orchestrate', 'collect']);
    const session = cli.loadSession();

    assert.equal(collected.collected, true);
    assert.equal(collected.delegation_runtime.jobs[0].status, 'completed');
    assert.equal(collected.delegation_runtime.worker_results.length, 1);
    assert.equal(collected.delegation_runtime.synthesis.status, 'ready');
    assert.equal(collected.delegation_runtime.review.stage_a.status, 'passed');
    assert.equal(session.diagnostics.delegation_runtime.jobs[0].status, 'completed');
    assert.equal(session.diagnostics.delegation_runtime.worker_results[0].status, 'ok');
  } finally {
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
  }
});

test('orchestrate run marks redispatch required when worker result fails stage A gate', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-redispatch-'));
  const currentCwd = process.cwd();
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const failingBridge = `${process.execPath} ${path.join(repoRoot, 'tests', 'fixtures', 'failing-subagent-bridge.cjs')}`;

  try {
    process.chdir(tempProject);
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = failingBridge;
    await cli.main(['init']);
    await cli.main(['risk', 'add', 'irq race']);

    const run = await captureCliJson(['orchestrate', 'run', 'next']);

    assert.equal(run.status, 'redispatch-required');
    assert.equal(run.executed, false);
    assert.equal(run.execution.kind, 'action-blocked');
    assert.equal(run.worker_results.length, 1);
    assert.equal(run.worker_results[0].status, 'bridge-error');
    assert.equal(run.delegation_runtime.review.redispatch_required, true);
    assert.equal(run.delegation_runtime.review.stage_a.status, 'redispatch-required');
    assert.equal(run.delegation_runtime.review.stage_b.status, 'blocked-by-stage-a');
    assert.equal(run.redispatch_required, true);
  } finally {
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
  }
});

test('orchestrator keeps tool step non-required when adapter trust is not yet executable', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-tool-draft-'));
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
    fs.mkdirSync(path.join(projectEmbDir, 'adapters', 'routes'), { recursive: true });
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
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc'],
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
            draft: true,
            params: {
              default_timer: 'tm16'
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'adapters', 'routes', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    return {',
        "      tool: context.toolName,",
        "      status: 'draft-adapter',",
        "      implementation: 'external-adapter-draft',",
        '      inputs: { options }',
        '    };',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const next = cli.buildNextContext();
    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(next.health.adapter_health.primary.tool, 'timer-calc');
    assert.equal(next.health.adapter_health.primary.executable, false);
    assert.ok(next.next_actions.some(item => item.includes('Adapter trust reminder')));
    assert.ok(next.next_actions.some(item => item.includes('implement-adapter')));

    assert.equal(orchestrator.resolved_action, 'scan');
    assert.equal(orchestrator.workflow.tool_first, false);
    assert.equal(orchestrator.adapter_health.primary.recommended_action, 'implement-adapter');
    const runToolStep = orchestrator.orchestrator_steps.find(item => item.id === 'run-tool');
    assert.ok(runToolStep);
    assert.equal(runToolStep.required, false);
    assert.equal(runToolStep.trust.executable, false);
    assert.equal(runToolStep.recommended_action, 'implement-adapter');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('orchestrator surfaces current session carry-over without workspace view', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-orchestrate-session-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['risk', 'add', 'irq race']);

    const orchestrator = cli.buildOrchestratorContext('next');

    assert.equal(orchestrator.current.known_risks[0], 'irq race');
    assert.equal(orchestrator.workspace, undefined);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
