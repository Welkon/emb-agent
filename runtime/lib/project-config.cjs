'use strict';

const adapterQualityHelpers = require('./adapter-quality.cjs');
const defaultAdapterSourceHelpers = require('./default-adapter-source.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');

function createProjectConfigHelpers(deps) {
  const {
    path,
    process,
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
  const { DEFAULT_ADAPTER_SOURCE_NAME } = defaultAdapterSourceHelpers;

  function getDefaultAdapterSource() {
    return defaultAdapterSourceHelpers.resolveDefaultAdapterSource(RUNTIME_CONFIG, process && process.env);
  }

  function stripPermissionControlTokens(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    const filtered = [];
    let explicitConfirmation = false;

    for (const token of list) {
      if (token === '--confirm') {
        explicitConfirmation = true;
        continue;
      }
      filtered.push(token);
    }

    return {
      tokens: filtered,
      explicit_confirmation: explicitConfirmation
    };
  }

  function buildAdapterSyncQuality(syncResult) {
    let resolved = null;

    try {
      resolved = resolveSession ? resolveSession() : null;
    } catch {
      resolved = null;
    }

    const toolRecommendations =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.tool_recommendations)
        ? resolved.effective.tool_recommendations
        : [];
    const recommendedSources =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.recommended_sources)
        ? resolved.effective.recommended_sources
        : [];

    if (toolRecommendations.length > 0) {
      return {
        mode: 'session-aware',
        ...adapterQualityHelpers.summarizeAdapterHealth(toolRecommendations, recommendedSources)
      };
    }

    const selection = syncResult && syncResult.selection ? syncResult.selection : {};
    const matched = selection && selection.matched ? selection.matched : {};

    return {
      mode: 'selection-only',
      status: 'info',
      summary: 'Matched candidate adapter files have been synced, but current project context is still insufficient to generate a trust score.',
      matched_chips: matched.chips || [],
      matched_tools: matched.tools || [],
      inferred_from_project: Boolean(selection.inferred_from_project),
      next_action: selection.inferred_from_project
        ? 're-run-health-or-next'
        : 'fill-hw-or-run-sync-with-project-match'
    };
  }

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
      value: '',
      explicit_confirmation: false
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--confirm') {
        result.explicit_confirmation = true;
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
    const control = stripPermissionControlTokens(tokens);
    const argv = control.tokens;
    const result = {
      type: '',
      location: '',
      branch: '',
      subdir: '',
      enabled: true,
      explicit_confirmation: control.explicit_confirmation
    };

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (token === '--type') {
        result.type = argv[index + 1] || '';
        index += 1;
        if (!result.type) {
          throw new Error('Missing value after --type');
        }
        continue;
      }

      if (token === '--location') {
        result.location = argv[index + 1] || '';
        index += 1;
        if (!result.location) {
          throw new Error('Missing value after --location');
        }
        continue;
      }

      if (token === '--branch') {
        result.branch = argv[index + 1] || '';
        index += 1;
        if (!result.branch) {
          throw new Error('Missing value after --branch');
        }
        continue;
      }

      if (token === '--subdir') {
        result.subdir = argv[index + 1] || '';
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
    const control = stripPermissionControlTokens(tokens);
    const argv = control.tokens;
    const result = {
      all: false,
      target: 'project',
      force: false,
      match_project: true,
      tools: [],
      families: [],
      devices: [],
      chips: [],
      explicit_confirmation: control.explicit_confirmation
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

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (token === '--all') {
        result.all = true;
        continue;
      }

      if (token === '--to') {
        result.target = argv[index + 1] || '';
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
        pushListValues(result.tools, argv[index + 1], '--tool');
        index += 1;
        continue;
      }

      if (token === '--family') {
        pushListValues(result.families, argv[index + 1], '--family');
        index += 1;
        continue;
      }

      if (token === '--device') {
        pushListValues(result.devices, argv[index + 1], '--device');
        index += 1;
        continue;
      }

      if (token === '--chip') {
        pushListValues(result.chips, argv[index + 1], '--chip');
        index += 1;
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    return result;
  }

  function parseAdapterBootstrapArgs(tokens, fallbackName) {
    const control = stripPermissionControlTokens(tokens);
    const argv = control.tokens;
    const result = {
      name: String(fallbackName || '').trim() || DEFAULT_ADAPTER_SOURCE_NAME,
      explicit_confirmation: control.explicit_confirmation,
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

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (token === '--type') {
        result.source.type = argv[index + 1] || '';
        index += 1;
        if (!result.source.type) {
          throw new Error('Missing value after --type');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--location') {
        result.source.location = argv[index + 1] || '';
        index += 1;
        if (!result.source.location) {
          throw new Error('Missing value after --location');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--branch') {
        result.source.branch = argv[index + 1] || '';
        index += 1;
        if (!result.source.branch) {
          throw new Error('Missing value after --branch');
        }
        result.source_config_provided = true;
        continue;
      }

      if (token === '--subdir') {
        result.source.subdir = argv[index + 1] || '';
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
        result.sync.target = argv[index + 1] || '';
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
        pushListValues(result.sync.tools, argv[index + 1] || '', '--tool');
        index += 1;
        continue;
      }

      if (token === '--family') {
        pushListValues(result.sync.families, argv[index + 1] || '', '--family');
        index += 1;
        continue;
      }

      if (token === '--device') {
        pushListValues(result.sync.devices, argv[index + 1] || '', '--device');
        index += 1;
        continue;
      }

      if (token === '--chip') {
        pushListValues(result.sync.chips, argv[index + 1] || '', '--chip');
        index += 1;
        continue;
      }

      throw new Error(`Unknown argument: ${token}`);
    }

    if (result.name === DEFAULT_ADAPTER_SOURCE_NAME) {
      const defaultSource = getDefaultAdapterSource();
      if (!result.source.type) {
        result.source.type = defaultSource.type;
      }
      if (!result.source.location) {
        result.source.location = defaultSource.location;
      }
      if (!result.source.branch && defaultSource.branch) {
        result.source.branch = defaultSource.branch;
      }
      if (!result.source.subdir && defaultSource.subdir) {
        result.source.subdir = defaultSource.subdir;
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
        chip_support_sources: [],
        executors: {},
        quality_gates: {
          required_executors: [],
          required_signoffs: []
        },
        permissions: {
          default_policy: 'allow',
          require_confirmation_for_high_risk: true,
          tools: {
            allow: [],
            ask: [],
            deny: []
          },
          executors: {
            allow: [],
            ask: [],
            deny: []
          },
          writes: {
            allow: [],
            ask: [],
            deny: []
          }
        },
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

  function buildProjectSetHighRiskClarity(fieldPath) {
    const field = String(fieldPath || '').trim();
    if (!field.startsWith('permissions.')) {
      return null;
    }

    return {
      enabled: true,
      category: 'project-permission-write',
      warning: 'This write updates the project permission policy and can change future execution behavior.',
      requires_explicit_confirmation: true,
      matched_signals: [`field:${field}`],
      confirmation_template: {
        action: `project set --field ${field}`,
        target: '<fill in the exact project policy path being changed>',
        irreversible_impact: '<fill in how this changes tool / executor / write access>',
        prechecks: [
          'Confirm this policy change is intended for the current project only',
          'Confirm deny / ask / allow precedence still matches the intended safety posture',
          'Confirm existing automation will continue to work under the new rule'
        ],
        execute_cli: `<fill in final project set --field ${field} --value ... command>`,
        rollback_plan: '<fill in how to revert the policy if it blocks the wrong path>'
      }
    };
  }

  function buildProjectWritePermissionContext(actionName, explicitConfirmation, options) {
    const settings =
      options && typeof options === 'object' && !Array.isArray(options)
        ? options
        : {};
    const highRiskClarity = settings.high_risk_clarity || null;
    return {
      high_risk_clarity: highRiskClarity,
      permission_decision: permissionGateHelpers.evaluateExecutionPermission({
        action_kind: 'write',
        action_name: actionName,
        risk: settings.risk || (highRiskClarity ? 'high' : 'normal'),
        explicit_confirmation: explicitConfirmation === true,
        permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
      })
    };
  }

  function applyProjectWritePermission(result, permissionContext) {
    const base = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    const context =
      permissionContext && typeof permissionContext === 'object' && !Array.isArray(permissionContext)
        ? permissionContext
        : {};
    const enriched = context.high_risk_clarity
      ? {
          ...base,
          high_risk_clarity: context.high_risk_clarity
        }
      : base;

    return permissionGateHelpers.applyPermissionDecision(enriched, context.permission_decision || null);
  }

  function setProjectConfigValue(fieldPath, rawValue, options) {
    const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const parsedValue = parseProjectValue(rawValue);
    const permissionContext = buildProjectWritePermissionContext('project-set', settings.explicit_confirmation, {
      high_risk_clarity: buildProjectSetHighRiskClarity(fieldPath)
    });
    const blocked = applyProjectWritePermission({
      field: fieldPath,
      value: parsedValue
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));

    assignNestedField(nextConfig, fieldPath, parsedValue);
    const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
    const saved = writeProjectConfig(validated);

    return applyProjectWritePermission({
      path: saved.path,
      field: fieldPath,
      value: selectNestedField(validated, fieldPath),
      config: validated,
      session: saved.session
    }, permissionContext);
  }

  function buildAdapterStatusQuality(projectConfig) {
    let resolved = null;

    try {
      resolved = resolveSession ? resolveSession() : null;
    } catch {
      resolved = null;
    }

    const toolRecommendations =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.tool_recommendations)
        ? resolved.effective.tool_recommendations
        : [];
    const recommendedSources =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.recommended_sources)
        ? resolved.effective.recommended_sources
        : [];

    if (toolRecommendations.length > 0) {
      return {
        mode: 'session-aware',
        ...adapterQualityHelpers.summarizeAdapterHealth(toolRecommendations, recommendedSources)
      };
    }

    const sources = adapterSources.listSourceStatus(ROOT, resolveProjectRoot(), projectConfig);
    const matched = sources
      .flatMap(source => {
        const projectTarget = source && source.targets ? source.targets.project : null;
        const selection = projectTarget && projectTarget.selection ? projectTarget.selection : null;
        const matchedTools = selection && selection.matched && Array.isArray(selection.matched.tools)
          ? selection.matched.tools
          : [];
        return matchedTools;
      })
      .filter(Boolean);

    return {
      mode: 'selection-only',
      status: matched.length > 0 ? 'info' : 'warn',
      summary: matched.length > 0
        ? 'Matched adapter files already exist, but the project side still cannot form a complete trust score.'
        : 'There are still not enough matched adapters available for quality evaluation.',
      matched_tools: runtime.unique(matched)
    };
  }

  function buildAdapterStatus(name) {
    const projectConfig = buildProjectConfigSeed();
    const sources = adapterSources.listSourceStatus(ROOT, resolveProjectRoot(), projectConfig);
    const qualityOverview = buildAdapterStatusQuality(projectConfig);

    if (!name) {
      return {
        project_root: resolveProjectRoot(),
        quality_overview: qualityOverview,
        chip_support_sources: sources
      };
    }

    const matched = sources.find(item => item.name === name);
    if (!matched) {
      throw new Error(`Adapter source not found: ${name}`);
    }

    const projectTarget = matched.targets && matched.targets.project ? matched.targets.project : null;
    const quality = projectTarget && projectTarget.synced
      ? buildAdapterSyncQuality({
          name: matched.name,
          target: 'project',
          selection: projectTarget.selection || null
        })
      : qualityOverview;

    return {
      ...matched,
      quality
    };
  }

  function parseNamedAdapterActionArgs(name, tokens, label) {
    const control = stripPermissionControlTokens([name, ...(Array.isArray(tokens) ? tokens : [])]);
    const sourceName = String(control.tokens[0] || '').trim();

    if (!sourceName) {
      throw new Error(`Missing ${label}`);
    }

    return {
      name: sourceName,
      tokens: control.tokens.slice(1),
      explicit_confirmation: control.explicit_confirmation
    };
  }

  function addAdapterSourceInternal(sourceName, parsed) {
    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
    const nextSource = runtime.validateAdapterSource(
      {
        name: sourceName,
        type: parsed.type,
        location: parsed.location,
        branch: parsed.branch,
        subdir: parsed.subdir,
        enabled: parsed.enabled
      },
      0
    );
    const sources = nextConfig.chip_support_sources || [];
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

  function addAdapterSource(name, tokens) {
    const sourceName = String(name || '').trim();
    if (!sourceName) {
      throw new Error('Missing source name');
    }

    const parsed = parseAdapterSourceAddArgs(tokens);
    const permissionContext = buildProjectWritePermissionContext(
      'support-source-add',
      parsed.explicit_confirmation
    );
    const blocked = applyProjectWritePermission({
      action: 'pending',
      source: {
        name: sourceName,
        type: parsed.type,
        location: parsed.location,
        branch: parsed.branch,
        subdir: parsed.subdir,
        enabled: parsed.enabled
      }
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    return applyProjectWritePermission(
      addAdapterSourceInternal(sourceName, parsed),
      permissionContext
    );
  }

  function removeAdapterSourceInternal(sourceName) {
    const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
    const sources = nextConfig.chip_support_sources || [];
    const existing = sources.find(item => item.name === sourceName);

    if (!existing) {
      throw new Error(`Adapter source not found: ${sourceName}`);
    }

    nextConfig.chip_support_sources = sources.filter(item => item.name !== sourceName);
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

  function removeAdapterSource(name, tokens) {
    const parsed = parseNamedAdapterActionArgs(name, tokens, 'source name');
    const permissionContext = buildProjectWritePermissionContext(
      'support-source-remove',
      parsed.explicit_confirmation
    );
    const sourceName = parsed.name;
    const projectConfig = buildProjectConfigSeed();
    const existing = (projectConfig.chip_support_sources || []).find(item => item.name === sourceName);
    const blocked = applyProjectWritePermission({
      action: 'pending',
      source: existing || { name: sourceName }
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    return applyProjectWritePermission(
      removeAdapterSourceInternal(sourceName),
      permissionContext
    );
  }

  function syncNamedAdapterSourceInternal(name, options) {
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

    const syncResult = adapterSources.syncAdapterSource(ROOT, resolveProjectRoot(), source, options || {});
    return {
      ...syncResult,
      quality: buildAdapterSyncQuality(syncResult)
    };
  }

  function syncNamedAdapterSource(name, options) {
    const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const actionName = settings.target === 'runtime' ? 'support-sync-runtime' : 'support-sync-project';
    const permissionContext = buildProjectWritePermissionContext(
      actionName,
      settings.explicit_confirmation
    );
    const blocked = applyProjectWritePermission({
      source: String(name || '').trim(),
      target: settings.target || 'project',
      sync: {
        force: settings.force === true,
        match_project: settings.match_project !== false,
        tools: settings.tools || [],
        families: settings.families || [],
        devices: settings.devices || [],
        chips: settings.chips || []
      }
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    return applyProjectWritePermission(
      syncNamedAdapterSourceInternal(name, settings),
      permissionContext
    );
  }

  function syncAllAdapterSourcesInternal(options) {
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
      ).map(item => ({
        ...item,
        quality: buildAdapterSyncQuality(item)
      }))
    };
  }

  function syncAllAdapterSources(options) {
    const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const actionName = settings.target === 'runtime' ? 'support-sync-all-runtime' : 'support-sync-all-project';
    const permissionContext = buildProjectWritePermissionContext(
      actionName,
      settings.explicit_confirmation
    );
    const blocked = applyProjectWritePermission({
      target: settings.target || 'project',
      sync: {
        force: settings.force === true,
        match_project: settings.match_project !== false,
        tools: settings.tools || [],
        families: settings.families || [],
        devices: settings.devices || [],
        chips: settings.chips || []
      }
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    return applyProjectWritePermission(
      syncAllAdapterSourcesInternal(settings),
      permissionContext
    );
  }

  function bootstrapAdapterSource(name, tokens) {
    const sourceName = String(name || '').trim();
    const parsed = parseAdapterBootstrapArgs(tokens || [], sourceName);
    const actionName = parsed.sync.target === 'runtime' ? 'support-bootstrap-runtime' : 'support-bootstrap-project';
    const permissionContext = buildProjectWritePermissionContext(
      actionName,
      parsed.explicit_confirmation
    );
    const blocked = applyProjectWritePermission({
      action: 'pending',
      source: {
        name: parsed.name,
        type: parsed.source.type,
        location: parsed.source.location,
        branch: parsed.source.branch,
        subdir: parsed.source.subdir,
        enabled: parsed.source.enabled
      },
      sync: {
        target: parsed.sync.target || 'project',
        force: parsed.sync.force === true,
        match_project: parsed.sync.match_project !== false,
        tools: parsed.sync.tools || [],
        families: parsed.sync.families || [],
        devices: parsed.sync.devices || [],
        chips: parsed.sync.chips || []
      }
    }, permissionContext);

    if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
      return blocked;
    }

    initProjectLayout();
    const projectConfig = buildProjectConfigSeed();
    const existing = adapterSources.findSource(projectConfig, parsed.name);
    let sourceResult = null;

    if (!existing || parsed.source_config_provided) {
      if (!parsed.source.type || !parsed.source.location) {
        throw new Error(`Missing source config for chip support install: ${parsed.name}`);
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

      sourceResult = addAdapterSourceInternal(parsed.name, parseAdapterSourceAddArgs(addTokens));
    }

    return applyProjectWritePermission({
      action: 'bootstrapped',
      source_action: sourceResult ? sourceResult.action : 'existing',
      source: sourceResult ? sourceResult.source : existing,
      sync: syncNamedAdapterSourceInternal(parsed.name, parsed.sync)
    }, permissionContext);
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
