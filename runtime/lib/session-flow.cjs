'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const FORENSICS_PATTERNS = [
  'drift',
  'drifting',
  'stuck',
  'keeps failing',
  'repeat failure',
  'resume',
  'handoff',
  '漂移',
  '卡住',
  '反复失败',
  '重复失败',
  '上下文漂移',
  '恢复后',
  'resume后'
];
const HARDWARE_TOOL_PATTERNS = [
  'timer',
  'tm2',
  'tm3',
  'pwm',
  'comparator',
  'adc',
  'uart',
  'spi',
  'i2c',
  'gpio',
  'register',
  'registers',
  'pin',
  'pinmux',
  'datasheet',
  'manual',
  '引脚',
  '寄存器',
  '手册',
  '定时器',
  '比较器',
  'pwm',
  '波特率',
  '时序',
  '公式',
  '外设'
];
const REVIEW_PATTERNS = [
  'ota',
  'rollback',
  'reconnect',
  'offline',
  'upgrade',
  'release',
  '量产',
  '回滚',
  '重连',
  '离线',
  '升级',
  '发布'
];

function createSessionFlowHelpers(deps) {
  const {
    runtime,
    RUNTIME_CONFIG,
    DEFAULT_ARCH_REVIEW_PATTERNS,
    resolveSession,
    getHealthReport,
    getProjectConfig,
    loadHandoff,
    enrichWithToolSuggestions,
    listThreads
  } = deps;

  function shouldGateNextWithHealth(resolved, handoff, nextCommand, healthReport) {
    if (!healthReport || nextCommand !== 'scan' || handoff) {
      return false;
    }

    if (shouldSuggestScanTool(resolved)) {
      return false;
    }

    const hardware = resolved && resolved.hardware ? resolved.hardware : {};
    const hasChipProfile = Boolean(hardware.chip_profile);
    const toolRecommendations =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.tool_recommendations)
        ? resolved.effective.tool_recommendations
        : [];

    if (hasChipProfile || toolRecommendations.length > 0) {
      return false;
    }

    const blockingChecks = new Set(['hw_truth', 'req_truth', 'hardware_identity']);
    const hasBlockingCheck = Array.isArray(healthReport.checks)
      ? healthReport.checks.some(item => blockingChecks.has(item.key) && (item.status === 'warn' || item.status === 'fail'))
      : false;
    const actionableHealthCommands = Array.isArray(healthReport.next_commands)
      ? healthReport.next_commands.some(item => [
          'init',
          'adapter-source-add',
          'adapter-sync',
          'adapter-bootstrap',
          'adapter-derive-from-doc',
          'doc-apply'
        ].includes(item.key))
      : false;

    return hasBlockingCheck || actionableHealthCommands;
  }

  function getPreferences(session) {
    return runtime.normalizePreferences((session && session.preferences) || {}, RUNTIME_CONFIG);
  }

  function collectRoutingTexts(session) {
    const latestForensics =
      session &&
      session.diagnostics &&
      session.diagnostics.latest_forensics
        ? session.diagnostics.latest_forensics
        : null;

    return runtime.unique([
      session && session.focus ? session.focus : '',
      ...((session && session.open_questions) || []),
      ...((session && session.known_risks) || []),
      session && session.active_thread && session.active_thread.title ? session.active_thread.title : '',
      latestForensics && latestForensics.problem ? latestForensics.problem : ''
    ]).filter(Boolean);
  }

  function hasPattern(texts, patterns) {
    return texts.some(text =>
      patterns.some(pattern => String(text).toLowerCase().includes(String(pattern).toLowerCase()))
    );
  }

  function resolveActiveThread(session) {
    const stored = session && session.active_thread ? session.active_thread : null;
    if (stored && stored.name) {
      return stored;
    }

    const threads = listThreads ? listThreads() : { threads: [] };
    const openThread = (threads.threads || []).find(item => item.status !== 'RESOLVED');
    return openThread
      ? {
          name: openThread.name,
          title: openThread.title,
          status: openThread.status,
          path: openThread.path,
          updated_at: openThread.updated_at
        }
      : null;
  }

  function shouldSuggestPlan(resolved) {
    const session = resolved.session;
    const focus = session.focus || '';
    const mode = getPreferences(session).plan_mode;

    if (mode === 'always') {
      return true;
    }
    if (mode === 'never') {
      return false;
    }

    return (
      (session.known_risks || []).length > 0 ||
      (session.last_files || []).length > 1 ||
      (focus && focus.length > 0)
    );
  }

  function shouldSuggestReview(resolved) {
    const session = resolved.session;
    const mode = getPreferences(session).review_mode;
    const isComplexRuntime = resolved.profile.runtime_model !== 'main_loop_plus_isr';
    const hasWideReviewSurface =
      (resolved.effective.review_agents || []).length > 2 ||
      (resolved.effective.review_axes || []).length > 6;
    const texts = collectRoutingTexts(session);
    const hasReviewSignal = hasPattern(texts, REVIEW_PATTERNS);

    if (mode === 'always') {
      return true;
    }
    if (mode === 'never') {
      return false;
    }

    return (isComplexRuntime && hasWideReviewSurface) || (hasReviewSignal && (isComplexRuntime || hasWideReviewSurface));
  }

  function shouldSuggestForensics(resolved) {
    const session = resolved.session;
    const texts = collectRoutingTexts(session);
    const latestForensics =
      session.diagnostics && session.diagnostics.latest_forensics
        ? session.diagnostics.latest_forensics
        : null;
    const hasForensicsSignal = hasPattern(texts, FORENSICS_PATTERNS);

    if ((session.last_command || '').startsWith('forensics')) {
      return false;
    }

    if (latestForensics && latestForensics.highest_severity === 'high' && session.active_thread && session.active_thread.name) {
      return true;
    }

    return hasForensicsSignal;
  }

  function shouldSuggestScanTool(resolved) {
    const session = resolved.session;
    const texts = collectRoutingTexts(session);
    const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];

    return hasPattern(texts, HARDWARE_TOOL_PATTERNS) || suggestedTools.length > 0;
  }

  function buildReviewContext() {
    const resolved = resolveSession();

    return {
      project_root: resolved.session.project_root,
      focus: resolved.session.focus || '',
      profile: resolved.profile.name,
      packs: resolved.session.active_packs,
      runtime_model: resolved.profile.runtime_model || '',
      concurrency_model: resolved.profile.concurrency_model || '',
      review_agents: resolved.effective.review_agents,
      review_axes: resolved.effective.review_axes,
      focus_areas: resolved.effective.focus_areas,
      guardrails: resolved.effective.guardrails,
      arch_review_triggers: resolved.effective.arch_review_triggers,
      known_risks: resolved.session.known_risks,
      open_questions: resolved.session.open_questions,
      last_files: resolved.session.last_files
    };
  }

  function shouldSuggestArchReview(resolved) {
    const session = resolved.session;
    const texts = runtime.unique([
      session.focus || '',
      ...(session.open_questions || []),
      ...(session.known_risks || [])
    ]).filter(Boolean);
    const patterns = runtime.unique(resolved.effective.arch_review_triggers || []).filter(Boolean);

    return texts.some(text =>
      patterns.some(pattern => text.toLowerCase().includes(String(pattern).toLowerCase()))
    );
  }

  function buildArchReviewContext() {
    const review = buildReviewContext();

    return {
      ...review,
      mode: 'heavyweight_architecture_review',
      suggested_agent: 'emb-arch-reviewer',
      recommended_template: {
        name: 'architecture-review',
        output: 'docs/ARCH-REVIEW.md',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['template', 'fill', 'architecture-review', '--force'])
      },
      checkpoints: [
        'Deep Requirement Interrogation',
        'Trinity Diagram Protocol',
        'Scenario Simulation',
        'Evaluation Matrix',
        'Pre-Mortem'
      ],
      trigger_patterns: review.arch_review_triggers,
      warning: '这是显式重型审查入口，只在选型、方案预审、PoC 转量产或失败预演场景使用'
    };
  }

  function buildNextCommand(resolved, handoff) {
    const session = resolved.session;
    const preferences = getPreferences(session);
    const openQuestions = session.open_questions || [];
    const knownRisks = session.known_risks || [];
    const lastFiles = session.last_files || [];
    const focus = session.focus || '';
    const hasActiveContext =
      focus.trim() !== '' ||
      lastFiles.length > 0 ||
      openQuestions.length > 0 ||
      knownRisks.length > 0 ||
      Boolean(handoff);

    if (shouldSuggestForensics(resolved)) {
      return {
        command: 'forensics',
        reason: '当前上下文带有漂移、恢复失败或重复失败信号，先做一次取证收敛问题空间'
      };
    }

    if (openQuestions.length > 0 && !shouldSuggestScanTool(resolved)) {
      return {
        command: 'debug',
        reason: `存在未决问题，先围绕 "${openQuestions[0]}" 收敛根因`
      };
    }

    if (shouldSuggestScanTool(resolved)) {
      const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];
      const firstTool = suggestedTools[0];
      return {
        command: 'scan',
        reason: firstTool
          ? `当前更像硬件/公式/工具定位问题，先 scan 并评估 ${firstTool.name}`
          : '当前更像硬件真值、寄存器、引脚或公式定位问题，先 scan 再决定是否进入 tool'
      };
    }

    if (preferences.review_mode === 'always') {
      return {
        command: 'review',
        reason: '当前偏好要求先做 review，再决定执行路径'
      };
    }

    if (shouldSuggestArchReview(resolved)) {
      return {
        command: 'arch-review',
        reason: '当前上下文带有选型或方案预审信号，先做一次系统级架构审查'
      };
    }

    if (shouldSuggestReview(resolved)) {
      return {
        command: 'review',
        reason:
          preferences.review_mode === 'always'
            ? '当前偏好要求先做 review，再决定执行路径'
            : '当前 review 信号成立，先做结构性 review 再决定执行路径'
      };
    }

    if (shouldSuggestPlan(resolved)) {
      return {
        command: 'plan',
        reason:
          preferences.plan_mode === 'always'
            ? '当前偏好要求先做 micro-plan 再执行'
            : '当前已进入复杂任务信号，先做 micro-plan 再执行'
      };
    }

    if (!hasActiveContext) {
      return {
        command: 'scan',
        reason: '当前还没有有效工作上下文，先做一次最小 scan'
      };
    }

    if (lastFiles.length === 0) {
      return {
        command: 'scan',
        reason: '当前没有最近文件记录，先补一次 scan 锁定真实改动点'
      };
    }

    return {
      command: 'do',
      reason: '上下文已经足够，直接进入最小执行'
    };
  }

  function buildContextHygiene(resolved, handoff, currentCommand) {
    const session = resolved.session;
    const focus = session.focus || '';
    const openQuestions = session.open_questions || [];
    const knownRisks = session.known_risks || [];
    const lastFiles = session.last_files || [];
    const command = (currentCommand || session.last_command || '').trim();
    const heavyCommands = ['plan', 'review', 'debug', 'arch-review'];
    const reasons = [];
    let score = 0;

    if (lastFiles.length >= 5) {
      score += 2;
      reasons.push(`最近文件已累计 ${lastFiles.length} 个，说明上下文跨度开始变大`);
    } else if (lastFiles.length >= 3) {
      score += 1;
      reasons.push(`最近文件已有 ${lastFiles.length} 个，继续深挖前最好先收口`);
    }

    if (openQuestions.length >= 2) {
      score += 2;
      reasons.push(`当前还有 ${openQuestions.length} 个未决问题`);
    } else if (openQuestions.length === 1) {
      score += 1;
      reasons.push('当前仍有未决问题挂起');
    }

    if (knownRisks.length >= 2) {
      score += 2;
      reasons.push(`当前还有 ${knownRisks.length} 个已知风险待跟踪`);
    } else if (knownRisks.length === 1) {
      score += 1;
      reasons.push('当前已有风险项挂起');
    }

    if (focus.trim() !== '' && heavyCommands.includes(command)) {
      score += 1;
      reasons.push(`最近命令是 ${command}，且仍围绕 focus 深挖`);
    }

    if (handoff) {
      score += 2;
      reasons.push('已存在 pause handoff，可直接清空后 resume');
    }

    let level = 'stable';
    if (handoff || score >= 5) {
      level = 'suggest-clearing';
    } else if (score >= 2) {
      level = 'consider-clearing';
    }

    let recommendation = '当前上下文还轻，不需要主动清除。';
    if (level === 'consider-clearing') {
      recommendation = handoff
        ? '上下文开始变重；如果准备切换任务或继续深挖，可以直接清除上下文，随后执行 resume 接回。'
        : '上下文开始变重；如果准备切换任务或继续深挖，建议先执行 pause，再清除上下文，后续用 resume 接回。';
    } else if (level === 'suggest-clearing') {
      recommendation = handoff
        ? '当前上下文已变重，且已有 handoff；建议现在清除上下文，随后执行 resume 接回。'
        : '当前上下文已变重，建议现在先执行 pause，然后清除上下文，后续用 resume 接回。';
    }

    return {
      level,
      reasons,
      recommendation,
      pause_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['pause']),
      resume_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
      clear_hint: handoff ? 'clear -> resume' : 'pause -> clear -> resume',
      handoff_ready: Boolean(handoff)
    };
  }

  function getToolRecommendationScore(item) {
    const status = item && item.status ? item.status : '';
    if (status === 'ready') return 0;
    if (status === 'draft-adapter') return 1;
    if (status === 'route-required') return 2;
    if (status === 'adapter-required') return 3;
    return 9;
  }

  function selectPrimaryToolRecommendation(toolRecommendations) {
    const items = Array.isArray(toolRecommendations) ? toolRecommendations.slice() : [];
    if (items.length === 0) {
      return null;
    }

    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        return getToolRecommendationScore(left.item) - getToolRecommendationScore(right.item) ||
          left.index - right.index;
      })[0].item;
  }

  function suggestFlow(resolved) {
    const session = resolved.session;
    const preferences = getPreferences(session);
    const openQuestions = session.open_questions || [];

    if (openQuestions.length > 0) {
      return 'scan -> debug -> do -> verify';
    }
    if (preferences.review_mode === 'always') {
      return 'scan -> review -> do -> verify';
    }
    if (shouldSuggestArchReview(resolved)) {
      return 'scan -> arch-review -> plan -> do -> verify';
    }
    if (shouldSuggestReview(resolved)) {
      return 'scan -> review -> do -> verify';
    }
    if (shouldSuggestPlan(resolved)) {
      return 'scan -> plan -> do -> verify';
    }
    return 'scan -> do -> verify';
  }

  function buildGuidance(resolved, handoff) {
    const session = resolved.session;
    const focus = session.focus || '';
    const openQuestions = session.open_questions || [];
    const knownRisks = session.known_risks || [];
    const lastFiles = session.last_files || [];
    const openThread = resolveActiveThread(session);
    const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];
    const toolRecommendations = (resolved.effective && resolved.effective.tool_recommendations) || [];
    const primaryToolRecommendation = selectPrimaryToolRecommendation(toolRecommendations);
    const latestForensics =
      session.diagnostics && session.diagnostics.latest_forensics
        ? session.diagnostics.latest_forensics
        : null;
    const suggestedFlow = handoff && handoff.suggested_flow
      ? handoff.suggested_flow
      : suggestFlow(resolved);
    const next = buildNextCommand(resolved, handoff);
    const contextHygiene = buildContextHygiene(resolved, handoff, next.command);

    return {
      suggested_flow: suggestedFlow,
      next,
      primary_tool_recommendation: primaryToolRecommendation,
      next_actions: runtime.unique([
        handoff && handoff.next_action ? `按 handoff 恢复: ${handoff.next_action}` : '',
        ...(handoff ? handoff.human_actions_pending.map(action => `需要人工动作: ${action}`) : []),
        openThread ? `优先恢复 thread ${openThread.name}: ${openThread.title}` : '',
        latestForensics && latestForensics.report_file
          ? `最近一次 forensics: ${latestForensics.report_file} (${latestForensics.highest_severity || 'info'})`
          : '',
        ...suggestedTools.slice(0, 2).map(tool => `可优先评估工具: ${tool.name} (${tool.status})`),
        primaryToolRecommendation
          ? `首选工具草案: ${primaryToolRecommendation.cli_draft}`
          : '',
        primaryToolRecommendation && (primaryToolRecommendation.missing_inputs || []).length > 0
          ? `工具待补参数: ${primaryToolRecommendation.missing_inputs.join(', ')}`
          : '',
        focus ? `先围绕 focus "${focus}" 继续` : '',
        lastFiles[0] ? `先重读 ${lastFiles[0]}` : '',
        openQuestions[0] ? `优先确认问题: ${openQuestions[0]}` : '',
        knownRisks[0] ? `复查风险: ${knownRisks[0]}` : '',
        contextHygiene.level === 'consider-clearing'
          ? `上下文提醒: ${contextHygiene.recommendation}`
          : '',
        contextHygiene.level === 'suggest-clearing'
          ? `上下文提醒: ${contextHygiene.recommendation}`
          : '',
        `建议流程: ${suggestedFlow}`,
        `建议命令: ${next.command} (${next.reason})`
      ])
    };
  }

  function buildResumeContext() {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const guidance = buildGuidance(resolved, handoff);
    const contextHygiene = buildContextHygiene(resolved, handoff, 'resume');

    return enrichWithToolSuggestions({
      summary: {
        project_root: resolved.session.project_root,
        profile: resolved.session.project_profile,
        packs: resolved.session.active_packs,
        focus: resolved.session.focus || '',
        preferences: getPreferences(resolved.session),
        suggested_flow: guidance.suggested_flow,
        resume_source: handoff ? 'handoff' : 'session',
        paused_at: resolved.session.paused_at || '',
        last_command: resolved.session.last_command || '',
        last_resumed_at: resolved.session.last_resumed_at || ''
      },
      effective: {
        agents: resolved.effective.agents,
        review_agents: resolved.effective.review_agents,
        review_axes: resolved.effective.review_axes,
        note_targets: resolved.effective.note_targets
      },
      handoff: handoff
        ? {
            timestamp: handoff.timestamp,
            status: handoff.status,
            next_action: handoff.next_action,
            context_notes: handoff.context_notes,
            human_actions_pending: handoff.human_actions_pending,
            last_files: handoff.last_files
          }
        : null,
      thread: resolveActiveThread(resolved.session),
      diagnostics: resolved.session.diagnostics || { latest_forensics: {} },
      carry_over: {
        last_files: resolved.session.last_files || [],
        open_questions: resolved.session.open_questions || [],
        known_risks: resolved.session.known_risks || []
      },
      tool_recommendation: guidance.primary_tool_recommendation,
      context_hygiene: contextHygiene,
      next_actions: guidance.next_actions
    }, resolved);
  }

  function buildNextContext() {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const guidance = buildGuidance(resolved, handoff);
    const health = getHealthReport ? getHealthReport() : null;
    const gatedByHealth = shouldGateNextWithHealth(resolved, handoff, guidance.next.command, health);
    const nextCommand = gatedByHealth
      ? {
          command: 'health',
          reason: '当前基础接入尚未闭环，先按 health 建议补齐硬件真值或 adapter 同步，再进入 scan',
          health_next_commands: health && Array.isArray(health.next_commands) ? health.next_commands : [],
          health_quickstart: health && health.quickstart ? health.quickstart : null
        }
      : guidance.next;
    const contextHygiene = buildContextHygiene(resolved, handoff, nextCommand.command);
    const nextActions = gatedByHealth
      ? runtime.unique([
          ...(health && health.quickstart
            ? [
                health.quickstart.followup
                  ? `首次闭环: ${health.quickstart.followup}`
                  : `首次闭环: ${(health.quickstart.steps || [])
                      .map(step => step.cli || step.label)
                      .filter(Boolean)
                      .join(' -> ')}`
              ]
            : []),
          ...(health && Array.isArray(health.next_commands)
            ? health.next_commands.map(item => `优先执行 health 建议: ${item.cli}`)
            : []),
          ...guidance.next_actions
        ])
      : guidance.next_actions;

    return enrichWithToolSuggestions({
      current: {
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
      },
      handoff: handoff
        ? {
            next_action: handoff.next_action,
            context_notes: handoff.context_notes,
            human_actions_pending: handoff.human_actions_pending,
            timestamp: handoff.timestamp
          }
        : null,
      thread: resolveActiveThread(resolved.session),
      diagnostics: resolved.session.diagnostics || { latest_forensics: {} },
      health: health
        ? {
            status: health.status,
            summary: health.summary,
            next_commands: health.next_commands || [],
            quickstart: health.quickstart || null
          }
        : null,
      next: {
        command: nextCommand.command,
        reason: nextCommand.reason,
        skill: `$emb-${nextCommand.command}`,
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [nextCommand.command]),
        gated_by_health: gatedByHealth,
        health_next_commands: nextCommand.health_next_commands || [],
        health_quickstart: nextCommand.health_quickstart || null,
        tool_recommendation: guidance.primary_tool_recommendation
      },
      context_hygiene: contextHygiene,
      next_actions: nextActions
    }, resolved);
  }

  function buildPausePayload(noteText) {
    const resolved = resolveSession();
    const suggestedFlow = suggestFlow(resolved);
    const focus = resolved.session.focus || '';
    const nextAction = noteText && noteText.trim()
      ? noteText.trim()
      : (
          suggestedFlow.includes('debug')
            ? '先围绕未决问题执行 debug，再决定是否进入 do'
            : suggestedFlow.includes('plan')
              ? '先执行 plan，锁定真值、约束、风险和步骤'
              : suggestedFlow.includes('review')
                ? '先执行 review，确认结构风险后再动手'
                : '先执行 scan，再直接推进 do'
        );

    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      status: 'paused',
      focus,
      profile: resolved.profile.name,
      packs: resolved.session.active_packs,
      last_command: resolved.session.last_command || '',
      suggested_flow: suggestedFlow,
      next_action: nextAction,
      context_notes: noteText || '',
      human_actions_pending: [],
      last_files: resolved.session.last_files || [],
      open_questions: resolved.session.open_questions || [],
      known_risks: resolved.session.known_risks || []
    };
  }

  function buildStatus() {
    const resolved = resolveSession();
    const projectConfig = getProjectConfig();
    const handoff = loadHandoff();
    const contextHygiene = buildContextHygiene(resolved, handoff, 'status');

    return enrichWithToolSuggestions({
      session_version: resolved.session.session_version,
      project_root: resolved.session.project_root,
      project_name: resolved.session.project_name,
      project_profile: resolved.session.project_profile,
      active_packs: resolved.session.active_packs,
      focus: resolved.session.focus || '',
      preferences: getPreferences(resolved.session),
      project_defaults: projectConfig,
      agents: resolved.effective.agents,
      review_axes: resolved.effective.review_axes,
      note_targets: resolved.effective.note_targets,
      arch_review_triggers: resolved.effective.arch_review_triggers,
      open_questions: resolved.session.open_questions,
      known_risks: resolved.session.known_risks,
      last_files: resolved.session.last_files,
      context_hygiene: contextHygiene
    }, resolved);
  }

  return {
    getPreferences,
    buildStatus,
    buildReviewContext,
    shouldSuggestArchReview,
    shouldSuggestForensics,
    shouldSuggestScanTool,
    buildArchReviewContext,
    buildNextCommand,
    buildContextHygiene,
    buildGuidance,
    buildResumeContext,
    buildNextContext,
    shouldSuggestPlan,
    shouldSuggestReview,
    suggestFlow,
    buildPausePayload
  };
}

module.exports = {
  createSessionFlowHelpers
};
