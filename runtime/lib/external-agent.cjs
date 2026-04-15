'use strict';

function createExternalAgentHelpers(deps) {
  const { runtime, runtimeHostHelpers } = deps;
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

  function getProtocolFile() {
    return runtime.getProjectAssetRelativePath('external-agent.md');
  }

  function getPreferredLocalCli() {
    return `node ./${runtime.getProjectAssetRelativePath('runtime', 'bin', 'emb-agent.cjs')}`;
  }

  function buildRawCli(runtimeHost, commandText) {
    const suffix = String(commandText || '').trim();
    return suffix ? `${runtimeHost.cliCommand} ${suffix}` : runtimeHost.cliCommand;
  }

  function buildSharedFiles(extraFiles) {
    return runtime.unique([
      getProtocolFile(),
      runtime.getProjectAssetRelativePath('project.json'),
      runtime.getProjectAssetRelativePath('hw.yaml'),
      runtime.getProjectAssetRelativePath('req.yaml'),
      ...(Array.isArray(extraFiles) ? extraFiles : [])
    ].filter(Boolean));
  }

  function buildStartDriver(runtimeHost, options) {
    const settings = options || {};
    const immediate = settings.immediate || {};

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'start',
      recommended_command: String(immediate.command || '').trim(),
      recommended_cli: buildRawCli(runtimeHost, immediate.command || ''),
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'After any state-changing emb-agent command, run next again.'
    };
  }

  function buildNextDriver(runtimeHost, options) {
    const settings = options || {};
    const next = settings.next || {};

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'next',
      recommended_command: String(next.command || '').trim(),
      recommended_cli: String(next.cli || buildRawCli(runtimeHost, next.command || '')).trim(),
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'After any emb-agent command that changes truth, task state, or workflow state, run next again.'
    };
  }

  function buildInitDriver(runtimeHost, options) {
    const settings = options || {};
    const bootstrap = settings.bootstrap || {};
    const nextCommand = String(bootstrap.command || settings.next_command || '').trim();

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'init',
      recommended_command: nextCommand,
      recommended_cli: nextCommand ? buildRawCli(runtimeHost, nextCommand) : runtimeHost.cliCommand,
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'After init finishes, read the truth files, then run the recommended next emb-agent command.'
    };
  }

  function buildStatusDriver(runtimeHost, options) {
    const settings = options || {};
    const nextCommand = String(settings.next_command || 'start').trim();

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'status',
      recommended_command: nextCommand,
      recommended_cli: buildRawCli(runtimeHost, nextCommand),
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'Use status for inspection only. Re-enter the workflow through start or next before changing project state.'
    };
  }

  function buildHealthDriver(runtimeHost, options) {
    const settings = options || {};
    const next = settings.next || {};

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'health',
      recommended_command: String(next.command || '').trim(),
      recommended_cli: String(next.cli || buildRawCli(runtimeHost, next.command || '')).trim(),
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'After fixing a blocking health item or running the recommended emb-agent command, run health or next again.'
    };
  }

  function buildDispatchNextDriver(runtimeHost, options) {
    const settings = options || {};
    const next = settings.next || {};

    return {
      mode: 'external-cli',
      protocol_file: getProtocolFile(),
      runtime_cli: runtimeHost.cliCommand,
      preferred_local_cli: getPreferredLocalCli(),
      entrypoint: 'dispatch-next',
      recommended_command: String(next.command || '').trim(),
      recommended_cli: String(next.cli || buildRawCli(runtimeHost, next.command || '')).trim(),
      source_of_truth_files: buildSharedFiles(settings.source_of_truth_files),
      repeat_rule: 'Run the recommended command, then call external next or external dispatch-next again.'
    };
  }

  function buildEnvelope(entrypoint, driver, details) {
    return compactObject({
      protocol: PROTOCOL_VERSION,
      entrypoint,
      driver,
      ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {})
    });
  }

  function summarizeWorkflowStage(stage) {
    const source = stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
    return compactObject({
      name: source.name || '',
      primary_command: source.primary_command || '',
      why: source.why || '',
      exit_criteria: source.exit_criteria || ''
    });
  }

  function summarizeTask(task) {
    const source = task && typeof task === 'object' && !Array.isArray(task) ? task : {};
    return compactObject({
      name: source.name || '',
      title: source.title || '',
      status: source.status || '',
      type: source.type || '',
      path: source.path || '',
      worktree_path: source.worktree_path || ''
    });
  }

  function summarizeCheckCounts(summary) {
    const source = summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {};
    return compactObject({
      pass: Number.isFinite(source.pass) ? source.pass : undefined,
      warn: Number.isFinite(source.warn) ? source.warn : undefined,
      fail: Number.isFinite(source.fail) ? source.fail : undefined,
      info: Number.isFinite(source.info) ? source.info : undefined
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

  function summarizeChipSupportHealth(health) {
    const source = health && typeof health === 'object' && !Array.isArray(health) ? health : {};
    const primary = source.primary && typeof source.primary === 'object' && !Array.isArray(source.primary)
      ? source.primary
      : {};

    return compactObject({
      status: source.status || '',
      summary: source.summary || '',
      primary: compactObject({
        tool: primary.tool || '',
        grade: primary.grade || '',
        executable: primary.executable === undefined ? undefined : Boolean(primary.executable),
        recommended_action: primary.recommended_action || ''
      })
    });
  }

  function summarizeExecutorSignal(signal) {
    const source = signal && typeof signal === 'object' && !Array.isArray(signal) ? signal : {};
    return compactObject({
      present: source.present === undefined ? undefined : Boolean(source.present),
      failed: source.failed === undefined ? undefined : Boolean(source.failed),
      name: source.name || '',
      status: source.status || '',
      summary: source.summary || '',
      recommended_action: source.recommended_action || ''
    });
  }

  function summarizeHealthGate(health) {
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
      summary: quickstart.summary || '',
      next_command: nextCommand && Array.isArray(nextCommand.argv) ? nextCommand.argv.join(' ') : '',
      next_cli: nextCommand && nextCommand.cli ? nextCommand.cli : '',
      chip_support: summarizeChipSupportHealth(source.chip_support_health)
    });
  }

  function buildCommandText(source) {
    const item = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    if (Array.isArray(item.argv) && item.argv.length > 0) {
      return item.argv.join(' ');
    }
    return String(item.command || '').trim();
  }

  function summarizeNextStep(source) {
    const item = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    return compactObject({
      kind: item.kind || '',
      command: buildCommandText(item),
      cli: item.cli || '',
      action: item.action || '',
      tool: item.tool || '',
      status: item.status || ''
    });
  }

  function buildStartProtocol(context) {
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

    return buildEnvelope('start', source.external_agent || {}, {
      project_root: summary.project_root || '',
      initialized: summary.initialized === undefined ? undefined : Boolean(summary.initialized),
      handoff_present: summary.handoff_present === undefined ? undefined : Boolean(summary.handoff_present),
      hardware_identity: summary.hardware_identity || null,
      active_task: summarizeTask(summary.active_task),
      summary: immediate.reason || bootstrap.summary || '',
      immediate: compactObject({
        command: immediate.command || '',
        cli: immediate.cli || ''
      }),
      bootstrap: compactObject({
        status: bootstrap.status || '',
        stage: bootstrap.stage || '',
        command: bootstrap.command || ''
      }),
      next: source.next && typeof source.next === 'object' ? compactObject({
        command: source.next.command || '',
        cli: source.next.cli || ''
      }) : null
    });
  }

  function buildNextProtocol(context) {
    const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const current = source.current && typeof source.current === 'object' && !Array.isArray(source.current)
      ? source.current
      : {};
    const next = source.next && typeof source.next === 'object' && !Array.isArray(source.next)
      ? source.next
      : {};

    return buildEnvelope('next', source.external_agent || {}, {
      project_root: current.project_root || '',
      project_profile: current.profile || '',
      focus: current.focus || '',
      summary: next.reason || '',
      active_task: summarizeTask(source.task),
      workflow_stage: summarizeWorkflowStage(source.workflow_stage),
      next: compactObject({
        command: next.command || '',
        cli: next.cli || '',
        gated_by_health: next.gated_by_health === undefined ? undefined : Boolean(next.gated_by_health)
      })
    });
  }

  function buildInitProtocol(payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const bootstrap = source.bootstrap && typeof source.bootstrap === 'object' && !Array.isArray(source.bootstrap)
      ? source.bootstrap
      : {};
    const session = source.session && typeof source.session === 'object' && !Array.isArray(source.session)
      ? source.session
      : {};

    return buildEnvelope('init', source.external_agent || {}, {
      project_root: source.project_root || '',
      project_dir: source.project_dir || '',
      initialized: source.initialized === undefined ? undefined : Boolean(source.initialized),
      reused_existing: source.reused_existing === undefined ? undefined : Boolean(source.reused_existing),
      summary: bootstrap.summary || '',
      bootstrap: compactObject({
        status: bootstrap.status || '',
        stage: bootstrap.stage || '',
        command: bootstrap.command || ''
      }),
      session: compactObject({
        project_profile: source.project_profile || session.project_profile || '',
        active_packs: source.active_packs || session.active_packs || [],
        developer: source.developer || session.developer || null
      }),
      bootstrap_task: summarizeTask(source.bootstrap_task)
    });
  }

  function buildStatusProtocol(payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return buildEnvelope('status', source.external_agent || {}, {
      project_root: source.project_root || '',
      project_profile: source.project_profile || '',
      focus: source.focus || '',
      developer: source.developer || null,
      active_task: summarizeTask(source.active_task),
      memory_summary: source.memory_summary && typeof source.memory_summary === 'object'
        ? compactObject({
            source: source.memory_summary.source || '',
            next_action: source.memory_summary.next_action || ''
          })
        : null
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
    const nextCommand =
      Array.isArray(source.next_commands) && source.next_commands.length > 0
        ? source.next_commands[0]
        : null;
    const nextStep = summarizeNextStep({
      kind: nextCommand && nextCommand.kind ? nextCommand.kind : 'command',
      command: buildCommandText(nextCommand),
      cli: nextCommand && nextCommand.cli ? nextCommand.cli : ''
    });

    return buildEnvelope(
      'health',
      buildHealthDriver(runtimeHost, {
        next: {
          command: nextStep.command || '',
          cli: nextStep.cli || ''
        }
      }),
      {
        project_root: source.project_root || '',
        status: source.status || '',
        summary: quickstart.summary || bootstrap.summary || '',
        checks: summarizeCheckCounts(source.summary),
        blocking_checks: summarizeHealthChecks(source.checks),
        bootstrap: compactObject({
          status: bootstrap.status || '',
          stage: bootstrap.stage || quickstart.stage || '',
          action: bootstrap.action || quickstart.action || '',
          summary: bootstrap.summary || '',
          first_cli: bootstrap.first_cli || quickstart.first_cli || '',
          then_cli: bootstrap.then_cli || quickstart.then_cli || ''
        }),
        next: nextStep,
        chip_support: summarizeChipSupportHealth(source.chip_support_health)
      }
    );
  }

  function buildDispatchNextProtocol(runtimeHost, payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const current = source.current && typeof source.current === 'object' && !Array.isArray(source.current)
      ? source.current
      : {};
    const toolExecution = source.tool_execution && typeof source.tool_execution === 'object' && !Array.isArray(source.tool_execution)
      ? source.tool_execution
      : {};
    const agentExecution = source.agent_execution && typeof source.agent_execution === 'object' && !Array.isArray(source.agent_execution)
      ? source.agent_execution
      : {};
    const recommendedStep =
      toolExecution.available && toolExecution.recommended
        ? summarizeNextStep({
            kind: 'tool',
            argv: toolExecution.argv || [],
            cli: toolExecution.cli || '',
            action: source.resolved_action || '',
            tool: toolExecution.tool || '',
            status: toolExecution.status || ''
          })
        : summarizeNextStep({
            kind: 'action',
            command: source.resolved_action || '',
            cli: source.cli || '',
            action: source.resolved_action || ''
          });

    return buildEnvelope(
      'dispatch-next',
      buildDispatchNextDriver(runtimeHost, {
        next: {
          command: recommendedStep.command || '',
          cli: recommendedStep.cli || ''
        }
      }),
      {
        project_root: current.project_root || '',
        project_profile: current.profile || '',
        focus: current.focus || '',
        summary: source.reason || '',
        resolved_action: source.resolved_action || '',
        workflow_stage: summarizeWorkflowStage(source.workflow_stage),
        next: recommendedStep,
        execution: compactObject({
          mode: recommendedStep.kind === 'tool'
            ? 'tool-first'
            : agentExecution.recommended
              ? agentExecution.mode || 'agent'
              : 'inline',
          dispatch_ready: source.dispatch_ready === undefined ? undefined : Boolean(source.dispatch_ready),
          primary_agent: agentExecution.primary_agent || '',
          supporting_agents: Array.isArray(agentExecution.supporting_agents) ? agentExecution.supporting_agents : [],
          tool: toolExecution.tool || '',
          tool_status: toolExecution.status || ''
        }),
        health: summarizeHealthGate(source.health),
        permission_gates: summarizePermissionGates(source.permission_gates),
        executor_signal: summarizeExecutorSignal(source.executor_signal)
      }
    );
  }

  return {
    PROTOCOL_VERSION,
    getProtocolFile,
    getPreferredLocalCli,
    buildStartDriver,
    buildNextDriver,
    buildInitDriver,
    buildStatusDriver,
    buildHealthDriver,
    buildDispatchNextDriver,
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
