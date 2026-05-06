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
  assert.equal(config.default_profile, 'baremetal-loop');
  assert.deepEqual(config.default_specs, []);
  assert.deepEqual(config.developer, { name: '', runtime: '' });
  assert.deepEqual(config.default_preferences, {
    truth_source_mode: 'hardware_first',
    plan_mode: 'auto',
    review_mode: 'auto',
    verification_mode: 'lean',
    orchestration_mode: 'auto'
  });
  assert.deepEqual(config.default_workflow_source, {
    type: 'git',
    location: 'https://github.com/Welkon/emb-support.git',
    branch: '',
    subdir: 'specs'
  });
  assert.deepEqual(config.default_chip_support_source, {
    type: 'git',
    location: 'https://github.com/Welkon/emb-support.git',
    branch: '',
    subdir: 'adapters'
  });
  assert.deepEqual(config.default_skill_source, {
    type: 'git',
    location: 'https://github.com/Welkon/emb-support.git',
    branch: '',
    subdir: 'skills'
  });
  assert.equal(config.project_state_dir, '../state/emb-agent/projects');
  assert.equal(config.legacy_project_state_dir, 'state/projects');
  assert.equal(config.max_last_files, 12);
});

test('normalizeSession fills metadata and trims arrays', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const paths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), '/tmp/example-proj', config);
  const session = runtime.normalizeSession(
    {
      last_files: Array.from({ length: 20 }, (_, index) => `f${index}.c`),
      active_specs: [],
      open_questions: ['q1'],
      known_risks: ['r1']
    },
    paths,
    config
  );

  assert.equal(session.session_version, 1);
  assert.equal(session.project_root, '/tmp/example-proj');
  assert.equal(session.project_name, 'example-proj');
  assert.equal(session.project_profile, '');
  assert.deepEqual(session.active_specs, []);
  assert.deepEqual(session.developer, { name: '', runtime: '' });
  assert.deepEqual(session.preferences, {
    truth_source_mode: 'hardware_first',
    plan_mode: 'auto',
    review_mode: 'auto',
    verification_mode: 'lean',
    orchestration_mode: 'auto'
  });
  assert.equal(session.last_files.length, 12);
  assert.deepEqual(session.open_questions, ['q1']);
  assert.deepEqual(session.known_risks, ['r1']);
  assert.deepEqual(session.active_task, {
    name: '',
    title: '',
    status: '',
    path: '',
    package: '',
    updated_at: ''
  });
  assert.deepEqual(session.diagnostics, {
    latest_forensics: {
      report_file: '',
      problem: '',
      highest_severity: '',
      generated_at: ''
    },
    latest_skill: {
      name: '',
      status: '',
      risk: '',
      exit_code: null,
      duration_ms: null,
      ran_at: '',
      cwd: '',
      argv: [],
      evidence_hint: [],
      stdout_preview: '',
      stderr_preview: ''
    },
    skill_history: {},
    latest_executor: {
      name: '',
      status: '',
      risk: '',
      exit_code: null,
      duration_ms: null,
      ran_at: '',
      cwd: '',
      argv: [],
      evidence_hint: [],
      stdout_preview: '',
      stderr_preview: ''
    },
    executor_history: {},
    human_signoffs: {},
    latest_transcript_import: {
      provider: '',
      source_id: '',
      source_file: '',
      analysis_file: '',
      ai_review_file: '',
      generated_at: '',
      confirmed_facts: [],
      user_preferences: [],
      pin_state_candidates: [],
      semantic_review: {
        required: false,
        status: '',
        reviewer: ''
      },
      recommended_next: null
    },
    delegation_runtime: {
      pattern: '',
      strategy: '',
      requested_action: '',
      resolved_action: '',
      phases: [],
      launch_requests: [],
      jobs: [],
      worker_results: [],
      synthesis: {
        required: false,
        status: '',
        owner: '',
        rule: '',
        happens_after: [],
        happens_before: [],
        output_requirements: []
      },
      integration: {
        owner: '',
        status: '',
        entered_via: '',
        execution_kind: '',
        execution_cli: '',
        steps: []
      },
      review: {
        required: false,
        policy: '',
        redispatch_required: false,
        summary: '',
        stage_a: {
          id: 'contract-review',
          owner: '',
          objective: '',
          completion_signal: '',
          failure_action: '',
          review_checks: [],
          status: ''
        },
        stage_b: {
          id: 'quality-review',
          owner: '',
          objective: '',
          completion_signal: '',
          failure_action: '',
          review_checks: [],
          status: ''
        }
      },
      updated_at: ''
    },
    walkthrough_runtime: {
      kind: '',
      status: '',
      ordered_tools: [],
      current_index: null,
      completed_count: null,
      total_steps: null,
      last_tool: '',
      last_summary: '',
      steps: [],
      updated_at: ''
    }
  });
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

test('writeJson replaces files atomically without leaving temp files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-runtime-write-json-'));
  const filePath = path.join(tempDir, 'state.json');

  runtime.writeJson(filePath, { value: 1 });
  runtime.writeJson(filePath, { value: 2, nested: { ok: true } });

  assert.deepEqual(runtime.readJson(filePath), { value: 2, nested: { ok: true } });
  assert.deepEqual(
    fs.readdirSync(tempDir).filter(name => name.endsWith('.tmp')),
    []
  );
});

test('project state paths resolve outside runtime root and migrate legacy files', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-runtime-root-'));
  const runtimeRoot = path.join(tempRoot, 'emb-agent');
  const projectRoot = path.join(tempRoot, 'demo-project');

  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  const paths = runtime.getProjectStatePaths(runtimeRoot, projectRoot, config);

  assert.equal(paths.stateDir, path.join(tempRoot, 'state', 'emb-agent', 'projects'));
  assert.equal(paths.legacyStateDir, path.join(runtimeRoot, 'state', 'projects'));

  fs.mkdirSync(paths.legacyStateDir, { recursive: true });
  fs.writeFileSync(paths.legacySessionPath, JSON.stringify({ focus: 'legacy' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    paths.legacyHandoffPath,
    JSON.stringify({ version: '1.0', status: 'paused', specs: [] }, null, 2) + '\n',
    'utf8'
  );

  runtime.ensureProjectStateStorage(paths);

  assert.equal(fs.existsSync(paths.sessionPath), true);
  assert.equal(fs.existsSync(paths.handoffPath), true);
  assert.equal(fs.existsSync(paths.legacySessionPath), false);
  assert.equal(fs.existsSync(paths.legacyHandoffPath), false);
});

test('project layout migrates legacy emb-agent directory into .emb-agent', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-layout-'));
  const legacyDir = path.join(tempProject, 'emb-agent');
  const currentDir = path.join(tempProject, '.emb-agent');

  fs.mkdirSync(path.join(legacyDir, 'cache', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'project.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(legacyDir, 'hw.yaml'), 'mcu:\n  model: test\n', 'utf8');

  const resolvedDir = runtime.initProjectLayout(tempProject);

  assert.equal(resolvedDir, currentDir);
  assert.equal(fs.existsSync(path.join(currentDir, 'project.json')), true);
  assert.equal(fs.existsSync(path.join(currentDir, 'hw.yaml')), true);
  assert.equal(fs.existsSync(path.join(currentDir, 'cache', 'docs')), true);
  assert.equal(fs.existsSync(path.join(currentDir, 'tasks')), true);
  assert.equal(fs.existsSync(path.join(currentDir, 'registry', 'workflow.json')), false);
  assert.equal(fs.existsSync(path.join(currentDir, 'specs', 'project-local.md')), false);
  assert.equal(fs.existsSync(path.join(currentDir, 'templates')), false);
  assert.equal(fs.existsSync(legacyDir), false);
});

test('project config defaults can override runtime defaults', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-'));
  const projectConfigDir = path.join(tempProject, '.emb-agent');
  fs.mkdirSync(projectConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectConfigDir, 'project.json'),
    JSON.stringify(
      {
        project_profile: 'tasked-runtime',
        active_specs: ['connected-appliance'],
        executors: {
          build: {
            description: 'firmware build',
            argv: ['make', '-C', 'firmware'],
            cwd: '.',
            env: {
              BUILD_MODE: 'release'
            },
            allow_extra_args: true,
            risk: 'normal',
            evidence_hint: ['docs/VERIFICATION.md']
          }
        },
        quality_gates: {
          required_skills: ['scope-debug', 'scope-debug'],
          required_executors: ['build', 'bench', 'build'],
          required_signoffs: ['board-bench', 'thermal-check', 'board-bench']
        },
        permissions: {
          default_policy: 'ask',
          require_confirmation_for_high_risk: false,
          tools: {
            ask: ['timer-calc', 'timer-calc'],
            deny: ['flash-calc']
          },
          executors: {
            allow: ['build'],
            deny: ['flash']
          },
          writes: {
            ask: ['doc-apply-hardware', 'doc-apply-hardware'],
            deny: ['project-set']
          }
        },
        developer: {
          name: 'welkon',
          runtime: 'codex'
        },
        preferences: {
          truth_source_mode: 'code_first',
          plan_mode: 'always',
          review_mode: 'always',
          verification_mode: 'strict',
          orchestration_mode: 'swarm'
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

  assert.equal(projectConfig.project_profile, 'tasked-runtime');
  assert.deepEqual(projectConfig.active_specs, ['connected-appliance']);
  assert.deepEqual(projectConfig.executors.build.argv, ['make', '-C', 'firmware']);
  assert.equal(projectConfig.executors.build.allow_extra_args, true);
  assert.equal(projectConfig.executors.build.env.BUILD_MODE, 'release');
  assert.deepEqual(projectConfig.quality_gates.required_skills, ['scope-debug']);
  assert.deepEqual(projectConfig.quality_gates.required_executors, ['build', 'bench']);
  assert.deepEqual(projectConfig.quality_gates.required_signoffs, ['board-bench', 'thermal-check']);
  assert.equal(projectConfig.permissions.default_policy, 'ask');
  assert.equal(projectConfig.permissions.require_confirmation_for_high_risk, false);
  assert.deepEqual(projectConfig.permissions.tools.ask, ['timer-calc']);
  assert.deepEqual(projectConfig.permissions.tools.deny, ['flash-calc']);
  assert.deepEqual(projectConfig.permissions.executors.allow, ['build']);
  assert.deepEqual(projectConfig.permissions.executors.deny, ['flash']);
  assert.deepEqual(projectConfig.permissions.writes.ask, ['doc-apply-hardware']);
  assert.deepEqual(projectConfig.permissions.writes.deny, ['project-set']);
  assert.deepEqual(projectConfig.developer, { name: 'welkon', runtime: 'codex' });
  assert.deepEqual(projectConfig.arch_review.trigger_patterns, ['custom arch gate']);
  assert.equal(session.project_profile, 'tasked-runtime');
  assert.deepEqual(session.active_specs, ['connected-appliance']);
  assert.deepEqual(session.developer, { name: 'welkon', runtime: 'codex' });
  assert.deepEqual(session.preferences, {
    truth_source_mode: 'code_first',
    plan_mode: 'always',
    review_mode: 'always',
    verification_mode: 'strict',
    orchestration_mode: 'swarm'
  });
});

test('project config rejects malformed executors', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        executors: {
          flash: {
            argv: []
          }
        }
      },
      config
    ),
    /executors\.flash\.argv/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        executors: {
          'bad name': {
            argv: ['make']
          }
        }
      },
      config
    ),
    /Invalid executor name/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        quality_gates: {
          required_skills: 'scope-debug'
        }
      },
      config
    ),
    /quality_gates\.required_skills/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        quality_gates: {
          required_executors: 'build'
        }
      },
      config
    ),
    /quality_gates\.required_executors/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        quality_gates: {
          required_signoffs: 'board-bench'
        }
      },
      config
    ),
    /quality_gates\.required_signoffs/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        permissions: {
          default_policy: 'prompt'
        }
      },
      config
    ),
    /permissions\.default_policy/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        permissions: {
          tools: {
            ask: 'timer-calc'
          }
        }
      },
      config
    ),
    /permissions\.tools\.ask/
  );

  assert.throws(
    () => runtime.validateProjectConfig(
      {
        permissions: {
          writes: {
            deny: 'project-set'
          }
        }
      },
      config
    ),
    /permissions\.writes\.deny/
  );
});

test('project config accepts mineru api mode settings', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-api-'));
  const projectConfigDir = path.join(tempProject, '.emb-agent');
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
  const projectConfigDir = path.join(tempProject, '.emb-agent');
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

test('project config accepts intent router integration settings', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-project-intent-router-'));
  const projectConfigDir = path.join(tempProject, '.emb-agent');
  fs.mkdirSync(projectConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectConfigDir, 'project.json'),
    JSON.stringify(
      {
        integrations: {
          intent_router: {
            enabled: true,
            mode: 'local',
            provider: 'local-rules'
          }
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const projectConfig = runtime.loadProjectConfig(tempProject, config);

  assert.equal(projectConfig.integrations.intent_router.enabled, true);
  assert.equal(projectConfig.integrations.intent_router.mode, 'local');
  assert.equal(projectConfig.integrations.intent_router.provider, 'local-rules');
});

test('validators reject malformed profile/project spec data', () => {
  assert.throws(
    () => runtime.validateProfile('broken', { name: 'broken', runtime_model: 'x' }),
    /concurrency_model/
  );

  assert.throws(
    () => runtime.validateProjectConfig({ active_specs: 'sensor-node' }, runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'))),
    /active_specs/
  );
});

test('project state paths and handoff validator support lightweight handoff', () => {
  const config = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const paths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), '/tmp/example-proj', config);

  assert.ok(paths.handoffPath.endsWith('.handoff.json'));
  assert.ok(paths.contextSummaryPath.endsWith('.context-summary.json'));

  const handoff = runtime.validateHandoff(
    {
      version: '1.0',
      status: 'paused',
      specs: ['sensor-node'],
      default_package: 'app',
      active_package: 'fw',
      last_files: ['main.c'],
      open_questions: ['q1'],
      known_risks: ['r1']
    },
    config
  );

  assert.equal(handoff.status, 'paused');
  assert.deepEqual(handoff.specs, ['sensor-node']);
  assert.equal(handoff.default_package, 'app');
  assert.equal(handoff.active_package, 'fw');
  assert.deepEqual(handoff.last_files, ['main.c']);

  const contextSummary = runtime.validateContextSummary(
    {
      version: '1.0',
      generated_at: '2026-04-09T12:00:00.000Z',
      source: 'pause',
      profile: 'baremetal-loop',
      specs: ['sensor-node'],
      default_package: 'app',
      active_package: 'fw',
      next_action: 'resume timer drift',
      last_files: ['main.c'],
      open_questions: ['q1'],
      known_risks: ['r1'],
      active_task: {
        name: 'timer-drift',
        title: 'Investigate timer drift',
        status: 'active',
        package: 'fw',
        path: '.emb-agent/tasks/timer-drift.json'
      },
      diagnostics: {
        latest_executor: {
          name: 'bench',
          status: 'failed',
          exit_code: 7
        }
      }
    },
    config
  );

  assert.equal(contextSummary.source, 'pause');
  assert.equal(contextSummary.captured_at, '');
  assert.equal(contextSummary.snapshot_label, '');
  assert.equal(contextSummary.stale_note, '');
  assert.deepEqual(contextSummary.recovery_pointers, []);
  assert.equal(contextSummary.default_package, 'app');
  assert.equal(contextSummary.active_package, 'fw');
  assert.equal(contextSummary.active_task.name, 'timer-drift');
  assert.equal(contextSummary.active_task.package, 'fw');
  assert.equal(contextSummary.diagnostics.latest_executor.exit_code, 7);
});
