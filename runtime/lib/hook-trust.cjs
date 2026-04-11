'use strict';

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
  return resolveWorkspaceTrust(input, env).trusted;
}

function resolveWorkspaceTrust(input, env) {
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
        ? 'Workspace trust is explicitly enabled by environment override'
        : 'Workspace trust is explicitly disabled by environment override'
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
        ? 'Workspace trust is provided by the host hook payload'
        : 'Workspace trust is withheld by the host hook payload'
    };
  }

  return {
    trusted: true,
    explicit: false,
    source: 'default',
    signal: 'assumed-trusted',
    summary: 'No explicit workspace trust signal was provided; runtime assumes trusted by default'
  };
}

module.exports = {
  isWorkspaceTrusted,
  parseBoolean,
  resolveTrustSignal,
  resolveWorkspaceTrust
};
