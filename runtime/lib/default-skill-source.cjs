'use strict';

const DEFAULT_SKILL_SOURCE_TYPE = 'git';
const DEFAULT_SKILL_SOURCE_LOCATION = 'https://github.com/Welkon/emb-support.git';
const DEFAULT_SKILL_SOURCE_SUBDIR = 'skills';

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
    !runtimeConfig.default_skill_source ||
    typeof runtimeConfig.default_skill_source !== 'object' ||
    Array.isArray(runtimeConfig.default_skill_source)
  ) {
    return {};
  }

  return runtimeConfig.default_skill_source;
}

function resolveDefaultSkillSource(runtimeConfig, env) {
  const config = readConfigObject(runtimeConfig);
  const type =
    readEnvString(env, 'EMB_AGENT_DEFAULT_SKILL_SOURCE_TYPE') ||
    String(config.type || '').trim() ||
    DEFAULT_SKILL_SOURCE_TYPE;
  const location =
    readEnvString(env, 'EMB_AGENT_DEFAULT_SKILL_SOURCE_LOCATION') ||
    String(config.location || '').trim() ||
    DEFAULT_SKILL_SOURCE_LOCATION;
  const branch =
    readEnvString(env, 'EMB_AGENT_DEFAULT_SKILL_SOURCE_BRANCH') ||
    String(config.branch || '').trim();
  const subdir =
    readEnvString(env, 'EMB_AGENT_DEFAULT_SKILL_SOURCE_SUBDIR') ||
    String(config.subdir || '').trim() ||
    DEFAULT_SKILL_SOURCE_SUBDIR;

  return {
    type,
    location,
    branch,
    subdir
  };
}

function buildSkillSourceInstallArgv(source) {
  const resolved = source || resolveDefaultSkillSource(null, null);
  const argv = [resolved.location];

  if (resolved.branch) {
    argv.push('--branch', resolved.branch);
  }
  if (resolved.subdir) {
    argv.push('--subdir', resolved.subdir);
  }

  return argv;
}

module.exports = {
  DEFAULT_SKILL_SOURCE_TYPE,
  DEFAULT_SKILL_SOURCE_LOCATION,
  DEFAULT_SKILL_SOURCE_SUBDIR,
  buildSkillSourceInstallArgv,
  resolveDefaultSkillSource
};
