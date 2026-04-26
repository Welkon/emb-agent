'use strict';

const capabilityCatalog = require('./capability-catalog.cjs');

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
    executeCapability,
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
        ? 'Stage A status=redispatch-required. Tighten the worker contract and redispatch. Do not patch inline.'
        : stageAStatus === 'passed'
          ? 'Stage A status=passed. Run Stage B quality review next.'
          : blockedWithoutResults
            ? 'Stage A status=blocked-no-worker-results. Worker outputs are unavailable.'
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

  function loadWalkthroughRuntime() {
    const currentSession = resolveSession();
    return currentSession &&
      currentSession.session &&
      currentSession.session.diagnostics &&
      isObject(currentSession.session.diagnostics.walkthrough_runtime)
        ? currentSession.session.diagnostics.walkthrough_runtime
        : null;
  }

  function persistWalkthroughRuntime(snapshot) {
    const walkthroughRuntime = isObject(snapshot) ? snapshot : {
      kind: '',
      status: '',
      ordered_tools: [],
      current_index: 0,
      completed_count: 0,
      total_steps: 0,
      last_tool: '',
      last_summary: '',
      steps: [],
      updated_at: ''
    };
    updateSession(current => {
      current.diagnostics = isObject(current.diagnostics) ? current.diagnostics : {};
      current.diagnostics.walkthrough_runtime = walkthroughRuntime;
    });
  }

  function buildWalkthroughRuntime(dispatch) {
    const recommendation = isObject(dispatch && dispatch.walkthrough_recommendation)
      ? dispatch.walkthrough_recommendation
      : null;
    if (!recommendation) {
      return null;
    }

    const previous = loadWalkthroughRuntime();
    const orderedTools = Array.isArray(recommendation.ordered_tools)
      ? recommendation.ordered_tools.map(item => String(item))
      : [];
    const sequence = Array.isArray(recommendation.recommended_sequence)
      ? recommendation.recommended_sequence
      : [];
    const sequenceMap = new Map(
      sequence
        .filter(item => isObject(item) && item.tool)
        .map(item => [String(item.tool), item])
    );
    const matchesPrevious = Boolean(
      previous &&
      previous.kind === recommendation.kind &&
      Array.isArray(previous.ordered_tools) &&
      previous.ordered_tools.length === orderedTools.length &&
      previous.ordered_tools.every((item, index) => item === orderedTools[index])
    );
    const previousSteps = matchesPrevious && Array.isArray(previous.steps) ? previous.steps : [];

    const steps = orderedTools.map(toolName => {
      const sequenceItem = sequenceMap.get(toolName) || {};
      const previousStep = previousSteps.find(item => item && item.tool === toolName) || {};
      const preservedStatus = ['ok', 'skipped', 'needs-input', 'error'].includes(String(previousStep.status || ''))
        ? String(previousStep.status)
        : 'pending';
      return {
        tool: toolName,
        status: preservedStatus,
        cli: sequenceItem.cli_draft ? String(sequenceItem.cli_draft) : String(previousStep.cli || ''),
        argv: Array.isArray(sequenceItem.argv) && sequenceItem.argv.length > 0
          ? sequenceItem.argv.map(item => String(item))
          : (Array.isArray(previousStep.argv) ? previousStep.argv.map(item => String(item)) : []),
        missing_inputs: Array.isArray(sequenceItem.missing_inputs)
          ? sequenceItem.missing_inputs.map(item => String(item))
          : [],
        defaults_applied: isObject(sequenceItem.defaults_applied)
          ? sequenceItem.defaults_applied
          : (isObject(previousStep.defaults_applied) ? previousStep.defaults_applied : {}),
        trust: isObject(sequenceItem.trust) ? sequenceItem.trust : (isObject(previousStep.trust) ? previousStep.trust : null),
        summary: String(previousStep.summary || ''),
        updated_at: String(previousStep.updated_at || '')
      };
    });

    const completedCount = steps.filter(item => ['ok', 'skipped'].includes(item.status)).length;
    const currentIndex = steps.findIndex(item => !['ok', 'skipped'].includes(item.status));
    const normalizedIndex = currentIndex === -1 ? steps.length : currentIndex;
    const currentStep = steps[normalizedIndex] || null;

    return {
      kind: String(recommendation.kind || ''),
      status: steps.length === 0
        ? 'idle'
        : completedCount >= steps.length
          ? 'completed'
          : currentStep && ['needs-input', 'error'].includes(currentStep.status)
            ? currentStep.status
            : 'running',
      ordered_tools: orderedTools,
      current_index: normalizedIndex,
      completed_count: completedCount,
      total_steps: steps.length,
      last_tool: matchesPrevious ? String(previous.last_tool || '') : '',
      last_summary: matchesPrevious ? String(previous.last_summary || '') : '',
      steps,
      updated_at: matchesPrevious ? String(previous.updated_at || '') : ''
    };
  }

  function summarizeWalkthroughRuntime(snapshot) {
    const runtime = isObject(snapshot) ? snapshot : {};
    const steps = Array.isArray(runtime.steps) ? runtime.steps : [];
    const currentIndex = Number.isInteger(runtime.current_index) ? runtime.current_index : 0;
    const currentStep = steps[currentIndex] || null;
    return {
      kind: runtime.kind || '',
      status: runtime.status || '',
      total_steps: Number.isInteger(runtime.total_steps) ? runtime.total_steps : steps.length,
      completed_count: Number.isInteger(runtime.completed_count)
        ? runtime.completed_count
        : steps.filter(item => item && ['ok', 'skipped'].includes(item.status)).length,
      current_index: currentIndex,
      current_tool: currentStep && currentStep.tool ? currentStep.tool : '',
      current_cli: currentStep && currentStep.cli ? currentStep.cli : '',
      last_tool: runtime.last_tool || '',
      last_summary: runtime.last_summary || '',
      completed_steps: steps
        .filter(item => item && ['ok', 'skipped'].includes(item.status))
        .map(item => item.tool),
      remaining_steps: steps
        .filter(item => item && !['ok', 'skipped'].includes(item.status))
        .map(item => item.tool),
      updated_at: runtime.updated_at || ''
    };
  }

  function buildToolExecutionFromWalkthroughStep(step) {
    const safeStep = isObject(step) ? step : {};
    return {
      available: Boolean(safeStep.tool),
      recommended: Boolean(safeStep.tool),
      tool: safeStep.tool || '',
      status: safeStep.status || 'ready',
      argv: Array.isArray(safeStep.argv) ? safeStep.argv.map(item => String(item)) : [],
      cli: safeStep.cli || '',
      missing_inputs: Array.isArray(safeStep.missing_inputs) ? safeStep.missing_inputs.map(item => String(item)) : [],
      defaults_applied: isObject(safeStep.defaults_applied) ? safeStep.defaults_applied : {},
      trust: isObject(safeStep.trust) ? safeStep.trust : null
    };
  }

  function summarizeWalkthroughStepResult(toolName, result, stepStatus) {
    const safeResult = isObject(result) ? result : {};
    if (safeResult.summary) {
      return String(safeResult.summary);
    }
    if (stepStatus === 'ok') {
      return `Walkthrough step ${toolName} completed.`;
    }
    if (stepStatus === 'needs-input') {
      const missingInputs = Array.isArray(safeResult.missing_inputs) ? safeResult.missing_inputs : [];
      return `Walkthrough step ${toolName} is blocked by missing inputs: ${missingInputs.join(', ')}`;
    }
    return `Walkthrough step ${toolName} stopped with status ${stepStatus}.`;
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

    if (action === 'update') {
      return handleCatalogAndStateCommands(action, '', []);
    }

    if (typeof executeCapability === 'function') {
      return executeCapability(action, {
        skip_session_update: true,
        session_command: action
      });
    }

    if (typeof handleActionCommands === 'function') {
      const actionResult = handleActionCommands(action, '', []);
      if (actionResult !== undefined) {
        return actionResult;
      }
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

    const missingInputs = Array.isArray(execution.missing_inputs)
      ? execution.missing_inputs.filter(Boolean)
      : [];
    if (missingInputs.length > 0) {
      return {
        argv,
        result: {
          status: 'needs-input',
          executed: false,
          reason: 'missing-tool-inputs',
          summary: `Tool ${execution.tool} status=needs-input. Missing inputs: ${missingInputs.join(', ')}`,
          tool: execution.tool,
          cli_draft: execution.cli || '',
          missing_inputs: missingInputs,
          defaults_applied: execution.defaults_applied || {},
          trust: execution.trust || null
        }
      };
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
    if (executionMeta.walkthrough_recommendation && payload.walkthrough_recommendation === undefined) {
      payload.walkthrough_recommendation = executionMeta.walkthrough_recommendation;
    }
    if (executionMeta.walkthrough_execution && payload.walkthrough_execution === undefined) {
      payload.walkthrough_execution = executionMeta.walkthrough_execution;
    }
    if (executionMeta.walkthrough_runtime && payload.walkthrough_runtime === undefined) {
      payload.walkthrough_runtime = executionMeta.walkthrough_runtime;
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

  function executeWalkthroughStep(dispatch, enteredVia, persistRuntime) {
    const walkthroughRuntime = buildWalkthroughRuntime(dispatch);
    if (!walkthroughRuntime) {
      throw new Error('Missing walkthrough runtime');
    }

    const currentIndex = Number.isInteger(walkthroughRuntime.current_index)
      ? walkthroughRuntime.current_index
      : 0;
    const currentStep = walkthroughRuntime.steps[currentIndex] || null;
    const executionMeta = {
      source: dispatch.source,
      requested_action: dispatch.requested_action,
      resolved_action: dispatch.resolved_action,
      entered_via: enteredVia,
      kind: 'walkthrough-tool',
      cli: currentStep && currentStep.cli ? currentStep.cli : '',
      workflow_stage: dispatch.workflow_stage || null,
      dispatch_contract:
        dispatch.agent_execution && dispatch.agent_execution.dispatch_contract
          ? dispatch.agent_execution.dispatch_contract
          : null,
      agent_execution: dispatch.agent_execution || null,
      tool_execution: currentStep ? buildToolExecutionFromWalkthroughStep(currentStep) : null,
      walkthrough_recommendation: dispatch.walkthrough_recommendation || null,
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || [],
      handoff: dispatch.handoff || null,
      permission_gates: dispatch.permission_gates || [],
      executor_signal: dispatch.executor_signal || null
    };
    const delegationRuntime = buildDelegationRuntimeSnapshot(dispatch, executionMeta);

    if (!currentStep) {
      walkthroughRuntime.status = 'completed';
      walkthroughRuntime.current_index = walkthroughRuntime.total_steps || walkthroughRuntime.steps.length;
      walkthroughRuntime.updated_at = new Date().toISOString();
      if (persistRuntime) {
        persistDelegationRuntime(delegationRuntime);
        persistWalkthroughRuntime(walkthroughRuntime);
      }
      return annotateExecutionResult({
        status: 'completed',
        executed: false,
        summary: walkthroughRuntime.last_summary || 'Walkthrough already completed.',
        walkthrough_step: null,
        completed_steps: summarizeWalkthroughRuntime(walkthroughRuntime).completed_steps,
        remaining_steps: []
      }, {
        ...executionMeta,
        delegation_runtime: delegationRuntime,
        walkthrough_execution: summarizeWalkthroughRuntime(walkthroughRuntime),
        walkthrough_runtime: walkthroughRuntime
      });
    }

    const toolExecution = buildToolExecutionFromWalkthroughStep(currentStep);
    const toolRun = executeRecommendedTool(toolExecution);
    const result = isObject(toolRun.result) ? { ...toolRun.result } : { result: toolRun.result };
    const now = new Date().toISOString();
    const nextRuntime = {
      ...walkthroughRuntime,
      steps: walkthroughRuntime.steps.map((step, index) => {
        if (index !== currentIndex) {
          return step;
        }

        const stepStatus =
          result.status === 'needs-input'
            ? 'needs-input'
            : ['failed', 'error', 'blocked'].includes(String(result.status || ''))
              ? 'error'
              : 'ok';
        return {
          ...step,
          cli: toolRun.argv.join(' '),
          argv: toolRun.argv.slice(),
          missing_inputs: Array.isArray(result.missing_inputs)
            ? result.missing_inputs.map(item => String(item))
            : (Array.isArray(step.missing_inputs) ? step.missing_inputs : []),
          summary: summarizeWalkthroughStepResult(step.tool, result, stepStatus),
          status: stepStatus,
          updated_at: now
        };
      }),
      last_tool: currentStep.tool,
      updated_at: now
    };

    nextRuntime.completed_count = nextRuntime.steps.filter(item => ['ok', 'skipped'].includes(item.status)).length;
    const nextIndex = nextRuntime.steps.findIndex(item => !['ok', 'skipped'].includes(item.status));
    nextRuntime.current_index = nextIndex === -1 ? nextRuntime.steps.length : nextIndex;
    const nextStep = nextRuntime.steps[nextRuntime.current_index] || null;
    const latestStep = nextRuntime.steps[currentIndex] || currentStep;
    nextRuntime.last_summary = latestStep.summary || '';
    nextRuntime.status = nextRuntime.steps.length === 0
      ? 'idle'
      : nextRuntime.completed_count >= nextRuntime.steps.length
        ? 'completed'
        : latestStep.status === 'needs-input'
          ? 'needs-input'
          : latestStep.status === 'error'
            ? 'error'
            : 'running';

    if (persistRuntime) {
      persistDelegationRuntime(delegationRuntime);
      persistWalkthroughRuntime(nextRuntime);
    }

    const walkthroughExecution = summarizeWalkthroughRuntime(nextRuntime);
    const recommendedNextStep = nextRuntime.status === 'completed'
      ? ''
      : nextStep && Array.isArray(nextStep.missing_inputs) && nextStep.missing_inputs.length > 0
        ? `Provide inputs for ${nextStep.tool}: ${nextStep.missing_inputs.join(', ')}`
        : nextStep && nextStep.cli
          ? nextStep.cli
          : '';

    return annotateExecutionResult({
      ...result,
      summary: latestStep.summary || result.summary || '',
      walkthrough_step: {
        tool: currentStep.tool,
        status: latestStep.status,
        cli: toolRun.argv.join(' '),
        summary: latestStep.summary || '',
        index: currentIndex + 1
      },
      completed_steps: walkthroughExecution.completed_steps,
      remaining_steps: walkthroughExecution.remaining_steps,
      recommended_next_step: recommendedNextStep
    }, {
      ...executionMeta,
      cli: toolRun.argv.join(' '),
      tool_execution: {
        ...toolExecution,
        argv: toolRun.argv
      },
      delegation_runtime: delegationRuntime,
      walkthrough_execution: walkthroughExecution,
      walkthrough_runtime: nextRuntime
    });
  }

  function buildRedispatchBlockedResult(dispatch, executionMeta, delegationRuntime, bridgeExecution) {
    const review = delegationRuntime && isObject(delegationRuntime.review)
      ? delegationRuntime.review
      : {};
    const stageA = review && isObject(review.stage_a) ? review.stage_a : {};
    const summary = String(
      review.summary ||
      'Stage A status=redispatch-required. Tighten the worker contract and redispatch before continuing.'
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
      recommended_next_step: 'Tighten the worker contract, then redispatch. Do not patch the remaining gap inline in the main thread.'
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

    if (
      dispatch.walkthrough_recommendation &&
      dispatch.walkthrough_execution &&
      dispatch.tool_execution &&
      dispatch.tool_execution.available &&
      dispatch.tool_execution.recommended
    ) {
      return executeWalkthroughStep(dispatch, enteredVia, persistRuntime);
    }

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
        walkthrough_recommendation: dispatch.walkthrough_recommendation || null,
        walkthrough_execution: dispatch.walkthrough_execution || null,
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
      walkthrough_recommendation: dispatch.walkthrough_recommendation || null,
      walkthrough_execution: dispatch.walkthrough_execution || null,
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
    if (executed.walkthrough_runtime) {
      persistWalkthroughRuntime(executed.walkthrough_runtime);
    }

    return {
      ...executed,
      mode: orchestrator.mode,
      workflow: orchestrator.workflow,
      orchestrator_steps: orchestrator.orchestrator_steps,
      dispatch_contract: orchestrator.dispatch_contract || executed.dispatch_contract || null,
      chip_support_health: orchestrator.chip_support_health || executed.chip_support_health || null,
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
      chip_support_health: orchestrator.chip_support_health || null,
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

    if (cmd === 'orchestrate' && capabilityCatalog.getOrchestratableCapabilityNames().includes(subcmd)) {
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
