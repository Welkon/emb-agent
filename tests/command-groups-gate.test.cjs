'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const capabilityRuntimeHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'capability-runtime.cjs'));

function createHelpers(overrides = {}) {
  const calls = {
    buildActionOutput: [],
    updateSession: 0
  };

  const deps = {
    updateSession() {
      calls.updateSession += 1;
    },
    buildNextContext() {
      return {
        next: {
          command: 'scan',
          gated_by_health: false
        }
      };
    },
    buildStartContext() {
      return {
        immediate: {
          command: 'next'
        }
      };
    },
    buildActionOutput(action) {
      calls.buildActionOutput.push(action);
      return {
        entry: action,
        workflow_stage: {
          name: action
        },
        action_card: {
          status: 'ready-to-run',
          action: `run-${action}`
        },
        next_actions: [`command=${action}`],
        permission_gates: []
      };
    },
    buildReviewContext() {
      return {};
    },
    buildArchReviewContext() {
      return {};
    },
    buildStatus() {
      return {};
    },
    getActiveTask() {
      return null;
    },
    handleCatalogAndStateCommands() {
      return undefined;
    },
    capabilityMaterializer: {
      buildMaterializationPlan() {
        return null;
      }
    }
  };

  const helpers = capabilityRuntimeHelpers.createCapabilityRuntimeHelpers({
    ...deps,
    ...overrides
  });

  return {
    helpers,
    calls
  };
}

test('scan is blocked by health closure when next is health-gated', () => {
  const nextContext = {
    next: {
      command: 'health',
      gated_by_health: true,
      reason: 'Detected hardware inputs still need source intake.'
    },
    workflow_stage: {
      name: 'health-gate'
    },
    action_card: {
      status: 'blocked-by-health',
      first_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs ingest schematic --file docs/board.SchDoc'
    },
    next_actions: ['health_command=node ~/.codex/emb-agent/bin/emb-agent.cjs health']
  };
  const { helpers, calls } = createHelpers({
    buildNextContext() {
      return nextContext;
    }
  });

  const result = helpers.executeCapability('scan');

  assert.deepEqual(calls.buildActionOutput, ['health']);
  assert.equal(calls.updateSession, 1);
  assert.equal(result.blocked_action, 'scan');
  assert.equal(result.action_card.status, 'blocked-by-health');
  assert.equal(result.workflow_stage.name, 'health-gate');
  assert.match(result.action_card.first_cli, /ingest schematic --file docs\/board\.SchDoc/);
});

test('do keeps health closure ahead of missing task intake', () => {
  const nextContext = {
    next: {
      command: 'health',
      gated_by_health: true
    },
    workflow_stage: {
      name: 'health-gate'
    },
    action_card: {
      status: 'blocked-by-health',
      first_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs health'
    },
    next_actions: ['health_command=node ~/.codex/emb-agent/bin/emb-agent.cjs health']
  };
  const { helpers, calls } = createHelpers({
    buildNextContext() {
      return nextContext;
    }
  });

  const result = helpers.executeCapability('do');

  assert.deepEqual(calls.buildActionOutput, ['health']);
  assert.equal(calls.updateSession, 1);
  assert.equal(result.blocked_action, 'do');
  assert.equal(result.action_card.status, 'blocked-by-health');
});

test('scan is blocked by task intake once bootstrap is already ready', () => {
  const { helpers, calls } = createHelpers({
    buildStartContext() {
      return {
        immediate: {
          command: 'task add <summary>'
        }
      };
    }
  });

  const result = helpers.executeCapability('scan');

  assert.deepEqual(calls.buildActionOutput, ['scan']);
  assert.equal(calls.updateSession, 1);
  assert.equal(result.action_card.status, 'blocked-by-task-intake');
  assert.match(result.action_card.first_cli, /task add <summary>/);
  assert.match(result.action_card.then_cli, /task activate <name>/);
});
