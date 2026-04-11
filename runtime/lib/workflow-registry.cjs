'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_REGISTRY_VERSION = 1;
const PROJECT_REGISTRY_DIR = 'registry';
const PROJECT_SPECS_DIR = 'specs';
const PROJECT_TEMPLATES_DIR = 'templates';
const WORKFLOW_REGISTRY_FILE = 'workflow.json';

function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function ensureString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function ensureOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : Boolean(fallback);
}

function ensureInteger(value, fallback) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return Number.isInteger(fallback) ? fallback : 0;
}

function ensureStringArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value
    .map((item, index) => ensureString(item, `${label}[${index}]`))
    .filter(Boolean);
}

function ensureRelativeFile(value, label) {
  const normalized = ensureString(value, label).replace(/\\/g, '/').replace(/^\/+/g, '');
  if (normalized.includes('..')) {
    throw new Error(`${label} must stay inside the workflow root`);
  }
  return normalized;
}

function prettyName(value) {
  return String(value || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(item => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFirstHeading(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const match = fs.readFileSync(filePath, 'utf8').match(/^#\s+(.+)$/m);
  return match ? String(match[1] || '').trim() : '';
}

function normalizeApplyWhen(raw, label) {
  if (raw === undefined || raw === null) {
    return {
      always: false,
      packs: [],
      profiles: [],
      task_types: [],
      task_statuses: [],
      requires_active_task: false,
      has_handoff: false
    };
  }

  const source = ensureObject(raw, label);
  return {
    always: ensureBoolean(source.always, false),
    packs: ensureStringArray(source.packs || [], `${label}.packs`),
    profiles: ensureStringArray(source.profiles || [], `${label}.profiles`),
    task_types: ensureStringArray(source.task_types || [], `${label}.task_types`),
    task_statuses: ensureStringArray(source.task_statuses || [], `${label}.task_statuses`),
    requires_active_task: ensureBoolean(source.requires_active_task, false),
    has_handoff: ensureBoolean(source.has_handoff, false)
  };
}

function normalizeTemplateEntry(entry, label) {
  const source = ensureObject(entry, label);
  return {
    name: ensureString(source.name, `${label}.name`),
    source: ensureRelativeFile(source.source, `${label}.source`),
    description: ensureOptionalString(source.description),
    default_output: ensureOptionalString(source.default_output)
  };
}

function normalizePackEntry(entry, label) {
  const source = ensureObject(entry, label);
  return {
    name: ensureString(source.name, `${label}.name`),
    file: ensureRelativeFile(source.file, `${label}.file`),
    description: ensureOptionalString(source.description)
  };
}

function normalizeSpecEntry(entry, label) {
  const source = ensureObject(entry, label);
  return {
    name: ensureString(source.name, `${label}.name`),
    title: ensureOptionalString(source.title),
    path: ensureRelativeFile(source.path, `${label}.path`),
    summary: ensureOptionalString(source.summary),
    auto_inject: ensureBoolean(source.auto_inject, false),
    priority: ensureInteger(source.priority, 0),
    apply_when: normalizeApplyWhen(source.apply_when, `${label}.apply_when`)
  };
}

function normalizeRegistry(raw, label) {
  const source = raw ? ensureObject(raw, label) : {};
  return {
    version: ensureInteger(source.version, WORKFLOW_REGISTRY_VERSION),
    templates: (Array.isArray(source.templates) ? source.templates : []).map((item, index) =>
      normalizeTemplateEntry(item, `${label}.templates[${index}]`)
    ),
    packs: (Array.isArray(source.packs) ? source.packs : []).map((item, index) =>
      normalizePackEntry(item, `${label}.packs[${index}]`)
    ),
    specs: (Array.isArray(source.specs) ? source.specs : []).map((item, index) =>
      normalizeSpecEntry(item, `${label}.specs[${index}]`)
    )
  };
}

function resolveCatalogEntries(entries, kind, sourceRoot, scope, registryPath) {
  return entries.map(entry => {
    const relativeFile = kind === 'templates' ? entry.source : kind === 'packs' ? entry.file : entry.path;
    const absolutePath = path.join(sourceRoot, relativeFile);
    const displayPath = scope === 'project'
      ? `.emb-agent/${relativeFile}`
      : `builtin:${entry.name}`;
    return {
      ...entry,
      scope,
      relative_file: relativeFile,
      absolute_path: absolutePath,
      display_path: displayPath,
      registry_path: registryPath
    };
  });
}

function mergeCatalogEntries(...groups) {
  const merged = [];
  const byName = new Map();

  groups.flat().forEach(entry => {
    if (!entry || !entry.name) {
      return;
    }

    if (byName.has(entry.name)) {
      const index = byName.get(entry.name);
      merged[index] = entry;
      return;
    }

    byName.set(entry.name, merged.length);
    merged.push(entry);
  });

  return merged;
}

function appendMissingCatalogEntries(existing, additions) {
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const known = new Set(merged.map(item => item.name));

  (Array.isArray(additions) ? additions : []).forEach(entry => {
    if (!entry || !entry.name || known.has(entry.name)) {
      return;
    }
    known.add(entry.name);
    merged.push(entry);
  });

  return merged;
}

function discoverProjectPacks(projectExtDir) {
  const packsDir = path.join(projectExtDir, 'packs');
  if (!fs.existsSync(packsDir) || !fs.statSync(packsDir).isDirectory()) {
    return [];
  }

  return fs.readdirSync(packsDir)
    .filter(name => name.endsWith('.yaml'))
    .map(name => ({
      name: name.slice(0, -5),
      file: `packs/${name}`,
      description: 'Project-local pack'
    }));
}

function discoverProjectTemplates(projectExtDir) {
  const templatesDir = path.join(projectExtDir, PROJECT_TEMPLATES_DIR);
  if (!fs.existsSync(templatesDir) || !fs.statSync(templatesDir).isDirectory()) {
    return [];
  }

  return fs.readdirSync(templatesDir)
    .filter(name => name.endsWith('.tpl'))
    .map(name => ({
      name: name.replace(/\.tpl$/u, ''),
      source: `${PROJECT_TEMPLATES_DIR}/${name}`,
      description: 'Project-local template',
      default_output: ''
    }));
}

function discoverProjectSpecs(projectExtDir) {
  const specsDir = path.join(projectExtDir, PROJECT_SPECS_DIR);
  if (!fs.existsSync(specsDir) || !fs.statSync(specsDir).isDirectory()) {
    return [];
  }

  return fs.readdirSync(specsDir)
    .filter(name => name.endsWith('.md'))
    .map(name => {
      const specPath = path.join(specsDir, name);
      const baseName = name.slice(0, -3);
      return {
        name: baseName,
        title: readFirstHeading(specPath) || prettyName(baseName),
        path: `${PROJECT_SPECS_DIR}/${name}`,
        summary: 'Project-local spec.',
        auto_inject: false,
        priority: 0,
        apply_when: {}
      };
    });
}

function getProjectWorkflowPaths(projectExtDir) {
  return {
    registryDir: path.join(projectExtDir, PROJECT_REGISTRY_DIR),
    registryPath: path.join(projectExtDir, PROJECT_REGISTRY_DIR, WORKFLOW_REGISTRY_FILE),
    specsDir: path.join(projectExtDir, PROJECT_SPECS_DIR),
    templatesDir: path.join(projectExtDir, PROJECT_TEMPLATES_DIR),
    projectLocalSpecPath: path.join(projectExtDir, PROJECT_SPECS_DIR, 'project-local.md'),
    legacySpecRegistryPath: path.join(projectExtDir, PROJECT_SPECS_DIR, 'registry.json'),
    legacyPackRegistryPath: path.join(projectExtDir, 'packs', 'registry.json'),
    legacyTemplateRegistryPath: path.join(projectExtDir, PROJECT_TEMPLATES_DIR, 'registry.json')
  };
}

function createDefaultProjectLocalSpec() {
  return [
    '# Project Local Rules',
    '',
    '- Record repo-specific coding rules, review rules, and workflow expectations here.',
    '- Keep this file high-signal. Prefer stable constraints over temporary task notes.',
    '- Add exact paths, naming conventions, build expectations, and verification requirements when they become durable.',
    ''
  ].join('\n');
}

function createDefaultProjectWorkflowRegistry() {
  return {
    version: WORKFLOW_REGISTRY_VERSION,
    templates: [],
    packs: [],
    specs: [
      {
        name: 'project-local',
        title: 'Project Local Rules',
        path: 'specs/project-local.md',
        summary: 'Project-specific repo conventions and durable workflow rules.',
        auto_inject: true,
        priority: 120,
        apply_when: {
          always: true
        }
      }
    ]
  };
}

function readLegacySection(filePath, key) {
  const raw = readJsonIfExists(filePath);
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && Array.isArray(raw[key])) {
    return raw[key];
  }
  return [];
}

function syncProjectWorkflowLayout(projectExtDir, options = {}) {
  const write = options.write !== false;
  const force = options.force === true;
  const paths = getProjectWorkflowPaths(projectExtDir);
  const created = [];
  const migrated = [];
  const reused = [];

  const dirs = [paths.registryDir, paths.specsDir, paths.templatesDir];
  dirs.forEach(dirPath => {
    if (fs.existsSync(dirPath)) {
      reused.push(path.relative(projectExtDir, dirPath).replace(/\\/g, '/'));
      return;
    }
    if (!write) {
      return;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    created.push(path.relative(projectExtDir, dirPath).replace(/\\/g, '/'));
  });

  const existingRegistry = readJsonIfExists(paths.registryPath);
  const nextRegistry = existingRegistry
    ? normalizeRegistry(existingRegistry, 'Project workflow registry')
    : normalizeRegistry(createDefaultProjectWorkflowRegistry(), 'Default project workflow registry');

  const legacyTemplates = readLegacySection(paths.legacyTemplateRegistryPath, 'templates');
  const legacyPacks = readLegacySection(paths.legacyPackRegistryPath, 'packs');
  const legacySpecs = readLegacySection(paths.legacySpecRegistryPath, 'specs');
  const hasLegacyRegistry = legacyTemplates.length > 0 || legacyPacks.length > 0 || legacySpecs.length > 0;

  if (hasLegacyRegistry) {
    nextRegistry.templates = mergeCatalogEntries(
      nextRegistry.templates,
      legacyTemplates.map((item, index) => normalizeTemplateEntry(item, `Legacy templates[${index}]`))
    );
    nextRegistry.packs = mergeCatalogEntries(
      nextRegistry.packs,
      legacyPacks.map((item, index) => normalizePackEntry(item, `Legacy packs[${index}]`))
    );
    nextRegistry.specs = mergeCatalogEntries(
      nextRegistry.specs,
      legacySpecs.map((item, index) => normalizeSpecEntry(item, `Legacy specs[${index}]`))
    );
  }

  if (!fs.existsSync(paths.registryPath) || force || hasLegacyRegistry) {
    if (write) {
      fs.mkdirSync(path.dirname(paths.registryPath), { recursive: true });
      fs.writeFileSync(paths.registryPath, JSON.stringify(nextRegistry, null, 2) + '\n', 'utf8');
      const relativePath = path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/');
      if (fs.existsSync(paths.registryPath) && existingRegistry) {
        migrated.push(relativePath);
      } else {
        created.push(relativePath);
      }
    }
  } else {
    reused.push(path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/'));
  }

  if (!fs.existsSync(paths.projectLocalSpecPath) || force) {
    if (write) {
      fs.mkdirSync(path.dirname(paths.projectLocalSpecPath), { recursive: true });
      fs.writeFileSync(paths.projectLocalSpecPath, createDefaultProjectLocalSpec(), 'utf8');
      created.push(path.relative(projectExtDir, paths.projectLocalSpecPath).replace(/\\/g, '/'));
    }
  } else {
    reused.push(path.relative(projectExtDir, paths.projectLocalSpecPath).replace(/\\/g, '/'));
  }

  if (write && hasLegacyRegistry) {
    [
      paths.legacyTemplateRegistryPath,
      paths.legacyPackRegistryPath,
      paths.legacySpecRegistryPath
    ].forEach(filePath => {
      if (!fs.existsSync(filePath)) {
        return;
      }
      fs.rmSync(filePath, { force: true });
      migrated.push(path.relative(projectExtDir, filePath).replace(/\\/g, '/'));
    });
  }

  return {
    project_ext_dir: projectExtDir,
    registry_path: path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/'),
    created,
    migrated,
    reused
  };
}

function loadWorkflowRegistry(runtimeRoot, options = {}) {
  const runtimeRegistryPath = path.join(runtimeRoot, 'registry', WORKFLOW_REGISTRY_FILE);
  const builtInRaw = normalizeRegistry(readJsonIfExists(runtimeRegistryPath), 'Built-in workflow registry');
  const builtIn = {
    version: builtInRaw.version,
    templates: resolveCatalogEntries(builtInRaw.templates, 'templates', runtimeRoot, 'built-in', runtimeRegistryPath),
    packs: resolveCatalogEntries(builtInRaw.packs, 'packs', runtimeRoot, 'built-in', runtimeRegistryPath),
    specs: resolveCatalogEntries(builtInRaw.specs, 'specs', runtimeRoot, 'built-in', runtimeRegistryPath)
  };

  const projectExtDir = options.projectExtDir || '';
  if (!projectExtDir) {
    return builtIn;
  }

  const paths = getProjectWorkflowPaths(projectExtDir);
  const projectRaw = normalizeRegistry(readJsonIfExists(paths.registryPath), 'Project workflow registry');
  const project = {
    version: projectRaw.version,
    templates: resolveCatalogEntries(projectRaw.templates, 'templates', projectExtDir, 'project', paths.registryPath),
    packs: resolveCatalogEntries(projectRaw.packs, 'packs', projectExtDir, 'project', paths.registryPath),
    specs: resolveCatalogEntries(projectRaw.specs, 'specs', projectExtDir, 'project', paths.registryPath)
  };

  const discoveredTemplates = resolveCatalogEntries(
    discoverProjectTemplates(projectExtDir),
    'templates',
    projectExtDir,
    'project',
    paths.registryPath
  );
  const discoveredPacks = resolveCatalogEntries(
    discoverProjectPacks(projectExtDir),
    'packs',
    projectExtDir,
    'project',
    paths.registryPath
  );
  const discoveredSpecs = resolveCatalogEntries(
    discoverProjectSpecs(projectExtDir),
    'specs',
    projectExtDir,
    'project',
    paths.registryPath
  );

  return {
    version: Math.max(builtIn.version, project.version),
    templates: appendMissingCatalogEntries(
      mergeCatalogEntries(builtIn.templates, project.templates),
      discoveredTemplates
    ),
    packs: appendMissingCatalogEntries(
      mergeCatalogEntries(builtIn.packs, project.packs),
      discoveredPacks
    ),
    specs: appendMissingCatalogEntries(
      mergeCatalogEntries(builtIn.specs, project.specs),
      discoveredSpecs
    ),
    registry_paths: {
      built_in: runtimeRegistryPath,
      project: paths.registryPath
    }
  };
}

function buildTemplateConfigMap(registry, options = {}) {
  const entries = (registry && Array.isArray(registry.templates)) ? registry.templates : [];
  const runtimeTemplatesDir = options.runtimeTemplatesDir || '';
  const map = {};

  entries.forEach(entry => {
    if (entry.scope !== 'built-in') {
      return;
    }
    map[entry.name] = Object.freeze({
      source: runtimeTemplatesDir ? path.relative(runtimeTemplatesDir, entry.absolute_path).replace(/\\/g, '/') : entry.source,
      description: entry.description,
      default_output: entry.default_output
    });
  });

  return Object.freeze(map);
}

function evaluateSpecReason(spec, context) {
  const applyWhen = spec.apply_when || {};
  const reasons = [];
  const profile = String((context && context.profile) || '').trim();
  const packs = new Set(((context && context.packs) || []).map(item => String(item || '').trim()));
  const task = context && context.task ? context.task : null;
  const handoff = Boolean(context && context.handoff);

  if (applyWhen.always) {
    reasons.push('always');
  }
  if (profile && applyWhen.profiles.includes(profile)) {
    reasons.push(`profile:${profile}`);
  }
  applyWhen.packs.forEach(name => {
    if (packs.has(name)) {
      reasons.push(`pack:${name}`);
    }
  });
  if (task && task.type && applyWhen.task_types.includes(task.type)) {
    reasons.push(`task:${task.type}`);
  }
  if (task && task.status && applyWhen.task_statuses.includes(task.status)) {
    reasons.push(`status:${task.status}`);
  }
  if (task && applyWhen.requires_active_task) {
    reasons.push('active-task');
  }
  if (handoff && applyWhen.has_handoff) {
    reasons.push('handoff');
  }

  if (reasons.length === 0 && spec.auto_inject) {
    const hasNoConditions =
      !applyWhen.always &&
      applyWhen.packs.length === 0 &&
      applyWhen.profiles.length === 0 &&
      applyWhen.task_types.length === 0 &&
      applyWhen.task_statuses.length === 0 &&
      !applyWhen.requires_active_task &&
      !applyWhen.has_handoff;
    if (hasNoConditions) {
      reasons.push('always');
    }
  }

  return reasons;
}

function resolveAutoInjectedSpecs(registry, context = {}, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 6;
  const entries = ((registry && registry.specs) || [])
    .filter(item => item && item.auto_inject)
    .map(item => ({
      ...item,
      reasons: evaluateSpecReason(item, context)
    }))
    .filter(item => item.reasons.length > 0)
    .sort((left, right) =>
      right.priority - left.priority ||
      left.name.localeCompare(right.name)
    )
    .slice(0, limit)
    .map(item => ({
      name: item.name,
      title: item.title || prettyName(item.name),
      summary: item.summary || '',
      display_path: item.display_path,
      absolute_path: item.absolute_path,
      scope: item.scope,
      priority: item.priority,
      reasons: item.reasons
    }));

  return entries;
}

function buildInjectedSpecSnapshot(runtimeRoot, projectExtDir, context = {}, options = {}) {
  const registry = loadWorkflowRegistry(runtimeRoot, { projectExtDir });
  return {
    items: resolveAutoInjectedSpecs(registry, context, options),
    registry_paths: registry.registry_paths || {}
  };
}

module.exports = {
  WORKFLOW_REGISTRY_VERSION,
  PROJECT_REGISTRY_DIR,
  PROJECT_SPECS_DIR,
  PROJECT_TEMPLATES_DIR,
  WORKFLOW_REGISTRY_FILE,
  buildInjectedSpecSnapshot,
  buildTemplateConfigMap,
  createDefaultProjectWorkflowRegistry,
  getProjectWorkflowPaths,
  loadWorkflowRegistry,
  resolveAutoInjectedSpecs,
  syncProjectWorkflowLayout
};
