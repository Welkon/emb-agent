'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createActionContractHelpers(deps) {
  const {
    runtime,
    scheduler,
    resolveSession,
    loadHandoff,
    buildHealthReport,
    buildContextHygiene,
    enrichWithToolSuggestions,
    buildArchReviewContext
  } = deps;

  function buildActionOutput(action) {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    let output;

    if (action === 'scan') {
      output = scheduler.buildScanOutput(resolved);
    } else if (action === 'plan') {
      output = scheduler.buildPlanOutput(resolved);
    } else if (action === 'do') {
      output = scheduler.buildDoOutput(resolved);
    } else if (action === 'debug') {
      output = scheduler.buildDebugOutput(resolved);
    } else if (action === 'review') {
      output = scheduler.buildReviewOutput(resolved);
    } else if (action === 'forensics') {
      output = scheduler.buildForensicsOutput(resolved);
    } else if (action === 'note') {
      output = scheduler.buildNoteOutput(resolved);
    } else if (action === 'health') {
      const health = buildHealthReport();
      output = {
        checks: health.checks || [],
        recommendations: health.recommendations || [],
        next_commands: health.next_commands || [],
        quickstart: health.quickstart || null,
        summary: health.summary || {},
        status: health.status || 'warn',
        scheduler: {
          primary_agent: '',
          supporting_agents: [],
          parallel_safe: false,
          agent_execution: {
            available: false,
            spawn_available: false,
            recommended: false,
            inline_ok: true,
            mode: 'inline-preferred',
            reason: 'health 是只读自检动作，默认由当前主线程 inline 执行。',
            primary_agent: '',
            supporting_agents: [],
            dispatch_contract: null
          }
        }
      };
    } else {
      throw new Error(`Unsupported action: ${action}`);
    }

    return enrichWithToolSuggestions({
      ...output,
      agent_execution: output.scheduler && output.scheduler.agent_execution
        ? output.scheduler.agent_execution
        : scheduler.buildAgentExecution(action, resolved),
      context_hygiene: buildContextHygiene(resolved, handoff, action)
    }, resolved);
  }

  function buildArchReviewDispatchContext() {
    const context = buildArchReviewContext();

    return {
      requested_action: 'arch-review',
      resolved_action: 'arch-review',
      reason: context.warning,
      skill: '$emb-arch-review',
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['arch-review']),
      dispatch_ready: true,
      agent_execution: {
        available: true,
        spawn_available: true,
        recommended: true,
        inline_ok: false,
        mode: 'primary-recommended',
        reason: '显式架构预审应直接交给 emb-arch-reviewer 主导。',
        primary_agent: context.suggested_agent,
        supporting_agents: runtime.unique(context.review_agents || []),
        dispatch_contract: {
          launch_via: 'installed-emb-agent',
          auto_invoke_when_recommended: true,
          primary_first: true,
          parallel_safe: runtime.unique(context.review_agents || []),
          do_not_parallelize: [
            '不要把架构预审拆成多个相互竞争的可写 agent',
            '不要跳过事实核对直接输出选型结论'
          ],
          integration_owner: '当前主线程',
          integration_steps: [
            '先启动 emb-arch-reviewer 产出主审查结论',
            '必要时再让 review agents 补硬件、结构或发布侧证据',
            '最终由主线程整合成 architecture review 结论'
          ],
          primary: {
            agent: context.suggested_agent,
            role: 'primary',
            blocking: true,
            purpose: '执行系统级架构预审、方案比较和 pre-mortem',
            ownership: '负责主审查结论，不替代具体实现改动',
            when: '显式进入 arch-review 时立即启动',
            spawn_fallback: {
              supported: true,
              preferred_launch: context.suggested_agent,
              fallback_tool: 'spawn_agent',
              fallback_agent_type: 'default',
              role: 'primary',
              instructions_source_cli: runtimeHostHelpers.buildCliCommand(
                RUNTIME_HOST,
                ['agents', 'show', context.suggested_agent]
              ),
              prompt_contract: [
                `先读取 ${context.suggested_agent} 的 agent 指令`,
                '再结合 dispatch_contract 提供的上下文与输出要求执行',
                '输出后由主线程整合成 architecture review'
              ]
            },
            expected_output: [
              '给出三套方案、评价矩阵和 pre-mortem',
              '区分已确认事实、工程推断和经验警告'
            ],
            context_bundle: {
              trigger_patterns: context.trigger_patterns || [],
              checkpoints: context.checkpoints || [],
              review_axes: context.review_axes || [],
              note_targets: context.note_targets || []
            },
            start_when: '立即启动'
          },
          supporting: runtime.unique(context.review_agents || []).map(agent => ({
            agent,
            role: 'supporting',
            blocking: false,
            purpose: '为架构预审补充结构、硬件或发布侧证据',
            ownership: '只补侧证据，不覆盖主审查结论',
            when: '主线程发现需要补侧证据时再启动',
            spawn_fallback: {
              supported: true,
              preferred_launch: agent,
              fallback_tool: 'spawn_agent',
              fallback_agent_type: 'explorer',
              role: 'supporting',
              instructions_source_cli: runtimeHostHelpers.buildCliCommand(
                RUNTIME_HOST,
                ['agents', 'show', agent]
              ),
              prompt_contract: [
                `先读取 ${agent} 的 agent 指令`,
                '再结合 dispatch_contract 提供的上下文与输出要求执行',
                '输出后由主线程整合成 architecture review 侧证据'
              ]
            },
            expected_output: ['补充证据、约束或待验证风险'],
            context_bundle: {
              review_axes: context.review_axes || [],
              note_targets: context.note_targets || []
            },
            start_when: '按需启动'
          }))
        }
      },
      context_hygiene: context.context_hygiene || null,
      action_context: context
    };
  }

  return {
    buildActionOutput,
    buildArchReviewDispatchContext
  };
}

module.exports = {
  createActionContractHelpers
};
