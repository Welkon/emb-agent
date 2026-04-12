'use strict';

const DEFAULT_ADAPTER_SOURCE_NAME = 'default-pack';
const DEFAULT_ADAPTER_SOURCE_TYPE = 'git';
const DEFAULT_ADAPTER_SOURCE_LOCATION = 'https://github.com/Welkon/emb-agent-adapters.git';

function readEnvString(env, key) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return '';
  }

  return String(env[key] || '').trim();
}

function readConfigObject(runtimeConfig) {
  if (
    !runtimeConfig ||
    typeof runtimeConfig !== 'object' ||
    Array.isArray(runtimeConfig) ||
    !runtimeConfig.default_adapter_source ||
    typeof runtimeConfig.default_adapter_source !== 'object' ||
    Array.isArray(runtimeConfig.default_adapter_source)
  ) {
    return {};
  }

  return runtimeConfig.default_adapter_source;
}

function resolveDefaultAdapterSource(runtimeConfig, env) {
  const config = readConfigObject(runtimeConfig);
  const type = readEnvString(env, 'EMB_AGENT_DEFAULT_ADAPTER_SOURCE_TYPE') || String(config.type || '').trim() || DEFAULT_ADAPTER_SOURCE_TYPE;
  const location =
    readEnvString(env, 'EMB_AGENT_DEFAULT_ADAPTER_SOURCE_LOCATION') ||
    String(config.location || '').trim() ||
    DEFAULT_ADAPTER_SOURCE_LOCATION;
  const branch = readEnvString(env, 'EMB_AGENT_DEFAULT_ADAPTER_SOURCE_BRANCH') || String(config.branch || '').trim();
  const subdir = readEnvString(env, 'EMB_AGENT_DEFAULT_ADAPTER_SOURCE_SUBDIR') || String(config.subdir || '').trim();

  return {
    name: DEFAULT_ADAPTER_SOURCE_NAME,
    type,
    location,
    branch,
    subdir
  };
}

function buildDefaultAdapterSourceArgs(source) {
  const resolved = source || resolveDefaultAdapterSource(null, null);
  const args = ['--type', resolved.type, '--location', resolved.location];

  if (resolved.branch) {
    args.push('--branch', resolved.branch);
  }
  if (resolved.subdir) {
    args.push('--subdir', resolved.subdir);
  }

  return args;
}

module.exports = {
  DEFAULT_ADAPTER_SOURCE_NAME,
  DEFAULT_ADAPTER_SOURCE_TYPE,
  DEFAULT_ADAPTER_SOURCE_LOCATION,
  buildDefaultAdapterSourceArgs,
  resolveDefaultAdapterSource
};
