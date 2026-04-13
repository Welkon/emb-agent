'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');

function createCommandGroupHelpers(deps) {
  const {
    runtime,
    scheduler,
    toolCatalog,
    toolRuntime,
    chipCatalog,
    ROOT,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    resolveSession,
    updateSession,
    runSubAgentBridge,
    collectSubAgentBridgeJobs,
    buildActionOutput,
    buildReviewContext,
    buildArchReviewContext,
    buildDispatchContext,
    buildOrchestratorContext,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    bootstrapAdapterSource,
    parseAdapterSyncArgs,
    syncNamedAdapterSource,
    syncAllAdapterSources,
    runAdapterDerive,
    runAdapterGenerate,
    handleCatalogAndStateCommands,
    saveScanReport,
    savePlanReport,
    saveReviewReport,
    confirmVerifySignoff,
    rejectVerifySignoff,
    saveVerifyReport,
    addNoteEntry,
    ingestDocCli,
    referenceLookupCli
  } = deps;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function rememberDocFiles(files, commandName) {
    updateSession(current => {
      current.last_command = commandName;
      current.last_files = runtime
        .unique([...(files || []), ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
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
      tool_scope: normalizeToolScope(call.tool_scope)
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

    return {
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

  function handleDocCommands(cmd, subcmd, rest) {
    if (cmd === 'doc' && subcmd === 'list') {
      const docs = ingestDocCli.listDocs(resolveProjectRoot());
      updateSession(current => {
        current.last_command = 'doc list';
      });
      return docs;
    }

    if (cmd === 'doc' && subcmd === 'lookup') {
      const result = referenceLookupCli.lookupDocs(resolveProjectRoot(), rest);
      rememberDocFiles(
        (result.candidates || [])
          .filter(item => item && item.fetch_required === false)
          .map(item => item.location),
        'doc lookup'
      );
      return result;
    }

    if (cmd === 'doc' && subcmd === 'fetch') {
      return referenceLookupCli.fetchDocument(resolveProjectRoot(), rest).then(result => {
        rememberDocFiles([result.output], 'doc fetch');
        return result;
      });
    }

    if (cmd === 'doc' && subcmd === 'show') {
      const showArgs = ingestDocCli.parseShowArgs(rest);
      const docView = ingestDocCli.showDoc(resolveProjectRoot(), showArgs.docId, {
        preset: showArgs.preset,
        applyReady: showArgs.applyReady
      });
      rememberDocFiles([
        docView.entry.artifacts && docView.entry.artifacts.markdown,
        docView.entry.artifacts && docView.entry.artifacts.metadata,
        docView.entry.artifacts && docView.entry.artifacts.source
      ], 'doc show');
      return docView;
    }

    if (cmd === 'doc' && subcmd === 'diff') {
      if (!rest[0]) throw new Error('Missing doc id');
      const diffArgs = ingestDocCli.parseDiffArgs(['doc', ...rest]);
      const diffView = ingestDocCli.diffDoc(
        resolveProjectRoot(),
        diffArgs.docId,
        diffArgs.to,
        diffArgs.only,
        diffArgs.force
      );
      ingestDocCli.rememberLastDiff(resolveProjectRoot(), diffView);
      rememberDocFiles([diffView.draft, diffView.target], 'doc diff');
      if (!diffArgs.saveAs) {
        return diffView;
      }

      const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
        action_kind: 'write',
        action_name: 'doc-diff-save-preset',
        risk: 'normal',
        explicit_confirmation: diffArgs.explicit_confirmation === true,
        permissions:
          (resolveSession() &&
            resolveSession().project_config &&
            resolveSession().project_config.permissions) || {}
      });
      const blocked = permissionGateHelpers.applyPermissionDecision({
        ...diffView,
        saved_preset: {
          name: diffArgs.saveAs,
          saved: false
        }
      }, permissionDecision);

      if (permissionDecision.decision !== 'allow') {
        return blocked;
      }

      return permissionGateHelpers.applyPermissionDecision({
        ...diffView,
        saved_preset: ingestDocCli.saveDiffPreset(resolveProjectRoot(), diffArgs.saveAs, diffView)
      }, permissionDecision);
    }

    if (cmd === 'component' && subcmd === 'lookup') {
      const result = referenceLookupCli.lookupComponents(resolveProjectRoot(), rest);
      if (result && typeof result.then === 'function') {
        return result.then(resolved => {
          rememberDocFiles(
            (resolved.components || [])
              .map(item => item.parsed_source)
              .filter(Boolean),
            'component lookup'
          );
          return resolved;
        });
      }
      rememberDocFiles(
        (result.components || [])
          .map(item => item.parsed_source)
          .filter(Boolean),
        'component lookup'
      );
      return result;
    }

    return undefined;
  }

  function handleActionCommands(cmd, subcmd, rest) {
    if (cmd === 'scan' && subcmd === 'save') {
      return saveScanReport(rest);
    }

    if (cmd === 'scan') {
      updateSession(current => {
        current.last_command = 'scan';
      });
      return buildActionOutput('scan');
    }

    if (cmd === 'plan' && subcmd === 'save') {
      return savePlanReport(rest);
    }

    if (cmd === 'plan') {
      updateSession(current => {
        current.last_command = 'plan';
      });
      return buildActionOutput('plan');
    }

    if (cmd === 'arch-review') {
      updateSession(current => {
        current.last_command = 'arch-review';
      });
      return buildArchReviewContext();
    }

    if (cmd === 'do') {
      updateSession(current => {
        current.last_command = 'do';
      });
      return buildActionOutput('do');
    }

    if (cmd === 'debug') {
      updateSession(current => {
        current.last_command = 'debug';
      });
      return buildActionOutput('debug');
    }

    if (cmd === 'review' && subcmd === 'context') {
      return buildReviewContext();
    }

    if (cmd === 'review' && subcmd === 'axes') {
      return { review_axes: resolveSession().effective.review_axes };
    }

    if (cmd === 'review' && subcmd === 'save') {
      return saveReviewReport(rest);
    }

    if (cmd === 'review' && !subcmd) {
      updateSession(current => {
        current.last_command = 'review';
      });
      return buildActionOutput('review');
    }

    if (cmd === 'verify' && subcmd === 'save') {
      return saveVerifyReport(rest);
    }

    if (cmd === 'verify' && subcmd === 'confirm') {
      return confirmVerifySignoff(rest);
    }

    if (cmd === 'verify' && subcmd === 'reject') {
      return rejectVerifySignoff(rest);
    }

    if (cmd === 'verify') {
      updateSession(current => {
        current.last_command = 'verify';
      });
      return buildActionOutput('verify');
    }

    if (cmd === 'note' && subcmd === 'targets') {
      return { note_targets: resolveSession().effective.note_targets };
    }

    if (cmd === 'note' && subcmd === 'add') {
      return addNoteEntry(rest);
    }

    if (cmd === 'note' && !subcmd) {
      updateSession(current => {
        current.last_command = 'note';
      });
      return buildActionOutput('note');
    }

    return undefined;
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
    if (executionMeta.worker_results && payload.worker_results === undefined) {
      payload.worker_results = executionMeta.worker_results;
    }
    if (executionMeta.subagent_bridge && payload.subagent_bridge === undefined) {
      payload.subagent_bridge = executionMeta.subagent_bridge;
    }

    return payload;
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
    if (persistRuntime) {
      persistDelegationRuntime(delegationRuntime);
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
      adapter_health: orchestrator.adapter_health || executed.adapter_health || null,
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
      adapter_health: orchestrator.adapter_health || null,
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

  function handleAdapterToolChipCommands(cmd, subcmd, rest) {
    if (cmd === 'adapter' && subcmd === 'status') {
      return buildAdapterStatus(rest[0] || '');
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'list') {
      return buildAdapterStatus();
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing source name');
      return buildAdapterStatus(rest[1]);
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'add') {
      if (!rest[1]) throw new Error('Missing source name');
      return addAdapterSource(rest[1], rest.slice(2));
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'remove') {
      if (!rest[1]) throw new Error('Missing source name');
      return removeAdapterSource(rest[1], rest.slice(2));
    }

    if (cmd === 'adapter' && subcmd === 'bootstrap') {
      if (rest[0] && !rest[0].startsWith('--')) {
        return bootstrapAdapterSource(rest[0], rest.slice(1));
      }
      return bootstrapAdapterSource('', rest);
    }

    if (cmd === 'adapter' && subcmd === 'sync') {
      if (rest[0] === '--all') {
        const parsedAll = parseAdapterSyncArgs(rest);
        return syncAllAdapterSources(parsedAll);
      }

      if (!rest[0] || rest[0].startsWith('--')) {
        throw new Error('Missing source name');
      }

      return syncNamedAdapterSource(rest[0], parseAdapterSyncArgs(rest.slice(1)));
    }

    if (cmd === 'adapter' && subcmd === 'derive') {
      return runAdapterDerive(rest);
    }

    if (cmd === 'adapter' && subcmd === 'generate') {
      return runAdapterGenerate(rest);
    }

    if (cmd === 'tool' && subcmd === 'list') {
      return toolCatalog.listToolSpecs(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing tool name');
      return toolCatalog.loadToolSpec(ROOT, rest[0]);
    }

    if (cmd === 'tool' && subcmd === 'run') {
      if (!rest[0]) throw new Error('Missing tool name');
      return toolRuntime.runTool(ROOT, rest[0], rest.slice(1));
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'list') {
      return toolCatalog.listFamilies(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing family name');
      return toolCatalog.loadFamily(ROOT, rest[1]);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'list') {
      return toolCatalog.listDevices(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing device name');
      return toolCatalog.loadDevice(ROOT, rest[1]);
    }

    if (cmd === 'chip' && subcmd === 'list') {
      return chipCatalog.listChips(ROOT);
    }

    if (cmd === 'chip' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing chip name');
      return chipCatalog.loadChip(ROOT, rest[0]);
    }

    return undefined;
  }

  return {
    handleDocCommands,
    handleActionCommands,
    handleDispatchCommands,
    handleAdapterToolChipCommands,
    executeDispatchCommand,
    executeOrchestratorCommand
  };
}

module.exports = {
  createCommandGroupHelpers
};
