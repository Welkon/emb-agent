'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const { withDefaultWorkflowSourceEnv } = require(path.join(repoRoot, 'tests', 'support-workflow-source.cjs'));

function readBootstrapTask(projectRoot) {
  return JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json'),
      'utf8'
    )
  );
}

test('parseWorkflowSpecSelection supports comma-separated spec indexes', () => {
  const entries = [
    { name: 'battery-charger', description: 'Charging flow' },
    { name: 'sensor-node', description: 'Sampling flow' },
    { name: 'motor-drive', description: 'PWM flow' }
  ];

  assert.deepEqual(initProject.parseWorkflowSpecSelection('1, 3', entries), [
    'battery-charger',
    'motor-drive'
  ]);
  assert.deepEqual(initProject.parseWorkflowSpecSelection('', entries), []);
  assert.throws(() => initProject.parseWorkflowSpecSelection('9', entries), /Invalid workflow spec selection/);
});

test('prepareProjectWorkflowSetup imports registry before resolving prompted workflow specs', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-spec-select-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-spec-select-source-'));

  fs.mkdirSync(path.join(tempSource, '.emb-agent', 'registry'), { recursive: true });
  fs.mkdirSync(path.join(tempSource, '.emb-agent', 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(tempSource, '.emb-agent', 'registry', 'workflow.json'),
    JSON.stringify({
      version: 1,
      templates: [],
      specs: [
        {
          name: 'smart-pillbox',
          title: 'Smart Pillbox',
          path: 'specs/smart-pillbox.md',
          summary: 'Imported smart pillbox workflow.',
          auto_inject: true,
          selectable: true,
          priority: 62,
          apply_when: {
            specs: ['smart-pillbox']
          },
          focus_areas: ['medication_schedule'],
          extra_review_axes: [],
          preferred_notes: [],
          default_agents: []
        },
        {
          name: 'factory-test',
          title: 'Factory Test',
          path: 'specs/factory-test.md',
          summary: 'Imported factory test workflow.',
          auto_inject: true,
          selectable: true,
          priority: 55,
          apply_when: {
            specs: ['factory-test']
          },
          focus_areas: ['production'],
          extra_review_axes: [],
          preferred_notes: [],
          default_agents: []
        }
      ]
    }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(tempSource, '.emb-agent', 'specs', 'smart-pillbox.md'),
    [
      '# Smart Pillbox',
      '',
      '- Check medication schedule flow.',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tempSource, '.emb-agent', 'specs', 'factory-test.md'),
    [
      '# Factory Test',
      '',
      '- Check factory flow.',
      ''
    ].join('\n'),
    'utf8'
  );

  const workflowSetup = initProject.prepareProjectWorkflowSetup(
    tempProject,
    {
      registry: tempSource,
      registryBranch: '',
      registrySubdir: '',
      specs: []
    },
    {
      promptWorkflowSpecChoices(entries) {
        assert.equal(entries.some(item => item.name === 'smart-pillbox'), true);
        return ['smart-pillbox'];
      }
    }
  );

  const projectConfig = initProject.buildProjectConfig(
    tempProject,
    {
      profile: '',
      specs: workflowSetup.activeSpecs,
      runtime: '',
      user: ''
    },
    {
      workflowCatalog: workflowSetup.workflowCatalog,
      activeSpecs: workflowSetup.activeSpecs
    }
  );

  assert.ok(workflowSetup.workflowRegistryImport);
  assert.equal(workflowSetup.workflowRegistryImport.imported.some(item => item.name === 'smart-pillbox'), true);
  assert.deepEqual(workflowSetup.activeSpecs, ['smart-pillbox']);
  assert.deepEqual(projectConfig.active_specs, ['smart-pillbox']);
});

test('init-project creates project defaults and defers note templates into a bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main([
        '--project',
        tempProject,
        '--profile',
        'tasked-runtime',
        '--spec',
        'connected-appliance'
      ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);
    const projectRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json'), 'utf8')
    );

    assert.equal(projectConfig.project_profile, 'tasked-runtime');
    assert.deepEqual(projectConfig.active_specs, ['connected-appliance']);
    assert.deepEqual(projectConfig.chip_support_sources, []);
    assert.deepEqual(projectConfig.executors, {});
    assert.deepEqual(projectConfig.quality_gates.required_skills, []);
    assert.deepEqual(projectConfig.quality_gates.required_executors, []);
    assert.deepEqual(projectConfig.quality_gates.required_signoffs, []);
    assert.deepEqual(projectConfig.developer, { name: '', runtime: '' });
    assert.equal(projectConfig.integrations.mineru.mode, 'auto');
    assert.equal(projectConfig.integrations.mineru.base_url, '');
    assert.equal(projectConfig.integrations.mineru.api_key, '');
    assert.equal(projectConfig.integrations.mineru.api_key_env, 'MINERU_API_KEY');
    assert.equal(projectConfig.integrations.mineru.model_version, '');
    assert.equal(projectConfig.integrations.mineru.auto_api_page_threshold, 12);
    assert.equal(projectConfig.integrations.mineru.auto_api_file_size_kb, 4096);
    assert.equal(projectConfig.integrations.szlcsc.enabled, false);
    assert.equal(projectConfig.integrations.szlcsc.base_url, 'https://ips.lcsc.com');
    assert.equal(projectConfig.integrations.szlcsc.api_key, '');
    assert.equal(projectConfig.integrations.szlcsc.api_key_env, 'SZLCSC_API_KEY');
    assert.equal(projectConfig.integrations.szlcsc.api_secret, '');
    assert.equal(projectConfig.integrations.szlcsc.api_secret_env, 'SZLCSC_API_SECRET');
    assert.equal(projectConfig.integrations.szlcsc.match_type, 'fuzzy');
    assert.equal(projectConfig.integrations.szlcsc.page_size, 5);
    assert.equal(projectConfig.integrations.szlcsc.max_matches_per_component, 5);
    assert.ok(projectRegistry.specs.some(item => item.name === 'connected-appliance'));
    assert.ok(projectRegistry.specs.some(item => item.name === 'iot-device-focus'));
    assert.ok(projectRegistry.specs.some(item => item.name === 'tasked-runtime-focus'));
    assert.ok(!projectRegistry.specs.some(item => item.name === 'sensor-node'));
    assert.ok(!projectRegistry.specs.some(item => item.name === 'motor-drive'));
    assert.ok(!projectRegistry.specs.some(item => item.name === 'baremetal-loop-focus'));
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'connected-appliance-focus.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'iot-device-focus.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'tasked-runtime-focus.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'sensor-node-focus.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'motor-drive-focus.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'baremetal-loop-focus.md')), false);
    assert.equal(projectConfig.integrations.szlcsc.only_available, false);
    assert.equal(projectConfig.integrations.szlcsc.currency, '');
    assert.equal(projectConfig.integrations.szlcsc.timeout_ms, 15000);
    assert.equal(projectConfig.integrations.intent_router.enabled, true);
    assert.equal(projectConfig.integrations.intent_router.mode, 'agent');
    assert.equal(projectConfig.integrations.intent_router.provider, 'embedded-agent');
    assert.deepEqual(projectConfig.arch_review.trigger_patterns, []);
    assert.equal(fs.existsSync(path.join(tempProject, 'AGENTS.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'CLAUDE.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'CODEX.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'external-agent.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'docs')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'chip-support-sources')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.developer')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.current-task')), true);
    assert.equal(fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8'), '');
    assert.equal(fs.existsSync(path.join(tempProject, 'src')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'README.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workflow.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'worktree.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', 'archive')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workspace')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'project-local.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'CONNECTIVITY.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'RELEASE-NOTES.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md')), false);
    assert.match(fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8'), /<!-- EMB-AGENT:START -->/);
    assert.match(fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8'), /Use the `start` command when starting a new session/);
    assert.match(
      fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8'),
      /Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates/
    );
    assert.equal(bootstrapTask.title, 'Bootstrap project notes');
    assert.equal(bootstrapTask.dev_type, 'docs');
    assert.ok(bootstrapTask.relatedFiles.includes('.emb-agent/hw.yaml'));
    assert.ok(bootstrapTask.relatedFiles.includes('.emb-agent/req.yaml'));
    assert.ok(!bootstrapTask.relatedFiles.includes('.emb-agent/external-agent.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MCU-FOUNDATION-CHECKLIST.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/CONNECTIVITY.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/RELEASE-NOTES.md'));
    assert.match(bootstrapTask.notes, /Init now creates the minimum emb-agent project skeleton first/);

    process.chdir(tempProject);
    cli.main(['init']);

    const status = cli.buildStatus();
    assert.equal(status.project_profile, 'tasked-runtime');
    assert.deepEqual(status.active_specs, ['connected-appliance']);
    assert.equal(status.preferences.truth_source_mode, 'hardware_first');
    assert.deepEqual(status.developer, { name: '', runtime: '' });
    assert.equal(status.project_defaults.project_profile, 'tasked-runtime');
    assert.deepEqual(status.project_defaults.arch_review.trigger_patterns, []);
    assert.ok(Array.isArray(status.arch_review_triggers));
    } finally {
      process.chdir(currentCwd);
      process.stdout.write = originalWrite;
    }
  });
});

test('init-project with battery-charger spec adds deferred power charging note target to bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-battery-charger-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main([
        '--project',
        tempProject,
        '--profile',
        'baremetal-loop',
        '--spec',
        'battery-charger'
      ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-loop');
    assert.deepEqual(projectConfig.active_specs, ['battery-charger']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'POWER-CHARGING.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/POWER-CHARGING.md'));
    assert.ok(bootstrapTask.subtasks.some(item => item.name.includes('docs/POWER-CHARGING.md')));
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

test('init-project with Padauk firmware spec adds deferred implementation-style note target', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-padauk-firmware-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main([
        '--project',
        tempProject,
        '--profile',
        'baremetal-loop',
        '--spec',
        'padauk-firmware'
      ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-loop');
    assert.deepEqual(projectConfig.active_specs, ['padauk-firmware']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'IMPLEMENTATION-STYLE.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/IMPLEMENTATION-STYLE.md'));
    assert.ok(bootstrapTask.subtasks.some(item => item.name.includes('docs/IMPLEMENTATION-STYLE.md')));
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

test('init-project honors project-local smart-pillbox spec and template', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-smart-pillbox-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    const projectExtDir = runtime.initProjectLayout(tempProject);
    workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: true });
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    registry.templates.push({
      name: 'medication-flow',
      source: 'templates/medication-flow.md.tpl',
      description: 'Project-local medication flow note.',
      default_output: 'docs/MEDICATION-FLOW.md'
    });
    registry.specs.push({
      name: 'smart-pillbox',
      title: 'Smart Pillbox',
      path: 'specs/smart-pillbox.md',
      summary: 'Project-local smart pillbox rules.',
      auto_inject: true,
      selectable: true,
      priority: 62,
      apply_when: {
        specs: ['smart-pillbox']
      },
      focus_areas: [
        'medication_schedule',
        'sync_reconciliation'
      ],
      extra_review_axes: [
        'schedule_state_machine'
      ],
      preferred_notes: [
        'docs/MEDICATION-FLOW.md'
      ],
      default_agents: []
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'smart-pillbox.md'),
      '# Smart Pillbox Focus\n\n- Check adherence state transitions.\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectExtDir, 'templates', 'medication-flow.md.tpl'),
      '# Medication Flow\n\n## Schedule Truth\n',
      'utf8'
    );

    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'baremetal-loop',
      '--spec',
      'smart-pillbox'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-loop');
    assert.deepEqual(projectConfig.active_specs, ['smart-pillbox']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MEDICATION-FLOW.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MEDICATION-FLOW.md'));
    assert.ok(bootstrapTask.subtasks.some(item => item.name.includes('docs/MEDICATION-FLOW.md')));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('init-project keeps workflow specs empty in non-interactive mode even when imported registry adds specs', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-registry-spec-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-registry-spec-source-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'registry'), { recursive: true });
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'registry', 'workflow.json'),
      JSON.stringify({
        version: 1,
        templates: [],
        specs: [
          {
            name: 'smart-pillbox',
            title: 'Smart Pillbox',
            path: 'specs/smart-pillbox.md',
            summary: 'Imported smart pillbox workflow.',
            auto_inject: true,
            selectable: true,
            priority: 62,
            apply_when: {
              specs: ['smart-pillbox']
            },
            focus_areas: ['medication_schedule'],
            extra_review_axes: [],
            preferred_notes: [],
            default_agents: []
          },
          {
            name: 'factory-test',
            title: 'Factory Test',
            path: 'specs/factory-test.md',
            summary: 'Imported factory workflow.',
            auto_inject: true,
            selectable: true,
            priority: 60,
            apply_when: {
              specs: ['factory-test']
            },
            focus_areas: ['board_test'],
            extra_review_axes: [],
            preferred_notes: [],
            default_agents: []
          }
        ]
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'specs', 'smart-pillbox.md'),
      '# Smart Pillbox\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'specs', 'factory-test.md'),
      '# Factory Test\n',
      'utf8'
    );

    initProject.main([
      '--project',
      tempProject,
      '--registry',
      tempSource
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );

    assert.deepEqual(projectConfig.active_specs, []);
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'smart-pillbox.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'factory-test.md')));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('init-project with motor-drive spec adds deferred motor note targets to bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-motor-drive-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main([
        '--project',
        tempProject,
        '--profile',
        'baremetal-loop',
        '--spec',
        'motor-drive'
      ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-loop');
    assert.deepEqual(projectConfig.active_specs, ['motor-drive']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MOTOR-CONTROL.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'POWER-STAGE.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MOTOR-CONTROL.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/POWER-STAGE.md'));
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

test('init preserves existing docs files without force', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-preserve-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const customDebugPath = path.join(tempProject, 'docs', 'DEBUG-NOTES.md');
  const customHardwarePath = path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md');

  process.stdout.write = () => true;

  try {
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(customDebugPath, '# custom debug\nkeep me\n', 'utf8');
    fs.writeFileSync(customHardwarePath, '# custom hardware\nkeep me too\n', 'utf8');

    process.chdir(tempProject);
    cli.main(['init']);

    assert.equal(fs.readFileSync(customDebugPath, 'utf8'), '# custom debug\nkeep me\n');
    assert.equal(fs.readFileSync(customHardwarePath, 'utf8'), '# custom hardware\nkeep me too\n');
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'chip-support-sources')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.current-task')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workflow.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'worktree.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workspace')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'project-local.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'capability-scan.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'scan-workflow.md.tpl')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json')), true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init returns onboarding guidance for chip support setup', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-guidance-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    const result = JSON.parse(stdout);
    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );

    assert.equal(result.initialized, true);
    assert.equal(result.session.project_profile, '');
    assert.deepEqual(result.session.active_specs, []);
    assert.equal(projectConfig.project_profile, '');
    assert.deepEqual(projectConfig.active_specs, []);
    assert.equal(result.bootstrap.status, 'needs-project-definition');
    assert.equal(result.bootstrap.stage, 'define-project-constraints');
    assert.equal(result.bootstrap.command, 'next');
    assert.match(
      result.bootstrap.summary,
      /\.emb-agent\/req\.yaml.*project type.*inputs\/outputs.*interfaces.*constraints/i
    );
    assert.match(result.bootstrap.summary, /\.emb-agent\/hw\.yaml.*unknown/i);
    assert.equal(result.bootstrap.bootstrap_task.name, '00-bootstrap-project');
    assert.equal(result.bootstrap_task.name, '00-bootstrap-project');
    assert.equal(fs.existsSync(path.join(tempProject, 'src')), true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init prioritizes discovered hardware PDF intake before manual hardware confirmation', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-detect-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'PMS150G SOP8 datasheet\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, 'main.c'), '/* target: PMS150G */\n', 'utf8');

    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    const result = JSON.parse(stdout);

    assert.equal(result.initialized, true);
    assert.equal(result.bootstrap.status, 'needs-source-intake');
    assert.equal(result.bootstrap.stage, 'source-intake');
    assert.equal(result.bootstrap.command, 'ingest doc --file docs/PMS150G.pdf --kind datasheet --to hardware');
    assert.match(result.bootstrap.summary, /Discovered hardware PDF/i);
    assert.match(result.bootstrap.summary, /\.emb-agent\/hw\.yaml/i);
    assert.match(result.bootstrap.summary, /before confirming the MCU\/package/i);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init prioritizes discovered schematics before manual hardware confirmation', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-schematic-detect-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'board.SchDoc'), 'fake schematic\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'PMS150G SOP8 datasheet\n', 'utf8');

    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    const result = JSON.parse(stdout);

    assert.equal(result.initialized, true);
    assert.equal(result.bootstrap.status, 'needs-source-intake');
    assert.equal(result.bootstrap.stage, 'source-intake');
    assert.equal(result.bootstrap.command, 'ingest schematic --file docs/board.SchDoc');
    assert.match(result.bootstrap.summary, /Discovered schematic/i);
    assert.match(result.bootstrap.summary, /\.emb-agent\/hw\.yaml/i);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init prioritizes bootstrap run for confirmed chip when default support source is available', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-pins-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    const projectEmbDir = path.join(tempProject, '.emb-agent');
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({ devices: ['vendor-chip'] }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'profiles', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        vendor: 'VendorName',
        family: 'vendor-family',
        sample: false,
        series: 'SeriesName',
        package: 'sop8',
        runtime_model: 'main_loop_plus_isr',
        description: 'External chip profile.',
        summary: {},
        capabilities: ['pwm'],
        packages: [
          {
            name: 'sop8',
            pin_count: 8,
            pins: [
              { number: 1, signal: 'VDD', default_function: 'power', notes: [] },
              { number: 2, signal: 'PA3', label: 'PWM_OUT', default_function: 'pwm-output', mux: ['TM2PWM'], notes: [] },
              { number: 3, signal: 'PA4', label: 'KEY_IN', default_function: 'gpio-input', mux: ['INT0'], notes: [] }
            ],
            notes: []
          }
        ],
        docs: [],
        related_tools: ['pwm-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init', '--mcu', 'vendor-chip', '--package', 'sop8']);
    const result = JSON.parse(stdout);

    assert.equal(result.initialized, true);
    assert.equal(result.bootstrap.status, 'ready-for-next');
    assert.equal(result.bootstrap.stage, 'bootstrap-chip-support');
    assert.equal(result.bootstrap.command, 'bootstrap run --confirm');
    assert.match(result.bootstrap.summary, /chip support install is ready/i);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init accepts runtime and developer identity flags and persists updates', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-developer-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--codex', '-u', 'welkon']);

    let projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    let developerMarker = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.developer'), 'utf8')
    );
    let status = cli.buildStatus();

    assert.deepEqual(projectConfig.developer, { name: 'welkon', runtime: 'codex' });
    assert.equal(developerMarker.name, 'welkon');
    assert.equal(developerMarker.runtime, 'codex');
    assert.deepEqual(status.developer, { name: 'welkon', runtime: 'codex' });

    cli.main(['init', '--claude', '-u', 'felix']);

    projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    developerMarker = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.developer'), 'utf8')
    );
    status = cli.buildStatus();

    assert.deepEqual(projectConfig.developer, { name: 'felix', runtime: 'claude' });
    assert.equal(developerMarker.name, 'felix');
    assert.equal(developerMarker.runtime, 'claude');
    assert.deepEqual(status.developer, { name: 'felix', runtime: 'claude' });

    cli.main(['init', '--cursor', '-u', 'cursor-dev']);

    projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    developerMarker = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.developer'), 'utf8')
    );
    status = cli.buildStatus();

    assert.deepEqual(projectConfig.developer, { name: 'cursor-dev', runtime: 'cursor' });
    assert.equal(developerMarker.name, 'cursor-dev');
    assert.equal(developerMarker.runtime, 'cursor');
    assert.deepEqual(status.developer, { name: 'cursor-dev', runtime: 'cursor' });
    assert.match(
      fs.readFileSync(path.join(tempProject, '.gitignore'), 'utf8'),
      /\.emb-agent\/\.developer/
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init-project auto-detects monorepo packages from pnpm workspace', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-monorepo-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    fs.writeFileSync(
      path.join(tempProject, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', ''].join('\n'),
      'utf8'
    );
    fs.mkdirSync(path.join(tempProject, 'packages', 'app'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'packages', 'fw'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: '@demo/app' }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, 'packages', 'fw', 'package.json'),
      JSON.stringify({ name: '@demo/fw' }, null, 2) + '\n',
      'utf8'
    );

    initProject.main(['--project', tempProject]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );

    assert.deepEqual(
      projectConfig.packages.map(item => ({ name: item.name, path: item.path, type: item.type, submodule: item.submodule })),
      [
        { name: 'app', path: 'packages/app', type: 'node', submodule: false },
        { name: 'fw', path: 'packages/fw', type: 'node', submodule: false }
      ]
    );
    assert.equal(projectConfig.default_package, 'app');
    assert.equal(projectConfig.active_package, 'app');

    process.chdir(tempProject);
    cli.main(['init']);
    const status = cli.buildStatus();
    assert.equal(status.default_package, 'app');
    assert.equal(status.active_package, 'app');
    assert.equal(Array.isArray(status.packages), true);
    assert.equal(status.packages.length, 2);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
