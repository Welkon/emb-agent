'use strict';

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

  function summarizePermissionGates(gates) {
    return Array.isArray(gates)
      ? gates
          .filter(item => item && typeof item === 'object')
          .map(item =>
            compactObject({
              kind: item.kind || '',
              state: item.state || '',
              summary: item.summary || ''
            })
          )
      : [];
  }

  function summarizeExecutorSignal(signal) {
    const source = signal && typeof signal === 'object' && !Array.isArray(signal) ? signal : {};

    return compactObject({
      failed: source.failed === undefined ? undefined : Boolean(source.failed),
      summary: source.summary || '',
      recommended_action: source.recommended_action || ''
    });
  }

  function summarizeHealthGate(runtimeHost, health) {
    const source = health && typeof health === 'object' && !Array.isArray(health) ? health : {};
    const quickstart = source.quickstart && typeof source.quickstart === 'object' && !Array.isArray(source.quickstart)
      ? source.quickstart
      : {};
    const nextCommand =
      Array.isArray(source.next_commands) && source.next_commands.length > 0
        ? source.next_commands[0]
        : null;

    return compactObject({
      status: source.status || '',
      next_cli: resolveStepCli(runtimeHost, nextCommand) || quickstart.first_cli || ''
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
      initialized: summary.initialized === undefined ? undefined : Boolean(summary.initialized),
      summary: immediate.reason || bootstrap.summary || '',
      immediate: compactObject({
        cli: immediate.cli || ''
      }),
      bootstrap: compactObject({
        status: bootstrap.status || '',
        stage: bootstrap.stage || ''
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

    return buildEnvelope('next', runtimeHost, {
      summary: next.reason || '',
      workflow_stage: compactObject({
        name: stage.name || '',
        primary_command: stage.primary_command || ''
      }),
      next: compactObject({
        cli: next.cli || '',
        gated_by_health: next.gated_by_health ? true : undefined
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
      initialized: source.initialized === undefined ? undefined : Boolean(source.initialized),
      summary: bootstrap.summary || '',
      bootstrap: compactObject({
        status: bootstrap.status || '',
        stage: bootstrap.stage || ''
      }),
      next: compactObject({
        cli: buildRecommendedCli(runtimeHost, '', nextCommand)
      })
    });
  }

  function buildStatusProtocol(runtimeHost) {
    return buildEnvelope('status', runtimeHost, {
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
      bootstrap: compactObject({
        status: bootstrap.status || '',
        stage: actionCard.stage || bootstrap.display_current_stage || bootstrap.stage || quickstart.stage || '',
        summary: bootstrap.summary || ''
      }),
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
    const stage = source.workflow_stage && typeof source.workflow_stage === 'object' && !Array.isArray(source.workflow_stage)
      ? source.workflow_stage
      : {};
    const recommendedKind =
      toolExecution.available && toolExecution.recommended
        ? 'tool'
        : 'action';
    const recommendedCli =
      toolExecution.available && toolExecution.recommended
        ? resolveStepCli(runtimeHost, toolExecution)
        : resolveStepCli(runtimeHost, { cli: source.cli || '', command: source.resolved_action || '' });

    return buildEnvelope('dispatch-next', runtimeHost, {
      summary: source.reason || '',
      workflow_stage: compactObject({
        name: stage.name || '',
        primary_command: stage.primary_command || ''
      }),
      next: compactObject({
        kind: recommendedKind,
        cli: recommendedCli
      }),
      execution: compactObject({
        mode: recommendedKind === 'tool'
          ? 'tool-first'
          : agentExecution.recommended
            ? agentExecution.mode || 'agent'
            : 'inline',
        dispatch_ready: source.dispatch_ready ? true : undefined
      }),
      health: source.health
        ? summarizeHealthGate(runtimeHost, source.health)
        : null,
      permission_gates: summarizePermissionGates(source.permission_gates),
      executor_signal:
        source.executor_signal && source.executor_signal.failed
          ? summarizeExecutorSignal(source.executor_signal)
          : null
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
