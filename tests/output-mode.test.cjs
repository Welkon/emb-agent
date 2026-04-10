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
      source: 'pause',
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
  assert.equal(output.memory_summary.last_files.length, 4);
  assert.equal(output.context_hygiene.level, 'consider-clearing');
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
