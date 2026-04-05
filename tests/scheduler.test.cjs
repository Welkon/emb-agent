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
  const action = scheduler.buildDoOutput(resolved);

  assert.equal(scan.scheduler.primary_agent, 'hw-scout');
  assert.equal(scan.scheduler.agent_execution.primary_agent, 'emb-hw-scout');
  assert.equal(scan.scheduler.agent_execution.mode, 'inline-preferred');
  assert.ok(scan.next_reads.some(item => item.includes('硬件真值来源')));
  assert.equal(plan.scheduler.primary_agent, 'hw-scout');
  assert.equal(plan.scheduler.agent_execution.mode, 'primary-recommended');
  assert.ok(plan.scheduler.agent_execution.calls.some(item => item.agent === 'emb-fw-doer'));
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.auto_invoke_when_recommended, true);
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.agent, 'emb-hw-scout');
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary.spawn_fallback.fallback_agent_type, 'explorer');
  assert.match(plan.scheduler.agent_execution.dispatch_contract.primary.spawn_fallback.instructions_source_cli, /agents show emb-hw-scout/);
  assert.ok(plan.scheduler.agent_execution.dispatch_contract.primary.context_bundle.truth_sources.length > 0);
  assert.ok(plan.constraints.some(item => item.includes('ISR 薄')));
  assert.ok(plan.verification.some(item => item.includes('时序窗口')));
  assert.ok(debug.hypotheses.some(item => item.includes('ISR')));
  assert.equal(debug.scheduler.agent_execution.primary_agent, 'emb-bug-hunter');
  assert.equal(action.chosen_agent, 'fw-doer');
  assert.ok(action.prerequisites.includes('先补一次最小 scan，确认真实改动点'));
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
  const note = scheduler.buildNoteOutput(resolved);

  assert.equal(plan.scheduler.primary_agent, 'sys-reviewer');
  assert.equal(plan.scheduler.agent_execution.primary_agent, 'emb-sys-reviewer');
  assert.equal(plan.scheduler.agent_execution.mode, 'parallel-recommended');
  assert.ok(plan.scheduler.agent_execution.supporting_agents.includes('emb-release-checker'));
  assert.equal(plan.scheduler.agent_execution.dispatch_contract.primary_first, false);
  assert.ok(plan.scheduler.agent_execution.dispatch_contract.parallel_safe.includes('emb-release-checker'));
  assert.equal(plan.goal, 'review ota and reconnect path');
  assert.ok(plan.risks.includes('rollback path not verified'));
  assert.ok(plan.verification.some(item => item.includes('升级恢复')));
  assert.equal(review.scheduler.primary_agent, 'sys-reviewer');
  assert.equal(review.scheduler.agent_execution.mode, 'parallel-recommended');
  assert.ok(review.scheduler.agent_execution.calls.some(item => item.agent === 'emb-release-checker'));
  assert.ok(review.scheduler.agent_execution.dispatch_contract.supporting.some(item => item.agent === 'emb-release-checker'));
  assert.ok(review.scheduler.agent_execution.dispatch_contract.supporting.some(item => item.spawn_fallback.fallback_agent_type === 'explorer'));
  assert.ok(review.review_agents.includes('release-checker'));
  assert.ok(review.required_checks.some(item => item.includes('离线默认行为')));
  assert.ok(note.target_docs.includes('docs/CONNECTIVITY.md'));
  assert.ok(note.target_docs.includes('docs/RELEASE-NOTES.md'));
  assert.equal(note.chosen_agent, 'fw-doer');
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

  assert.equal(plan.truth_sources[0], '当前最相关文件: main.c');
  assert.ok(plan.verification.some(item => item.includes('失败路径')));
});

test('project truth files are preferred when present', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-truth-'));
  const embDir = path.join(tempProject, 'emb-agent');
  fs.mkdirSync(embDir, { recursive: true });
  fs.writeFileSync(path.join(embDir, 'hw.yaml'), 'mcu:\n  model: test\n', 'utf8');
  fs.writeFileSync(path.join(embDir, 'req.yaml'), 'goals:\n  - test\n', 'utf8');

  const resolved = buildResolved('baremetal-8bit', ['sensor-node'], {
    project_root: tempProject,
    last_files: ['main.c']
  });

  const scan = scheduler.buildScanOutput(resolved);
  const plan = scheduler.buildPlanOutput(resolved);

  assert.equal(scan.relevant_files[0], 'emb-agent/hw.yaml');
  assert.ok(scan.relevant_files.includes('emb-agent/req.yaml'));
  assert.ok(scan.next_reads.some(item => item.includes('emb-agent/hw.yaml')));
  assert.ok(plan.truth_sources.some(item => item.includes('emb-agent/req.yaml')));
});
