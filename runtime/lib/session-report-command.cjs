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
    updateSession
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

  function buildTimestampSlug(date) {
    return String(date || new Date())
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
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
    const adapterHealth =
      next &&
      next.health &&
      next.health.adapter_health
        ? next.health.adapter_health
        : null;
    const latestExecutor = getLatestExecutor(resolved.session);
    const latestForensics = getLatestForensics(resolved.session);
    const delegationRuntime = getDelegationRuntime(resolved.session);
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
      adapter_health: adapterHealth,
      next,
      resume
    };
  }

  function buildSessionReportMarkdown(report) {
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
      `- adapter_health: ${report.adapter_health && report.adapter_health.primary
        ? `${report.adapter_health.primary.tool} ${report.adapter_health.primary.grade} (${report.adapter_health.primary.score}/100), executable=${report.adapter_health.primary.executable ? 'yes' : 'no'}, action=${report.adapter_health.primary.recommended_action}`
        : '(none)'}`
    );
    lines.push(`- suggested_flow: ${report.next.current.suggested_flow || ''}`);
    lines.push(`- context_hygiene: ${report.next.context_hygiene.level}`);
    lines.push('');
    lines.push('### Next Actions');
    (report.resume.next_actions || []).forEach(item => lines.push(`- ${item}`));
    lines.push('');

    return lines.join('\n');
  }

  function runSessionReport(summaryText, options) {
    const explicitConfirmation =
      options && typeof options === 'object' && !Array.isArray(options)
        ? options.explicit_confirmation === true
        : false;
    const blocked = applySessionReportPermission({
      generated: false,
      report_file: '',
      summary: summaryText || '',
      handoff_present: false
    }, explicitConfirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    ensureSessionReportsDir();
    const report = buildSessionReport(summaryText);
    const fileName = `report-${buildTimestampSlug(report.generated_at)}.md`;
    const filePath = path.join(getSessionReportsDir(), fileName);

    fs.writeFileSync(filePath, buildSessionReportMarkdown(report), 'utf8');

    updateSession(current => {
      current.last_command = 'session-report';
    });

    return permissionGateHelpers.applyPermissionDecision({
      generated: true,
      report_file: path.relative(process.cwd(), filePath),
      summary: report.summary,
      next: report.next.next,
      diagnostics: report.diagnostics,
      delegation_runtime: report.diagnostics.delegation_runtime,
      executor_signal: report.executor_signal,
      tool_recommendation: report.tool_recommendation,
      adapter_health: report.adapter_health,
      handoff_present: Boolean(report.handoff)
    }, blocked.permission);
  }

  function handleSessionReportCommands(cmd, subcmd, rest) {
    if (cmd !== 'session-report') {
      return undefined;
    }

    const parsed = stripPermissionControlTokens([subcmd, ...rest].filter(Boolean));
    const summaryText = parsed.tokens.join(' ').trim();
    return runSessionReport(summaryText, {
      explicit_confirmation: parsed.explicit_confirmation
    });
  }

  return {
    getSessionReportsDir,
    runSessionReport,
    handleSessionReportCommands
  };
}

module.exports = {
  createSessionReportCommandHelpers
};
