#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const runtimeHostHelpers = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const workflowRegistry = require(path.join(ROOT, 'lib', 'workflow-registry.cjs'));

const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHost(ROOT);

function usage() {
  process.stdout.write(
    [
      'init-project usage:',
      '  node scripts/init-project.cjs',
      '  node scripts/init-project.cjs --project <repo-root>',
      '  node scripts/init-project.cjs --project <repo-root> --profile <name> [--pack <name> ...] [--runtime <codex|claude>|--codex|--claude] [-u <name>]',
      '  node scripts/init-project.cjs --force'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    profile: '',
    packs: [],
    runtime: '',
    runtimeSet: false,
    user: '',
    userSet: false,
    force: false,
    help: false
  };

  function setRuntime(value, token) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      throw new Error(`Missing value after ${token}`);
    }
    if (!['codex', 'claude'].includes(normalized)) {
      throw new Error(`Unsupported runtime: ${value}`);
    }
    if (result.runtimeSet && result.runtime !== normalized) {
      throw new Error(`Conflicting runtime options: ${result.runtime} vs ${normalized}`);
    }
    result.runtime = normalized;
    result.runtimeSet = true;
  }

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
    if (token === '--runtime') {
      setRuntime(argv[index + 1] || '', '--runtime');
      index += 1;
      continue;
    }
    if (token === '--codex') {
      setRuntime('codex', '--codex');
      continue;
    }
    if (token === '--claude') {
      setRuntime('claude', '--claude');
      continue;
    }
    if (token === '--user' || token === '-u') {
      result.user = argv[index + 1] || '';
      result.userSet = true;
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
  if ((argv.includes('--user') || argv.includes('-u')) && !result.user) {
    throw new Error('Missing name after --user/-u');
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

function loadWorkflowCatalog(projectRoot) {
  return workflowRegistry.loadWorkflowRegistry(ROOT, {
    projectExtDir: runtime.getProjectExtDir(projectRoot)
  });
}

function loadPackForProject(projectRoot, name, registry) {
  const catalog = registry || loadWorkflowCatalog(projectRoot);
  const entry = (catalog.packs || []).find(item => item.name === name);
  if (!entry || !entry.absolute_path) {
    throw new Error(`Pack not found: ${name}`);
  }
  return runtime.validatePack(name, runtime.parseSimpleYaml(entry.absolute_path));
}

function buildTemplateIndex(registry) {
  const templates = (registry && Array.isArray(registry.templates)) ? registry.templates : [];
  const byName = {};
  const byOutput = {};

  templates.forEach(entry => {
    if (!entry || !entry.name || !entry.absolute_path) {
      return;
    }
    byName[entry.name] = entry;
    if (entry.default_output) {
      byOutput[entry.default_output] = entry.name;
    }
  });

  return {
    byName,
    byOutput
  };
}

function applyTemplate(content, context) {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : '';
  });
}

function buildTemplateContext(projectRoot, projectConfig) {
  const developer = runtime.validateDeveloperConfig(projectConfig.developer || {});
  return {
    DATE: new Date().toISOString().slice(0, 10),
    PROJECT_NAME: path.basename(projectRoot),
    BOARD_NAME: '',
    MCU_NAME: '',
    TARGET_NAME: '',
    PROFILE: projectConfig.project_profile,
    PACKS: projectConfig.active_packs.join(','),
    VERSION: String(RUNTIME_CONFIG.session_version || 1),
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
    GOAL_1: 'Define the first deliverable target for the current project',
    FEATURE_1: 'Complete the most critical board-level behavior or feature closure',
    REQ_CONSTRAINT_1: 'Prefer reusing the existing codebase and hardware truth before expanding architecture',
    ACCEPTANCE_1: 'The current goal can be confirmed at board level or through a minimal verification path',
    FAILURE_POLICY_1: 'When hardware or requirements are unconfirmed, record an unknown first instead of guessing',
    REQ_UNKNOWN_1: 'Customer or production requirements still need confirmation',
    DEVELOPER_NAME: developer.name,
    DEVELOPER_RUNTIME: developer.runtime
  };
}

function createTemplateFile(templateName, outputPath, context, force, templatesByName) {
  const meta =
    templatesByName && Object.prototype.hasOwnProperty.call(templatesByName, templateName)
      ? templatesByName[templateName]
      : null;
  if (!meta || !meta.absolute_path) {
    throw new Error(`Template not found: ${templateName}`);
  }

  if (fs.existsSync(outputPath) && !force) {
    return false;
  }

  const content = applyTemplate(
    runtime.readText(meta.absolute_path),
    context
  );
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, content, 'utf8');
  return true;
}

function buildProjectConfig(projectRoot, args) {
  const project_profile = args.profile || RUNTIME_CONFIG.default_profile;
  loadBuiltInProfile(project_profile);
  runtime.initProjectLayout(projectRoot);
  const workflowCatalog = loadWorkflowCatalog(projectRoot);

  const active_packs = runtime.unique(
    (args.packs.length > 0 ? args.packs : RUNTIME_CONFIG.default_packs).filter(Boolean)
  );

  active_packs.forEach(name => loadPackForProject(projectRoot, name, workflowCatalog));

  return runtime.validateProjectConfig(
    {
      project_profile,
      active_packs,
      adapter_sources: [],
      executors: {},
      quality_gates: {
        required_executors: [],
        required_signoffs: []
      },
      developer: {
        name: args.user || (RUNTIME_CONFIG.developer && RUNTIME_CONFIG.developer.name) || '',
        runtime: args.runtime || (RUNTIME_CONFIG.developer && RUNTIME_CONFIG.developer.runtime) || ''
      },
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

function ensureGitignoreRule(projectRoot, rule) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const normalizedRule = String(rule || '').trim().replace(/\\/g, '/');
  if (!normalizedRule) {
    return;
  }

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${normalizedRule}\n`, 'utf8');
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const lines = content.split(/\r?\n/).map(item => item.trim());
  if (lines.includes(normalizedRule)) {
    return;
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n');
  fs.writeFileSync(
    gitignorePath,
    `${content}${needsNewline ? '\n' : ''}${normalizedRule}\n`,
    'utf8'
  );
}

function buildDocsPlan(projectRoot, projectConfig, registry) {
  const profile = loadBuiltInProfile(projectConfig.project_profile);
  const workflowCatalog = registry || loadWorkflowCatalog(projectRoot);
  const packs = projectConfig.active_packs.map(name => loadPackForProject(projectRoot, name, workflowCatalog));
  const noteTargets = runtime.unique([
    ...(profile.notes_targets || []),
    ...packs.flatMap(pack => pack.preferred_notes || [])
  ]);

  const { byOutput } = buildTemplateIndex(workflowCatalog);

  return noteTargets
    .map(target => ({
      output: target,
      template: byOutput[target] || ''
    }))
    .filter(item => item.template);
}

function buildTruthPlan() {
  return [
    { output: runtime.getProjectAssetRelativePath('hw.yaml'), template: 'hw-truth' },
    { output: runtime.getProjectAssetRelativePath('req.yaml'), template: 'req-truth' },
    { output: path.join('docs', 'MCU-FOUNDATION-CHECKLIST.md'), template: 'mcu-foundation-checklist' }
  ];
}

function scaffoldProject(projectRoot, projectConfig, force, options) {
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  const projectConfigDir = runtime.initProjectLayout(projectRoot);
  const projectConfigPath = path.join(projectConfigDir, 'project.json');
  const developerPath = path.join(projectConfigDir, '.developer');
  const currentTaskPath = path.join(projectConfigDir, '.current-task');
  const initOptions = options || {};
  const shouldUpdateDeveloper = Boolean(initOptions.userSet || initOptions.runtimeSet);

  const created = [];
  const updated = [];
  const reused = [];
  let effectiveProjectConfig = projectConfig;

  if (!fs.existsSync(projectConfigPath) || force) {
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');
    created.push(path.relative(projectRoot, projectConfigPath));
  } else {
    if (shouldUpdateDeveloper) {
      const existing = runtime.validateProjectConfig(runtime.readJson(projectConfigPath), RUNTIME_CONFIG);
      const nextDeveloper = runtime.validateDeveloperConfig({
        ...(existing.developer || {}),
        ...(initOptions.userSet ? { name: initOptions.user || '' } : {}),
        ...(initOptions.runtimeSet ? { runtime: initOptions.runtime || '' } : {})
      });
      effectiveProjectConfig = runtime.validateProjectConfig(
        {
          ...existing,
          developer: nextDeveloper
        },
        RUNTIME_CONFIG
      );
      fs.writeFileSync(projectConfigPath, JSON.stringify(effectiveProjectConfig, null, 2) + '\n', 'utf8');
      updated.push(path.relative(projectRoot, projectConfigPath));
    } else {
      reused.push(path.relative(projectRoot, projectConfigPath));
    }
  }

  const developerPayload = runtime.validateDeveloperConfig(
    (effectiveProjectConfig && effectiveProjectConfig.developer) || {}
  );
  const developerExisted = fs.existsSync(developerPath);
  const shouldWriteDeveloperMarker = force || shouldUpdateDeveloper || !developerExisted;

  if (shouldWriteDeveloperMarker) {
    fs.writeFileSync(
      developerPath,
      JSON.stringify(
        {
          name: developerPayload.name,
          runtime: developerPayload.runtime,
          updated_at: new Date().toISOString()
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    if (developerExisted) {
      updated.push(path.relative(projectRoot, developerPath));
    } else {
      created.push(path.relative(projectRoot, developerPath));
    }
  } else {
    reused.push(path.relative(projectRoot, developerPath));
  }

  ensureGitignoreRule(projectRoot, runtime.getProjectAssetRelativePath('.developer'));

  const currentTaskExisted = fs.existsSync(currentTaskPath);
  if (!currentTaskExisted || force) {
    fs.writeFileSync(currentTaskPath, '', 'utf8');
    if (currentTaskExisted) {
      updated.push(path.relative(projectRoot, currentTaskPath));
    } else {
      created.push(path.relative(projectRoot, currentTaskPath));
    }
  } else {
    reused.push(path.relative(projectRoot, currentTaskPath));
  }

  const context = buildTemplateContext(projectRoot, effectiveProjectConfig);
  const workflowCatalog = loadWorkflowCatalog(projectRoot);
  const templateIndex = buildTemplateIndex(workflowCatalog);
  const docsPlan = buildDocsPlan(projectRoot, effectiveProjectConfig, workflowCatalog);
  const truthPlan = buildTruthPlan();

  for (const item of [...truthPlan, ...docsPlan]) {
    const outputPath = path.join(projectRoot, item.output);
    if (createTemplateFile(item.template, outputPath, context, force, templateIndex.byName)) {
      created.push(path.relative(projectRoot, outputPath));
    } else {
      reused.push(path.relative(projectRoot, outputPath));
    }
  }

  return {
    project_root: projectRoot,
    project_config: path.relative(projectRoot, projectConfigPath),
    defaults: effectiveProjectConfig,
    created,
    updated,
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
  const projectConfig = buildProjectConfig(projectRoot, args);
  const result = scaffoldProject(projectRoot, projectConfig, args.force, args);

  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        next_steps: [
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['declare', 'hardware', '--mcu', '<name>', '--package', '<name>']),
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
  applyTemplate,
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
