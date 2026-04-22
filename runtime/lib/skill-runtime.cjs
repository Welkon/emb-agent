'use strict';

const os = require('os');
const defaultSkillSource = require('./default-skill-source.cjs');

let gigetModulePromise = null;

function createSkillRuntimeHelpers(deps) {
  const {
    childProcess,
    fs,
    os: injectedOs,
    path,
    process,
    runtime,
    runtimeConfig,
    runtimeHost,
    resolveProjectRoot,
    getProjectExtDir,
    updateSession,
    builtInSkillsDir,
    builtInDisplayRoot,
    loadGiget
  } = deps;

  const operatingSystem = injectedOs || os;
  const DISCOVERY_ITEM_LIMIT = 250;
  const DISCOVERY_TOTAL_LIMIT = 2400;
  const FALLBACK_ALLOWED_TOOLS = [];
  const PLUGIN_STATE_FILE = 'install.json';
  const PLUGIN_PAYLOAD_DIR = 'payload';
  const PLUGIN_RUNTIME_DIR = '.runtime';
  const PLUGIN_RUNTIME_NODE_DIR = path.join(PLUGIN_RUNTIME_DIR, 'node');
  const PLUGIN_RUNTIME_PYTHON_DIR = path.join(PLUGIN_RUNTIME_DIR, 'python');
  const PLUGIN_MANIFEST_CANDIDATES = [
    '.emb-agent-plugin/plugin.json',
    'emb-agent-plugin.json'
  ];
  const MAX_MANIFEST_SEARCH_DEPTH = 6;
  const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
  const MANAGED_ENTRY_METADATA_KEY = 'emb_agent_managed_entry';
  const GIGET_HOST_ENV_KEY = 'GIGET_GITLAB_URL';
  const GIGET_SUPPORTED_PROVIDERS = new Set(['gh', 'github', 'gitlab', 'bitbucket']);
  const KNOWN_PUBLIC_GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];
  const PUBLIC_GIT_HOST_PREFIX = {
    'github.com': 'gh',
    'gitlab.com': 'gitlab',
    'bitbucket.org': 'bitbucket'
  };

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function ensureObject(value, label) {
    if (!isObject(value)) {
      throw new Error(`${label} must be an object`);
    }
    return value;
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

  function ensureBoolean(value, label, fallback) {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value !== 'boolean') {
      throw new Error(`${label} must be a boolean`);
    }
    return value;
  }

  function normalizeRelativePath(rootDir, value, label) {
    const text = ensureOptionalString(value);
    if (!text) {
      return '';
    }
    const resolved = path.resolve(rootDir, text);
    const relative = path.relative(rootDir, resolved).replace(/\\/g, '/');
    if (!relative || relative === '.') {
      return '';
    }
    return relative;
  }

  function toPortableAbsolutePath(filePath) {
    return path.resolve(filePath).replace(/\\/g, '/');
  }

  function parseScalar(raw) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  function parseFrontmatter(content) {
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
    let currentListKey = '';

    for (const line of rawHead.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      if (line.startsWith('  - ')) {
        if (!currentListKey) {
          continue;
        }
        metadata[currentListKey].push(parseScalar(line.slice(4)));
        continue;
      }

      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u);
      if (!match) {
        currentListKey = '';
        continue;
      }

      const key = match[1];
      const rawValue = match[2] || '';
      if (!rawValue) {
        metadata[key] = [];
        currentListKey = key;
        continue;
      }

      metadata[key] = parseScalar(rawValue);
      currentListKey = '';
    }

    return {
      metadata,
      body
    };
  }

  function toStringArray(value) {
    return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
  }

  function uniqueStrings(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(item => String(item || '').trim()).filter(Boolean)));
  }

  function truncateText(value, limit) {
    const text = String(value || '').trim();
    if (!text || text.length <= limit) {
      return text;
    }
    return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
  }

  function splitCommandWords(command) {
    const input = String(command || '').trim();
    if (!input) {
      return [];
    }

    const parts = [];
    let current = '';
    let quote = '';
    let escape = false;

    for (const char of input) {
      if (escape) {
        current += char;
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = '';
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === '\'') {
        quote = char;
        continue;
      }

      if (/\s/u.test(char)) {
        if (current) {
          parts.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  async function loadGigetModule() {
    if (typeof loadGiget === 'function') {
      return await loadGiget();
    }
    if (!gigetModulePromise) {
      gigetModulePromise = import('giget');
    }
    return gigetModulePromise;
  }

  async function withPromiseTimeout(promise, ms, label) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.ceil(ms / 1000)}s`));
      }, ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function withGigetHost(host, callback) {
    if (!host) {
      return callback();
    }

    const previous = process.env[GIGET_HOST_ENV_KEY];
    process.env[GIGET_HOST_ENV_KEY] = `https://${host}`;
    try {
      return await callback();
    } finally {
      if (previous === undefined) {
        delete process.env[GIGET_HOST_ENV_KEY];
      } else {
        process.env[GIGET_HOST_ENV_KEY] = previous;
      }
    }
  }

  function normalizeRemoteGitSource(source) {
    const input = ensureNonEmptyString(source, 'Skill source');
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

  function resolveRemoteGitBundleSource(source, options = {}) {
    const rawSource = ensureNonEmptyString(source, 'Skill source');
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
      throw new Error(`Skill source is invalid: ${rawSource}`);
    }

    const pathPart = String(refMatch[1] || '').trim();
    const embeddedBranch = ensureOptionalString(refMatch[2]);
    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Skill source is invalid: ${rawSource}`);
    }

    const repo = `${segments[0]}/${segments[1]}`;
    const embeddedSubdir = segments.slice(2).join('/');
    const finalBranch = overrideBranch || embeddedBranch;
    const finalSubdir = overrideSubdir || embeddedSubdir;
    const gigetSource = `${provider}:${repo}${finalSubdir ? `/${finalSubdir}` : ''}${finalBranch ? `#${finalBranch}` : ''}`;

    return {
      provider,
      repo,
      subdir: finalSubdir,
      ref: finalBranch,
      host,
      gigetSource
    };
  }

  function classifyRemoteSourceDownloadError(error) {
    const message = String(error && error.message ? error.message : '').trim();
    if (!message) {
      return 'Could not download skill source.';
    }
    if (/timed out/i.test(message)) {
      return 'Skill source download timed out. Check your network connection and try again.';
    }
    if (/404|not found/i.test(message)) {
      return 'Skill source was not found or is not accessible.';
    }
    if (
      /failed to download|failed to fetch|fetch failed|network|econn|enotfound|etimedout|socket/i.test(message)
    ) {
      return 'Could not reach skill source. Check your network connection and try again.';
    }
    return `Could not download skill source: ${message}`;
  }

  function normalizeSkillName(value, fallback) {
    const text = String(value || fallback || '').trim();
    if (!text) {
      throw new Error('Skill name is required');
    }
    return text;
  }

  function normalizeExecutionMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'isolated' || normalized === 'fork') {
      return 'isolated';
    }
    if (normalized === 'command' || normalized === 'exec' || normalized === 'process') {
      return 'command';
    }
    return 'inline';
  }

  function normalizeCommandInputMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'stdin') {
      return 'stdin';
    }
    return 'argv';
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill';
  }

  function walkMarkdownFiles(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }

    const files = [];
    const queue = [dirPath];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const name of fs.readdirSync(current)) {
        const filePath = path.join(current, name);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          queue.push(filePath);
          continue;
        }
        if (name.endsWith('.md')) {
          files.push(filePath);
        }
      }
    }

    return files.sort();
  }

  function walkSkillEntryFiles(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }

    const files = [];
    const queue = [dirPath];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const name of fs.readdirSync(current)) {
        const filePath = path.join(current, name);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          queue.push(filePath);
          continue;
        }
        if (name.toUpperCase() === 'SKILL.MD') {
          files.push(filePath);
        }
      }
    }

    return files.sort();
  }

  function listImmediateDirectories(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }
    return fs.readdirSync(dirPath)
      .map(name => path.join(dirPath, name))
      .filter(filePath => {
        try {
          return fs.statSync(filePath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  }

  function getDisplayPath(filePath, sourceRoot) {
    const root = sourceRoot || builtInDisplayRoot || builtInSkillsDir;
    return path.relative(root, filePath).replace(/\\/g, '/');
  }

  function getRuntimeHost() {
    return typeof runtimeHost === 'function' ? runtimeHost() : runtimeHost;
  }

  function getSkillBaseDir(filePath) {
    const baseName = path.basename(filePath).toUpperCase();
    if (baseName === 'SKILL.MD') {
      return path.dirname(filePath);
    }
    return path.dirname(filePath);
  }

  function getSkillFallbackName(filePath) {
    const baseName = path.basename(filePath, path.extname(filePath));
    if (baseName.toUpperCase() === 'SKILL') {
      return path.basename(path.dirname(filePath));
    }
    return baseName;
  }

  function resolveCommandArray(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    return text ? splitCommandWords(text) : [];
  }

  function sourcePriority(source) {
    if (source === 'local') return 60;
    if (source === 'project-plugin') return 50;
    if (source === 'project') return 45;
    if (source === 'user-plugin') return 35;
    if (source === 'user') return 30;
    return 10;
  }

  function pluginScopePriority(scope) {
    return scope === 'project' ? 2 : 1;
  }

  function buildSkillMetadata(filePath, sourceRoot, extras = {}) {
    const raw = runtime.readText(filePath);
    const parsed = parseFrontmatter(raw);
    const metadata = parsed.metadata || {};
    const skillName = normalizeSkillName(
      metadata.name,
      extras.fallback_name || getSkillFallbackName(filePath)
    );
    const description = String(metadata.description || '').trim();
    const whenToUse = String(metadata.when_to_use || metadata.when || '').trim();
    const allowedTools = toStringArray(
      metadata.allowed_tools || metadata['allowed-tools'] || FALLBACK_ALLOWED_TOOLS
    );
    const hooks = toStringArray(metadata.hooks || []);
    const executionMode = normalizeExecutionMode(metadata.execution_mode || metadata.execution || '');
    const source = extras.source || (sourceRoot && sourceRoot.source ? sourceRoot.source : 'project');
    const command = resolveCommandArray(
      metadata.command || metadata.command_argv || metadata.entry || metadata.exec || ''
    );
    const commandInput = normalizeCommandInputMode(
      metadata.command_input || metadata.input_mode || metadata.input || ''
    );
    const workingDirectory = String(metadata.working_directory || metadata.cwd || '').trim();
    const evidenceHint = toStringArray(metadata.evidence_hint || metadata.evidence || []);

    return {
      name: skillName,
      description,
      when_to_use: whenToUse,
      discovery_text: truncateText(
        [description, whenToUse].filter(Boolean).join(' | ') || skillName,
        DISCOVERY_ITEM_LIMIT
      ),
      allowed_tools: allowedTools,
      hooks,
      execution_mode: executionMode,
      source,
      source_priority: extras.source_priority || sourcePriority(source),
      file_path: filePath,
      base_dir: extras.base_dir || getSkillBaseDir(filePath),
      display_path: getDisplayPath(
        filePath,
        extras.display_root || (sourceRoot ? sourceRoot.display_root : builtInDisplayRoot)
      ),
      content: parsed.body,
      raw_content: raw,
      command,
      command_input: commandInput,
      working_directory: workingDirectory,
      evidence_hint: evidenceHint,
      enabled: extras.enabled !== false,
      plugin: extras.plugin || null
    };
  }

  function getUserSkillsDir(host) {
    if (!host || !host.runtimeHome) {
      return '';
    }
    const candidate = path.join(host.runtimeHome, 'skills');
    if (path.resolve(candidate) === path.resolve(builtInSkillsDir)) {
      return '';
    }
    return candidate;
  }

  function getUserPluginRoot(host) {
    if (!host || !host.runtimeHome) {
      return '';
    }
    return host.sourceLayout
      ? path.join(host.runtimeHome, '.tmp', 'plugins')
      : path.join(host.runtimeHome, 'plugins');
  }

  function buildDirectSkillSourceRoots() {
    const host = getRuntimeHost();
    const userSkillsDir = getUserSkillsDir(host);
    const projectRoot = resolveProjectRoot();
    return [
      {
        source: 'local',
        dir: path.join(getProjectExtDir(), 'skills-local'),
        display_root: projectRoot
      },
      {
        source: 'project',
        dir: path.join(getProjectExtDir(), 'skills'),
        display_root: projectRoot
      },
      {
        source: 'user',
        dir: userSkillsDir,
        display_root: host && host.runtimeHome ? host.runtimeHome : builtInDisplayRoot || builtInSkillsDir
      },
      {
        source: 'built-in',
        dir: builtInSkillsDir,
        display_root: builtInDisplayRoot || builtInSkillsDir
      }
    ].filter(item => item.dir);
  }

  function buildInstalledPluginRoots() {
    const host = getRuntimeHost();
    return [
      {
        scope: 'project',
        source: 'project-plugin',
        dir: path.join(getProjectExtDir(), 'plugins'),
        display_root: resolveProjectRoot()
      },
      {
        scope: 'user',
        source: 'user-plugin',
        dir: getUserPluginRoot(host),
        display_root: host && host.runtimeHome ? host.runtimeHome : builtInDisplayRoot || builtInSkillsDir
      }
    ].filter(item => item.dir);
  }

  function isDirectory(dirPath) {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  function buildProjectSkillEntryRoots() {
    const projectRoot = resolveProjectRoot();
    const codexRoot = path.join(projectRoot, '.codex');
    const cursorRoot = path.join(projectRoot, '.cursor');
    const sharedRoot = path.join(projectRoot, '.agents');
    const roots = [];

    if (isDirectory(codexRoot) || isDirectory(cursorRoot) || isDirectory(sharedRoot)) {
      roots.push({
        kind: 'shared',
        dir: path.join(sharedRoot, 'skills')
      });
    }

    return roots;
  }

  function buildUserSkillEntryRoots() {
    const host = getRuntimeHost();
    if (!host || !host.runtimeHome || host.sourceLayout) {
      return [];
    }
    if (host.name !== 'codex' && host.name !== 'cursor') {
      return [];
    }
    return [
      {
        kind: host.name,
        dir: path.join(host.runtimeHome, 'skills')
      }
    ];
  }

  function buildSkillEntryRoots(scope) {
    return scope === 'project'
      ? buildProjectSkillEntryRoots()
      : buildUserSkillEntryRoots();
  }

  function isManagedSkillEntryFile(filePath, skillName) {
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    try {
      const parsed = parseFrontmatter(runtime.readText(filePath));
      const metadata = parsed.metadata || {};
      return metadata[MANAGED_ENTRY_METADATA_KEY] === true &&
        ensureOptionalString(metadata.emb_agent_entry_target || '') === String(skillName || '').trim();
    } catch {
      return false;
    }
  }

  function readSkillEntrySource(skill) {
    const raw = runtime.readText(skill.file_path);
    const parsed = parseFrontmatter(raw);
    return {
      metadata: parsed.metadata || {},
      body: String(parsed.body || '').trim()
    };
  }

  function buildManagedSkillEntryContent(skill, entryRoot) {
    const source = readSkillEntrySource(skill);
    const metadata = source.metadata || {};
    const description = String(metadata.description || skill.description || `Run emb-agent skill ${skill.name}`).trim();
    const whenToUse = String(metadata.when_to_use || metadata.when || '').trim();
    const runtimeCli = getRuntimeHost().cliCommand;
    const header =
      entryRoot.kind === 'shared'
        ? `This shared skill entry routes matching requests to \`${runtimeCli} skills run ${skill.name}\`.`
        : `This ${entryRoot.kind} skill entry routes matching requests to \`${runtimeCli} skills run ${skill.name}\`.`;

    const lines = [
      '---',
      `name: ${skill.name}`,
      `description: ${JSON.stringify(description)}`,
      whenToUse ? `when_to_use: ${JSON.stringify(whenToUse)}` : '',
      `${MANAGED_ENTRY_METADATA_KEY}: true`,
      `emb_agent_entry_target: ${skill.name}`,
      `emb_agent_entry_kind: ${entryRoot.kind}`,
      '---',
      '',
      `# ${skill.name}`,
      '',
      header,
      '',
      '## Invocation',
      '',
      `- When this skill matches the user intent, run \`${runtimeCli} skills run ${skill.name}\` with any required extra arguments.`,
      '- If the skill needs passthrough arguments, append them after `--` instead of improvising a different workflow.',
      '- Treat emb-agent output as the source of truth for the next step.',
      '',
      '## Original Guidance',
      '',
      source.body || `Run \`${runtimeCli} skills run ${skill.name}\`.`,
      ''
    ].filter(line => line !== '');

    return lines.join('\n');
  }

  function writeManagedSkillEntry(entryRoot, skill) {
    const skillDir = path.join(entryRoot.dir, skill.name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillFile) && !isManagedSkillEntryFile(skillFile, skill.name)) {
      return false;
    }

    runtime.ensureDir(skillDir);
    fs.writeFileSync(skillFile, buildManagedSkillEntryContent(skill, entryRoot), 'utf8');
    return true;
  }

  function removeManagedSkillEntry(entryRoot, skillName) {
    const skillDir = path.join(entryRoot.dir, skillName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile) || !isManagedSkillEntryFile(skillFile, skillName)) {
      return false;
    }

    removePathRecursive(skillDir);
    return true;
  }

  function syncPluginSkillEntries(bundle) {
    if (!bundle || !bundle.plugin || !bundle.plugin.scope || !Array.isArray(bundle.skills)) {
      return;
    }

    const entryRoots = buildSkillEntryRoots(bundle.plugin.scope);
    if (entryRoots.length === 0) {
      return;
    }

    entryRoots.forEach(entryRoot => {
      bundle.skills.forEach(skill => {
        if (skill && skill.enabled !== false) {
          writeManagedSkillEntry(entryRoot, skill);
          return;
        }
        removeManagedSkillEntry(entryRoot, skill && skill.name ? skill.name : '');
      });
    });
  }

  function removePluginSkillEntries(bundle) {
    if (!bundle || !bundle.plugin || !bundle.plugin.scope || !Array.isArray(bundle.skills)) {
      return;
    }

    buildSkillEntryRoots(bundle.plugin.scope).forEach(entryRoot => {
      bundle.skills.forEach(skill => {
        removeManagedSkillEntry(entryRoot, skill && skill.name ? skill.name : '');
      });
    });
  }

  function copyPathRecursive(sourcePath, targetPath) {
    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      runtime.ensureDir(targetPath);
      for (const name of fs.readdirSync(sourcePath)) {
        copyPathRecursive(path.join(sourcePath, name), path.join(targetPath, name));
      }
      return;
    }

    runtime.ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }

  function removePathRecursive(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return;
    }
    fs.rmSync(targetPath, {
      recursive: true,
      force: true
    });
  }

  function safeRealPath(filePath) {
    try {
      return fs.realpathSync(filePath);
    } catch {
      return path.resolve(filePath);
    }
  }

  function safeReadJson(filePath) {
    try {
      return runtime.readJson(filePath);
    } catch {
      return null;
    }
  }

  function discoverPluginSkillFiles(rootDir) {
    const resolvedRoot = path.resolve(rootDir);
    const discovered = [];
    const seen = new Set();

    function pushDiscovered(filePath) {
      const realPath = safeRealPath(filePath);
      if (seen.has(realPath)) {
        return;
      }
      seen.add(realPath);
      discovered.push(filePath);
    }

    function resolveSkillEntriesForPath(targetPath) {
      if (!targetPath || !fs.existsSync(targetPath)) {
        return [];
      }

      let stats;
      try {
        stats = fs.statSync(targetPath);
      } catch {
        stats = null;
      }
      if (!stats) {
        return [];
      }

      if (stats.isDirectory()) {
        const directSkill = path.join(targetPath, 'SKILL.md');
        if (fs.existsSync(directSkill) && fs.statSync(directSkill).isFile()) {
          return [directSkill];
        }
        return walkSkillEntryFiles(targetPath);
      }

      return path.basename(targetPath).toUpperCase() === 'SKILL.MD' ? [targetPath] : [];
    }

    const directSkill = path.join(resolvedRoot, 'SKILL.md');
    if (fs.existsSync(directSkill)) {
      pushDiscovered(directSkill);
    }

    const catalogIndex = safeReadJson(path.join(resolvedRoot, 'index.json'));
    if (catalogIndex && Array.isArray(catalogIndex.skills) && catalogIndex.skills.length > 0) {
      catalogIndex.skills.forEach(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return;
        }
        const entryPath = ensureOptionalString(entry.path || entry.skill_path || entry.file);
        if (!entryPath) {
          return;
        }
        resolveSkillEntriesForPath(path.resolve(resolvedRoot, entryPath)).forEach(pushDiscovered);
      });
      if (discovered.length > 0) {
        return discovered;
      }
    }

    const skillsDir = path.join(resolvedRoot, 'skills');
    walkSkillEntryFiles(skillsDir).forEach(pushDiscovered);

    return discovered.sort();
  }

  function findPluginManifestPath(searchRoot) {
    const queue = [{ dir: path.resolve(searchRoot), depth: 0 }];
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      const currentDir = current.dir;
      if (visited.has(currentDir)) {
        continue;
      }
      visited.add(currentDir);

      for (const candidate of PLUGIN_MANIFEST_CANDIDATES) {
        const filePath = path.join(currentDir, candidate);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return filePath;
        }
      }

      if (current.depth >= MAX_MANIFEST_SEARCH_DEPTH) {
        continue;
      }

      for (const name of fs.readdirSync(currentDir)) {
        const filePath = path.join(currentDir, name);
        let stats;
        try {
          stats = fs.statSync(filePath);
        } catch {
          stats = null;
        }
        if (!stats || !stats.isDirectory()) {
          continue;
        }
        queue.push({
          dir: filePath,
          depth: current.depth + 1
        });
      }
    }

    return '';
  }

  function resolvePluginRootFromManifestPath(manifestPath) {
    const normalized = path.resolve(manifestPath);
    const pluginDirSuffix = `${path.sep}.emb-agent-plugin${path.sep}plugin.json`;
    const simpleSuffix = `${path.sep}emb-agent-plugin.json`;

    if (normalized.endsWith(pluginDirSuffix)) {
      return path.dirname(path.dirname(normalized));
    }
    if (normalized.endsWith(simpleSuffix)) {
      return path.dirname(normalized);
    }
    return path.dirname(normalized);
  }

  function resolveManifestSkillFiles(skillSpec, pluginRoot, pluginName) {
    const skillFiles = [];
    const seen = new Set();

    function pushSkillFile(filePath) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Plugin ${pluginName} skill path does not exist: ${filePath}`);
      }
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        stats = null;
      }
      if (!stats) {
        throw new Error(`Plugin ${pluginName} skill path is invalid: ${filePath}`);
      }

      if (stats.isDirectory()) {
        const candidates = [];
        const directSkill = path.join(filePath, 'SKILL.md');
        if (fs.existsSync(directSkill)) {
          candidates.push(directSkill);
        } else {
          candidates.push(...walkSkillEntryFiles(filePath));
        }

        candidates.forEach(candidate => {
          const realPath = safeRealPath(candidate);
          if (seen.has(realPath)) {
            return;
          }
          seen.add(realPath);
          skillFiles.push(candidate);
        });
        return;
      }

      const realPath = safeRealPath(filePath);
      if (seen.has(realPath)) {
        return;
      }
      seen.add(realPath);
      skillFiles.push(filePath);
    }

    if (skillSpec === undefined || skillSpec === null || skillSpec === '') {
      discoverPluginSkillFiles(pluginRoot).forEach(pushSkillFile);
      return skillFiles;
    }

    if (typeof skillSpec === 'string') {
      const resolved = path.resolve(pluginRoot, skillSpec);
      pushSkillFile(resolved);
      return skillFiles;
    }

    if (!Array.isArray(skillSpec)) {
      throw new Error(`Plugin ${pluginName} skills must be a string or array`);
    }

    skillSpec.forEach((entry, index) => {
      if (typeof entry === 'string') {
        pushSkillFile(path.resolve(pluginRoot, entry));
        return;
      }

      ensureObject(entry, `Plugin ${pluginName} skills[${index}]`);
      const entryPath = ensureNonEmptyString(entry.path || entry.file || '', `Plugin ${pluginName} skills[${index}].path`);
      pushSkillFile(path.resolve(pluginRoot, entryPath));
    });

    return skillFiles;
  }

  function inferGeneratedPluginFallbackName(parsed, searchRoot) {
    const sourceType = normalizeInstallSourceType(parsed.source, parsed.source_type);
    const sourceSpec = stripInstallSourcePrefix(parsed.source, sourceType);

    if (sourceType === 'path') {
      return path.basename(path.resolve(resolveProjectRoot(), sourceSpec), path.extname(sourceSpec));
    }

    if (sourceType === 'git') {
      const remoteBundleSource = resolveRemoteGitBundleSource(sourceSpec, {
        branch: parsed.branch,
        subdir: parsed.subdir
      });
      if (remoteBundleSource && remoteBundleSource.repo) {
        return remoteBundleSource.repo.split('/').filter(Boolean).slice(-1)[0] || path.basename(searchRoot);
      }

      const cleaned = String(sourceSpec || '').trim().replace(/\.git\/?$/i, '').replace(/\/$/, '');
      const segments = cleaned.split(/[/:]/).filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : path.basename(searchRoot);
    }

    const sanitized = String(sourceSpec || '').trim().replace(/^@/, '').replace(/[@/]+/g, '-');
    return sanitized || path.basename(searchRoot);
  }

  function ensureGeneratedPluginManifest(pluginRoot, fallbackName) {
    const skillFiles = discoverPluginSkillFiles(pluginRoot);
    if (skillFiles.length === 0) {
      throw new Error(`No installable skill bundle was found under ${pluginRoot}`);
    }

    const manifestPath = path.join(pluginRoot, '.emb-agent-plugin', 'plugin.json');
    const manifest = {
      name: slugify(fallbackName || path.basename(pluginRoot)),
      version: '0.0.0',
      description: '',
      skills: skillFiles.map(filePath => {
        const relativePath = path.relative(pluginRoot, filePath).replace(/\\/g, '/');
        return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
      })
    };
    runtime.writeJson(manifestPath, manifest);
    return manifestPath;
  }

  function normalizeNodePackageSpec(rawSpec, baseDir) {
    const spec = ensureNonEmptyString(rawSpec, 'Node dependency spec');
    if (spec.startsWith('file:')) {
      return `file:${toPortableAbsolutePath(path.resolve(baseDir, spec.slice(5)))}`;
    }
    if (spec.startsWith('link:')) {
      return `file:${toPortableAbsolutePath(path.resolve(baseDir, spec.slice(5)))}`;
    }
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return `file:${toPortableAbsolutePath(path.resolve(baseDir, spec))}`;
    }
    return spec;
  }

  function normalizeNodeDependencyMap(value, baseDir, label) {
    if (value === undefined || value === null) {
      return {};
    }
    ensureObject(value, label);

    const normalized = {};
    Object.entries(value).forEach(([name, rawSpec]) => {
      const dependencyName = ensureNonEmptyString(name, `${label} key`);
      normalized[dependencyName] = normalizeNodePackageSpec(rawSpec, baseDir);
    });
    return normalized;
  }

  function normalizeNodePackageList(value, baseDir, label) {
    if (value === undefined || value === null) {
      return [];
    }

    if (Array.isArray(value)) {
      return uniqueStrings(value.map(item => normalizeNodePackageSpec(item, baseDir)));
    }

    if (isObject(value)) {
      return Object.entries(normalizeNodeDependencyMap(value, baseDir, label))
        .map(([name, spec]) => `${name}@${spec}`);
    }

    throw new Error(`${label} must be an array or object`);
  }

  function normalizePythonPackageSpec(rawSpec, baseDir) {
    const spec = ensureNonEmptyString(rawSpec, 'Python dependency spec');
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return toPortableAbsolutePath(path.resolve(baseDir, spec));
    }
    return spec;
  }

  function normalizePythonPackageList(value, baseDir, label) {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error(`${label} must be an array`);
    }
    return uniqueStrings(value.map(item => normalizePythonPackageSpec(item, baseDir)));
  }

  function normalizePluginDependencies(value, pluginRoot, pluginName) {
    const source = value === undefined || value === null ? {} : value;
    ensureObject(source, `Plugin ${pluginName} dependencies`);

    const nodeSource = source.node === undefined || source.node === null ? {} : source.node;
    const pythonSource = source.python === undefined || source.python === null ? {} : source.python;
    const systemSource =
      source.system_requirements === undefined || source.system_requirements === null
        ? source.system
        : source.system_requirements;

    ensureObject(nodeSource, `Plugin ${pluginName} dependencies.node`);
    ensureObject(pythonSource, `Plugin ${pluginName} dependencies.python`);

    const packageJsonPath = normalizeRelativePath(
      pluginRoot,
      nodeSource.package_json || nodeSource.packageJson || (fs.existsSync(path.join(pluginRoot, 'package.json')) ? 'package.json' : ''),
      `Plugin ${pluginName} dependencies.node.package_json`
    );
    const requirementsPath = normalizeRelativePath(
      pluginRoot,
      pythonSource.requirements || (fs.existsSync(path.join(pluginRoot, 'requirements.txt')) ? 'requirements.txt' : ''),
      `Plugin ${pluginName} dependencies.python.requirements`
    );

    return {
      node: {
        install: ensureBoolean(nodeSource.install, `Plugin ${pluginName} dependencies.node.install`, true),
        package_json: packageJsonPath,
        packages: normalizeNodePackageList(
          nodeSource.packages,
          pluginRoot,
          `Plugin ${pluginName} dependencies.node.packages`
        )
      },
      python: {
        install: ensureBoolean(pythonSource.install, `Plugin ${pluginName} dependencies.python.install`, true),
        requirements: requirementsPath,
        packages: normalizePythonPackageList(
          pythonSource.packages,
          pluginRoot,
          `Plugin ${pluginName} dependencies.python.packages`
        )
      },
      system_requirements: uniqueStrings(
        Array.isArray(systemSource)
          ? systemSource.map(item => ensureNonEmptyString(item, `Plugin ${pluginName} system requirement`))
          : []
      )
    };
  }

  function loadNormalizedPluginManifest(manifestPath) {
    const raw = safeReadJson(manifestPath);
    if (!raw) {
      throw new Error(`Plugin manifest is invalid: ${manifestPath}`);
    }

    const pluginRoot = resolvePluginRootFromManifestPath(manifestPath);
    const pluginName = ensureNonEmptyString(raw.name || path.basename(pluginRoot), 'Plugin name');
    const version = ensureOptionalString(raw.version) || '0.0.0';
    const description = ensureOptionalString(raw.description);
    const dependencies = normalizePluginDependencies(raw.dependencies || {}, pluginRoot, pluginName);
    const skillFiles = resolveManifestSkillFiles(raw.skills, pluginRoot, pluginName);
    if (skillFiles.length === 0) {
      throw new Error(`Plugin ${pluginName} does not expose any skills`);
    }

    const skills = skillFiles.map(filePath => {
      const metadata = buildSkillMetadata(
        filePath,
        {
          source: 'project-plugin',
          display_root: pluginRoot
        },
        {
          source: 'project-plugin',
          display_root: pluginRoot,
          source_priority: sourcePriority('project-plugin')
        }
      );
      return {
        name: metadata.name,
        file_path: filePath,
        display_path: path.relative(pluginRoot, filePath).replace(/\\/g, '/'),
        description: metadata.description,
        execution_mode: metadata.execution_mode
      };
    });

    return {
      name: pluginName,
      version,
      description,
      manifest_path: manifestPath,
      plugin_root: pluginRoot,
      dependencies,
      skills
    };
  }

  function buildPluginState(pluginRoot, rootConfig, normalizedManifest) {
    const config = isObject(rootConfig) ? rootConfig : {};
    const allSkillNames = normalizedManifest.skills.map(item => item.name);
    const enabledSkills = Array.isArray(config.enabled_skills)
      ? uniqueStrings(config.enabled_skills)
      : allSkillNames;

    return {
      version: Number(config.version || 1) || 1,
      name: ensureOptionalString(config.name) || normalizedManifest.name,
      description: ensureOptionalString(config.description) || normalizedManifest.description,
      plugin_version: ensureOptionalString(config.plugin_version) || normalizedManifest.version,
      scope: ensureOptionalString(config.scope) || 'project',
      manifest_relpath: ensureOptionalString(config.manifest_relpath),
      payload_root: ensureOptionalString(config.payload_root),
      installed_at: ensureOptionalString(config.installed_at),
      enabled_skills: enabledSkills,
      runtime: isObject(config.runtime)
        ? {
            root: ensureOptionalString(config.runtime.root),
            ready: ensureBoolean(config.runtime.ready, 'plugin runtime.ready', true),
            node: isObject(config.runtime.node)
              ? {
                  module_paths: toStringArray(config.runtime.node.module_paths || []),
                  bin_paths: toStringArray(config.runtime.node.bin_paths || [])
                }
              : {
                  module_paths: [],
                  bin_paths: []
                },
            python: isObject(config.runtime.python)
              ? {
                  path_entries: toStringArray(config.runtime.python.path_entries || [])
                }
              : {
                  path_entries: []
                },
            system_requirements: toStringArray(config.runtime.system_requirements || [])
          }
        : {
            root: '',
            ready: true,
            node: {
              module_paths: [],
              bin_paths: []
            },
            python: {
              path_entries: []
            },
            system_requirements: normalizedManifest.dependencies.system_requirements.slice()
          },
      source: isObject(config.source)
        ? {
            type: ensureOptionalString(config.source.type) || 'path',
            specifier: ensureOptionalString(config.source.specifier),
            location: ensureOptionalString(config.source.location),
            branch: ensureOptionalString(config.source.branch),
            subdir: ensureOptionalString(config.source.subdir)
          }
        : {
            type: 'path',
            specifier: '',
            location: '',
            branch: '',
            subdir: ''
          }
    };
  }

  function writePluginState(pluginDir, state) {
    runtime.writeJson(path.join(pluginDir, PLUGIN_STATE_FILE), state);
  }

  function readInstalledPluginBundle(pluginDir, rootInfo) {
    const statePath = path.join(pluginDir, PLUGIN_STATE_FILE);
    const savedState = safeReadJson(statePath);
    let manifestPath = '';

    if (savedState && savedState.manifest_relpath) {
      manifestPath = path.join(pluginDir, savedState.manifest_relpath);
    }
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      manifestPath = findPluginManifestPath(pluginDir);
    }
    if (!manifestPath) {
      return null;
    }

    const normalizedManifest = loadNormalizedPluginManifest(manifestPath);
    const state = buildPluginState(pluginDir, savedState, normalizedManifest);
    const runtimeInfo = {
      root: state.runtime.root ? path.join(pluginDir, state.runtime.root) : '',
      ready: state.runtime.ready !== false,
      node: {
        module_paths: state.runtime.node.module_paths.map(item => path.join(pluginDir, item)),
        bin_paths: state.runtime.node.bin_paths.map(item => path.join(pluginDir, item))
      },
      python: {
        path_entries: state.runtime.python.path_entries.map(item => path.join(pluginDir, item))
      },
      system_requirements: state.runtime.system_requirements.slice()
    };
    const pluginInfo = {
      name: normalizedManifest.name,
      version: normalizedManifest.version,
      description: normalizedManifest.description,
      scope: rootInfo.scope,
      install_path: pluginDir,
      plugin_root: normalizedManifest.plugin_root,
      source_type: state.source.type || 'path',
      source_location: state.source.location || state.source.specifier || '',
      installed_at: state.installed_at || '',
      source_priority: sourcePriority(rootInfo.source),
      runtime: runtimeInfo,
      dependencies: normalizedManifest.dependencies
    };

    const skills = normalizedManifest.skills.map(skill => ({
      ...skill,
      enabled: state.enabled_skills.includes(skill.name)
    }));

    return {
      root: rootInfo,
      plugin: pluginInfo,
      state,
      skills,
      manifest_path: manifestPath
    };
  }

  function listInstalledPluginBundles() {
    const bundles = [];
    buildInstalledPluginRoots().forEach(rootInfo => {
      listImmediateDirectories(rootInfo.dir).forEach(pluginDir => {
        const bundle = readInstalledPluginBundle(pluginDir, rootInfo);
        if (bundle) {
          bundles.push(bundle);
        }
      });
    });

    return bundles.sort((left, right) => {
      const priorityDelta = pluginScopePriority(right.plugin.scope) - pluginScopePriority(left.plugin.scope);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.plugin.name.localeCompare(right.plugin.name);
    });
  }

  function buildCandidateSkillEntries(options = {}) {
    const includeDisabled = Boolean(options.include_disabled);
    const candidates = [];
    const seenPaths = new Set();

    buildDirectSkillSourceRoots().forEach(sourceRoot => {
      walkMarkdownFiles(sourceRoot.dir).forEach(filePath => {
        const realPath = safeRealPath(filePath);
        if (seenPaths.has(realPath)) {
          return;
        }
        seenPaths.add(realPath);
        candidates.push(buildSkillMetadata(filePath, sourceRoot, {
          source: sourceRoot.source,
          display_root: sourceRoot.display_root,
          source_priority: sourcePriority(sourceRoot.source)
        }));
      });
    });

    listInstalledPluginBundles().forEach(bundle => {
      bundle.skills.forEach(skill => {
        if (!includeDisabled && !skill.enabled) {
          return;
        }
        candidates.push(buildSkillMetadata(
          skill.file_path,
          {
            source: bundle.root.source,
            display_root: bundle.root.display_root
          },
          {
            source: bundle.root.source,
            display_root: bundle.root.display_root,
            source_priority: bundle.plugin.source_priority,
            enabled: skill.enabled,
            plugin: {
              name: bundle.plugin.name,
              scope: bundle.plugin.scope,
              version: bundle.plugin.version,
              description: bundle.plugin.description,
              plugin_root: bundle.plugin.plugin_root,
              source_type: bundle.plugin.source_type,
              source_location: bundle.plugin.source_location,
              install_path: bundle.plugin.install_path,
              runtime: bundle.plugin.runtime,
              dependencies: bundle.plugin.dependencies
            }
          }
        ));
      });
    });

    return candidates.sort((left, right) => {
      if (right.source_priority !== left.source_priority) {
        return right.source_priority - left.source_priority;
      }
      return left.name.localeCompare(right.name);
    });
  }

  function listSkillEntries(options = {}) {
    const selected = [];
    const byName = new Set();

    buildCandidateSkillEntries(options).forEach(entry => {
      if (byName.has(entry.name)) {
        return;
      }
      byName.add(entry.name);
      selected.push(entry);
    });

    return selected;
  }

  function degradeDiscovery(entries) {
    let used = 0;
    return entries.map(entry => {
      const next = { ...entry };
      const sourcePriority = entry.source === 'built-in' ? 'privileged' : 'external';
      const full = truncateText([entry.description, entry.when_to_use].filter(Boolean).join(' | ') || entry.name, DISCOVERY_ITEM_LIMIT);
      const nameOnly = entry.name;
      let discoveryText = full;

      if (sourcePriority === 'external' && used + discoveryText.length > DISCOVERY_TOTAL_LIMIT) {
        discoveryText = truncateText(entry.description || entry.when_to_use || entry.name, DISCOVERY_ITEM_LIMIT);
      }
      if (sourcePriority === 'external' && used + discoveryText.length > DISCOVERY_TOTAL_LIMIT) {
        discoveryText = nameOnly;
      }

      used += discoveryText.length;
      next.discovery_text = discoveryText;
      return next;
    });
  }

  function listSkills(options = {}) {
    return degradeDiscovery(listSkillEntries(options)).map(entry => ({
      name: entry.name,
      description: entry.description,
      when_to_use: entry.when_to_use,
      discovery_text: entry.discovery_text,
      execution_mode: entry.execution_mode,
      source: entry.source,
      path: entry.display_path,
      allowed_tools: entry.allowed_tools,
      hooks: entry.hooks,
      evidence_hint: entry.evidence_hint,
      enabled: entry.enabled,
      plugin: entry.plugin
        ? {
            name: entry.plugin.name,
            scope: entry.plugin.scope,
            version: entry.plugin.version,
            source_type: entry.plugin.source_type
          }
        : null
    }));
  }

  function loadSkill(name, options = {}) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing skill name');
    }

    const entries = listSkillEntries({
      include_disabled: Boolean(options.include_disabled)
    });
    const matched = entries.find(entry => entry.name === normalized);
    if (!matched) {
      throw new Error(`Skill not found: ${name}`);
    }

    return {
      name: matched.name,
      description: matched.description,
      when_to_use: matched.when_to_use,
      execution_mode: matched.execution_mode,
      source: matched.source,
      path: matched.display_path,
      allowed_tools: matched.allowed_tools,
      hooks: matched.hooks,
      content: matched.content,
      discovery_text: matched.discovery_text,
      command: matched.command,
      command_input: matched.command_input,
      working_directory: matched.working_directory,
      evidence_hint: matched.evidence_hint,
      enabled: matched.enabled,
      plugin: matched.plugin,
      base_dir: matched.base_dir,
      file_path: matched.file_path
    };
  }

  function parseSkillListArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const includeDisabled = argv.includes('--all');
    const unknown = argv.filter(token => token !== '--all');
    if (unknown.length > 0) {
      throw new Error(`Unknown skills list option: ${unknown[0]}`);
    }
    return {
      include_disabled: includeDisabled
    };
  }

  function parseSkillRunArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const options = {
      name: '',
      isolated: false,
      user_input: '',
      user_tokens: []
    };

    let index = 0;
    options.name = argv[index] || '';
    index += 1;

    const inputParts = [];
    for (; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--isolated') {
        options.isolated = true;
        continue;
      }
      if (token === '--') {
        inputParts.push(...argv.slice(index + 1));
        break;
      }
      inputParts.push(token);
    }

    options.user_tokens = inputParts.slice();
    options.user_input = inputParts.join(' ').trim();
    if (!options.name) {
      throw new Error('Missing skill name');
    }

    return options;
  }

  function normalizeBridgeWorkerResult(skill, payload, bridgeResponse, bridgeError) {
    const response = isObject(bridgeResponse) ? bridgeResponse : {};
    const worker = isObject(response.worker_result) ? response.worker_result : {};
    const status = bridgeError ? 'bridge-error' : (worker.status || response.status || 'ok');
    return {
      agent: worker.agent || `emb-skill-${slugify(skill.name)}`,
      phase: worker.phase || 'skill',
      status,
      summary: worker.summary || response.summary || bridgeError || '',
      output_kind: worker.output_kind || 'skill',
      fresh_context: true,
      updated_at: worker.updated_at || new Date().toISOString(),
      skill: skill.name,
      prompt_preview: truncateText(payload.launch.prompt, 280)
    };
  }

  function invokeIsolatedSkill(skill, userInput) {
    const host = getRuntimeHost();
    const bridge = host && host.subagentBridge ? host.subagentBridge : { available: false };
    const worker = {
      agent: `emb-skill-${slugify(skill.name)}`,
      role: 'skill',
      phase: 'skill',
      blocking: true,
      context_mode: 'fresh-self-contained',
      fresh_context_required: true,
      purpose: `Execute isolated skill ${skill.name}`,
      ownership: 'Complete only the requested isolated skill execution and return a compact result',
      expected_output: [
        'Return the distilled skill result for the main thread',
        'Keep conclusions explicit and scoped to the provided skill'
      ],
      tool_scope: {
        role_profile: 'skill',
        allows_write: false,
        allows_delegate: false,
        allows_background_work: false,
        preferred_tools: skill.allowed_tools || [],
        disallowed_tools: ['spawn', 'orchestration-state-write']
      }
    };
    const payload = {
      version: '1.0',
      host: {
        name: host ? host.name : '',
        label: host ? host.label : '',
        subagent_bridge: bridge
      },
      session: {
        project_root: resolveProjectRoot(),
        focus: '',
        project_profile: ''
      },
      orchestration: {
        source: 'skills',
        requested_action: `skills run ${skill.name}`,
        resolved_action: `skill:${skill.name}`,
        entered_via: 'skills run',
        execution_kind: 'skill-isolated',
        workflow: {
          strategy: 'skill-isolated'
        },
        dispatch_contract: {
          delegation_pattern: 'fork',
          pattern_constraints: {
            allowed_patterns: ['fork'],
            disallowed_patterns: ['coordinator', 'swarm'],
            max_depth: 1,
            workers_may_delegate: false
          }
        }
      },
      launch: {
        worker,
        instructions: {
          name: skill.name,
          path: skill.path,
          content: skill.content
        },
        prompt: [
          `# emb skill: ${skill.name}`,
          '',
          skill.content || '',
          '',
          '## User Input',
          userInput || '(none)',
          '',
          '## Output Contract',
          'Return compact JSON with status, summary, output_kind, findings, and recommended_next_step.'
        ].join('\n')
      }
    };

    if (!bridge.available || !bridge.command || !Array.isArray(bridge.command_argv) || bridge.command_argv.length === 0) {
      if (bridge.available && bridge.mode === 'mock') {
        return {
          status: 'ok',
          bridge: {
            available: true,
            invoked: true,
            source: bridge.source || 'env',
            command: bridge.command,
            status: 'ok'
          },
          worker_result: normalizeBridgeWorkerResult(skill, payload, {
            status: 'ok',
            worker_result: {
              agent: worker.agent,
              phase: worker.phase,
              status: 'ok',
              summary: `${skill.name} completed isolated execution`,
              output_kind: 'skill',
              fresh_context: true,
              updated_at: new Date().toISOString()
            }
          })
        };
      }

      return {
        status: 'blocked-no-host-bridge',
        bridge: {
          available: Boolean(bridge.available),
          invoked: false,
          source: bridge.source || 'none',
          command: bridge.command || '',
          status: 'bridge-unavailable'
        },
        worker_result: normalizeBridgeWorkerResult(skill, payload, {
          status: 'blocked',
          summary: 'Host sub-agent bridge is not configured for isolated skills'
        })
      };
    }

    const result = childProcess.spawnSync(bridge.command_argv[0], bridge.command_argv.slice(1), {
      cwd: resolveProjectRoot(),
      input: JSON.stringify(payload, null, 2),
      encoding: 'utf8',
      timeout: bridge.timeout_ms || 15000,
      env: {
        ...process.env,
        EMB_AGENT_WORKER_AGENT: worker.agent,
        EMB_AGENT_WORKER_PHASE: worker.phase
      }
    });

    if (result.error) {
      return {
        status: 'bridge-error',
        bridge: {
          available: true,
          invoked: true,
          source: bridge.source || 'env',
          command: bridge.command,
          status: 'bridge-error',
          error: result.error.message
        },
        worker_result: normalizeBridgeWorkerResult(skill, payload, null, result.error.message)
      };
    }

    let parsed = {};
    try {
      parsed = result.stdout ? JSON.parse(String(result.stdout)) : {};
    } catch {
      parsed = {
        status: result.status === 0 ? 'ok' : 'failed',
        summary: String(result.stdout || '').trim().slice(0, 400)
      };
    }

    return {
      status: result.status === 0 ? 'ok' : 'failed',
      bridge: {
        available: true,
        invoked: true,
        source: bridge.source || 'env',
        command: bridge.command,
        status: result.status === 0 ? 'ok' : 'failed',
        exit_code: result.status,
        stderr: String(result.stderr || '').trim()
      },
      worker_result: normalizeBridgeWorkerResult(skill, payload, parsed)
    };
  }

  function maybeResolveRelativeCommandPath(token, baseDir) {
    const text = String(token || '').trim();
    if (!text || path.isAbsolute(text)) {
      return text;
    }

    const shouldCheck =
      text.startsWith('./') ||
      text.startsWith('../') ||
      text.includes('/') ||
      /\.(?:cjs|js|mjs|py|sh|ps1|bat|cmd)$/u.test(text);

    if (!shouldCheck) {
      return text;
    }

    const candidate = path.resolve(baseDir, text);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    return text;
  }

  function tryParseJsonOutput(stdout) {
    const text = String(stdout || '').trim();
    if (!text) {
      return null;
    }
    if (!(text.startsWith('{') || text.startsWith('['))) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function joinEnvPaths(values, existing) {
    const input = uniqueStrings([
      ...values.filter(Boolean),
      ...String(existing || '').split(path.delimiter).map(item => item.trim()).filter(Boolean)
    ]);
    return input.join(path.delimiter);
  }

  function resolvePluginCommandRuntime(skill) {
    const plugin = skill && skill.plugin && isObject(skill.plugin) ? skill.plugin : null;
    const runtimeInfo = plugin && isObject(plugin.runtime) ? plugin.runtime : null;
    const pluginRoot = plugin && plugin.plugin_root ? plugin.plugin_root : '';

    const nodeModulePaths = [];
    const nodeBinPaths = [];
    const pythonPathEntries = [];

    if (pluginRoot) {
      const rootNodeModules = path.join(pluginRoot, 'node_modules');
      const rootNodeBin = path.join(rootNodeModules, '.bin');
      if (fs.existsSync(rootNodeModules)) {
        nodeModulePaths.push(rootNodeModules);
      }
      if (fs.existsSync(rootNodeBin)) {
        nodeBinPaths.push(rootNodeBin);
      }
      pythonPathEntries.push(pluginRoot);
    }

    if (runtimeInfo) {
      nodeModulePaths.push(...toStringArray(runtimeInfo.node && runtimeInfo.node.module_paths));
      nodeBinPaths.push(...toStringArray(runtimeInfo.node && runtimeInfo.node.bin_paths));
      pythonPathEntries.push(...toStringArray(runtimeInfo.python && runtimeInfo.python.path_entries));
    }

    return {
      plugin_root: pluginRoot,
      runtime_root: runtimeInfo && runtimeInfo.root ? runtimeInfo.root : '',
      node_module_paths: uniqueStrings(nodeModulePaths.filter(item => fs.existsSync(item))),
      node_bin_paths: uniqueStrings(nodeBinPaths.filter(item => fs.existsSync(item))),
      python_path_entries: uniqueStrings(pythonPathEntries.filter(item => fs.existsSync(item))),
      system_requirements: runtimeInfo ? toStringArray(runtimeInfo.system_requirements) : []
    };
  }

  function runCommandSkill(skill, runArgs) {
    const command = Array.isArray(skill.command) ? skill.command.slice() : [];
    if (command.length === 0) {
      throw new Error(`Skill ${skill.name} is missing a command definition`);
    }

    const argv = command.map((token, index) => {
      if (index === 0) {
        return String(token || '').trim();
      }
      return maybeResolveRelativeCommandPath(token, skill.base_dir);
    }).filter(Boolean);

    if (skill.command_input !== 'stdin') {
      argv.push(...(runArgs.user_tokens || []));
    }

    if (argv.length === 0) {
      throw new Error(`Skill ${skill.name} resolved to an empty command`);
    }

    const cwd = skill.working_directory
      ? path.resolve(skill.base_dir, skill.working_directory)
      : skill.base_dir;
    const commandRuntime = resolvePluginCommandRuntime(skill);
    const result = childProcess.spawnSync(argv[0], argv.slice(1), {
      cwd,
      input: skill.command_input === 'stdin' ? runArgs.user_input : undefined,
      encoding: 'utf8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      env: {
        ...process.env,
        PATH: joinEnvPaths(commandRuntime.node_bin_paths, process.env.PATH),
        NODE_PATH: joinEnvPaths(commandRuntime.node_module_paths, process.env.NODE_PATH),
        PYTHONPATH: joinEnvPaths(commandRuntime.python_path_entries, process.env.PYTHONPATH),
        EMB_AGENT_SKILL_NAME: skill.name,
        EMB_AGENT_SKILL_ROOT: skill.base_dir,
        EMB_AGENT_SKILL_INPUT: runArgs.user_input || '',
        EMB_AGENT_SKILL_PLUGIN_ROOT: commandRuntime.plugin_root || '',
        EMB_AGENT_SKILL_RUNTIME_ROOT: commandRuntime.runtime_root || ''
      }
    });

    if (result.error) {
      return {
        status: 'spawn-error',
        argv,
        cwd,
        error: result.error.message,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        runtime: commandRuntime
      };
    }

    return {
      status: result.status === 0 ? 'ok' : 'failed',
      argv,
      cwd,
      exit_code: result.status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      parsed_output: tryParseJsonOutput(result.stdout),
      runtime: commandRuntime
    };
  }

  function buildSkillRunStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'ok' || normalized === 'passed' || normalized === 'pass' || normalized === 'success') {
      return 'ok';
    }
    if (normalized === 'failed' || normalized === 'spawn-error' || normalized === 'bridge-error') {
      return 'failed';
    }
    if (normalized === 'blocked' || normalized === 'blocked-no-host-bridge') {
      return 'blocked';
    }
    return normalized || 'unknown';
  }

  function buildSkillRunPreview(value) {
    return truncateText(String(value || '').replace(/\s+/g, ' ').trim(), 240);
  }

  function buildSkillRunDiagnostic(skill, result, runMeta) {
    const projectRoot = resolveProjectRoot();
    const mode = runMeta && runMeta.mode ? runMeta.mode : skill.execution_mode;
    const ranAt = runMeta && runMeta.ran_at ? runMeta.ran_at : new Date().toISOString();
    const durationMs = Number.isInteger(runMeta && runMeta.duration_ms) ? runMeta.duration_ms : null;
    const cwdValue =
      result && result.cwd
        ? result.cwd
        : runMeta && runMeta.cwd
          ? runMeta.cwd
          : skill.base_dir;
    const cwd = cwdValue
      ? path.relative(projectRoot, cwdValue).replace(/\\/g, '/') || '.'
      : '.';
    const argv = Array.isArray(result && result.argv)
      ? result.argv
      : Array.isArray(runMeta && runMeta.argv)
        ? runMeta.argv
        : [];
    const stdoutPreview =
      result && result.stdout
        ? buildSkillRunPreview(result.stdout)
        : result && result.worker_result && result.worker_result.summary
          ? buildSkillRunPreview(result.worker_result.summary)
          : '';
    const stderrPreview =
      result && result.stderr
        ? buildSkillRunPreview(result.stderr)
        : result && result.bridge && result.bridge.stderr
          ? buildSkillRunPreview(result.bridge.stderr)
          : result && result.error
            ? buildSkillRunPreview(result.error)
            : '';
    const rawStatus =
      result && result.status
        ? result.status
        : result && result.worker_result && result.worker_result.status
          ? result.worker_result.status
          : '';

    return {
      name: skill.name,
      status: buildSkillRunStatus(rawStatus),
      risk: 'normal',
      exit_code: Number.isInteger(result && result.exit_code)
        ? result.exit_code
        : Number.isInteger(result && result.bridge && result.bridge.exit_code)
          ? result.bridge.exit_code
          : null,
      duration_ms: durationMs,
      ran_at: ranAt,
      cwd,
      argv,
      evidence_hint: Array.isArray(skill.evidence_hint) ? skill.evidence_hint.slice() : [],
      stdout_preview: stdoutPreview,
      stderr_preview: stderrPreview,
      execution_mode: mode,
      source: skill.source || ''
    };
  }

  function recordSkillRun(skill, result, runMeta) {
    if (typeof updateSession !== 'function') {
      return null;
    }

    const diagnostic = buildSkillRunDiagnostic(skill, result, runMeta);
    updateSession(current => {
      current.last_command = `skills run ${skill.name}`;
      const diagnostics = current.diagnostics || {};
      const history =
        diagnostics.skill_history &&
        typeof diagnostics.skill_history === 'object' &&
        !Array.isArray(diagnostics.skill_history)
          ? diagnostics.skill_history
          : {};
      current.diagnostics = {
        ...diagnostics,
        latest_skill: diagnostic,
        skill_history: {
          ...history,
          [skill.name]: diagnostic
        }
      };
    });
    return diagnostic;
  }

  function runSkill(tokens) {
    const options = parseSkillRunArgs(tokens);
    const skill = loadSkill(options.name);
    const mode = options.isolated ? 'isolated' : skill.execution_mode;
    const startedAt = Date.now();

    if (mode === 'isolated') {
      const isolated = invokeIsolatedSkill(skill, options.user_input);
      const recorded = recordSkillRun(skill, isolated, {
        mode: 'isolated',
        ran_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        cwd: resolveProjectRoot()
      });
      return {
        command: 'skills run',
        skill: {
          name: skill.name,
          source: skill.source,
          path: skill.path,
          execution_mode: skill.execution_mode,
          evidence_hint: skill.evidence_hint,
          plugin: skill.plugin
        },
        execution: {
          mode: 'isolated',
          user_input: options.user_input,
          user_tokens: options.user_tokens
        },
        latest_skill: recorded,
        isolated
      };
    }

    if (mode === 'command') {
      const commandResult = runCommandSkill(skill, options);
      const recorded = recordSkillRun(skill, commandResult, {
        mode: 'command',
        ran_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt
      });
      return {
        command: 'skills run',
        skill: {
          name: skill.name,
          source: skill.source,
          path: skill.path,
          execution_mode: skill.execution_mode,
          plugin: skill.plugin,
          command: skill.command,
          command_input: skill.command_input,
          evidence_hint: skill.evidence_hint
        },
        execution: {
          mode: 'command',
          user_input: options.user_input,
          user_tokens: options.user_tokens
        },
        latest_skill: recorded,
        command_result: commandResult
      };
    }

    return {
      command: 'skills run',
      skill: {
        name: skill.name,
        source: skill.source,
        path: skill.path,
        execution_mode: skill.execution_mode,
        allowed_tools: skill.allowed_tools,
        hooks: skill.hooks,
        plugin: skill.plugin
      },
      execution: {
        mode: 'inline',
        user_input: options.user_input,
        user_tokens: options.user_tokens
      },
      prompt: [
        `# emb skill: ${skill.name}`,
        '',
        skill.content || '',
        '',
        '## User Input',
        options.user_input || '(none)'
      ].join('\n')
    };
  }

  function parseSkillInstallArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const fallbackSource = defaultSkillSource.resolveDefaultSkillSource(runtimeConfig, process.env);
    const parsed = {
      source: '',
      scope: 'project',
      source_type: '',
      branch: '',
      subdir: '',
      skill_names: [],
      force: false
    };

    let index = 0;
    if (argv[0] && !String(argv[0]).startsWith('--')) {
      parsed.source = String(argv[0]).trim();
      index = 1;
    } else if (fallbackSource.location) {
      parsed.source = fallbackSource.location;
      parsed.source_type = fallbackSource.type || '';
      parsed.branch = fallbackSource.branch || '';
      parsed.subdir = fallbackSource.subdir || '';
    } else {
      throw new Error('Missing skill source and no default skill source is configured');
    }

    for (; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--scope') {
        parsed.scope = ensureNonEmptyString(argv[index + 1], '--scope').toLowerCase();
        index += 1;
        continue;
      }
      if (token === '--type') {
        parsed.source_type = ensureNonEmptyString(argv[index + 1], '--type').toLowerCase();
        index += 1;
        continue;
      }
      if (token === '--branch') {
        parsed.branch = ensureNonEmptyString(argv[index + 1], '--branch');
        index += 1;
        continue;
      }
      if (token === '--subdir') {
        parsed.subdir = ensureNonEmptyString(argv[index + 1], '--subdir');
        index += 1;
        continue;
      }
      if (token === '--skill') {
        parsed.skill_names.push(ensureNonEmptyString(argv[index + 1], '--skill'));
        index += 1;
        continue;
      }
      if (token === '--force') {
        parsed.force = true;
        continue;
      }
      throw new Error(`Unknown skills install option: ${token}`);
    }

    if (parsed.scope !== 'project' && parsed.scope !== 'user') {
      throw new Error(`Unsupported skill scope: ${parsed.scope}`);
    }

    return parsed;
  }

  function normalizeInstallSourceType(source, explicitType) {
    const normalizedType = String(explicitType || '').trim().toLowerCase();
    if (normalizedType) {
      return normalizedType;
    }

    const input = String(source || '').trim();
    if (input.startsWith('npm:')) return 'npm';
    if (input.startsWith('pypi:') || input.startsWith('pip:')) return 'pypi';
    if (input.startsWith('git+') || input.endsWith('.git') || input.startsWith('git@') || input.startsWith('ssh://')) {
      return 'git';
    }
    const resolved = path.resolve(resolveProjectRoot(), input);
    if (fs.existsSync(resolved)) {
      return 'path';
    }
    return 'npm';
  }

  function stripInstallSourcePrefix(source, sourceType) {
    const text = String(source || '').trim();
    if (sourceType === 'npm' && text.startsWith('npm:')) {
      return text.slice(4);
    }
    if (sourceType === 'pypi' && text.startsWith('pypi:')) {
      return text.slice(5);
    }
    if (sourceType === 'pypi' && text.startsWith('pip:')) {
      return text.slice(4);
    }
    if (sourceType === 'git' && text.startsWith('git+')) {
      return text.slice(4);
    }
    return text;
  }

  function ensureScopePluginRoot(scope) {
    const host = getRuntimeHost();
    if (scope === 'project') {
      runtime.initProjectLayout(resolveProjectRoot());
      const projectDir = path.join(getProjectExtDir(), 'plugins');
      runtime.ensureDir(projectDir);
      return projectDir;
    }

    const userRoot = getUserPluginRoot(host);
    if (!userRoot) {
      throw new Error('User skill install root is not available for this runtime');
    }
    runtime.ensureDir(userRoot);
    return userRoot;
  }

  function isExecutableFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  function resolveExecutablePath(command) {
    const input = String(command || '').trim();
    if (!input) {
      return input;
    }
    if (input.includes(path.sep) || input.includes('/')) {
      return input;
    }

    const envPath = String(process.env && process.env.PATH ? process.env.PATH : '');
    const searchDirs = envPath
      ? envPath.split(path.delimiter).map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const fallbackDirs = operatingSystem.platform() === 'win32'
      ? [
          'C:\\Program Files\\Git\\cmd',
          'C:\\Program Files\\Git\\bin',
          'C:\\Program Files (x86)\\Git\\cmd',
          'C:\\Program Files (x86)\\Git\\bin'
        ]
      : ['/usr/local/bin', '/usr/bin', '/bin'];
    const extensions = operatingSystem.platform() === 'win32'
      ? uniqueStrings(
          String(process.env && process.env.PATHEXT ? process.env.PATHEXT : '.EXE;.CMD;.BAT;.COM')
            .split(';')
            .map(item => item.trim().toLowerCase())
            .filter(Boolean)
        )
      : [''];

    for (const dir of uniqueStrings([...searchDirs, ...fallbackDirs])) {
      if (!dir) {
        continue;
      }

      const directPath = path.join(dir, input);
      if (isExecutableFile(directPath)) {
        return directPath;
      }

      for (const extension of extensions) {
        if (!extension) {
          continue;
        }
        const candidate = path.join(dir, `${input}${extension}`);
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }

    return input;
  }

  function runInstallCommand(command, args, options, label) {
    const resolvedCommand = resolveExecutablePath(command);
    const result = childProcess.spawnSync(resolvedCommand, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(options.env || {})
      }
    });

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(`${label} failed: required local dependency is not available in this environment`);
      }
      throw new Error(`${label} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const stderr = truncateText(String(result.stderr || '').trim(), 400);
      throw new Error(`${label} failed${stderr ? `: ${stderr}` : ''}`);
    }
  }

  function detectPythonCommand() {
    const candidates = uniqueStrings([
      process.env.PYTHON,
      'python3',
      'python'
    ]);

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const result = childProcess.spawnSync(candidate, ['--version'], {
        encoding: 'utf8'
      });
      if (!result.error && result.status === 0) {
        return candidate;
      }
    }

    throw new Error('A Python runtime is required to install pypi skills');
  }

  function materializePathSource(sourceSpec, payloadDir) {
    const resolvedPath = path.resolve(resolveProjectRoot(), sourceSpec);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Skill source path does not exist: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    runtime.ensureDir(payloadDir);
    if (stats.isDirectory()) {
      copyPathRecursive(resolvedPath, payloadDir);
      return {
        search_root: payloadDir,
        location: resolvedPath
      };
    }

    const targetSkillDir = path.join(payloadDir, 'skills', slugify(path.basename(resolvedPath, path.extname(resolvedPath))));
    runtime.ensureDir(targetSkillDir);
    const targetFile = path.join(targetSkillDir, 'SKILL.md');
    fs.copyFileSync(resolvedPath, targetFile);
    return {
      search_root: payloadDir,
      location: resolvedPath
    };
  }

  async function materializeGitSource(sourceSpec, parsed, payloadDir) {
    const remoteBundleSource = resolveRemoteGitBundleSource(sourceSpec, {
      branch: parsed.branch,
      subdir: parsed.subdir
    });
    if (remoteBundleSource) {
      runtime.ensureDir(payloadDir);
      try {
        const giget = await loadGigetModule();
        await withGigetHost(remoteBundleSource.host, () =>
          withPromiseTimeout(
            giget.downloadTemplate(remoteBundleSource.gigetSource, {
              dir: payloadDir,
              preferOffline: true
            }),
            DEFAULT_COMMAND_TIMEOUT_MS,
            'Skill source download'
          )
        );
        return {
          search_root: payloadDir,
          location: sourceSpec
        };
      } catch (error) {
        throw new Error(classifyRemoteSourceDownloadError(error));
      }
    }

    const cloneDir = path.join(payloadDir, 'repo');
    const cloneArgs = ['clone', '--depth', '1'];
    if (parsed.branch) {
      cloneArgs.push('--branch', parsed.branch);
    }
    cloneArgs.push(sourceSpec, cloneDir);
    runInstallCommand('git', cloneArgs, { cwd: payloadDir }, 'git clone');

    return {
      search_root: parsed.subdir ? path.resolve(cloneDir, parsed.subdir) : cloneDir,
      location: sourceSpec
    };
  }

  function materializeNpmSource(sourceSpec, parsed, payloadDir) {
    runtime.ensureDir(payloadDir);
    runInstallCommand(
      'npm',
      ['install', '--no-save', '--ignore-scripts', sourceSpec],
      { cwd: payloadDir },
      'npm install'
    );

    return {
      search_root: parsed.subdir ? path.resolve(payloadDir, parsed.subdir) : payloadDir,
      location: sourceSpec
    };
  }

  function materializePypiSource(sourceSpec, parsed, payloadDir) {
    const siteDir = path.join(payloadDir, 'site');
    runtime.ensureDir(siteDir);
    const python = detectPythonCommand();
    runInstallCommand(
      python,
      ['-m', 'pip', 'install', '--no-deps', '--target', siteDir, sourceSpec],
      { cwd: payloadDir },
      'pip install'
    );

    return {
      search_root: parsed.subdir ? path.resolve(siteDir, parsed.subdir) : siteDir,
      location: sourceSpec
    };
  }

  async function materializeSkillSource(parsed, payloadDir) {
    const sourceType = normalizeInstallSourceType(parsed.source, parsed.source_type);
    const sourceSpec = stripInstallSourcePrefix(parsed.source, sourceType);

    if (sourceType === 'path') {
      return {
        source_type: sourceType,
        ...materializePathSource(sourceSpec, payloadDir)
      };
    }
    if (sourceType === 'git') {
      return {
        source_type: sourceType,
        ...(await materializeGitSource(sourceSpec, parsed, payloadDir))
      };
    }
    if (sourceType === 'pypi') {
      return {
        source_type: sourceType,
        ...materializePypiSource(sourceSpec, parsed, payloadDir)
      };
    }

    return {
      source_type: sourceType,
      ...materializeNpmSource(sourceSpec, parsed, payloadDir)
    };
  }

  function toRelativeInstallPath(installDir, targetPath) {
    return path.relative(installDir, targetPath).replace(/\\/g, '/');
  }

  function buildPluginRuntimePackageManifest(pluginName, dependencies) {
    return {
      name: `${slugify(pluginName)}-runtime`,
      private: true,
      version: '0.0.0',
      description: `Runtime dependencies for ${pluginName}`,
      dependencies
    };
  }

  function loadPackageJsonDependencies(packageJsonPath, pluginName) {
    const raw = safeReadJson(packageJsonPath);
    if (!raw || !isObject(raw)) {
      throw new Error(`Plugin ${pluginName} package.json is invalid: ${packageJsonPath}`);
    }

    const dependencyMap = {
      ...(isObject(raw.dependencies) ? raw.dependencies : {}),
      ...(isObject(raw.optionalDependencies) ? raw.optionalDependencies : {})
    };

    return normalizeNodeDependencyMap(
      dependencyMap,
      path.dirname(packageJsonPath),
      `Plugin ${pluginName} package.json dependencies`
    );
  }

  function provisionNodeDependencies(installDir, normalizedManifest) {
    const dependencyConfig = normalizedManifest.dependencies.node;
    if (!dependencyConfig || dependencyConfig.install === false) {
      return {
        module_paths: [],
        bin_paths: []
      };
    }

    const packageJsonPath = dependencyConfig.package_json
      ? path.join(normalizedManifest.plugin_root, dependencyConfig.package_json)
      : '';
    const packageDependencies = packageJsonPath && fs.existsSync(packageJsonPath)
      ? loadPackageJsonDependencies(packageJsonPath, normalizedManifest.name)
      : {};
    const packageSpecs = dependencyConfig.packages.slice();

    if (Object.keys(packageDependencies).length === 0 && packageSpecs.length === 0) {
      return {
        module_paths: [],
        bin_paths: []
      };
    }

    const runtimeDir = path.join(installDir, PLUGIN_RUNTIME_NODE_DIR);
    runtime.ensureDir(runtimeDir);

    if (Object.keys(packageDependencies).length > 0) {
      runtime.writeJson(
        path.join(runtimeDir, 'package.json'),
        buildPluginRuntimePackageManifest(normalizedManifest.name, packageDependencies)
      );
      runInstallCommand(
        'npm',
        ['install', '--omit=dev', '--package-lock=false'],
        { cwd: runtimeDir },
        'npm install'
      );
    }

    if (packageSpecs.length > 0) {
      runInstallCommand(
        'npm',
        ['install', '--omit=dev', '--package-lock=false', ...packageSpecs],
        { cwd: runtimeDir },
        'npm install'
      );
    }

    const moduleDir = path.join(runtimeDir, 'node_modules');
    const binDir = path.join(moduleDir, '.bin');
    return {
      module_paths: fs.existsSync(moduleDir) ? [toRelativeInstallPath(installDir, moduleDir)] : [],
      bin_paths: fs.existsSync(binDir) ? [toRelativeInstallPath(installDir, binDir)] : []
    };
  }

  function provisionPythonDependencies(installDir, normalizedManifest) {
    const dependencyConfig = normalizedManifest.dependencies.python;
    if (!dependencyConfig || dependencyConfig.install === false) {
      return {
        path_entries: []
      };
    }

    const requirementsPath = dependencyConfig.requirements
      ? path.join(normalizedManifest.plugin_root, dependencyConfig.requirements)
      : '';
    const packageSpecs = dependencyConfig.packages.slice();

    if (!requirementsPath && packageSpecs.length === 0) {
      return {
        path_entries: []
      };
    }

    const python = detectPythonCommand();
    const runtimeDir = path.join(installDir, PLUGIN_RUNTIME_PYTHON_DIR);
    runtime.ensureDir(runtimeDir);

    if (requirementsPath && fs.existsSync(requirementsPath)) {
      runInstallCommand(
        python,
        ['-m', 'pip', 'install', '--target', runtimeDir, '-r', requirementsPath],
        {
          cwd: path.dirname(requirementsPath),
          env: {
            PIP_DISABLE_PIP_VERSION_CHECK: '1'
          }
        },
        'pip install'
      );
    }

    if (packageSpecs.length > 0) {
      runInstallCommand(
        python,
        ['-m', 'pip', 'install', '--target', runtimeDir, ...packageSpecs],
        {
          cwd: normalizedManifest.plugin_root,
          env: {
            PIP_DISABLE_PIP_VERSION_CHECK: '1'
          }
        },
        'pip install'
      );
    }

    return {
      path_entries: fs.existsSync(runtimeDir) ? [toRelativeInstallPath(installDir, runtimeDir)] : []
    };
  }

  function provisionPluginRuntime(installDir, normalizedManifest) {
    const node = provisionNodeDependencies(installDir, normalizedManifest);
    const python = provisionPythonDependencies(installDir, normalizedManifest);
    const hasRuntimePaths =
      node.module_paths.length > 0 ||
      node.bin_paths.length > 0 ||
      python.path_entries.length > 0;

    return {
      root: hasRuntimePaths ? PLUGIN_RUNTIME_DIR : '',
      ready: true,
      node,
      python,
      system_requirements: normalizedManifest.dependencies.system_requirements.slice()
    };
  }

  async function installSkillSource(tokens) {
    const parsed = parseSkillInstallArgs(tokens);
    const scopeRoot = ensureScopePluginRoot(parsed.scope);
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-install-'));
    const stagingPayloadDir = path.join(stagingRoot, PLUGIN_PAYLOAD_DIR);

    try {
      const materialized = await materializeSkillSource(parsed, stagingPayloadDir);
      const searchRoot = materialized.search_root;
      let manifestPath = findPluginManifestPath(searchRoot);
      if (!manifestPath) {
        manifestPath = ensureGeneratedPluginManifest(searchRoot, inferGeneratedPluginFallbackName(parsed, searchRoot));
      }

      const manifestRelativeToPayload = path.relative(stagingPayloadDir, manifestPath);
      const normalizedManifest = loadNormalizedPluginManifest(manifestPath);
      const installDir = path.join(scopeRoot, slugify(normalizedManifest.name));
      if (fs.existsSync(installDir)) {
        if (!parsed.force) {
          throw new Error(`Skill plugin already installed: ${normalizedManifest.name}`);
        }
        const existingBundle = readInstalledPluginBundle(installDir, {
          scope: parsed.scope,
          source: parsed.scope === 'project' ? 'project-plugin' : 'user-plugin',
          display_root: parsed.scope === 'project'
            ? resolveProjectRoot()
            : (getRuntimeHost() && getRuntimeHost().runtimeHome ? getRuntimeHost().runtimeHome : '')
        });
        if (existingBundle) {
          removePluginSkillEntries(existingBundle);
        }
        removePathRecursive(installDir);
      }

      runtime.ensureDir(installDir);
      copyPathRecursive(stagingPayloadDir, path.join(installDir, PLUGIN_PAYLOAD_DIR));

      const installedManifestPath = path.join(installDir, PLUGIN_PAYLOAD_DIR, manifestRelativeToPayload);
      const installedManifest = loadNormalizedPluginManifest(installedManifestPath);
      const runtimeProvision = provisionPluginRuntime(installDir, installedManifest);
      const allSkillNames = installedManifest.skills.map(item => item.name);
      const enabledSkills = parsed.skill_names.length > 0
        ? uniqueStrings(parsed.skill_names)
        : allSkillNames;

      const missingSkills = enabledSkills.filter(name => !allSkillNames.includes(name));
      if (missingSkills.length > 0) {
        throw new Error(`Plugin ${installedManifest.name} does not expose skill(s): ${missingSkills.join(', ')}`);
      }

      const state = {
        version: 1,
        name: installedManifest.name,
        description: installedManifest.description,
        plugin_version: installedManifest.version,
        scope: parsed.scope,
        manifest_relpath: path.relative(installDir, installedManifestPath).replace(/\\/g, '/'),
        payload_root: PLUGIN_PAYLOAD_DIR,
        installed_at: new Date().toISOString(),
        enabled_skills: enabledSkills,
        runtime: runtimeProvision,
        source: {
          type: materialized.source_type,
          specifier: parsed.source,
          location: materialized.location || parsed.source,
          branch: parsed.branch,
          subdir: parsed.subdir
        }
      };
      writePluginState(installDir, state);

      syncPluginSkillEntries({
        plugin: {
          name: installedManifest.name,
          scope: parsed.scope
        },
        skills: installedManifest.skills.map(item => ({
          ...item,
          enabled: enabledSkills.includes(item.name)
        }))
      });

      return {
        command: 'skills install',
        status: 'ok',
        plugin: {
          name: installedManifest.name,
          version: installedManifest.version,
          description: installedManifest.description,
          scope: parsed.scope,
          install_path: installDir,
          source_type: materialized.source_type,
          source_location: materialized.location || parsed.source,
          runtime: {
            root: runtimeProvision.root ? path.join(installDir, runtimeProvision.root) : '',
            ready: runtimeProvision.ready,
            node: {
              module_paths: runtimeProvision.node.module_paths.map(item => path.join(installDir, item)),
              bin_paths: runtimeProvision.node.bin_paths.map(item => path.join(installDir, item))
            },
            python: {
              path_entries: runtimeProvision.python.path_entries.map(item => path.join(installDir, item))
            },
            system_requirements: runtimeProvision.system_requirements.slice()
          }
        },
        skills: installedManifest.skills.map(item => ({
          name: item.name,
          enabled: enabledSkills.includes(item.name),
          execution_mode: item.execution_mode,
          path: item.display_path
        })),
        selected_skills: enabledSkills
      };
    } finally {
      removePathRecursive(stagingRoot);
    }
  }

  async function previewSkillSource(tokens) {
    const parsed = parseSkillInstallArgs(tokens);
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-preview-'));
    const stagingPayloadDir = path.join(stagingRoot, PLUGIN_PAYLOAD_DIR);

    try {
      const materialized = await materializeSkillSource(parsed, stagingPayloadDir);
      const searchRoot = materialized.search_root;
      let manifestPath = findPluginManifestPath(searchRoot);
      if (!manifestPath) {
        manifestPath = ensureGeneratedPluginManifest(searchRoot, inferGeneratedPluginFallbackName(parsed, searchRoot));
      }

      const normalizedManifest = loadNormalizedPluginManifest(manifestPath);
      const allSkillNames = normalizedManifest.skills.map(item => item.name);
      const selectedSkills = parsed.skill_names.length > 0
        ? uniqueStrings(parsed.skill_names)
        : allSkillNames;
      const missingSkills = selectedSkills.filter(name => !allSkillNames.includes(name));
      if (missingSkills.length > 0) {
        throw new Error(`Plugin ${normalizedManifest.name} does not expose skill(s): ${missingSkills.join(', ')}`);
      }

      return {
        source: {
          type: materialized.source_type,
          specifier: parsed.source,
          location: materialized.location || parsed.source,
          branch: parsed.branch,
          subdir: parsed.subdir
        },
        plugin: {
          name: normalizedManifest.name,
          version: normalizedManifest.version,
          description: normalizedManifest.description
        },
        skills: normalizedManifest.skills.map(item => ({
          name: item.name,
          description: item.description,
          execution_mode: item.execution_mode,
          path: item.display_path,
          selected: selectedSkills.includes(item.name)
        }))
      };
    } finally {
      removePathRecursive(stagingRoot);
    }
  }

  function resolveInstalledPluginTarget(targetName) {
    const normalized = String(targetName || '').trim();
    if (!normalized) {
      throw new Error('Missing skill or plugin name');
    }

    const bundles = listInstalledPluginBundles();
    const pluginMatches = bundles.filter(bundle => bundle.plugin.name === normalized);
    if (pluginMatches.length > 0) {
      return pluginMatches[0];
    }

    const skillMatches = bundles.filter(bundle => bundle.skills.some(skill => skill.name === normalized));
    if (skillMatches.length === 0) {
      throw new Error(`Installed skill or plugin not found: ${targetName}`);
    }
    if (skillMatches.length > 1) {
      throw new Error(`Skill name is ambiguous across installed plugins: ${targetName}`);
    }
    return skillMatches[0];
  }

  function updatePluginEnabledSkills(bundle, enabledSkills, action, targetName) {
    const nextEnabled = uniqueStrings(enabledSkills);
    const nextState = {
      ...bundle.state,
      name: bundle.plugin.name,
      description: bundle.plugin.description,
      plugin_version: bundle.plugin.version,
      scope: bundle.plugin.scope,
      manifest_relpath: path.relative(bundle.plugin.install_path, bundle.manifest_path).replace(/\\/g, '/'),
      payload_root: bundle.state.payload_root || PLUGIN_PAYLOAD_DIR,
      enabled_skills: nextEnabled
    };
    writePluginState(bundle.plugin.install_path, nextState);
    syncPluginSkillEntries({
      plugin: bundle.plugin,
      skills: bundle.skills.map(skill => ({
        ...skill,
        enabled: nextEnabled.includes(skill.name)
      }))
    });
    return {
      command: `skills ${action}`,
      status: 'ok',
      plugin: {
        name: bundle.plugin.name,
        scope: bundle.plugin.scope,
        version: bundle.plugin.version,
        install_path: bundle.plugin.install_path
      },
      target: targetName,
      enabled_skills: nextEnabled
    };
  }

  function enableInstalledSkill(name) {
    const bundle = resolveInstalledPluginTarget(name);
    if (bundle.plugin.name === name) {
      return updatePluginEnabledSkills(
        bundle,
        bundle.skills.map(skill => skill.name),
        'enable',
        name
      );
    }

    return updatePluginEnabledSkills(
      bundle,
      uniqueStrings([...bundle.state.enabled_skills, name]),
      'enable',
      name
    );
  }

  function disableInstalledSkill(name) {
    const bundle = resolveInstalledPluginTarget(name);
    if (bundle.plugin.name === name) {
      return updatePluginEnabledSkills(bundle, [], 'disable', name);
    }

    return updatePluginEnabledSkills(
      bundle,
      bundle.state.enabled_skills.filter(item => item !== name),
      'disable',
      name
    );
  }

  function removeInstalledSkill(name) {
    const bundle = resolveInstalledPluginTarget(name);
    if (bundle.plugin.name === name || bundle.skills.length === 1) {
      removePluginSkillEntries(bundle);
      removePathRecursive(bundle.plugin.install_path);
      return {
        command: 'skills remove',
        status: 'ok',
        removed: {
          kind: 'plugin',
          name: bundle.plugin.name,
          install_path: bundle.plugin.install_path
        }
      };
    }

    return updatePluginEnabledSkills(
      bundle,
      bundle.state.enabled_skills.filter(item => item !== name),
      'remove',
      name
    );
  }

  return {
    listSkills,
    loadSkill,
    runSkill,
    parseSkillListArgs,
    previewSkillSource,
    installSkillSource,
    enableInstalledSkill,
    disableInstalledSkill,
    removeInstalledSkill
  };
}

module.exports = {
  createSkillRuntimeHelpers
};
