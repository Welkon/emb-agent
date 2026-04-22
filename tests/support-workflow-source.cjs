'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const workflowImportHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-import.cjs'));
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));

const workflowSourceRoot = path.join(repoRoot, 'tests', 'fixtures', 'emb-support');
const workflowImport = workflowImportHelpers.createWorkflowImportHelpers({
  childProcess,
  fs,
  os,
  path,
  process,
  runtime,
  workflowRegistry
});

function withDefaultWorkflowSourceEnv(run) {
  const previous = {
    type: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE,
    location: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION,
    branch: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH,
    subdir: process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR
  };

  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_TYPE = 'path';
  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_LOCATION = workflowSourceRoot;
  delete process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_BRANCH;
  process.env.EMB_AGENT_DEFAULT_WORKFLOW_SOURCE_SUBDIR = 'workflows';

  function restore() {
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

function importSupportWorkflowRegistry(projectRoot, options = {}) {
  return workflowImport.importProjectWorkflowRegistry(projectRoot, workflowSourceRoot, {
    subdir: 'workflows',
    ...options
  });
}

module.exports = {
  workflowSourceRoot,
  withDefaultWorkflowSourceEnv,
  importSupportWorkflowRegistry
};
