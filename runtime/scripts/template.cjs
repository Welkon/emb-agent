#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const workflowRegistry = require(path.join(ROOT, 'lib', 'workflow-registry.cjs'));
const { applyTemplate } = require(path.join(ROOT, 'scripts', 'init-project.cjs'));

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'template';
}

function loadTemplates() {
  const registry = workflowRegistry.loadWorkflowRegistry(ROOT, {
    projectExtDir: runtime.getProjectExtDir(process.cwd())
  });
  return Object.fromEntries(
    registry.templates.map(entry => [
      entry.name,
      {
        name: entry.name,
        source: entry.scope === 'built-in'
          ? path.basename(entry.relative_file)
          : entry.relative_file,
        description: entry.description,
        default_output: entry.default_output,
        scope: entry.scope,
        sourcePath: entry.absolute_path
      }
    ])
  );
}

function getTemplateMeta(name) {
  const meta = loadTemplates()[name];
  if (!meta) {
    throw new Error(`unknown template: ${name}`);
  }
  return meta;
}

function readTemplateSource(name) {
  const meta = getTemplateMeta(name);
  return {
    ...meta,
    name,
    sourcePath: meta.sourcePath,
    content: fs.readFileSync(meta.sourcePath, 'utf8')
  };
}

function buildContext(extraFields = {}, projectRootArg = process.cwd()) {
  const projectRoot = path.resolve(projectRootArg || process.cwd());
  const projectName = extraFields.PROJECT_NAME || path.basename(projectRoot);
  const slug = extraFields.SLUG || extraFields.PROJECT_SLUG || slugify(projectName);
  const today = new Date().toISOString().slice(0, 10);
  return {
    DATE: today,
    ISO_DATE: today,
    PROJECT_ROOT: projectRoot,
    PROJECT_NAME: projectName,
    PROJECT_SLUG: slugify(projectName),
    SLUG: slug,
    USER: extraFields.USER || process.env.USER || process.env.USERNAME || '',
    BOARD_NAME: extraFields.BOARD_NAME || '',
    MCU_NAME: extraFields.MCU_NAME || '',
    RUNTIME: extraFields.RUNTIME || '',
    PROFILE_NAME: extraFields.PROFILE_NAME || slug,
    PACK_NAME: extraFields.PACK_NAME || slug,
    TOOL_NAME: extraFields.TOOL_NAME || slug,
    CHIP_NAME: extraFields.CHIP_NAME || slug,
    TASK_NAME: extraFields.TASK_NAME || slug,
    ...extraFields
  };
}

function resolveOutputPath(meta, outputArg, context, projectRoot) {
  const outputTemplate = outputArg || meta.default_output;
  if (!outputTemplate) {
    throw new Error(`template ${meta.name || 'unknown'} does not define a default output`);
  }
  return path.resolve(projectRoot, applyTemplate(outputTemplate, context));
}

function listCommand() {
  return Object.entries(loadTemplates())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, meta]) => ({ name, ...meta }));
}

function showCommand(name) {
  return readTemplateSource(name);
}

function fillCommand(name, outputArg = '', extraFields = {}, force = false) {
  const template = readTemplateSource(name);
  const projectRoot = process.cwd();
  const context = buildContext(extraFields, projectRoot);
  const outputPath = resolveOutputPath(template, outputArg, context, projectRoot);
  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`output already exists: ${path.relative(projectRoot, outputPath)}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, applyTemplate(template.content, context), 'utf8');
  return {
    created: path.relative(projectRoot, outputPath),
    template: name
  };
}

function parseFillArgs(args) {
  const result = {
    name: '',
    output: '',
    force: false,
    fields: {}
  };
  let outputSet = false;
  for (const arg of args) {
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    if (!result.name) {
      result.name = arg;
      continue;
    }
    if (!outputSet && !arg.includes('=')) {
      result.output = arg;
      outputSet = true;
      continue;
    }
    const separator = arg.indexOf('=');
    if (separator === -1) {
      throw new Error(`invalid field assignment: ${arg}`);
    }
    const key = arg.slice(0, separator).trim();
    const value = arg.slice(separator + 1);
    if (!key) {
      throw new Error(`invalid field assignment: ${arg}`);
    }
    result.fields[key] = value;
  }
  if (!result.name) {
    throw new Error('template name is required');
  }
  return result;
}

function runTemplateCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(
      [
        'template usage:',
        '  node scripts/template.cjs list',
        '  node scripts/template.cjs show <name>',
        '  node scripts/template.cjs fill <name> [output] [--force] [KEY=VALUE ...]'
      ].join('\n') + '\n'
    );
    return;
  }
  if (command === 'list') {
    process.stdout.write(JSON.stringify(listCommand(), null, 2) + '\n');
    return;
  }
  if (command === 'show') {
    if (!rest[0]) {
      throw new Error('template name is required');
    }
    const template = showCommand(rest[0]);
    process.stdout.write(JSON.stringify(template, null, 2) + '\n');
    return;
  }
  if (command === 'fill') {
    const parsed = parseFillArgs(rest);
    const result = fillCommand(parsed.name, parsed.output, parsed.fields, parsed.force);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  throw new Error(`unknown template command: ${command}`);
}

module.exports = {
  listCommand,
  showCommand,
  fillCommand,
  buildContext,
  applyTemplate,
  loadTemplates,
  runTemplateCli
};

if (require.main === module) {
  try {
    runTemplateCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`template error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
