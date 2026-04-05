'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const runtime = require('./runtime.cjs');

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function ensureTarget(value) {
  const target = ensureString(value || 'project', 'target');
  if (!['project', 'runtime'].includes(target)) {
    throw new Error('target must be one of: project, runtime');
  }
  return target;
}

function getProjectEmbDir(projectRoot) {
  return path.join(projectRoot, 'emb-agent');
}

function getTargetEmbDir(rootDir, projectRoot, target) {
  return ensureTarget(target) === 'runtime' ? rootDir : getProjectEmbDir(projectRoot);
}

function getTargetCacheDir(rootDir, projectRoot, target) {
  return path.join(getTargetEmbDir(rootDir, projectRoot, target), 'cache', 'adapter-sources');
}

function getManifestPath(rootDir, projectRoot, target) {
  return path.join(getTargetEmbDir(rootDir, projectRoot, target), 'cache', 'adapter-sync-manifest.json');
}

function emptyManifest(target) {
  return {
    version: 1,
    target: ensureTarget(target),
    entries: {}
  };
}

function loadManifest(rootDir, projectRoot, target) {
  const manifestPath = getManifestPath(rootDir, projectRoot, target);
  if (!fs.existsSync(manifestPath)) {
    return emptyManifest(target);
  }

  const raw = runtime.readJson(manifestPath);
  return {
    version: Number(raw.version || 1),
    target: ensureTarget(raw.target || target),
    entries:
      raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {}
  };
}

function saveManifest(rootDir, projectRoot, target, manifest) {
  const manifestPath = getManifestPath(rootDir, projectRoot, target);
  runtime.ensureDir(path.dirname(manifestPath));
  runtime.writeJson(manifestPath, manifest);
}

function buildEntryKey(target, name) {
  return `${ensureTarget(target)}:${ensureString(name, 'source name')}`;
}

function findSource(projectConfig, name) {
  const normalized = ensureString(name, 'source name');
  const sources = (projectConfig && projectConfig.adapter_sources) || [];
  return sources.find(item => item.name === normalized) || null;
}

function runGit(args, cwd, label) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`${label} failed: ${detail}`);
  }
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function hasLayoutContent(layoutRoot) {
  return (
    pathExists(path.join(layoutRoot, 'adapters')) ||
    pathExists(path.join(layoutRoot, 'extensions', 'tools')) ||
    pathExists(path.join(layoutRoot, 'extensions', 'chips'))
  );
}

function resolveLayoutRoot(baseRoot, subdir) {
  const rootWithSubdir = subdir ? path.resolve(baseRoot, subdir) : baseRoot;
  const candidates = [rootWithSubdir, path.join(rootWithSubdir, 'emb-agent')];

  for (const candidate of candidates) {
    if (pathExists(candidate) && hasLayoutContent(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Adapter source layout not found under: ${rootWithSubdir}`);
}

function materializeGitSource(rootDir, projectRoot, source, target) {
  const cacheDir = path.join(getTargetCacheDir(rootDir, projectRoot, target), source.name);
  const repoDir = path.join(cacheDir, 'repo');
  runtime.ensureDir(cacheDir);

  if (!pathExists(repoDir)) {
    const cloneArgs = ['clone'];
    if (source.branch) {
      cloneArgs.push('--branch', source.branch, '--single-branch');
    }
    cloneArgs.push(source.location, repoDir);
    runGit(cloneArgs, projectRoot, `git clone for source ${source.name}`);
  } else {
    if (!pathExists(path.join(repoDir, '.git'))) {
      throw new Error(`Cached source is not a git repository: ${repoDir}`);
    }
    runGit(['fetch', '--all', '--tags'], repoDir, `git fetch for source ${source.name}`);
    if (source.branch) {
      runGit(['checkout', source.branch], repoDir, `git checkout for source ${source.name}`);
      runGit(['pull', '--ff-only', 'origin', source.branch], repoDir, `git pull for source ${source.name}`);
    } else {
      runGit(['pull', '--ff-only'], repoDir, `git pull for source ${source.name}`);
    }
  }

  return repoDir;
}

function resolveSourceRoot(rootDir, projectRoot, source, target) {
  if (source.type === 'path') {
    const location = path.isAbsolute(source.location)
      ? source.location
      : path.resolve(projectRoot, source.location);
    return {
      checkout_root: location,
      layout_root: resolveLayoutRoot(location, source.subdir),
      source_kind: 'path'
    };
  }

  const checkoutRoot = materializeGitSource(rootDir, projectRoot, source, target);
  return {
    checkout_root: checkoutRoot,
    layout_root: resolveLayoutRoot(checkoutRoot, source.subdir),
    source_kind: 'git'
  };
}

function listFiles(dirPath, extension) {
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(name => name.endsWith(extension))
    .sort();
}

function walkFiles(dirPath, extension, prefixParts) {
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  entries.forEach(entry => {
    const sourcePath = path.join(dirPath, entry.name);
    const relativeParts = (prefixParts || []).concat(entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(sourcePath, extension, relativeParts));
      return;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push({
        sourcePath,
        relativePath: path.join(...relativeParts)
      });
    }
  });

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function collectSourceFiles(layoutRoot) {
  const mappings = [];

  const addFiles = (sourceDir, extension, targetParts, recursive) => {
    const nextFiles = recursive
      ? walkFiles(sourceDir, extension, targetParts)
      : listFiles(sourceDir, extension).map(fileName => ({
          sourcePath: path.join(sourceDir, fileName),
          relativePath: path.join(...targetParts, fileName)
        }));

    nextFiles.forEach(item => {
      mappings.push(item);
    });
  };

  addFiles(path.join(layoutRoot, 'adapters'), '.cjs', ['adapters'], true);
  addFiles(path.join(layoutRoot, 'extensions', 'tools'), '.cjs', ['extensions', 'tools'], true);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'specs'), '.json', ['extensions', 'tools', 'specs']);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'families'), '.json', [
    'extensions',
    'tools',
    'families'
  ]);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'devices'), '.json', [
    'extensions',
    'tools',
    'devices'
  ]);
  addFiles(path.join(layoutRoot, 'extensions', 'chips', 'devices'), '.json', [
    'extensions',
    'chips',
    'devices'
  ]);

  return mappings;
}

function buildOwnedPathMap(manifest, excludeKey) {
  const owned = new Map();

  Object.entries(manifest.entries || {}).forEach(([entryKey, entry]) => {
    if (entryKey === excludeKey || !entry || !Array.isArray(entry.files)) {
      return;
    }

    entry.files.forEach(filePath => {
      if (!owned.has(filePath)) {
        owned.set(filePath, entryKey);
      }
    });
  });

  return owned;
}

function removeEmptyParents(filePath, stopDir) {
  let current = path.dirname(filePath);
  const limit = path.resolve(stopDir);

  while (current.startsWith(limit) && current !== limit) {
    if (!pathExists(current) || fs.readdirSync(current).length > 0) {
      break;
    }
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function rebuildRegistries(targetEmbDir) {
  const toolsRoot = path.join(targetEmbDir, 'extensions', 'tools');
  const chipsRoot = path.join(targetEmbDir, 'extensions', 'chips');
  const toolSpecsDir = path.join(toolsRoot, 'specs');
  const toolFamiliesDir = path.join(toolsRoot, 'families');
  const toolDevicesDir = path.join(toolsRoot, 'devices');
  const chipDevicesDir = path.join(chipsRoot, 'devices');

  runtime.ensureDir(toolSpecsDir);
  runtime.ensureDir(toolFamiliesDir);
  runtime.ensureDir(toolDevicesDir);
  runtime.ensureDir(chipDevicesDir);

  runtime.writeJson(path.join(toolsRoot, 'registry.json'), {
    specs: listFiles(toolSpecsDir, '.json').map(name => name.slice(0, -5)),
    families: listFiles(toolFamiliesDir, '.json').map(name => name.slice(0, -5)),
    devices: listFiles(toolDevicesDir, '.json').map(name => name.slice(0, -5))
  });

  runtime.writeJson(path.join(chipsRoot, 'registry.json'), {
    devices: listFiles(chipDevicesDir, '.json').map(name => name.slice(0, -5))
  });

  return [
    path.join('extensions', 'tools', 'registry.json'),
    path.join('extensions', 'chips', 'registry.json')
  ];
}

function syncAdapterSource(rootDir, projectRoot, source, options) {
  const target = ensureTarget((options && options.target) || 'project');
  const force = Boolean(options && options.force);
  const targetEmbDir = getTargetEmbDir(rootDir, projectRoot, target);
  const manifest = loadManifest(rootDir, projectRoot, target);
  const entryKey = buildEntryKey(target, source.name);
  const previousEntry = manifest.entries[entryKey] || null;
  const ownedByOthers = buildOwnedPathMap(manifest, entryKey);
  const resolved = resolveSourceRoot(rootDir, projectRoot, source, target);
  const files = collectSourceFiles(resolved.layout_root);

  if (files.length === 0) {
    throw new Error(`Adapter source ${source.name} does not contain any syncable adapter files`);
  }

  const conflicts = [];
  files.forEach(item => {
    const destinationPath = path.join(targetEmbDir, item.relativePath);
    const owner = ownedByOthers.get(item.relativePath);

    if (owner && !force) {
      conflicts.push({
        path: item.relativePath,
        owner
      });
      return;
    }

    if (pathExists(destinationPath) && !owner) {
      const alreadyOwnedByThisSource =
        previousEntry && Array.isArray(previousEntry.files) && previousEntry.files.includes(item.relativePath);
      if (!alreadyOwnedByThisSource && !force) {
        conflicts.push({
          path: item.relativePath,
          owner: 'manual'
        });
      }
    }
  });

  if (conflicts.length > 0) {
    throw new Error(
      `Sync conflict for source ${source.name}: ${conflicts
        .map(item => `${item.path} (${item.owner})`)
        .join(', ')}`
    );
  }

  files.forEach(item => {
    const destinationPath = path.join(targetEmbDir, item.relativePath);
    runtime.ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(item.sourcePath, destinationPath);
  });

  const nextFiles = files.map(item => item.relativePath);
  const previousFiles = previousEntry && Array.isArray(previousEntry.files) ? previousEntry.files : [];

  previousFiles.forEach(relativePath => {
    if (nextFiles.includes(relativePath) || ownedByOthers.has(relativePath)) {
      return;
    }

    const filePath = path.join(targetEmbDir, relativePath);
    if (pathExists(filePath)) {
      fs.unlinkSync(filePath);
      removeEmptyParents(filePath, targetEmbDir);
    }
  });

  const generated = rebuildRegistries(targetEmbDir);
  manifest.entries[entryKey] = {
    name: source.name,
    target,
    type: source.type,
    location: source.location,
    branch: source.branch || '',
    subdir: source.subdir || '',
    enabled: source.enabled !== false,
    synced_at: new Date().toISOString(),
    checkout_root: resolved.checkout_root,
    source_root: resolved.layout_root,
    files: nextFiles,
    generated
  };
  saveManifest(rootDir, projectRoot, target, manifest);

  return {
    name: source.name,
    target,
    status: 'synced',
    source_type: source.type,
    checkout_root: resolved.checkout_root,
    source_root: resolved.layout_root,
    files: nextFiles,
    generated,
    manifest: getManifestPath(rootDir, projectRoot, target)
  };
}

function removeSyncedSource(rootDir, projectRoot, name, target) {
  const normalizedTarget = ensureTarget(target);
  const targetEmbDir = getTargetEmbDir(rootDir, projectRoot, normalizedTarget);
  const manifest = loadManifest(rootDir, projectRoot, normalizedTarget);
  const entryKey = buildEntryKey(normalizedTarget, name);
  const entry = manifest.entries[entryKey];

  if (!entry) {
    return {
      name,
      target: normalizedTarget,
      removed: false,
      files: []
    };
  }

  delete manifest.entries[entryKey];
  const ownedByOthers = buildOwnedPathMap(manifest, '');
  const removedFiles = [];

  (entry.files || []).forEach(relativePath => {
    if (ownedByOthers.has(relativePath)) {
      return;
    }

    const filePath = path.join(targetEmbDir, relativePath);
    if (pathExists(filePath)) {
      fs.unlinkSync(filePath);
      removeEmptyParents(filePath, targetEmbDir);
      removedFiles.push(relativePath);
    }
  });

  rebuildRegistries(targetEmbDir);
  saveManifest(rootDir, projectRoot, normalizedTarget, manifest);

  return {
    name,
    target: normalizedTarget,
    removed: true,
    files: removedFiles,
    manifest: getManifestPath(rootDir, projectRoot, normalizedTarget)
  };
}

function summarizeManifestEntry(entry) {
  if (!entry) {
    return {
      synced: false,
      synced_at: '',
      files_count: 0,
      source_root: '',
      checkout_root: ''
    };
  }

  return {
    synced: true,
    synced_at: entry.synced_at || '',
    files_count: Array.isArray(entry.files) ? entry.files.length : 0,
    source_root: entry.source_root || '',
    checkout_root: entry.checkout_root || ''
  };
}

function buildSourceStatus(rootDir, projectRoot, source) {
  const projectManifest = loadManifest(rootDir, projectRoot, 'project');
  const runtimeManifest = loadManifest(rootDir, projectRoot, 'runtime');

  return {
    ...source,
    targets: {
      project: summarizeManifestEntry(projectManifest.entries[buildEntryKey('project', source.name)]),
      runtime: summarizeManifestEntry(runtimeManifest.entries[buildEntryKey('runtime', source.name)])
    }
  };
}

function listSourceStatus(rootDir, projectRoot, projectConfig) {
  return ((projectConfig && projectConfig.adapter_sources) || []).map(source =>
    buildSourceStatus(rootDir, projectRoot, source)
  );
}

function syncAllAdapterSources(rootDir, projectRoot, projectConfig, options) {
  const sources = ((projectConfig && projectConfig.adapter_sources) || []).filter(
    source => source.enabled !== false
  );

  return sources.map(source => syncAdapterSource(rootDir, projectRoot, source, options));
}

module.exports = {
  buildSourceStatus,
  findSource,
  getManifestPath,
  getTargetEmbDir,
  listSourceStatus,
  loadManifest,
  removeSyncedSource,
  resolveSourceRoot,
  syncAdapterSource,
  syncAllAdapterSources
};
