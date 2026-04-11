'use strict';

function createSettingsCommandHelpers(deps) {
  const {
    runtime,
    RUNTIME_CONFIG,
    getRuntimeHost,
    loadSession,
    updateSession,
    loadProfile,
    loadPack,
    getProjectConfig
  } = deps;

  function buildDefaults() {
    return runtime.mergeRuntimeDefaults(RUNTIME_CONFIG, getProjectConfig());
  }

  function buildSettingsView() {
    const session = loadSession();
    const defaults = buildDefaults();
    const runtimeHost = typeof getRuntimeHost === 'function' ? getRuntimeHost() : { name: '', label: '', subagentBridge: {} };

    return {
      settings: {
        profile: session.project_profile,
        packs: session.active_packs || [],
        preferences: runtime.normalizePreferences(session.preferences || {}, defaults)
      },
      host: {
        runtime_host: runtimeHost.name || '',
        runtime_label: runtimeHost.label || '',
        subagent_bridge: runtimeHost.subagentBridge || null
      },
      defaults: {
        profile: defaults.default_profile,
        packs: defaults.default_packs || [],
        preferences: runtime.normalizePreferences({}, defaults)
      }
    };
  }

  function setProfile(profileName) {
    loadProfile(profileName);
    return updateSession(current => {
      current.project_profile = profileName;
    });
  }

  function setPacks(rawValue) {
    const packs = String(rawValue || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    packs.forEach(loadPack);

    return updateSession(current => {
      current.active_packs = runtime.unique(packs);
    });
  }

  function setPreference(key, value) {
    return updateSession(current => {
      current.preferences = runtime.normalizePreferences(
        {
          ...(current.preferences || {}),
          [key]: value
        },
        RUNTIME_CONFIG
      );
    });
  }

  function resetSettings() {
    const defaults = buildDefaults();

    return updateSession(current => {
      current.project_profile = defaults.default_profile;
      current.active_packs = runtime.unique(defaults.default_packs || []);
      current.preferences = runtime.normalizePreferences({}, defaults);
    });
  }

  function handleSettingsCommands(cmd, subcmd, rest) {
    if (cmd !== 'settings') {
      return undefined;
    }

    if (!subcmd || subcmd === 'show') {
      return buildSettingsView();
    }

    if (subcmd === 'reset') {
      resetSettings();
      return buildSettingsView();
    }

    if (subcmd === 'set') {
      if (!rest[0]) throw new Error('Missing settings key');
      if (!rest[1]) throw new Error('Missing settings value');

      const key = rest[0];
      const value = rest.slice(1).join(' ').trim();

      if (key === 'profile') {
        setProfile(value);
        return buildSettingsView();
      }

      if (key === 'packs') {
        setPacks(value);
        return buildSettingsView();
      }

      if (['truth_source_mode', 'plan_mode', 'review_mode', 'verification_mode'].includes(key)) {
        setPreference(key, value);
        return buildSettingsView();
      }

      throw new Error(`Unknown settings key: ${key}`);
    }

    throw new Error(`Unknown settings subcommand: ${subcmd}`);
  }

  return {
    buildSettingsView,
    handleSettingsCommands
  };
}

module.exports = {
  createSettingsCommandHelpers
};
