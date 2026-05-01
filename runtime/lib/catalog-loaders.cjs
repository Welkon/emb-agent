'use strict';

function createCatalogLoaders(deps) {
  const fs = deps.fs;
  const path = deps.path;
  const ROOT = deps.ROOT;
  const SOURCE_ROOT = deps.SOURCE_ROOT;
  const SOURCE_LAYOUT = deps.SOURCE_LAYOUT;
  const PROFILES_DIR = deps.PROFILES_DIR;
  const COMMANDS_DIR = deps.COMMANDS_DIR;
  const COMMAND_DOCS_DIR = deps.COMMAND_DOCS_DIR;
  const runtime = deps.runtime;
  const workflowRegistry = deps.workflowRegistry;
  const chipCatalog = deps.chipCatalog;
  const getProjectExtDir = deps.getProjectExtDir;

  function getProjectProfilesDir() {
    return path.join(getProjectExtDir(), 'profiles');
  }

  function loadWorkflowCatalog() {
    return workflowRegistry.loadWorkflowRegistry(ROOT, {
      projectExtDir: getProjectExtDir()
    });
  }

  function resolveYamlPath(projectDir, builtInDir, name) {
    const projectPath = path.join(projectDir, `${name}.yaml`);
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }

    const builtInPath = path.join(builtInDir, `${name}.yaml`);
    if (fs.existsSync(builtInPath)) {
      return builtInPath;
    }

    return '';
  }

  function loadProfile(name) {
    const filePath = resolveYamlPath(getProjectProfilesDir(), PROFILES_DIR, name);
    if (!filePath) {
      throw new Error(`Profile not found: ${name}`);
    }
    return runtime.validateProfile(name, runtime.parseSimpleYaml(filePath));
  }

  function getCatalogSpecEntry(name, options = {}) {
    const entry = (loadWorkflowCatalog().specs || []).find(item => item.name === name);
    if (!entry) {
      throw new Error(`Spec not found: ${name}`);
    }
    if (options.selectable === true && entry.selectable !== true) {
      throw new Error(`Spec is not selectable: ${name}`);
    }
    return entry;
  }

  function buildSpecView(entry, options = {}) {
    const includeContent = options.includeContent !== false;
    return {
      name: entry.name,
      title: entry.title || entry.name,
      path: entry.display_path,
      scope: entry.scope,
      summary: entry.summary,
      auto_inject: entry.auto_inject,
      selectable: entry.selectable === true,
      priority: entry.priority,
      apply_when: entry.apply_when,
      focus_areas: entry.focus_areas || [],
      extra_review_axes: entry.extra_review_axes || [],
      preferred_notes: entry.preferred_notes || [],
      default_agents: entry.default_agents || [],
      ...(includeContent ? { content: runtime.readText(entry.absolute_path) } : {})
    };
  }

  function listSpecNames(options = {}) {
    const selectableOnly = options.selectable === true;
    return runtime.unique(
      (loadWorkflowCatalog().specs || [])
        .filter(item => (selectableOnly ? item.selectable === true : true))
        .map(item => item.name)
    );
  }

  function loadSpec(name) {
    const entry = getCatalogSpecEntry(name);
    return buildSpecView(entry, { includeContent: true });
  }

  function loadSelectedSpec(name) {
    const entry = getCatalogSpecEntry(name, { selectable: true });
    return buildSpecView(entry, { includeContent: true });
  }

  function loadMarkdown(dirPath, name, kind) {
    const filePath = path.join(dirPath, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`${kind} not found: ${name}`);
    }

    const displayRoot = SOURCE_LAYOUT ? SOURCE_ROOT : ROOT;

    return {
      name,
      path: path.relative(displayRoot, filePath).replace(/\\/g, '/'),
      content: runtime.readText(filePath)
    };
  }

  function loadCommandMarkdown(name) {
    const resolvedName = name;
    const fileName = `${resolvedName}.md`;
    const publicPath = path.join(COMMANDS_DIR, fileName);
    if (fs.existsSync(publicPath)) {
      const command = loadMarkdown(COMMANDS_DIR, resolvedName, 'Command');
      return {
        ...command,
        name
      };
    }

    const hiddenPath = path.join(COMMAND_DOCS_DIR, fileName);
    if (fs.existsSync(hiddenPath)) {
      const displayRoot = SOURCE_LAYOUT ? SOURCE_ROOT : ROOT;
      return {
        name,
        path: path.relative(displayRoot, hiddenPath).replace(/\\/g, '/'),
        content: runtime.readText(hiddenPath)
      };
    }

    throw new Error(`Command not found: ${name}`);
  }

  function normalizeHardwareSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function compactHardwareSlug(value) {
    return normalizeHardwareSlug(value).replace(/-/g, '');
  }

  function findChipProfileByModel(model, packageName) {
    const normalizedModel = String(model || '').trim();
    const normalizedPackage = String(packageName || '').trim();
    if (!normalizedModel) {
      return null;
    }

    const candidates = runtime.unique([
      normalizedModel,
      compactHardwareSlug(normalizedModel),
      normalizedPackage ? compactHardwareSlug(`${normalizedModel}${normalizedPackage}`) : '',
      normalizedPackage ? compactHardwareSlug(`${normalizedModel}-${normalizedPackage}`) : ''
    ].filter(Boolean));

    for (const candidate of candidates) {
      try {
        return chipCatalog.loadChip(ROOT, candidate);
      } catch {
        // keep trying fallback candidates
      }
    }

    const matched = chipCatalog
      .listChips(ROOT)
      .find(item => {
        const itemName = String(item.name || '').toLowerCase();
        return candidates.some(candidate => itemName === String(candidate).toLowerCase());
      });

    if (!matched) {
      return null;
    }

    return chipCatalog.loadChip(ROOT, matched.name);
  }

  return {
    buildSpecView,
    findChipProfileByModel,
    getCatalogSpecEntry,
    getProjectProfilesDir,
    listSpecNames,
    loadCommandMarkdown,
    loadMarkdown,
    loadProfile,
    loadSelectedSpec,
    loadSpec,
    loadWorkflowCatalog,
    resolveYamlPath
  };
}

module.exports = {
  createCatalogLoaders
};
