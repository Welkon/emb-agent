'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_REGISTRY_VERSION = 1;
const PROJECT_REGISTRY_DIR = 'registry';
const PROJECT_SPECS_DIR = 'specs';
const PROJECT_TEMPLATES_DIR = 'templates';
const WORKFLOW_REGISTRY_FILE = 'workflow.json';
const CODE_WRITING_SPEC_NAMES = new Set([
  'embedded-space',
  'low-rom-space',
  'padauk-space',
  'padauk-firmware',
  'scmcu-space'
]);
const LOW_ROM_PROGRAM_PERCENT = 80;
const LOW_RAM_DATA_PERCENT = 75;
const TINY_PROGRAM_TOTAL = 8192;
const TINY_DATA_TOTAL = 1024;
const RESOURCE_SUMMARY_SCAN_LIMIT = 200;

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

function ensureOptionalStringArray(value, label) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return ensureStringArray(value, label);
  }
  return [ensureString(value, label)];
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
      specs: [],
      packages: [],
      profiles: [],
      task_types: [],
      task_statuses: [],
      resource_pressure: [],
      requires_active_task: false,
      has_handoff: false
    };
  }

  const source = ensureObject(raw, label);
  return {
    always: ensureBoolean(source.always, false),
    specs: ensureStringArray(source.specs || [], `${label}.specs`),
    packages: ensureStringArray(source.packages || [], `${label}.packages`),
    profiles: ensureStringArray(source.profiles || [], `${label}.profiles`),
    task_types: ensureStringArray(source.task_types || [], `${label}.task_types`),
    task_statuses: ensureStringArray(source.task_statuses || [], `${label}.task_statuses`),
    resource_pressure: ensureStringArray(source.resource_pressure || [], `${label}.resource_pressure`),
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

function normalizeSpecEntry(entry, label) {
  const source = ensureObject(entry, label);
  const enforcementScopes = ensureOptionalStringArray(
    source.enforcement_scopes !== undefined ? source.enforcement_scopes : source.enforcement_scope,
    `${label}.enforcement_scopes`
  );

  return {
    name: ensureString(source.name, `${label}.name`),
    title: ensureOptionalString(source.title),
    path: ensureRelativeFile(source.path, `${label}.path`),
    summary: ensureOptionalString(source.summary),
    auto_inject: ensureBoolean(source.auto_inject, false),
    selectable: ensureBoolean(source.selectable, false),
    priority: ensureInteger(source.priority, 0),
    apply_when: normalizeApplyWhen(source.apply_when, `${label}.apply_when`),
    focus_areas: ensureStringArray(source.focus_areas || [], `${label}.focus_areas`),
    extra_review_axes: ensureStringArray(source.extra_review_axes || [], `${label}.extra_review_axes`),
    preferred_notes: ensureStringArray(source.preferred_notes || [], `${label}.preferred_notes`),
    default_agents: ensureStringArray(source.default_agents || [], `${label}.default_agents`),
    enforcement_scopes: enforcementScopes
  };
}

function normalizeRegistry(raw, label) {
  const source = raw ? ensureObject(raw, label) : {};
  return {
    version: ensureInteger(source.version, WORKFLOW_REGISTRY_VERSION),
    templates: (Array.isArray(source.templates) ? source.templates : []).map((item, index) =>
      normalizeTemplateEntry(item, `${label}.templates[${index}]`)
    ),
    specs: (Array.isArray(source.specs) ? source.specs : []).map((item, index) =>
      normalizeSpecEntry(item, `${label}.specs[${index}]`)
    )
  };
}

function resolveCatalogEntries(entries, kind, sourceRoot, scope, registryPath) {
  return entries.map(entry => {
    const relativeFile = kind === 'templates' ? entry.source : entry.path;
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
        selectable: false,
        priority: 0,
        apply_when: {},
        focus_areas: [],
        extra_review_axes: [],
        preferred_notes: [],
        default_agents: []
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
    specs: [
      {
        name: 'project-local',
        title: 'Project Local Rules',
        path: 'specs/project-local.md',
        summary: 'Project-specific repo conventions and durable workflow rules.',
        auto_inject: true,
        selectable: false,
        priority: 120,
        apply_when: {
          always: true
        },
        focus_areas: [],
        extra_review_axes: [],
        preferred_notes: [],
        default_agents: []
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
  const legacySpecs = readLegacySection(paths.legacySpecRegistryPath, 'specs');
  const hasLegacyRegistry = legacyTemplates.length > 0 || legacySpecs.length > 0;

  if (hasLegacyRegistry) {
    nextRegistry.templates = mergeCatalogEntries(
      nextRegistry.templates,
      legacyTemplates.map((item, index) => normalizeTemplateEntry(item, `Legacy templates[${index}]`))
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
    specs: resolveCatalogEntries(projectRaw.specs, 'specs', projectExtDir, 'project', paths.registryPath)
  };

  const discoveredTemplates = resolveCatalogEntries(
    discoverProjectTemplates(projectExtDir),
    'templates',
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
  const specs = new Set(((context && context.specs) || []).map(item => String(item || '').trim()));
  const activePackage = String((context && context.active_package) || '').trim();
  const defaultPackage = String((context && context.default_package) || '').trim();
  const task = context && context.task ? context.task : null;
  const handoff = Boolean(context && context.handoff);
  const resourcePressure = new Set(toUniqueStringArray(context && context.resource_pressure));
  const packageCandidates = new Set(
    [activePackage, defaultPackage, task && task.package ? String(task.package).trim() : ''].filter(Boolean)
  );

  if (applyWhen.always) {
    reasons.push('always');
  }
  if (profile && applyWhen.profiles.includes(profile)) {
    reasons.push(`profile:${profile}`);
  }
  applyWhen.specs.forEach(name => {
    if (specs.has(name)) {
      reasons.push(`spec:${name}`);
    }
  });
  applyWhen.packages.forEach(name => {
    if (packageCandidates.has(name)) {
      reasons.push(`package:${name}`);
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
  applyWhen.resource_pressure.forEach(name => {
    if (resourcePressure.has(name)) {
      reasons.push(`resource:${name}`);
    }
  });

  if (reasons.length === 0 && spec.auto_inject) {
    const hasNoConditions =
      !applyWhen.always &&
      applyWhen.specs.length === 0 &&
      applyWhen.packages.length === 0 &&
      applyWhen.profiles.length === 0 &&
      applyWhen.task_types.length === 0 &&
      applyWhen.task_statuses.length === 0 &&
      applyWhen.resource_pressure.length === 0 &&
      !applyWhen.requires_active_task &&
      !applyWhen.has_handoff;
    if (hasNoConditions) {
      reasons.push('always');
    }
  }

  return reasons;
}

function buildSpecSnapshotEntry(item, reasons, flags = {}) {
  return {
    name: item.name,
    title: item.title || prettyName(item.name),
    summary: item.summary || '',
    display_path: item.display_path,
    absolute_path: item.absolute_path,
    scope: item.scope,
    priority: item.priority,
    reasons,
    selected_active: flags.selected_active === true,
    required: flags.required === true,
    enforcement_scope: flags.enforcement_scope || ''
  };
}

function mergeSpecSnapshotEntry(target, source) {
  if (!target) {
    return source;
  }

  return {
    ...target,
    reasons: Array.from(new Set([...(target.reasons || []), ...(source.reasons || [])])),
    selected_active: target.selected_active === true || source.selected_active === true,
    required: target.required === true || source.required === true,
    enforcement_scope: target.enforcement_scope || source.enforcement_scope || ''
  };
}

function specMatchesEnforcementScope(spec, scope) {
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope) {
    return true;
  }

  const declaredScopes = Array.isArray(spec && spec.enforcement_scopes)
    ? spec.enforcement_scopes.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (declaredScopes.includes(normalizedScope)) {
    return true;
  }

  return normalizedScope === 'code-writing' && CODE_WRITING_SPEC_NAMES.has(String((spec && spec.name) || '').trim());
}

function inferSpecEnforcementScope(spec, preferredScope) {
  const normalizedPreferred = String(preferredScope || '').trim();
  if (normalizedPreferred && specMatchesEnforcementScope(spec, normalizedPreferred)) {
    return normalizedPreferred;
  }

  const declaredScopes = Array.isArray(spec && spec.enforcement_scopes)
    ? spec.enforcement_scopes.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (declaredScopes.length > 0) {
    return declaredScopes[0];
  }

  const name = String((spec && spec.name) || '').trim();
  if (CODE_WRITING_SPEC_NAMES.has(name)) {
    return 'code-writing';
  }

  return '';
}

function toUniqueStringArray(value) {
  const list = Array.isArray(value)
    ? value
    : (value === undefined || value === null || value === '' ? [] : [value]);
  return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)));
}

function percentFromMemoryBlock(block) {
  if (!block || typeof block !== 'object') {
    return null;
  }
  if (typeof block.percent === 'number' && Number.isFinite(block.percent)) {
    return block.percent;
  }
  if (
    typeof block.used === 'number' && Number.isFinite(block.used) &&
    typeof block.total === 'number' && Number.isFinite(block.total) &&
    block.total > 0
  ) {
    return (block.used / block.total) * 100;
  }
  return null;
}

function totalFromMemoryBlock(block) {
  if (!block || typeof block !== 'object') {
    return null;
  }
  return typeof block.total === 'number' && Number.isFinite(block.total) && block.total > 0
    ? block.total
    : null;
}

function firstMemoryBlock(memory, names) {
  if (!memory || typeof memory !== 'object') {
    return null;
  }
  for (const name of names) {
    if (memory[name] && typeof memory[name] === 'object') {
      return memory[name];
    }
  }
  return null;
}

function pressureFromBuildSummary(summary) {
  const memory = summary && summary.memory && typeof summary.memory === 'object' ? summary.memory : null;
  if (!memory) {
    return [];
  }

  const pressure = [];
  const program = firstMemoryBlock(memory, ['program_space', 'program', 'rom', 'flash', 'text']);
  const data = firstMemoryBlock(memory, ['data_space', 'data', 'ram', 'sram', 'bss_data']);
  const programPercent = percentFromMemoryBlock(program);
  const dataPercent = percentFromMemoryBlock(data);
  const programTotal = totalFromMemoryBlock(program);
  const dataTotal = totalFromMemoryBlock(data);

  if ((programPercent !== null && programPercent >= LOW_ROM_PROGRAM_PERCENT) ||
      (programTotal !== null && programTotal <= TINY_PROGRAM_TOTAL)) {
    pressure.push('low-rom');
    pressure.push('constrained-memory');
  }
  if ((dataPercent !== null && dataPercent >= LOW_RAM_DATA_PERCENT) ||
      (dataTotal !== null && dataTotal <= TINY_DATA_TOTAL)) {
    pressure.push('low-ram');
    pressure.push('constrained-memory');
  }

  return pressure;
}

function detectResourcePressureFromBuildSummaries(projectRoot) {
  const normalizedRoot = String(projectRoot || '').trim();
  if (!normalizedRoot) {
    return [];
  }

  const buildDir = path.join(normalizedRoot, 'build');
  if (!fs.existsSync(buildDir) || !fs.statSync(buildDir).isDirectory()) {
    return [];
  }

  const summaries = [];
  function walk(dir) {
    if (summaries.length >= RESOURCE_SUMMARY_SCAN_LIMIT) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (summaries.length >= RESOURCE_SUMMARY_SCAN_LIMIT) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'build_summary.json') {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        summaries.push({ fullPath, mtimeMs });
      }
    }
  }

  walk(buildDir);
  summaries.sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const item of summaries.slice(0, 5)) {
    try {
      const pressure = pressureFromBuildSummary(JSON.parse(fs.readFileSync(item.fullPath, 'utf8')));
      if (pressure.length > 0) {
        return Array.from(new Set(pressure));
      }
    } catch {
      // Ignore stale or partial build summaries.
    }
  }

  return [];
}

function projectRootFromExtDir(projectExtDir) {
  const normalized = String(projectExtDir || '').trim();
  if (!normalized) {
    return '';
  }
  const absolute = path.resolve(normalized);
  return path.basename(absolute) === '.emb-agent'
    ? path.dirname(absolute)
    : path.dirname(absolute);
}

function enrichContextWithResourcePressure(context, projectExtDir) {
  const source = context && typeof context === 'object' ? context : {};
  const detected = detectResourcePressureFromBuildSummaries(projectRootFromExtDir(projectExtDir));
  if (detected.length === 0) {
    return source;
  }
  return {
    ...source,
    resource_pressure: toUniqueStringArray([...toUniqueStringArray(source.resource_pressure), ...detected])
  };
}

function resolveAutoInjectedSpecs(registry, context = {}, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 6;
  const includeSelectedSpecs = options.include_selected_specs === true;
  const selectedSpecsOnly = options.selected_specs_only === true;
  const selectedReason = String(options.selected_reason || 'selected-active-spec').trim() || 'selected-active-spec';
  const selectedEnforcementScope = String(options.selected_enforcement_scope || '').trim();
  const enforcementScopeFilter = String(options.enforcement_scope_filter || '').trim();
  const autoRequiredEnforcementScope = String(options.auto_required_enforcement_scope || '').trim();
  const activeSpecNames = new Set(((context && context.specs) || []).map(item => String(item || '').trim()).filter(Boolean));
  const byName = new Map();
  const autoEntries = selectedSpecsOnly
    ? []
    : ((registry && registry.specs) || [])
      .filter(item =>
        item &&
        item.auto_inject &&
        (!enforcementScopeFilter || specMatchesEnforcementScope(item, enforcementScopeFilter))
      )
    .map(item => ({
      ...item,
      reasons: evaluateSpecReason(item, context)
    }))
    .filter(item => item.reasons.length > 0)
    .sort((left, right) =>
      right.priority - left.priority ||
      left.name.localeCompare(right.name)
    )
    .slice(0, limit);

  autoEntries.forEach(item => {
    const autoScope = inferSpecEnforcementScope(item, enforcementScopeFilter || autoRequiredEnforcementScope);
    const entry = buildSpecSnapshotEntry(item, item.reasons || [], {
      required: Boolean(autoRequiredEnforcementScope && specMatchesEnforcementScope(item, autoRequiredEnforcementScope)),
      enforcement_scope: autoScope
    });
    byName.set(entry.name, mergeSpecSnapshotEntry(byName.get(entry.name), entry));
  });

  if (includeSelectedSpecs && activeSpecNames.size > 0) {
    ((registry && registry.specs) || [])
      .filter(item =>
        item &&
        item.selectable &&
        activeSpecNames.has(item.name) &&
        (!enforcementScopeFilter || specMatchesEnforcementScope(item, enforcementScopeFilter)) &&
        specMatchesEnforcementScope(item, selectedEnforcementScope)
      )
      .forEach(item => {
        const entry = buildSpecSnapshotEntry(item, [selectedReason], {
          selected_active: true,
          required: true,
          enforcement_scope: selectedEnforcementScope || enforcementScopeFilter
        });
        byName.set(entry.name, mergeSpecSnapshotEntry(byName.get(entry.name), entry));
      });
  }

  return Array.from(byName.values())
    .sort((left, right) =>
      Number(right.required === true) - Number(left.required === true) ||
      right.priority - left.priority ||
      left.name.localeCompare(right.name)
    );
}

function buildInjectedSpecSnapshot(runtimeRoot, projectExtDir, context = {}, options = {}) {
  const registry = loadWorkflowRegistry(runtimeRoot, { projectExtDir });
  const enrichedContext = enrichContextWithResourcePressure(context, projectExtDir);
  return {
    items: resolveAutoInjectedSpecs(registry, enrichedContext, options),
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
  normalizeRegistry,
  resolveAutoInjectedSpecs,
  syncProjectWorkflowLayout
};
