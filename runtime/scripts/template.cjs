#!/usr/bin/env node

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const CONFIG_PATH = path.join(TEMPLATES_DIR, 'config.json');
const fs = require('fs');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);

function usage() {
  process.stdout.write(
    [
      'template usage:',
      '  node scripts/template.cjs list',
      '  node scripts/template.cjs show <name>',
      '  node scripts/template.cjs fill <name> [--output <path>] [--field KEY=VALUE] [--force]'
    ].join('\n') + '\n'
  );
}

function loadProjectSession(cwd) {
  const paths = runtime.getProjectStatePaths(ROOT, cwd, RUNTIME_CONFIG);
  runtime.ensureProjectStateStorage(paths);
  const projectConfig = runtime.loadProjectConfig(cwd, RUNTIME_CONFIG);
  const sessionPath = paths.sessionPath;
  if (fs.existsSync(sessionPath)) {
    return runtime.normalizeSession(runtime.readJson(sessionPath), paths, RUNTIME_CONFIG, projectConfig);
  }
  return runtime.loadDefaultSession(ROOT, paths, RUNTIME_CONFIG, projectConfig);
}

function parseArgs(argv) {
  const result = {
    cmd: argv[0] || '',
    name: argv[1] || '',
    output: '',
    force: false,
    fields: {}
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--output') {
      result.output = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (token === '--field') {
      const pair = argv[index + 1] || '';
      index += 1;
      const separator = pair.indexOf('=');
      if (separator === -1) {
        throw new Error(`Invalid --field: ${pair}`);
      }
      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      result.fields[key] = value;
      continue;
    }

    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return result;
}

function loadTemplates() {
  return runtime.validateTemplateConfig(runtime.readJson(CONFIG_PATH));
}

function buildContext(extraFields) {
  const cwd = process.cwd();
  const context = {
    DATE: new Date().toISOString().slice(0, 10),
    PROJECT_NAME: path.basename(cwd),
    BOARD_NAME: '',
    MCU_NAME: '',
    TARGET_NAME: '',
    PROFILE: '',
    PACKS: '',
    VERSION: '',
    SLUG: 'new-item',
    TOOL_NAME: 'timer-calc',
    FAMILY_NAME: 'vendor-family',
    DEVICE_NAME: 'vendor-device',
    CHIP_NAME: 'vendor-chip',
    ADAPTER_NAME: 'vendor-tool-adapter',
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
    REQ_UNKNOWN_1: 'Customer or production requirements still need confirmation'
  };

  try {
    const session = loadProjectSession(cwd);
      context.PROFILE = session.project_profile || RUNTIME_CONFIG.default_profile;
      context.PACKS = Array.isArray(session.active_packs) ? session.active_packs.join(',') : '';
  } catch {
    // ignore invalid session
  }

  return {
    ...context,
    ...extraFields
  };
}

function applyTemplate(content, context) {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : '';
  });
}

function resolveOutputPath(templateMeta, context, outputArg) {
  const output = outputArg || templateMeta.default_output || '';
  if (!output) {
    throw new Error('Template output path not configured');
  }

  const rendered = applyTemplate(output, context);
  return path.resolve(process.cwd(), rendered);
}

function listCommand() {
  const templates = loadTemplates();
  const result = Object.entries(templates)
    .map(([name, meta]) => ({
      name,
      description: meta.description,
      default_output: meta.default_output || ''
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function showCommand(name) {
  if (!name) throw new Error('Missing template name');
  const templates = loadTemplates();
  const meta = templates[name];
  if (!meta) throw new Error(`Template not found: ${name}`);

  const sourcePath = path.join(TEMPLATES_DIR, meta.source);
  const context = buildContext({});
  const content = applyTemplate(runtime.readText(sourcePath), context);

  process.stdout.write(JSON.stringify({
    name,
    source: meta.source,
    description: meta.description,
    default_output: meta.default_output || '',
    preview: content
  }, null, 2) + '\n');
}

function fillCommand(name, outputArg, extraFields, force) {
  if (!name) throw new Error('Missing template name');
  const templates = loadTemplates();
  const meta = templates[name];
  if (!meta) throw new Error(`Template not found: ${name}`);

  const context = buildContext(extraFields);
  const sourcePath = path.join(TEMPLATES_DIR, meta.source);
  const outputPath = resolveOutputPath(meta, context, outputArg);
  const content = applyTemplate(runtime.readText(sourcePath), context);

  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`Output already exists: ${outputPath}`);
  }

  runtime.ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, content, 'utf8');

  process.stdout.write(JSON.stringify({
    created: path.relative(process.cwd(), outputPath),
    template: name
  }, null, 2) + '\n');
}

function runTemplateCli(argv) {
  const args = parseArgs(argv || process.argv.slice(2));

  if (!args.cmd || args.cmd === '--help' || args.cmd === 'help') {
    usage();
    return;
  }

  if (args.cmd === 'list') {
    listCommand();
    return;
  }

  if (args.cmd === 'show') {
    showCommand(args.name);
    return;
  }

  if (args.cmd === 'fill') {
    fillCommand(args.name, args.output, args.fields, args.force);
    return;
  }

  throw new Error(`Unknown template command: ${args.cmd}`);
}

module.exports = {
  applyTemplate,
  buildContext,
  loadTemplates,
  runTemplateCli,
  listCommand,
  showCommand,
  fillCommand
};

if (require.main === module) {
  try {
    runTemplateCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`template error: ${error.message}\n`);
    process.exit(1);
  }
}
