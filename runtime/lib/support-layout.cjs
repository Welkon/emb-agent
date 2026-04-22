'use strict';

const fs = require('fs');
const path = require('path');

const runtimeHost = require('./runtime-host.cjs');

const SOURCE_SUPPORT_DIRNAME = 'emb-support';
const SOURCE_SKILLS_DIRNAME = 'skills';
const SOURCE_SPECS_DIRNAME = 'specs';
const SOURCE_ADAPTERS_DIRNAME = 'adapters';
const SOURCE_SUPPORT_ROOT_ENV_KEY = 'EMB_AGENT_SOURCE_SUPPORT_ROOT';

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSourceLayout(runtimeRoot) {
  return runtimeHost.isSourceRuntimeLayout(path.resolve(runtimeRoot));
}

function resolveSourceRepoRoot(runtimeRoot) {
  return path.resolve(runtimeRoot, '..');
}

function resolveSourceWorkspaceRoot(runtimeRoot) {
  return path.resolve(runtimeRoot, '..', '..');
}

function resolveEnvSupportRoot(env) {
  const candidate = String((env || process.env)[SOURCE_SUPPORT_ROOT_ENV_KEY] || '').trim();
  return candidate ? path.resolve(candidate) : '';
}

function resolveSiblingSupportRoot(runtimeRoot) {
  return path.join(resolveSourceWorkspaceRoot(runtimeRoot), SOURCE_SUPPORT_DIRNAME);
}

function resolvePreferredSourceSupportRoot(runtimeRoot, env) {
  const envRoot = resolveEnvSupportRoot(env);
  if (envRoot) {
    return envRoot;
  }

  const siblingRoot = resolveSiblingSupportRoot(runtimeRoot);
  if (pathExists(siblingRoot)) {
    return siblingRoot;
  }

  return '';
}

function resolveBuiltInSupportRoot(runtimeRoot) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  if (!isSourceLayout(resolvedRuntimeRoot)) {
    return resolvedRuntimeRoot;
  }

  const sourceSupportRoot = resolvePreferredSourceSupportRoot(resolvedRuntimeRoot);
  if (sourceSupportRoot) {
    return sourceSupportRoot;
  }

  return resolvedRuntimeRoot;
}

function resolveBuiltInDisplayRoot(runtimeRoot, env) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  if (!isSourceLayout(resolvedRuntimeRoot)) {
    return resolvedRuntimeRoot;
  }

  const envRoot = resolveEnvSupportRoot(env);
  if (envRoot) {
    return path.dirname(envRoot);
  }

  const siblingRoot = resolveSiblingSupportRoot(resolvedRuntimeRoot);
  if (pathExists(siblingRoot)) {
    return path.dirname(siblingRoot);
  }

  return resolveSourceRepoRoot(resolvedRuntimeRoot);
}

function resolveBuiltInSkillsDir(runtimeRoot) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  if (!isSourceLayout(resolvedRuntimeRoot)) {
    return path.join(resolvedRuntimeRoot, SOURCE_SKILLS_DIRNAME);
  }

  const sourceSupportRoot = resolvePreferredSourceSupportRoot(resolvedRuntimeRoot);
  if (sourceSupportRoot) {
    return path.join(sourceSupportRoot, SOURCE_SKILLS_DIRNAME);
  }

  return path.join(resolveSourceRepoRoot(resolvedRuntimeRoot), SOURCE_SKILLS_DIRNAME);
}

function resolveBuiltInSpecsDir(runtimeRoot) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  if (!isSourceLayout(resolvedRuntimeRoot)) {
    return path.join(resolvedRuntimeRoot, SOURCE_SPECS_DIRNAME);
  }

  const sourceSupportRoot = resolvePreferredSourceSupportRoot(resolvedRuntimeRoot);
  if (sourceSupportRoot) {
    return path.join(sourceSupportRoot, SOURCE_SPECS_DIRNAME);
  }

  return path.join(resolvedRuntimeRoot, SOURCE_SPECS_DIRNAME);
}

function resolveBuiltInAdaptersDir(runtimeRoot) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  if (!isSourceLayout(resolvedRuntimeRoot)) {
    return path.join(resolvedRuntimeRoot, SOURCE_ADAPTERS_DIRNAME);
  }

  const sourceSupportRoot = resolvePreferredSourceSupportRoot(resolvedRuntimeRoot);
  if (sourceSupportRoot) {
    return path.join(sourceSupportRoot, SOURCE_ADAPTERS_DIRNAME);
  }

  return path.join(resolveSourceRepoRoot(resolvedRuntimeRoot), SOURCE_ADAPTERS_DIRNAME);
}

module.exports = {
  SOURCE_SUPPORT_DIRNAME,
  SOURCE_SKILLS_DIRNAME,
  SOURCE_SPECS_DIRNAME,
  SOURCE_ADAPTERS_DIRNAME,
  SOURCE_SUPPORT_ROOT_ENV_KEY,
  isSourceLayout,
  resolveBuiltInDisplayRoot,
  resolveSourceRepoRoot,
  resolveSourceWorkspaceRoot,
  resolveBuiltInSupportRoot,
  resolveBuiltInSkillsDir,
  resolveBuiltInSpecsDir,
  resolveBuiltInAdaptersDir
};
