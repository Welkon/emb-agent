'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

test('loadRuntimeConfig returns validated defaults', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));

  assert.equal(config.runtime_version, 1);
  assert.equal(config.session_version, 1);
  assert.equal(config.default_profile, 'baremetal-8bit');
  assert.deepEqual(config.default_packs, ['sensor-node']);
  assert.deepEqual(config.default_preferences, {
    truth_source_mode: 'hardware_first',
    plan_mode: 'auto',
    review_mode: 'auto',
    verification_mode: 'lean'
  });
  assert.equal(config.project_state_dir, 'state/projects');
  assert.equal(config.max_last_files, 12);
});

test('normalizeSession fills metadata and trims arrays', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const paths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), '/tmp/example-proj', config);
  const session = runtime.normalizeSession(
    {
      last_files: Array.from({ length: 20 }, (_, index) => `f${index}.c`),
      active_packs: [],
      open_questions: ['q1'],
      known_risks: ['r1']
    },
    paths,
    config
  );

  assert.equal(session.session_version, 1);
  assert.equal(session.project_root, '/tmp/example-proj');
  assert.equal(session.project_name, 'example-proj');
  assert.equal(session.project_profile, 'baremetal-8bit');
  assert.deepEqual(session.active_packs, ['sensor-node']);
  assert.deepEqual(session.preferences, {
    truth_source_mode: 'hardware_first',
    plan_mode: 'auto',
    review_mode: 'auto',
    verification_mode: 'lean'
  });
  assert.equal(session.last_files.length, 12);
  assert.deepEqual(session.open_questions, ['q1']);
  assert.deepEqual(session.known_risks, ['r1']);
  assert.equal(session.last_command, '');
  assert.equal(session.paused_at, '');
  assert.equal(session.last_resumed_at, '');
});

test('normalizePreferences rejects invalid values', () => {
  assert.throws(
    () => runtime.normalizePreferences({ plan_mode: 'maybe' }),
    /preferences\.plan_mode/
  );

  assert.throws(
    () => runtime.normalizePreferences({ verification_mode: 'full' }),
    /preferences\.verification_mode/
  );
});

test('project config defaults can override runtime defaults', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-'));
  const projectConfigDir = path.join(tempProject, 'emb-agent');
  fs.mkdirSync(projectConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectConfigDir, 'project.json'),
    JSON.stringify(
      {
        project_profile: 'rtos-iot',
        active_packs: ['connected-appliance'],
        preferences: {
          truth_source_mode: 'code_first',
          plan_mode: 'always',
          review_mode: 'always',
          verification_mode: 'strict'
        },
        arch_review: {
          trigger_patterns: ['custom arch gate']
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const projectConfig = runtime.loadProjectConfig(tempProject, config);
  const paths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, config);
  const session = runtime.normalizeSession({}, paths, config, projectConfig);

  assert.equal(projectConfig.project_profile, 'rtos-iot');
  assert.deepEqual(projectConfig.active_packs, ['connected-appliance']);
  assert.deepEqual(projectConfig.arch_review.trigger_patterns, ['custom arch gate']);
  assert.equal(session.project_profile, 'rtos-iot');
  assert.deepEqual(session.active_packs, ['connected-appliance']);
  assert.deepEqual(session.preferences, {
    truth_source_mode: 'code_first',
    plan_mode: 'always',
    review_mode: 'always',
    verification_mode: 'strict'
  });
});

test('project config accepts mineru api mode settings', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-api-'));
  const projectConfigDir = path.join(tempProject, 'emb-agent');
  fs.mkdirSync(projectConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectConfigDir, 'project.json'),
    JSON.stringify(
      {
        integrations: {
          mineru: {
            mode: 'api',
            base_url: 'https://mineru.net/api/v4',
            api_key_env: 'MINERU_API_TOKEN',
            model_version: 'vlm',
            language: 'en',
            enable_table: false,
            is_ocr: true,
            enable_formula: false,
            poll_interval_ms: 1500,
            timeout_ms: 120000
          }
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const projectConfig = runtime.loadProjectConfig(tempProject, config);

  assert.equal(projectConfig.integrations.mineru.mode, 'api');
  assert.equal(projectConfig.integrations.mineru.base_url, 'https://mineru.net/api/v4');
  assert.equal(projectConfig.integrations.mineru.api_key_env, 'MINERU_API_TOKEN');
  assert.equal(projectConfig.integrations.mineru.model_version, 'vlm');
  assert.equal(projectConfig.integrations.mineru.language, 'en');
  assert.equal(projectConfig.integrations.mineru.enable_table, false);
  assert.equal(projectConfig.integrations.mineru.is_ocr, true);
  assert.equal(projectConfig.integrations.mineru.enable_formula, false);
  assert.equal(projectConfig.integrations.mineru.poll_interval_ms, 1500);
  assert.equal(projectConfig.integrations.mineru.timeout_ms, 120000);
});

test('profile validator accepts arch review triggers', () => {
  const profile = runtime.validateProfile('custom', {
    name: 'custom',
    runtime_model: 'main_loop_plus_isr',
    concurrency_model: 'interrupt_shared_state',
    resource_priority: ['rom'],
    search_priority: ['hardware_truth'],
    guardrails: ['thin_isr'],
    review_axes: ['timing_path'],
    notes_targets: ['docs/DEBUG-NOTES.md'],
    default_agents: ['hw-scout'],
    arch_review_triggers: ['custom arch gate']
  });

  assert.deepEqual(profile.arch_review_triggers, ['custom arch gate']);
});

test('project config accepts mineru auto mode settings', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-auto-'));
  const projectConfigDir = path.join(tempProject, 'emb-agent');
  fs.mkdirSync(projectConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectConfigDir, 'project.json'),
    JSON.stringify(
      {
        integrations: {
          mineru: {
            mode: 'auto',
            base_url: '',
            api_key_env: 'MINERU_API_KEY',
            auto_api_page_threshold: 16,
            auto_api_file_size_kb: 2048
          }
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const projectConfig = runtime.loadProjectConfig(tempProject, config);

  assert.equal(projectConfig.integrations.mineru.mode, 'auto');
  assert.equal(projectConfig.integrations.mineru.base_url, '');
  assert.equal(projectConfig.integrations.mineru.api_key_env, 'MINERU_API_KEY');
  assert.equal(projectConfig.integrations.mineru.auto_api_page_threshold, 16);
  assert.equal(projectConfig.integrations.mineru.auto_api_file_size_kb, 2048);
});

test('validators reject malformed template/profile/pack data', () => {
  assert.throws(
    () => runtime.validateTemplateConfig({ broken: { description: 'x' } }),
    /source/
  );

  assert.throws(
    () => runtime.validateProfile('broken', { name: 'broken', runtime_model: 'x' }),
    /concurrency_model/
  );

  assert.throws(
    () => runtime.validatePack('broken', { name: 'broken', focus_areas: 'bad' }),
    /focus_areas/
  );
});

test('project state paths and handoff validator support lightweight handoff', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const paths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), '/tmp/example-proj', config);

  assert.ok(paths.handoffPath.endsWith('.handoff.json'));

  const handoff = runtime.validateHandoff(
    {
      version: '1.0',
      status: 'paused',
      packs: ['sensor-node'],
      last_files: ['main.c'],
      open_questions: ['q1'],
      known_risks: ['r1']
    },
    config
  );

  assert.equal(handoff.status, 'paused');
  assert.deepEqual(handoff.packs, ['sensor-node']);
  assert.deepEqual(handoff.last_files, ['main.c']);
});
