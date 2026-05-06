'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const subAgentRuntimeHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'sub-agent-runtime.cjs'));

function buildHelpers(overrides = {}) {
  const runtimeImpl = overrides.runtime || {
    ensureDir() {}
  };
  const runtimeHostImpl = overrides.runtimeHost || (() => ({
    name: 'codex',
    label: 'Codex',
    subagentBridge: {
      available: false,
      source: 'none',
      mode: '',
      command: '',
      command_argv: []
    }
  }));

  return subAgentRuntimeHelpers.createSubAgentRuntimeHelpers({
    fs,
    path,
    process,
    childProcess,
    runtimeHost: runtimeHostImpl,
    runtime: runtimeImpl,
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
    getProjectStatePaths: overrides.getProjectStatePaths || (() => ({
      stateDir: os.tmpdir(),
      projectKey: 'sub-agent-runtime-test'
    })),
    ensureProjectStateStorage: overrides.ensureProjectStateStorage
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

test('sub-agent runtime falls back for delegation job state when primary storage is read-only', () => {
  const primaryStateDir = path.join(os.tmpdir(), 'emb-agent-subagent-primary-state');
  const fallbackStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-subagent-fallback-'));
  const created = [];
  const helpers = buildHelpers({
    runtimeHost: () => ({
      name: 'codex',
      label: 'Codex',
      subagentBridge: {
        available: true,
        source: 'test',
        mode: 'mock',
        command: 'mock',
        command_argv: ['mock']
      }
    }),
    runtime: {
      ensureDir(dirPath) {
        if (String(dirPath).startsWith(primaryStateDir)) {
          const error = new Error('read-only primary state');
          error.code = 'EROFS';
          throw error;
        }
        created.push(dirPath);
        fs.mkdirSync(dirPath, { recursive: true });
      }
    },
    getProjectStatePaths: () => ({
      stateDir: primaryStateDir,
      fallbackStateDir,
      projectKey: 'sub-agent-runtime-test'
    })
  });

  const result = helpers.runSubAgentBridge({
    workflow: {
      strategy: 'primary-first'
    },
    dispatch_contract: {
      primary: {
        agent: 'emb-hw-scout',
        delegation_phase: 'research',
        purpose: 'Check hardware evidence',
        tool_scope: {
          allows_write: false
        }
      }
    }
  }, {}, { wait: false });

  assert.equal(result.bridge.status, 'launched');
  assert.equal(result.jobs.length, 1);
  assert.match(result.jobs[0].job_file, new RegExp(path.basename(fallbackStateDir)));
  assert.ok(created.some(item => item.includes(path.join('delegation-jobs', 'sub-agent-runtime-test'))));
});
