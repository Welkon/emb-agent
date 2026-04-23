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
    const downloadSubdir = overrideSubdir ? '' : embeddedSubdir;

    return {
      provider,
      repo,
      subdir: finalSubdir,
      ref: finalBranch,
      host,
      gigetSource: `${provider}:${repo}${downloadSubdir ? `/${downloadSubdir}` : ''}${finalBranch ? `#${finalBranch}` : ''}`
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
    const gigetEntryPath = require.resolve('giget');
    const downloadScript = [
      'const { pathToFileURL } = require("node:url");',
      'const [source, dir, host, gigetEntry] = process.argv.slice(1);',
      'if (!source || !dir || !gigetEntry) {',
      "  throw new Error('Missing giget workflow download arguments');",
      '}',
      'if (host) {',
      `  process.env.${GIGET_HOST_ENV_KEY} = "https://" + host;`,
      '}',
      'import(pathToFileURL(gigetEntry).href)',
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
      childProcess.execFileSync(execPath, ['-e', downloadScript, source.gigetSource, targetDir, source.host || '', gigetEntryPath], {
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

    const flatMarkdownFiles = fs.existsSync(baseRoot) && fs.statSync(baseRoot).isDirectory()
      ? fs.readdirSync(baseRoot).filter(name => name.toLowerCase().endsWith('.md') && !/^readme(?:\..*)?\.md$/i.test(name))
      : [];
    if (flatMarkdownFiles.length > 0) {
      return baseRoot;
    }

    throw new Error(`Workflow registry not found under source root: ${baseRoot}`);
  }

  function prettyName(value) {
    return String(value || '')
      .split(/[-_]+/)
      .filter(Boolean)
      .map(item => item.charAt(0).toUpperCase() + item.slice(1))
      .join(' ');
  }

  function parseFrontmatterScalar(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return '';
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^-?\d+$/u.test(value)) {
      return Number(value);
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (!inner) {
        return [];
      }
      return inner
        .split(',')
        .map(item => parseFrontmatterScalar(item))
        .filter(item => item !== '');
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  function assignFrontmatterValue(target, dottedKey, value) {
    const parts = String(dottedKey || '').trim().split('.').filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    let cursor = target;
    while (parts.length > 1) {
      const part = parts.shift();
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }

    cursor[parts[0]] = value;
  }

  function parseMarkdownFrontmatter(content) {
    const source = String(content || '');
    if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
      return {
        metadata: {},
        body: source
      };
    }

    const endMarker = source.indexOf('\n---', 4);
    if (endMarker === -1) {
      return {
        metadata: {},
        body: source
      };
    }

    const rawHead = source.slice(4, endMarker).replace(/\r/g, '');
    const body = source.slice(endMarker + 4).replace(/^\r?\n/, '');
    const metadata = {};

    rawHead.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      const match = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/u);
      if (!match) {
        return;
      }
      assignFrontmatterValue(metadata, match[1], parseFrontmatterScalar(match[2]));
    });

    return {
      metadata,
      body
    };
  }

  function firstHeadingFromMarkdown(content) {
    const match = String(content || '').match(/^#\s+(.+)$/m);
    return match ? String(match[1] || '').trim() : '';
  }

  function summarizeMarkdown(content) {
    const lines = String(content || '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed.startsWith('#')) {
        continue;
      }
      const cleaned = trimmed.replace(/^[-*]\s+/, '').trim();
      if (cleaned) {
        return cleaned;
      }
    }
    return '';
  }

  function toStringArray(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    return text ? [text] : [];
  }

  function discoverFlatWorkflowSpecs(baseRoot) {
    if (!fs.existsSync(baseRoot) || !fs.statSync(baseRoot).isDirectory()) {
      return null;
    }

    const markdownFiles = fs.readdirSync(baseRoot)
      .filter(name => name.toLowerCase().endsWith('.md'))
      .filter(name => !/^readme(?:\..*)?\.md$/i.test(name));

    if (markdownFiles.length === 0) {
      return null;
    }

    const sourcePathByEntryPath = new Map();
    const specs = markdownFiles.map(name => {
      const filePath = path.join(baseRoot, name);
      const raw = runtime.readText(filePath);
      const parsed = parseMarkdownFrontmatter(raw);
      const metadata = parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
        ? parsed.metadata
        : {};
      const baseName = name.slice(0, -3);
      const specName = ensureOptionalString(metadata.name) || baseName;
      const relativePath = `specs/${name}`;
      const entry = {
        name: specName,
        title: ensureOptionalString(metadata.title) || firstHeadingFromMarkdown(parsed.body) || prettyName(specName),
        path: relativePath,
        summary: ensureOptionalString(metadata.summary) || summarizeMarkdown(parsed.body) || 'Imported external spec.',
        auto_inject: metadata.auto_inject === true,
        selectable: metadata.selectable === undefined ? true : metadata.selectable === true,
        priority: Number.isInteger(metadata.priority) ? metadata.priority : 60,
        apply_when:
          metadata.apply_when && typeof metadata.apply_when === 'object' && !Array.isArray(metadata.apply_when)
            ? metadata.apply_when
            : { specs: [specName] },
        focus_areas: toStringArray(metadata.focus_areas),
        extra_review_axes: toStringArray(metadata.extra_review_axes),
        preferred_notes: toStringArray(metadata.preferred_notes),
        default_agents: toStringArray(metadata.default_agents)
      };

      sourcePathByEntryPath.set(relativePath, filePath);
      return entry;
    });

    return {
      registry: workflowRegistry.normalizeRegistry({
        version: 1,
        templates: [],
        specs
      }, 'Imported flat workflow specs'),
      sourcePathByEntryPath
    };
  }

  function resolveWorkflowSourceLayout(stagedRoot, options = {}) {
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
      if (!fs.existsSync(registryPath)) {
        continue;
      }

      return {
        kind: 'registry-tree',
        root: candidate,
        registry: workflowRegistry.normalizeRegistry(
          runtime.readJson(registryPath),
          'Imported workflow registry'
        ),
        resolveEntrySourcePath(kind, entry) {
          const relativePath = kind === 'template'
            ? String(entry.source || '').trim()
            : String(entry.path || '').trim();
          return path.join(candidate, relativePath);
        },
        cleanup() {}
      };
    }

    const flatCatalog = discoverFlatWorkflowSpecs(baseRoot);
    if (flatCatalog) {
      return {
        kind: 'flat-markdown-specs',
        root: baseRoot,
        registry: flatCatalog.registry,
        resolveEntrySourcePath(kind, entry) {
          if (kind !== 'spec') {
            return '';
          }
          return flatCatalog.sourcePathByEntryPath.get(String(entry.path || '').trim()) || '';
        },
        cleanup() {}
      };
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

  function uniqueNormalizedStrings(value) {
    return Array.from(new Set(
      (Array.isArray(value) ? value : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    ));
  }

  function shouldImportExternalSpecEntry(entry, options = {}) {
    const selectedSpecNames = uniqueNormalizedStrings(options.selected_specs);
    if (selectedSpecNames.length === 0) {
      return true;
    }

    const selectedSpecSet = new Set(selectedSpecNames);
    if (entry && entry.selectable === true) {
      return selectedSpecSet.has(String(entry.name || '').trim());
    }

    const applyWhen = entry && entry.apply_when && typeof entry.apply_when === 'object' && !Array.isArray(entry.apply_when)
      ? entry.apply_when
      : {};
    const projectProfile = String(options.project_profile || '').trim();
    const specTriggers = Array.isArray(applyWhen.specs)
      ? applyWhen.specs.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const profileTriggers = Array.isArray(applyWhen.profiles)
      ? applyWhen.profiles.map(item => String(item || '').trim()).filter(Boolean)
      : [];

    if (applyWhen.always === true) {
      return true;
    }
    if (projectProfile && profileTriggers.includes(projectProfile)) {
      return true;
    }
    if (specTriggers.some(name => selectedSpecSet.has(name))) {
      return true;
    }

    return Boolean(
      entry &&
      entry.auto_inject === true &&
      specTriggers.length === 0 &&
      profileTriggers.length === 0
    );
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
      const sourceLayout = resolveWorkflowSourceLayout(staged.root, options);

      try {
        const sourceRegistry = sourceLayout.registry;
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
            if (kind === 'spec' && !shouldImportExternalSpecEntry(entry, options)) {
              return;
            }
            const relativePath = String(entry[pathField] || '').trim();
            const sourcePath = sourceLayout.resolveEntrySourcePath(kind, entry);
            const targetPath = path.join(projectExtDir, relativePath);
            const existingEntry = (projectRegistry[key] || []).find(item => item && item.name === entry.name);

            if (!sourcePath || !fs.existsSync(sourcePath)) {
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
            source_kind: sourceLayout.kind,
            root: sourceLayout.root,
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
        sourceLayout.cleanup();
      }
    } finally {
      staged.cleanup();
    }
  }

  return {
    importProjectWorkflowRegistry,
    resolveWorkflowSourceLayout,
    resolveWorkflowRegistryRoot,
    stageWorkflowRegistrySource
  };
}

module.exports = {
  createWorkflowImportHelpers
};
