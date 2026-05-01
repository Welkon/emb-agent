'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workflowState = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-state.cjs'));

test('workflow state reaches datasheet_ingested before bootstrap is ready', () => {
  const state = workflowState.resolveWorkflowState(
    {
      chip: 'sc8f072',
      package: 'sop8',
      datasheets: ['docs/SC8F072.pdf']
    },
    null,
    { bootstrapReady: false }
  );

  const next = workflowState.getWorkflowNext(state);

  assert.equal(state, 'datasheet_ingested');
  assert.equal(next.command, 'bootstrap run --confirm');
  assert.match(next.reason, /Datasheet ingested/);
});

test('workflow state moves to bootstrap_ready only after bootstrap is ready', () => {
  const state = workflowState.resolveWorkflowState(
    {
      chip: 'sc8f072',
      package: 'sop8',
      datasheets: ['docs/SC8F072.pdf']
    },
    null,
    { bootstrapReady: true }
  );

  assert.equal(state, 'bootstrap_ready');
  assert.equal(workflowState.getWorkflowNext(state).command, 'next');
});

test('workflow state does not treat pending bootstrap run as ready', () => {
  const hwConfig = {
    chip: 'sc8f072',
    package: 'sop8',
    datasheets: ['docs/SC8F072.pdf']
  };

  assert.equal(
    workflowState.resolveWorkflowState(hwConfig, null, {
      bootstrap: {
        status: 'ready-for-next',
        stage: 'bootstrap-chip-support',
        command: 'bootstrap run --confirm'
      }
    }),
    'datasheet_ingested'
  );

  assert.equal(
    workflowState.resolveWorkflowState(hwConfig, null, {
      bootstrap: {
        status: 'ready-for-next',
        stage: 'continue-with-next',
        command: 'next'
      }
    }),
    'bootstrap_ready'
  );
});

test('workflow state uses the same task status mapping for hook callers', () => {
  const hwConfig = {
    chip: 'sc8f072',
    package: 'sop8',
    datasheets: ['docs/SC8F072.pdf']
  };
  const options = { bootstrapReady: true };

  assert.equal(workflowState.resolveWorkflowState(hwConfig, { status: 'in_progress' }, options), 'implementing');
  assert.equal(workflowState.resolveWorkflowState(hwConfig, { status: 'review' }, options), 'board_verified');
  assert.equal(workflowState.resolveWorkflowState(hwConfig, { status: 'completed' }, options), 'resolved');
  assert.equal(workflowState.resolveWorkflowState(hwConfig, { status: 'rejected' }, options), 'resolved');
});
