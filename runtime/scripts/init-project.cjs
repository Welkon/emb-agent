#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const runtimeHostHelpers = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));

const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHost(ROOT);
const TEMPLATE_CONFIG = runtime.validateTemplateConfig(
  runtime.readJson(path.join(TEMPLATES_DIR, 'config.json'))
);

function usage() {
  process.stdout.write(
    [
      'init-project usage:',
      '  node scripts/init-project.cjs',
      '  node scripts/init-project.cjs --project <repo-root>',
      '  node scripts/init-project.cjs --project <repo-root> --profile <name> [--pack <name> ...]',
      '  node scripts/init-project.cjs --force'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    profile: '',
    packs: [],
    force: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--profile') {
      result.profile = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--pack') {
      result.packs.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (argv.includes('--project') && !result.project) {
    throw new Error('Missing path after --project');
  }
  if (argv.includes('--profile') && !result.profile) {
    throw new Error('Missing name after --profile');
  }
  if (result.packs.includes('')) {
    throw new Error('Missing name after --pack');
  }

  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadBuiltInProfile(name) {
  return runtime.validateProfile(
    name,
    runtime.parseSimpleYaml(path.join(ROOT, 'profiles', `${name}.yaml`))
  );
}

function loadBuiltInPack(name) {
  return runtime.validatePack(
    name,
    runtime.parseSimpleYaml(path.join(ROOT, 'packs', `${name}.yaml`))
  );
}

function applyTemplate(content, context) {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : '';
  });
}

function buildTemplateContext(projectRoot, projectConfig) {
  return {
    DATE: new Date().toISOString().slice(0, 10),
    PROJECT_NAME: path.basename(projectRoot),
    BOARD_NAME: '',
    MCU_NAME: '',
    TARGET_NAME: '',
    PROFILE: projectConfig.project_profile,
    PACKS: projectConfig.active_packs.join(','),
    VERSION: '',
    SLUG: 'new-item',
    RUNTIME_MODEL: 'main_loop_plus_isr',
    CONCURRENCY_MODEL: 'interrupt_shared_state',
    RESOURCE_1: 'rom',
    RESOURCE_2: 'ram',
    SEARCH_1: 'hardware_truth',
    SEARCH_2: 'entry_points',
    GUARDRAIL_1: 'thin_isr',
    GUARDRAIL_2: 'prefer_direct_state',
    AXIS_1: 'timing_path',
    AXIS_2: 'shared_state',
    NOTE_TARGET_1: 'docs/DEBUG-NOTES.md',
    NOTE_TARGET_2: 'docs/HARDWARE-LOGIC.md',
    AGENT_1: 'hw-scout',
    AGENT_2: 'fw-doer',
    FOCUS_1: 'timing',
    FOCUS_2: 'signal_integrity',
    SIGNAL_1: 'INPUT_1',
    PIN_1: 'PA0',
    DIR_1: 'input',
    STATE_1: 'pull-high',
    NOTE_1: '',
    SIGNAL_2: 'OUTPUT_1',
    PIN_2: 'PA1',
    DIR_2: 'output',
    STATE_2: 'low',
    NOTE_2: '',
    GOAL_1: '明确当前项目的首个可交付目标',
    FEATURE_1: '补齐当前最关键的板级行为或功能闭环',
    REQ_CONSTRAINT_1: '优先复用现有工程和硬件真值，不先扩架构',
    ACCEPTANCE_1: '当前目标在板级或最小验证路径上可确认',
    FAILURE_POLICY_1: '遇到未确认硬件或需求时先记录 unknown，不直接假设',
    REQ_UNKNOWN_1: '客户或量产需求仍待确认'
  };
}

function createTemplateFile(templateName, outputPath, context, force) {
  const meta = TEMPLATE_CONFIG[templateName];
  if (!meta) {
    throw new Error(`Template not found: ${templateName}`);
  }

  if (fs.existsSync(outputPath) && !force) {
    return false;
  }

  const content = applyTemplate(
    runtime.readText(path.join(TEMPLATES_DIR, meta.source)),
    context
  );
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, content, 'utf8');
  return true;
}

function buildProjectConfig(args) {
  const project_profile = args.profile || RUNTIME_CONFIG.default_profile;
  loadBuiltInProfile(project_profile);

  const active_packs = runtime.unique(
    (args.packs.length > 0 ? args.packs : RUNTIME_CONFIG.default_packs).filter(Boolean)
  );

  active_packs.forEach(loadBuiltInPack);

  return runtime.validateProjectConfig(
    {
      project_profile,
      active_packs,
      adapter_sources: [],
      preferences: RUNTIME_CONFIG.default_preferences,
      arch_review: {
        trigger_patterns: []
      },
      integrations: {
        mineru: {
          mode: 'auto',
          base_url: '',
          api_key: '',
          api_key_env: 'MINERU_API_KEY',
          model_version: '',
          language: 'ch',
          enable_table: true,
          is_ocr: false,
          enable_formula: true,
          poll_interval_ms: 3000,
          timeout_ms: 300000,
          auto_api_page_threshold: 12,
          auto_api_file_size_kb: 4096
        }
      }
    },
    RUNTIME_CONFIG
  );
}

function buildDocsPlan(projectConfig) {
  const profile = loadBuiltInProfile(projectConfig.project_profile);
  const packs = projectConfig.active_packs.map(loadBuiltInPack);
  const noteTargets = runtime.unique([
    ...(profile.notes_targets || []),
    ...packs.flatMap(pack => pack.preferred_notes || [])
  ]);

  const byOutput = Object.entries(TEMPLATE_CONFIG).reduce((acc, [name, meta]) => {
    if (meta.default_output) {
      acc[meta.default_output] = name;
    }
    return acc;
  }, {});

  return noteTargets
    .map(target => ({
      output: target,
      template: byOutput[target] || ''
    }))
    .filter(item => item.template);
}

function buildTruthPlan() {
  return [
    { output: 'emb-agent/hw.yaml', template: 'hw-truth' },
    { output: 'emb-agent/req.yaml', template: 'req-truth' }
  ];
}

function scaffoldProject(projectRoot, projectConfig, force) {
  const projectConfigDir = path.join(projectRoot, 'emb-agent');
  const projectConfigPath = path.join(projectConfigDir, 'project.json');

  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  ensureDir(projectConfigDir);
  ensureDir(path.join(projectConfigDir, 'cache'));
  ensureDir(path.join(projectConfigDir, 'cache', 'docs'));
  ensureDir(path.join(projectConfigDir, 'cache', 'adapter-sources'));
  ensureDir(path.join(projectConfigDir, 'profiles'));
  ensureDir(path.join(projectConfigDir, 'packs'));
  ensureDir(path.join(projectConfigDir, 'adapters'));
  ensureDir(path.join(projectRoot, 'docs'));

  const created = [];
  const reused = [];

  if (!fs.existsSync(projectConfigPath) || force) {
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');
    created.push(path.relative(projectRoot, projectConfigPath));
  } else {
    reused.push(path.relative(projectRoot, projectConfigPath));
  }

  const context = buildTemplateContext(projectRoot, projectConfig);
  const docsPlan = buildDocsPlan(projectConfig);
  const truthPlan = buildTruthPlan();

  for (const item of [...truthPlan, ...docsPlan]) {
    const outputPath = path.join(projectRoot, item.output);
    if (createTemplateFile(item.template, outputPath, context, force)) {
      created.push(path.relative(projectRoot, outputPath));
    } else {
      reused.push(path.relative(projectRoot, outputPath));
    }
  }

  return {
    project_root: projectRoot,
    project_config: path.relative(projectRoot, projectConfigPath),
    defaults: projectConfig,
    created,
    reused
  };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const projectRoot = path.resolve(args.project || process.cwd());
  const projectConfig = buildProjectConfig(args);
  const result = scaffoldProject(projectRoot, projectConfig, args.force);

  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        next_steps: [
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['init']),
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['status']),
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])
        ]
      },
      null,
      2
    ) + '\n'
  );
}

module.exports = {
  buildDocsPlan,
  buildTruthPlan,
  buildProjectConfig,
  buildTemplateContext,
  scaffoldProject,
  main,
  parseArgs
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`init-project error: ${error.message}\n`);
    process.exit(1);
  }
}
