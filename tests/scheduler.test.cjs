'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const scheduler = require(path.join(repoRoot, 'runtime', 'lib', 'scheduler.cjs'));

const REVIEW_AGENT_NAMES = ['hw-scout', 'bug-hunter', 'sys-reviewer', 'release-checker'];

function loadProfile(name) {
  return runtime.validateProfile(
    name,
    runtime.parseSimpleYaml(path.join(repoRoot, 'runtime', 'profiles', `${name}.yaml`))
  );
}

function loadPack(name) {
  return runtime.validatePack(
    name,
    runtime.parseSimpleYaml(path.join(repoRoot, 'runtime', 'packs', `${name}.yaml`))
  );
}

function buildResolved(profileName, packNames, sessionOverrides = {}) {
  const profile = loadProfile(profileName);
  const packs = packNames.map(loadPack);
  const agents = runtime.unique([
    ...(profile.default_agents || []),
    ...packs.flatMap(pack => pack.default_agents || [])
  ]);
  const reviewAgents = runtime.unique(agents.filter(name => REVIEW_AGENT_NAMES.includes(name)));

  return {
    session: {
      project_root: '/tmp/example',
      project_name: 'example',
      project_profile: profile.name,
      active_packs: packNames,
      focus: '',
      last_files: [],
      open_questions: [],
      known_risks: [],
      ...sessionOverrides
    },
    profile,
    packs,
    effective: {
      agents,
      review_agents: reviewAgents,
      focus_areas: runtime.unique(packs.flatMap(pack => pack.focus_areas || [])),
      review_axes: runtime.unique([
        ...(profile.review_axes || []),
        ...packs.flatMap(pack => pack.extra_review_axes || [])
      ]),
      note_targets: runtime.unique([
        ...(profile.notes_targets || []),
        ...packs.flatMap(pack => pack.preferred_notes || [])
      ]),
      search_priority: profile.search_priority || [],
      guardrails: profile.guardrails || [],
      resource_priority: profile.resource_priority || []
    }
  };
}

test('baremetal sensor profile routes scan plan debug do to lightweight agents', () => {
  const resolved = buildResolved('baremetal-8bit', ['sensor-node']);

  const scan = scheduler.buildScanOutput(resolved);
  const plan = scheduler.buildPlanOutput(resolved);
  const debug = scheduler.buildDebugOutput(resolved);
  const verify = scheduler.buildVerifyOutput(resolved);
  const action = scheduler.buildDoOutput(resolved);

  assert.equal(scan.scheduler.primary_agent, 'hw-scout');
  assert.equal(scan.scheduler.agent_execution.primary_agent, 'emb-hw-scout');
  assert.equal(scan.scheduler.agent_execution.mode, 'inline-preferred');
  assert.ok(scan.next_reads.some(item => item.includes('Hardware truth sources')));
  assert.equal(plan.scheduler.primary_agent, 'hw-scout');
  assert.equal(plan.scheduler.agent_execution.mode, 'primary-recommended');
  assert.ok(plan.scheduler.agent_execution.calls.some(item => item.agent === 'emb-fw-doer'));
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.auto_invoke_when_recommended, true);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.delegation_pattern, 'coordinator');
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.pattern_constraints.max_depth, 1);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.pattern_constraints.workers_may_delegate, false);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.synthesis_required, true);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.synthesis_contract.rule, 'Synthesize, do not delegate understanding');
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.agent, 'emb-hw-scout');
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.context_mode, 'fresh-self-contained');
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.tool_scope.allows_delegate, false);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'explorer');
  assert.match(plan.scheduler.agent_execution.dispatch_contract.primary.spawn_fallback.instructions_source_cli, /agents show emb-hw-scout/);
  assert.ok(plan.scheduler.agent_execution.dispatch_contract.primary.context_bundle.truth_sources.length > 0);
  assert.ok(plan.constraints.some(item => item.includes('ISR thin')));
  assert.ok(plan.verification.some(item => item.includes('timing windows')));
  assert.ok(debug.hypotheses.some(item => item.includes('ISR')));
  assert.equal(verify.scheduler.primary_agent, 'hw-scout');
  assert.ok(verify.checklist.some(item => item.includes('register')));
  assert.ok(verify.result_template.some(item => item.includes('PASS')));
  assert.equal(verify.quality_gates.gate_status, 'not-configured');
  assert.equal(debug.scheduler.agent_execution.primary_agent, 'emb-bug-hunter');
  assert.equal(action.chosen_agent, 'fw-doer');
  assert.ok(action.prerequisites.includes('Add a minimal scan first to confirm the real change point'));
  assert.ok(action.scheduler.supporting_agents.includes('hw-scout'));
  assert.equal(action.scheduler.agent_execution.mode, 'inline-preferred');
});

test('rtos connected profile routes review note to system and release aware outputs', () => {
  const resolved = buildResolved('rtos-iot', ['connected-appliance'], {
    focus: 'review ota and reconnect path',
    last_files: ['src/net/ota.c'],
    known_risks: ['rollback path not verified']
  });

  const plan = scheduler.buildPlanOutput(resolved);
  const review = scheduler.buildReviewOutput(resolved);
  const verify = scheduler.buildVerifyOutput(resolved);
  const note = scheduler.buildNoteOutput(resolved);

  assert.equal(plan.scheduler.primary_agent, 'sys-reviewer');
  assert.equal(plan.scheduler.agent_execution.primary_agent, 'emb-sys-reviewer');
  assert.equal(plan.scheduler.agent_execution.mode, 'parallel-recommended');
  assert.ok(plan.scheduler.agent_execution.supporting_agents.includes('emb-release-checker'));
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary_first, false);
  assert.ok(plan.scheduler.agent_execution.dispatch_contract.parallel_safe.includes('emb-release-checker'));
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.delegation_pattern, 'coordinator');
  assert.ok(plan.scheduler.agent_execution.dispatch_contract.phases.some(item => item.id === 'synthesis'));
  assert.equal(plan.goal, 'review ota and reconnect path');
  assert.ok(plan.risks.includes('rollback path not verified'));
  assert.ok(plan.verification.some(item => item.includes('upgrade recovery')));
  assert.equal(review.scheduler.primary_agent, 'sys-reviewer');
  assert.equal(review.scheduler.agent_execution.mode, 'parallel-recommended');
  assert.ok(review.scheduler.agent_execution.calls.some(item => item.agent === 'emb-release-checker'));
  assert.ok(review.scheduler.agent_execution.dispatch_contract.supporting.some(item => item.agent === 'emb-release-checker'));
  assert.ok(review.scheduler.agent_execution.dispatch_contract.supporting.every(item => item.tool_scope.allows_delegate === false));
  assert.ok(review.scheduler.agent_execution.dispatch_contract.supporting.some(item => item.spawn_fallback.fallback_agent_type === 'explorer'));
  assert.ok(review.review_agents.includes('release-checker'));
  assert.ok(review.required_checks.some(item => item.includes('offline defaults')));
  assert.equal(verify.scheduler.primary_agent, 'release-checker');
  assert.ok(verify.checklist.some(item => item.includes('rollback paths')));
  assert.ok(verify.verification_focus.includes('connectivity-recovery'));
  assert.equal(verify.quality_gates.gate_status, 'not-configured');
  assert.ok(note.target_docs.includes('docs/CONNECTIVITY.md'));
  assert.ok(note.target_docs.includes('docs/RELEASE-NOTES.md'));
  assert.equal(note.chosen_agent, 'fw-doer');
});

test('verify output summarizes configured quality gates', () => {
  const resolved = buildResolved('baremetal-8bit', ['sensor-node'], {
    diagnostics: {
      latest_executor: {
        name: 'bench',
        status: 'failed',
        exit_code: 2
      },
      executor_history: {
        build: {
          name: 'build',
          status: 'ok',
          exit_code: 0
        },
        bench: {
          name: 'bench',
          status: 'failed',
          exit_code: 2
        }
      }
    }
  });

  resolved.project_config = {
    quality_gates: {
      required_executors: ['build', 'bench', 'flash'],
      required_signoffs: ['board-bench', 'thermal-check']
    }
  };
  resolved.session.diagnostics.human_signoffs = {
    'board-bench': {
      name: 'board-bench',
      status: 'confirmed',
      confirmed_at: '2026-04-09T10:00:00.000Z',
      note: 'engineer confirmed on board'
    }
  };

  const verify = scheduler.buildVerifyOutput(resolved);

  assert.equal(verify.quality_gates.gate_status, 'failed');
  assert.match(verify.quality_gates.status_summary, /Executor gates failed: bench/);
  assert.deepEqual(verify.quality_gates.passed_gates, ['build']);
  assert.deepEqual(verify.quality_gates.failed_gates, ['bench']);
  assert.deepEqual(verify.quality_gates.pending_gates, ['flash']);
  assert.deepEqual(verify.quality_gates.confirmed_signoffs, ['board-bench']);
  assert.deepEqual(verify.quality_gates.pending_signoffs, ['thermal-check']);
  assert.ok(verify.quality_gates.recommended_runs.includes('executor run bench'));
  assert.ok(verify.quality_gates.recommended_runs.includes('executor run flash'));
  assert.ok(verify.quality_gates.recommended_signoffs.includes('verify confirm thermal-check'));
  assert.ok(verify.checklist.some(item => item.includes('Quality gate executor "build"')));
  assert.ok(verify.checklist.some(item => item.includes('Human signoff "board-bench"')));
  assert.match(verify.closure_status, /Executor gates failed: bench/);
});

test('preferences can switch truth source ordering and strict verification', () => {
  const resolved = buildResolved('baremetal-8bit', ['sensor-node'], {
    last_files: ['main.c'],
    preferences: {
      truth_source_mode: 'code_first',
      plan_mode: 'auto',
      review_mode: 'auto',
      verification_mode: 'strict'
    }
  });

  const plan = scheduler.buildPlanOutput(resolved);

  assert.equal(plan.truth_sources[0], 'Most relevant file: main.c');
  assert.ok(plan.verification.some(item => item.includes('failure paths')));
});

test('project truth files are preferred when present', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-truth-'));
  const embDir = path.join(tempProject, '.emb-agent');
  fs.mkdirSync(embDir, { recursive: true });
  fs.writeFileSync(path.join(embDir, 'hw.yaml'), 'mcu:\n  model: test\n', 'utf8');
  fs.writeFileSync(path.join(embDir, 'req.yaml'), 'goals:\n  - test\n', 'utf8');

  const resolved = buildResolved('baremetal-8bit', ['sensor-node'], {
    project_root: tempProject,
    last_files: ['main.c']
  });

  const scan = scheduler.buildScanOutput(resolved);
  const plan = scheduler.buildPlanOutput(resolved);

  assert.equal(scan.relevant_files[0], '.emb-agent/hw.yaml');
  assert.ok(scan.relevant_files.includes('.emb-agent/req.yaml'));
  assert.ok(scan.next_reads.some(item => item.includes('.emb-agent/hw.yaml')));
  assert.ok(plan.truth_sources.some(item => item.includes('.emb-agent/req.yaml')));
});
