'use strict';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'true', 'yes', 'y', 'on', 'trusted'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off', 'untrusted'].includes(normalized)) {
    return false;
  }

  return null;
}

function resolveTrustSignal(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const candidates = [
    source.workspace_trusted,
    source.workspaceTrusted,
    source.trusted,
    source.is_trusted,
    source.isTrusted,
    source.trust_established,
    source.trustEstablished,
    source.workspace && source.workspace.trusted,
    source.workspace && source.workspace.is_trusted,
    source.workspace && source.workspace.isTrusted,
    source.security && source.security.workspace_trusted,
    source.security && source.security.trusted
  ];

  for (const candidate of candidates) {
    const parsed = parseBoolean(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function isWorkspaceTrusted(input, env) {
  return resolveWorkspaceTrust(input, env, arguments[2]).trusted;
}

function hasEnabledCodexHooks(content) {
  return (
    /^\s*(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(String(content || '')) ||
    /^\s*features\.(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(String(content || ''))
  );
}

function hasCodexHookCommand(content, eventName, hookFileName) {
  const eventPattern = new RegExp(`\\bevent\\s*=\\s*["']${escapeRegex(eventName)}["']`);
  const commandPattern = new RegExp(`\\bcommand\\s*=\\s*["'][^"'\\r\\n]*${escapeRegex(hookFileName)}[^"'\\r\\n]*["']`);
  const blocks = String(content || '').split(/\[\[hooks\]\]/u).slice(1);

  return blocks.some(block => eventPattern.test(block) && commandPattern.test(block));
}

function hasClaudeHookCommand(settings, eventName, hookFileName) {
  const entries =
    settings &&
    settings.hooks &&
    typeof settings.hooks === 'object' &&
    !Array.isArray(settings.hooks)
      ? settings.hooks[eventName]
      : null;

  return Array.isArray(entries) && entries.some(entry =>
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some(hook =>
      hook &&
      typeof hook.command === 'string' &&
      hook.command.includes(hookFileName)
      )
  );
}

function hasCursorHookCommand(settings, eventName, hookFileName) {
  const entries =
    settings &&
    settings.hooks &&
    typeof settings.hooks === 'object' &&
    !Array.isArray(settings.hooks)
      ? settings.hooks[eventName]
      : null;

  return Array.isArray(entries) && entries.some(entry => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    if (typeof entry.command === 'string' && entry.command.includes(hookFileName)) {
      return true;
    }
    if (Array.isArray(entry.hooks)) {
      return entry.hooks.some(hook =>
        hook &&
        typeof hook.command === 'string' &&
        hook.command.includes(hookFileName)
      );
    }
    return false;
  });
}

function resolveHostConfigTrust(options) {
  const fs = options && options.fs;
  const path = options && options.path;
  const runtimeHost = options && options.runtimeHost;

  if (!fs || !path || !runtimeHost || !runtimeHost.runtimeHome || !runtimeHost.configFileName) {
    return null;
  }

  const configPath = path.join(runtimeHost.runtimeHome, runtimeHost.configFileName);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    if (runtimeHost.name === 'codex') {
      const content = fs.readFileSync(configPath, 'utf8');
      const hooksEnabled =
        hasEnabledCodexHooks(content) &&
        hasCodexHookCommand(content, 'SessionStart', 'emb-session-start.js') &&
        hasCodexHookCommand(content, 'PostToolUse', 'emb-context-monitor.js');

      if (!hooksEnabled) {
        return null;
      }

      return {
        trusted: true,
        explicit: true,
        source: 'host-config',
        signal: 'hooks-enabled',
        summary: 'Codex host startup automation is available; emb-agent can continue automatic bootstrap steps'
      };
    }

    if (runtimeHost.name === 'claude') {
      const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const hooksEnabled =
        hasClaudeHookCommand(settings, 'SessionStart', 'emb-session-start.js') &&
        hasClaudeHookCommand(settings, 'PostToolUse', 'emb-context-monitor.js');

      if (!hooksEnabled) {
        return null;
      }

      return {
        trusted: true,
        explicit: true,
        source: 'host-config',
        signal: 'hooks-enabled',
        summary: 'Claude Code startup automation is available; emb-agent can continue automatic bootstrap steps'
      };
    }

    if (runtimeHost.name === 'cursor') {
      const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const hooksEnabled =
        hasCursorHookCommand(settings, 'SessionStart', 'emb-session-start.js') &&
        hasCursorHookCommand(settings, 'PostToolUse', 'emb-context-monitor.js');

      if (!hooksEnabled) {
        return null;
      }

      return {
        trusted: true,
        explicit: true,
        source: 'host-config',
        signal: 'hooks-enabled',
        summary: 'Cursor startup automation is available; emb-agent can continue automatic bootstrap steps'
      };
    }
  } catch {
    return null;
  }

  return null;
}

function resolveWorkspaceTrust(input, env, options) {
  const environment = env || process.env;
  const forced = parseBoolean(
    environment.EMB_AGENT_FORCE_WORKSPACE_TRUST ||
    environment.EMB_AGENT_WORKSPACE_TRUST
  );
  if (forced !== null) {
    return {
      trusted: forced,
      explicit: true,
      source: 'env',
      signal: forced ? 'trusted' : 'untrusted',
      summary: forced
        ? 'Automatic startup is explicitly enabled by environment override'
        : 'Automatic startup is explicitly disabled by environment override'
    };
  }

  const payloadSignal = resolveTrustSignal(input);
  if (payloadSignal !== null) {
    return {
      trusted: payloadSignal,
      explicit: true,
      source: 'payload',
      signal: payloadSignal ? 'trusted' : 'untrusted',
      summary: payloadSignal
        ? 'The current host session provided automatic-startup access'
        : 'The current host session withheld automatic-startup access'
    };
  }

  const hostConfigTrust = resolveHostConfigTrust(options);
  if (hostConfigTrust) {
    return hostConfigTrust;
  }

  return {
    trusted: false,
    explicit: false,
    source: 'default',
    signal: 'untrusted-no-signal',
    summary: 'The current host session is not ready for automatic startup yet; automatic bootstrap steps stay paused by default'
  };
}

module.exports = {
  hasClaudeHookCommand,
  hasCodexHookCommand,
  hasCursorHookCommand,
  hasEnabledCodexHooks,
  isWorkspaceTrusted,
  parseBoolean,
  resolveTrustSignal,
  resolveHostConfigTrust,
  resolveWorkspaceTrust
};
