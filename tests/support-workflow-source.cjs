'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const supportLayout = require(path.join(repoRoot, 'runtime', 'lib', 'support-layout.cjs'));
const workflowImportHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-import.cjs'));
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));

const supportSourceRoot = path.join(repoRoot, 'tests', 'fixtures', 'emb-support');
const workflowSourceRoot = supportSourceRoot;
const workflowImport = workflowImportHelpers.createWorkflowImportHelpers({
  childProcess,
  fs,
  os,
  path,
  process,
  runtime,
  workflowRegistry
});

function withSupportSourceEnv(run) {
  const previous = {
    supportRoot: process.env[supportLayout.SOURCE_SUPPORT_ROOT_ENV_KEY],
    type: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE,
    location: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION,
    branch: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH,
    subdir: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR
  };

  process.env[supportLayout.SOURCE_SUPPORT_ROOT_ENV_KEY] = supportSourceRoot;
  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE = 'path';
  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION = workflowSourceRoot;
  delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH;
  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR = 'specs';

  function restore() {
    if (previous.supportRoot === undefined) {
      delete process.env[supportLayout.SOURCE_SUPPORT_ROOT_ENV_KEY];
    } else {
      process.env[supportLayout.SOURCE_SUPPORT_ROOT_ENV_KEY] = previous.supportRoot;
    }

    if (previous.type === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE;
    } else {
      process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE = previous.type;
    }

    if (previous.location === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION;
    } else {
      process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION = previous.location;
    }

    if (previous.branch === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH;
    } else {
      process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH = previous.branch;
    }

    if (previous.subdir === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR;
    } else {
      process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR = previous.subdir;
    }
  }

  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function withDefaultWorkflowSourceEnv(run) {
  return withSupportSourceEnv(run);
}

function importSupportWorkflowRegistry(projectRoot, options = {}) {
  return workflowImport.importProjectWorkflowRegistry(projectRoot, workflowSourceRoot, {
    subdir: 'specs',
    ...options
  });
}

module.exports = {
  supportSourceRoot,
  workflowSourceRoot,
  withSupportSourceEnv,
  withDefaultWorkflowSourceEnv,
  importSupportWorkflowRegistry
};
