'use strict';

const DEFAULT_ADAPTER_SOURCE_NAME = 'default-support';
const DEFAULT_ADAPTER_SOURCE_TYPE = 'git';
const DEFAULT_ADAPTER_SOURCE_LOCATION = 'https://github.com/Welkon/emb-support.git';
const DEFAULT_ADAPTER_SOURCE_SUBDIR = 'adapters';

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
    !runtimeConfig.default_chip_support_source ||
    typeof runtimeConfig.default_chip_support_source !== 'object' ||
    Array.isArray(runtimeConfig.default_chip_support_source)
  ) {
    return {};
  }

  return runtimeConfig.default_chip_support_source;
}

function resolveDefaultAdapterSource(runtimeConfig, env) {
  const config = readConfigObject(runtimeConfig);
  const type = readEnvString(env, 'EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_TYPE') || String(config.type || '').trim() || DEFAULT_ADAPTER_SOURCE_TYPE;
  const location =
    readEnvString(env, 'EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION') ||
    String(config.location || '').trim() ||
    DEFAULT_ADAPTER_SOURCE_LOCATION;
  const branch = readEnvString(env, 'EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_BRANCH') || String(config.branch || '').trim();
  const subdir =
    readEnvString(env, 'EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_SUBDIR') ||
    String(config.subdir || '').trim() ||
    DEFAULT_ADAPTER_SOURCE_SUBDIR;

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
  DEFAULT_ADAPTER_SOURCE_SUBDIR,
  buildDefaultAdapterSourceArgs,
  resolveDefaultAdapterSource
};
