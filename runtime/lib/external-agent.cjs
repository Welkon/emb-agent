'use strict';

const runtimeEventHelpers = require('./runtime-events.cjs');

function createExternalAgentHelpers() {
  const PROTOCOL_VERSION = 'emb-agent.external/1';

  function compactObject(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const output = {};

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (Array.isArray(value)) {
        if (value.length > 0) {
          output[key] = value;
        }
        continue;
      }

      if (typeof value === 'object') {
        const nested = compactObject(value);
        if (Object.keys(nested).length > 0) {
          output[key] = nested;
        }
        continue;
      }

      output[key] = value;
    }

    return output;
  }

  function buildRawCli(runtimeHost, commandText) {
    const suffix = String(commandText || '').trim();
    return suffix ? `${runtimeHost.cliCommand} ${suffix}` : runtimeHost.cliCommand;
  }

  function buildRecommendedCli(runtimeHost, cliText, commandText) {
    const explicitCli = String(cliText || '').trim();
    if (explicitCli) {
      return explicitCli;
    }

    const command = String(commandText || '').trim();
    if (!command) {
      return '';
    }

    return buildRawCli(runtimeHost, command);
  }

  function resolveStepCli(runtimeHost, source) {
    const item = source && typeof source === 'object' && !Array.isArray(source) ? source : {};

    if (item.cli) {
      return String(item.cli).trim();
    }

    if (Array.isArray(item.argv) && item.argv.length > 0) {
      return buildRawCli(runtimeHost, item.argv.join(' '));
    }

    if (item.command) {
      return buildRawCli(runtimeHost, item.command);
    }

    return '';
  }

  function buildEnvelope(entrypoint, runtimeHost, details) {
    return compactObject({
      protocol: PROTOCOL_VERSION,
      entrypoint,
      runtime_cli: runtimeHost && runtimeHost.cliCommand ? runtimeHost.cliCommand : '',
      ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {})
    });
  }

  function summarizeHealthChecks(checks) {
    return Array.isArray(checks)
      ? checks
          .filter(item => item && typeof item === 'object' && ['fail', 'warn'].includes(item.status))
          .slice(0, 3)
          .map(item =>
            compactObject({
              key: item.key || '',
              status: item.status || '',
              summary: item.summary || '',
              recommendation: item.recommendation || ''
            })
          )
      : [];
  }

  function summarizeProtocolRuntimeEvents(source) {
    return runtimeEventHelpers.summarizeRuntimeEvents(source && source.runtime_events);
  }

  function summarizeCapabilityRoute(route) {
    const source = route && typeof route === 'object' && !Array.isArray(route) ? route : null;

    if (!source) {
      return null;
    }

    const primaryEntry =
      source.primary_entry && typeof source.primary_entry === 'object' && !Array.isArray(source.primary_entry)
        ? source.primary_entry
        : {};
    return compactObject({
      capability: source.capability || '',
      category: source.category || '',
      route_strategy: source.route_strategy || '',
      product_role: source.product_role || '',
      generator_owner: source.generator_owner || '',
      repository_layout: source.repository_layout || '',
      materialization_state: source.materialization_state || '',
      host_targets: Array.isArray(source.host_targets) ? source.host_targets.slice(0, 5) : undefined,
      primary_entry: compactObject({
        kind: primaryEntry.kind || '',
        name: primaryEntry.name || '',
        cli: primaryEntry.cli || ''
      }),
      generated_surfaces: Array.isArray(source.generated_surfaces)
        ? source.generated_surfaces
            .slice(0, 4)
            .map(item =>
              compactObject({
                kind: item && item.kind ? item.kind : '',
                name: item && item.name ? item.name : '',
                materialized:
                  item && Object.prototype.hasOwnProperty.call(item, 'materialized')
                    ? Boolean(item.materialized)
                    : undefined,
                source: item && item.source ? item.source : ''
              })
            )
        : undefined
    });
  }

  function buildStartProtocol(runtimeHost, context) {
    const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const summary = source.summary && typeof source.summary === 'object' && !Array.isArray(source.summary)
      ? source.summary
      : {};
    const immediate = source.immediate && typeof source.immediate === 'object' && !Array.isArray(source.immediate)
      ? source.immediate
      : {};
    const bootstrap = source.bootstrap && typeof source.bootstrap === 'object' && !Array.isArray(source.bootstrap)
      ? source.bootstrap
      : {};

    return buildEnvelope('start', runtimeHost, {
      status: summary.initialized ? 'ready' : 'start',
      summary: immediate.reason || bootstrap.summary || '',
      runtime_events: summarizeProtocolRuntimeEvents(source),
      next: compactObject({
        cli: immediate.cli || ''
      })
    });
  }

  function buildNextProtocol(runtimeHost, context) {
    const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const next = source.next && typeof source.next === 'object' && !Array.isArray(source.next)
      ? source.next
      : {};
    const stage = source.workflow_stage && typeof source.workflow_stage === 'object' && !Array.isArray(source.workflow_stage)
      ? source.workflow_stage
      : {};
    const graph = source.knowledge_graph && typeof source.knowledge_graph === 'object' && !Array.isArray(source.knowledge_graph)
      ? source.knowledge_graph
      : {};

    return buildEnvelope('next', runtimeHost, {
      status: stage.name || 'next',
      summary: next.reason || '',
      runtime_events: summarizeProtocolRuntimeEvents(source),
      product_layer:
        source.product_layer && typeof source.product_layer === 'object' && !Array.isArray(source.product_layer)
          ? compactObject({
              id: source.product_layer.id || '',
              label: source.product_layer.label || ''
            })
          : undefined,
      capability_route: summarizeCapabilityRoute(source.capability_route || next.capability_route),
      recommended_flow:
        source.recommended_flow && typeof source.recommended_flow === 'object' && !Array.isArray(source.recommended_flow)
          ? compactObject({
              id: source.recommended_flow.id || '',
              mode: source.recommended_flow.mode || '',
              artifact_path:
                Array.isArray(source.recommended_flow.steps)
                  ? (source.recommended_flow.steps.find(step => step && step.artifact_path) || {}).artifact_path || ''
                  : ''
            })
          : undefined,
      handoff_protocol:
        source.handoff_protocol && typeof source.handoff_protocol === 'object' && !Array.isArray(source.handoff_protocol)
          ? compactObject({
              protocol: source.handoff_protocol.protocol || '',
              artifact_path: source.handoff_protocol.artifact_path || '',
              recommended_agent: source.handoff_protocol.recommended_agent || ''
            })
          : undefined,
      next: compactObject({
        cli: next.cli || '',
        gated_by_health: next.gated_by_health ? true : undefined
      }),
      knowledge_graph: compactObject({
        state: graph.state || (graph.initialized === false ? 'missing' : ''),
        stale: graph.stale === true ? true : undefined,
        next: Array.isArray(graph.next_steps) && graph.next_steps.length > 0 ? graph.next_steps[0] : '',
        next_steps: Array.isArray(graph.next_steps) ? graph.next_steps.slice(0, 3) : []
      })
    });
  }

  function buildInitProtocol(runtimeHost, payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const bootstrap = source.bootstrap && typeof source.bootstrap === 'object' && !Array.isArray(source.bootstrap)
      ? source.bootstrap
      : {};
    const nextCommand = String(bootstrap.command || '').trim();

    return buildEnvelope('init', runtimeHost, {
      status: bootstrap.status || (source.initialized ? 'ready' : 'init'),
      summary: bootstrap.summary || '',
      runtime_events: summarizeProtocolRuntimeEvents(source),
      next: compactObject({
        cli: buildRecommendedCli(runtimeHost, '', nextCommand)
      })
    });
  }

  function buildStatusProtocol(runtimeHost, payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

    return buildEnvelope('status', runtimeHost, {
      status: 'inspection',
      summary: 'Run next to continue the workflow.',
      runtime_events: summarizeProtocolRuntimeEvents(source),
      capability_route: summarizeCapabilityRoute(source.capability_route),
      next_capability_route: summarizeCapabilityRoute(source.next_capability_route),
      session_state:
        source.session_state && typeof source.session_state === 'object' && !Array.isArray(source.session_state)
          ? source.session_state
          : undefined,
      next: {
        cli: buildRecommendedCli(runtimeHost, '', 'next')
      }
    });
  }

  function buildHealthProtocol(runtimeHost, payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const bootstrap = source.bootstrap && typeof source.bootstrap === 'object' && !Array.isArray(source.bootstrap)
      ? source.bootstrap
      : {};
    const quickstart = source.quickstart && typeof source.quickstart === 'object' && !Array.isArray(source.quickstart)
      ? source.quickstart
      : {};
    const actionCard = source.action_card && typeof source.action_card === 'object' && !Array.isArray(source.action_card)
      ? source.action_card
      : {};
    const bootstrapNextStage = bootstrap.next_stage && typeof bootstrap.next_stage === 'object' && !Array.isArray(bootstrap.next_stage)
      ? bootstrap.next_stage
      : {};
    const quickstartSteps = Array.isArray(quickstart.steps) ? quickstart.steps : [];

    return buildEnvelope('health', runtimeHost, {
      status: source.status || '',
      summary: quickstart.summary || bootstrap.summary || '',
      blocking_checks: summarizeHealthChecks(source.checks),
      runtime_events: summarizeProtocolRuntimeEvents(source),
      recommended_flow:
        source.recommended_flow && typeof source.recommended_flow === 'object' && !Array.isArray(source.recommended_flow)
          ? compactObject({
              id: source.recommended_flow.id || '',
              mode: source.recommended_flow.mode || '',
              artifact_path:
                Array.isArray(source.recommended_flow.steps)
                  ? (source.recommended_flow.steps.find(step => step && step.artifact_path) || {}).artifact_path || ''
                  : ''
            })
          : undefined,
      handoff_protocol:
        source.handoff_protocol && typeof source.handoff_protocol === 'object' && !Array.isArray(source.handoff_protocol)
          ? compactObject({
              protocol: source.handoff_protocol.protocol || '',
              artifact_path: source.handoff_protocol.artifact_path || '',
              recommended_agent: source.handoff_protocol.recommended_agent || ''
            })
          : undefined,
      next: compactObject({
        cli:
          actionCard.first_cli ||
          bootstrapNextStage.cli ||
          (quickstartSteps[0] && quickstartSteps[0].cli ? quickstartSteps[0].cli : '')
      })
    });
  }

  function buildDispatchNextProtocol(runtimeHost, payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const toolExecution = source.tool_execution && typeof source.tool_execution === 'object' && !Array.isArray(source.tool_execution)
      ? source.tool_execution
      : {};
    const agentExecution = source.agent_execution && typeof source.agent_execution === 'object' && !Array.isArray(source.agent_execution)
      ? source.agent_execution
      : {};
    const graph = source.knowledge_graph && typeof source.knowledge_graph === 'object' && !Array.isArray(source.knowledge_graph)
      ? source.knowledge_graph
      : {};
    const recommendedKind =
      toolExecution.available && toolExecution.recommended
        ? 'tool'
        : 'action';
    const mode =
      recommendedKind === 'tool'
        ? 'tool-first'
        : agentExecution.recommended
          ? agentExecution.mode || 'agent'
          : 'inline';
    const recommendedCli =
      toolExecution.available && toolExecution.recommended
        ? resolveStepCli(runtimeHost, toolExecution)
        : resolveStepCli(runtimeHost, { cli: source.cli || '', command: source.resolved_action || '' });

    return buildEnvelope('dispatch-next', runtimeHost, {
      status: mode,
      summary: source.reason || '',
      runtime_events: summarizeProtocolRuntimeEvents(source),
      capability_route: summarizeCapabilityRoute(source.capability_route),
      next: compactObject({
        kind: recommendedKind,
        cli: recommendedCli
      }),
      knowledge_graph: compactObject({
        state: graph.state || (graph.initialized === false ? 'missing' : ''),
        stale: graph.stale === true ? true : undefined,
        next: Array.isArray(graph.next_steps) && graph.next_steps.length > 0 ? graph.next_steps[0] : '',
        next_steps: Array.isArray(graph.next_steps) ? graph.next_steps.slice(0, 3) : []
      })
    });
  }

  return {
    PROTOCOL_VERSION,
    buildStartProtocol,
    buildNextProtocol,
    buildInitProtocol,
    buildStatusProtocol,
    buildHealthProtocol,
    buildDispatchNextProtocol
  };
}

module.exports = {
  createExternalAgentHelpers
};
