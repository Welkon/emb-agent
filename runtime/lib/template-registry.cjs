'use strict';

const path = require('path');
const workflowRegistry = require('./workflow-registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATE_CONFIG = workflowRegistry.buildTemplateConfigMap(
  workflowRegistry.loadWorkflowRegistry(ROOT),
  { runtimeTemplatesDir: TEMPLATES_DIR }
);


module.exports = {
  ROOT,
  TEMPLATES_DIR,
  TEMPLATE_CONFIG
};
