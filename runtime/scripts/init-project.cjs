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
const BOOTSTRAP_TASK_NAME = '00-bootstrap-project';
const BOOTSTRAP_TASK_CHANNELS = ['implement', 'check', 'debug'];

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
  const project_profile = args.profile || '';
  if (project_profile) {
    loadBuiltInProfile(project_profile);
  }
  runtime.initProjectLayout(projectRoot);
  const workflowCatalog = loadWorkflowCatalog(projectRoot);

  const active_packs = runtime.unique((args.packs || []).filter(Boolean));

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
  const profile = projectConfig.project_profile
    ? loadBuiltInProfile(projectConfig.project_profile)
    : { notes_targets: [] };
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
    { output: runtime.getProjectAssetRelativePath('req.yaml'), template: 'req-truth' }
  ];
}

function buildBootstrapDocsPlan(projectRoot, projectConfig, registry) {
  return [
    { output: path.join('docs', 'MCU-FOUNDATION-CHECKLIST.md'), template: 'mcu-foundation-checklist' },
    ...buildDocsPlan(projectRoot, projectConfig, registry)
  ];
}

function buildTaskId(timestamp, slug) {
  const date = String(timestamp || new Date().toISOString()).slice(5, 10);
  return `${date.replace('-', '-')}-${slug}`;
}

function buildBootstrapTaskNotes(projectConfig, docsPlan) {
  const noteTargets = docsPlan.map(item => item.output);

  return [
    'Bootstrap checklist created by init-project.',
    'Init now creates the minimum emb-agent project skeleton first; note templates are deferred until you decide they are needed.',
    '',
    'Suggested order:',
    '1. Confirm which chip and package this board uses in .emb-agent/hw.yaml. Example: SC8F072 + SOP8.',
    '2. Confirm goals and constraints in .emb-agent/req.yaml.',
    '3. Fill only the note templates that matter for this project.',
    `4. Continue with ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])}.`,
    '',
    `Project profile: ${projectConfig.project_profile || '-'}`,
    `Active packs: ${projectConfig.active_packs.join(', ') || '-'}`,
    '',
    'Deferred note targets:',
    ...noteTargets.map(target => `- ${target}`)
  ].join('\n');
}

function buildBootstrapTaskSubtasks(docsPlan) {
  return [
    {
      name: 'Confirm which chip and package the board uses in .emb-agent/hw.yaml',
      status: 'pending'
    },
    {
      name: 'Confirm goals and constraints in .emb-agent/req.yaml',
      status: 'pending'
    },
    ...docsPlan.map(item => ({
      name: `Decide whether to create ${item.output}`,
      status: 'pending'
    }))
  ];
}

function writeJsonl(filePath, entries) {
  const lines = (entries || []).map(entry => JSON.stringify(entry));
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}

function ensureBootstrapTask(projectRoot, projectConfig, docsPlan, force) {
  const taskDir = path.join(runtime.getProjectExtDir(projectRoot), 'tasks', BOOTSTRAP_TASK_NAME);
  const taskPath = path.join(taskDir, 'task.json');
  const existedBefore = fs.existsSync(taskPath);
  const relatedFiles = runtime.unique([
    runtime.getProjectAssetRelativePath('hw.yaml'),
    runtime.getProjectAssetRelativePath('req.yaml'),
    ...docsPlan.map(item => item.output)
  ]);
  const now = new Date().toISOString();
  const developer = runtime.validateDeveloperConfig(projectConfig.developer || {});
  const manifest = {
    id: buildTaskId(now, BOOTSTRAP_TASK_NAME),
    name: BOOTSTRAP_TASK_NAME,
    title: 'Bootstrap project notes',
    description: 'Review minimum project truth and decide which note templates should be created next.',
    status: 'planning',
    dev_type: 'docs',
    scope: 'bootstrap',
    priority: 'P1',
    creator: developer.name,
    assignee: developer.name,
    createdAt: now,
    completedAt: null,
    branch: '',
    base_branch: 'main',
    worktree_path: null,
    current_phase: 1,
    next_action: [
      { phase: 1, action: 'implement' },
      { phase: 2, action: 'check' },
      { phase: 3, action: 'finish' },
      { phase: 4, action: 'create-pr' }
    ],
    commit: '',
    pr_url: '',
    subtasks: buildBootstrapTaskSubtasks(docsPlan),
    relatedFiles,
    notes: buildBootstrapTaskNotes(projectConfig, docsPlan),
    type: 'implement',
    goal: 'Bootstrap project notes and truth sources',
    focus: '',
    references: relatedFiles,
    open_questions: [],
    known_risks: [],
    bindings: {
      hardware: {
        identity: {
          vendor: '',
          model: '',
          package: '',
          file: runtime.getProjectAssetRelativePath('hw.yaml')
        },
        chip_profile: null
      },
      docs: [],
      adapters: [],
      tools: []
    },
    injected_specs: [],
    context: Object.fromEntries(
      BOOTSTRAP_TASK_CHANNELS.map(channel => [
        channel,
        path.relative(projectRoot, path.join(taskDir, `${channel}.jsonl`)).replace(/\\/g, '/')
      ])
    ),
    created_at: now,
    updated_at: now,
    updatedAt: now
  };

  const contextEntries = {
    implement: [
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('hw.yaml'),
        reason: 'Confirm hardware truth first'
      },
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: 'Confirm project goal and constraints'
      },
      ...docsPlan.map(item => ({
        kind: 'file',
        path: item.output,
        reason: `Deferred template target (${item.template})`
      }))
    ],
    check: [
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('hw.yaml'),
        reason: 'Verify hardware truth stayed current'
      },
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: 'Verify requirements truth stayed current'
      }
    ],
    debug: docsPlan.map(item => ({
      kind: 'file',
      path: item.output,
      reason: 'Create only if a debugging or workflow gap appears'
    }))
  };

  if (existedBefore && !force) {
    return {
      name: BOOTSTRAP_TASK_NAME,
      path: path.relative(projectRoot, taskPath).replace(/\\/g, '/'),
      created: false,
      updated: false,
      reused: true,
      related_files: relatedFiles
    };
  }

  ensureDir(taskDir);
  runtime.writeJson(taskPath, manifest);
  BOOTSTRAP_TASK_CHANNELS.forEach(channel => {
    writeJsonl(path.join(taskDir, `${channel}.jsonl`), contextEntries[channel]);
  });

  return {
    name: BOOTSTRAP_TASK_NAME,
    path: path.relative(projectRoot, taskPath).replace(/\\/g, '/'),
    created: !existedBefore,
    updated: existedBefore && force,
    reused: false,
    related_files: relatedFiles
  };
}

function scaffoldProject(projectRoot, projectConfig, force, options) {
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  const projectConfigDir = runtime.initProjectLayout(projectRoot);
  const projectConfigPath = path.join(projectConfigDir, 'project.json');
  const developerPath = path.join(projectConfigDir, '.developer');
  const currentTaskPath = path.join(projectConfigDir, '.current-task');
  const srcDirPath = path.join(projectRoot, 'src');
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

  if (!fs.existsSync(srcDirPath)) {
    ensureDir(srcDirPath);
    created.push(path.relative(projectRoot, srcDirPath));
  } else if (fs.statSync(srcDirPath).isDirectory()) {
    reused.push(path.relative(projectRoot, srcDirPath));
  } else {
    throw new Error(`src path exists but is not a directory: ${srcDirPath}`);
  }

  const context = buildTemplateContext(projectRoot, effectiveProjectConfig);
  const workflowCatalog = loadWorkflowCatalog(projectRoot);
  const templateIndex = buildTemplateIndex(workflowCatalog);
  const truthPlan = buildTruthPlan();
  const bootstrapDocsPlan = buildBootstrapDocsPlan(projectRoot, effectiveProjectConfig, workflowCatalog);

  for (const item of truthPlan) {
    const outputPath = path.join(projectRoot, item.output);
    if (createTemplateFile(item.template, outputPath, context, force, templateIndex.byName)) {
      created.push(path.relative(projectRoot, outputPath));
    } else {
      reused.push(path.relative(projectRoot, outputPath));
    }
  }

  const bootstrapTask = ensureBootstrapTask(projectRoot, effectiveProjectConfig, bootstrapDocsPlan, force);
  if (bootstrapTask.created) {
    created.push(bootstrapTask.path);
  } else if (bootstrapTask.updated) {
    updated.push(bootstrapTask.path);
  } else {
    reused.push(bootstrapTask.path);
  }

  return {
    project_root: projectRoot,
    project_config: path.relative(projectRoot, projectConfigPath),
    defaults: effectiveProjectConfig,
    bootstrap_task: bootstrapTask,
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
          `Ask the agent to confirm which chip and package the board uses in ${runtime.getProjectAssetRelativePath('hw.yaml')}. If you only know the top marking, datasheet, BOM, or board photo, provide that first.`,
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
  buildBootstrapDocsPlan,
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
