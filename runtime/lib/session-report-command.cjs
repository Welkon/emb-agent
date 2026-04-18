'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');

function createSessionReportCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    resolveSession,
    loadHandoff,
    buildNextContext,
    buildResumeContext,
    getProjectExtDir,
    getProjectStatePaths,
    updateSession,
    maybeAutoExtractOnSessionReport
  } = deps;

  function stripPermissionControlTokens(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    const filtered = [];
    let explicitConfirmation = false;

    for (const token of list) {
      if (token === '--confirm') {
        explicitConfirmation = true;
        continue;
      }
      filtered.push(token);
    }

    return {
      tokens: filtered,
      explicit_confirmation: explicitConfirmation
    };
  }

  function applySessionReportPermission(result, explicitConfirmation) {
    const permission = permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: 'session-report-save',
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions:
        (resolveSession() &&
          resolveSession().project_config &&
          resolveSession().project_config.permissions) || {}
    });

    return {
      permission,
      result: permissionGateHelpers.applyPermissionDecision(result, permission)
    };
  }

  function getSessionReportsDir() {
    return path.join(getProjectExtDir(), 'reports', 'sessions');
  }

  function ensureSessionReportsDir() {
    runtime.ensureDir(getSessionReportsDir());
  }

  function buildSessionStatePayload() {
    const statePaths = typeof getProjectStatePaths === 'function' ? getProjectStatePaths() : null;
    const resolved = resolveSession();
    return statePaths
      ? runtime.buildSessionStateView(statePaths, {
          projectRoot: resolved && resolved.session ? resolved.session.project_root : process.cwd()
        })
      : null;
  }

  function buildTimestampSlug(date) {
    return String(date || new Date())
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
  }

  function buildReportBaseName(generatedAt) {
    return `report-${buildTimestampSlug(generatedAt)}`;
  }

  function getLatestExecutor(session) {
    return session &&
      session.diagnostics &&
      session.diagnostics.latest_executor &&
      session.diagnostics.latest_executor.name
      ? session.diagnostics.latest_executor
      : null;
  }

  function getLatestForensics(session) {
    return session &&
      session.diagnostics &&
      session.diagnostics.latest_forensics &&
      session.diagnostics.latest_forensics.report_file
      ? session.diagnostics.latest_forensics
      : null;
  }

  function getDelegationRuntime(session) {
    return session &&
      session.diagnostics &&
      session.diagnostics.delegation_runtime &&
      typeof session.diagnostics.delegation_runtime === 'object' &&
      !Array.isArray(session.diagnostics.delegation_runtime)
      ? session.diagnostics.delegation_runtime
      : null;
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

  function formatChipSupportHealthSummary(chipSupportHealth) {
    if (!chipSupportHealth || typeof chipSupportHealth !== 'object') {
      return '(none)';
    }

    const primary =
      chipSupportHealth.primary && typeof chipSupportHealth.primary === 'object'
        ? chipSupportHealth.primary
        : null;
    const reusability =
      chipSupportHealth.reusability && typeof chipSupportHealth.reusability === 'object'
        ? chipSupportHealth.reusability
        : null;

    if (!primary) {
      return '(none)';
    }

    const reuseLabel =
      reusability && reusability.status
        ? `reuse=${reusability.status}`
        : 'reuse=unknown';

    return `${reuseLabel}, tool=${primary.tool}, trust=${primary.grade} (${primary.score}/100), executable=${primary.executable ? 'yes' : 'no'}, action=${primary.recommended_action}`;
  }

  function buildSessionReport(summaryText) {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const next = buildNextContext();
    const resume = buildResumeContext();
    const toolRecommendation =
      next &&
      next.next &&
      next.next.tool_recommendation
        ? next.next.tool_recommendation
        : null;
    const walkthroughRecommendation =
      next &&
      next.next &&
      next.next.walkthrough_recommendation
        ? next.next.walkthrough_recommendation
        : null;
    const chipSupportHealth =
      next &&
      next.health &&
      next.health.chip_support_health
        ? next.health.chip_support_health
        : null;
    const latestExecutor = getLatestExecutor(resolved.session);
    const latestForensics = getLatestForensics(resolved.session);
    const delegationRuntime = getDelegationRuntime(resolved.session);
    const walkthroughExecution =
      resolved &&
      resolved.session &&
      resolved.session.diagnostics &&
      resolved.session.diagnostics.walkthrough_runtime
        ? resolved.session.diagnostics.walkthrough_runtime
        : null;
    const executorSignal = buildExecutorSignal(latestExecutor);

    return {
      generated_at: new Date().toISOString(),
      summary: summaryText || '',
      project_root: resolved.session.project_root,
      profile: resolved.session.project_profile,
      packs: resolved.session.active_packs || [],
      preferences: resolved.session.preferences || {},
      focus: resolved.session.focus || '',
      last_command: resolved.session.last_command || '',
      last_files: resolved.session.last_files || [],
      open_questions: resolved.session.open_questions || [],
      known_risks: resolved.session.known_risks || [],
      handoff: handoff
        ? {
            timestamp: handoff.timestamp,
            next_action: handoff.next_action,
            context_notes: handoff.context_notes
          }
        : null,
      diagnostics: {
        latest_forensics: latestForensics,
        latest_executor: latestExecutor,
        delegation_runtime: delegationRuntime
      },
      executor_signal: executorSignal,
      tool_recommendation: toolRecommendation,
      walkthrough_recommendation: walkthroughRecommendation,
      walkthrough_execution: walkthroughExecution,
      chip_support_health: chipSupportHealth,
      next,
      resume
    };
  }

  function buildSessionReportMarkdown(report) {
    const walkthroughSteps =
      report.walkthrough_execution && Array.isArray(report.walkthrough_execution.steps)
        ? report.walkthrough_execution.steps
        : [];
    const walkthroughIndex =
      report.walkthrough_execution && Number.isInteger(report.walkthrough_execution.current_index)
        ? report.walkthrough_execution.current_index
        : 0;
    const walkthroughCurrentStep = walkthroughSteps[walkthroughIndex] || null;
    const lines = [
      '# Emb-Agent Session Report',
      '',
      `- Generated: ${report.generated_at}`,
      `- Project: ${report.project_root}`,
      `- Summary: ${report.summary || '(not provided)'}`,
      '',
      '## Current Session',
      '',
      `- profile: ${report.profile}`,
      `- packs: ${report.packs.join(', ') || '(none)'}`,
      `- focus: ${report.focus || '(empty)'}`,
      `- last_command: ${report.last_command || '(empty)'}`,
      `- last_files: ${report.last_files.join(', ') || '(none)'}`,
      `- open_questions: ${report.open_questions.join(' | ') || '(none)'}`,
      `- known_risks: ${report.known_risks.join(' | ') || '(none)'}`,
      '',
      '## Preferences',
      '',
      `- truth_source_mode: ${report.preferences.truth_source_mode || ''}`,
      `- plan_mode: ${report.preferences.plan_mode || ''}`,
      `- review_mode: ${report.preferences.review_mode || ''}`,
      `- verification_mode: ${report.preferences.verification_mode || ''}`,
      '',
      '## Handoff',
      '',
      `- present: ${report.handoff ? 'yes' : 'no'}`
    ];

    if (report.handoff) {
      lines.push(`- timestamp: ${report.handoff.timestamp || ''}`);
      lines.push(`- next_action: ${report.handoff.next_action || ''}`);
      lines.push(`- context_notes: ${report.handoff.context_notes || ''}`);
    }

    lines.push('');
    lines.push('## Diagnostics');
    lines.push('');
    lines.push(`- latest_forensics: ${report.diagnostics.latest_forensics
      ? `${report.diagnostics.latest_forensics.report_file} (${report.diagnostics.latest_forensics.highest_severity || 'info'})`
      : '(none)'}`);
    lines.push(`- latest_executor: ${report.diagnostics.latest_executor
      ? `${report.diagnostics.latest_executor.name} ${report.diagnostics.latest_executor.status}, exit=${report.diagnostics.latest_executor.exit_code === null ? '-' : report.diagnostics.latest_executor.exit_code}, risk=${report.diagnostics.latest_executor.risk || '-'}`
      : '(none)'}`);
    if (report.diagnostics.latest_executor) {
      lines.push(`- latest_executor_cwd: ${report.diagnostics.latest_executor.cwd || '(empty)'}`);
      lines.push(`- latest_executor_argv: ${(report.diagnostics.latest_executor.argv || []).join(' ') || '(none)'}`);
      lines.push(
        `- latest_executor_evidence_hint: ${(report.diagnostics.latest_executor.evidence_hint || []).join(', ') || '(none)'}`
      );
      lines.push(`- latest_executor_stdout_preview: ${report.diagnostics.latest_executor.stdout_preview || '(empty)'}`);
      lines.push(`- latest_executor_stderr_preview: ${report.diagnostics.latest_executor.stderr_preview || '(empty)'}`);
    }
    lines.push(`- delegation_pattern: ${report.diagnostics.delegation_runtime
      ? report.diagnostics.delegation_runtime.pattern || '(none)'
      : '(none)'}`);
    if (report.diagnostics.delegation_runtime) {
      lines.push(`- delegation_strategy: ${report.diagnostics.delegation_runtime.strategy || '(empty)'}`);
      lines.push(
        `- delegation_action: ${(report.diagnostics.delegation_runtime.requested_action || '(empty)')} -> ${(report.diagnostics.delegation_runtime.resolved_action || '(empty)')}`
      );
      lines.push(
        `- delegation_phases: ${(report.diagnostics.delegation_runtime.phases || []).map(item => item.id).join(' -> ') || '(none)'}`
      );
      lines.push(
        `- delegation_launches: ${(report.diagnostics.delegation_runtime.launch_requests || [])
          .map(item => `${item.agent || '(agent)'}:${item.phase || 'phase'}:${item.continue_vs_spawn || 'decision'}`)
          .join(' | ') || '(none)'}`
      );
      lines.push(
        `- delegation_jobs: ${(report.diagnostics.delegation_runtime.jobs || [])
          .map(item => `${item.agent || '(agent)'}:${item.phase || 'phase'}:${item.status || 'status'}`)
          .join(' | ') || '(none)'}`
      );
      lines.push(
        `- delegation_synthesis: ${report.diagnostics.delegation_runtime.synthesis
          ? `${report.diagnostics.delegation_runtime.synthesis.status || '-'}, owner=${report.diagnostics.delegation_runtime.synthesis.owner || '-'}`
          : '(none)'}`
      );
      lines.push(
        `- delegation_worker_results: ${(report.diagnostics.delegation_runtime.worker_results || [])
          .map(item => `${item.agent || '(agent)'}:${item.phase || 'phase'}:${item.status || 'status'}`)
          .join(' | ') || '(none)'}`
      );
      lines.push(
        `- delegation_integration: ${report.diagnostics.delegation_runtime.integration
          ? `${report.diagnostics.delegation_runtime.integration.status || '-'}, owner=${report.diagnostics.delegation_runtime.integration.owner || '-'}, kind=${report.diagnostics.delegation_runtime.integration.execution_kind || '-'}`
          : '(none)'}`
      );
      lines.push(
        `- delegation_review: ${report.diagnostics.delegation_runtime.review
          ? `stage_a=${report.diagnostics.delegation_runtime.review.stage_a ? report.diagnostics.delegation_runtime.review.stage_a.status || '-' : '-'}, stage_b=${report.diagnostics.delegation_runtime.review.stage_b ? report.diagnostics.delegation_runtime.review.stage_b.status || '-' : '-'}, redispatch=${report.diagnostics.delegation_runtime.review.redispatch_required === true ? 'yes' : 'no'}`
          : '(none)'}`
      );
      lines.push(`- delegation_updated_at: ${report.diagnostics.delegation_runtime.updated_at || '(empty)'}`);
    }
    lines.push('');
    lines.push('## Guidance');
    lines.push('');
    lines.push(`- next_command: ${report.next.next.command}`);
    lines.push(`- next_reason: ${report.next.next.reason}`);
    lines.push(`- tool_recommendation: ${report.tool_recommendation ? report.tool_recommendation.tool : '(none)'}`);
    lines.push(`- tool_status: ${report.tool_recommendation ? report.tool_recommendation.status : '(none)'}`);
    lines.push(
      `- tool_trust: ${report.tool_recommendation && report.tool_recommendation.trust
        ? `${report.tool_recommendation.trust.grade} (${report.tool_recommendation.trust.score}/100), executable=${report.tool_recommendation.trust.executable ? 'yes' : 'no'}`
        : '(none)'}`
    );
    lines.push(`- tool_cli: ${report.tool_recommendation ? report.tool_recommendation.cli_draft : '(none)'}`);
    lines.push(
      `- tool_missing_inputs: ${report.tool_recommendation && (report.tool_recommendation.missing_inputs || []).length > 0
        ? report.tool_recommendation.missing_inputs.join(', ')
        : '(none)'}`
    );
    lines.push(
      `- walkthrough_mode: ${report.walkthrough_recommendation ? report.walkthrough_recommendation.kind : '(none)'}`
    );
    lines.push(
      `- walkthrough_tools: ${report.walkthrough_recommendation && (report.walkthrough_recommendation.ordered_tools || []).length > 0
        ? report.walkthrough_recommendation.ordered_tools.join(' -> ')
        : '(none)'}`
    );
    lines.push(
      `- walkthrough_status: ${report.walkthrough_execution ? report.walkthrough_execution.status || '(empty)' : '(none)'}`
    );
    lines.push(
      `- walkthrough_progress: ${report.walkthrough_execution
        ? `${report.walkthrough_execution.completed_count || 0}/${report.walkthrough_execution.total_steps || 0}`
        : '(none)'}`
    );
    lines.push(
      `- walkthrough_current: ${report.walkthrough_execution
        ? report.walkthrough_execution.current_tool || (walkthroughCurrentStep && walkthroughCurrentStep.tool) || '(none)'
        : '(none)'}`
    );
    lines.push(
      `- walkthrough_last: ${report.walkthrough_execution
        ? report.walkthrough_execution.last_summary || '(empty)'
        : '(none)'}`
    );
    lines.push(
      `- chip_support_health: ${formatChipSupportHealthSummary(report.chip_support_health)}`
    );
    lines.push(`- suggested_flow: ${report.next.current.suggested_flow || ''}`);
    lines.push(`- context_hygiene: ${report.next.context_hygiene.level}`);
    lines.push('');
    lines.push('### Next Actions');
    (report.resume.next_actions || []).forEach(item => lines.push(`- ${item}`));
    lines.push('');

    return lines.join('\n');
  }

  function buildStoredReportSummary(report, markdownRelativePath, jsonRelativePath) {
    return {
      id: buildReportBaseName(report.generated_at),
      generated_at: report.generated_at,
      summary: report.summary || '',
      project_root: report.project_root,
      profile: report.profile || '',
      packs: Array.isArray(report.packs) ? report.packs : [],
      focus: report.focus || '',
      last_command: report.last_command || '',
      next_command: report.next && report.next.next ? report.next.next.command || '' : '',
      next_reason: report.next && report.next.next ? report.next.next.reason || '' : '',
      handoff_present: Boolean(report.handoff),
      executor_signal: report.executor_signal || null,
      chip_support_health: report.chip_support_health || null,
      markdown_file: markdownRelativePath,
      json_file: jsonRelativePath
    };
  }

  function writeSessionReportArtifacts(report) {
    ensureSessionReportsDir();
    const baseName = buildReportBaseName(report.generated_at);
    const markdownPath = path.join(getSessionReportsDir(), `${baseName}.md`);
    const jsonPath = path.join(getSessionReportsDir(), `${baseName}.json`);
    const markdownRelativePath = path.relative(process.cwd(), markdownPath);
    const jsonRelativePath = path.relative(process.cwd(), jsonPath);
    const stored = buildStoredReportSummary(report, markdownRelativePath, jsonRelativePath);

    fs.writeFileSync(markdownPath, buildSessionReportMarkdown(report), 'utf8');
    runtime.writeJson(jsonPath, {
      ...stored,
      report
    });

    return {
      base_name: baseName,
      markdown_path: markdownPath,
      json_path: jsonPath,
      markdown_relative_path: markdownRelativePath,
      json_relative_path: jsonRelativePath,
      stored
    };
  }

  function listStoredSessionReports() {
    if (!fs.existsSync(getSessionReportsDir())) {
      return {
        reports: []
      };
    }

    const reports = fs.readdirSync(getSessionReportsDir())
      .filter(name => name.endsWith('.json'))
      .map(name => {
        const fullPath = path.join(getSessionReportsDir(), name);
        const raw = runtime.readJson(fullPath);
        if (!raw || typeof raw !== 'object') {
          return null;
        }
        return {
          id: String(raw.id || path.basename(name, '.json')),
          generated_at: String(raw.generated_at || ''),
          summary: String(raw.summary || ''),
          project_root: String(raw.project_root || ''),
          profile: String(raw.profile || ''),
          packs: Array.isArray(raw.packs) ? raw.packs : [],
          focus: String(raw.focus || ''),
          last_command: String(raw.last_command || ''),
          next_command: String(raw.next_command || ''),
          next_reason: String(raw.next_reason || ''),
          handoff_present: raw.handoff_present === true,
          executor_signal: raw.executor_signal || null,
          chip_support_health: raw.chip_support_health || null,
          markdown_file: String(raw.markdown_file || path.relative(process.cwd(), path.join(getSessionReportsDir(), `${path.basename(name, '.json')}.md`))),
          json_file: String(raw.json_file || path.relative(process.cwd(), fullPath))
        };
      })
      .filter(Boolean)
      .sort((left, right) => String(right.generated_at || '').localeCompare(String(left.generated_at || '')));

    return {
      reports
    };
  }

  function resolveStoredSessionReport(target) {
    const history = listStoredSessionReports();
    const normalized = String(target || '').trim();

    if (!normalized || normalized === 'latest') {
      return history.reports[0] || null;
    }

    return history.reports.find(item =>
      item.id === normalized ||
      item.json_file === normalized ||
      item.markdown_file === normalized ||
      path.basename(item.json_file || '') === normalized ||
      path.basename(item.markdown_file || '') === normalized
    ) || null;
  }

  function showStoredSessionReport(target) {
    const resolved = resolveStoredSessionReport(target);
    if (!resolved) {
      throw new Error(`Session report not found: ${target}`);
    }

    const jsonPath = path.isAbsolute(resolved.json_file)
      ? resolved.json_file
      : path.resolve(process.cwd(), resolved.json_file);
    const raw = runtime.readJson(jsonPath) || {};

    return {
      entry: resolved,
      report: raw.report || null
    };
  }

  function buildCurrentSessionView() {
    const resolved = resolveSession();
    const session = resolved && resolved.session ? resolved.session : {};
    return {
      ...session,
      session_state: buildSessionStatePayload(),
      handoff: loadHandoff() || null,
      reports: listStoredSessionReports()
    };
  }

  function runSessionReport(summaryText, options) {
    const explicitConfirmation =
      options && typeof options === 'object' && !Array.isArray(options)
        ? options.explicit_confirmation === true
        : false;
    const commandName =
      options && typeof options === 'object' && !Array.isArray(options)
        ? String(options.command_name || 'session-report')
        : 'session-report';
    const blocked = applySessionReportPermission({
      generated: false,
      report_file: '',
      summary: summaryText || '',
      handoff_present: false,
      session_state: buildSessionStatePayload()
    }, explicitConfirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const report = buildSessionReport(summaryText);
    const artifacts = writeSessionReportArtifacts(report);
    const autoMemory = typeof maybeAutoExtractOnSessionReport === 'function'
      ? maybeAutoExtractOnSessionReport(summaryText || '')
      : null;

    updateSession(current => {
      current.last_command = commandName;
    });

    return permissionGateHelpers.applyPermissionDecision({
      generated: true,
      report_file: artifacts.markdown_relative_path,
      report_json_file: artifacts.json_relative_path,
      summary: report.summary,
      session_state: buildSessionStatePayload(),
      next: report.next.next,
      diagnostics: report.diagnostics,
      delegation_runtime: report.diagnostics.delegation_runtime,
      executor_signal: report.executor_signal,
      tool_recommendation: report.tool_recommendation,
      walkthrough_recommendation: report.walkthrough_recommendation,
      walkthrough_execution: report.walkthrough_execution,
      chip_support_health: report.chip_support_health,
      handoff_present: Boolean(report.handoff),
      auto_memory: autoMemory
    }, blocked.permission);
  }

  function handleSessionReportCommands(cmd, subcmd, rest) {
    if (cmd !== 'session-report' && cmd !== 'session') {
      return undefined;
    }

    if (cmd === 'session') {
      if (!subcmd || subcmd === 'show') {
        const target = String(rest[0] || '').trim();
        if (!target || target === 'current') {
          return buildCurrentSessionView();
        }
        return showStoredSessionReport(target);
      }

      if (subcmd === 'history' || subcmd === 'list') {
        return listStoredSessionReports();
      }

      if (subcmd === 'record') {
        const parsed = stripPermissionControlTokens(rest);
        const summaryText = parsed.tokens.join(' ').trim();
        return runSessionReport(summaryText, {
          explicit_confirmation: parsed.explicit_confirmation,
          command_name: 'session record'
        });
      }
    }

    const parsed = stripPermissionControlTokens([subcmd, ...rest].filter(Boolean));
    const summaryText = parsed.tokens.join(' ').trim();
    return runSessionReport(summaryText, {
      explicit_confirmation: parsed.explicit_confirmation,
      command_name: 'session-report'
    });
  }

  return {
    getSessionReportsDir,
    listStoredSessionReports,
    showStoredSessionReport,
    buildCurrentSessionView,
    runSessionReport,
    handleSessionReportCommands
  };
}

module.exports = {
  createSessionReportCommandHelpers
};
