'use strict';

const fs = require('fs');
const path = require('path');

const runtimeHostHelpers = require('./runtime-host.cjs');
const chipSupportStatusHelpers = require('./chip-support-status.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');
const projectInputState = require('./project-input-state.cjs');
const qualityGateHelpers = require('./quality-gates.cjs');
const workflowRegistry = require('./workflow-registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const FORENSICS_PATTERNS = [
  'drift',
  'drifting',
  'stuck',
  'keeps failing',
  'repeat failure',
  'resume',
  'handoff',
  'repeated failure',
  'context drift',
  'after resume'
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
  'pin',
  'register',
  'manual',
  'timer',
  'comparator',
  'pwm',
  'baud rate',
  'timing',
  'formula',
  'peripheral'
];
const REVIEW_PATTERNS = [
  'ota',
  'rollback',
  'reconnect',
  'offline',
  'upgrade',
  'release',
  'mass production',
  'rollback',
  'reconnect',
  'offline',
  'upgrade',
  'release'
];

function createSessionFlowHelpers(deps) {
  const {
    runtime,
    RUNTIME_CONFIG,
    DEFAULT_ARCH_REVIEW_PATTERNS,
    getRuntimeHost,
    resolveSession,
    getHealthReport,
    getProjectConfig,
    loadHandoff,
    loadContextSummary,
    enrichWithToolSuggestions,
    getActiveTask
  } = deps;
  const blankSelectionModeCache = new Map();

  function isBlankProjectSelectionMode(resolved) {
    const projectRoot = resolved && resolved.session ? resolved.session.project_root : '';
    const hardware = resolved && resolved.hardware ? resolved.hardware : {};
    const identity = hardware && hardware.identity ? hardware.identity : hardware;
    const cacheKey = JSON.stringify({
      projectRoot,
      model: identity && identity.model ? identity.model : '',
      package: identity && identity.package ? identity.package : '',
      chipProfile: hardware && hardware.chip_profile ? hardware.chip_profile.name || 'present' : ''
    });

    if (blankSelectionModeCache.has(cacheKey)) {
      return blankSelectionModeCache.get(cacheKey);
    }

    const result = projectInputState.detectBlankProjectSelectionMode({
      projectRoot,
      hardware
    });
    blankSelectionModeCache.set(cacheKey, result);
    return result;
  }

  function readJsonIfExists(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      return runtime.readJson(filePath);
    } catch {
      return null;
    }
  }

  function getRecentSchematicAnalysis(resolved) {
    const lastFiles =
      resolved && resolved.session && Array.isArray(resolved.session.last_files)
        ? resolved.session.last_files
        : [];
    const projectRoot = resolved && resolved.session ? resolved.session.project_root : '';
    if (!projectRoot) {
      return null;
    }

    const parsedFiles = lastFiles.filter(file =>
      /(?:^|\/)\.emb-agent\/cache\/schematics\/[^/]+\/parsed\.json$/i.test(String(file || ''))
    );
    const latestParsed = parsedFiles[0] || '';
    if (!latestParsed) {
      return null;
    }

    const summaryFile = latestParsed.replace(/parsed\.json$/i, 'summary.json');
    const summary = readJsonIfExists(path.join(projectRoot, summaryFile));
    const agentAnalysis =
      summary && summary.agent_analysis && typeof summary.agent_analysis === 'object'
        ? summary.agent_analysis
        : null;
    if (!agentAnalysis) {
      return null;
    }

    return {
      summary_file: summaryFile,
      parsed_file: latestParsed,
      source_path: summary.source_path || '',
      recommended_agent: agentAnalysis.recommended_agent || '',
      summary: agentAnalysis.summary || '',
      confirmation_targets: Array.isArray(agentAnalysis.confirmation_targets)
        ? agentAnalysis.confirmation_targets
        : [],
      cli_hint: agentAnalysis.cli_hint || ''
    };
  }

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
    const blankSelectionMode = isBlankProjectSelectionMode(resolved);

    if (hasChipProfile || toolRecommendations.length > 0) {
      return false;
    }

    const blockingChecks = blankSelectionMode
      ? new Set(['req_truth'])
      : new Set(['hw_truth', 'req_truth', 'hardware_identity']);
    const hasBlockingCheck = Array.isArray(healthReport.checks)
      ? healthReport.checks.some(item => blockingChecks.has(item.key) && (item.status === 'warn' || item.status === 'fail'))
      : false;
    const actionableHealthCommands = Array.isArray(healthReport.next_commands)
      ? healthReport.next_commands.some(item => [
          ...(blankSelectionMode
            ? ['init', 'doc-apply']
            : ['init', 'support-source-add', 'support-sync', 'support-bootstrap', 'support-derive-from-doc', 'doc-apply'])
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
    const latestExecutor =
      session &&
      session.diagnostics &&
      session.diagnostics.latest_executor
        ? session.diagnostics.latest_executor
        : null;

    return runtime.unique([
      session && session.focus ? session.focus : '',
      ...((session && session.open_questions) || []),
      ...((session && session.known_risks) || []),
      session && session.active_task && session.active_task.title ? session.active_task.title : '',
      latestForensics && latestForensics.problem ? latestForensics.problem : '',
      latestExecutor && latestExecutor.status ? `executor ${latestExecutor.name || ''} ${latestExecutor.status}` : '',
      latestExecutor && latestExecutor.stderr_preview ? latestExecutor.stderr_preview : '',
      latestExecutor && latestExecutor.stdout_preview ? latestExecutor.stdout_preview : ''
    ]).filter(Boolean);
  }

  function hasPattern(texts, patterns) {
    return texts.some(text =>
      patterns.some(pattern => String(text).toLowerCase().includes(String(pattern).toLowerCase()))
    );
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
    const latestExecutor =
      session.diagnostics && session.diagnostics.latest_executor
        ? session.diagnostics.latest_executor
        : null;
    const hasForensicsSignal = hasPattern(texts, FORENSICS_PATTERNS);

    if ((session.last_command || '').startsWith('review')) {
      return false;
    }

    if (latestExecutor && ['failed', 'error'].includes(latestExecutor.status)) {
      return true;
    }

    if (latestForensics && latestForensics.highest_severity === 'high') {
      return true;
    }

    return hasForensicsSignal;
  }

  function getQualityGateSummary(resolved) {
    const diagnostics = resolved && resolved.session ? resolved.session.diagnostics : {};
    const projectConfig = resolved ? resolved.project_config : null;
    return qualityGateHelpers.evaluateQualityGates(projectConfig, diagnostics);
  }

  function shouldSuggestScanTool(resolved) {
    const session = resolved.session;
    const texts = collectRoutingTexts(session);
    const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];

    return hasPattern(texts, HARDWARE_TOOL_PATTERNS) || suggestedTools.length > 0;
  }

  function buildInjectedSpecs(resolved, task, handoff, limit = 5) {
    const snapshot = workflowRegistry.buildInjectedSpecSnapshot(
      ROOT,
      runtime.getProjectExtDir(resolved.session.project_root),
      {
        profile: resolved.profile.name,
        packs: resolved.session.active_packs || [],
        task: task || null,
        handoff: handoff || null
      },
      { limit }
    );

    return (snapshot.items || []).map(item => ({
      name: item.name,
      title: item.title || item.name,
      summary: item.summary || '',
      display_path: item.display_path,
      scope: item.scope,
      priority: item.priority,
      reasons: item.reasons || []
    }));
  }

  function buildReviewContext() {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const activeTask = getActiveTask ? getActiveTask() : null;

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
      last_files: resolved.session.last_files,
      injected_specs: buildInjectedSpecs(resolved, activeTask, handoff)
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
      warning: 'This is an explicit heavyweight review entry point. Use it only for selection reviews, solution preflight, PoC-to-production, or pre-mortem scenarios.'
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
    const qualityGates = getQualityGateSummary(resolved);
    const hasQualityGateBlock =
      qualityGates.enabled &&
      qualityGates.gate_status !== 'pass' &&
      (
        (session.last_command || '').trim() === 'do' ||
        (session.last_command || '').trim() === 'verify' ||
        (session.last_command || '').startsWith('verify ') ||
        (session.last_command || '').startsWith('executor run')
      );
    const blankSelectionMode = isBlankProjectSelectionMode(resolved);
    const useBlankSelectionFlow = blankSelectionMode && lastFiles.length === 0;

    if (hasQualityGateBlock) {
      const blockingItems = runtime.unique([
        ...qualityGates.failed_gates,
        ...qualityGates.pending_gates,
        ...qualityGates.rejected_signoffs,
        ...qualityGates.pending_signoffs
      ]);
      return {
        command: 'verify',
        reason: qualityGates.blocking_summary ||
          (
            qualityGates.gate_status === 'failed'
              ? `Quality gates failed (${blockingItems.join(', ')}); close executor checks or human signoffs before leaving verify`
              : `Quality gates are pending (${blockingItems.join(', ')}); run executor checks or confirm human signoffs before leaving verify`
          )
      };
    }

    if (shouldSuggestForensics(resolved)) {
      const latestExecutor =
        session.diagnostics && session.diagnostics.latest_executor
          ? session.diagnostics.latest_executor
          : null;
      return {
        command: 'review',
        reason: latestExecutor && ['failed', 'error'].includes(latestExecutor.status)
          ? `Latest executor ${latestExecutor.name || 'unknown'} ${latestExecutor.status}; run review first to narrow the failure scene`
          : 'Current context shows drift, resume failure, or repeated failure signals; run review first to narrow the problem space'
      };
    }

    if (useBlankSelectionFlow) {
      if ((session.last_command || '').trim() === 'do' || (session.last_command || '').startsWith('do ')) {
        return {
          command: 'verify',
          reason: 'A concept-stage do step just finished; verify that the recorded shortlist, constraints, and evidence are explicit before moving on'
        };
      }

      if (preferences.review_mode === 'always') {
        return {
          command: 'review',
          reason: 'Current preferences require review first before closing the concept-stage selection pass'
        };
      }

      if (shouldSuggestArchReview(resolved)) {
        return {
          command: 'arch-review',
          reason: 'Current concept-stage context shows solution preflight signals; run a system-level architecture review first'
        };
      }

      if (shouldSuggestReview(resolved)) {
        return {
          command: 'review',
          reason: 'A review signal is active; run a structural review before locking the concept-stage selection path'
        };
      }

      if ((session.last_command || '').trim() === 'plan' || (session.last_command || '').startsWith('plan ')) {
        return {
          command: 'do',
          reason: `Constraints are already structured; execute the smallest durable selection update in ${runtime.getProjectAssetRelativePath('req.yaml')} or supporting docs`
        };
      }

      if (shouldSuggestPlan(resolved) || (session.last_command || '').trim() === 'scan' || (session.last_command || '').startsWith('scan ')) {
        return {
          command: 'plan',
          reason: `Concept-stage scan is complete enough; turn ${runtime.getProjectAssetRelativePath('req.yaml')} into a ranked shortlist and explicit chip-selection criteria before executing updates`
        };
      }

      return {
        command: 'scan',
        reason: `Project is still in definition and chip-selection mode; run scan to converge goals, constraints, interfaces, and candidate devices from ${runtime.getProjectAssetRelativePath('req.yaml')} first`
      };
    }

    if (openQuestions.length > 0 && !shouldSuggestScanTool(resolved)) {
      return {
        command: 'debug',
        reason: `Open questions remain; narrow the root cause around "${openQuestions[0]}" first`
      };
    }

    if (shouldSuggestScanTool(resolved)) {
      const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];
      const firstTool = suggestedTools[0];
      return {
        command: 'scan',
        reason: firstTool
          ? `This looks more like hardware/formula/tool triage; run scan and evaluate ${firstTool.name} first`
          : 'This looks more like hardware truth, register, pin, or formula triage; run scan before deciding whether to enter tool'
      };
    }

    if ((session.last_command || '').trim() === 'do' && hasActiveContext) {
      return {
        command: 'verify',
        reason: 'A do step just finished; close this iteration with the embedded verification checklist and result record first'
      };
    }

    if (preferences.review_mode === 'always') {
      return {
        command: 'review',
        reason: 'Current preferences require review first before choosing the execution path'
      };
    }

    if (shouldSuggestArchReview(resolved)) {
      return {
        command: 'arch-review',
        reason: 'Current context shows selection or solution preflight signals; run a system-level architecture review first'
      };
    }

    if (shouldSuggestReview(resolved)) {
      return {
        command: 'review',
        reason:
          preferences.review_mode === 'always'
            ? 'Current preferences require review first before choosing the execution path'
            : 'A review signal is active; run a structural review before choosing the execution path'
      };
    }

    if (shouldSuggestPlan(resolved)) {
      return {
        command: 'plan',
        reason:
          preferences.plan_mode === 'always'
            ? 'Current preferences require a micro-plan before execution'
            : 'Current context has entered a complex-task signal; make a micro-plan before execution'
      };
    }

    if (!hasActiveContext) {
      return {
        command: 'scan',
        reason: 'No effective working context exists yet; run a minimal scan first'
      };
    }

    if (lastFiles.length === 0) {
      return {
        command: 'scan',
        reason: 'There is no recent-file record yet; add a scan first to lock onto the real change point'
      };
    }

    return {
      command: 'do',
      reason: 'Context is already sufficient; proceed with the minimal execution directly'
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
      reasons.push(`Recent files have reached ${lastFiles.length}, which means the context span is starting to widen`);
    } else if (lastFiles.length >= 3) {
      score += 1;
      reasons.push(`There are already ${lastFiles.length} recent files; close down the scope before digging deeper`);
    }

    if (openQuestions.length >= 2) {
      score += 2;
      reasons.push(`There are still ${openQuestions.length} open questions`);
    } else if (openQuestions.length === 1) {
      score += 1;
      reasons.push('Open questions are still pending');
    }

    if (knownRisks.length >= 2) {
      score += 2;
      reasons.push(`There are still ${knownRisks.length} known risks to track`);
    } else if (knownRisks.length === 1) {
      score += 1;
      reasons.push('Risk items are already pending');
    }

    if (focus.trim() !== '' && heavyCommands.includes(command)) {
      score += 1;
      reasons.push(`The latest command was ${command}, and the session is still digging around the focus`);
    }

    if (handoff) {
      score += 2;
      reasons.push('A pause handoff already exists; you can clear context and resume directly');
    }

    let level = 'stable';
    if (handoff || score >= 5) {
      level = 'suggest-clearing';
    } else if (score >= 2) {
      level = 'consider-clearing';
    }

    let recommendation = 'Current context is still light; no proactive cleanup is needed.';
    if (level === 'consider-clearing') {
      recommendation = handoff
        ? 'Context is getting heavier. If you are about to switch tasks or dig deeper, clear context directly and then resume.'
        : 'Context is getting heavier. If you are about to switch tasks or dig deeper, pause first, then clear context, and resume afterward.';
    } else if (level === 'suggest-clearing') {
      recommendation = handoff
        ? 'Current context is already heavy and a handoff exists; clear context now and resume afterward.'
        : 'Current context is already heavy; pause now, then clear context, and resume afterward.';
    }

    return {
      level,
      reasons,
      recommendation,
      pause_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['pause']),
      compress_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['context', 'compress']),
      resume_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
      clear_hint: handoff ? 'clear -> resume' : 'pause -> clear -> resume',
      handoff_ready: Boolean(handoff)
    };
  }

  function getToolRecommendationScore(item) {
    const status = chipSupportStatusHelpers.normalizeChipSupportStatus(item && item.status ? item.status : '');
    if (status === 'ready') return 0;
    if (status === 'draft-chip-support') return 1;
    if (status === 'route-required') return 2;
    if (status === 'chip-support-required') return 3;
    return 9;
  }

  function getToolRecommendationTrustScore(item) {
    return item && item.trust && Number.isFinite(item.trust.score)
      ? Number(item.trust.score)
      : 0;
  }

  function buildAdapterHealthHints(healthReport, primaryToolRecommendation) {
    const adapterHealth =
      healthReport && healthReport.chip_support_health
        ? healthReport.chip_support_health
        : null;
    const primary = adapterHealth && adapterHealth.primary ? adapterHealth.primary : null;

    if (!primary) {
      return [];
    }

    if (primary.executable) {
      return [
        `Chip support trust: ${primary.tool} ${primary.grade} (${primary.score}/100)`
      ];
    }

    return [
      `Chip support trust reminder: ${primary.tool} is currently ${primary.grade} (${primary.score}/100)`,
      `Handle the chip-support gap first: ${primary.recommended_action}`,
      primaryToolRecommendation && primaryToolRecommendation.cli_draft
        ? `Use the current tool draft for calibration first; do not treat it as ground truth yet: ${primaryToolRecommendation.cli_draft}`
        : 'Use the current tool output for calibration first; do not treat it as ground truth yet'
    ];
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
          Number(Boolean(right.item && right.item.trust && right.item.trust.executable)) -
            Number(Boolean(left.item && left.item.trust && left.item.trust.executable)) ||
          getToolRecommendationTrustScore(right.item) - getToolRecommendationTrustScore(left.item) ||
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

  function buildMemorySummaryRecoveryPointers() {
    return runtime.unique([
      `Refresh live session status: ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['status'])}`,
      `Inspect merged live session: ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resolve'])}`,
      `Reload carry-over guidance: ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume'])}`,
      `Recompute the next action from live state: ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['dispatch', 'next'])}`
    ]);
  }

  function buildMemorySummaryArtifact(resolved, handoff, source) {
    const session = resolved.session;
    const activeTask = getActiveTask ? getActiveTask() : null;
    const diagnostics = session.diagnostics || {};
    const latestForensics = diagnostics.latest_forensics || {};
    const latestExecutor = diagnostics.latest_executor || {};
    const capturedAt = new Date().toISOString();
    const summarySource = source || 'session';

    return {
      version: '1.0',
      generated_at: capturedAt,
      captured_at: capturedAt,
      source: summarySource,
      snapshot_label: `Point-in-time ${summarySource} snapshot captured at ${capturedAt}`,
      stale_note: 'This compact snapshot is static and will not auto-update; rerun a recovery pointer to refresh live state.',
      recovery_pointers: buildMemorySummaryRecoveryPointers(),
      focus: session.focus || '',
      profile: resolved.profile.name,
      packs: session.active_packs || [],
      last_command: session.last_command || '',
      suggested_flow: handoff && handoff.suggested_flow ? handoff.suggested_flow : suggestFlow(resolved),
      next_action: handoff && handoff.next_action ? handoff.next_action : '',
      context_notes: handoff && handoff.context_notes ? handoff.context_notes : '',
      last_files: session.last_files || [],
      open_questions: session.open_questions || [],
      known_risks: session.known_risks || [],
      active_task: activeTask
        ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            path: activeTask.path
          }
        : {
            name: '',
            title: '',
            status: '',
            path: ''
          },
      diagnostics: {
        latest_forensics: {
          report_file: latestForensics.report_file || '',
          highest_severity: latestForensics.highest_severity || '',
          problem: latestForensics.problem || ''
        },
        latest_executor: {
          name: latestExecutor.name || '',
          status: latestExecutor.status || '',
          risk: latestExecutor.risk || '',
          exit_code: latestExecutor.exit_code === undefined ? null : latestExecutor.exit_code,
          stderr_preview: latestExecutor.stderr_preview || '',
          stdout_preview: latestExecutor.stdout_preview || ''
        }
      }
    };
  }

  function buildMemorySummaryView(memorySummary) {
    if (!memorySummary) {
      return null;
    }

    return {
      generated_at: memorySummary.generated_at || '',
      captured_at: memorySummary.captured_at || '',
      source: memorySummary.source || '',
      snapshot_label: memorySummary.snapshot_label || '',
      stale_note: memorySummary.stale_note || '',
      recovery_pointers: memorySummary.recovery_pointers || [],
      focus: memorySummary.focus || '',
      profile: memorySummary.profile || '',
      last_command: memorySummary.last_command || '',
      suggested_flow: memorySummary.suggested_flow || '',
      next_action: memorySummary.next_action || '',
      context_notes: memorySummary.context_notes || '',
      packs: memorySummary.packs || [],
      last_files: memorySummary.last_files || [],
      open_questions: memorySummary.open_questions || [],
      known_risks: memorySummary.known_risks || [],
      active_task: memorySummary.active_task || { name: '', title: '', status: '', path: '' },
      diagnostics: memorySummary.diagnostics || { latest_forensics: {}, latest_executor: {} }
    };
  }

  function buildGuidance(resolved, handoff, memorySummary) {
    const session = resolved.session;
    const focus = session.focus || '';
    const openQuestions = session.open_questions || [];
    const knownRisks = session.known_risks || [];
    const lastFiles = session.last_files || [];
    const activeTask = getActiveTask ? getActiveTask() : null;
    const recommendedSources = (resolved.effective && resolved.effective.recommended_sources) || [];
    const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];
    const toolRecommendations = (resolved.effective && resolved.effective.tool_recommendations) || [];
    const primaryToolRecommendation = selectPrimaryToolRecommendation(toolRecommendations);
    const primaryRegisterSource = recommendedSources.find(item => item.priority_group === 'register-summary') || null;
    const primarySource = primaryRegisterSource || recommendedSources[0] || null;
    const latestForensics =
      session.diagnostics && session.diagnostics.latest_forensics
        ? session.diagnostics.latest_forensics
        : null;
    const latestExecutor =
      session.diagnostics && session.diagnostics.latest_executor
        ? session.diagnostics.latest_executor
        : null;
    const qualityGates = getQualityGateSummary(resolved);
    const suggestedFlow = handoff && handoff.suggested_flow
      ? handoff.suggested_flow
      : suggestFlow(resolved);
    const next = buildNextCommand(resolved, handoff);
    const contextHygiene = buildContextHygiene(resolved, handoff, next.command);
    const summaryTask =
      memorySummary &&
      memorySummary.active_task &&
      memorySummary.active_task.name
        ? memorySummary.active_task
        : activeTask;
    const summaryLatestForensics =
      memorySummary &&
      memorySummary.diagnostics &&
      memorySummary.diagnostics.latest_forensics &&
      memorySummary.diagnostics.latest_forensics.report_file
        ? memorySummary.diagnostics.latest_forensics
        : latestForensics;
    const summaryLatestExecutor =
      memorySummary &&
      memorySummary.diagnostics &&
      memorySummary.diagnostics.latest_executor &&
      memorySummary.diagnostics.latest_executor.name
        ? memorySummary.diagnostics.latest_executor
        : latestExecutor;
    const summaryLastFiles =
      memorySummary && Array.isArray(memorySummary.last_files) && memorySummary.last_files.length > 0
        ? memorySummary.last_files
        : lastFiles;
    const summaryOpenQuestions =
      memorySummary && Array.isArray(memorySummary.open_questions) && memorySummary.open_questions.length > 0
        ? memorySummary.open_questions
        : openQuestions;
    const summaryKnownRisks =
      memorySummary && Array.isArray(memorySummary.known_risks) && memorySummary.known_risks.length > 0
        ? memorySummary.known_risks
        : knownRisks;
    const schematicAnalysis = getRecentSchematicAnalysis(resolved);

    return {
      suggested_flow: suggestedFlow,
      next,
      schematic_analysis: schematicAnalysis,
      primary_tool_recommendation: primaryToolRecommendation,
      next_actions: runtime.unique([
        memorySummary && memorySummary.generated_at
          ? `Compact summary captured: ${memorySummary.generated_at}`
          : '',
        !memorySummary && ['consider-clearing', 'suggest-clearing'].includes(contextHygiene.level)
          ? `Capture a compact snapshot before clearing: ${contextHygiene.compress_cli}`
          : '',
        memorySummary && memorySummary.next_action
          ? `Resume from compact summary: ${memorySummary.next_action}`
          : '',
        handoff && handoff.next_action ? `Resume from handoff: ${handoff.next_action}` : '',
        ...(handoff ? handoff.human_actions_pending.map(action => `Manual action required: ${action}`) : []),
        summaryTask ? `Resume task ${summaryTask.name} first: ${summaryTask.title}` : '',
        summaryLatestForensics && summaryLatestForensics.report_file
          ? `Latest forensics: ${summaryLatestForensics.report_file} (${summaryLatestForensics.highest_severity || 'info'})`
          : '',
        summaryLatestExecutor && summaryLatestExecutor.name
          ? `Latest executor: ${summaryLatestExecutor.name} ${summaryLatestExecutor.status || 'unknown'}${
            summaryLatestExecutor.exit_code === null ? '' : `, exit=${summaryLatestExecutor.exit_code}`
          }`
          : '',
        summaryLatestExecutor && ['failed', 'error'].includes(summaryLatestExecutor.status)
          ? `Start review around the failed executor first: ${summaryLatestExecutor.name}${summaryLatestExecutor.stderr_preview ? ` | ${summaryLatestExecutor.stderr_preview}` : ''}`
          : '',
        qualityGates.enabled
          ? `Quality gate status: ${qualityGates.status_summary || qualityGates.gate_status}`
          : '',
        qualityGates.blocking_summary && qualityGates.blocking_summary !== qualityGates.status_summary
          ? `Blocking gate: ${qualityGates.blocking_summary}`
          : '',
        ...qualityGates.recommended_runs.map(item => `Run quality gate first: ${item}`),
        ...qualityGates.recommended_signoffs.map(item => `Confirm human gate first: ${item}`),
        ...qualityGates.rejected_signoffs.map(item => `Human signoff rejected: ${item}`),
        schematicAnalysis && schematicAnalysis.recommended_agent
          ? `Analyze the latest schematic with ${schematicAnalysis.recommended_agent} first: ${schematicAnalysis.parsed_file}`
          : '',
        schematicAnalysis && schematicAnalysis.confirmation_targets.length > 0
          ? `Confirm schematic-derived fields before truth edits: ${schematicAnalysis.confirmation_targets.join(', ')}`
          : '',
        schematicAnalysis && schematicAnalysis.cli_hint
          ? `Schematic handoff: ${schematicAnalysis.cli_hint}`
          : '',
        primaryRegisterSource ? `Re-read the register summary first: ${primaryRegisterSource.path}` : '',
        !primaryRegisterSource && primarySource ? `Re-read the source summary first: ${primarySource.path}` : '',
        ...suggestedTools.slice(0, 2).map(tool => `Tool to evaluate first: ${tool.name} (${tool.status})`),
        primaryToolRecommendation
          ? `Preferred tool draft: ${primaryToolRecommendation.cli_draft}`
          : '',
        primaryToolRecommendation && (primaryToolRecommendation.missing_inputs || []).length > 0
          ? `Missing tool inputs: ${primaryToolRecommendation.missing_inputs.join(', ')}`
          : '',
        focus ? `Continue around focus "${focus}" first` : '',
        summaryLastFiles[0] ? `Re-read ${summaryLastFiles[0]} first` : '',
        summaryOpenQuestions[0] ? `Confirm this question first: ${summaryOpenQuestions[0]}` : '',
        summaryKnownRisks[0] ? `Re-check this risk: ${summaryKnownRisks[0]}` : '',
        contextHygiene.level === 'consider-clearing'
          ? `Context reminder: ${contextHygiene.recommendation}`
          : '',
        contextHygiene.level === 'suggest-clearing'
          ? `Context reminder: ${contextHygiene.recommendation}`
          : '',
        `Suggested flow: ${suggestedFlow}`,
        `Suggested command: ${next.command} (${next.reason})`
      ])
    };
  }

  function buildWorkflowStage(nextCommand, resolved) {
    const command = String(nextCommand && nextCommand.command ? nextCommand.command : '').trim();
    const blankSelectionMode = isBlankProjectSelectionMode(resolved);

    if (command === 'health') {
      return {
        name: 'health-gate',
        why: 'Base hardware truth or chip support health is not closed yet; complete health closure first',
        exit_criteria: 'Health next commands are closed and the next command is no longer health',
        primary_command: 'health'
      };
    }

    if (command === 'scan') {
      return {
        name: blankSelectionMode ? 'selection' : 'triage',
        why: blankSelectionMode
          ? `Requirements and interfaces are not converged enough yet; read ${runtime.getProjectAssetRelativePath('req.yaml')} and narrow the first viable chip candidates`
          : 'Entry point, truth source, or failure scene is not narrow enough yet',
        exit_criteria: blankSelectionMode
          ? 'Project constraints are explicit enough to shortlist a real chip candidate or first hardware target'
          : 'The real change point and evidence source are explicit',
        primary_command: command
      };
    }

    if (['plan', 'arch-review'].includes(command)) {
      return {
        name: 'planning',
        why: 'Current work has complexity or architecture risk and needs a preflight plan',
        exit_criteria: 'Execution scope, constraints, and checks are explicit',
        primary_command: command
      };
    }

    if (['review', 'verify'].includes(command)) {
      return {
        name: 'closure',
        why: 'Current iteration should be closed with review evidence and verification',
        exit_criteria: 'Required checks are captured and no blocking risk remains',
        primary_command: command
      };
    }

    return {
      name: 'execution',
      why: 'Context is already converged enough for direct implementation or root-cause narrowing',
      exit_criteria: 'Implementation change or debug result is produced with evidence',
      primary_command: command || 'do'
    };
  }

  function buildResumeContext() {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const memorySummary = loadContextSummary ? loadContextSummary() : null;
    const guidance = buildGuidance(resolved, handoff, memorySummary);
    const contextHygiene = buildContextHygiene(resolved, handoff, 'resume');
    const activeTask = getActiveTask ? getActiveTask() : null;
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);

    return enrichWithToolSuggestions({
      summary: {
        project_root: resolved.session.project_root,
        profile: resolved.session.project_profile,
        packs: resolved.session.active_packs,
        developer: resolved.session.developer || { name: '', runtime: '' },
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
      task: activeTask
        ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            type: activeTask.type,
            path: activeTask.path,
            worktree_path: activeTask.worktree_path,
            artifacts: activeTask.artifacts,
            context_files: activeTask.context_files,
            context: activeTask.context,
            injected_specs:
              Array.isArray(activeTask.injected_specs) && activeTask.injected_specs.length > 0
                ? activeTask.injected_specs
                : injectedSpecs
          }
        : null,
      injected_specs: injectedSpecs,
      diagnostics: resolved.session.diagnostics || { latest_forensics: {}, latest_executor: {}, executor_history: {}, human_signoffs: {} },
      memory_summary: buildMemorySummaryView(memorySummary),
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
    const memorySummary = loadContextSummary ? loadContextSummary() : null;
    const guidance = buildGuidance(resolved, handoff, memorySummary);
    const health = getHealthReport ? getHealthReport() : null;
    const activeTask = getActiveTask ? getActiveTask() : null;
    const gatedByHealth = shouldGateNextWithHealth(resolved, handoff, guidance.next.command, health);
    const nextCommand = gatedByHealth
      ? {
          command: 'health',
          reason: 'The base integration is not closed yet. Follow the health guidance to complete hardware truth or chip support install before entering scan',
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
                  ? `First closure: ${health.quickstart.followup}`
                  : `First closure: ${(health.quickstart.steps || [])
                      .map(step => step.cli || step.label)
                      .filter(Boolean)
                      .join(' -> ')}`
              ]
            : []),
          ...(health && Array.isArray(health.next_commands)
            ? health.next_commands.map(item => `Run this health recommendation first: ${item.cli}`)
            : []),
          ...buildAdapterHealthHints(health, guidance.primary_tool_recommendation),
          ...guidance.next_actions
        ])
      : runtime.unique([
          ...buildAdapterHealthHints(health, guidance.primary_tool_recommendation),
          ...guidance.next_actions
        ]);
    const workflowStage = buildWorkflowStage(nextCommand, resolved);
    const qualityGates = getQualityGateSummary(resolved);
    const permissionGates = permissionGateHelpers.buildPermissionGates({
      quality_gates: qualityGates
    });
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);

    return enrichWithToolSuggestions({
      current: {
        project_root: resolved.session.project_root,
        profile: resolved.profile.name,
        packs: resolved.session.active_packs,
        developer: resolved.session.developer || { name: '', runtime: '' },
        focus: resolved.session.focus || '',
        preferences: getPreferences(resolved.session),
        last_command: resolved.session.last_command || '',
        suggested_flow: guidance.suggested_flow,
        resume_source: handoff ? 'handoff' : 'session',
        last_files: resolved.session.last_files || [],
        open_questions: resolved.session.open_questions || [],
        known_risks: resolved.session.known_risks || []
      },
      task: activeTask
        ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            type: activeTask.type,
            path: activeTask.path,
            worktree_path: activeTask.worktree_path,
            artifacts: activeTask.artifacts,
            context_files: activeTask.context_files,
            injected_specs:
              Array.isArray(activeTask.injected_specs) && activeTask.injected_specs.length > 0
                ? activeTask.injected_specs
                : injectedSpecs
          }
        : null,
      injected_specs: injectedSpecs,
      handoff: handoff
        ? {
            next_action: handoff.next_action,
            context_notes: handoff.context_notes,
            human_actions_pending: handoff.human_actions_pending,
            timestamp: handoff.timestamp
          }
        : null,
      diagnostics: resolved.session.diagnostics || { latest_forensics: {}, latest_executor: {}, executor_history: {}, human_signoffs: {} },
      memory_summary: buildMemorySummaryView(memorySummary),
      quality_gates: qualityGates,
      permission_gates: permissionGates,
      health: health
        ? {
            status: health.status,
            summary: health.summary,
            chip_support_health: health.chip_support_health || null,
            next_commands: health.next_commands || [],
            quickstart: health.quickstart || null
          }
        : null,
      next: {
        command: nextCommand.command,
        reason: nextCommand.reason,
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [nextCommand.command]),
        gated_by_health: gatedByHealth,
        health_next_commands: nextCommand.health_next_commands || [],
        health_quickstart: nextCommand.health_quickstart || null,
        schematic_analysis: guidance.schematic_analysis,
        tool_recommendation: guidance.primary_tool_recommendation
      },
      workflow_stage: workflowStage,
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
            ? 'Run debug around the open questions first, then decide whether to enter do'
            : suggestedFlow.includes('plan')
              ? 'Run plan first to lock truth sources, constraints, risks, and steps'
              : suggestedFlow.includes('review')
                ? 'Run review first and confirm structural risks before changing anything'
                : 'Run scan first, then proceed directly to do'
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

  function buildPauseContextSummary(noteText) {
    const resolved = resolveSession();
    const handoff = buildPausePayload(noteText);
    return {
      handoff,
      summary: buildMemorySummaryArtifact(resolved, handoff, 'pause')
    };
  }

  function buildCompressContextSummary(noteText) {
    const resolved = resolveSession();
    const snapshotSeed = buildPausePayload(noteText);
    return buildMemorySummaryArtifact(resolved, snapshotSeed, 'compress');
  }

  function buildStatus() {
    const resolved = resolveSession();
    const runtimeHost = typeof getRuntimeHost === 'function' ? getRuntimeHost() : { name: '', subagentBridge: {} };
    const projectConfig = getProjectConfig();
    const handoff = loadHandoff();
    const memorySummary = loadContextSummary ? loadContextSummary() : null;
    const contextHygiene = buildContextHygiene(resolved, handoff, 'status');
    const activeTask = getActiveTask ? getActiveTask() : null;
    const qualityGates = getQualityGateSummary(resolved);
    const permissionGates = permissionGateHelpers.buildPermissionGates({
      quality_gates: qualityGates
    });
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);

    return enrichWithToolSuggestions({
      session_version: resolved.session.session_version,
      runtime_host: runtimeHost.name || '',
      project_root: resolved.session.project_root,
      project_name: resolved.session.project_name,
      project_profile: resolved.session.project_profile,
      active_packs: resolved.session.active_packs,
      developer: resolved.session.developer || { name: '', runtime: '' },
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
      subagent_bridge: runtimeHost.subagentBridge || null,
      delegation_runtime:
        resolved.session && resolved.session.diagnostics && resolved.session.diagnostics.delegation_runtime
          ? resolved.session.diagnostics.delegation_runtime
          : null,
      memory_summary: buildMemorySummaryView(memorySummary),
      quality_gates: qualityGates,
      permission_gates: permissionGates,
      injected_specs: injectedSpecs,
      active_task: activeTask
        ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            type: activeTask.type,
            path: activeTask.path,
            worktree_path: activeTask.worktree_path,
            artifacts: activeTask.artifacts,
            context_files: activeTask.context_files,
            injected_specs:
              Array.isArray(activeTask.injected_specs) && activeTask.injected_specs.length > 0
                ? activeTask.injected_specs
                : injectedSpecs
          }
        : null,
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
    buildPausePayload,
    buildPauseContextSummary,
    buildCompressContextSummary
  };
}

module.exports = {
  createSessionFlowHelpers
};
