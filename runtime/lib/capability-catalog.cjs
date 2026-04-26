'use strict';

const CAPABILITY_DEFINITIONS = [
  {
    name: 'scan',
    title: 'Scan',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'scan',
    scheduler_builder: 'buildScanOutput',
    orchestratable: true,
    materializable: true,
    description: 'Lock the real change surface, truth sources, and unresolved questions before mutation.',
    materialization: {
      spec_name: 'capability-scan',
      spec_title: 'Scan Capability',
      template_name: 'scan-workflow',
      default_output: 'docs/workflows/scan.md',
      summary: 'Project-local workflow guidance for scan.',
      focus_areas: ['truth-source-localization', 'change-surface-discovery'],
      review_axes: [],
      preferred_notes: ['docs/workflows/scan.md'],
      default_agents: []
    }
  },
  {
    name: 'plan',
    title: 'Plan',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'plan',
    scheduler_builder: 'buildPlanOutput',
    orchestratable: true,
    materializable: true,
    description: 'Lock truth, constraints, and the smallest durable execution order before mutation.',
    materialization: {
      spec_name: 'capability-plan',
      spec_title: 'Plan Capability',
      template_name: 'plan-workflow',
      default_output: 'docs/workflows/plan.md',
      summary: 'Project-local workflow guidance for plan.',
      focus_areas: ['execution-order', 'constraint-locking'],
      review_axes: [],
      preferred_notes: ['docs/workflows/plan.md'],
      default_agents: []
    }
  },
  {
    name: 'do',
    title: 'Do',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'do',
    scheduler_builder: 'buildDoOutput',
    orchestratable: true,
    materializable: true,
    description: 'Execute the smallest durable change while keeping verification debt explicit.',
    materialization: {
      spec_name: 'capability-do',
      spec_title: 'Do Capability',
      template_name: 'do-workflow',
      default_output: 'docs/workflows/do.md',
      summary: 'Project-local workflow guidance for do.',
      focus_areas: ['smallest-durable-change', 'mutation-scope-control'],
      review_axes: [],
      preferred_notes: ['docs/workflows/do.md'],
      default_agents: []
    }
  },
  {
    name: 'debug',
    title: 'Debug',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'debug',
    scheduler_builder: 'buildDebugOutput',
    orchestratable: true,
    materializable: true,
    description: 'Eliminate hypotheses one by one before patching.',
    materialization: {
      spec_name: 'capability-debug',
      spec_title: 'Debug Capability',
      template_name: 'debug-workflow',
      default_output: 'docs/workflows/debug.md',
      summary: 'Project-local workflow guidance for debug.',
      focus_areas: ['hypothesis-elimination', 'evidence-first-debugging'],
      review_axes: [],
      preferred_notes: ['docs/workflows/debug.md'],
      default_agents: []
    }
  },
  {
    name: 'review',
    title: 'Review',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'review',
    scheduler_builder: 'buildReviewOutput',
    orchestratable: true,
    materializable: true,
    description: 'Inspect structural risk and tradeoffs without collapsing into style review.',
    materialization: {
      spec_name: 'capability-review',
      spec_title: 'Review Capability',
      template_name: 'review-workflow',
      default_output: 'docs/workflows/review.md',
      summary: 'Project-local workflow guidance for review.',
      focus_areas: ['structural-risk-review', 'tradeoff-audit'],
      review_axes: ['architecture', 'failure-modes'],
      preferred_notes: ['docs/workflows/review.md'],
      default_agents: []
    }
  },
  {
    name: 'verify',
    title: 'Verify',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'verify',
    scheduler_builder: 'buildVerifyOutput',
    orchestratable: true,
    materializable: true,
    description: 'Close evidence item by item and surface any failed or untested gates.',
    materialization: {
      spec_name: 'capability-verify',
      spec_title: 'Verify Capability',
      template_name: 'verify-workflow',
      default_output: 'docs/workflows/verify.md',
      summary: 'Project-local workflow guidance for verify.',
      focus_areas: ['evidence-closure', 'gate-completion'],
      review_axes: ['verification', 'evidence-quality'],
      preferred_notes: ['docs/workflows/verify.md'],
      default_agents: []
    }
  },
  {
    name: 'note',
    title: 'Note',
    category: 'workflow-capability',
    execution_kind: 'workflow-action',
    action_name: 'note',
    scheduler_builder: 'buildNoteOutput',
    orchestratable: true,
    materializable: true,
    description: 'Record durable conclusions only and keep temporary fragments out of long-lived notes.',
    materialization: {
      spec_name: 'capability-note',
      spec_title: 'Note Capability',
      template_name: 'note-workflow',
      default_output: 'docs/workflows/note.md',
      summary: 'Project-local workflow guidance for note.',
      focus_areas: ['durable-decision-recording', 'note-hygiene'],
      review_axes: [],
      preferred_notes: ['docs/workflows/note.md'],
      default_agents: []
    }
  },
  {
    name: 'arch-review',
    title: 'Architecture Review',
    category: 'workflow-capability',
    execution_kind: 'arch-review',
    action_name: 'arch-review',
    orchestratable: true,
    materializable: true,
    description: 'Run a heavyweight architecture preflight before committing to a selection or design direction.',
    materialization: {
      spec_name: 'capability-arch-review',
      spec_title: 'Architecture Review Capability',
      template_name: 'arch-review-workflow',
      default_output: 'docs/workflows/arch-review.md',
      summary: 'Project-local workflow guidance for architecture review.',
      focus_areas: ['architecture-preflight', 'tradeoff-pressure-test'],
      review_axes: ['architecture', 'pre-mortem'],
      preferred_notes: ['docs/workflows/arch-review.md'],
      default_agents: ['emb-arch-reviewer']
    }
  },
  {
    name: 'health',
    title: 'Health',
    category: 'runtime-surface',
    execution_kind: 'runtime-surface',
    primary_command: 'health',
    orchestratable: false,
    materializable: false,
    description: 'Inspect current bootstrap and runtime readiness.',
    materialization: null
  },
  {
    name: 'next',
    title: 'Next',
    category: 'runtime-surface',
    execution_kind: 'runtime-surface',
    primary_command: 'next',
    orchestratable: false,
    materializable: false,
    description: 'Resolve the recommended next capability from current session state.',
    materialization: null
  },
  {
    name: 'status',
    title: 'Status',
    category: 'runtime-surface',
    execution_kind: 'runtime-surface',
    primary_command: 'status',
    orchestratable: false,
    materializable: false,
    description: 'Inspect current session state without executing workflow work.',
    materialization: null
  }
];

const CAPABILITY_BY_NAME = new Map();

for (const definition of CAPABILITY_DEFINITIONS) {
  CAPABILITY_BY_NAME.set(definition.name, definition);
}

function normalizeCapabilityName(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCapabilityName(value) {
  const normalized = normalizeCapabilityName(value);
  return CAPABILITY_BY_NAME.has(normalized) ? normalized : '';
}

function getCapabilityDefinition(value, options = {}) {
  const includeRuntimeSurfaces = options.include_runtime_surfaces === true;
  const resolvedName = resolveCapabilityName(value);
  const definition = resolvedName ? CAPABILITY_BY_NAME.get(resolvedName) || null : null;

  if (!definition) {
    return null;
  }

  if (!includeRuntimeSurfaces && definition.category === 'runtime-surface') {
    return null;
  }

  return definition;
}

function requireCapabilityDefinition(value, options = {}) {
  const definition = getCapabilityDefinition(value, options);
  if (!definition) {
    throw new Error(`Unknown capability: ${value}`);
  }
  return definition;
}

function listCapabilityDefinitions(options = {}) {
  const includeRuntimeSurfaces = options.include_runtime_surfaces === true;

  return CAPABILITY_DEFINITIONS.filter(definition =>
    includeRuntimeSurfaces || definition.category !== 'runtime-surface'
  );
}

function getWorkflowCapabilityNames() {
  return CAPABILITY_DEFINITIONS
    .filter(definition => definition.category === 'workflow-capability')
    .map(definition => definition.name);
}

function getOrchestratableCapabilityNames() {
  return CAPABILITY_DEFINITIONS
    .filter(definition => definition.orchestratable)
    .map(definition => definition.name);
}

function getCapabilityPrimaryArgs(value) {
  const definition = getCapabilityDefinition(value, { include_runtime_surfaces: true });
  if (!definition) {
    return [];
  }

  if (definition.category === 'workflow-capability') {
    return ['capability', 'run', definition.name];
  }

  return [definition.primary_command || definition.name].filter(Boolean);
}

function isWorkflowCapability(value) {
  const definition = getCapabilityDefinition(value, { include_runtime_surfaces: true });
  return Boolean(definition && definition.category === 'workflow-capability');
}

module.exports = {
  CAPABILITY_DEFINITIONS,
  getCapabilityDefinition,
  getCapabilityPrimaryArgs,
  getOrchestratableCapabilityNames,
  getWorkflowCapabilityNames,
  isWorkflowCapability,
  listCapabilityDefinitions,
  normalizeCapabilityName,
  requireCapabilityDefinition,
  resolveCapabilityName
};
