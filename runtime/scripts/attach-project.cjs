#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const runtimeHostHelpers = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const initProject = require(path.join(ROOT, 'scripts', 'init-project.cjs'));
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHost(ROOT);

const IGNORE_DIRS = new Set([
  '.git',
  '.codex',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage'
]);

const DOC_EXTS = new Set(['.pdf', '.md', '.txt', '.doc', '.docx', '.csv', '.xls', '.xlsx']);
const SCHEMATIC_EXTS = new Set(['.schdoc', '.sch', '.dsn']);
const CODE_EXTS = new Set(['.c', '.h', '.cpp', '.hpp', '.s', '.asm', '.ino']);
const PROJECT_EXTS = new Set(['.ioc', '.uvprojx', '.uvoptx', '.ewp', '.eww', '.project', '.cproject', '.prj', '.pre']);

function usage() {
  process.stdout.write(
    [
      'attach-project usage:',
      '  node scripts/attach-project.cjs',
      '  node scripts/attach-project.cjs --project <repo-root> [--profile <name>] [--pack <name> ...] [--runtime <codex|claude>|--codex|--claude] [-u <name>]',
      '  node scripts/attach-project.cjs --mcu <name> [--board <name>] [--target <name>] [--goal <text>] [--runtime <codex|claude>|--codex|--claude] [-u <name>] [--force]'
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
    mcu: '',
    board: '',
    target: '',
    goal: '',
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
    if (token === '--mcu') {
      result.mcu = argv[index + 1] || '';
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
    if (token === '--goal') {
      result.goal = argv[index + 1] || '';
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
  if (argv.includes('--mcu') && !result.mcu) {
    throw new Error('Missing value after --mcu');
  }
  if (argv.includes('--board') && !result.board) {
    throw new Error('Missing value after --board');
  }
  if (argv.includes('--target') && !result.target) {
    throw new Error('Missing value after --target');
  }
  if (argv.includes('--goal') && !result.goal) {
    throw new Error('Missing value after --goal');
  }

  return result;
}

function walkFiles(rootDir, currentDir, results) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      walkFiles(rootDir, path.join(currentDir, entry.name), results);
      continue;
    }

    results.push(path.relative(rootDir, path.join(currentDir, entry.name)).replace(/\\/g, '/'));
  }
}

function detectProjectInputs(projectRoot) {
  const files = [];
  walkFiles(projectRoot, projectRoot, files);

  const docs = [];
  const schematics = [];
  const code = [];
  const projects = [];

  for (const relPath of files) {
    const lower = relPath.toLowerCase();
    const ext = path.extname(lower);

    if (SCHEMATIC_EXTS.has(ext) || lower.includes('schematic') || lower.includes('circuit')) {
      schematics.push(relPath);
      continue;
    }

    if (PROJECT_EXTS.has(ext)) {
      projects.push(relPath);
      continue;
    }

    if (CODE_EXTS.has(ext)) {
      code.push(relPath);
      continue;
    }

    if (
      DOC_EXTS.has(ext) ||
      lower.includes('datasheet') ||
      lower.includes('manual') ||
      lower.includes('reference') ||
      lower.includes('pin')
    ) {
      docs.push(relPath);
    }
  }

  return {
    docs: docs.slice(0, 8),
    schematics: schematics.slice(0, 6),
    code: code.slice(0, 8),
    projects: projects.slice(0, 6)
  };
}

function replaceScalarLine(content, prefix, value, force) {
  if (!value) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const index = lines.findIndex(line => line.startsWith(prefix));
  if (index === -1) {
    return content;
  }

  const current = lines[index].slice(prefix.length).trim();
  if (!force && current && current !== '""' && current !== "''") {
    return content;
  }

  lines[index] = `${prefix}${JSON.stringify(value)}`;
  return lines.join('\n');
}

function replaceListBlock(content, keyLine, itemIndent, values, force, placeholders) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return content;
  }

  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(`${itemIndent}- `)) {
    end += 1;
  }

  const existing = lines
    .slice(start + 1, end)
    .map(line => line.replace(`${itemIndent}- `, '').trim())
    .filter(Boolean);
  const ignored = new Set(['""', "''", ...((placeholders || []).map(item => JSON.stringify(item))), ...(placeholders || [])]);
  const normalizedExisting = existing.filter(item => !ignored.has(item));

  if (normalizedExisting.length > 0 && !force) {
    return content;
  }

  const nextItems = values.length > 0
    ? values.map(value => `${itemIndent}- ${JSON.stringify(value)}`)
    : [`${itemIndent}- ""`];
  lines.splice(start + 1, end - (start + 1), ...nextItems);
  return lines.join('\n');
}

function seedHwTruth(filePath, options) {
  let content = runtime.readText(filePath);

  content = replaceScalarLine(content, '  model: ', options.mcu, options.force);
  content = replaceScalarLine(content, '  name: ', options.board, options.force);
  content = replaceScalarLine(content, '  target: ', options.target, options.force);
  content = replaceListBlock(content, '  datasheet:', '    ', options.docs, options.force);
  content = replaceListBlock(content, '  schematic:', '    ', options.schematics, options.force);
  content = replaceListBlock(
    content,
    '  code:',
    '    ',
    runtime.unique([...(options.projects || []), ...(options.code || [])]).slice(0, 8),
    options.force
  );

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function seedReqTruth(filePath, options) {
  let content = runtime.readText(filePath);

  content = replaceListBlock(
    content,
    'goals:',
    '  ',
    options.goal ? [options.goal] : [],
    options.force,
    ['Define the first deliverable target for the current project']
  );
  content = replaceListBlock(
    content,
    'sources:',
    '  ',
    runtime.unique([...(options.docs || []), ...(options.projects || [])]).slice(0, 8),
    options.force
  );

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function attachProject(argv) {
  const args = parseArgs(argv || []);
  if (args.help) {
    return { help: true };
  }

  const projectRoot = path.resolve(args.project || process.cwd());
  const configArgs = {
    profile: args.profile,
    packs: args.packs,
    runtime: args.runtime,
    runtimeSet: args.runtimeSet,
    user: args.user,
    userSet: args.userSet
  };
  const projectConfig = initProject.buildProjectConfig(configArgs);
  const detected = detectProjectInputs(projectRoot);
  const scaffolded = initProject.scaffoldProject(projectRoot, projectConfig, args.force, configArgs);
  const projectExtDir = runtime.getProjectExtDir(projectRoot);
  const hwPath = path.join(projectExtDir, 'hw.yaml');
  const reqPath = path.join(projectExtDir, 'req.yaml');

  seedHwTruth(hwPath, {
    mcu: args.mcu,
    board: args.board,
    target: args.target,
    docs: detected.docs,
    schematics: detected.schematics,
    code: detected.code,
    projects: detected.projects,
    force: args.force
  });

  seedReqTruth(reqPath, {
    goal: args.goal,
    docs: detected.docs,
    projects: detected.projects,
    force: args.force
  });

  return {
    ...scaffolded,
    attached: true,
    seeded: [
      path.relative(projectRoot, hwPath),
      path.relative(projectRoot, reqPath)
    ],
    detected,
    next_steps: [
      runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['status']),
      runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])
    ]
  };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  process.stdout.write(JSON.stringify(attachProject(argv || process.argv.slice(2)), null, 2) + '\n');
}

module.exports = {
  attachProject,
  detectProjectInputs,
  main,
  parseArgs,
  replaceListBlock,
  replaceScalarLine,
  seedHwTruth,
  seedReqTruth
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`attach-project error: ${error.message}\n`);
    process.exit(1);
  }
}
