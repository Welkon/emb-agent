'use strict';

const DEFAULT_WORKFLOW_SOURCE_TYPE = 'git';
const DEFAULT_WORKFLOW_SOURCE_LOCATION = 'https://github.com/Welkon/emb-support.git';
const DEFAULT_WORKFLOW_SOURCE_SUBDIR = 'specs';

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
    !runtimeConfig.default_workflow_source ||
    typeof runtimeConfig.default_workflow_source !== 'object' ||
    Array.isArray(runtimeConfig.default_workflow_source)
  ) {
    return {};
  }

  return runtimeConfig.default_workflow_source;
}

function resolveDefaultWorkflowSource(runtimeConfig, env) {
  const config = readConfigObject(runtimeConfig);
  const type =
    readEnvString(env, 'EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE') ||
    String(config.type || '').trim() ||
    DEFAULT_WORKFLOW_SOURCE_TYPE;
  const location =
    readEnvString(env, 'EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION') ||
    String(config.location || '').trim() ||
    DEFAULT_WORKFLOW_SOURCE_LOCATION;
  const branch =
    readEnvString(env, 'EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH') ||
    String(config.branch || '').trim();
  const subdir =
    readEnvString(env, 'EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR') ||
    String(config.subdir || '').trim() ||
    DEFAULT_WORKFLOW_SOURCE_SUBDIR;

  return {
    type,
    location,
    branch,
    subdir
  };
}

module.exports = {
  DEFAULT_WORKFLOW_SOURCE_TYPE,
  DEFAULT_WORKFLOW_SOURCE_LOCATION,
  DEFAULT_WORKFLOW_SOURCE_SUBDIR,
  resolveDefaultWorkflowSource
};
