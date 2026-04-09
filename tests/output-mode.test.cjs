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
  assert.equal(output.context_hygiene.level, 'consider-clearing');
  assert.equal(output.next_actions.length, 5);
  assert.equal(output.tool_recommendation.tool, 'timer-calc');
});
