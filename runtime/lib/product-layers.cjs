'use strict';

const PRODUCT_LAYERS = {
  embedded_workflow: {
    id: 'embedded_workflow',
    label: 'Embedded workflow',
    summary: 'Project truth, task/session flow, and scan/plan/do/review/verify closure.'
  },
  chip_support: {
    id: 'chip_support',
    label: 'Chip support',
    summary: 'Chip profiles, formulas, adapter bindings, tool routes, and firmware snippet artifacts.'
  },
  knowledge_synthesis: {
    id: 'knowledge_synthesis',
    label: 'Knowledge synthesis',
    summary: 'Persistent wiki, formula registry, graph navigation, and source-derived evidence.'
  },
  support_layer: {
    id: 'support_layer',
    label: 'Support layer',
    summary: 'Skills, scaffolds, workflow authoring, memory, and reusable host surfaces.'
  },
  host_integration: {
    id: 'host_integration',
    label: 'Host integration',
    summary: 'External protocol, dispatch/orchestration, hooks, settings, and sub-agent bridge execution.'
  }
};

function normalizeCommand(value) {
  return String(value || '').trim().toLowerCase();
}

function selectProductLayer(command) {
  const normalized = normalizeCommand(command);
  const first = normalized.split(/\s+/u)[0] || '';

  if (
    first === 'knowledge' ||
    normalized.startsWith('knowledge graph') ||
    normalized.startsWith('knowledge formula')
  ) {
    return PRODUCT_LAYERS.knowledge_synthesis;
  }

  if (
    ['tool', 'chip', 'support', 'adapter', 'snippet', 'schematic', 'board', 'doc', 'component'].includes(first)
  ) {
    return PRODUCT_LAYERS.chip_support;
  }

  if (
    ['dispatch', 'orchestrate', 'external', 'settings'].includes(first) ||
    normalized.includes('subagent') ||
    normalized.includes('sub-agent')
  ) {
    return PRODUCT_LAYERS.host_integration;
  }

  if (
    ['skills', 'skill', 'scaffold', 'workflow', 'memory', 'prefs', 'config', 'update', 'commands', 'help'].includes(first)
  ) {
    return PRODUCT_LAYERS.support_layer;
  }

  return PRODUCT_LAYERS.embedded_workflow;
}

function summarizeProductLayer(command) {
  const layer = selectProductLayer(command);
  return {
    id: layer.id,
    label: layer.label,
    summary: layer.summary
  };
}

function listProductLayers() {
  return Object.values(PRODUCT_LAYERS).map(layer => ({ ...layer }));
}

module.exports = {
  PRODUCT_LAYERS,
  listProductLayers,
  selectProductLayer,
  summarizeProductLayer
};
