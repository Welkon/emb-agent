'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function readBootstrapTask(projectRoot) {
  return JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json'),
      'utf8'
    )
  );
}

test('init-project creates project defaults and defers note templates into a bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'rtos-iot',
      '--pack',
      'connected-appliance'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'rtos-iot');
    assert.deepEqual(projectConfig.active_packs, ['connected-appliance']);
    assert.deepEqual(projectConfig.adapter_sources, []);
    assert.deepEqual(projectConfig.executors, {});
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
    assert.equal(projectConfig.integrations.szlcsc.only_available, false);
    assert.equal(projectConfig.integrations.szlcsc.currency, '');
    assert.equal(projectConfig.integrations.szlcsc.timeout_ms, 15000);
    assert.deepEqual(projectConfig.arch_review.trigger_patterns, []);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'docs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'adapter-sources')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.developer')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.current-task')), true);
    assert.equal(fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8'), '');
    assert.equal(fs.existsSync(path.join(tempProject, 'src')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'README.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workflow.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'worktree.yaml')), false);
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
    assert.equal(bootstrapTask.title, 'Bootstrap project notes');
    assert.equal(bootstrapTask.dev_type, 'docs');
    assert.ok(bootstrapTask.relatedFiles.includes('.emb-agent/hw.yaml'));
    assert.ok(bootstrapTask.relatedFiles.includes('.emb-agent/req.yaml'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MCU-FOUNDATION-CHECKLIST.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/CONNECTIVITY.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/RELEASE-NOTES.md'));
    assert.match(bootstrapTask.notes, /Init now creates the minimum emb-agent project skeleton first/);

    process.chdir(tempProject);
    cli.main(['init']);

    const status = cli.buildStatus();
    assert.equal(status.project_profile, 'rtos-iot');
    assert.deepEqual(status.active_packs, ['connected-appliance']);
    assert.equal(status.preferences.truth_source_mode, 'hardware_first');
    assert.deepEqual(status.developer, { name: '', runtime: '' });
    assert.equal(status.project_defaults.project_profile, 'rtos-iot');
    assert.deepEqual(status.project_defaults.arch_review.trigger_patterns, []);
    assert.ok(Array.isArray(status.arch_review_triggers));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init-project with battery-charger pack adds deferred power charging note target to bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-battery-charger-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'baremetal-8bit',
      '--pack',
      'battery-charger'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-8bit');
    assert.deepEqual(projectConfig.active_packs, ['battery-charger']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'POWER-CHARGING.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/POWER-CHARGING.md'));
    assert.ok(bootstrapTask.subtasks.some(item => item.name.includes('docs/POWER-CHARGING.md')));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('init-project honors project-local smart-pillbox extension pack and template', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-smart-pillbox-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    const projectExtDir = runtime.initProjectLayout(tempProject);
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    registry.templates.push({
      name: 'medication-flow',
      source: 'templates/medication-flow.md.tpl',
      description: 'Project-local medication flow note.',
      default_output: 'docs/MEDICATION-FLOW.md'
    });
    registry.packs.push({
      name: 'smart-pillbox',
      file: 'packs/smart-pillbox.yaml',
      description: 'Project-local smart pillbox workflow pack.'
    });
    registry.specs.push({
      name: 'smart-pillbox-focus',
      title: 'Smart Pillbox Focus',
      path: 'specs/smart-pillbox-focus.md',
      summary: 'Project-local smart pillbox rules.',
      auto_inject: true,
      priority: 62,
      apply_when: {
        packs: ['smart-pillbox']
      }
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'packs', 'smart-pillbox.yaml'),
      [
        'name: smart-pillbox',
        'focus_areas:',
        '  - medication_schedule',
        '  - sync_reconciliation',
        'extra_review_axes:',
        '  - schedule_state_machine',
        'preferred_notes:',
        '  - docs/MEDICATION-FLOW.md',
        ''
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'smart-pillbox-focus.md'),
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
      'baremetal-8bit',
      '--pack',
      'smart-pillbox'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-8bit');
    assert.deepEqual(projectConfig.active_packs, ['smart-pillbox']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MEDICATION-FLOW.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MEDICATION-FLOW.md'));
    assert.ok(bootstrapTask.subtasks.some(item => item.name.includes('docs/MEDICATION-FLOW.md')));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('init-project with motor-drive pack adds deferred motor note targets to bootstrap task', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-motor-drive-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'baremetal-8bit',
      '--pack',
      'motor-drive'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = readBootstrapTask(tempProject);

    assert.equal(projectConfig.project_profile, 'baremetal-8bit');
    assert.deepEqual(projectConfig.active_packs, ['motor-drive']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MOTOR-CONTROL.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'POWER-STAGE.md')), false);
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MOTOR-CONTROL.md'));
    assert.ok(bootstrapTask.relatedFiles.includes('docs/POWER-STAGE.md'));
  } finally {
    process.stdout.write = originalWrite;
  }
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
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'adapter-sources')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.current-task')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workflow.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'worktree.yaml')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'workspace')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json')), true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init returns onboarding guidance for adapter setup', () => {
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
    assert.deepEqual(result.session.active_packs, []);
    assert.equal(projectConfig.project_profile, '');
    assert.deepEqual(projectConfig.active_packs, []);
    assert.equal(result.onboarding.hardware_identity_present, false);
    assert.equal(result.onboarding.existing_project_detected, false);
    assert.equal(result.onboarding.adapter_sources_registered, 0);
    assert.equal(result.onboarding.hardware_confirmation_required, false);
    assert.equal(result.onboarding.project_definition_required, true);
    assert.equal(result.onboarding.bootstrap_task.name, '00-bootstrap-project');
    assert.ok(result.next_steps.some(item => item.includes('Let the agent record goals, constraints, and any known interfaces in .emb-agent/req.yaml')));
    assert.ok(result.next_steps.some(item => item.includes('Keep .emb-agent/hw.yaml unknown until you have a real chip candidate')));
    assert.ok(result.next_steps.some(item => item.includes('Run next after the requirements are recorded so the agent can help narrow chip candidates.')));
    assert.ok(result.next_steps.some(item => item.includes('docs/ (recommended, not required)')));
    assert.equal(fs.existsSync(path.join(tempProject, 'src')), true);
    assert.ok(result.next_steps.some(item => item.includes('Optional: inspect deferred note targets with task show 00-bootstrap-project')));
    assert.ok(Array.isArray(result.onboarding.agent_actions));
    assert.ok(result.onboarding.agent_actions.some(item => item.kind === 'define-project-constraints'));
    assert.ok(
      result.onboarding.agent_actions.some(
        item => item.kind === 'bootstrap-adapters' && item.status === 'unconfigured'
      )
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init scans existing project inputs and suggests hardware confirmation before doc parse', () => {
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
    assert.equal(result.onboarding.existing_project_detected, true);
    assert.equal(result.onboarding.hardware_confirmation_required, true);
    assert.equal(result.onboarding.project_definition_required, false);
    assert.deepEqual(result.onboarding.hardware_candidates, []);
    assert.equal(result.onboarding.selected_identity, null);
    assert.equal(result.onboarding.doc_parse_suggestion.suggested, true);
    assert.equal(result.onboarding.doc_parse_suggestion.requires_hardware_confirmation, true);
    assert.ok(result.onboarding.doc_parse_suggestion.candidate_docs.includes('docs/PMS150G.pdf'));
    assert.ok(result.next_steps.some(item => item.includes('Let the agent confirm which chip and package this board uses in .emb-agent/hw.yaml')));
    assert.ok(result.next_steps.some(item => item.includes('let the agent inspect docs/PMS150G.pdf')));
    assert.ok(
      result.onboarding.agent_actions.some(
        item => item.kind === 'inspect-hardware-doc' && item.cli_fallback.includes('ingest doc --file docs/PMS150G.pdf')
      )
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init can show pin summary from confirmed chip profile without parsing docs', () => {
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
    assert.equal(result.onboarding.hardware_confirmation_required, false);
    assert.equal(result.onboarding.project_definition_required, false);
    assert.equal(result.onboarding.chip_profile.name, 'vendor-chip');
    assert.equal(result.onboarding.pin_summary.package, 'sop8');
    assert.ok(result.onboarding.pin_summary.usable_pins.some(item => item.signal === 'PA3'));
    assert.ok(result.onboarding.pin_summary.reserved_pins.some(item => item.signal === 'VDD'));
    assert.equal(result.onboarding.doc_parse_suggestion.suggested, false);
    assert.ok(result.next_steps.some(item => item.includes('Let the agent map board pins/peripherals into .emb-agent/hw.yaml')));
    assert.ok(result.next_steps.some(item => item.includes('Configure an adapter source, then run next')));
    assert.ok(
      result.onboarding.agent_actions.some(
        item => item.kind === 'declare-board-pins' && item.cli_fallback.includes('declare hardware --signal SIGNAL_NAME --dir input|output --auto-pin')
      )
    );
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
