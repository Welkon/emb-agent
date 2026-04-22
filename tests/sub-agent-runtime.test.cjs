'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const subAgentRuntimeHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'sub-agent-runtime.cjs'));

function buildHelpers() {
  return subAgentRuntimeHelpers.createSubAgentRuntimeHelpers({
    fs,
    path,
    process,
    childProcess,
    runtimeHost: () => ({
      name: 'codex',
      label: 'Codex',
      subagentBridge: {
        available: false,
        source: 'none',
        mode: '',
        command: '',
        command_argv: []
      }
    }),
    runtime: {
      ensureDir() {}
    },
    resolveSession: () => ({
      session: {
        project_root: '/tmp/example',
        focus: 'review irq and timer path',
        active_specs: ['sensor-node']
      }
    }),
    loadMarkdown: () => ({
      name: 'emb-hw-scout',
      path: 'agents/emb-hw-scout.md',
      content: '# emb-hw-scout\n\n- Read only.\n'
    }),
    AGENTS_DIR: path.join(os.tmpdir(), 'emb-agent-test-agents'),
    getProjectStatePaths: () => ({
      stateDir: os.tmpdir(),
      projectKey: 'sub-agent-runtime-test'
    })
  });
}

test('sub-agent runtime injects worker contract into prompt and launch envelope', () => {
  const helpers = buildHelpers();
  const request = {
    agent: 'emb-hw-scout',
    role: 'primary',
    delegation_phase: 'research',
    context_mode: 'fresh-self-contained',
    purpose: 'Lock hardware truth and timing constraints',
    ownership: 'Own only fact-finding and do not implement code changes',
    expected_output: ['List hardware truth sources and explicit conclusions'],
    tool_scope: {
      role_profile: 'research',
      allows_write: false,
      allows_delegate: false,
      allows_background_work: false,
      preferred_tools: ['read', 'search', 'inspect'],
      disallowed_tools: ['spawn']
    },
    context_bundle: {
      truth_sources: ['Hardware truth sources: .emb-agent/hw.yaml', 'docs/MCU-FOUNDATION-CHECKLIST.md'],
      last_files: ['src/main.c'],
      suggested_steps: ['Read docs/MCU-FOUNDATION-CHECKLIST.md first']
    },
    worker_contract: {
      goal: 'Confirm hardware identity from repository truth and return only research findings.',
      inputs: ['.emb-agent/hw.yaml', 'docs/MCU-FOUNDATION-CHECKLIST.md', 'src/main.c'],
      outputs: ['stdout: compact worker_result JSON only'],
      forbidden_zones: ['Any repository file write or mutation', 'Recursive delegation'],
      acceptance_criteria: ['Return a compact JSON object matching the Output Contract in this prompt']
    }
  };
  const context = {
    requested_action: 'plan',
    resolved_action: 'plan',
    dispatch_contract: {
      pattern_constraints: {
        verification_requires_fresh_context: true
      }
    }
  };

  const prompt = helpers.buildWorkerPrompt(context, request, {
    name: 'emb-hw-scout',
    path: 'agents/emb-hw-scout.md',
    content: '# emb-hw-scout\n\n- Read only.\n'
  });
  const envelope = helpers.buildLaunchEnvelope(context, request);

  assert.match(prompt, /## Worker Contract/);
  assert.match(prompt, /### Goal/);
  assert.match(prompt, /### Inputs/);
  assert.match(prompt, /### Outputs/);
  assert.match(prompt, /### Forbidden Zones/);
  assert.match(prompt, /### Acceptance Criteria/);
  assert.match(prompt, /Do not change the worker contract\. If it is wrong, fail fast instead of rewriting it\./);
  assert.equal(envelope.worker.worker_contract.goal, request.worker_contract.goal);
  assert.deepEqual(envelope.worker.worker_contract.inputs, request.worker_contract.inputs);
  assert.deepEqual(envelope.worker.worker_contract.outputs, request.worker_contract.outputs);
  assert.deepEqual(envelope.worker.worker_contract.forbidden_zones, request.worker_contract.forbidden_zones);
  assert.deepEqual(envelope.worker.worker_contract.acceptance_criteria, request.worker_contract.acceptance_criteria);
});
