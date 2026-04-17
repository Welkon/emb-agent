'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputMode = require(path.join(repoRoot, 'runtime', 'lib', 'output-mode.cjs'));

test('parseOutputModeArgs supports next --brief and keeps tool-local --brief', () => {
  const next = outputMode.parseOutputModeArgs(['next', '--brief']);
  assert.equal(next.brief, true);
  assert.equal(next.json, false);
  assert.deepEqual(next.args, ['next']);

  const toolLocal = outputMode.parseOutputModeArgs(['tool', 'run', 'timer-calc', '--brief']);
  assert.equal(toolLocal.brief, false);
  assert.equal(toolLocal.json, false);
  assert.deepEqual(toolLocal.args, ['tool', 'run', 'timer-calc', '--brief']);

  const mixed = outputMode.parseOutputModeArgs(['--brief', 'tool', 'run', 'timer-calc', '--brief']);
  assert.equal(mixed.brief, true);
  assert.equal(mixed.json, false);
  assert.deepEqual(mixed.args, ['tool', 'run', 'timer-calc', '--brief']);

  const jsonMixed = outputMode.parseOutputModeArgs(['--json', 'next', '--brief']);
  assert.equal(jsonMixed.brief, true);
  assert.equal(jsonMixed.json, true);
  assert.deepEqual(jsonMixed.args, ['next']);
});

test('applyOutputMode builds brief next context payload', () => {
  const input = {
    current: {
      profile: 'baremetal-8bit',
      packs: ['sensor-node'],
      focus: 'bringup',
      last_command: 'scan',
      suggested_flow: 'scan -> do -> verify'
    },
    next: {
      command: 'plan',
      reason: 'complex tasks should converge first',
      cli: 'node runtime/bin/emb-agent.cjs plan',
      gated_by_health: false,
      tool_recommendation: {
        tool: 'timer-calc',
        status: 'ready',
        cli_draft: 'tool run timer-calc --target-us 500'
      }
    },
    workflow_stage: {
      name: 'planning',
      why: 'complex task',
      exit_criteria: 'plan has clear steps',
      primary_command: 'plan'
    },
    quality_gates: {
      gate_status: 'pending',
      status_summary: 'Waiting for engineer confirmation: board-bench',
      blocking_summary: 'Waiting for engineer confirmation: board-bench',
      required_executors: ['build', 'bench'],
      required_signoffs: ['board-bench'],
      pending_gates: ['bench'],
      pending_signoffs: ['board-bench'],
      recommended_runs: ['executor run bench'],
      recommended_signoffs: ['verify confirm board-bench']
    },
    permission_gates: [
      {
        id: 'quality-gates',
        kind: 'quality-gate',
        state: 'pending',
        summary: 'Waiting for engineer confirmation: board-bench',
        commands: ['executor run bench', 'verify confirm board-bench']
      }
    ],
    memory_summary: {
      generated_at: '2026-04-09T12:00:00.000Z',
      captured_at: '2026-04-09T12:00:00.000Z',
      source: 'pause',
      snapshot_label: 'Point-in-time pause snapshot captured at 2026-04-09T12:00:00.000Z',
      stale_note: 'This compact snapshot is static and will not auto-update; rerun a recovery pointer to refresh live state.',
      recovery_pointers: [
        'Refresh live session status: node ~/.codex/emb-agent/bin/emb-agent.cjs status',
        'Inspect merged live session: node ~/.codex/emb-agent/bin/emb-agent.cjs resolve'
      ],
      next_action: 'resume timer drift',
      last_files: ['main.c', 'irq.c', 'clock.c', 'pwm.c', 'bench.c'],
      open_questions: ['why drift grows'],
      known_risks: ['divider restore may fail'],
      active_task: {
        name: 'timer-drift',
        title: 'Investigate timer drift',
        status: 'active'
      }
    },
    context_hygiene: {
      level: 'consider-clearing',
      recommendation: 'pause first',
      clear_hint: 'pause -> clear -> resume',
      compress_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs context compress',
      handoff_ready: false
    },
    runtime_events: [
      {
        type: 'workflow-next',
        category: 'workflow',
        status: 'pending',
        summary: 'complex tasks should converge first'
      },
      {
        type: 'permission-evaluated',
        category: 'human-signoff',
        status: 'pending',
        summary: 'Waiting for engineer confirmation: board-bench'
      }
    ],
    next_actions: ['a', 'b', 'c', 'd', 'e', 'f'],
    health: {
      status: 'ok',
      summary: { score: 90 }
    }
  };

  const output = outputMode.applyOutputMode(input, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.next.command, 'plan');
  assert.equal(output.workflow_stage.name, 'planning');
  assert.equal(output.quality_gates.gate_status, 'pending');
  assert.equal(output.quality_gates.status_summary, 'Waiting for engineer confirmation: board-bench');
  assert.deepEqual(output.quality_gates.required_signoffs, ['board-bench']);
  assert.equal(output.permission_gates.status, 'pending');
  assert.deepEqual(output.permission_gates.kinds, ['quality-gate']);
  assert.equal(output.memory_summary.source, 'pause');
  assert.equal(output.memory_summary.snapshot_label, 'Point-in-time pause snapshot captured at 2026-04-09T12:00:00.000Z');
  assert.equal(output.memory_summary.recovery_pointers.length, 2);
  assert.equal(output.memory_summary.last_files.length, 4);
  assert.equal(output.context_hygiene.level, 'consider-clearing');
  assert.equal(output.context_hygiene.compress_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs context compress');
  assert.equal(output.next_actions.length, 5);
  assert.equal(output.tool_recommendation.tool, 'timer-calc');
  assert.equal(output.runtime_events.status, 'pending');
  assert.deepEqual(output.runtime_events.types, ['workflow-next', 'permission-evaluated']);
  assert.equal(output.external_agent, undefined);
});

test('applyOutputMode builds brief start context payload with external driver hints', () => {
  const output = outputMode.applyOutputMode({
    entry: 'start',
    summary: {
      project_root: '/tmp/demo',
      initialized: true,
      handoff_present: false,
      hardware_identity: {
        vendor: 'SCMCU',
        model: 'SC8F072',
        package: 'SOP8'
      }
    },
    immediate: {
      command: 'task add <summary>',
      reason: 'Project bootstrap exists; create and activate a task before execution.',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs task add <summary>'
    },
    bootstrap: {
      status: 'ready-for-next',
      stage: 'continue-with-next',
      command: 'next',
      summary: 'Project bootstrap is explicit enough to continue with next.'
    },
    runtime_events: [
      {
        type: 'workflow-start',
        category: 'workflow',
        status: 'ok',
        summary: 'Project bootstrap exists; create and activate a task before execution.'
      }
    ],
    next: {
      command: 'scan',
      reason: 'selection mode is already closed',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs scan'
    }
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.entry, 'start');
  assert.equal(output.immediate.command, 'task add <summary>');
  assert.equal(output.runtime_events.status, 'ok');
  assert.deepEqual(output.runtime_events.types, ['workflow-start']);
  assert.equal(output.external_agent, undefined);
});

test('applyOutputMode builds brief init output with external driver hints', () => {
  const output = outputMode.applyOutputMode({
    initialized: true,
    reused_existing: false,
    init_alias: 'init',
    project_root: '/tmp/demo',
    project_dir: '.emb-agent',
    project_profile: '',
    active_packs: [],
    developer: { name: 'welkon', runtime: 'external' },
    bootstrap: {
      status: 'needs-project-definition',
      stage: 'define-project-constraints',
      command: 'next',
      summary: 'Define the project in .emb-agent/req.yaml first: write the project type, intended inputs/outputs, interfaces, and constraints.'
    },
    runtime_events: [
      {
        type: 'workflow-start',
        category: 'workflow',
        status: 'pending',
        summary: 'Define the project in .emb-agent/req.yaml first.'
      }
    ]
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.initialized, true);
  assert.equal(output.bootstrap.command, 'next');
  assert.equal(output.runtime_events.status, 'pending');
  assert.equal(output.external_agent, undefined);
});

test('applyOutputMode builds brief tool output with permission gates', () => {
  const input = {
    tool: 'timer-calc',
    status: 'chip-support-required',
    implementation: 'abstract-only',
    high_risk_clarity: {
      enabled: true,
      category: 'irreversible-hardware-write',
      requires_explicit_confirmation: true,
      matched_signals: ['arg:--flash']
    },
    permission_gates: [
      {
        id: 'high-risk-confirmation',
        kind: 'explicit-confirmation',
        state: 'pending',
        summary: 'A potentially destructive erase / flash / fuse operation was detected.',
        commands: []
      }
    ]
  };

  const output = outputMode.applyOutputMode(input, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.tool, 'timer-calc');
  assert.equal(output.permission_gates.status, 'pending');
  assert.deepEqual(output.permission_gates.kinds, ['explicit-confirmation']);
  assert.equal(output.high_risk_clarity.requires_explicit_confirmation, true);
});

test('applyOutputMode keeps host bridge and delegation summary in brief status/dispatch outputs', () => {
  const statusOutput = outputMode.applyOutputMode({
    session_version: 1,
    runtime_host: 'codex',
    project_root: '/tmp/demo',
    project_profile: 'baremetal-8bit',
    context_hygiene: { level: 'ok' },
    subagent_bridge: {
      available: true,
      mode: 'mock',
      source: 'env',
      status: 'ok'
    },
    delegation_runtime: {
      pattern: 'coordinator',
      strategy: 'primary-first',
      requested_action: 'next',
      resolved_action: 'plan',
      phases: [{ id: 'research' }, { id: 'synthesis' }],
      launch_requests: [{ agent: 'emb-hw-scout' }],
      worker_results: [{ agent: 'emb-hw-scout', status: 'ok' }],
      synthesis: { required: true, status: 'ready', owner: 'Current main thread' },
      integration: { status: 'completed-inline', owner: 'Current main thread', execution_kind: 'action' },
      review: {
        required: true,
        redispatch_required: false,
        stage_a: { status: 'passed' },
        stage_b: { status: 'main-thread-review-required' }
      }
    },
    runtime_events: [
      {
        type: 'workflow-status',
        category: 'workflow',
        status: 'ok',
        summary: 'Reported session status.'
      }
    ]
  }, true);

  const dispatchOutput = outputMode.applyOutputMode({
    requested_action: 'next',
    resolved_action: 'plan',
    reason: 'complex task',
    subagent_bridge: {
      available: true,
      mode: 'mock',
      source: 'env',
      status: 'ok'
    },
    delegation_runtime: {
      pattern: 'coordinator',
      strategy: 'primary-first',
      requested_action: 'next',
      resolved_action: 'plan',
      phases: [{ id: 'research' }, { id: 'synthesis' }],
      worker_results: [{ agent: 'emb-hw-scout', status: 'ok' }],
      synthesis: { required: true, status: 'ready', owner: 'Current main thread' },
      integration: { status: 'completed-inline', owner: 'Current main thread', execution_kind: 'action' },
      review: {
        required: true,
        redispatch_required: false,
        stage_a: { status: 'passed' },
        stage_b: { status: 'main-thread-review-required' }
      }
    },
    runtime_events: [
      {
        type: 'workflow-next',
        category: 'workflow',
        status: 'pending',
        summary: 'complex task'
      }
    ]
  }, true);

  assert.equal(statusOutput.runtime_host, 'codex');
  assert.equal(statusOutput.subagent_bridge.mode, 'mock');
  assert.equal(statusOutput.delegation_runtime.pattern, 'coordinator');
  assert.equal(statusOutput.runtime_events.status, 'ok');
  assert.equal(statusOutput.external_agent, undefined);
  assert.deepEqual(statusOutput.delegation_runtime.worker_results, ['emb-hw-scout:ok']);
  assert.equal(statusOutput.delegation_runtime.review.stage_a, 'passed');
  assert.equal(statusOutput.delegation_runtime.review.stage_b, 'main-thread-review-required');
  assert.equal(dispatchOutput.subagent_bridge.status, 'ok');
  assert.equal(dispatchOutput.delegation_runtime.synthesis.status, 'ready');
  assert.equal(dispatchOutput.delegation_runtime.review.redispatch_required, false);
  assert.equal(dispatchOutput.runtime_events.status, 'pending');
});

test('applyOutputMode omits external driver summary in brief status output', () => {
  const output = outputMode.applyOutputMode({
    session_version: 1,
    runtime_host: 'external',
    project_root: '/tmp/demo',
    project_profile: 'baremetal-8bit',
    context_hygiene: { level: 'ok' }
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.external_agent, undefined);
});

test('applyOutputMode hides internal trust details in brief health/bootstrap outputs', () => {
  const healthOutput = outputMode.applyOutputMode({
    command: 'health',
    status: 'warn',
    runtime_host: 'codex',
    workspace_trust: {
      trusted: false,
      explicit: true,
      source: 'env',
      signal: 'untrusted',
      summary: 'Automatic startup is explicitly disabled by environment override'
    },
    summary: { pass: 3, warn: 1, fail: 0, info: 0 },
    checks: [
      { key: 'project_root', status: 'pass', summary: 'Project root is accessible' },
      { key: 'startup_automation', status: 'warn', summary: 'Startup automation is not ready yet' },
      { key: 'project_config_valid', status: 'pass', summary: 'project.json validation passed' },
      { key: 'subagent_bridge', status: 'info', summary: 'Host sub-agent bridge is not configured' }
    ],
    recommendations: [
      'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      'Configure EMB_AGENT_SUBAGENT_BRIDGE_CMD if you want dispatch/orchestrate to launch host sub-agents automatically.'
    ],
    next_commands: [],
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Needs host action',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Host session ready for automatic bootstrap',
      first_instruction: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      first_cli: '',
      then_cli: '',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health'
    },
    quickstart: {
      stage: 'restart-host-hooks',
      display_stage: 'restart-host-for-bootstrap',
      user_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health',
      steps: []
    }
  }, true);

  const bootstrapOutput = outputMode.applyOutputMode({
    command: 'bootstrap',
    status: 'manual',
    display_status: 'needs-user-input',
    summary: 'Restart the host once so emb-agent automatic startup is active',
    display_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
    current_stage: 'startup-hooks',
    display_current_stage: 'host-readiness',
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Needs host action',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Host session ready for automatic bootstrap',
      first_instruction: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      first_cli: '',
      then_cli: '',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health'
    },
    workspace_trust: {
      trusted: false,
      explicit: true,
      source: 'env',
      signal: 'untrusted',
      summary: 'Automatic startup is explicitly disabled by environment override'
    },
    next_stage: {
      id: 'startup-hooks',
      status: 'manual',
      display_id: 'host-readiness',
      display_status: 'needs-user-input',
      label: 'Host session ready for automatic bootstrap',
      action_summary: 'Needs host action',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      {
        id: 'startup-hooks',
        status: 'manual',
        display_id: 'host-readiness',
        display_status: 'needs-user-input',
        label: 'Host session ready for automatic bootstrap',
        action_summary: 'Needs host action'
      }
    ],
    quickstart: {
      stage: 'restart-host-hooks',
      display_stage: 'restart-host-for-bootstrap',
      user_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health',
      steps: []
    }
  }, true);

  assert.equal('workspace_trust' in healthOutput, false);
  assert.equal('workspace_trust' in bootstrapOutput, false);
  assert.equal(healthOutput.quickstart.stage, 'restart-host-for-bootstrap');
  assert.equal(healthOutput.action_card.action, 'Needs host action');
  assert.match(healthOutput.action_card.first_instruction, /Startup hooks are not active/);
  assert.deepEqual(healthOutput.checks.map(item => item.key), ['startup_automation']);
  assert.deepEqual(healthOutput.recommendations, ['Configure EMB_AGENT_SUBAGENT_BRIDGE_CMD if you want dispatch/orchestrate to launch host sub-agents automatically.']);
  assert.equal('primary_cli' in healthOutput, false);
  assert.equal(bootstrapOutput.action_card.stage, 'host-readiness');
  assert.equal(bootstrapOutput.current_stage, 'host-readiness');
});

test('applyOutputMode prioritizes brief health checks around the current action stage', () => {
  const output = outputMode.applyOutputMode({
    command: 'health',
    status: 'warn',
    runtime_host: 'codex',
    summary: { pass: 8, warn: 2, fail: 0, info: 1 },
    checks: [
      { key: 'project_root', status: 'pass', summary: 'Project root is accessible' },
      { key: 'project_config_valid', status: 'pass', summary: 'project.json validation passed' },
      { key: 'chip_support_match', status: 'warn', summary: 'Installed chip support does not cover the current chip yet' },
      { key: 'chip_support_sources_registered', status: 'warn', summary: 'No chip support source is registered yet' },
      { key: 'subagent_bridge', status: 'info', summary: 'Host sub-agent bridge is not configured' },
      { key: 'hardware_identity', status: 'pass', summary: 'The chip model is mapped to a chip profile' }
    ],
    recommendations: [
      'Chip support is available but not installed in the project yet; install it before continuing.',
      'Register the default chip support source before retrying chip support install.'
    ],
    next_commands: [
      {
        key: 'support-source-add',
        cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-pack --type git --location https://github.com/Welkon/emb-agent-adapters.git'
      }
    ],
    action_card: {
      status: 'ready-to-run',
      stage: 'chip-support',
      action: 'Ready to continue',
      summary: 'Chip support is available but not installed in the project yet; install it before continuing.',
      first_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs support bootstrap'
    },
    quickstart: {
      stage: 'install-chip-support-then-next',
      display_stage: 'install-chip-support-then-next',
      user_summary: 'Chip support is available but not installed in the project yet; install it before continuing.',
      steps: []
    }
  }, true);

  assert.deepEqual(output.checks.map(item => item.key), ['chip_support_match', 'chip_support_sources_registered']);
  assert.deepEqual(output.recommendations, ['Register the default chip support source before retrying chip support install.']);
  assert.equal(output.primary_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs support bootstrap');
});

test('applyOutputMode limits brief health checks to three non-info items when action_card exists', () => {
  const output = outputMode.applyOutputMode({
    command: 'health',
    status: 'warn',
    runtime_host: 'codex',
    summary: { pass: 10, warn: 4, fail: 0, info: 2 },
    checks: [
      { key: 'startup_automation', status: 'warn', summary: 'Startup automation is not ready yet' },
      { key: 'hardware_identity', status: 'warn', summary: 'hw.yaml does not contain the chip identity yet' },
      { key: 'chip_support_sources_registered', status: 'warn', summary: 'No chip support source is registered yet' },
      { key: 'subagent_bridge', status: 'info', summary: 'Host sub-agent bridge is not configured' },
      { key: 'project_root', status: 'pass', summary: 'Project root is accessible' }
    ],
    recommendations: [
      'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      'Register the default chip support source before retrying chip support install.'
    ],
    next_commands: [
      {
        key: 'support-source-add',
        cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-pack --type git --location https://github.com/Welkon/emb-agent-adapters.git'
      }
    ],
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Needs host action',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.'
    },
    quickstart: {
      stage: 'restart-host-for-bootstrap',
      display_stage: 'restart-host-for-bootstrap',
      user_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      steps: []
    }
  }, true);

  assert.equal(output.checks.length, 3);
  assert.ok(output.checks.every(item => item.status !== 'info'));
  assert.deepEqual(output.recommendations, ['Register the default chip support source before retrying chip support install.']);
  assert.equal(output.primary_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-pack --type git --location https://github.com/Welkon/emb-agent-adapters.git');
});

test('applyOutputMode skips recommendation owned by the active action stage when picking the brief main recommendation', () => {
  const output = outputMode.applyOutputMode({
    command: 'health',
    status: 'warn',
    runtime_host: 'codex',
    summary: { pass: 9, warn: 3, fail: 0, info: 0 },
    checks: [
      {
        key: 'startup_automation',
        status: 'warn',
        summary: 'Startup automation is not ready yet',
        recommendation: 'Restart the host once so emb-agent automatic startup can activate, then rerun health.'
      },
      {
        key: 'hardware_identity',
        status: 'warn',
        summary: 'hw.yaml does not contain the chip identity yet',
        recommendation: 'Record goals and constraints in .emb-agent/req.yaml first and leave .emb-agent/hw.yaml unknown until a real candidate exists.'
      }
    ],
    recommendations: [
      'Restart the host once so emb-agent automatic startup can activate, then rerun health.',
      'Record goals and constraints in .emb-agent/req.yaml first and leave .emb-agent/hw.yaml unknown until a real candidate exists.'
    ],
    next_commands: [],
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Needs host action',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      first_instruction: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.'
    },
    quickstart: {
      stage: 'restart-host-for-bootstrap',
      display_stage: 'restart-host-for-bootstrap',
      user_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      steps: []
    }
  }, true);

  assert.deepEqual(output.recommendations, [
    'Record goals and constraints in .emb-agent/req.yaml first and leave .emb-agent/hw.yaml unknown until a real candidate exists.'
  ]);
});

test('applyOutputMode builds brief bootstrap output', () => {
  const output = outputMode.applyOutputMode({
    command: 'bootstrap',
    status: 'manual',
    display_status: 'needs-user-input',
    summary: 'Restart the host once so emb-agent automatic startup is active',
    display_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
    current_stage: 'startup-hooks',
    display_current_stage: 'host-readiness',
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Needs host action',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Host session ready for automatic bootstrap',
      first_instruction: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      first_cli: '',
      then_cli: '',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health'
    },
    workspace_trust: {
      trusted: false,
      explicit: false,
      source: 'default',
      signal: 'untrusted-no-signal',
      summary: 'The current host session is not ready for automatic startup yet; automatic bootstrap steps stay paused by default'
    },
    next_stage: {
      id: 'startup-hooks',
      status: 'manual',
      display_id: 'host-readiness',
      display_status: 'needs-user-input',
      label: 'Host session ready for automatic bootstrap',
      action_summary: 'Needs host action',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      {
        id: 'startup-hooks',
        status: 'manual',
        display_id: 'host-readiness',
        display_status: 'needs-user-input',
        label: 'Host session ready for automatic bootstrap'
      }
    ],
    quickstart: {
      stage: 'restart-host-hooks',
      display_stage: 'restart-host-for-bootstrap',
      user_summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health',
      steps: []
    }
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.command, 'bootstrap');
  assert.equal(output.status, 'needs-user-input');
  assert.equal(output.current_stage, 'host-readiness');
  assert.equal('workspace_trust' in output, false);
  assert.equal(output.action_card.action, 'Needs host action');
  assert.equal(output.next_stage.id, 'host-readiness');
  assert.equal(output.next_stage.action_summary, 'Needs host action');
  assert.equal(output.stages.length, 2);
  assert.equal(output.quickstart.stage, 'restart-host-for-bootstrap');
  assert.equal(output.quickstart.summary, 'Startup hooks are not active in the current host session; restart the host once, then rerun health.');
});
