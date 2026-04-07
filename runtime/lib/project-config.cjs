'use strict';

function createProjectConfigHelpers(deps) {
  const {
    path,
    runtime,
    adapterSources,
    ROOT,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    resolveSession,
    getProjectConfig,
    initProjectLayout,
    updateSession,
    getPreferences
  } = deps;
  const DEFAULT_ADAPTER_SOURCE_NAME = 'default-pack';
  const DEFAULT_ADAPTER_SOURCE_TYPE = 'git';
  const DEFAULT_ADAPTER_SOURCE_LOCATION = 'https://github.com/Welkon/emb-agent-adapters.git';

  function selectNestedField(source, fieldPath) {
    if (!fieldPath) {
      return source;
    }

    const parts = fieldPath
      .split('.')
      .map(item => item.trim())
      .filter(Boolean);

    let current = source;

    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        throw new Error(`Unknown field path: ${fieldPath}`);
      }
      current = current[part];
    }

    return current;
  }

  function parseProjectShowArgs(tokens) {
    const result = {
      effective: false,
      field: ''
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--effective') {
        result.effective = true;
        continue;
      }

      if (token === '--field') {
        result.field = tokens[index + 1] || '';
        index += 1;
        if (!result.field) {
          throw new Error('Missing path after --field');
        }
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    return result;
  }

  function parseProjectSetArgs(tokens) {
    const result = {
      field: '',
      value: ''
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--field') {
        result.field = tokens[index + 1] || '';
        index += 1;
        if (!result.field) {
          throw new Error('Missing path after --field');
        }
        continue;
      }

      if (token === '--value') {
        result.value = tokens[index + 1] || '';
        index += 1;
        if (result.value === '') {
          throw new Error('Missing value after --value');
        }
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    if (!result.field) {
      throw new Error('Missing --field');
    }
    if (result.value === '') {
      throw new Error('Missing --value');
    }

    return result;
  }

  function parseAdapterSourceAddArgs(tokens) {
    const result = {
      type: '',
      location: '',
      branch: '',
      subdir: '',
      enabled: true
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--type') {
        result.type = tokens[index + 1] || '';
        index += 1;
        if (!result.type) {
          throw new Error('Missing value after --type');
        }
        continue;
      }

      if (token === '--location') {
        result.location = tokens[index + 1] || '';
        index += 1;
        if (!result.location) {
          throw new Error('Missing value after --location');
        }
        continue;
      }

      if (token === '--branch') {
        result.branch = tokens[index + 1] || '';
        index += 1;
        if (!result.branch) {
          throw new Error('Missing value after --branch');
        }
        continue;
      }

      if (token === '--subdir') {
        result.subdir = tokens[index + 1] || '';
        index += 1;
        if (!result.subdir) {
          throw new Error('Missing value after --subdir');
        }
        continue;
      }

      if (token === '--disabled') {
        result.enabled = false;
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    if (!result.type) {
      throw new Error('Missing --type');
    }
    if (!result.location) {
      throw new Error('Missing --location');
    }

    return result;
  }

  function parseAdapterSyncArgs(tokens) {
    const result = {
      all: false,
      target: 'project',
      force: false,
      match_project: true,
      tools: [],
      families: [],
      devices: [],
      chips: []
    };

    const pushListValues = (target, raw, label) => {
      const values = String(raw || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      if (values.length === 0) {
        throw new Error(`Missing value after ${label}`);
      }

      values.forEach(value => {
        if (!target.includes(value)) {
          target.push(value);
        }
      });
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--all') {
        result.all = true;
        continue;
      }

      if (token === '--to') {
        result.target = tokens[index + 1] || '';
        index += 1;
        if (!result.target) {
          throw new Error('Missing value after --to');
        }
        continue;
      }

      if (token === '--force') {
        result.force = true;
        continue;
      }

      if (token === '--no-match-project') {
        result.match_project = false;
        continue;
      }

      if (token === '--match-project') {
        result.match_project = true;
        continue;
      }

      if (token === '--tool') {
        pushListValues(result.tools, tokens[index + 1], '--tool');
        index += 1;
        continue;
      }

      if (token === '--family') {
        pushListValues(result.families, tokens[index + 1], '--family');
        index += 1;
        continue;
      }

      if (token === '--device') {
        pushListValues(result.devices, tokens[index + 1], '--device');
        index += 1;
        continue;
      }

      if (token === '--chip') {
        pushListValues(result.chips, tokens[index + 1], '--chip');
        index += 1;
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    return result;
  }

  function parseAdapterBootstrapArgs(tokens, fallbackName) {
    const result = {
      name: String(fallbackName || '').trim() || DEFAULT_ADAPTER_SOURCE_NAME,
      source_config_provided: false,
      source: {
        type: '',
        location: '',
        branch: '',
        subdir: '',
        enabled: true
      },
      sync: {
        target: 'project',
        force: false,
        match_project: true,
        tools: [],
        families: [],
        devices: [],
        chips: []
      }
    };

    const pushListValues = (target, raw, label) => {
      const values = String(raw || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      if (values.length === 0) {
        throw new Error(`Missing value after ${label}`);
      }

      values.forEach(value => {
        if (!target.includes(value)) {
          target.push(value);
        }
      });
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--type') {
        result.source.type = tokens[index + 1] || '';
        index += 1;
        if (!result.source.type) {
          throw new Error('Missing value after --type');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--location') {
        result.source.location = tokens[index + 1] || '';
        index += 1;
        if (!result.source.location) {
          throw new Error('Missing value after --location');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--branch') {
        result.source.branch = tokens[index + 1] || '';
        index += 1;
        if (!result.source.branch) {
          throw new Error('Missing value after --branch');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--subdir') {
        result.source.subdir = tokens[index + 1] || '';
        index += 1;
        if (!result.source.subdir) {
          throw new Error('Missing value after --subdir');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--disabled') {
        result.source.enabled = false;
        result.source_config_provided = true;
        continue;
      }

      if (token === '--to') {
        result.sync.target = tokens[index + 1] || '';
        index += 1;
        if (!result.sync.target) {
          throw new Error('Missing value after --to');
        }
        continue;
      }

      if (token === '--force') {
        result.sync.force = true;
        continue;
      }

      if (token === '--match-project') {
        result.sync.match_project = true;
        continue;
      }

      if (token === '--no-match-project') {
        result.sync.match_project = false;
        continue;
      }

      if (token === '--tool') {
        pushListValues(result.sync.tools, tokens[index + 1] || '', '--tool');
        index += 1;
        continue;
      }

      if (token === '--family') {
        pushListValues(result.sync.families, tokens[index + 1] || '', '--family');
        index += 1;
        continue;
      }

      if (token === '--device') {
        pushListValues(result.sync.devices, tokens[index + 1] || '', '--device');
        index += 1;
        continue;
      }

      if (token === '--chip') {
        pushListValues(result.sync.chips, tokens[index + 1] || '', '--chip');
        index += 1;
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    if (result.name === DEFAULT_ADAPTER_SOURCE_NAME) {
      if (!result.source.type) {
        result.source.type = DEFAULT_ADAPTER_SOURCE_TYPE;
      }
      if (!result.source.location) {
        result.source.location = DEFAULT_ADAPTER_SOURCE_LOCATION;
      }
    }

    return result;
  }

  function parseProjectValue(raw) {
    const value = String(raw).trim();

    if (!value) {
      return '';
    }

    if (
      value.startsWith('{') ||
      value.startsWith('[') ||
      value === 'true' ||
      value === 'false' ||
      value === 'null' ||
      /^-?\d+(\.\d+)?$/.test(value) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      try {
        return JSON.parse(value);
      } catch {
        // fall through to raw string
      }
    }

    return value;
  }

  function assignNestedField(target, fieldPath, value) {
    const parts = fieldPath
      .split('.')
      .map(item => item.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      throw new Error('Field path is empty');
    }

    let current = target;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }

  function buildProjectShow(includeEffective, fieldPath) {
    const resolved = resolveSession();
    const projectConfig = getProjectConfig();
    const output = {
      path: runtime.resolveProjectDataPath(resolveProjectRoot(), 'project.json'),
      config: projectConfig
    };

    if (includeEffective) {
      output.effective = {
        project_profile: resolved.session.project_profile,
        active_packs: resolved.session.active_packs,
        preferences: getPreferences(resolved.session),
        agents: resolved.effective.agents,
        review_agents: resolved.effective.review_agents,
        review_axes: resolved.effective.review_axes,
        note_targets: resolved.effective.note_targets,
        suggested_tools: resolved.effective.suggested_tools,
        arch_review_triggers: resolved.effective.arch_review_triggers
      };
    }

    if (!fieldPath) {
      return output;
    }

    return {
      path: output.path,
      field: fieldPath,
      value: selectNestedField(output, fieldPath)
    };
  }

  function buildProjectConfigSeed() {
    const resolved = resolveSession();
    const existing = getProjectConfig();

    if (existing) {
      return existing;
    }

    return runtime.validateProjectConfig(
      {
        project_profile: resolved.session.project_profile,
        active_packs: resolved.session.active_packs,
        adapter_sources: [],
        preferences: getPreferences(resolved.session),
        integrations: {},
        arch_review: {}
      },
      RUNTIME_CONFIG
    );
  }

  function syncSessionWithProjectConfig(validated) {
    return updateSession(current => {
      current.project_profile = validated.project_profile || current.project_profile;
      current.active_packs = validated.active_packs;
      current.preferences = validated.preferences;
    });
  }

  function writeProjectConfig(validated) {
    initProjectLayout();
    const projectConfigPath = runtime.resolveProjectDataPath(resolveProjectRoot(), 'project.json');
    runtime.writeJson(projectConfigPath, validated);
    const session = syncSessionWithProjectConfig(validated);

    return {
      path: projectConfigPath,
      config: validated,
      session: {
        project_profile: session.project_profile,
        active_packs: session.active_packs,
        preferences: session.preferences
      }
    };
  }

  function setProjectConfigValue(fieldPath, rawValue) {
    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));

    assignNestedField(nextConfig, fieldPath, parseProjectValue(rawValue));
    const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
    const saved = writeProjectConfig(validated);

    return {
      path: saved.path,
      field: fieldPath,
      value: selectNestedField(validated, fieldPath),
      config: validated,
      session: saved.session
    };
  }

  function buildAdapterStatus(name) {
    const projectConfig = buildProjectConfigSeed();
    const sources = adapterSources.listSourceStatus(ROOT, resolveProjectRoot(), projectConfig);

    if (!name) {
      return {
        project_root: resolveProjectRoot(),
        adapter_sources: sources
      };
    }

    const matched = sources.find(item => item.name === name);
    if (!matched) {
      throw new Error(`Adapter source not found: ${name}`);
    }

    return matched;
  }

  function addAdapterSource(name, tokens) {
    const sourceName = String(name || '').trim();
    if (!sourceName) {
      throw new Error('Missing source name');
    }

    const parsed = parseAdapterSourceAddArgs(tokens);
    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
    const nextSource = runtime.validateAdapterSource(
      {
        name: sourceName,
        ...parsed
      },
      0
    );
    const sources = nextConfig.adapter_sources || [];
    const existingIndex = sources.findIndex(item => item.name === sourceName);

    if (existingIndex >= 0) {
      sources[existingIndex] = nextSource;
    } else {
      sources.push(nextSource);
    }

    const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
    const saved = writeProjectConfig(validated);

    return {
      action: existingIndex >= 0 ? 'updated' : 'added',
      source: nextSource,
      path: saved.path,
      config: saved.config,
      session: saved.session
    };
  }

  function removeAdapterSource(name) {
    const sourceName = String(name || '').trim();
    if (!sourceName) {
      throw new Error('Missing source name');
    }

    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
    const sources = nextConfig.adapter_sources || [];
    const existing = sources.find(item => item.name === sourceName);

    if (!existing) {
      throw new Error(`Adapter source not found: ${sourceName}`);
    }

    nextConfig.adapter_sources = sources.filter(item => item.name !== sourceName);
    const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
    const saved = writeProjectConfig(validated);

    return {
      action: 'removed',
      source: existing,
      cleanup: [
        adapterSources.removeSyncedSource(ROOT, resolveProjectRoot(), sourceName, 'project'),
        adapterSources.removeSyncedSource(ROOT, resolveProjectRoot(), sourceName, 'runtime')
      ],
      path: saved.path,
      config: saved.config,
      session: saved.session
    };
  }

  function syncNamedAdapterSource(name, options) {
    const sourceName = String(name || '').trim();
    if (!sourceName) {
      throw new Error('Missing source name');
    }

    initProjectLayout();
    const projectConfig = buildProjectConfigSeed();
    const source = adapterSources.findSource(projectConfig, sourceName);

    if (!source) {
      throw new Error(`Adapter source not found: ${sourceName}`);
    }

    return adapterSources.syncAdapterSource(ROOT, resolveProjectRoot(), source, options || {});
  }

  function syncAllAdapterSources(options) {
    initProjectLayout();
    const projectConfig = buildProjectConfigSeed();

    return {
      project_root: resolveProjectRoot(),
      target: (options && options.target) || 'project',
      results: adapterSources.syncAllAdapterSources(
        ROOT,
        resolveProjectRoot(),
        projectConfig,
        options || {}
      )
    };
  }

  function bootstrapAdapterSource(name, tokens) {
    const sourceName = String(name || '').trim();
    const parsed = parseAdapterBootstrapArgs(tokens || [], sourceName);

    initProjectLayout();
    const projectConfig = buildProjectConfigSeed();
    const existing = adapterSources.findSource(projectConfig, parsed.name);
    let sourceResult = null;

    if (!existing || parsed.source_config_provided) {
      if (!parsed.source.type || !parsed.source.location) {
        throw new Error(`Missing source config for adapter bootstrap: ${parsed.name}`);
      }

      const addTokens = ['--type', parsed.source.type, '--location', parsed.source.location];
      if (parsed.source.branch) {
        addTokens.push('--branch', parsed.source.branch);
      }
      if (parsed.source.subdir) {
        addTokens.push('--subdir', parsed.source.subdir);
      }
      if (parsed.source.enabled === false) {
        addTokens.push('--disabled');
      }

      sourceResult = addAdapterSource(parsed.name, addTokens);
    }

    return {
      action: 'bootstrapped',
      source_action: sourceResult ? sourceResult.action : 'existing',
      source: sourceResult ? sourceResult.source : existing,
      sync: syncNamedAdapterSource(parsed.name, parsed.sync)
    };
  }

  return {
    selectNestedField,
    parseProjectShowArgs,
    parseProjectSetArgs,
    parseAdapterSourceAddArgs,
    parseAdapterSyncArgs,
    parseAdapterBootstrapArgs,
    parseProjectValue,
    assignNestedField,
    buildProjectShow,
    buildProjectConfigSeed,
    syncSessionWithProjectConfig,
    writeProjectConfig,
    setProjectConfigValue,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    bootstrapAdapterSource,
    syncNamedAdapterSource,
    syncAllAdapterSources
  };
}

module.exports = {
  createProjectConfigHelpers
};
