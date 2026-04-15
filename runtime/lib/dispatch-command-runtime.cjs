'use strict';

function createDispatchCommandRuntimeHelpers(deps) {
  const {
    scheduler,
    updateSession,
    resolveSession,
    runSubAgentBridge,
    collectSubAgentBridgeJobs,
    buildDispatchContext,
    buildOrchestratorContext,
    handleCatalogAndStateCommands,
    handleActionCommands,
    handleAdapterToolChipCommands
  } = deps;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeToolScope(toolScope) {
    const scope = isObject(toolScope) ? toolScope : {};
    return {
      role_profile: scope.role_profile || '',
      allows_write: Boolean(scope.allows_write),
      allows_delegate: Boolean(scope.allows_delegate),
      allows_background_work: Boolean(scope.allows_background_work),
      preferred_tools: Array.isArray(scope.preferred_tools) ? scope.preferred_tools.map(item => String(item)) : [],
      disallowed_tools: Array.isArray(scope.disallowed_tools) ? scope.disallowed_tools.map(item => String(item)) : []
    };
  }

  function buildLaunchRequestRecord(agentCall, contract) {
    const call = isObject(agentCall) ? agentCall : {};
    const constraints = contract && isObject(contract.pattern_constraints) ? contract.pattern_constraints : {};
    const phase = String(call.delegation_phase || '').trim() || 'research';
    const freshContextRequired =
      call.context_mode === 'fresh-self-contained' ||
      (constraints.verification_requires_fresh_context === true && phase === 'verification');

    return {
      agent: call.agent || '',
      role: call.role || '',
      phase,
      status: 'planned',
      blocking: call.blocking !== false,
      context_mode: call.context_mode || '',
      purpose: call.purpose || '',
      ownership: call.ownership || '',
      start_when: call.start_when || '',
      continue_vs_spawn: freshContextRequired ? 'spawn-fresh' : 'continue-when-context-overlaps',
      continue_vs_spawn_reason: freshContextRequired
        ? 'verification and fresh-self-contained workers must start from clean context'
        : 'continue only when the loaded worker context still overlaps the next task',
      fresh_context_required: freshContextRequired,
      expected_output: Array.isArray(call.expected_output) ? call.expected_output.map(item => String(item)) : [],
      tool_scope: normalizeToolScope(call.tool_scope),
      worker_contract:
        call.worker_contract && isObject(call.worker_contract)
          ? {
              goal: String(call.worker_contract.goal || ''),
              inputs: Array.isArray(call.worker_contract.inputs) ? call.worker_contract.inputs.map(item => String(item)) : [],
              outputs: Array.isArray(call.worker_contract.outputs) ? call.worker_contract.outputs.map(item => String(item)) : [],
              forbidden_zones: Array.isArray(call.worker_contract.forbidden_zones)
                ? call.worker_contract.forbidden_zones.map(item => String(item))
                : [],
              acceptance_criteria: Array.isArray(call.worker_contract.acceptance_criteria)
                ? call.worker_contract.acceptance_criteria.map(item => String(item))
                : []
            }
          : null
    };
  }

  function buildReviewRuntimeArtifact(dispatchContract, snapshot) {
    const reviewContract =
      dispatchContract && isObject(dispatchContract.review_contract)
        ? dispatchContract.review_contract
        : {};
    const stageAContract = isObject(reviewContract.stage_a) ? reviewContract.stage_a : {};
    const stageBContract = isObject(reviewContract.stage_b) ? reviewContract.stage_b : {};
    const launchRequests = Array.isArray(snapshot.launch_requests) ? snapshot.launch_requests : [];
    const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
    const workerResults = Array.isArray(snapshot.worker_results) ? snapshot.worker_results : [];
    const synthesis = isObject(snapshot.synthesis) ? snapshot.synthesis : {};
    const integration = isObject(snapshot.integration) ? snapshot.integration : {};
    const workerFailed = workerResults.some(item => ['failed', 'blocked', 'bridge-error'].includes(String(item && item.status ? item.status : '')));
    const workerOk = workerResults.some(item => String(item && item.status ? item.status : '') === 'ok');
    const waitingWorkers = jobs.some(item => String(item && item.status ? item.status : '') === 'running');
    const blockedWithoutResults =
      Boolean(synthesis.required) &&
      !workerOk &&
      !workerFailed &&
      ['blocked-no-host-bridge', 'blocked-worker-results'].includes(String(synthesis.status || ''));

    let stageAStatus = reviewContract.required ? 'pending' : 'not-required';
    if (reviewContract.required) {
      if (workerFailed) {
        stageAStatus = 'redispatch-required';
      } else if (workerOk) {
        stageAStatus = 'passed';
      } else if (waitingWorkers) {
        stageAStatus = 'waiting-worker-results';
      } else if (blockedWithoutResults) {
        stageAStatus = 'blocked-no-worker-results';
      } else if (launchRequests.length > 0) {
        stageAStatus = 'pending-worker-results';
      }
    }

    let stageBStatus = reviewContract.required ? 'blocked-by-stage-a' : 'not-required';
    if (reviewContract.required && stageAStatus === 'passed') {
      stageBStatus = integration.status === 'completed-inline'
        ? 'main-thread-review-required'
        : 'ready-for-quality-review';
    }

    const redispatchRequired = stageAStatus === 'redispatch-required';

    return {
      required: Boolean(reviewContract.required),
      policy: reviewContract.policy ? String(reviewContract.policy) : '',
      redispatch_required: redispatchRequired,
      summary: redispatchRequired
        ? 'Stage A contract review failed; redispatch with a tighter contract instead of patching inline.'
        : stageAStatus === 'passed'
          ? 'Stage A passed; Stage B quality review is the next explicit gate.'
          : blockedWithoutResults
            ? 'Worker outputs are unavailable, so Stage A cannot complete yet.'
            : '',
      stage_a: {
        id: stageAContract.id ? String(stageAContract.id) : 'contract-review',
        owner: stageAContract.owner ? String(stageAContract.owner) : 'Current main thread',
        objective: stageAContract.objective ? String(stageAContract.objective) : '',
        completion_signal: stageAContract.completion_signal ? String(stageAContract.completion_signal) : '',
        failure_action: stageAContract.failure_action ? String(stageAContract.failure_action) : 'redispatch',
        review_checks: Array.isArray(stageAContract.review_checks)
          ? stageAContract.review_checks.map(item => String(item))
          : [],
        status: stageAStatus
      },
      stage_b: {
        id: stageBContract.id ? String(stageBContract.id) : 'quality-review',
        owner: stageBContract.owner ? String(stageBContract.owner) : 'Current main thread',
        objective: stageBContract.objective ? String(stageBContract.objective) : '',
        completion_signal: stageBContract.completion_signal ? String(stageBContract.completion_signal) : '',
        failure_action: stageBContract.failure_action ? String(stageBContract.failure_action) : 'reject-or-follow-up',
        review_checks: Array.isArray(stageBContract.review_checks)
          ? stageBContract.review_checks.map(item => String(item))
          : [],
        status: stageBStatus
      }
    };
  }

  function buildDelegationRuntimeSnapshot(context, executionMeta) {
    const source = isObject(context) ? context : {};
    const meta = isObject(executionMeta) ? executionMeta : {};
    const dispatchContract = isObject(source.dispatch_contract)
      ? source.dispatch_contract
      : (source.agent_execution && isObject(source.agent_execution.dispatch_contract)
        ? source.agent_execution.dispatch_contract
        : null);
    const workerResults = Array.isArray(meta.worker_results) ? meta.worker_results : [];
    const launchRequests = Array.isArray(meta.launch_requests) ? meta.launch_requests : [];
    const synthesisContract =
      dispatchContract && isObject(dispatchContract.synthesis_contract)
        ? dispatchContract.synthesis_contract
        : {};
    const plannedLaunchRequests = dispatchContract
      ? [
          ...(dispatchContract.primary ? [buildLaunchRequestRecord(dispatchContract.primary, dispatchContract)] : []),
          ...(Array.isArray(dispatchContract.supporting)
            ? dispatchContract.supporting.map(item => buildLaunchRequestRecord(item, dispatchContract))
            : [])
        ]
      : [];

    const snapshot = {
      pattern: dispatchContract && dispatchContract.delegation_pattern
        ? dispatchContract.delegation_pattern
        : 'inline',
      strategy: source.workflow && source.workflow.strategy
        ? source.workflow.strategy
        : dispatchContract
          ? (dispatchContract.primary_first === false ? 'parallel-coordinator' : 'primary-first')
          : 'inline',
      requested_action: meta.requested_action || source.requested_action || '',
      resolved_action: meta.resolved_action || source.resolved_action || '',
      phases: Array.isArray(dispatchContract && dispatchContract.phases)
        ? dispatchContract.phases.map(phase => ({
            id: phase && phase.id ? String(phase.id) : '',
            owner: phase && phase.owner ? String(phase.owner) : '',
            objective: phase && phase.objective ? String(phase.objective) : '',
            completion_signal: phase && phase.completion_signal ? String(phase.completion_signal) : ''
          }))
        : [],
      launch_requests: launchRequests.length > 0 ? launchRequests : plannedLaunchRequests,
      jobs: Array.isArray(meta.jobs) ? meta.jobs : [],
      worker_results: workerResults,
      synthesis: {
        required: Boolean(dispatchContract && dispatchContract.synthesis_required),
        status: dispatchContract && dispatchContract.synthesis_required
          ? (meta.synthesis_status || 'pending')
          : 'not-required',
        owner: synthesisContract.owner ? String(synthesisContract.owner) : '',
        rule: synthesisContract.rule ? String(synthesisContract.rule) : '',
        happens_after: Array.isArray(synthesisContract.happens_after)
          ? synthesisContract.happens_after.map(item => String(item))
          : [],
        happens_before: Array.isArray(synthesisContract.happens_before)
          ? synthesisContract.happens_before.map(item => String(item))
          : [],
        output_requirements: Array.isArray(synthesisContract.output_requirements)
          ? synthesisContract.output_requirements.map(item => String(item))
          : []
      },
      integration: {
        owner: dispatchContract && dispatchContract.integration_owner
          ? String(dispatchContract.integration_owner)
          : 'Current main thread',
        status: meta.integration_status || (meta.kind ? 'completed-inline' : 'planned'),
        entered_via: meta.entered_via || '',
        execution_kind: meta.kind || '',
        execution_cli: meta.cli || '',
        steps: Array.isArray(dispatchContract && dispatchContract.integration_steps)
          ? dispatchContract.integration_steps.map(item => String(item))
          : [
              'Integrate back into standard emb output instead of concatenating raw worker replies',
              'Keep final ownership in the current main thread'
            ]
      },
      updated_at: new Date().toISOString()
    };
    snapshot.review = buildReviewRuntimeArtifact(dispatchContract, snapshot);
    return snapshot;
  }

  function persistDelegationRuntime(snapshot) {
    const delegationRuntime = isObject(snapshot) ? snapshot : buildDelegationRuntimeSnapshot({}, {});
    updateSession(current => {
      current.diagnostics = isObject(current.diagnostics) ? current.diagnostics : {};
      current.diagnostics.delegation_runtime = delegationRuntime;
    });
  }

  function buildDelegationCollectionResult(collected, enteredVia) {
    const currentSession = resolveSession();
    const currentRuntime =
      currentSession &&
      currentSession.session &&
      currentSession.session.diagnostics &&
      isObject(currentSession.session.diagnostics.delegation_runtime)
        ? currentSession.session.diagnostics.delegation_runtime
        : {};
    const nextRuntime = {
      ...currentRuntime,
      jobs: Array.isArray(collected.jobs) ? collected.jobs : [],
      worker_results: Array.isArray(collected.worker_results) ? collected.worker_results : [],
      synthesis: {
        ...(isObject(currentRuntime.synthesis) ? currentRuntime.synthesis : {}),
        status: collected.synthesis_status || (currentRuntime.synthesis ? currentRuntime.synthesis.status : '')
      },
      updated_at: collected.collected_at || new Date().toISOString()
    };
    nextRuntime.review = buildReviewRuntimeArtifact(
      {
        review_contract: isObject(currentRuntime.review) ? currentRuntime.review : null
      },
      nextRuntime
    );

    persistDelegationRuntime(nextRuntime);

    return {
      collected: true,
      execution: {
        kind: 'delegation-collect',
        entered_via: enteredVia || 'delegation collect'
      },
      delegation_runtime: nextRuntime,
      worker_results: nextRuntime.worker_results,
      delegation_jobs: nextRuntime.jobs
    };
  }

  function executeResolvedAction(actionName) {
    const action = String(actionName || '').trim();
    if (!action) {
      throw new Error('Missing resolved action');
    }

    if (action === 'health' || action === 'update') {
      return handleCatalogAndStateCommands(action, '', []);
    }

    const actionResult = handleActionCommands(action, '', []);
    if (actionResult !== undefined) {
      return actionResult;
    }

    throw new Error(`Unsupported executable action: ${action}`);
  }

  function executeRecommendedTool(toolExecution) {
    const execution = toolExecution && typeof toolExecution === 'object' ? toolExecution : null;
    if (!execution || !execution.tool) {
      throw new Error('Missing tool execution payload');
    }

    const argv = Array.isArray(execution.argv) && execution.argv.length > 0
      ? execution.argv.map(item => String(item))
      : ['tool', 'run', String(execution.tool)];

    if (argv[0] !== 'tool' || argv[1] !== 'run' || !argv[2]) {
      throw new Error(`Unsupported tool execution argv: ${argv.join(' ')}`);
    }

    return {
      argv,
      result: handleAdapterToolChipCommands('tool', 'run', argv.slice(2))
    };
  }

  function annotateExecutionResult(result, meta) {
    const payload =
      result && typeof result === 'object' && !Array.isArray(result)
        ? { ...result }
        : { result };
    const executionMeta = meta && typeof meta === 'object' ? meta : {};

    payload.source = executionMeta.source || payload.source || '';
    payload.requested_action = executionMeta.requested_action || payload.requested_action || '';
    payload.resolved_action = executionMeta.resolved_action || payload.resolved_action || '';
    payload.entered_via = executionMeta.entered_via || payload.entered_via || '';
    payload.execution = {
      kind: executionMeta.kind || '',
      cli: executionMeta.cli || '',
      requested_action: executionMeta.requested_action || '',
      resolved_action: executionMeta.resolved_action || '',
      entered_via: executionMeta.entered_via || ''
    };

    if (executionMeta.workflow_stage && payload.workflow_stage === undefined) {
      payload.workflow_stage = executionMeta.workflow_stage;
    }
    if (executionMeta.dispatch_contract && payload.dispatch_contract === undefined) {
      payload.dispatch_contract = executionMeta.dispatch_contract;
    }
    if (executionMeta.agent_execution && payload.agent_execution === undefined) {
      payload.agent_execution = executionMeta.agent_execution;
    }
    if (executionMeta.tool_execution && payload.tool_execution === undefined) {
      payload.tool_execution = executionMeta.tool_execution;
    }
    if (executionMeta.context_hygiene && payload.context_hygiene === undefined) {
      payload.context_hygiene = executionMeta.context_hygiene;
    }
    if (executionMeta.next_actions && payload.next_actions === undefined) {
      payload.next_actions = executionMeta.next_actions;
    }
    if (executionMeta.handoff && payload.handoff === undefined) {
      payload.handoff = executionMeta.handoff;
    }
    if (executionMeta.permission_gates && payload.permission_gates === undefined) {
      payload.permission_gates = executionMeta.permission_gates;
    }
    if (executionMeta.executor_signal && payload.executor_signal === undefined) {
      payload.executor_signal = executionMeta.executor_signal;
    }
    if (executionMeta.delegation_runtime && payload.delegation_runtime === undefined) {
      payload.delegation_runtime = executionMeta.delegation_runtime;
    }
    if (
      executionMeta.delegation_runtime &&
      executionMeta.delegation_runtime.review &&
      payload.redispatch_required === undefined
    ) {
      payload.redispatch_required = Boolean(executionMeta.delegation_runtime.review.redispatch_required);
    }
    if (executionMeta.worker_results && payload.worker_results === undefined) {
      payload.worker_results = executionMeta.worker_results;
    }
    if (executionMeta.subagent_bridge && payload.subagent_bridge === undefined) {
      payload.subagent_bridge = executionMeta.subagent_bridge;
    }

    return payload;
  }

  function buildRedispatchBlockedResult(dispatch, executionMeta, delegationRuntime, bridgeExecution) {
    const review = delegationRuntime && isObject(delegationRuntime.review)
      ? delegationRuntime.review
      : {};
    const stageA = review && isObject(review.stage_a) ? review.stage_a : {};
    const summary = String(
      review.summary ||
      'Stage A contract review failed; redispatch with a tighter worker contract before continuing.'
    ).trim();

    return annotateExecutionResult({
      status: 'redispatch-required',
      executed: false,
      reason: 'contract-review-failed',
      summary,
      blocked_by: {
        kind: 'review-gate',
        stage: stageA.id || 'contract-review',
        status: stageA.status || 'redispatch-required'
      },
      review_gate: {
        stage: stageA.id || 'contract-review',
        owner: stageA.owner || 'Current main thread',
        failure_action: stageA.failure_action || 'redispatch',
        status: stageA.status || 'redispatch-required'
      },
      recommended_next_step: 'Tighten the worker contract and redispatch; do not patch the remaining 10% inline in the main thread.'
    }, {
      ...executionMeta,
      kind: 'action-blocked',
      delegation_runtime: delegationRuntime,
      jobs: bridgeExecution.jobs,
      worker_results: bridgeExecution.worker_results,
      subagent_bridge: bridgeExecution.bridge
    });
  }

  function executeDispatchCommand(requestedAction, options) {
    const dispatch = buildDispatchContext(requestedAction);
    const runOptions = options && typeof options === 'object' ? options : {};
    const enteredVia = String(runOptions.entered_via || '').trim();
    const persistRuntime = runOptions.persist_runtime !== false;
    const delegationContext =
      runOptions.delegation_context && typeof runOptions.delegation_context === 'object'
        ? runOptions.delegation_context
        : dispatch;

    if (dispatch.tool_execution && dispatch.tool_execution.available && dispatch.tool_execution.recommended) {
      const toolRun = executeRecommendedTool(dispatch.tool_execution);
      const executionMeta = {
        source: dispatch.source,
        requested_action: dispatch.requested_action,
        resolved_action: dispatch.resolved_action,
        entered_via: enteredVia,
        kind: 'tool',
        cli: toolRun.argv.join(' '),
        workflow_stage: dispatch.workflow_stage || null,
        dispatch_contract:
          dispatch.agent_execution && dispatch.agent_execution.dispatch_contract
            ? dispatch.agent_execution.dispatch_contract
            : null,
        agent_execution: dispatch.agent_execution || null,
        tool_execution: {
          ...dispatch.tool_execution,
          argv: toolRun.argv
        },
        context_hygiene: dispatch.context_hygiene || null,
        next_actions: dispatch.next_actions || [],
        handoff: dispatch.handoff || null,
        permission_gates: dispatch.permission_gates || [],
        executor_signal: dispatch.executor_signal || null
      };
      const delegationRuntime = buildDelegationRuntimeSnapshot(dispatch, executionMeta);
      if (persistRuntime) {
        persistDelegationRuntime(delegationRuntime);
      }
      return annotateExecutionResult(toolRun.result, {
        ...executionMeta,
        delegation_runtime: delegationRuntime
      });
    }

    const executionMeta = {
      source: dispatch.source,
      requested_action: dispatch.requested_action,
      resolved_action: dispatch.resolved_action,
      entered_via: enteredVia,
      kind: 'action',
      cli: dispatch.cli || '',
      workflow_stage: dispatch.workflow_stage || null,
      dispatch_contract:
        dispatch.agent_execution && dispatch.agent_execution.dispatch_contract
          ? dispatch.agent_execution.dispatch_contract
          : null,
      agent_execution: dispatch.agent_execution || null,
      tool_execution: dispatch.tool_execution || null,
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || [],
      handoff: dispatch.handoff || null,
      permission_gates: dispatch.permission_gates || [],
      executor_signal: dispatch.executor_signal || null
    };
    const bridgeExecution = typeof runSubAgentBridge === 'function'
      ? runSubAgentBridge(delegationContext, executionMeta)
      : {
          bridge: null,
          launch_requests: [],
          jobs: [],
          worker_results: [],
          synthesis_status: 'pending'
        };
    const delegationRuntime = buildDelegationRuntimeSnapshot(dispatch, executionMeta);
    delegationRuntime.launch_requests = bridgeExecution.launch_requests.length > 0
      ? bridgeExecution.launch_requests
      : delegationRuntime.launch_requests;
    delegationRuntime.jobs = Array.isArray(bridgeExecution.jobs) ? bridgeExecution.jobs : [];
    delegationRuntime.worker_results = bridgeExecution.worker_results;
    if (delegationRuntime.synthesis && delegationRuntime.synthesis.required) {
      delegationRuntime.synthesis.status = bridgeExecution.synthesis_status || delegationRuntime.synthesis.status;
    }
    delegationRuntime.review = buildReviewRuntimeArtifact(
      executionMeta.dispatch_contract,
      delegationRuntime
    );
    if (persistRuntime) {
      persistDelegationRuntime(delegationRuntime);
    }
    if (delegationRuntime.review && delegationRuntime.review.redispatch_required) {
      return buildRedispatchBlockedResult(dispatch, executionMeta, delegationRuntime, bridgeExecution);
    }
    return annotateExecutionResult(executeResolvedAction(dispatch.resolved_action), {
      ...executionMeta,
      delegation_runtime: delegationRuntime,
      jobs: bridgeExecution.jobs,
      worker_results: bridgeExecution.worker_results,
      subagent_bridge: bridgeExecution.bridge
    });
  }

  function executeDispatchLaunchCommand(requestedAction, options) {
    const action = String(requestedAction || 'next').trim() || 'next';
    const dispatch = buildDispatchContext(action);
    const runOptions = options && typeof options === 'object' ? options : {};
    const enteredVia = String(runOptions.entered_via || '').trim();
    const delegationContext = runOptions.delegation_context || dispatch;
    const executionMeta = {
      source: dispatch.source,
      requested_action: dispatch.requested_action,
      resolved_action: dispatch.resolved_action,
      entered_via: enteredVia,
      kind: 'delegation-launch',
      cli: dispatch.cli || '',
      workflow_stage: dispatch.workflow_stage || null,
      dispatch_contract:
        dispatch.agent_execution && dispatch.agent_execution.dispatch_contract
          ? dispatch.agent_execution.dispatch_contract
          : null,
      agent_execution: dispatch.agent_execution || null,
      tool_execution: dispatch.tool_execution || null,
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || [],
      handoff: dispatch.handoff || null,
      permission_gates: dispatch.permission_gates || [],
      executor_signal: dispatch.executor_signal || null
    };
    const bridgeExecution = typeof runSubAgentBridge === 'function'
      ? runSubAgentBridge(delegationContext, executionMeta, { wait: false })
      : {
          bridge: null,
          launch_requests: [],
          jobs: [],
          worker_results: [],
          synthesis_status: 'pending'
        };
    const delegationRuntime = buildDelegationRuntimeSnapshot(dispatch, executionMeta);
    delegationRuntime.launch_requests = bridgeExecution.launch_requests.length > 0
      ? bridgeExecution.launch_requests
      : delegationRuntime.launch_requests;
    delegationRuntime.jobs = Array.isArray(bridgeExecution.jobs) ? bridgeExecution.jobs : [];
    delegationRuntime.worker_results = [];
    if (delegationRuntime.synthesis && delegationRuntime.synthesis.required) {
      delegationRuntime.synthesis.status = bridgeExecution.synthesis_status || delegationRuntime.synthesis.status;
    }
    delegationRuntime.review = buildReviewRuntimeArtifact(
      executionMeta.dispatch_contract,
      delegationRuntime
    );
    persistDelegationRuntime(delegationRuntime);

    return {
      launched: true,
      source: dispatch.source,
      requested_action: dispatch.requested_action,
      resolved_action: dispatch.resolved_action,
      execution: {
        kind: 'delegation-launch',
        entered_via: enteredVia
      },
      dispatch_contract:
        dispatch.agent_execution && dispatch.agent_execution.dispatch_contract
          ? dispatch.agent_execution.dispatch_contract
          : null,
      delegation_runtime: delegationRuntime,
      delegation_jobs: delegationRuntime.jobs,
      subagent_bridge: bridgeExecution.bridge,
      permission_gates: dispatch.permission_gates || [],
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || []
    };
  }

  function executeOrchestratorCommand(requestedAction, options) {
    const action = String(requestedAction || 'next').trim() || 'next';
    const orchestrator = buildOrchestratorContext(action);
    const runOptions = options && typeof options === 'object' ? options : {};
    const enteredVia = String(runOptions.entered_via || '').trim();
    const executed = executeDispatchCommand(action, {
      entered_via: enteredVia,
      persist_runtime: false,
      delegation_context: orchestrator
    });
    const delegationRuntime = executed.delegation_runtime || buildDelegationRuntimeSnapshot(orchestrator, executed.execution || {});
    persistDelegationRuntime(delegationRuntime);

    return {
      ...executed,
      mode: orchestrator.mode,
      workflow: orchestrator.workflow,
      orchestrator_steps: orchestrator.orchestrator_steps,
      dispatch_contract: orchestrator.dispatch_contract || executed.dispatch_contract || null,
      chip_support_health: orchestrator.chip_support_health || orchestrator.adapter_health || executed.chip_support_health || executed.adapter_health || null,
      action_context: orchestrator.action_context || executed.action_context || null,
      context_hygiene: executed.context_hygiene || orchestrator.context_hygiene || null,
      next_actions: executed.next_actions || orchestrator.next_actions || [],
      handoff: executed.handoff || orchestrator.handoff || null,
      permission_gates: executed.permission_gates || orchestrator.permission_gates || [],
      delegation_runtime: delegationRuntime
    };
  }

  function executeOrchestratorLaunchCommand(requestedAction, options) {
    const action = String(requestedAction || 'next').trim() || 'next';
    const orchestrator = buildOrchestratorContext(action);
    const runOptions = options && typeof options === 'object' ? options : {};
    const enteredVia = String(runOptions.entered_via || '').trim();
    const launched = executeDispatchLaunchCommand(action, {
      entered_via: enteredVia,
      delegation_context: orchestrator
    });
    const currentRuntime =
      launched.delegation_runtime || buildDelegationRuntimeSnapshot(orchestrator, launched.execution || {});
    persistDelegationRuntime(currentRuntime);

    return {
      ...launched,
      mode: orchestrator.mode,
      workflow: orchestrator.workflow,
      orchestrator_steps: orchestrator.orchestrator_steps,
      dispatch_contract: orchestrator.dispatch_contract || launched.dispatch_contract || null,
      chip_support_health: orchestrator.chip_support_health || orchestrator.adapter_health || null,
      action_context: orchestrator.action_context || null,
      handoff: orchestrator.handoff || launched.handoff || null,
      permission_gates: launched.permission_gates || orchestrator.permission_gates || [],
      delegation_runtime: currentRuntime,
      delegation_jobs: currentRuntime.jobs || []
    };
  }

  function handleDispatchCommands(cmd, subcmd, rest) {
    if (cmd === 'schedule' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return scheduler.buildSchedule(rest[0], resolveSession());
    }

    if (cmd === 'dispatch' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return buildDispatchContext(rest[0]);
    }

    if (cmd === 'dispatch' && subcmd === 'next') {
      return buildDispatchContext('next');
    }

    if (cmd === 'dispatch' && subcmd === 'run') {
      return executeDispatchCommand(rest[0] || 'next', {
        entered_via: `dispatch run ${rest[0] || 'next'}`
      });
    }

    if (cmd === 'dispatch' && subcmd === 'launch') {
      return executeDispatchLaunchCommand(rest[0] || 'next', {
        entered_via: `dispatch launch ${rest[0] || 'next'}`
      });
    }

    if (cmd === 'dispatch' && subcmd === 'collect') {
      const collected = typeof collectSubAgentBridgeJobs === 'function'
        ? collectSubAgentBridgeJobs()
        : { jobs: [], worker_results: [], synthesis_status: 'pending', collected_at: new Date().toISOString() };
      return buildDelegationCollectionResult(collected, 'dispatch collect');
    }

    if (cmd === 'orchestrate' && (!subcmd || subcmd === 'next')) {
      return buildOrchestratorContext('next');
    }

    if (cmd === 'orchestrate' && subcmd === 'run') {
      return executeOrchestratorCommand(rest[0] || 'next', {
        entered_via: `orchestrate run ${rest[0] || 'next'}`
      });
    }

    if (cmd === 'orchestrate' && subcmd === 'launch') {
      return executeOrchestratorLaunchCommand(rest[0] || 'next', {
        entered_via: `orchestrate launch ${rest[0] || 'next'}`
      });
    }

    if (cmd === 'orchestrate' && subcmd === 'collect') {
      const collected = typeof collectSubAgentBridgeJobs === 'function'
        ? collectSubAgentBridgeJobs()
        : { jobs: [], worker_results: [], synthesis_status: 'pending', collected_at: new Date().toISOString() };
      return buildDelegationCollectionResult(collected, 'orchestrate collect');
    }

    if (cmd === 'orchestrate' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return buildOrchestratorContext(rest[0]);
    }

    if (cmd === 'orchestrate' && ['scan', 'plan', 'do', 'debug', 'review', 'verify', 'note', 'arch-review'].includes(subcmd)) {
      return buildOrchestratorContext(subcmd);
    }

    return undefined;
  }

  return {
    handleDispatchCommands,
    executeDispatchCommand,
    executeOrchestratorCommand
  };
}

module.exports = {
  createDispatchCommandRuntimeHelpers
};
