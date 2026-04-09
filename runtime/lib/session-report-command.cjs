'use strict';

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

  function countThreadStats() {
    const threadsDir = path.join(getProjectExtDir(), 'threads');
    if (!fs.existsSync(threadsDir)) {
      return { total: 0, open: 0, resolved: 0 };
    }

    const stats = { total: 0, open: 0, resolved: 0 };
    for (const file of fs.readdirSync(threadsDir).filter(name => name.endsWith('.md'))) {
      stats.total += 1;
      const content = runtime.readText(path.join(threadsDir, file));
      if (/## Status\s+RESOLVED/m.test(content)) {
        stats.resolved += 1;
      } else {
        stats.open += 1;
      }
    }

    return stats;
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
      recommended_action: failed ? 'forensics' : '',
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
    const threadStats = countThreadStats();
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
      workspace: resume.workspace || next.workspace || null,
      handoff: handoff
        ? {
            timestamp: handoff.timestamp,
            next_action: handoff.next_action,
            context_notes: handoff.context_notes
          }
        : null,
      diagnostics: {
        latest_forensics: latestForensics,
        latest_executor: latestExecutor
      },
      executor_signal: executorSignal,
      thread_stats: threadStats,
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
      `- active_workspace: ${report.workspace ? `${report.workspace.name} (${report.workspace.title})` : '(none)'}`,
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
    lines.push('## Threads');
    lines.push('');
    lines.push(`- total: ${report.thread_stats.total}`);
    lines.push(`- open: ${report.thread_stats.open}`);
    lines.push(`- resolved: ${report.thread_stats.resolved}`);
    lines.push('');
    lines.push('## Workspace');
    lines.push('');
    lines.push(`- present: ${report.workspace ? 'yes' : 'no'}`);
    if (report.workspace) {
      lines.push(`- name: ${report.workspace.name || ''}`);
      lines.push(`- title: ${report.workspace.title || ''}`);
      lines.push(`- type: ${report.workspace.type || ''}`);
      lines.push(`- status: ${report.workspace.status || ''}`);
      lines.push(`- notes_path: ${report.workspace.notes_path || report.workspace.path || ''}`);
      lines.push(`- refreshed_at: ${(report.workspace.snapshot && report.workspace.snapshot.refreshed_at) || ''}`);
      lines.push(
        `- link_counts: tasks=${((report.workspace.link_counts || {}).tasks || 0)}, specs=${((report.workspace.link_counts || {}).specs || 0)}, threads=${((report.workspace.link_counts || {}).threads || 0)}`
      );
      lines.push(
        `- snapshot_counts: files=${((report.workspace.snapshot && report.workspace.snapshot.last_files) || []).length}, questions=${((report.workspace.snapshot && report.workspace.snapshot.open_questions) || []).length}, risks=${((report.workspace.snapshot && report.workspace.snapshot.known_risks) || []).length}`
      );
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

  function runSessionReport(summaryText) {
    ensureSessionReportsDir();
    const report = buildSessionReport(summaryText);
    const fileName = `report-${buildTimestampSlug(report.generated_at)}.md`;
    const filePath = path.join(getSessionReportsDir(), fileName);

    fs.writeFileSync(filePath, buildSessionReportMarkdown(report), 'utf8');

    updateSession(current => {
      current.last_command = 'session-report';
    });

    return {
      generated: true,
      report_file: path.relative(process.cwd(), filePath),
      summary: report.summary,
      next: report.next.next,
      diagnostics: report.diagnostics,
      executor_signal: report.executor_signal,
      tool_recommendation: report.tool_recommendation,
      adapter_health: report.adapter_health,
      thread_stats: report.thread_stats,
      handoff_present: Boolean(report.handoff)
    };
  }

  function handleSessionReportCommands(cmd, subcmd, rest) {
    if (cmd !== 'session-report') {
      return undefined;
    }

    const summaryText = [subcmd, ...rest].filter(Boolean).join(' ').trim();
    return runSessionReport(summaryText);
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
