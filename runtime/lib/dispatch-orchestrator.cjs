'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createDispatchHelpers(deps) {
  const {
    resolveSession,
    loadHandoff,
    buildGuidance,
    getPreferences,
    enrichWithToolSuggestions,
    buildToolExecutionFromNext,
    buildNextContext,
    buildActionOutput,
    buildArchReviewDispatchContext
  } = deps;

  function getDiagnostics(session) {
    return session && session.diagnostics
      ? session.diagnostics
      : { latest_forensics: {}, latest_executor: {}, executor_history: {}, human_signoffs: {} };
  }

  function buildExecutorSignal(latestExecutor) {
    const signal = latestExecutor && latestExecutor.name ? latestExecutor : null;
    const failed = Boolean(signal && ['failed', 'error'].includes(signal.status));

    return {
      present: Boolean(signal),
      name: signal ? signal.name : '',
      status: signal ? signal.status || '' : '',
      risk: signal ? signal.risk || '' : '',
      exit_code: signal ? signal.exit_code : null,
      failed,
      requires_forensics: failed,
      recommended_action: failed ? 'review' : '',
      summary: signal
        ? `${signal.name} ${signal.status || 'unknown'}${signal.exit_code === null ? '' : `, exit=${signal.exit_code}`}`
        : ''
    };
  }

  function buildDispatchContext(requestedAction) {
    const action = (requestedAction || '').trim();

    if (!action) {
      throw new Error('Missing action name');
    }

    if (action === 'next') {
      const next = buildNextContext();
      const resolvedAction = next.next.command;
      const diagnostics = getDiagnostics(resolveSession().session);
      const executorSignal = buildExecutorSignal(diagnostics.latest_executor);

      if (resolvedAction === 'arch-review') {
        const archDispatch = buildArchReviewDispatchContext();
        return {
          source: 'next',
          requested_action: 'next',
          resolved_action: resolvedAction,
          reason: next.next.reason,
          cli: archDispatch.cli,
          dispatch_ready: archDispatch.dispatch_ready,
          agent_execution: archDispatch.agent_execution,
          workflow_stage: next.workflow_stage || null,
          context_hygiene: next.context_hygiene,
          next_actions: next.next_actions,
          current: next.current,
          diagnostics,
          executor_signal: executorSignal,
          permission_gates: archDispatch.permission_gates || [],
          handoff: next.handoff,
          action_context: archDispatch.action_context
        };
      }

      const output = buildActionOutput(resolvedAction);
      const toolExecution =
        resolvedAction === 'scan'
          ? buildToolExecutionFromNext(next)
          : null;
      return {
        source: 'next',
        requested_action: 'next',
        resolved_action: resolvedAction,
        reason: next.next.reason,
        cli: next.next.cli,
        dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
        agent_execution: output.agent_execution || null,
        workflow_stage: next.workflow_stage || null,
        context_hygiene: next.context_hygiene,
        next_actions: next.next_actions,
        current: next.current,
        diagnostics,
        executor_signal: executorSignal,
        health: next.health || null,
        permission_gates: next.permission_gates || output.permission_gates || [],
        handoff: next.handoff,
        tool_execution: toolExecution,
        action_context: output
      };
    }

    if (action === 'arch-review') {
      return {
        source: 'action',
        ...buildArchReviewDispatchContext()
      };
    }

    const output = buildActionOutput(action);
    const resolved = resolveSession();
    const diagnostics = getDiagnostics(resolved.session);
    const executorSignal = buildExecutorSignal(diagnostics.latest_executor);

    return {
      source: 'action',
      requested_action: action,
      resolved_action: action,
      reason: `direct dispatch for ${action}`,
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [action]),
      dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
      agent_execution: output.agent_execution || null,
      context_hygiene: output.context_hygiene || null,
      diagnostics,
      executor_signal: executorSignal,
      permission_gates: output.permission_gates || [],
      tool_execution: null,
      action_context: output
    };
  }

  function buildOrchestratorStrategy(agentExecution) {
    const execution = agentExecution || {};

    if (!execution.available || !execution.recommended) {
      return 'inline';
    }

    if (execution.mode === 'parallel-recommended') {
      return 'primary-plus-parallel';
    }

    if (execution.mode === 'primary-plus-supporting') {
      return 'primary-plus-supporting';
    }

    return 'primary-first';
  }

  function buildOrchestratorSteps(dispatch) {
    const execution = dispatch.agent_execution || {};
    const toolExecution = dispatch.tool_execution || null;
    const contract = execution.dispatch_contract || {};
    const primary = contract.primary || null;
    const supporting = contract.supporting || [];
    const steps = [
      {
        id: 'restore-context',
        kind: 'context',
        required: false,
        when: 'after clearing context or when current project context needs to be restored',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
        outcome: 'restore the current project session, handoff, and lightweight working context'
      }
    ];

    if (toolExecution && toolExecution.available) {
      steps.push({
        id: 'run-tool',
        kind: 'tool',
        required: toolExecution.recommended,
        when: toolExecution.recommended
          ? 'the current scan has identified a directly executable hardware calculation tool, so converge register/formula ground truth first'
          : 'if this tool should continue, fill in missing dependencies or adapters first',
        cli: toolExecution.cli,
        tool: toolExecution.tool,
        status: toolExecution.status,
        reason: toolExecution.reason,
        trust: toolExecution.trust || null,
        recommended_action:
          toolExecution.trust && toolExecution.trust.recommended_action
            ? toolExecution.trust.recommended_action
            : '',
        missing_inputs: toolExecution.missing_inputs || [],
        defaults_applied: toolExecution.defaults_applied || {},
        outcome: toolExecution.recommended
          ? 'produce the tool calculation result first, then decide whether to continue with scan / debug / do'
          : 'only output the tool draft and missing inputs for now; do not execute directly'
      });
    }

    if (!execution.available || !execution.recommended) {
      steps.push({
        id: 'inline-action',
        kind: 'inline',
        required: true,
        when: 'the current action does not justify expanding sub-agents, or inline is already sufficient',
        cli: dispatch.cli,
        outcome: 'let the current main thread execute the action directly and produce standard emb output'
      });
    } else {
      if (primary) {
        steps.push({
          id: 'launch-primary',
          kind: 'agent',
          required: true,
          blocking: primary.blocking !== false,
          agent: primary.agent,
          when: primary.when || 'when the current action needs the primary agent',
          start_when: primary.start_when || 'Start immediately',
          preferred_cli: dispatch.cli,
          fallback: primary.spawn_fallback || null,
          outcome: primary.expected_output || []
        });
      }

      if (supporting.length > 0) {
        steps.push({
          id: 'launch-supporting',
          kind: 'parallel-agents',
          required: false,
          agents: supporting.map(item => item.agent),
          parallel_safe: contract.parallel_safe || [],
          when: 'when the main thread needs side evidence and the agent is marked as parallel-safe',
          start_rule: 'Do not let multiple writable agents modify the same file set',
          outcome: supporting.map(item => ({
            agent: item.agent,
            expected_output: item.expected_output || []
          }))
        });
      }

      if (contract.synthesis_required) {
        steps.push({
          id: 'synthesize',
          kind: 'synthesis',
          required: true,
          owner: contract.synthesis_contract && contract.synthesis_contract.owner
            ? contract.synthesis_contract.owner
            : 'Current main thread',
          when: 'after research-style worker outputs arrive and before any downstream writable or closure step continues',
          rule: contract.synthesis_contract && contract.synthesis_contract.rule
            ? contract.synthesis_contract.rule
            : 'Synthesize, do not delegate understanding',
          outcome:
            contract.synthesis_contract && Array.isArray(contract.synthesis_contract.output_requirements)
              ? contract.synthesis_contract.output_requirements
              : [
                  'compose a self-contained specification for the next worker or inline step',
                  'do not forward raw findings as if they were already integrated'
                ]
        });
      }
    }

    steps.push({
      id: 'integrate',
      kind: 'integration',
      required: true,
      owner: contract.integration_owner || 'Current main thread',
      when: 'after receiving inline results or sub-agent results',
      outcome: [
        'integrate back into standard emb output instead of concatenating raw sub-agent replies',
        'retain ownership of final conclusions, persistence, and verification'
      ]
    });

    if (dispatch.context_hygiene && dispatch.context_hygiene.level !== 'ok') {
      steps.push({
        id: 'context-hygiene',
        kind: 'context',
        required: false,
        when: 'when context continues to grow heavier after the action completes',
        recommendation: dispatch.context_hygiene.recommendation,
        clear_hint: dispatch.context_hygiene.clear_hint,
        pause_cli: dispatch.context_hygiene.pause_cli,
        resume_cli: dispatch.context_hygiene.resume_cli
      });
    }

    return steps;
  }

  function buildOrchestratorContext(requestedAction) {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const guidance = buildGuidance(resolved, handoff);
    const dispatch = buildDispatchContext((requestedAction || 'next').trim() || 'next');
    const execution = dispatch.agent_execution || {};
    const toolExecution = dispatch.tool_execution || null;
    const strategy = buildOrchestratorStrategy(execution);
    const current = dispatch.source === 'next'
      ? (dispatch.current || {})
      : {
          project_root: resolved.session.project_root,
          profile: resolved.profile.name,
          packs: resolved.session.active_packs,
          focus: resolved.session.focus || '',
          preferences: getPreferences(resolved.session),
          last_command: resolved.session.last_command || '',
          suggested_flow: guidance.suggested_flow,
          resume_source: handoff ? 'handoff' : 'session',
          last_files: resolved.session.last_files || [],
          open_questions: resolved.session.open_questions || [],
          known_risks: resolved.session.known_risks || []
        };

    return enrichWithToolSuggestions({
      mode: 'lightweight-action-orchestrator',
      source: dispatch.source,
      requested_action: dispatch.requested_action,
      resolved_action: dispatch.resolved_action,
      reason: dispatch.reason,
      current,
      handoff: dispatch.handoff || (handoff
        ? {
            next_action: handoff.next_action,
            context_notes: handoff.context_notes,
            human_actions_pending: handoff.human_actions_pending,
            timestamp: handoff.timestamp
          }
        : null),
      health: dispatch.health || null,
      workflow: {
        style: 'action-based',
        orchestration_weight: 'light',
        suggested_flow: guidance.suggested_flow,
        next_cli: dispatch.cli,
        strategy: toolExecution && toolExecution.recommended ? 'inline-tool-first' : strategy,
        tool_first: Boolean(toolExecution && toolExecution.recommended),
        tool_cli: toolExecution ? toolExecution.cli : '',
        tool_name: toolExecution ? toolExecution.tool : '',
        primary_agent: execution.primary_agent || '',
        supporting_agents: execution.supporting_agents || [],
        wait_strategy: execution.wait_strategy || 'the main thread keeps moving and waits only when the main path is blocked',
        main_thread_owner: 'Current main thread'
      },
      diagnostics: dispatch.diagnostics || getDiagnostics(resolved.session),
      executor_signal: dispatch.executor_signal || buildExecutorSignal(getDiagnostics(resolved.session).latest_executor),
      permission_gates: dispatch.permission_gates || permissionGateHelpers.buildPermissionGates(dispatch.action_context || {}),
      orchestrator_steps: buildOrchestratorSteps(dispatch),
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || guidance.next_actions,
      tool_execution: toolExecution,
      adapter_health:
        dispatch.health && dispatch.health.adapter_health
          ? dispatch.health.adapter_health
          : dispatch.source === 'next' &&
            dispatch.action_context &&
            dispatch.action_context.health
            ? dispatch.action_context.health.adapter_health || null
            : null,
      dispatch_contract: execution.dispatch_contract || null,
      action_context: dispatch.action_context || null
    }, resolved);
  }

  return {
    buildDispatchContext,
    buildOrchestratorStrategy,
    buildOrchestratorSteps,
    buildOrchestratorContext
  };
}

module.exports = {
  createDispatchHelpers
};
