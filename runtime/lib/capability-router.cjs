'use strict';

const capabilityCatalog = require('./capability-catalog.cjs');

const WORKFLOW_ACTIONS = new Set(capabilityCatalog.getWorkflowCapabilityNames());

function normalizeCapabilityName(value) {
  return String(value || '').trim().toLowerCase();
}

function buildGeneratedSurfaces(capability, options = {}) {
  const normalized = normalizeCapabilityName(capability);
  const primaryAgent = String(options.primary_agent || '').trim();
  const definition = capabilityCatalog.getCapabilityDefinition(normalized, {
    include_runtime_surfaces: true
  });
  const materialization = definition && definition.materialization && typeof definition.materialization === 'object'
    ? definition.materialization
    : null;

  if (!definition || definition.category !== 'workflow-capability' || !materialization) {
    return [];
  }

  const surfaces = [
    {
      kind: 'host-skill',
      name: `emb-${normalized}`,
      materialized: false,
      source: 'generator',
      note: 'Generate this host skill surface during scaffold or host integration; it does not need to exist as a repository-local skills directory first.'
    },
    {
      kind: 'workflow-spec',
      name: materialization.spec_name || `capability-${normalized}`,
      materialized: false,
      source: 'generator',
      note: 'Workflow/spec/template assets should be generated or extended under project workflow layout when the capability needs project-local structure.'
    },
    {
      kind: 'workflow-template',
      name: materialization.template_name || `${normalized}-workflow`,
      materialized: false,
      source: 'generator',
      note: 'Project-local workflow templates should be generated alongside capability specs so teams can materialize host-facing workflow documents intentionally.'
    }
  ];

  if (primaryAgent) {
    surfaces.push({
      kind: 'host-agent',
      name: primaryAgent,
      materialized: true,
      source: 'runtime',
      note: 'This runtime already exposes an agent surface for the capability.'
    });
  }

  return surfaces;
}

function buildHostTargets(workflowAction, generatedSurfaces) {
  if (!workflowAction) {
    return ['runtime-command'];
  }

  return [...new Set([
    ...generatedSurfaces
      .map(item => (item && item.kind ? String(item.kind).trim() : ''))
      .filter(Boolean)
  ])];
}

function buildMaterializationState(workflowAction, generatedSurfaces) {
  if (!workflowAction) {
    return 'runtime-native';
  }

  const hasMaterializedSurface = generatedSurfaces.some(item => item && item.materialized === true);
  const hasPlannedSurface = generatedSurfaces.some(item => !item || item.materialized !== true);

  if (hasMaterializedSurface && hasPlannedSurface) {
    return 'partially-materialized';
  }

  if (hasMaterializedSurface) {
    return 'materialized';
  }

  return 'generator-addressable';
}

function buildCapabilityRoute(capability, options = {}) {
  const normalizedCapability = normalizeCapabilityName(capability);
  const definition = capabilityCatalog.getCapabilityDefinition(normalizedCapability, {
    include_runtime_surfaces: true
  });
  const workflowAction = Boolean(definition && definition.category === 'workflow-capability');
  const commandName = normalizeCapabilityName(
    options.command || (definition && definition.primary_command) || normalizedCapability
  );
  const primaryEntryKind = String(
    options.primary_entry_kind || (workflowAction ? 'capability' : 'command')
  ).trim() || (workflowAction ? 'capability' : 'command');
  const primaryEntryName = normalizeCapabilityName(
    options.primary_entry_name || (workflowAction ? normalizedCapability : commandName)
  );
  const commandCli = String(options.cli || '').trim();
  const primaryEntryCli = String(
    options.primary_entry_cli || (workflowAction ? `capability run ${normalizedCapability}` : commandCli)
  ).trim();
  const generatedSurfaces = buildGeneratedSurfaces(normalizedCapability, options);

  return {
    capability: normalizedCapability,
    category: workflowAction ? 'workflow-action' : 'runtime-surface',
    product_role: 'template-workflow-generator',
    generator_owner: 'emb-agent',
    repository_layout: 'generator-templates-plus-runtime',
    route_strategy: workflowAction ? 'capability-first' : 'command-first',
    materialization_state: buildMaterializationState(workflowAction, generatedSurfaces),
    primary_entry: {
      kind: primaryEntryKind,
      name: primaryEntryName,
      cli: primaryEntryCli
    },
    host_targets: buildHostTargets(workflowAction, generatedSurfaces),
    generated_surfaces: generatedSurfaces,
    notes: workflowAction
      ? [
          'Route the user request to a workflow capability first, then decide which host surface should execute it.',
          'Repository-local skills directories are optional outputs of generation, not a prerequisite for capability routing.'
        ]
      : [
          'This surface is still exposed primarily as a direct runtime command.',
          'Generator-first architecture does not require every runtime/admin surface to become a generated skill.'
        ]
  };
}

module.exports = {
  WORKFLOW_ACTIONS,
  buildCapabilityRoute,
  normalizeCapabilityName
};
