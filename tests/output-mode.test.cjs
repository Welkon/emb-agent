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
      profile: 'baremetal-loop',
      specs: ['sensor-node'],
      focus: 'bringup',
      last_command: 'scan',
      suggested_flow: 'capability run scan -> capability run do -> capability run verify'
    },
    next: {
      command: 'plan',
      reason: 'complex tasks should converge first',
      cli: 'node runtime/bin/emb-agent.cjs capability run plan',
      product_layer: {
        id: 'embedded_workflow',
        label: 'Embedded workflow',
        summary: 'Project truth and workflow closure.'
      },
      gated_by_health: false,
      capability_route: {
        capability: 'plan',
        category: 'workflow-action',
        route_strategy: 'capability-first',
        product_role: 'template-workflow-generator',
        generator_owner: 'emb-agent',
        repository_layout: 'generator-templates-plus-runtime',
        materialization_state: 'generator-addressable',
        host_targets: ['host-skill', 'workflow-spec'],
        primary_entry: {
          kind: 'capability',
          name: 'plan',
          cli: 'node runtime/bin/emb-agent.cjs capability run plan'
        },
        generated_surfaces: [
          { kind: 'host-skill', name: 'emb-plan', materialized: false, source: 'generator' }
        ]
      },
      tool_recommendation: {
        tool: 'timer-calc',
        status: 'ready',
        cli_draft: 'tool run timer-calc --target-us 500'
      },
      walkthrough_recommendation: {
        kind: 'peripheral-walkthrough',
        summary: 'walk every ready tool once',
        tool_count: 3,
        ordered_tools: ['timer-calc', 'pwm-calc', 'adc-scale'],
        first_tool: 'timer-calc',
        first_cli: 'tool run timer-calc --target-us 500',
        recommended_sequence: [
          {
            tool: 'timer-calc',
            status: 'ready',
            cli_draft: 'tool run timer-calc --target-us 500'
          },
          {
            tool: 'pwm-calc',
            status: 'ready',
            cli_draft: 'tool run pwm-calc --target-hz 1000'
          }
        ]
      }
    },
    product_layer: {
      id: 'embedded_workflow',
      label: 'Embedded workflow',
      summary: 'Project truth and workflow closure.'
    },
    task_convergence: {
      status: 'active-task',
      prd_path: '.emb-agent/tasks/timer-drift/prd.md',
      summary: 'Use the task PRD as the working contract.',
      prompts: [
        'What is the smallest durable outcome for this task?',
        'Which truth, hardware facts, or code entry points bound the change?'
      ],
      recommended_path: 'plan-first',
      recommended_reason: 'The task already has enough context to lock a micro-plan before execution.',
      next_cli: 'node runtime/bin/emb-agent.cjs capability run plan',
      then_cli: 'node runtime/bin/emb-agent.cjs capability run do'
    },
    workflow_stage: {
      name: 'planning',
      why: 'complex task',
      exit_criteria: 'plan has clear steps',
      primary_command: 'plan'
    },
    capability_route: {
      capability: 'plan',
      category: 'workflow-action',
      route_strategy: 'capability-first',
      product_role: 'template-workflow-generator',
      generator_owner: 'emb-agent',
      repository_layout: 'generator-templates-plus-runtime',
      materialization_state: 'generator-addressable',
      host_targets: ['host-skill', 'workflow-spec'],
      primary_entry: {
        kind: 'capability',
        name: 'plan',
        cli: 'node runtime/bin/emb-agent.cjs capability run plan'
      },
      generated_surfaces: [
        { kind: 'host-skill', name: 'emb-plan', materialized: false, source: 'generator' }
      ]
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
    recommended_flow: {
      id: 'doc-to-chip-support-analysis',
      mode: 'analysis-artifact-first',
      source_kind: 'hardware-document',
      summary: 'Stage document truth first, then derive support from analysis.',
      steps: [
        {
          id: 'support-analysis-init',
          kind: 'command',
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter analysis init --chip PMS150G --package SOP8',
          artifact_path: '.emb-agent/analysis/pms150g.json'
        },
        {
          id: 'agent-fill-analysis-artifact',
          kind: 'agent',
          recommended_agent: 'emb-hw-scout',
          artifact_path: '.emb-agent/analysis/pms150g.json'
        },
        {
          id: 'support-derive-from-analysis',
          kind: 'command',
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-analysis .emb-agent/analysis/pms150g.json',
          artifact_path: '.emb-agent/analysis/pms150g.json'
        }
      ]
    },
    handoff_protocol: {
      protocol: 'emb-agent.chip-support-analysis/1',
      source_kind: 'hardware-document',
      doc_id: 'doc_pms150g',
      artifact_path: '.emb-agent/analysis/pms150g.json',
      recommended_agent: 'emb-hw-scout',
      commands: {
        init: {
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter analysis init --chip PMS150G --package SOP8',
          argv: ['adapter', 'analysis', 'init', '--chip', 'PMS150G', '--package', 'SOP8']
        },
        derive: {
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-analysis .emb-agent/analysis/pms150g.json',
          argv: ['adapter', 'derive', '--from-analysis', '.emb-agent/analysis/pms150g.json']
        }
      },
      confirmation_targets: ['mcu.model', 'mcu.package', 'peripherals[]'],
      expected_output: ['family.json', 'device.json', 'chip.json']
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
    walkthrough_execution: {
      kind: 'peripheral-walkthrough',
      status: 'running',
      total_steps: 3,
      completed_count: 1,
      current_tool: 'pwm-calc',
      current_cli: 'tool run pwm-calc --target-hz 1000',
      last_tool: 'timer-calc',
      last_summary: 'Walkthrough step timer-calc completed.',
      completed_steps: ['timer-calc'],
      remaining_steps: ['pwm-calc', 'adc-scale']
    },
    health: {
      status: 'ok',
      summary: { score: 90 }
    }
  };

  const output = outputMode.applyOutputMode(input, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.next.command, 'plan');
  assert.equal(output.next.product_layer.id, 'embedded_workflow');
  assert.equal(output.next.product_layer.label, 'Embedded workflow');
  assert.equal(output.product_layer.id, 'embedded_workflow');
  assert.equal(output.product_layer.label, 'Embedded workflow');
  assert.equal(output.capability_route.capability, 'plan');
  assert.equal(output.capability_route.route_strategy, 'capability-first');
  assert.equal(output.capability_route.compatibility_command, undefined);
  assert.equal(output.workflow_stage.name, 'planning');
  assert.equal(output.operator_handoff.status, 'ready-to-run');
  assert.equal(output.operator_handoff.command, 'plan');
  assert.equal(output.operator_handoff.next_cli, 'node runtime/bin/emb-agent.cjs capability run plan');
  assert.equal(output.operator_handoff.then_cli, 'node runtime/bin/emb-agent.cjs capability run do');
  assert.match(output.operator_handoff.why, /complex tasks should converge first/);
  assert.match(output.operator_handoff.final_reply_rule, /exact next CLI/);
  assert.equal(output.task_convergence.recommended_path, 'plan-first');
  assert.equal(output.task_convergence.prd_path, '.emb-agent/tasks/timer-drift/prd.md');
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
  assert.equal(output.recommended_flow.id, 'doc-to-chip-support-analysis');
  assert.equal(output.recommended_flow.steps.length, 3);
  assert.equal(output.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');
  assert.equal(output.handoff_protocol.commands.init.argv.length, 6);
  assert.equal(output.tool_recommendation.tool, 'timer-calc');
  assert.equal(output.walkthrough_recommendation.kind, 'peripheral-walkthrough');
  assert.deepEqual(output.walkthrough_recommendation.ordered_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
  assert.equal(output.walkthrough_recommendation.recommended_sequence.length, 2);
  assert.equal(output.walkthrough_execution.status, 'running');
  assert.equal(output.walkthrough_execution.current_tool, 'pwm-calc');
  assert.deepEqual(output.walkthrough_execution.completed_steps, ['timer-calc']);
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
      default_package: 'app',
      active_package: 'fw',
      active_task: {
        name: 'adc-path',
        status: 'in_progress',
        package: 'fw'
      },
      hardware_identity: {
        vendor: 'SCMCU',
        model: 'SC8F072',
        package: 'SOP8'
      }
    },
    immediate: {
      command: 'task add <summary>',
      reason: 'The emb-agent project bootstrap already exists. Create and activate a task before execution.',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs task add <summary>'
    },
    task_intake: {
      status: 'ready',
      recommended_entry: 'task add <summary>',
      summary: 'Create a task and PRD first. Use scan when requirements, hardware truth, or the change surface are still unclear; use plan when the path is already explicit.',
      paths: [
        { id: 'known-change' },
        { id: 'unclear-scope' },
        { id: 'system-change' }
      ]
    },
    bootstrap: {
      status: 'ready-for-next',
      stage: 'continue-with-next',
      command: 'next',
      summary: 'Bootstrap is ready. Run next.'
    },
    runtime_events: [
      {
        type: 'workflow-start',
        category: 'workflow',
        status: 'ok',
        summary: 'The emb-agent project bootstrap already exists. Create and activate a task before execution.'
      }
    ],
    next: {
      command: 'scan',
      reason: 'Project definition is already closed.',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs capability run scan'
    }
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.entry, 'start');
  assert.equal(output.summary.default_package, 'app');
  assert.equal(output.summary.active_package, 'fw');
  assert.equal(output.summary.active_task.package, 'fw');
  assert.equal(output.immediate.command, 'task add <summary>');
  assert.equal(output.operator_handoff.command, 'task add <summary>');
  assert.equal(output.operator_handoff.next_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs task add <summary>');
  assert.match(output.operator_handoff.final_reply_rule, /raw tool output/);
  assert.equal(output.task_intake.status, 'ready');
  assert.equal(output.task_intake.recommended_entry, 'task add <summary>');
  assert.deepEqual(output.task_intake.modes, ['known-change', 'unclear-scope', 'system-change']);
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
    active_specs: [],
    developer: { name: 'welkon', runtime: 'external' },
    bootstrap: {
      status: 'needs-project-definition',
      stage: 'define-project-constraints',
      command: 'next',
      summary: 'Project definition is still required. Fill .emb-agent/req.yaml with the project type, intended inputs/outputs, interfaces, and constraints.'
    },
    runtime_events: [
      {
        type: 'workflow-start',
        category: 'workflow',
        status: 'pending',
        summary: 'Project definition is still required. Fill .emb-agent/req.yaml first.'
      }
    ]
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.initialized, true);
  assert.equal(output.bootstrap.command, 'next');
  assert.equal(output.runtime_events.status, 'pending');
  assert.equal(output.external_agent, undefined);
});

test('applyOutputMode keeps runtime event summaries compact for automation callers', () => {
  const output = outputMode.applyOutputMode({
    current: {
      profile: 'baremetal-loop',
      default_package: 'app',
      active_package: 'fw'
    },
    task: {
      name: 'adc-path',
      status: 'in_progress',
      package: 'fw'
    },
    next: {
      command: 'scan',
      reason: 'Project definition is still open.',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs capability run scan'
    },
    runtime_events: [
      {
        type: 'workflow-next',
        category: 'workflow',
        status: 'pending',
        summary: 'Project definition is still open.'
      }
    ],
    next_actions: []
  }, true);

  assert.equal(output.output_mode, 'brief');
  assert.equal(output.current.default_package, 'app');
  assert.equal(output.current.active_package, 'fw');
  assert.equal(output.task.package, 'fw');
  assert.equal(Array.isArray(output.runtime_events), false);
  assert.equal(output.runtime_events.status, 'pending');
  assert.equal(output.runtime_events.total, 1);
  assert.deepEqual(output.runtime_events.types, ['workflow-next']);
  assert.equal(output.runtime_events[0], undefined);
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
    project_profile: 'baremetal-loop',
    default_package: 'app',
    active_package: 'fw',
    capability_route: {
      capability: 'status',
      category: 'runtime-surface',
      route_strategy: 'command-first',
      product_role: 'template-workflow-generator',
      generator_owner: 'emb-agent',
      repository_layout: 'generator-templates-plus-runtime',
      materialization_state: 'runtime-native',
      host_targets: ['runtime-command'],
      primary_entry: {
        kind: 'command',
        name: 'status',
        cli: 'node runtime/bin/emb-agent.cjs status'
      }
    },
    next_action: {
      command: 'plan',
      reason: 'complex task',
      cli: 'node runtime/bin/emb-agent.cjs capability run plan'
    },
    next_capability_route: {
      capability: 'plan',
      category: 'workflow-action',
      route_strategy: 'capability-first',
      product_role: 'template-workflow-generator',
      generator_owner: 'emb-agent',
      repository_layout: 'generator-templates-plus-runtime',
      materialization_state: 'generator-addressable',
      host_targets: ['host-skill', 'workflow-spec'],
      primary_entry: {
        kind: 'capability',
        name: 'plan',
        cli: 'node runtime/bin/emb-agent.cjs capability run plan'
      }
    },
    active_task: {
      name: 'adc-path',
      status: 'in_progress',
      package: 'fw'
    },
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

  assert.equal(statusOutput.default_package, 'app');
  assert.equal(statusOutput.active_package, 'fw');
  assert.equal(statusOutput.active_task.package, 'fw');

  const dispatchOutput = outputMode.applyOutputMode({
    requested_action: 'next',
    resolved_action: 'plan',
    reason: 'complex task',
    capability_route: {
      capability: 'plan',
      category: 'workflow-action',
      route_strategy: 'capability-first',
      product_role: 'template-workflow-generator',
      generator_owner: 'emb-agent',
      repository_layout: 'generator-templates-plus-runtime',
      materialization_state: 'generator-addressable',
      host_targets: ['host-skill', 'workflow-spec'],
      primary_entry: {
        kind: 'capability',
        name: 'plan',
        cli: 'node runtime/bin/emb-agent.cjs capability run plan'
      }
    },
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
  assert.equal(statusOutput.capability_route.capability, 'status');
  assert.equal(statusOutput.next_action.command, 'plan');
  assert.equal(statusOutput.next_capability_route.capability, 'plan');
  assert.deepEqual(statusOutput.delegation_runtime.worker_results, ['emb-hw-scout:ok']);
  assert.equal(statusOutput.delegation_runtime.review.stage_a, 'passed');
  assert.equal(statusOutput.delegation_runtime.review.stage_b, 'main-thread-review-required');
  assert.equal(dispatchOutput.subagent_bridge.status, 'ok');
  assert.equal(dispatchOutput.delegation_runtime.synthesis.status, 'ready');
  assert.equal(dispatchOutput.delegation_runtime.review.redispatch_required, false);
  assert.equal(dispatchOutput.runtime_events.status, 'pending');
  assert.equal(dispatchOutput.capability_route.capability, 'plan');
});

test('applyOutputMode omits external driver summary in brief status output', () => {
  const output = outputMode.applyOutputMode({
    session_version: 1,
    runtime_host: 'external',
    project_root: '/tmp/demo',
    project_profile: 'baremetal-loop',
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
      summary: 'Host startup automation is explicitly disabled by environment override.'
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
      action: 'Host action required',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Enable host startup hooks',
      first_instruction: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      first_cli: '',
      then_cli: '',
      followup: 'After restarting the host, rerun: node ~/.codex/emb-agent/bin/emb-agent.cjs health'
    },
    recommended_flow: {
      id: 'doc-to-chip-support-analysis',
      mode: 'analysis-artifact-first',
      steps: [
        {
          id: 'support-analysis-init',
          kind: 'command',
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter analysis init --chip PMS150G --package SOP8',
          artifact_path: '.emb-agent/analysis/pms150g.json'
        }
      ]
    },
    handoff_protocol: {
      protocol: 'emb-agent.chip-support-analysis/1',
      artifact_path: '.emb-agent/analysis/pms150g.json',
      recommended_agent: 'emb-hw-scout',
      commands: {
        derive: {
          cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs adapter derive --from-analysis .emb-agent/analysis/pms150g.json',
          argv: ['adapter', 'derive', '--from-analysis', '.emb-agent/analysis/pms150g.json']
        }
      }
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
      action: 'Host action required',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Enable host startup hooks',
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
      summary: 'Host startup automation is explicitly disabled by environment override.'
    },
    next_stage: {
      id: 'startup-hooks',
      status: 'manual',
      display_id: 'host-readiness',
      display_status: 'needs-user-input',
      label: 'Enable host startup hooks',
      action_summary: 'Host action required',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      {
        id: 'startup-hooks',
        status: 'manual',
        display_id: 'host-readiness',
        display_status: 'needs-user-input',
        label: 'Enable host startup hooks',
        action_summary: 'Host action required'
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
  assert.equal(healthOutput.action_card.action, 'Host action required');
  assert.match(healthOutput.action_card.first_instruction, /Startup hooks are not active/);
  assert.deepEqual(healthOutput.checks.map(item => item.key), ['startup_automation']);
  assert.deepEqual(healthOutput.recommendations, ['Configure EMB_AGENT_SUBAGENT_BRIDGE_CMD if you want dispatch/orchestrate to launch host sub-agents automatically.']);
  assert.equal('primary_cli' in healthOutput, false);
  assert.equal(healthOutput.recommended_flow.id, 'doc-to-chip-support-analysis');
  assert.equal(healthOutput.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');
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
        cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-support --type git --location https://github.com/Welkon/emb-support.git'
      }
    ],
    action_card: {
      status: 'ready-to-run',
      stage: 'chip-support',
      action: 'Ready to run',
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
        cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-support --type git --location https://github.com/Welkon/emb-support.git'
      }
    ],
    action_card: {
      status: 'needs-user-input',
      stage: 'host-readiness',
      action: 'Host action required',
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
  assert.equal(output.primary_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs support source add default-support --type git --location https://github.com/Welkon/emb-support.git');
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
      action: 'Host action required',
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
      action: 'Host action required',
      summary: 'Startup hooks are not active in the current host session; restart the host once, then rerun health.',
      reason: 'Enable host startup hooks',
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
      summary: 'Host startup automation is not ready yet. Automatic bootstrap stays paused by default.'
    },
    next_stage: {
      id: 'startup-hooks',
      status: 'manual',
      display_id: 'host-readiness',
      display_status: 'needs-user-input',
      label: 'Enable host startup hooks',
      action_summary: 'Host action required',
      cli: ''
    },
    stages: [
      { id: 'init-project', status: 'completed', label: 'Initialize emb-agent project skeleton' },
      {
        id: 'startup-hooks',
        status: 'manual',
        display_id: 'host-readiness',
        display_status: 'needs-user-input',
        label: 'Enable host startup hooks'
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
  assert.equal(output.action_card.action, 'Host action required');
  assert.equal(output.next_stage.id, 'host-readiness');
  assert.equal(output.next_stage.action_summary, 'Host action required');
  assert.equal(output.stages.length, 2);
  assert.equal(output.quickstart.stage, 'restart-host-for-bootstrap');
  assert.equal(output.quickstart.summary, 'Startup hooks are not active in the current host session; restart the host once, then rerun health.');
});
