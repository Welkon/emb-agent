'use strict';

const fs = require('fs');
const path = require('path');

const runtimeHostHelpers = require('./runtime-host.cjs');
const chipSupportStatusHelpers = require('./chip-support-status.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');
const projectInputState = require('./project-input-state.cjs');
const qualityGateHelpers = require('./quality-gates.cjs');
const runtimeEventHelpers = require('./runtime-events.cjs');
const intentProviderHelpers = require('./intent-provider.cjs');
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
const TASK_CONVERGENCE_PROMPTS = [
  'What is the smallest durable outcome for this task?',
  'Which truth, hardware facts, or code entry points bound the change?',
  'What evidence will prove the task is actually closed?'
];

function createSessionFlowHelpers(deps) {
  const {
    runtime,
    RUNTIME_CONFIG,
    DEFAULT_ARCH_REVIEW_PATTERNS,
    getRuntimeHost,
    buildInitGuidance,
    resolveSession,
    getProjectStatePaths,
    getHealthReport,
    getProjectConfig,
    loadHandoff,
    loadContextSummary,
    enrichWithToolSuggestions,
    getActiveTask
  } = deps;
  const blankSelectionModeCache = new Map();
  const {
    analyzeIntentSelection,
    normalizeIntentRouterConfig
  } = intentProviderHelpers.createIntentProviderHelpers({ ROOT });

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

  function buildTaskConvergenceForNext(resolved, taskLike) {
    const task = taskLike && typeof taskLike === 'object' ? taskLike : null;
    if (!task || !String(task.name || '').trim()) {
      return null;
    }

    const hardware = resolved && resolved.hardware ? resolved.hardware : {};
    const identity = hardware && hardware.identity ? hardware.identity : {};
    const taskIdentity =
      task.bindings &&
      task.bindings.hardware &&
      task.bindings.hardware.identity &&
      typeof task.bindings.hardware.identity === 'object'
        ? task.bindings.hardware.identity
        : {};
    const selectionMode = String(hardware && hardware.selection_mode ? hardware.selection_mode : '').trim();
    const openQuestions = Array.isArray(task.open_questions) ? task.open_questions.filter(Boolean) : [];
    const knownRisks = Array.isArray(task.known_risks) ? task.known_risks.filter(Boolean) : [];
    const chipUnknown = !String(identity.model || taskIdentity.model || '').trim();
    const scanFirst = selectionMode === 'blank-project' || chipUnknown || openQuestions.length > 0;
    const reviewBeforeDo = knownRisks.length > 0;
    const prdPath = String(
      (task.artifacts && task.artifacts.prd) ||
      (task.name ? `.emb-agent/tasks/${task.name}/prd.md` : '')
    ).trim();
    const scanCli = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['scan']);
    const planCli = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['plan']);
    const doCli = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['do']);
    const reviewCli = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['review']);
    const recommendedPath = scanFirst ? 'scan-first' : 'plan-first';
    const recommendedReason = scanFirst
      ? 'Requirements, hardware truth, or decision inputs are still not explicit enough.'
      : 'The task already has enough context to lock a micro-plan before execution.';

    return {
      status: 'active-task',
      prd_path: prdPath,
      summary: 'Use the task PRD as the working contract. Re-read goal, constraints, acceptance, and open questions before choosing scan or plan.',
      prompts: TASK_CONVERGENCE_PROMPTS.slice(),
      recommended_path: recommendedPath,
      recommended_reason: recommendedReason,
      next_cli: scanFirst ? scanCli : planCli,
      then_cli: scanFirst ? planCli : doCli,
      paths: [
        {
          id: 'scan-first',
          when: 'Requirements, hardware truth, or the changed surface are still fuzzy.',
          commands: [scanCli, planCli],
          outcome: 'The PRD and project truth converge before mutation.'
        },
        {
          id: 'plan-first',
          when: 'Goal, boundaries, and acceptance are already explicit.',
          commands: [planCli, doCli],
          outcome: 'Execution starts from a short micro-plan instead of chat drift.'
        },
        {
          id: 'review-before-do',
          when: 'The task crosses timing, concurrency, release, or interface boundaries.',
          commands: [scanCli, planCli, reviewCli],
          outcome: 'Structural risks are explicit before implementation moves forward.'
        }
      ],
      review_hint: reviewBeforeDo
        ? 'Known risks are already recorded on this task; review may be needed before closure if they cross structural boundaries.'
        : ''
    };
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

  function getRecentHardwareDocAnalysis(resolved) {
    const lastFiles =
      resolved && resolved.session && Array.isArray(resolved.session.last_files)
        ? resolved.session.last_files
        : [];
    const projectRoot = resolved && resolved.session ? resolved.session.project_root : '';
    if (!projectRoot) {
      return null;
    }

    const parseFiles = lastFiles.filter(file =>
      /(?:^|\/)\.emb-agent\/cache\/docs\/[^/]+\/parse\.md$/i.test(String(file || ''))
    );
    const latestParse = parseFiles[0] || '';
    if (!latestParse) {
      return null;
    }

    const summaryFile = latestParse.replace(/parse\.md$/i, 'summary.json');
    const summary = readJsonIfExists(path.join(projectRoot, summaryFile));
    const agentAnalysis =
      summary && summary.agent_analysis && typeof summary.agent_analysis === 'object'
        ? summary.agent_analysis
        : null;
    const recommendedFlow =
      summary && summary.recommended_flow && typeof summary.recommended_flow === 'object'
        ? summary.recommended_flow
        : null;
    const handoffProtocol =
      summary && summary.handoff_protocol && typeof summary.handoff_protocol === 'object'
        ? summary.handoff_protocol
        : null;
    if (!agentAnalysis) {
      return null;
    }

    return {
      summary_file: summaryFile,
      markdown_file: latestParse,
      source_path: summary.source_path || '',
      recommended_agent: agentAnalysis.recommended_agent || '',
      summary: agentAnalysis.summary || '',
      artifact_path: agentAnalysis.artifact_path || '',
      init_command: agentAnalysis.init_command || '',
      derive_command: agentAnalysis.derive_command || '',
      confirmation_targets: Array.isArray(agentAnalysis.confirmation_targets)
        ? agentAnalysis.confirmation_targets
        : [],
      cli_hint: agentAnalysis.cli_hint || '',
      recommended_flow: recommendedFlow,
      handoff_protocol: handoffProtocol
    };
  }

  function shouldGateNextWithHealth(resolved, handoff, nextCommand, healthReport) {
    if (!healthReport || nextCommand !== 'scan' || handoff) {
      return false;
    }

    const session = resolved && resolved.session ? resolved.session : {};
    const initGuidance =
      typeof buildInitGuidance === 'function' && session.project_root
        ? buildInitGuidance(session.project_root)
        : null;
    if (
      initGuidance &&
      (initGuidance.project_definition_required || initGuidance.hardware_confirmation_required)
    ) {
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
            : ['init', 'support-source-add', 'support-sync', 'support-bootstrap', 'support-analysis-init', 'support-derive-from-analysis', 'doc-apply'])
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
        active_package: resolved.session.active_package || '',
        default_package: resolved.session.default_package || '',
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
      active_package: resolved.session.active_package || '',
      default_package: resolved.session.default_package || '',
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
    const activeTask = getActiveTask ? getActiveTask() : null;
    const preferences = getPreferences(session);
    const openQuestions = session.open_questions || [];
    const knownRisks = session.known_risks || [];
    const lastFiles = session.last_files || [];
    const focus = session.focus || '';
    const taskConvergence = buildTaskConvergenceForNext(resolved, activeTask);
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
    const initGuidance =
      typeof buildInitGuidance === 'function' && session.project_root
        ? buildInitGuidance(session.project_root)
        : null;

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
          reason: 'Review mode is forced. Run review before closing the concept-stage selection pass.'
        };
      }

      if (shouldSuggestArchReview(resolved)) {
        return {
          command: 'arch-review',
          reason: 'Concept-stage preflight signals are active. Run arch-review before narrowing the selection path.'
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
        reason: `Project definition is still open. Run scan first to converge goals, constraints, interfaces, and candidate devices from ${runtime.getProjectAssetRelativePath('req.yaml')}.`
      };
    }

    if ((session.last_command || '').trim() === 'do' && hasActiveContext) {
      return {
        command: 'verify',
        reason: 'A do step just finished. Run verify next to close the iteration with a result record.'
      };
    }

    if (preferences.review_mode === 'always') {
      return {
        command: 'review',
        reason: 'Review mode is forced. Run review before choosing the execution path.'
      };
    }

    if (shouldSuggestArchReview(resolved)) {
      return {
        command: 'arch-review',
        reason: 'Selection or solution preflight signals are active. Run arch-review before execution.'
      };
    }

    if (shouldSuggestReview(resolved)) {
      return {
        command: 'review',
        reason:
          preferences.review_mode === 'always'
            ? 'Review mode is forced. Run review before choosing the execution path.'
            : 'A review signal is active. Run review before choosing the execution path.'
      };
    }

    if (taskConvergence) {
      const prdPath = taskConvergence.prd_path || `.emb-agent/tasks/${activeTask.name}/prd.md`;
      const taskLabel = activeTask && activeTask.title ? activeTask.title : activeTask.name;
      return {
        command: taskConvergence.recommended_path === 'scan-first' ? 'scan' : 'plan',
        reason: taskConvergence.recommended_path === 'scan-first'
          ? `Active task ${taskLabel} still needs a convergence pass. Re-open ${prdPath} and run scan first before planning or mutation.`
          : `Active task ${taskLabel} already has enough context in ${prdPath}; run plan first to lock the micro-plan before execution.`,
        task_convergence: taskConvergence
      };
    }

    if (initGuidance && initGuidance.hardware_confirmation_required) {
      return {
        command: 'scan',
        reason: `Hardware identity is still missing. Run scan first to confirm the real MCU and package, then record them in ${runtime.getProjectAssetRelativePath('hw.yaml')} before execution.`
      };
    }

    if (openQuestions.length > 0 && !shouldSuggestScanTool(resolved)) {
      return {
        command: 'debug',
        reason: `Open questions remain; narrow the root cause around "${openQuestions[0]}" first`
      };
    }

    if (shouldSuggestScanTool(resolved)) {
      const primaryToolRecommendation = selectPrimaryToolRecommendation(
        (resolved.effective && resolved.effective.tool_recommendations) || [],
        resolved
      );
      const peripheralWalkthrough = shouldSuggestPeripheralWalkthrough(
        resolved,
        (resolved.effective && resolved.effective.tool_recommendations) || []
      );
      const suggestedTools = (resolved.effective && resolved.effective.suggested_tools) || [];
      const firstTool = primaryToolRecommendation || suggestedTools[0];
      return {
        command: 'scan',
        reason: peripheralWalkthrough
          ? 'Broad peripheral walkthrough detected. Run scan first, then walk every ready tool instead of stopping at the first one.'
          : firstTool
            ? `Hardware/formula/tool triage is more likely here. Run scan and evaluate ${firstTool.tool || firstTool.name} first.`
            : 'Hardware truth, register, pin, or formula triage is more likely here. Run scan before choosing a tool.'
      };
    }

    if (shouldSuggestPlan(resolved)) {
      return {
        command: 'plan',
        reason:
          preferences.plan_mode === 'always'
            ? 'Plan mode is forced. Make a micro-plan before execution.'
            : 'A complex-task signal is active. Make a micro-plan before execution.'
      };
    }

    if (!hasActiveContext) {
      return {
        command: 'scan',
        reason: 'No effective working context exists yet. Run a minimal scan first.'
      };
    }

    if (lastFiles.length === 0) {
      return {
        command: 'scan',
        reason: 'No recent-file record exists yet. Run scan first to lock onto the real change point.'
      };
    }

    return {
      command: 'do',
      reason: 'Context is already sufficient. Proceed with the minimal execution directly.'
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

    let recommendation = 'Context load is light. Keep working in the current session.';
    if (level === 'consider-clearing') {
      recommendation = handoff
        ? 'Context load is rising. If scope expands or the task changes, clear context and resume from the stored handoff.'
        : 'Context load is rising. If scope expands or the task changes, run pause, clear context, then resume.';
    } else if (level === 'suggest-clearing') {
      recommendation = handoff
        ? 'Context load is heavy. Clear context now, then resume from the stored handoff.'
        : 'Context load is heavy. Run pause now, clear context, then resume.';
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

  function collectHardwareIntentTexts(resolved) {
    const hardware = resolved && resolved.hardware ? resolved.hardware : {};
    const identity = hardware && hardware.identity ? hardware.identity : hardware;
    const signals = Array.isArray(identity && identity.signals) ? identity.signals : [];
    const peripherals = Array.isArray(identity && identity.peripherals) ? identity.peripherals : [];
    const session = resolved && resolved.session ? resolved.session : {};
    const activeTask = getActiveTask ? getActiveTask() : null;

    return runtime.unique([
      session && session.focus ? session.focus : '',
      session && session.active_task && session.active_task.title ? session.active_task.title : '',
      activeTask && activeTask.title ? activeTask.title : '',
      identity && identity.model ? identity.model : '',
      identity && identity.package ? identity.package : '',
      ...signals.flatMap(item => [
        item && item.name ? item.name : '',
        item && item.pin ? item.pin : '',
        item && item.direction ? item.direction : '',
        item && item.note ? item.note : ''
      ]),
      ...peripherals.flatMap(item => [
        item && item.name ? item.name : '',
        item && item.usage ? item.usage : ''
      ])
    ]).filter(Boolean);
  }

  function shouldSuggestPeripheralWalkthrough(resolved, toolRecommendations) {
    const items = Array.isArray(toolRecommendations) ? toolRecommendations : [];
    if (items.length < 2) {
      return false;
    }

    const readyItems = items.filter(item => item && item.status === 'ready');
    if (readyItems.length < 2) {
      return false;
    }

    const joined = collectHardwareIntentTexts(resolved).join(' ').toLowerCase();
    return /exercise all supported|all supported .*peripheral|all peripheral|all supported tools|全部外设|所有外设|全外设/.test(joined);
  }

  function buildPeripheralWalkthroughActions(resolved, toolRecommendations) {
    if (!shouldSuggestPeripheralWalkthrough(resolved, toolRecommendations)) {
      return [];
    }

    const readyItems = (Array.isArray(toolRecommendations) ? toolRecommendations : [])
      .filter(item => item && item.status === 'ready');
    if (readyItems.length === 0) {
      return [];
    }

    const checklist = readyItems
      .slice(0, 6)
      .map((item, index) => `${index + 1}. ${item.tool}`)
      .join(' | ');

    return [
      'walkthrough_scope=broad peripheral exercise; do not stop at the first matching tool',
      `ready_tool_checklist=${checklist}`,
      'walkthrough_plan=run scan first, then walk each ready tool once and record one concrete output per peripheral'
    ];
  }

  function buildWalkthroughRecommendation(resolved, toolRecommendations) {
    if (!shouldSuggestPeripheralWalkthrough(resolved, toolRecommendations)) {
      return null;
    }

    const readyItems = (Array.isArray(toolRecommendations) ? toolRecommendations : [])
      .filter(item => item && item.status === 'ready');
    if (readyItems.length === 0) {
      return null;
    }

    const orderedTools = readyItems.map(item => item.tool);
    const first = readyItems[0] || null;

    return {
      kind: 'peripheral-walkthrough',
      summary: 'Walk every ready tool once and capture one concrete output per peripheral.',
      tool_count: readyItems.length,
      ordered_tools: orderedTools,
      first_tool: first ? first.tool : '',
      first_cli: first ? first.cli_draft || '' : '',
      recommended_sequence: readyItems.slice(0, 8).map(item => ({
        tool: item.tool,
        status: item.status,
        argv: Array.isArray(item.argv) ? item.argv.slice() : [],
        cli_draft: item.cli_draft || '',
        missing_inputs: item.missing_inputs || [],
        defaults_applied: item.defaults_applied || {},
        trust: item.trust || null
      }))
    };
  }

  function buildWalkthroughRuntimeActions(session, recommendation) {
    const runtimeState =
      session &&
      session.diagnostics &&
      session.diagnostics.walkthrough_runtime &&
      typeof session.diagnostics.walkthrough_runtime === 'object' &&
      !Array.isArray(session.diagnostics.walkthrough_runtime)
        ? session.diagnostics.walkthrough_runtime
        : null;
    if (!runtimeState || !recommendation) {
      return [];
    }

    const orderedTools = Array.isArray(recommendation.ordered_tools) ? recommendation.ordered_tools : [];
    const runtimeTools = Array.isArray(runtimeState.ordered_tools) ? runtimeState.ordered_tools : [];
    const sameWalkthrough = runtimeState.kind === recommendation.kind &&
      orderedTools.length === runtimeTools.length &&
      orderedTools.every((item, index) => item === runtimeTools[index]);
    if (!sameWalkthrough) {
      return [];
    }

    const totalSteps = Number.isInteger(runtimeState.total_steps) ? runtimeState.total_steps : orderedTools.length;
    const completedCount = Number.isInteger(runtimeState.completed_count)
      ? runtimeState.completed_count
      : 0;
    const currentIndex = Number.isInteger(runtimeState.current_index) ? runtimeState.current_index : 0;
    const currentStep =
      Array.isArray(runtimeState.steps) && runtimeState.steps[currentIndex]
        ? runtimeState.steps[currentIndex]
        : null;

    if (runtimeState.status === 'completed') {
      return [
        `walkthrough_progress=${completedCount}/${totalSteps}; status=completed`,
        runtimeState.last_summary ? `walkthrough_last=${runtimeState.last_summary}` : ''
      ].filter(Boolean);
    }

    return [
      `walkthrough_progress=${completedCount}/${totalSteps}; status=${runtimeState.status || 'running'}`,
      currentStep && currentStep.status === 'needs-input' && Array.isArray(currentStep.missing_inputs) && currentStep.missing_inputs.length > 0
        ? `walkthrough_step=${currentStep.tool}; missing_inputs=${currentStep.missing_inputs.join(', ')}`
        : currentStep && currentStep.cli
          ? `walkthrough_step=${currentStep.cli}`
          : '',
      runtimeState.last_summary ? `walkthrough_last=${runtimeState.last_summary}` : ''
    ].filter(Boolean);
  }

  function buildAdapterHealthHints(healthReport, primaryToolRecommendation) {
    const adapterHealth =
      healthReport && healthReport.chip_support_health
        ? healthReport.chip_support_health
        : null;
    const primary = adapterHealth && adapterHealth.primary ? adapterHealth.primary : null;
    const preferredTrustTool =
      primaryToolRecommendation &&
      primaryToolRecommendation.trust &&
      primaryToolRecommendation.trust.executable
        ? {
            tool: primaryToolRecommendation.tool,
            grade: primaryToolRecommendation.trust.grade,
            score: primaryToolRecommendation.trust.score,
            executable: primaryToolRecommendation.trust.executable,
            recommended_action: primaryToolRecommendation.trust.recommended_action || ''
          }
        : primary;
    const reusability =
      adapterHealth && adapterHealth.reusability && typeof adapterHealth.reusability === 'object'
        ? adapterHealth.reusability
        : null;

    if (!preferredTrustTool) {
      return [];
    }

    const reuseFirst =
      reusability && reusability.status === 'reusable'
        ? 'chip_support_status=reusable across projects'
        : reusability && reusability.status === 'reusable-candidate'
          ? 'chip_support_status=reusable candidate after review'
          : 'chip_support_status=project-only for now';

    if (preferredTrustTool.executable) {
      return [
        reuseFirst,
        `chip_support_trust=${preferredTrustTool.tool}; grade=${preferredTrustTool.grade}; score=${preferredTrustTool.score}/100`
      ];
    }

    return [
      reuseFirst,
      `chip_support_trust=${preferredTrustTool.tool}; grade=${preferredTrustTool.grade}; score=${preferredTrustTool.score}/100; executable=no`,
      `chip_support_action=${preferredTrustTool.recommended_action}`,
      primaryToolRecommendation && primaryToolRecommendation.cli_draft
        ? `chip_support_calibration_cli=${primaryToolRecommendation.cli_draft}`
        : 'chip_support_calibration=use the current tool output for calibration first; do not treat it as ground truth yet'
    ];
  }

  function selectPrimaryToolRecommendation(toolRecommendations, resolved) {
    const items = Array.isArray(toolRecommendations) ? toolRecommendations.slice() : [];
    if (items.length === 0) {
      return null;
    }
    const rankedIntent = analyzeIntentSelection({
      projectConfig: resolved && resolved.project_config ? resolved.project_config : {},
      texts: collectHardwareIntentTexts(resolved),
      toolRecommendations: items
    });

    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftIntent = rankedIntent.ranked.find(entry => entry.item === left.item);
        const rightIntent = rankedIntent.ranked.find(entry => entry.item === right.item);
        return getToolRecommendationScore(left.item) - getToolRecommendationScore(right.item) ||
          ((rightIntent && rightIntent.intent_score) || 0) - ((leftIntent && leftIntent.intent_score) || 0) ||
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
      default_package: session.default_package || '',
      active_package: session.active_package || '',
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
            package: activeTask.package || '',
            path: activeTask.path
          }
        : {
            name: '',
            title: '',
            status: '',
            package: '',
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
      default_package: memorySummary.default_package || '',
      active_package: memorySummary.active_package || '',
      last_files: memorySummary.last_files || [],
      open_questions: memorySummary.open_questions || [],
      known_risks: memorySummary.known_risks || [],
      active_task: memorySummary.active_task || { name: '', title: '', status: '', package: '', path: '' },
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
    const primaryToolRecommendation = selectPrimaryToolRecommendation(toolRecommendations, resolved);
    const peripheralWalkthroughActions = buildPeripheralWalkthroughActions(resolved, toolRecommendations);
    const walkthroughRecommendation = buildWalkthroughRecommendation(resolved, toolRecommendations);
    const walkthroughRuntimeActions = buildWalkthroughRuntimeActions(session, walkthroughRecommendation);
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
    const taskConvergence =
      next && next.task_convergence && typeof next.task_convergence === 'object'
        ? next.task_convergence
        : null;
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
    const hardwareDocAnalysis = getRecentHardwareDocAnalysis(resolved);

    return {
      suggested_flow: suggestedFlow,
      next,
      task_convergence: taskConvergence,
      schematic_analysis: schematicAnalysis,
      hardware_doc_analysis: hardwareDocAnalysis,
      primary_tool_recommendation: primaryToolRecommendation,
      walkthrough_recommendation: walkthroughRecommendation,
      next_actions: runtime.unique([
        memorySummary && memorySummary.generated_at
          ? `Compact summary captured: ${memorySummary.generated_at}`
          : '',
        !memorySummary && ['consider-clearing', 'suggest-clearing'].includes(contextHygiene.level)
          ? `snapshot_command=${contextHygiene.compress_cli}`
          : '',
        memorySummary && memorySummary.next_action
          ? `summary_resume=${memorySummary.next_action}`
          : '',
        handoff && handoff.next_action ? `handoff_resume=${handoff.next_action}` : '',
        ...(handoff ? handoff.human_actions_pending.map(action => `manual_action=${action}`) : []),
        summaryTask ? `task_resume=${summaryTask.name}; title=${summaryTask.title}` : '',
        taskConvergence && taskConvergence.prd_path ? `task_prd=${taskConvergence.prd_path}` : '',
        taskConvergence && taskConvergence.summary ? `task_convergence=${taskConvergence.summary}` : '',
        taskConvergence && taskConvergence.recommended_path
          ? `task_route=${taskConvergence.recommended_path}; reason=${taskConvergence.recommended_reason || ''}`.trim()
          : '',
        taskConvergence && taskConvergence.next_cli ? `task_next=${taskConvergence.next_cli}` : '',
        taskConvergence && taskConvergence.then_cli ? `task_then=${taskConvergence.then_cli}` : '',
        taskConvergence && taskConvergence.review_hint ? `task_review=${taskConvergence.review_hint}` : '',
        ...walkthroughRuntimeActions,
        ...peripheralWalkthroughActions,
        summaryLatestForensics && summaryLatestForensics.report_file
          ? `forensics_report=${summaryLatestForensics.report_file}; severity=${summaryLatestForensics.highest_severity || 'info'}`
          : '',
        summaryLatestExecutor && summaryLatestExecutor.name
          ? `executor_status=${summaryLatestExecutor.name}; status=${summaryLatestExecutor.status || 'unknown'}${
            summaryLatestExecutor.exit_code === null ? '' : `, exit=${summaryLatestExecutor.exit_code}`
          }`
          : '',
        summaryLatestExecutor && ['failed', 'error'].includes(summaryLatestExecutor.status)
          ? `executor_review=${summaryLatestExecutor.name}${summaryLatestExecutor.stderr_preview ? ` | ${summaryLatestExecutor.stderr_preview}` : ''}`
          : '',
        qualityGates.enabled
          ? `quality_gate_status=${qualityGates.status_summary || qualityGates.gate_status}`
          : '',
        qualityGates.blocking_summary && qualityGates.blocking_summary !== qualityGates.status_summary
          ? `quality_gate_blocking=${qualityGates.blocking_summary}`
          : '',
        ...qualityGates.recommended_runs.map(item => `quality_gate_run=${item}`),
        ...qualityGates.recommended_signoffs.map(item => `quality_gate_signoff=${item}`),
        ...qualityGates.rejected_signoffs.map(item => `quality_gate_rejected=${item}`),
        schematicAnalysis && schematicAnalysis.recommended_agent
          ? `schematic_analysis=${schematicAnalysis.recommended_agent}; file=${schematicAnalysis.parsed_file}`
          : '',
        schematicAnalysis && schematicAnalysis.confirmation_targets.length > 0
          ? `schematic_confirm=${schematicAnalysis.confirmation_targets.join(', ')}`
          : '',
        schematicAnalysis && schematicAnalysis.cli_hint
          ? `schematic_handoff=${schematicAnalysis.cli_hint}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.recommended_agent
          ? `hardware_doc_analysis=${hardwareDocAnalysis.recommended_agent}; file=${hardwareDocAnalysis.markdown_file}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.confirmation_targets.length > 0
          ? `hardware_doc_confirm=${hardwareDocAnalysis.confirmation_targets.join(', ')}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.artifact_path
          ? `analysis_artifact=${hardwareDocAnalysis.artifact_path}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.init_command
          ? `analysis_init=${hardwareDocAnalysis.init_command}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.derive_command
          ? `analysis_derive=${hardwareDocAnalysis.derive_command}`
          : '',
        hardwareDocAnalysis && hardwareDocAnalysis.cli_hint
          ? `hardware_doc_handoff=${hardwareDocAnalysis.cli_hint}`
          : '',
        primaryRegisterSource ? `reread_register_summary=${primaryRegisterSource.path}` : '',
        !primaryRegisterSource && primarySource ? `reread_source_summary=${primarySource.path}` : '',
        ...suggestedTools.slice(0, 2).map(tool => `tool_candidate=${tool.name}; status=${tool.status}`),
        primaryToolRecommendation
          ? `tool_cli=${primaryToolRecommendation.cli_draft}`
          : '',
        primaryToolRecommendation && (primaryToolRecommendation.missing_inputs || []).length > 0
          ? `tool_missing_inputs=${primaryToolRecommendation.missing_inputs.join(', ')}`
          : '',
        focus ? `focus=${focus}` : '',
        summaryLastFiles[0] ? `reread_file=${summaryLastFiles[0]}` : '',
        summaryOpenQuestions[0] ? `open_question=${summaryOpenQuestions[0]}` : '',
        summaryKnownRisks[0] ? `risk=${summaryKnownRisks[0]}` : '',
        contextHygiene.level === 'consider-clearing'
          ? `context=${contextHygiene.recommendation}`
          : '',
        contextHygiene.level === 'suggest-clearing'
          ? `context=${contextHygiene.recommendation}`
          : '',
        `flow=${suggestedFlow}`,
        `command=${next.command}; reason=${next.reason}`
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

  function buildNextActionCard(nextCommand, workflowStage, nextActions, health, activeTask) {
    function isHousekeepingHint(text) {
      return /^(snapshot_command=|task_resume=|summary_resume=|handoff_resume=|context=|chip_support_status=|chip_support_trust=|reread_)/i.test(String(text || '').trim());
    }

    function scoreActionHint(text, command) {
      const value = String(text || '').trim();
      if (!value) {
        return 999;
      }

      const normalized = value.toLowerCase();
      const commandName = String(command && command.command ? command.command : '').trim().toLowerCase();
      const reason = String(command && command.reason ? command.reason : '').toLowerCase();
      const walkthroughMode = commandName === 'scan' && reason.includes('broad peripheral exercise');

      if (walkthroughMode) {
        if (normalized.startsWith('walkthrough_step=')) return 0;
        if (normalized.startsWith('walkthrough_progress=')) return 1;
        if (normalized.startsWith('walkthrough_last=')) return 2;
        if (normalized.startsWith('ready_tool_checklist=')) return 0;
        if (normalized.startsWith('walkthrough_plan=')) return 3;
        if (normalized.includes('do not stop at the first matching tool')) return 4;
      }

      if (normalized.startsWith('task_convergence=')) return 0;
      if (normalized.startsWith('task_route=')) return 1;
      if (normalized.startsWith('task_prd=')) return 2;
      if (normalized.startsWith('task_next=')) return 3;
      if (normalized.startsWith('task_then=')) return 4;
      if (normalized.startsWith('task_review=')) return 5;
      if (isHousekeepingHint(value)) return 50;
      if (normalized.startsWith('manual_action=')) return 40;
      if (normalized.startsWith('flow=')) return 60;
      if (normalized.startsWith('command=')) return 61;
      return 10;
    }

    function selectCardActionHints(items, command) {
      const ranked = (Array.isArray(items) ? items : [])
        .map((item, index) => ({
          item: String(item || '').trim(),
          index,
          score: scoreActionHint(item, command)
        }))
        .filter(entry => entry.item);

      if (ranked.length === 0) {
        return {
          first: '',
          second: ''
        };
      }

      ranked.sort((left, right) => left.score - right.score || left.index - right.index);

      return {
        first: ranked[0] ? ranked[0].item : '',
        second: ranked[1] ? ranked[1].item : ''
      };
    }

    const command = nextCommand && typeof nextCommand === 'object' ? nextCommand : {};
    const stage = workflowStage && typeof workflowStage === 'object' ? workflowStage : {};
    const quickstart = command.health_quickstart && typeof command.health_quickstart === 'object'
      ? command.health_quickstart
      : {};
    const firstQuickstartStep = Array.isArray(quickstart.steps) && quickstart.steps.length > 0
      ? quickstart.steps[0]
      : null;
    const followupCli = String(quickstart.followup || '').replace(/^Then:\s*/i, '').trim();
    const actionName = command.gated_by_health
      ? 'Close health blockers'
      : `Continue with ${command.command || 'next'}`;
    const firstLabel = command.gated_by_health
      ? (firstQuickstartStep && firstQuickstartStep.label ? firstQuickstartStep.label : 'Run health closure first')
      : `Run ${command.command || 'next'}`;
    const selectedHints = command.gated_by_health
      ? { first: '', second: '' }
      : selectCardActionHints(nextActions, command);
    const firstInstruction = command.gated_by_health
      ? (quickstart.user_summary || nextActions[0] || '')
      : (selectedHints.first || nextActions[0] || '');
    const firstCli = firstQuickstartStep && firstQuickstartStep.cli
      ? firstQuickstartStep.cli
      : (command.cli || '');
    const followup = command.gated_by_health
      ? (quickstart.followup || nextActions[1] || '')
      : (
          activeTask && activeTask.name && command.command === 'verify'
            ? `Then: ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['task', 'aar', 'scan', activeTask.name])}`
            : (selectedHints.second || nextActions[1] || '')
        );

    return {
      status: command.gated_by_health ? 'blocked-by-health' : 'ready-to-run',
      stage: stage.name || command.command || '',
      action: actionName,
      summary: command.reason || stage.why || '',
      reason: stage.why || '',
      first_step_label: firstLabel,
      first_instruction: firstInstruction,
      first_cli: firstCli,
      then_cli: followupCli || '',
      followup
    };
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
    const taskConvergence = gatedByHealth ? null : guidance.task_convergence;
    const contextHygiene = buildContextHygiene(resolved, handoff, nextCommand.command);
    const walkthroughMode = shouldSuggestPeripheralWalkthrough(
      resolved,
      (resolved.effective && resolved.effective.tool_recommendations) || []
    );
    const adapterHealthHints = buildAdapterHealthHints(health, guidance.primary_tool_recommendation);
    const nextActions = gatedByHealth
      ? runtime.unique([
          ...(health && health.quickstart
            ? [
                health.quickstart.followup
                  ? `health_closure=${health.quickstart.followup}`
                  : `health_closure=${(health.quickstart.steps || [])
                      .map(step => step.cli || step.label)
                      .filter(Boolean)
                      .join(' -> ')}`
              ]
            : []),
          ...(health && Array.isArray(health.next_commands)
            ? health.next_commands.map(item => `health_command=${item.cli}`)
            : []),
          ...(walkthroughMode ? guidance.next_actions : adapterHealthHints),
          ...(walkthroughMode ? adapterHealthHints : guidance.next_actions)
        ])
      : runtime.unique([
          ...(walkthroughMode ? guidance.next_actions : adapterHealthHints),
          ...(walkthroughMode ? adapterHealthHints : guidance.next_actions)
        ]);
    const workflowStage = buildWorkflowStage(nextCommand, resolved);
    const qualityGates = getQualityGateSummary(resolved);
    const permissionGates = permissionGateHelpers.buildPermissionGates({
      quality_gates: qualityGates
    });
    const permissionGateSummary = permissionGateHelpers.summarizePermissionGates(permissionGates);
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);
    const nextCli = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [nextCommand.command]);
    const result = enrichWithToolSuggestions({
      current: {
        project_root: resolved.session.project_root,
        profile: resolved.profile.name,
        packs: resolved.session.active_packs,
        default_package: resolved.session.default_package || '',
        active_package: resolved.session.active_package || '',
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
            package: activeTask.package || '',
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
      walkthrough_execution:
        resolved.session && resolved.session.diagnostics && resolved.session.diagnostics.walkthrough_runtime
          ? resolved.session.diagnostics.walkthrough_runtime
          : null,
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
        cli: nextCli,
        gated_by_health: gatedByHealth,
        health_next_commands: nextCommand.health_next_commands || [],
        health_quickstart: nextCommand.health_quickstart || null,
        schematic_analysis: guidance.schematic_analysis,
        hardware_doc_analysis: guidance.hardware_doc_analysis,
        recommended_flow:
          guidance.hardware_doc_analysis && guidance.hardware_doc_analysis.recommended_flow
            ? guidance.hardware_doc_analysis.recommended_flow
            : null,
        handoff_protocol:
          guidance.hardware_doc_analysis && guidance.hardware_doc_analysis.handoff_protocol
            ? guidance.hardware_doc_analysis.handoff_protocol
            : null,
        tool_recommendation: guidance.primary_tool_recommendation,
        walkthrough_recommendation: guidance.walkthrough_recommendation
      },
      task_convergence: taskConvergence,
      action_card: buildNextActionCard({
        ...nextCommand,
        cli: nextCli,
        gated_by_health: gatedByHealth
      }, workflowStage, nextActions, health, activeTask),
      workflow_stage: workflowStage,
      context_hygiene: contextHygiene,
      next_actions: nextActions,
      hardware_doc_analysis: guidance.hardware_doc_analysis,
      recommended_flow:
        guidance.hardware_doc_analysis && guidance.hardware_doc_analysis.recommended_flow
          ? guidance.hardware_doc_analysis.recommended_flow
          : null,
      handoff_protocol:
        guidance.hardware_doc_analysis && guidance.hardware_doc_analysis.handoff_protocol
          ? guidance.hardware_doc_analysis.handoff_protocol
          : null,
      walkthrough_recommendation: guidance.walkthrough_recommendation,
      walkthrough_execution:
        resolved.session && resolved.session.diagnostics && resolved.session.diagnostics.walkthrough_runtime
          ? resolved.session.diagnostics.walkthrough_runtime
          : null
    }, resolved);

    return runtimeEventHelpers.appendRuntimeEvent(result, {
      type: 'workflow-next',
      category: 'workflow',
      status:
        gatedByHealth || permissionGateSummary.status === 'pending'
          ? 'pending'
          : permissionGateSummary.status === 'blocked'
            ? 'blocked'
            : 'ok',
      severity:
        gatedByHealth || permissionGateSummary.status === 'pending'
          ? 'normal'
          : permissionGateSummary.status === 'blocked'
            ? 'high'
            : 'info',
      summary: nextCommand.reason || workflowStage.why || '',
      action: nextCommand.command || '',
      command: nextCli,
      source: 'session-flow',
      details: {
        workflow_stage: workflowStage.name || '',
        gated_by_health: gatedByHealth,
        permission_gates: permissionGateSummary.status || 'clear',
        reason: nextCommand.reason || ''
      }
    });
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
      default_package: resolved.session.default_package || '',
      active_package: resolved.session.active_package || '',
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
    const permissionGateSummary = permissionGateHelpers.summarizePermissionGates(permissionGates);
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);
    const statePaths = typeof getProjectStatePaths === 'function' ? getProjectStatePaths() : null;
    const sessionState = statePaths
      ? runtime.buildSessionStateView(statePaths, {
          projectRoot: resolved.session.project_root
        })
      : null;
    const result = enrichWithToolSuggestions({
      session_version: resolved.session.session_version,
      runtime_host: runtimeHost.name || '',
      project_root: resolved.session.project_root,
      project_name: resolved.session.project_name,
      project_profile: resolved.session.project_profile,
      active_packs: resolved.session.active_packs,
      packages: resolved.session.packages || [],
      default_package: resolved.session.default_package || '',
      active_package: resolved.session.active_package || '',
      developer: resolved.session.developer || { name: '', runtime: '' },
      focus: resolved.session.focus || '',
      preferences: getPreferences(resolved.session),
      project_defaults: projectConfig,
      intent_router: normalizeIntentRouterConfig(projectConfig),
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
      walkthrough_execution:
        resolved.session && resolved.session.diagnostics && resolved.session.diagnostics.walkthrough_runtime
          ? resolved.session.diagnostics.walkthrough_runtime
          : null,
      memory_summary: buildMemorySummaryView(memorySummary),
      session_state: sessionState,
      quality_gates: qualityGates,
      permission_gates: permissionGates,
      injected_specs: injectedSpecs,
      active_task: activeTask
          ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            type: activeTask.type,
            package: activeTask.package || '',
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

    return runtimeEventHelpers.appendRuntimeEvent(result, {
      type: 'workflow-status',
      category: 'workflow',
      status:
        permissionGateSummary.status === 'blocked'
          ? 'blocked'
          : permissionGateSummary.status === 'pending'
            ? 'pending'
            : 'ok',
      severity:
        permissionGateSummary.status === 'blocked'
          ? 'high'
          : permissionGateSummary.status === 'pending'
            ? 'normal'
            : 'info',
      summary: activeTask
        ? `Reported session status with active task ${activeTask.name}.`
        : 'Reported session status.',
      action: 'status',
      source: 'session-flow',
      details: {
        project_root: resolved.session.project_root,
        active_task: activeTask ? activeTask.name : '',
        permission_gates: permissionGateSummary.status || 'clear'
      }
    });
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
    buildWorkflowStage,
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
