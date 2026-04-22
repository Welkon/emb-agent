'use strict';

const GIGET_HOST_ENV_KEY = 'GIGET_GITLAB_URL';
const GIGET_SUPPORTED_PROVIDERS = new Set(['gh', 'github', 'gitlab', 'bitbucket']);
const KNOWN_PUBLIC_GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];
const PUBLIC_GIT_HOST_PREFIX = {
  'github.com': 'gh',
  'gitlab.com': 'gitlab',
  'bitbucket.org': 'bitbucket'
};

function createWorkflowImportHelpers(deps) {
  const {
    childProcess,
    fs,
    os,
    path,
    process,
    runtime,
    workflowRegistry
  } = deps;
  const hostProcess = process || globalThis.process;

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

  function ensureNonEmptyString(value, label) {
    const text = String(value || '').trim();
    if (!text) {
      throw new Error(`${label} must be a non-empty string`);
    }
    return text;
  }

  function ensureOptionalString(value) {
    return String(value || '').trim();
  }

  function normalizeRemoteGitSource(source) {
    const input = ensureNonEmptyString(source, 'Workflow registry source');
    const patterns = [
      { re: /^https?:\/\/github\.com\//i, prefix: 'gh:' },
      { re: /^https?:\/\/gitlab\.com\//i, prefix: 'gitlab:' },
      { re: /^https?:\/\/bitbucket\.org\//i, prefix: 'bitbucket:' }
    ];

    for (const { re, prefix } of patterns) {
      if (!re.test(input)) {
        continue;
      }

      const rest = input.replace(re, '');
      const treeMatch = rest.match(
        /^([^/]+\/[^/]+)(?:\/(?:-|tree))?\/tree\/([^/]+)(?:\/(.+?))?(?:\.git)?\/?$/i
      );
      if (treeMatch) {
        const [, repo, ref, subdir] = treeMatch;
        return `${prefix}${repo}${subdir ? `/${subdir}` : ''}#${ref}`;
      }

      const cleaned = rest.replace(/\.git\/?$/i, '').replace(/\/$/, '');
      return `${prefix}${cleaned}`;
    }

    return input;
  }

  function resolveRemoteGitRegistrySource(source, options = {}) {
    const rawSource = ensureNonEmptyString(source, 'Workflow registry source');
    const overrideBranch = ensureOptionalString(options.branch);
    const overrideSubdir = ensureOptionalString(options.subdir);
    let host = '';
    let normalizedInput = '';

    const sshMatch =
      rawSource.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/i) ||
      rawSource.match(/^ssh:\/\/git@([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i);
    if (sshMatch) {
      const sshHost = String(sshMatch[1] || '').toLowerCase();
      const sshPath = String(sshMatch[2] || '').trim();
      const publicPrefix = PUBLIC_GIT_HOST_PREFIX[sshHost];
      if (publicPrefix) {
        normalizedInput = `${publicPrefix}:${sshPath}`;
      } else {
        host = sshHost;
        normalizedInput = `gitlab:${sshPath}`;
      }
    }

    if (!normalizedInput) {
      const httpsMatch = rawSource.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
      if (httpsMatch) {
        const httpsHost = String(httpsMatch[1] || '').toLowerCase();
        if (!KNOWN_PUBLIC_GIT_HOSTS.includes(httpsHost)) {
          host = httpsHost;
          const pathPart = String(httpsMatch[2] || '').trim();
          const treeMatch = pathPart.match(
            /^([^/]+\/[^/]+)(?:\/-)?\/tree\/([^/]+)(?:\/(.+?))?$/i
          );
          if (treeMatch) {
            const [, repoPath, ref, embeddedSubdir] = treeMatch;
            normalizedInput = `gitlab:${repoPath}${embeddedSubdir ? `/${embeddedSubdir}` : ''}#${ref}`;
          } else {
            normalizedInput = `gitlab:${pathPart}`;
          }
        }
      }
    }

    const normalized = normalizedInput || normalizeRemoteGitSource(rawSource);
    const colonIndex = normalized.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    const provider = normalized.slice(0, colonIndex).toLowerCase();
    if (!GIGET_SUPPORTED_PROVIDERS.has(provider)) {
      return null;
    }

    const remainder = normalized.slice(colonIndex + 1);
    const refMatch = remainder.match(/^([^#]+?)(?:#(.+))?$/);
    if (!refMatch) {
      throw new Error(`Workflow registry source is invalid: ${rawSource}`);
    }

    const pathPart = String(refMatch[1] || '').trim();
    const embeddedBranch = ensureOptionalString(refMatch[2]);
    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Workflow registry source is invalid: ${rawSource}`);
    }

    const repo = `${segments[0]}/${segments[1]}`;
    const embeddedSubdir = segments.slice(2).join('/');
    const finalBranch = overrideBranch || embeddedBranch;
    const finalSubdir = overrideSubdir || embeddedSubdir;

    return {
      provider,
      repo,
      subdir: finalSubdir,
      ref: finalBranch,
      host,
      gigetSource: `${provider}:${repo}${finalSubdir ? `/${finalSubdir}` : ''}${finalBranch ? `#${finalBranch}` : ''}`
    };
  }

  function classifyWorkflowSourceDownloadError(error) {
    const message = String(error && error.message ? error.message : '').trim();
    if (!message) {
      return 'Could not download workflow registry source.';
    }
    if (/required local dependency is not available in this environment/i.test(message)) {
      return message;
    }
    if (/timed out/i.test(message)) {
      return 'Workflow registry source download timed out. Check your network connection and try again.';
    }
    if (/404|not found/i.test(message)) {
      return 'Workflow registry source was not found or is not accessible.';
    }
    if (
      /failed to download|failed to fetch|fetch failed|network|econn|enotfound|etimedout|socket/i.test(message)
    ) {
      return 'Could not reach workflow registry source. Check your network connection and try again.';
    }
    return `Could not download workflow registry source: ${message}`;
  }

  function downloadWorkflowRegistrySourceWithGiget(targetDir, source) {
    const execPath = hostProcess && hostProcess.execPath ? hostProcess.execPath : globalThis.process.execPath;
    const downloadScript = [
      'const [source, dir, host] = process.argv.slice(1);',
      'if (!source || !dir) {',
      "  throw new Error('Missing giget workflow download arguments');",
      '}',
      'if (host) {',
      `  process.env.${GIGET_HOST_ENV_KEY} = "https://" + host;`,
      '}',
      'import("giget")',
      '  .then(mod => {',
      '    const api = mod && typeof mod.downloadTemplate === "function"',
      '      ? mod',
      '      : mod && mod.default && typeof mod.default.downloadTemplate === "function"',
      '        ? mod.default',
      '        : null;',
      '    if (!api || typeof api.downloadTemplate !== "function") {',
      "      throw new Error('giget downloadTemplate is unavailable');",
      '    }',
      '    return api.downloadTemplate(source, { dir, force: true });',
      '  })',
      '  .catch(error => {',
      '    const message = error && error.message ? error.message : String(error);',
      '    process.stderr.write(String(message).trim() + "\\n");',
      '    process.exit(1);',
      '  });'
    ].join('\n');

    try {
      childProcess.execFileSync(execPath, ['-e', downloadScript, source.gigetSource, targetDir, source.host || ''], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000
      });
    } catch (error) {
      const detail = [
        error && error.stderr ? String(error.stderr).trim() : '',
        error && error.stdout ? String(error.stdout).trim() : ''
      ].filter(Boolean).join('\n').trim();

      if (/Cannot find package ['"]giget['"]/i.test(detail)) {
        throw new Error('required local dependency is not available in this environment');
      }
      throw new Error(detail || (error && error.message ? error.message : 'Workflow registry source download failed'));
    }
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
    const remoteSource = resolveRemoteGitRegistrySource(normalized, options);

    if (remoteSource) {
      try {
        downloadWorkflowRegistrySourceWithGiget(checkoutDir, remoteSource);
      } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw new Error(classifyWorkflowSourceDownloadError(error));
      }

      return {
        mode: 'git',
        root: checkoutDir,
        cleanup() {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        }
      };
    }

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
      if (error && error.code === 'ENOENT') {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        throw new Error('required local dependency is not available in this environment');
      }
      const detail = error && error.stderr ? String(error.stderr).trim() : '';
      fs.rmSync(tempRoot, { recursive: true, force: true });
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
