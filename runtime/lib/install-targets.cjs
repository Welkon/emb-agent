'use strict';

function createInstallTargets(deps) {
  const { os, path, process } = deps;
  const managedRuntimePathPatterns = [
    /~\/\.(?:codex|claude|cursor)\/emb-agent\//g,
    /\$HOME\/\.(?:codex|claude|cursor)\/emb-agent\//g,
    /\.\/\.(?:codex|claude|cursor)\/emb-agent\//g
  ];

  const targetDefs = {
    codex: {
      order: 1,
      name: 'codex',
      label: 'Codex',
      supported: true,
      localDirName: '.codex',
      defaultGlobalDirParts: ['.codex'],
      globalEnvVar: 'CODEX_HOME',
      runtimeDirName: 'emb-agent',
      agentsDirName: 'agents',
      configFileName: 'config.toml',
      hooksConfigFileName: 'hooks.json',
      agentLabel: 'Codex agents',
      restartLabel: 'Codex',
      agentMode: 'codex-toml',
      hookMode: 'codex-json',
      managedRuntimePathPatterns: managedRuntimePathPatterns.slice()
    },
    claude: {
      order: 2,
      name: 'claude',
      label: 'Claude Code',
      supported: true,
      localDirName: '.claude',
      defaultGlobalDirParts: ['.claude'],
      globalEnvVar: 'CLAUDE_CONFIG_DIR',
      runtimeDirName: 'emb-agent',
      agentsDirName: 'agents',
      configFileName: 'settings.json',
      agentLabel: 'Claude agents',
      restartLabel: 'Claude Code',
      agentMode: 'markdown',
      hookMode: 'claude-settings',
      managedRuntimePathPatterns: managedRuntimePathPatterns.slice()
    },
    cursor: {
      order: 3,
      name: 'cursor',
      label: 'Cursor',
      supported: true,
      localDirName: '.cursor',
      defaultGlobalDirParts: ['.cursor'],
      globalEnvVar: 'CURSOR_CONFIG_DIR',
      runtimeDirName: 'emb-agent',
      agentsDirName: 'agents',
      configFileName: 'settings.json',
      agentLabel: 'Cursor agents',
      restartLabel: 'Cursor',
      agentMode: 'markdown',
      hookMode: 'cursor-settings',
      managedRuntimePathPatterns: managedRuntimePathPatterns.slice()
    },
    windsurf: {
      order: 40,
      name: 'windsurf',
      label: 'Windsurf',
      supported: false,
      notSupportedReason: 'installer target adapter is not implemented yet',
      localDirName: '.windsurf',
      defaultGlobalDirParts: ['.windsurf'],
      globalEnvVar: 'WINDSURF_CONFIG_DIR',
      runtimeDirName: 'emb-agent'
    },
    gemini: {
      order: 50,
      name: 'gemini',
      label: 'Gemini',
      supported: false,
      notSupportedReason: 'installer target adapter is not implemented yet',
      localDirName: '.gemini',
      defaultGlobalDirParts: ['.gemini'],
      globalEnvVar: 'GEMINI_CONFIG_DIR',
      runtimeDirName: 'emb-agent'
    },
    copilot: {
      order: 60,
      name: 'copilot',
      label: 'Copilot',
      supported: false,
      notSupportedReason: 'installer target adapter is not implemented yet',
      localDirName: '.github',
      defaultGlobalDirParts: ['.copilot'],
      globalEnvVar: 'COPILOT_CONFIG_DIR',
      runtimeDirName: 'emb-agent'
    },
    augment: {
      order: 70,
      name: 'augment',
      label: 'Augment',
      supported: false,
      notSupportedReason: 'installer target adapter is not implemented yet',
      localDirName: '.augment',
      defaultGlobalDirParts: ['.augment'],
      globalEnvVar: 'AUGMENT_CONFIG_DIR',
      runtimeDirName: 'emb-agent'
    }
  };

  function listInstallTargets() {
    return Object.values(targetDefs).map(target => ({ ...target }));
  }

  function getInstallTarget(name) {
    const key = String(name || 'codex').trim().toLowerCase();
    return targetDefs[key] ? { ...targetDefs[key] } : null;
  }

  function resolveInstallTarget(name) {
    const target = getInstallTarget(name);

    if (!target) {
      throw new Error(`Unknown runtime target: ${name}`);
    }

    return target;
  }

  function resolveTargetDir(target, options) {
    const args = options || {};

    if (args.configDir) {
      return path.resolve(args.configDir);
    }

    if (args.local) {
      return path.join(process.cwd(), target.localDirName);
    }

    if (target.globalEnvVar && process.env[target.globalEnvVar]) {
      return path.resolve(process.env[target.globalEnvVar]);
    }

    return path.join(os.homedir(), ...(target.defaultGlobalDirParts || [target.localDirName]));
  }

  function getManagedRuntimePathPatterns(target) {
    return Array.isArray(target.managedRuntimePathPatterns)
      ? target.managedRuntimePathPatterns.slice()
      : [];
  }

  return {
    listInstallTargets,
    getInstallTarget,
    resolveInstallTarget,
    resolveTargetDir,
    getManagedRuntimePathPatterns
  };
}

module.exports = {
  createInstallTargets
};
