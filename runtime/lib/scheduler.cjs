'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

const ACTIONS = ['scan', 'plan', 'do', 'debug', 'review', 'verify', 'forensics', 'note'];

const READ_HINTS = {
  hardware_truth: '硬件真值来源: 数据手册 / 原理图 / 引脚映射',
  registers: '寄存器与位定义: 芯片手册寄存器章节 / 头文件',
  entry_points: '代码入口: reset / main loop / ISR 入口',
  shared_state: '共享状态: ISR 与主循环共享变量 / 标志位',
  tasks: '任务入口: task 创建点 / 主任务循环',
  queues: '消息路径: queue / mailbox / event path',
  mutexes: '同步原语: mutex / lock / critical section',
  timers: '定时路径: software timer / hardware timer / callback',
  connectivity_state: '联网状态: reconnect / offline / cloud sync 状态机',
  ota_path: '升级路径: 版本校验 / 下载 / 切换 / 回滚'
};

const AGENT_PURPOSES = {
  'hw-scout': '锁定硬件真值、寄存器、引脚、时序和板级约束',
  'fw-doer': '执行最小代码或文档改动，并回传影响面与验证结果',
  'bug-hunter': '按现象 -> 假设 -> 检查 -> 结果 -> 下一步收敛根因',
  'sys-reviewer': '检查任务边界、并发路径、状态同步和恢复链路',
  'release-checker': '检查升级、回滚、离线默认行为和发布闭环',
  'arch-reviewer': '对选型、架构压力和量产风险做 pre-mortem 审查'
};

const AGENT_OWNERSHIP = {
  'hw-scout': '只负责事实侦察和真值定位，不直接落业务改动',
  'fw-doer': '只负责已锁定改动面的实现与最小验证，不扩散重构',
  'bug-hunter': '只负责调试闭环与假设排除，不替代最终实现',
  'sys-reviewer': '只负责结构性审查，不把代码风格问题冒充结构问题',
  'release-checker': '只负责发布闭环与恢复路径，不主导业务实现',
  'arch-reviewer': '只负责系统级预审，不替代具体实现 agent'
};

function getProjectTruthFiles(resolved) {
  const projectRoot = resolved && resolved.session ? resolved.session.project_root : '';
  if (!projectRoot) {
    return [];
  }

  const candidates = [
    runtime.getProjectAssetRelativePath('hw.yaml'),
    runtime.getProjectAssetRelativePath('req.yaml')
  ];

  return candidates.filter(file => fs.existsSync(path.join(projectRoot, file)));
}

function ensureResolved(resolved) {
  if (!resolved || typeof resolved !== 'object') {
    throw new Error('Resolved session is required');
  }
  if (!resolved.session || !resolved.profile || !resolved.effective) {
    throw new Error('Resolved session is missing required sections');
  }
}

function hasAgent(resolved, name) {
  return (resolved.effective.agents || []).includes(name);
}

function hasPack(resolved, name) {
  return (resolved.packs || []).some(pack => pack.name === name);
}

function buildContext(resolved) {
  ensureResolved(resolved);

  const focus = resolved.session.focus || '';
  const lastFiles = resolved.session.last_files || [];
  const openQuestions = resolved.session.open_questions || [];
  const knownRisks = resolved.session.known_risks || [];
  const packNames = (resolved.packs || []).map(pack => pack.name);
  const focusAreas = resolved.effective.focus_areas || [];
  const preferences = runtime.normalizePreferences(resolved.session.preferences || {});

  return {
    focus,
    lastFiles,
    openQuestions,
    knownRisks,
    packNames,
    focusAreas,
    preferences,
    isBaremetal: resolved.profile.runtime_model === 'main_loop_plus_isr',
    isRtos:
      resolved.profile.runtime_model === 'task_scheduler_plus_isr' ||
      (resolved.profile.concurrency_model || '').includes('tasks'),
    isConnected:
      hasPack(resolved, 'connected-appliance') ||
      (resolved.effective.review_axes || []).includes('reconnect_strategy'),
    isSensor:
      hasPack(resolved, 'sensor-node') ||
      focusAreas.includes('sampling') ||
      focusAreas.includes('calibration')
  };
}

function buildPreferredReadKeys(resolved) {
  const context = buildContext(resolved);
  const searchPriority = resolved.effective.search_priority || [];
  const hardwareKeys = ['hardware_truth', 'registers'];
  const hardwareFirst = searchPriority.filter(key => hardwareKeys.includes(key));
  const codeFirst = searchPriority.filter(key => !hardwareKeys.includes(key));

  if (context.preferences.truth_source_mode === 'code_first') {
    return runtime.unique([...codeFirst, ...hardwareFirst]);
  }

  return runtime.unique([...hardwareFirst, ...codeFirst]);
}

function buildFocusOrder(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.focus ? `当前 focus: ${context.focus}` : '',
    ...context.focusAreas.map(area => `场景关注: ${area}`),
    ...context.lastFiles.map(file => `最近文件: ${file}`),
    ...context.openQuestions.slice(0, 2).map(question => `未决问题: ${question}`),
    ...context.knownRisks.slice(0, 2).map(risk => `已知风险: ${risk}`)
  ]);
}

function buildSafetyChecks(action, resolved) {
  const context = buildContext(resolved);
  const guardrails = resolved.effective.guardrails || [];
  const checks = [
    ...guardrails.map(item => `guardrail: ${item}`)
  ];

  if (action === 'scan') {
    checks.push('先读真值来源，再做结论');
    checks.push('区分文档明确说明与工程推断');
  }

  if (action === 'do') {
    checks.push('改动前先定位真实实现位置');
    checks.push('默认使用更小、更浅、更直接的实现');
    if (context.isBaremetal) {
      checks.push('改 ISR 或共享状态前复查中断路径和时序窗口');
    }
    if (context.isConnected) {
      checks.push('改联网或升级行为前复查离线默认行为和恢复路径');
    }
  }

  if (action === 'plan') {
    checks.push('只做任务级 micro-plan，不扩展成 phase planning');
    checks.push('先明确真值来源、约束和验证，再排执行步骤');
    if (context.isBaremetal) {
      checks.push('涉及引脚、寄存器、时序或 ISR 时必须先锁定硬件真值');
    }
    if (context.isConnected) {
      checks.push('涉及联网、升级或回滚时必须覆盖离线默认行为和恢复路径');
    }
  }

  if (action === 'debug') {
    checks.push('把假设收敛到 1 到 3 个高价值项');
    checks.push('一次只验证一个假设，结果要能排除分支');
  }

  if (action === 'review') {
    checks.push('不是代码风格审查');
    checks.push('区分已确认风险与待验证风险');
  }

  if (action === 'verify') {
    checks.push('区分 bench 实测、代码推断和文档假设');
    checks.push('每个检查项都要给出 pass / fail / untested 结果');
    checks.push('失败项必须能回写到 risk、question 或 note');
  }

  if (action === 'forensics') {
    checks.push('只基于当前 session、handoff、报告和项目事实做结论');
    checks.push('不要把取证结果直接冒充最终修复方案');
  }

  if (action === 'note') {
    checks.push('只记录长期有效结论，不记录会话碎片');
    checks.push('每条结论都要标注依据与未验证项');
  }

  return runtime.unique(checks);
}

function choosePrimaryAgent(action, resolved) {
  const context = buildContext(resolved);

  if (action === 'scan') {
    return hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'do') {
    return hasAgent(resolved, 'fw-doer') ? 'fw-doer' : (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'plan') {
    if (context.isRtos && hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    if (context.isBaremetal && hasAgent(resolved, 'hw-scout')) {
      return 'hw-scout';
    }
    return (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'debug') {
    return hasAgent(resolved, 'bug-hunter')
      ? 'bug-hunter'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'review') {
    if (hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    if (context.isBaremetal && hasAgent(resolved, 'hw-scout')) {
      return 'hw-scout';
    }
    return (resolved.effective.review_agents || [])[0] || (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'forensics') {
    return hasAgent(resolved, 'bug-hunter')
      ? 'bug-hunter'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'verify') {
    if (context.isConnected && hasAgent(resolved, 'release-checker')) {
      return 'release-checker';
    }
    if (context.isRtos && hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    return hasAgent(resolved, 'hw-scout')
      ? 'hw-scout'
      : (hasAgent(resolved, 'fw-doer') ? 'fw-doer' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'note') {
    return hasAgent(resolved, 'fw-doer')
      ? 'fw-doer'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }

  throw new Error(`Unsupported action: ${action}`);
}

function chooseSupportingAgents(action, resolved, primaryAgent) {
  const context = buildContext(resolved);
  const agents = resolved.effective.agents || [];
  const reviewAgents = resolved.effective.review_agents || [];

  if (action === 'scan') {
    return runtime.unique([
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'do') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'plan') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'debug') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'review') {
    return reviewAgents.filter(name => name !== primaryAgent);
  }

  if (action === 'forensics') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'verify') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'note') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  return agents.filter(name => name !== primaryAgent);
}

function toInstalledAgentName(name) {
  if (!name) {
    return '';
  }

  return name.startsWith('emb-') ? name : `emb-${name}`;
}

function buildSpawnFallback(agentName, role) {
  const installedAgent = toInstalledAgentName(agentName);
  let fallbackType = 'default';

  if (agentName === 'hw-scout') {
    fallbackType = 'explorer';
  } else if (agentName === 'fw-doer') {
    fallbackType = 'worker';
  } else if (agentName === 'bug-hunter') {
    fallbackType = 'default';
  } else if (agentName === 'sys-reviewer' || agentName === 'release-checker') {
    fallbackType = 'explorer';
  } else if (agentName === 'arch-reviewer') {
    fallbackType = 'default';
  }

  return {
    supported: true,
    preferred_launch: installedAgent,
    fallback_tool: 'spawn_agent',
    fallback_agent_type: fallbackType,
    role,
    instructions_source_cli: runtimeHostHelpers.buildCliCommand(
      RUNTIME_HOST,
      ['agents', 'show', installedAgent]
    ),
    prompt_contract: [
      `先读取 ${installedAgent} 的 agent 指令`,
      '再结合 dispatch_contract 提供的 context_bundle 和 expected_output 执行',
      '输出后由主线程整合，不直接替代主线程结论'
    ]
  };
}

function buildAgentCall(action, agentName, role, context) {
  let when = '当前动作需要这个 agent 的专长时再调用';
  let blocking = role === 'primary';

  if (agentName === 'hw-scout') {
    when = context.isBaremetal
      ? '涉及寄存器、引脚、时序、板级连接或手册真值时先调用'
      : '需要补硬件边界、接口定义或板级真值时调用';
  } else if (agentName === 'fw-doer') {
    when = '真实改动点已经锁定，需要执行最小实现时调用';
  } else if (agentName === 'bug-hunter') {
    when = '现象已知但根因不明，需要快速收敛假设时调用';
    blocking = false;
  } else if (agentName === 'sys-reviewer') {
    when = context.isRtos || context.isConnected
      ? '涉及 task / queue / lock / timer / reconnect / OTA 边界时优先调用'
      : '需要做结构性边界审查时调用';
    blocking = false;
  } else if (agentName === 'release-checker') {
    when = '涉及升级、回滚、离线默认行为或发布闭环时调用';
    blocking = false;
  } else if (agentName === 'arch-reviewer') {
    when = '进入芯片选型、PoC 转量产或失败预演时调用';
    blocking = false;
  }

  if (action === 'review' && role !== 'primary') {
    blocking = false;
  }

  return {
    agent: toInstalledAgentName(agentName),
    role,
    blocking,
    purpose: AGENT_PURPOSES[agentName] || `支撑 ${action} 动作`,
    ownership: AGENT_OWNERSHIP[agentName] || '只处理自己负责的输出面，不回退其他 agent 的工作',
    when,
    spawn_fallback: buildSpawnFallback(agentName, role)
  };
}

function buildAgentOutputExpectation(action, agentName, context) {
  if (agentName === 'hw-scout') {
    return runtime.unique([
      '列出硬件真值来源、关键定位点和明确结论',
      context.isBaremetal ? '补出寄存器、引脚、时序和共享状态约束' : '补出接口、电压域或板级边界约束'
    ]);
  }

  if (agentName === 'fw-doer') {
    return [
      '给出最小改动方案或已执行改动',
      '说明影响范围、最小验证和剩余风险'
    ];
  }

  if (agentName === 'bug-hunter') {
    return [
      '按 symptom -> hypothesis -> check -> result -> next step 输出',
      '只保留 1 到 3 个高价值假设'
    ];
  }

  if (agentName === 'sys-reviewer') {
    return [
      '区分已确认风险与待验证风险',
      '说明任务边界、并发路径、状态同步或恢复链路问题'
    ];
  }

  if (agentName === 'release-checker') {
    return [
      '说明升级、回滚、离线默认行为和发布闭环风险',
      '补出发布前必须验证的检查项'
    ];
  }

  if (agentName === 'arch-reviewer') {
    return [
      '给出三套方案、评价矩阵和 pre-mortem',
      '区分事实、工程推断和经验警告'
    ];
  }

  return [`输出 ${action} 相关结论`];
}

function buildAgentContextBundle(action, resolved) {
  const context = buildContext(resolved);
  const outputShape = buildOutputShape(action);
  const suggestedSteps = buildSuggestedSteps(action, resolved);
  const safetyChecks = buildSafetyChecks(action, resolved);
  const truthSources = action === 'plan'
    ? buildPlanTruthSources(resolved)
    : action === 'scan'
      ? buildNextReads(resolved)
      : [];

  return {
    focus: context.focus || '',
    last_files: context.lastFiles.slice(0, 3),
    open_questions: context.openQuestions.slice(0, 3),
    known_risks: context.knownRisks.slice(0, 3),
    truth_sources: truthSources.slice(0, 4),
    safety_checks: safetyChecks.slice(0, 4),
    suggested_steps: suggestedSteps.slice(0, 4),
    output_shape: outputShape
  };
}

function buildDispatchContract(action, resolved, primaryAgent, supportingAgents, mode, recommended) {
  const context = buildContext(resolved);
  const contextBundle = buildAgentContextBundle(action, resolved);
  const primary = primaryAgent
    ? {
        ...buildAgentCall(action, primaryAgent, 'primary', context),
        expected_output: buildAgentOutputExpectation(action, primaryAgent, context),
        context_bundle: contextBundle,
        start_when: recommended ? '立即启动' : '仅当当前线程不想 inline 时启动'
      }
    : null;
  const supporting = supportingAgents.map(agentName => ({
    ...buildAgentCall(action, agentName, 'supporting', context),
    expected_output: buildAgentOutputExpectation(action, agentName, context),
    context_bundle: contextBundle,
    start_when: mode === 'parallel-recommended' || mode === 'primary-plus-supporting'
      ? '可与主线程并行启动'
      : '仅在主线程发现侧边问题时启动'
  }));

  return {
    launch_via: 'installed-emb-agent',
    auto_invoke_when_recommended: recommended,
    primary_first: mode !== 'parallel-recommended',
    parallel_safe: runtime.unique([
      ...supporting
        .filter(item => !item.blocking)
        .map(item => item.agent)
    ]),
    do_not_parallelize: [
      '不要让多个可写 agent 改同一组文件',
      '不要为了小任务把 orchestration 做重'
    ],
    integration_owner: '当前主线程',
    integration_steps: runtime.unique([
      '主线程继续推进，不要空等所有子 agent',
      '只在主路径被阻塞时等待关键子 agent',
      `最终把子 agent 结果整合回 ${action} 的标准输出结构`
    ]),
    primary,
    supporting
  };
}

function buildAgentExecution(action, resolved, primaryAgentInput, supportingAgentsInput) {
  const context = buildContext(resolved);
  const primaryAgent = primaryAgentInput || choosePrimaryAgent(action, resolved);
  const supportingAgents = Array.isArray(supportingAgentsInput)
    ? supportingAgentsInput
    : chooseSupportingAgents(action, resolved, primaryAgent);
  const installedPrimary = toInstalledAgentName(primaryAgent);
  const installedSupporting = supportingAgents.map(toInstalledAgentName).filter(Boolean);
  const available = Boolean(installedPrimary) || installedSupporting.length > 0;

  let mode = 'inline-preferred';
  let recommended = false;
  let inlineOk = true;
  let reason = '当前动作默认 inline 即可，不必主动展开子 agent 链路。';
  let suggestedWhen = [];
  let avoidWhen = [];

  if (action === 'scan') {
    recommended = Boolean(primaryAgent) && (context.isRtos || context.isConnected || context.openQuestions.length > 0);
    mode = recommended ? 'primary-recommended' : 'inline-preferred';
    reason = recommended
      ? context.isRtos || context.isConnected
        ? '任务/联网边界更复杂，先拆给侦察或审查 agent 收集真值更稳。'
        : '当前存在未决问题，先让侦察 agent 锁定真值可以减少猜测。'
      : 'scan 常常只是轻量读上下文，默认 inline 更省。';
    suggestedWhen = [
      '未决问题已经出现，但真值来源还没锁定',
      context.isBaremetal ? '需要先核对引脚、寄存器或时序要求' : '需要先核对任务、队列、锁或联网状态边界'
    ];
    avoidWhen = [
      '只是回读一个已知文件',
      '真值来源和改动边界都已明确'
    ];
  } else if (action === 'plan') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? 'RTOS / IoT 计划通常要把结构边界和发布约束拆开看，适合轻量并行。'
      : 'baremetal micro-plan 更适合先由主 agent 锁定硬件真值和约束，再由主线程整合。';
    suggestedWhen = [
      '任务已经超出单文件小改动',
      context.isConnected ? '要同时覆盖恢复、升级或回滚路径' : '要同时覆盖硬件约束和实现路径'
    ];
    avoidWhen = [
      'scan 后已经能直接 do',
      '只是一次极小的注释或文档修订'
    ];
  } else if (action === 'do') {
    recommended = Boolean(primaryAgent) && (context.openQuestions.length > 0 || context.isConnected);
    mode = recommended ? 'primary-plus-supporting' : 'inline-preferred';
    reason = recommended
      ? context.isConnected
        ? '联网或升级改动更容易漏恢复路径，适合让 supporting agent 并行复查。'
        : '仍有未决问题时，先让 supporting agent 复查真值或风险，再落代码更稳。'
      : 'do 默认应保持直接，不要为了小改动把执行链做重。';
    suggestedWhen = [
      '需要一个 agent 专注实现，另一个 agent 专注真值或发布复查',
      '主线程希望一边整合方案，一边让子 agent 处理侧边问题'
    ];
    avoidWhen = [
      '只有单文件小改动且真值已确认',
      '多个可写 agent 会碰到同一组文件'
    ];
  } else if (action === 'debug') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? '复杂并发或联网问题适合让调试与结构复查并行推进。'
      : '调试默认可先交给 bug-hunter 收敛假设，再由主线程决定改动。';
    suggestedWhen = [
      '现象稳定但根因分支多',
      context.isConnected ? '问题跨越任务、联网和恢复路径' : '问题跨越 ISR、主循环和时序窗口'
    ];
    avoidWhen = [
      '根因已经非常明确，只差直接修复',
      '没有足够现象证据支撑子 agent 调试'
    ];
  } else if (action === 'review') {
    recommended = Boolean(primaryAgent);
    mode = installedSupporting.length > 0 ? 'parallel-recommended' : 'primary-recommended';
    reason = 'review 天然适合把结构、硬件边界和发布闭环拆给不同只读 agent。';
    suggestedWhen = [
      '需要同时看模块边界、恢复路径和发布风险',
      '希望把已确认风险与待验证风险分开收敛'
    ];
    avoidWhen = [
      '只是做一次单点实现检查',
      '当前 scope 过小，不值得并行'
    ];
  } else if (action === 'verify') {
    recommended = Boolean(primaryAgent);
    mode = context.isConnected || context.isRtos ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isConnected || context.isRtos
      ? '验证阶段往往同时覆盖行为、恢复链路和系统边界，适合并行收敛检查项。'
      : 'baremetal 验证更像板级/时序收口，交给 verify agent 先列清单更稳。';
    suggestedWhen = [
      '刚完成 do，需要把实现闭环到 bench / 文档 / 风险面',
      context.isBaremetal ? '需要复核寄存器、引脚、时序、睡眠唤醒或电源边界' : '需要复核任务边界、恢复链路和异常路径'
    ];
    avoidWhen = [
      '还没完成最小 do 或 debug 收敛',
      '当前只有模糊想法，没有可验证对象'
    ];
  } else if (action === 'forensics') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? '复杂恢复或漂移问题适合让取证与结构复查并行推进。'
      : 'forensics 适合先让 bug-hunter 主导取证，再由主线程决定回到 debug、review 还是 do。';
    suggestedWhen = [
      '问题反复出现，且 session / handoff / thread 已开始漂移',
      '需要先收敛证据，再决定继续 debug、review 还是实现'
    ];
    avoidWhen = [
      '根因已经明确，只差直接修复',
      '只是普通硬件公式或寄存器定位问题'
    ];
  } else if (action === 'note') {
    recommended = Boolean(primaryAgent) && context.isConnected;
    mode = recommended ? 'primary-recommended' : 'inline-preferred';
    reason = recommended
      ? '联网或发布约束更容易遗漏，必要时可让专门 agent 先补齐记录面。'
      : 'note 主要是沉淀稳定结论，默认 inline 足够。';
    suggestedWhen = [
      '需要先把发布或联网约束补齐后再落文档',
      '记录内容横跨硬件真值和发布限制'
    ];
    avoidWhen = [
      '只是追加一个稳定结论',
      '会话还处于探索阶段，结论尚未稳定'
    ];
  }

  return {
    available,
    spawn_available: available,
    recommended,
    inline_ok: inlineOk,
    mode,
    reason,
    primary_agent: installedPrimary,
    supporting_agents: installedSupporting,
    wait_strategy: recommended
      ? '只在主路径被阻塞时等待子 agent 结果，其他情况下继续本线程工作'
      : '默认不等待子 agent，除非当前步骤被其结果阻塞',
    execution_rules: runtime.unique([
      '不要同时让多个可写 agent 修改同一组文件',
      '主线程负责整合结论，不把 orchestration 本身做重',
      context.isBaremetal
        ? '涉及寄存器、引脚、时序或板级真值时，优先先调 emb-hw-scout'
        : '涉及 task、queue、lock、timer、reconnect 或 OTA 边界时，优先先调结构审查 agent'
    ]),
    suggested_when: runtime.unique(suggestedWhen),
    avoid_when: runtime.unique(avoidWhen),
    calls: runtime.unique([
      primaryAgent ? buildAgentCall(action, primaryAgent, 'primary', context) : '',
      ...supportingAgents.map(agentName => buildAgentCall(action, agentName, 'supporting', context))
    ].filter(Boolean)),
    dispatch_contract: buildDispatchContract(action, resolved, primaryAgent, supportingAgents, mode, recommended)
  };
}

function buildSuggestedSteps(action, resolved) {
  const context = buildContext(resolved);
  const steps = [];

  if (action === 'scan') {
    steps.push('先锁定硬件真值来源和主入口');
    steps.push(context.isBaremetal ? '再读 ISR、共享状态和时序路径' : '再读任务、队列、锁和定时器边界');
    if (context.lastFiles[0]) {
      steps.push(`回读最近文件 ${context.lastFiles[0]}`);
    }
    if (context.openQuestions[0]) {
      steps.push(`围绕未决问题收敛: ${context.openQuestions[0]}`);
    }
    steps.push('输出 relevant_files / key_facts / open_questions / next_reads');
  }

  if (action === 'do') {
    if (context.lastFiles.length === 0) {
      steps.push('先补一次最小 scan，确认真实改动点');
    }
    steps.push('确认改动前置真值与约束');
    steps.push('执行最小改动');
    steps.push('给出最小验证与剩余风险');
  }

  if (action === 'plan') {
    steps.push('先明确目标和影响边界');
    steps.push('锁定真值来源、约束和主要风险');
    steps.push('拆成最小可执行步骤');
    steps.push('给出执行前验证和执行后验证');
  }

  if (action === 'debug') {
    steps.push('先固定 symptom');
    steps.push('收敛到 1 到 3 个高价值假设');
    steps.push('按 Check -> Result 逐个排除');
    steps.push('只保留最可能的 next step');
  }

  if (action === 'review') {
    steps.push('先界定 review scope');
    steps.push('按 review axes 做结构性检查');
    steps.push('输出 findings 和 required checks');
    if (context.isConnected) {
      steps.push('补查升级、回滚、离线默认行为');
    }
  }

  if (action === 'verify') {
    steps.push('先列出本轮实现或结论对应的验证对象');
    steps.push(context.isBaremetal ? '按上电、时序、引脚、寄存器、睡眠/低压等检查面逐项验证' : '按任务、恢复、异常路径、联网/升级行为逐项验证');
    steps.push('每项给出 pass / fail / untested，并记录证据');
    steps.push('失败项回写到 risk、question 或 note');
  }

  if (action === 'forensics') {
    steps.push('先固定当前问题描述、最新 thread 和最近一次 forensics 摘要');
    steps.push('只收敛最关键证据，不直接跳到修复');
    steps.push('明确下一步应该回到 debug、review 还是 do');
  }

  if (action === 'note') {
    steps.push('先选定要写入的固定文档');
    steps.push('只记录稳定结论与依据');
    steps.push('标记未验证项');
    steps.push('避免写入会话碎片或 planning 过程');
  }

  return steps;
}

function buildOutputShape(action) {
  if (action === 'scan') {
    return ['relevant_files', 'key_facts', 'open_questions', 'next_reads', 'scheduler'];
  }
  if (action === 'plan') {
    return ['goal', 'truth_sources', 'constraints', 'risks', 'steps', 'verification', 'scheduler'];
  }
  if (action === 'do') {
    return ['chosen_agent', 'prerequisites', 'safety_checks', 'execution_brief', 'scheduler'];
  }
  if (action === 'debug') {
    return ['hypotheses', 'checks', 'next_step', 'chosen_agent', 'scheduler'];
  }
  if (action === 'review') {
    return ['scope', 'axes', 'findings_template', 'required_checks', 'review_agents', 'scheduler'];
  }
  if (action === 'verify') {
    return ['scope', 'checklist', 'evidence_targets', 'result_template', 'next_step', 'scheduler'];
  }
  if (action === 'forensics') {
    return ['problem', 'evidence_sources', 'findings_template', 'next_step', 'chosen_agent', 'scheduler'];
  }
  if (action === 'note') {
    return ['target_docs', 'recordable_items', 'excluded_items', 'chosen_agent', 'scheduler'];
  }
  return [];
}

function buildDefaultOpenQuestions(resolved) {
  const context = buildContext(resolved);

  if (context.openQuestions.length > 0) {
    return context.openQuestions;
  }

  if (context.isBaremetal) {
    return runtime.unique([
      '硬件真值来源是否已经确认到引脚、寄存器、时序级别？',
      '哪些 ISR 与主循环共享状态最值得先复查？',
      context.isSensor ? '采样窗口、滤波或稳定时间是否已被明确约束？' : ''
    ]);
  }

  return runtime.unique([
    '任务、队列、锁、定时器的边界是否已经定位清楚？',
    '联网状态机与离线默认行为是否一致？',
    context.isConnected ? 'OTA / 回滚 / 升级恢复路径是否已经被明确？' : ''
  ]);
}

function buildNextReads(resolved) {
  const context = buildContext(resolved);
  const hintedReads = buildPreferredReadKeys(resolved).map(key => READ_HINTS[key] || key);
  const truthFiles = getProjectTruthFiles(resolved).map(file => `项目真值层: ${file}`);

  return runtime.unique([
    ...truthFiles,
    ...hintedReads,
    context.lastFiles[0] ? `回读最近文件: ${context.lastFiles[0]}` : '',
    context.knownRisks[0] ? `复查风险来源: ${context.knownRisks[0]}` : ''
  ]);
}

function buildHypotheses(resolved) {
  const context = buildContext(resolved);

  if (context.isBaremetal) {
    return runtime.unique([
      'ISR 与主循环共享状态更新顺序错误',
      '时序窗口或寄存器配置不满足当前行为',
      context.isSensor ? '采样稳定时间、滤波或校准路径不正确' : '引脚复用或板级连接理解有误'
    ]).slice(0, 3);
  }

  return runtime.unique([
    '任务优先级、锁或队列边界导致行为异常',
    '联网状态机、重连或缓存一致性存在缺口',
    context.isConnected ? '升级恢复、离线默认行为或回滚链路不完整' : '定时器或后台任务交互路径错误'
  ]).slice(0, 3);
}

function buildChecks(resolved) {
  const context = buildContext(resolved);

  if (context.isBaremetal) {
    return runtime.unique([
      '检查 ISR 置位/清标志与主循环消费顺序',
      '核对关键寄存器、引脚复用和时序要求',
      context.isSensor ? '核对采样窗口、稳定时间、滤波或校准流程' : '核对板级连接与输出路径'
    ]);
  }

  return runtime.unique([
    '检查任务边界、阻塞点和优先级',
    '检查 queue / lock / timer 的交互路径',
    context.isConnected ? '检查 reconnect / offline / OTA / rollback 闭环' : '检查后台状态机与超时恢复'
  ]);
}

function buildFindingsTemplate(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    'Confirmed risks',
    'Risks to verify',
    context.isBaremetal ? 'Timing / register path' : 'Task / queue / lock path',
    context.isConnected ? 'Connectivity / OTA / rollback' : 'Hardware / board truth'
  ]);
}

function buildRequiredChecks(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.effective.guardrails || []).map(item => `guardrail: ${item}`),
    context.isBaremetal ? '复查 ISR、共享状态与 ROM/RAM 预算' : '复查任务边界、阻塞与优先级',
    context.isConnected ? '复查离线默认行为、升级恢复与回滚' : '',
    context.isSensor ? '复查采样窗口、稳定时间与测量更新链路' : ''
  ]);
}

function buildVerificationChecklist(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.isBaremetal ? '确认主入口、ISR 与共享状态行为符合预期' : '确认任务边界、调度与同步行为符合预期',
    context.isBaremetal ? '确认关键寄存器、引脚复用和时序窗口没有回归' : '确认队列、锁、超时和恢复链路没有回归',
    context.isBaremetal ? '确认上电、复位、睡眠唤醒、低压或电源边界行为' : '',
    context.isConnected ? '确认离线默认行为、重连、升级恢复与回滚链路' : '',
    context.isSensor ? '确认采样窗口、稳定时间、滤波、校准和测量更新链路' : '',
    '确认异常输入、边界条件和失败路径处理结果'
  ]);
}

function buildVerificationEvidenceTargets(resolved) {
  const truthFiles = getProjectTruthFiles(resolved);
  const suggestedSources = resolved && resolved.effective && Array.isArray(resolved.effective.recommended_sources)
    ? resolved.effective.recommended_sources
    : [];

  return runtime.unique([
    ...truthFiles.map(file => `项目真值层: ${file}`),
    ...(resolved.session.last_files || []).slice(0, 3).map(file => `最近文件: ${file}`),
    ...suggestedSources.slice(0, 2).map(item => `资料摘要: ${item.path}`)
  ]);
}

function buildVerificationResultTemplate() {
  return [
    'PASS: 已验证通过',
    'FAIL: 已复现失败或发现回归',
    'WARN: 发现风险但证据未闭环',
    'UNTESTED: 尚未 bench / 仿真 / 实机验证'
  ];
}

function buildRecordableItems(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    '硬件真值',
    'bring-up 结论',
    '已知限制',
    '调试结论',
    context.isConnected ? '联网与发布约束' : '',
    context.isSensor ? '采样、校准与低功耗约束' : ''
  ]);
}

function buildPlanGoal(resolved) {
  const context = buildContext(resolved);

  if (context.focus) {
    return context.focus;
  }

  if (context.isBaremetal) {
    return context.isSensor
      ? '先锁定硬件真值与采样路径，再执行最小改动'
      : '先锁定硬件真值与关键时序，再执行最小改动';
  }

  return context.isConnected
    ? '先锁定任务边界、联网状态和恢复路径，再执行最小改动'
    : '先锁定任务边界和共享状态，再执行最小改动';
}

function buildPlanTruthSources(resolved) {
  const context = buildContext(resolved);
  const fileReads = [
    context.lastFiles[0] ? `当前最相关文件: ${context.lastFiles[0]}` : '',
    context.lastFiles[1] ? `次相关文件: ${context.lastFiles[1]}` : ''
  ];

  if (context.preferences.truth_source_mode === 'code_first') {
    return runtime.unique([
      ...fileReads,
      ...buildNextReads(resolved)
    ]);
  }

  return runtime.unique([
    ...buildNextReads(resolved),
    ...fileReads
  ]);
}

function buildPlanConstraints(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.profile.resource_priority || []).map(item => `resource: ${item}`),
    ...(resolved.effective.guardrails || []).map(item => `guardrail: ${item}`),
    context.isBaremetal ? '约束: 保持 ISR 薄、主循环扁平、避免额外抽象' : '',
    context.isConnected ? '约束: 不能破坏离线默认行为、重连和恢复路径' : '',
    context.isSensor ? '约束: 不能破坏采样窗口、稳定时间和测量更新链路' : ''
  ]);
}

function buildPlanRisks(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.session.known_risks || []),
    context.isBaremetal ? 'ISR / 主循环共享状态竞争' : '任务边界、阻塞和优先级风险',
    context.isConnected ? '离线行为、重连、一致性或回滚链路回归' : '',
    context.isSensor ? '采样稳定时间、滤波或校准路径回归' : ''
  ]);
}

function buildPlanSteps(resolved) {
  const context = buildContext(resolved);
  const steps = [];

  if (context.lastFiles.length === 0) {
    steps.push('先执行最小 scan，确认真实改动点');
  }

  steps.push('确认目标涉及的硬件真值、代码入口和影响边界');
  steps.push('把改动拆成单个最小提交面，不同时展开多个风险面');
  steps.push('先改最关键路径，再补最小验证');

  if (context.isBaremetal) {
    steps.push('优先修改寄存器、引脚、ISR 或主循环共享状态的真实落点');
  } else {
    steps.push('优先修改任务边界、队列、锁、定时器或联网状态机的真实落点');
  }

  if (context.isConnected) {
    steps.push('执行前后都复查离线默认行为、恢复路径和升级链路');
  }

  steps.push('完成后再决定是否需要 note 沉淀长期结论');
  return steps;
}

function buildPlanVerification(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.isBaremetal ? '验证 ISR、主循环、共享状态和时序窗口' : '验证任务边界、阻塞点和并发路径',
    context.isConnected ? '验证离线默认行为、重连、升级恢复和回滚路径' : '',
    context.isSensor ? '验证采样窗口、稳定时间、滤波和测量更新路径' : '',
    context.preferences.verification_mode === 'strict'
      ? '验证失败路径、异常输入、超时恢复和边界条件'
      : '',
    '验证影响面之外没有引入新的已知风险'
  ]);
}

function buildSchedule(action, resolved) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }

  const primaryAgent = choosePrimaryAgent(action, resolved);
  const supportingAgents = chooseSupportingAgents(action, resolved, primaryAgent);

  return {
    action,
    profile: resolved.profile.name,
    packs: (resolved.packs || []).map(pack => pack.name),
    primary_agent: primaryAgent,
    supporting_agents: supportingAgents,
    agent_execution: buildAgentExecution(action, resolved, primaryAgent, supportingAgents),
    safety_checks: buildSafetyChecks(action, resolved),
    focus_order: buildFocusOrder(resolved),
    suggested_steps: buildSuggestedSteps(action, resolved),
    output_shape: buildOutputShape(action)
  };
}

function buildScanOutput(resolved) {
  const truthFiles = getProjectTruthFiles(resolved);

  return {
    relevant_files: runtime.unique([
      ...truthFiles,
      ...(resolved.session.last_files || [])
    ]),
    key_facts: runtime.unique([
      `profile=${resolved.profile.name}`,
      `runtime_model=${resolved.profile.runtime_model}`,
      `concurrency_model=${resolved.profile.concurrency_model}`,
      `resource_priority=${(resolved.profile.resource_priority || []).join(' -> ')}`,
      truthFiles.length > 0 ? `project_truth=${truthFiles.join(', ')}` : 'project_truth=missing',
      `focus_areas=${(resolved.effective.focus_areas || []).join(', ')}`
    ]),
    open_questions: buildDefaultOpenQuestions(resolved),
    next_reads: buildNextReads(resolved),
    scheduler: buildSchedule('scan', resolved)
  };
}

function buildPlanOutput(resolved) {
  return {
    goal: buildPlanGoal(resolved),
    truth_sources: buildPlanTruthSources(resolved),
    constraints: buildPlanConstraints(resolved),
    risks: buildPlanRisks(resolved),
    steps: buildPlanSteps(resolved),
    verification: buildPlanVerification(resolved),
    scheduler: buildSchedule('plan', resolved)
  };
}

function buildDoOutput(resolved) {
  const context = buildContext(resolved);

  return {
    chosen_agent: choosePrimaryAgent('do', resolved),
    prerequisites: runtime.unique([
      context.lastFiles.length === 0 ? '先补一次最小 scan，确认真实改动点' : '',
      '确认硬件真值或实现真值来源',
      context.focus ? `围绕当前 focus 执行: ${context.focus}` : '',
      context.isConnected ? '确认离线默认行为、升级恢复和一致性约束' : ''
    ]),
    safety_checks: buildSafetyChecks('do', resolved),
    execution_brief: {
      focus_order: buildFocusOrder(resolved),
      suggested_steps: buildSuggestedSteps('do', resolved),
      supporting_agents: chooseSupportingAgents('do', resolved, choosePrimaryAgent('do', resolved))
    },
    scheduler: buildSchedule('do', resolved)
  };
}

function buildDebugOutput(resolved) {
  const steps = buildSuggestedSteps('debug', resolved);

  return {
    hypotheses: buildHypotheses(resolved),
    checks: buildChecks(resolved),
    next_step: steps[0] || '先固定问题现象',
    chosen_agent: choosePrimaryAgent('debug', resolved),
    scheduler: buildSchedule('debug', resolved)
  };
}

function buildReviewOutput(resolved) {
  return {
    scope: {
      profile: resolved.profile.name,
      packs: (resolved.packs || []).map(pack => pack.name),
      focus: resolved.session.focus || '',
      runtime_model: resolved.profile.runtime_model,
      concurrency_model: resolved.profile.concurrency_model,
      focus_areas: resolved.effective.focus_areas || []
    },
    axes: resolved.effective.review_axes || [],
    findings_template: buildFindingsTemplate(resolved),
    required_checks: buildRequiredChecks(resolved),
    review_agents: runtime.unique([
      choosePrimaryAgent('review', resolved),
      ...chooseSupportingAgents('review', resolved, choosePrimaryAgent('review', resolved))
    ]),
    scheduler: buildSchedule('review', resolved)
  };
}

function buildVerifyOutput(resolved) {
  const context = buildContext(resolved);
  const steps = buildSuggestedSteps('verify', resolved);

  return {
    scope: {
      profile: resolved.profile.name,
      packs: (resolved.packs || []).map(pack => pack.name),
      focus: resolved.session.focus || '',
      runtime_model: resolved.profile.runtime_model,
      concurrency_model: resolved.profile.concurrency_model,
      last_files: resolved.session.last_files || []
    },
    checklist: buildVerificationChecklist(resolved),
    evidence_targets: buildVerificationEvidenceTargets(resolved),
    result_template: buildVerificationResultTemplate(),
    next_step: steps[0] || '先列出本轮待验证对象',
    scheduler: buildSchedule('verify', resolved),
    verification_focus: runtime.unique([
      context.isBaremetal ? 'board-behavior' : 'system-behavior',
      context.isConnected ? 'connectivity-recovery' : '',
      context.isSensor ? 'sampling-stability' : '',
      'failure-paths'
    ])
  };
}

function buildForensicsOutput(resolved) {
  const diagnostics = resolved.session.diagnostics && resolved.session.diagnostics.latest_forensics
    ? resolved.session.diagnostics.latest_forensics
    : {};
  const activeThread = resolved.session.active_thread || {};
  const steps = buildSuggestedSteps('forensics', resolved);

  return {
    problem: diagnostics.problem || resolved.session.focus || '当前问题仍在漂移，需先做取证',
    evidence_sources: runtime.unique([
      diagnostics.report_file ? `最近一次 forensics: ${diagnostics.report_file}` : '',
      activeThread.name ? `当前活动 thread: ${activeThread.name}` : '',
      ...(resolved.session.last_files || []).slice(0, 2).map(file => `最近文件: ${file}`),
      ...getProjectTruthFiles(resolved).map(file => `项目真值层: ${file}`)
    ]),
    findings_template: [
      'Observed symptom',
      'Evidence collected',
      'Most likely branch',
      'Next recommended action'
    ],
    next_step: steps[0] || '先固定问题描述和关键证据',
    chosen_agent: choosePrimaryAgent('forensics', resolved),
    scheduler: buildSchedule('forensics', resolved)
  };
}

function buildNoteOutput(resolved) {
  return {
    target_docs: resolved.effective.note_targets || [],
    recordable_items: buildRecordableItems(resolved),
    excluded_items: [
      '临时猜测',
      '会话碎片',
      'phase / planning 过程'
    ],
    chosen_agent: choosePrimaryAgent('note', resolved),
    scheduler: buildSchedule('note', resolved)
  };
}

module.exports = {
  ACTIONS,
  buildAgentExecution,
  buildDoOutput,
  buildDebugOutput,
  buildForensicsOutput,
  buildNoteOutput,
  buildPlanOutput,
  buildReviewOutput,
  buildVerifyOutput,
  buildScanOutput,
  buildSchedule
};
