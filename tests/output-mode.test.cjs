'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputMode = require(path.join(repoRoot, 'runtime', 'lib', 'output-mode.cjs'));

test('parseOutputModeArgs supports next --brief and keeps tool-local --brief', () => {
  const next = outputMode.parseOutputModeArgs(['next', '--brief']);
  assert.equal(next.brief, true);
  assert.deepEqual(next.args, ['next']);

  const toolLocal = outputMode.parseOutputModeArgs(['tool', 'run', 'timer-calc', '--brief']);
  assert.equal(toolLocal.brief, false);
  assert.deepEqual(toolLocal.args, ['tool', 'run', 'timer-calc', '--brief']);

  const mixed = outputMode.parseOutputModeArgs(['--brief', 'tool', 'run', 'timer-calc', '--brief']);
  assert.equal(mixed.brief, true);
  assert.deepEqual(mixed.args, ['tool', 'run', 'timer-calc', '--brief']);
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
});

test('applyOutputMode builds brief tool output with permission gates', () => {
  const input = {
    tool: 'timer-calc',
    status: 'adapter-required',
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
      integration: { status: 'completed-inline', owner: 'Current main thread', execution_kind: 'action' }
    }
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
      integration: { status: 'completed-inline', owner: 'Current main thread', execution_kind: 'action' }
    }
  }, true);

  assert.equal(statusOutput.runtime_host, 'codex');
  assert.equal(statusOutput.subagent_bridge.mode, 'mock');
  assert.equal(statusOutput.delegation_runtime.pattern, 'coordinator');
  assert.deepEqual(statusOutput.delegation_runtime.worker_results, ['emb-hw-scout:ok']);
  assert.equal(dispatchOutput.subagent_bridge.status, 'ok');
  assert.equal(dispatchOutput.delegation_runtime.synthesis.status, 'ready');
});

test('applyOutputMode keeps workspace trust in brief health/bootstrap outputs', () => {
  const healthOutput = outputMode.applyOutputMode({
    command: 'health',
    status: 'warn',
    runtime_host: 'codex',
    workspace_trust: {
      trusted: false,
      explicit: true,
      source: 'env',
      signal: 'untrusted',
      summary: 'Workspace trust is explicitly disabled by environment override'
    },
    summary: { pass: 3, warn: 1, fail: 0, info: 0 },
    checks: [],
    recommendations: [],
    next_commands: [],
    quickstart: {
      followup: 'Grant workspace trust first',
      steps: []
    }
  }, true);

  const bootstrapOutput = outputMode.applyOutputMode({
    command: 'bootstrap',
    status: 'manual',
    summary: 'Grant workspace trust first',
    current_stage: 'workspace-trust',
    workspace_trust: {
      trusted: false,
      explicit: true,
      source: 'env',
      signal: 'untrusted',
      summary: 'Workspace trust is explicitly disabled by environment override'
    },
    next_stage: {
      id: 'workspace-trust',
      status: 'manual',
      label: 'Establish workspace trust',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      { id: 'workspace-trust', status: 'manual', label: 'Establish workspace trust' }
    ],
    quickstart: {
      stage: 'establish-workspace-trust',
      followup: 'Grant workspace trust in the host/runtime first, then rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health',
      steps: [
        {
          label: 'Establish workspace trust',
          cli: ''
        }
      ]
    }
  }, true);

  assert.equal(healthOutput.workspace_trust.trusted, false);
  assert.equal(healthOutput.workspace_trust.source, 'env');
  assert.equal(bootstrapOutput.workspace_trust.signal, 'untrusted');
  assert.equal(bootstrapOutput.current_stage, 'workspace-trust');
});

test('applyOutputMode builds brief bootstrap output', () => {
  const output = outputMode.applyOutputMode({
    command: 'bootstrap',
    status: 'manual',
    summary: 'Grant workspace trust first',
    current_stage: 'workspace-trust',
    workspace_trust: {
      trusted: false,
      explicit: false,
      source: 'default',
      signal: 'untrusted-no-signal',
      summary: 'No explicit workspace trust signal was provided; runtime treats the workspace as untrusted by default'
    },
    next_stage: {
      id: 'workspace-trust',
      status: 'manual',
      label: 'Establish workspace trust',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      {
        id: 'workspace-trust',
        status: 'manual',
        label: 'Establish workspace trust'
      }
    ],
    quickstart: {
      stage: 'establish-workspace-trust',
      followup: 'Grant workspace trust in the host/runtime first, then rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health',
      steps: [
        {
          label: 'Establish workspace trust',
          cli: ''
        }
      ]
    }
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.command, 'bootstrap');
  assert.equal(output.current_stage, 'workspace-trust');
  assert.equal(output.workspace_trust.trusted, false);
  assert.equal(output.next_stage.id, 'workspace-trust');
  assert.equal(output.stages.length, 2);
  assert.equal(output.quickstart.stage, 'establish-workspace-trust');
});
