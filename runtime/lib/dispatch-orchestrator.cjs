'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');

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

  function buildDispatchContext(requestedAction) {
    const action = (requestedAction || '').trim();

    if (!action) {
      throw new Error('Missing action name');
    }

    if (action === 'next') {
      const next = buildNextContext();
      const resolvedAction = next.next.command;

      if (resolvedAction === 'arch-review') {
        const archDispatch = buildArchReviewDispatchContext();
        return {
          source: 'next',
          requested_action: 'next',
          resolved_action: resolvedAction,
          reason: next.next.reason,
          skill: archDispatch.skill,
          cli: archDispatch.cli,
          dispatch_ready: archDispatch.dispatch_ready,
          agent_execution: archDispatch.agent_execution,
          context_hygiene: next.context_hygiene,
          next_actions: next.next_actions,
          current: next.current,
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
        skill: next.next.skill,
        cli: next.next.cli,
        dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
        agent_execution: output.agent_execution || null,
        context_hygiene: next.context_hygiene,
        next_actions: next.next_actions,
        current: next.current,
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

    return {
      source: 'action',
      requested_action: action,
      resolved_action: action,
      reason: `direct dispatch for ${action}`,
      skill: `$emb-${action}`,
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [action]),
      dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
      agent_execution: output.agent_execution || null,
      context_hygiene: output.context_hygiene || null,
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
        when: 'clear context 后或需要恢复当前项目上下文时',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
        outcome: '恢复当前项目 session、handoff 和轻量工作上下文'
      }
    ];

    if (toolExecution && toolExecution.available) {
      steps.push({
        id: 'run-tool',
        kind: 'tool',
        required: toolExecution.recommended,
        when: toolExecution.recommended
          ? '当前 scan 已识别到可直接执行的硬件计算工具，先收敛寄存器/公式真值'
          : '如需继续推进该工具，先补齐缺失依赖或 adapter',
        cli: toolExecution.cli,
        tool: toolExecution.tool,
        status: toolExecution.status,
        reason: toolExecution.reason,
        missing_inputs: toolExecution.missing_inputs || [],
        defaults_applied: toolExecution.defaults_applied || {},
        outcome: toolExecution.recommended
          ? '先产出工具计算结果，再决定是否继续 scan / debug / do'
          : '当前只输出工具草案和缺失输入，不直接执行'
      });
    }

    if (!execution.available || !execution.recommended) {
      steps.push({
        id: 'inline-action',
        kind: 'inline',
        required: true,
        when: '当前动作不值得展开子 agent，或 inline 已足够',
        cli: dispatch.cli,
        outcome: '由当前主线程直接执行当前动作并产出 emb 标准结果'
      });
    } else {
      if (primary) {
        steps.push({
          id: 'launch-primary',
          kind: 'agent',
          required: true,
          blocking: primary.blocking !== false,
          agent: primary.agent,
          when: primary.when || '当前动作需要主 agent 时',
          start_when: primary.start_when || '立即启动',
          preferred_cli: dispatch.skill,
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
          when: '主线程需要补侧证据且 agent 被标记为并行安全时',
          start_rule: '不要让多个可写 agent 修改同一组文件',
          outcome: supporting.map(item => ({
            agent: item.agent,
            expected_output: item.expected_output || []
          }))
        });
      }
    }

    steps.push({
      id: 'integrate',
      kind: 'integration',
      required: true,
      owner: contract.integration_owner || '当前主线程',
      when: '收到 inline 结果或子 agent 结果后',
      outcome: [
        '整合回 emb 标准输出，不直接拼接原始子 agent 回复',
        '保留最终结论、落盘和验证责任'
      ]
    });

    if (dispatch.context_hygiene && dispatch.context_hygiene.level !== 'ok') {
      steps.push({
        id: 'context-hygiene',
        kind: 'context',
        required: false,
        when: '动作完成后上下文继续变重时',
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
      workflow: {
        style: 'action-based',
        orchestration_weight: 'light',
        suggested_flow: guidance.suggested_flow,
        next_skill: dispatch.skill,
        next_cli: dispatch.cli,
        strategy: toolExecution && toolExecution.recommended ? 'inline-tool-first' : strategy,
        tool_first: Boolean(toolExecution && toolExecution.recommended),
        tool_cli: toolExecution ? toolExecution.cli : '',
        tool_name: toolExecution ? toolExecution.tool : '',
        primary_agent: execution.primary_agent || '',
        supporting_agents: execution.supporting_agents || [],
        wait_strategy: execution.wait_strategy || '主线程继续推进，只有在主路径被阻塞时才等待',
        main_thread_owner: '当前主线程'
      },
      orchestrator_steps: buildOrchestratorSteps(dispatch),
      context_hygiene: dispatch.context_hygiene || null,
      next_actions: dispatch.next_actions || guidance.next_actions,
      tool_execution: toolExecution,
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
