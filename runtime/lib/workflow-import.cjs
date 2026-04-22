'use strict';

function createWorkflowImportHelpers(deps) {
  const {
    childProcess,
    fs,
    os,
    path,
    runtime,
    workflowRegistry
  } = deps;

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function copyRecursive(sourcePath, targetPath) {
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      ensureDir(targetPath);
      fs.readdirSync(sourcePath).forEach(name => {
        copyRecursive(path.join(sourcePath, name), path.join(targetPath, name));
      });
      return;
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }

  function stageWorkflowRegistrySource(source, options = {}) {
    const normalized = String(source || '').trim();
    if (!normalized) {
      throw new Error('Missing workflow registry source');
    }

    const resolvedPath = path.resolve(normalized);
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      return {
        mode: 'path',
        root: resolvedPath,
        cleanup() {}
      };
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-registry-'));
    const checkoutDir = path.join(tempRoot, 'source');
    const cloneArgs = ['clone', '--depth', '1'];
    const branch = String(options.branch || '').trim();

    if (branch) {
      cloneArgs.push('--branch', branch, '--single-branch');
    }

    cloneArgs.push(normalized, checkoutDir);

    try {
      childProcess.execFileSync('git', cloneArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      const detail = error && error.stderr ? String(error.stderr).trim() : '';
      throw new Error(detail ? `Failed to clone workflow registry source: ${detail}` : 'Failed to clone workflow registry source');
    }

    return {
      mode: 'git',
      root: checkoutDir,
      cleanup() {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    };
  }

  function resolveWorkflowRegistryRoot(stagedRoot, options = {}) {
    const subdir = String(options.subdir || '').trim();
    const baseRoot = subdir
      ? path.resolve(stagedRoot, subdir)
      : path.resolve(stagedRoot);
    const candidates = [
      baseRoot,
      path.join(baseRoot, '.emb-agent')
    ];

    for (const candidate of candidates) {
      const registryPath = path.join(candidate, 'registry', 'workflow.json');
      if (fs.existsSync(registryPath)) {
        return candidate;
      }
    }

    throw new Error(`Workflow registry not found under source root: ${baseRoot}`);
  }

  function upsertRegistryEntry(entries, nextEntry) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    const index = list.findIndex(item => item && item.name === nextEntry.name);
    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...nextEntry
      };
      return list;
    }
    list.push(nextEntry);
    return list;
  }

  function importProjectWorkflowRegistry(projectRoot, source, options = {}) {
    const force = options.force === true;
    const projectExtDir = runtime.getProjectExtDir(projectRoot);
    const projectPaths = workflowRegistry.getProjectWorkflowPaths(projectExtDir);
    const layout = workflowRegistry.syncProjectWorkflowLayout(projectExtDir, {
      write: true,
      force: false
    });

    const staged = stageWorkflowRegistrySource(source, options);

    try {
      const sourceExtDir = resolveWorkflowRegistryRoot(staged.root, options);
      const sourcePaths = workflowRegistry.getProjectWorkflowPaths(sourceExtDir);
      const sourceRegistry = workflowRegistry.normalizeRegistry(
        runtime.readJson(sourcePaths.registryPath),
        'Imported workflow registry'
      );
      const projectRegistry = workflowRegistry.normalizeRegistry(
        runtime.readJson(projectPaths.registryPath),
        'Project workflow registry'
      );

      const imported = [];
      const skipped = [];
      const mapping = [
        { kind: 'template', key: 'templates', pathField: 'source' },
        { kind: 'spec', key: 'specs', pathField: 'path' }
      ];

      mapping.forEach(({ kind, key, pathField }) => {
        (sourceRegistry[key] || []).forEach(entry => {
          const relativePath = String(entry[pathField] || '').trim();
          const sourcePath = path.join(sourceExtDir, relativePath);
          const targetPath = path.join(projectExtDir, relativePath);
          const existingEntry = (projectRegistry[key] || []).find(item => item && item.name === entry.name);

          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Imported ${kind} file is missing: ${relativePath}`);
          }

          if ((existingEntry || fs.existsSync(targetPath)) && !force) {
            skipped.push({
              kind,
              name: entry.name,
              path: relativePath,
              reason: existingEntry ? 'entry-exists' : 'path-exists'
            });
            return;
          }

          if (fs.existsSync(targetPath) && force) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          }

          copyRecursive(sourcePath, targetPath);
          projectRegistry[key] = upsertRegistryEntry(projectRegistry[key], entry);
          imported.push({
            kind,
            name: entry.name,
            path: relativePath
          });
        });
      });

      runtime.writeJson(projectPaths.registryPath, projectRegistry);

      return {
        source: {
          location: String(source || '').trim(),
          mode: staged.mode,
          root: sourceExtDir,
          subdir: String(options.subdir || '').trim(),
          branch: String(options.branch || '').trim()
        },
        force,
        workflow_layout: layout,
        registry_path: path.relative(projectExtDir, projectPaths.registryPath).replace(/\\/g, '/'),
        imported,
        skipped
      };
    } finally {
      staged.cleanup();
    }
  }

  return {
    importProjectWorkflowRegistry,
    resolveWorkflowRegistryRoot,
    stageWorkflowRegistrySource
  };
}

module.exports = {
  createWorkflowImportHelpers
};
