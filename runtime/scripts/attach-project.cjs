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
  '.emb-agent',
  'emb-agent',
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
const DOC_SCAN_DIRS = new Set([
  'doc',
  'docs',
  'documentation',
  'datasheet',
  'datasheets',
  'manual',
  'manuals',
  'hardware',
  'hw',
  'schematic',
  'schematics'
]);
const CODE_SCAN_DIRS = new Set([
  'app',
  'apps',
  'application',
  'code',
  'components',
  'core',
  'firmware',
  'fw',
  'inc',
  'include',
  'lib',
  'libs',
  'source',
  'src',
  'user'
]);
const PACKAGE_CONTAINER_DIRS = new Set(['apps', 'packages', 'projects']);
const PACKAGE_SCAN_DIRS = new Set([
  ...DOC_SCAN_DIRS,
  ...CODE_SCAN_DIRS
]);
const MAX_DISCOVERY_FILES = 1200;
const DEFAULT_DISCOVERY_DEPTH = 5;

function usage() {
  process.stdout.write(
    [
      'attach-project usage:',
      '  node scripts/attach-project.cjs',
      '  node scripts/attach-project.cjs --project <repo-root> [--profile <name>] [--spec <name> ...] [--runtime <external|codex|claude|cursor>|--external|--codex|--claude|--cursor] [-u <name>] [-r <source>] [--registry-branch <name>] [--registry-subdir <path>]',
      '  node scripts/attach-project.cjs --mcu <name> [--package <name>] [--board <name>] [--target <name>] [--goal <text>] [--runtime <external|codex|claude|cursor>|--external|--codex|--claude|--cursor] [-u <name>] [-r <source>] [--registry-branch <name>] [--registry-subdir <path>] [--force]'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    profile: '',
    specs: [],
    runtime: '',
    runtimeSet: false,
    user: '',
    userSet: false,
    registry: '',
    registryBranch: '',
    registrySubdir: '',
    mcu: '',
    package: '',
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
    if (!['external', 'codex', 'claude', 'cursor'].includes(normalized)) {
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
    if (token === '--spec') {
      result.specs.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--runtime') {
      setRuntime(argv[index + 1] || '', '--runtime');
      index += 1;
      continue;
    }
    if (token === '--external') {
      setRuntime('external', '--external');
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
    if (token === '--cursor') {
      setRuntime('cursor', '--cursor');
      continue;
    }
    if (token === '--user' || token === '-u') {
      result.user = argv[index + 1] || '';
      result.userSet = true;
      index += 1;
      continue;
    }
    if (token === '--registry' || token === '-r') {
      result.registry = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--registry-branch') {
      result.registryBranch = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--registry-subdir') {
      result.registrySubdir = argv[index + 1] || '';
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
  if (result.specs.includes('')) {
    throw new Error('Missing name after --spec');
  }
  if ((argv.includes('--user') || argv.includes('-u')) && !result.user) {
    throw new Error('Missing name after --user/-u');
  }
  if ((argv.includes('--registry') || argv.includes('-r')) && !result.registry) {
    throw new Error('Missing source after --registry/-r');
  }
  if (argv.includes('--registry-branch') && !result.registryBranch) {
    throw new Error('Missing name after --registry-branch');
  }
  if (argv.includes('--registry-subdir') && !result.registrySubdir) {
    throw new Error('Missing path after --registry-subdir');
  }
  if (argv.includes('--mcu') && !result.mcu) {
    throw new Error('Missing value after --mcu');
  }
  if (argv.includes('--package') && !result.package) {
    throw new Error('Missing value after --package');
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

function isCandidateInputPath(relativePath) {
  const lower = String(relativePath || '').toLowerCase();
  const ext = path.extname(lower);

  return (
    DOC_EXTS.has(ext) ||
    SCHEMATIC_EXTS.has(ext) ||
    CODE_EXTS.has(ext) ||
    PROJECT_EXTS.has(ext) ||
    lower.includes('datasheet') ||
    lower.includes('manual') ||
    lower.includes('reference') ||
    lower.includes('pin') ||
    lower.includes('schematic') ||
    lower.includes('circuit')
  );
}

function pushDiscoveryRoot(roots, projectRoot, relativeDir, maxDepth) {
  const normalized = String(relativeDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const absolutePath = normalized ? path.join(projectRoot, normalized) : projectRoot;
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    return;
  }

  const existing = roots.find(item => item.relativeDir === normalized);
  if (existing) {
    existing.maxDepth = Math.max(existing.maxDepth, maxDepth);
    return;
  }

  roots.push({
    relativeDir: normalized,
    absolutePath,
    maxDepth
  });
}

function collectDiscoveryRoots(projectRoot) {
  const roots = [];
  pushDiscoveryRoot(roots, projectRoot, '', 0);

  const entries = fs.existsSync(projectRoot)
    ? fs.readdirSync(projectRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    : [];

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (DOC_SCAN_DIRS.has(lower) || CODE_SCAN_DIRS.has(lower)) {
      pushDiscoveryRoot(roots, projectRoot, entry.name, DEFAULT_DISCOVERY_DEPTH);
    }

    if (!PACKAGE_CONTAINER_DIRS.has(lower)) {
      continue;
    }

    const containerPath = path.join(projectRoot, entry.name);
    const packageEntries = fs.readdirSync(containerPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const packageEntry of packageEntries) {
      if (!packageEntry.isDirectory() || IGNORE_DIRS.has(packageEntry.name)) {
        continue;
      }

      const packageRoot = path.posix.join(entry.name, packageEntry.name);
      pushDiscoveryRoot(roots, projectRoot, packageRoot, 1);
      const packageRootPath = path.join(projectRoot, packageRoot);
      const packageChildren = fs.readdirSync(packageRootPath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const child of packageChildren) {
        if (!child.isDirectory() || IGNORE_DIRS.has(child.name)) {
          continue;
        }
        if (PACKAGE_SCAN_DIRS.has(child.name.toLowerCase())) {
          pushDiscoveryRoot(
            roots,
            projectRoot,
            path.posix.join(packageRoot, child.name),
            DEFAULT_DISCOVERY_DEPTH
          );
        }
      }
    }
  }

  return roots;
}

function walkFiles(rootDir, currentDir, results, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_DISCOVERY_DEPTH;
  const depth = Number.isFinite(options.depth) ? options.depth : 0;
  const state = options.state || { files: 0, seen: new Set() };
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (state.files >= MAX_DISCOVERY_FILES) {
      break;
    }

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      if (depth < maxDepth) {
        walkFiles(rootDir, path.join(currentDir, entry.name), results, {
          maxDepth,
          depth: depth + 1,
          state
        });
      }
      continue;
    }

    const relPath = path.relative(rootDir, path.join(currentDir, entry.name)).replace(/\\/g, '/');
    if (!isCandidateInputPath(relPath) || state.seen.has(relPath)) {
      continue;
    }

    state.seen.add(relPath);
    state.files += 1;
    results.push(relPath);
  }
}

function detectProjectInputs(projectRoot) {
  const files = [];
  const state = { files: 0, seen: new Set() };
  collectDiscoveryRoots(projectRoot).forEach(root => {
    if (state.files >= MAX_DISCOVERY_FILES) {
      return;
    }
    walkFiles(projectRoot, root.absolutePath, files, {
      maxDepth: root.maxDepth,
      state
    });
  });

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
  content = replaceScalarLine(content, '  package: ', options.package, options.force);
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
    specs: args.specs,
    runtime: args.runtime,
    runtimeSet: args.runtimeSet,
    user: args.user,
    userSet: args.userSet,
    registry: args.registry,
    registryBranch: args.registryBranch,
    registrySubdir: args.registrySubdir
  };
  const workflowSetup = initProject.prepareProjectWorkflowSetup(projectRoot, configArgs, {
    force: args.force
  });
  const resolvedConfigArgs = {
    ...configArgs,
    specs: workflowSetup.activeSpecs
  };
  const projectConfig = initProject.buildProjectConfig(projectRoot, resolvedConfigArgs, {
    workflowCatalog: workflowSetup.workflowCatalog,
    activePacks: workflowSetup.activePacks
  });
  const detected = detectProjectInputs(projectRoot);
  const scaffolded = initProject.scaffoldProject(projectRoot, projectConfig, args.force, {
    ...resolvedConfigArgs,
    workflowRegistryImport: workflowSetup.workflowRegistryImport
  });
  const projectExtDir = runtime.getProjectExtDir(projectRoot);
  const hwPath = path.join(projectExtDir, 'hw.yaml');
  const reqPath = path.join(projectExtDir, 'req.yaml');

  seedHwTruth(hwPath, {
    mcu: args.mcu,
    package: args.package,
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
