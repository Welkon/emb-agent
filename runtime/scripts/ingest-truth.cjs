#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const templateCli = require(path.join(ROOT, 'scripts', 'template.cjs'));
const attachProject = require(path.join(ROOT, 'scripts', 'attach-project.cjs'));

function usage() {
  process.stdout.write(
    [
      'ingest-truth usage:',
      '  node scripts/ingest-truth.cjs hardware [--mcu <name>] [--board <name>] [--target <name>]',
      '    [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>] [--force]',
      '  node scripts/ingest-truth.cjs requirements [--goal <text>] [--feature <text>] [--constraint <text>]',
      '    [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>] [--force]'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    domain: argv[0] || '',
    project: '',
    force: false,
    mcu: '',
    package: '',
    board: '',
    target: '',
    truths: [],
    constraints: [],
    unknowns: [],
    sources: [],
    goals: [],
    features: [],
    acceptance: [],
    failurePolicy: [],
    help: false
  };

  for (let index = 1; index < argv.length; index += 1) {
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
    if (token === '--mcu') {
      result.mcu = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--package') {
      result.package = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--board') {
      result.board = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--target') {
      result.target = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--truth') {
      result.truths.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--constraint') {
      result.constraints.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--unknown') {
      result.unknowns.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--source') {
      result.sources.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--goal') {
      result.goals.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--feature') {
      result.features.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--accept') {
      result.acceptance.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--failure') {
      result.failurePolicy.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!['hardware', 'requirements'].includes(result.domain)) {
    throw new Error(`Unknown ingest domain: ${result.domain}`);
  }

  return result;
}

function ensureTemplateFile(projectRoot, templateName) {
  const templates = templateCli.loadTemplates();
  const meta = templates[templateName];
  if (!meta) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const outputPath = path.resolve(projectRoot, meta.default_output);
  if (!fs.existsSync(outputPath)) {
    templateCli.fillCommand(templateName, meta.default_output, {}, true);
  }
  return outputPath;
}

function normalizeExistingList(lines, start, end, itemIndent, placeholders) {
  const ignored = new Set([
    '""',
    "''",
    ...((placeholders || []).map(item => JSON.stringify(item))),
    ...(placeholders || [])
  ]);

  return lines
    .slice(start + 1, end)
    .map(line => line.replace(`${itemIndent}- `, '').trim())
    .filter(item => item && !ignored.has(item));
}

function appendListBlock(content, keyLine, itemIndent, values, placeholders) {
  if (!values || values.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return content;
  }

  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(`${itemIndent}- `)) {
    end += 1;
  }

  const existing = normalizeExistingList(lines, start, end, itemIndent, placeholders);
  const merged = runtime.unique([...existing, ...values.filter(Boolean)]);
  const nextItems = merged.length > 0
    ? merged.map(value => `${itemIndent}- ${JSON.stringify(value)}`)
    : [`${itemIndent}- ""`];

  lines.splice(start + 1, end - (start + 1), ...nextItems);
  return lines.join('\n');
}

function ingestHardware(projectRoot, args) {
  const filePath = ensureTemplateFile(projectRoot, 'hw-truth');
  let content = runtime.readText(filePath);

  content = attachProject.replaceScalarLine(content, '  model: ', args.mcu, args.force);
  content = attachProject.replaceScalarLine(content, '  package: ', args.package, args.force);
  content = attachProject.replaceScalarLine(content, '  name: ', args.board, args.force);
  content = attachProject.replaceScalarLine(content, '  target: ', args.target, args.force);
  content = appendListBlock(content, 'truths:', '  ', args.truths, ['']);
  content = appendListBlock(content, 'constraints:', '  ', args.constraints, ['']);
  content = appendListBlock(content, 'unknowns:', '  ', args.unknowns, ['']);
  content = appendListBlock(content, '  datasheet:', '    ', args.sources, ['']);

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

  return {
    domain: 'hardware',
    target: path.relative(projectRoot, filePath),
    updated: {
      truths: args.truths,
      constraints: args.constraints,
      unknowns: args.unknowns,
      sources: args.sources
    }
  };
}

function ingestRequirements(projectRoot, args) {
  const filePath = ensureTemplateFile(projectRoot, 'req-truth');
  let content = runtime.readText(filePath);

  content = appendListBlock(content, 'goals:', '  ', args.goals, ['Define the first deliverable target for the current project']);
  content = appendListBlock(content, 'features:', '  ', args.features, ['Complete the most critical board-level behavior or feature closure']);
  content = appendListBlock(content, 'constraints:', '  ', args.constraints, ['Prefer reusing the existing codebase and hardware truth before expanding architecture']);
  content = appendListBlock(content, 'acceptance:', '  ', args.acceptance, ['The current goal can be confirmed at board level or through a minimal verification path']);
  content = appendListBlock(content, 'failure_policy:', '  ', args.failurePolicy, ['When hardware or requirements are unconfirmed, record an unknown first instead of guessing']);
  content = appendListBlock(content, 'unknowns:', '  ', args.unknowns, ['Customer or production requirements still need confirmation']);
  content = appendListBlock(content, 'sources:', '  ', args.sources, ['']);

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

  return {
    domain: 'requirements',
    target: path.relative(projectRoot, filePath),
    updated: {
      goals: args.goals,
      features: args.features,
      constraints: args.constraints,
      acceptance: args.acceptance,
      failure_policy: args.failurePolicy,
      unknowns: args.unknowns,
      sources: args.sources
    }
  };
}

function ingestTruth(argv) {
  const args = parseArgs(argv || []);
  if (args.help) {
    return { help: true };
  }

  const projectRoot = path.resolve(args.project || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  if (args.domain === 'hardware') {
    return ingestHardware(projectRoot, args);
  }

  return ingestRequirements(projectRoot, args);
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  process.stdout.write(JSON.stringify(ingestTruth(argv || process.argv.slice(2)), null, 2) + '\n');
}

module.exports = {
  appendListBlock,
  ingestHardware,
  ingestRequirements,
  ingestTruth,
  main,
  parseArgs
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ingest-truth error: ${error.message}\n`);
    process.exit(1);
  }
}
