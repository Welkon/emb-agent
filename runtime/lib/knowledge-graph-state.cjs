'use strict';

const crypto = require('crypto');

const REFRESH_STEP = 'knowledge graph refresh';

function readTextIfExists(fs, filePath) {
  return fs.existsSync(filePath) ? String(fs.readFileSync(filePath, 'utf8') || '') : '';
}

function readJsonIfExists(fs, filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(String(fs.readFileSync(filePath, 'utf8') || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function listFilesRecursive(fs, path, dirPath, predicate) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }
  const found = [];
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach(entry => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesRecursive(fs, path, entryPath, predicate));
      return;
    }
    if (entry.isFile() && (!predicate || predicate(entryPath))) {
      found.push(entryPath);
    }
  });
  return found.sort();
}

function resolveProjectExtDir(projectRoot, deps) {
  if (typeof deps.getProjectExtDir === 'function') {
    return deps.getProjectExtDir(projectRoot);
  }
  return deps.runtime.getProjectExtDir(projectRoot);
}

function getProjectAssetRelativePath(deps, ...parts) {
  if (deps.runtime && typeof deps.runtime.getProjectAssetRelativePath === 'function') {
    return deps.runtime.getProjectAssetRelativePath(...parts);
  }
  return ['.emb-agent', ...parts].join('/');
}

function listKnowledgeGraphTrackedFiles(projectRoot, deps) {
  const { fs, path } = deps;
  const projectExtDir = resolveProjectExtDir(projectRoot, deps);
  const wikiDir = path.join(projectExtDir, 'wiki');
  const wikiPages = listFilesRecursive(fs, path, wikiDir, filePath => {
    if (!/\.md$/i.test(filePath)) return false;
    const relativePath = path.relative(wikiDir, filePath).replace(/\\/g, '/');
    return relativePath !== 'index.md' && relativePath !== 'log.md';
  });
  return [
    path.join(projectExtDir, 'project.json'),
    path.join(projectExtDir, 'hw.yaml'),
    path.join(projectExtDir, 'req.yaml'),
    ...listFilesRecursive(fs, path, path.join(projectExtDir, 'formulas'), filePath => /\.json$/i.test(filePath)),
    ...listFilesRecursive(fs, path, path.join(projectExtDir, 'runs'), filePath => /\.json$/i.test(filePath)),
    ...listFilesRecursive(fs, path, path.join(projectExtDir, 'firmware-snippets'), filePath => /\.md$/i.test(filePath)),
    ...wikiPages
  ];
}

function buildKnowledgeGraphManifest(projectRoot, deps, files) {
  const { fs, path } = deps;
  const trackedFiles = Array.isArray(files)
    ? files
    : listKnowledgeGraphTrackedFiles(projectRoot, deps);
  const manifest = {};
  trackedFiles.forEach(filePath => {
    if (!fs.existsSync(filePath)) return;
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    manifest[relativePath] = sha256Text(readTextIfExists(fs, filePath));
  });
  return manifest;
}

function compareKnowledgeGraphManifest(previous, current) {
  const before = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const after = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const added = [];
  const modified = [];
  const removed = [];
  keys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      added.push(key);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      removed.push(key);
      return;
    }
    if (before[key] !== after[key]) {
      modified.push(key);
    }
  });
  return {
    stale: added.length > 0 || modified.length > 0 || removed.length > 0,
    changed_files: [...added, ...modified, ...removed],
    added_files: added,
    modified_files: modified,
    removed_files: removed
  };
}

function readKnowledgeGraphFreshness(projectRoot, graph, deps) {
  const { fs, path } = deps;
  const projectExtDir = resolveProjectExtDir(projectRoot, deps);
  const manifestPath = path.join(projectExtDir, 'graph', 'cache', 'manifest.json');
  let storedManifest = {};
  if (fs.existsSync(manifestPath)) {
    storedManifest = readJsonIfExists(fs, manifestPath) || {};
  } else if (graph && graph.manifest && typeof graph.manifest === 'object' && !Array.isArray(graph.manifest)) {
    storedManifest = graph.manifest;
  }
  return {
    ...compareKnowledgeGraphManifest(storedManifest, buildKnowledgeGraphManifest(projectRoot, deps)),
    manifest_file: getProjectAssetRelativePath(deps, 'graph', 'cache', 'manifest.json')
  };
}

function summarizeKnowledgeGraph(projectRoot, deps) {
  const { fs, path } = deps;
  const projectExtDir = resolveProjectExtDir(projectRoot, deps);
  const graphPath = path.join(projectExtDir, 'graph', 'graph.json');
  const graphRelativePath = getProjectAssetRelativePath(deps, 'graph', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    return {
      initialized: false,
      state: 'missing',
      stale: false,
      graph_file: graphRelativePath,
      changed_files: [],
      added_files: [],
      modified_files: [],
      removed_files: [],
      next_steps: [REFRESH_STEP]
    };
  }
  const graph = readJsonIfExists(fs, graphPath) || {};
  const freshness = readKnowledgeGraphFreshness(projectRoot, graph, deps);
  return {
    initialized: true,
    state: freshness.stale ? 'stale' : 'fresh',
    stale: freshness.stale,
    graph_file: graphRelativePath,
    manifest_file: freshness.manifest_file,
    stats: graph.stats || null,
    changed_files: freshness.changed_files,
    added_files: freshness.added_files,
    modified_files: freshness.modified_files,
    removed_files: freshness.removed_files,
    next_steps: freshness.stale ? [REFRESH_STEP] : []
  };
}

module.exports = {
  REFRESH_STEP,
  buildKnowledgeGraphManifest,
  compareKnowledgeGraphManifest,
  listKnowledgeGraphTrackedFiles,
  readKnowledgeGraphFreshness,
  summarizeKnowledgeGraph
};
