'use strict';

function createForensicsCommandHelpers(deps) {
  const {
    fs,
    path,
    childProcess,
    runtime,
    resolveProjectRoot,
    getProjectExtDir,
    loadSession,
    loadHandoff,
    resolveSession,
    buildContextHygiene,
    upsertForensicsThread,
    updateSession
  } = deps;

  function getForensicsDir() {
    return path.join(getProjectExtDir(), 'reports', 'forensics');
  }

  function ensureForensicsDir() {
    runtime.ensureDir(getForensicsDir());
  }

  function buildTimestampSlug(date) {
    return String(date || new Date())
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
  }

  function probeGitStatus(projectRoot) {
    try {
      const result = childProcess.spawnSync('git', ['status', '--short'], {
        cwd: projectRoot,
        encoding: 'utf8'
      });

      if (result.status !== 0) {
        return {
          available: false,
          dirty: false,
          lines: []
        };
      }

      const lines = String(result.stdout || '')
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 12);

      return {
        available: true,
        dirty: lines.length > 0,
        lines
      };
    } catch {
      return {
        available: false,
        dirty: false,
        lines: []
      };
    }
  }

  function countOpenThreads() {
    const threadsDir = path.join(getProjectExtDir(), 'threads');
    if (!fs.existsSync(threadsDir)) {
      return { total: 0, open: 0, resolved: 0 };
    }

    const stats = {
      total: 0,
      open: 0,
      resolved: 0
    };

    for (const name of fs.readdirSync(threadsDir).filter(item => item.endsWith('.md'))) {
      stats.total += 1;
      const content = runtime.readText(path.join(threadsDir, name));

      if (/## Status\s+RESOLVED/m.test(content)) {
        stats.resolved += 1;
      } else {
        stats.open += 1;
      }
    }

    return stats;
  }

  function buildFindings(problemText) {
    const projectRoot = resolveProjectRoot();
    const session = loadSession();
    const handoff = loadHandoff();
    const resolved = resolveSession();
    const contextHygiene = buildContextHygiene(
      resolved,
      handoff,
      session.last_command || ''
    );
    const git = probeGitStatus(projectRoot);
    const threadStats = countOpenThreads();
    const latestExecutor =
      session &&
      session.diagnostics &&
      session.diagnostics.latest_executor &&
      session.diagnostics.latest_executor.name
        ? session.diagnostics.latest_executor
        : null;
    const findings = [];

    if (handoff) {
      findings.push({
        key: 'unconsumed_handoff',
        severity: 'high',
        title: 'Unconsumed handoff exists',
        evidence: [
          `handoff.next_action = ${handoff.next_action || '(empty)'}`,
          `handoff.focus = ${handoff.focus || '(empty)'}`,
          `resume_cli = ${contextHygiene.resume_cli}`
        ],
        recommendation: 'Run resume first to restore the working state before expanding the problem space further.'
      });
    }

    if ((session.open_questions || []).length > 0) {
      findings.push({
        key: 'open_questions',
        severity: 'medium',
        title: 'Open questions are still accumulating',
        evidence: (session.open_questions || []).slice(0, 4).map(item => `question: ${item}`),
        recommendation: 'Converge on the earliest open question first, or both planning and execution will drift.'
      });
    }

    if ((session.known_risks || []).length > 0) {
      findings.push({
        key: 'known_risks',
        severity: 'medium',
        title: 'Known risks are still open',
        evidence: (session.known_risks || []).slice(0, 4).map(item => `risk: ${item}`),
        recommendation: 'Decide first whether these risks should become threads, enter review, or go straight to bench verification.'
      });
    }

    if ((session.last_files || []).length === 0 && (session.last_command || '').trim() !== '') {
      findings.push({
        key: 'lost_file_context',
        severity: 'medium',
        title: 'There are recent actions, but recent files are missing',
        evidence: [`last_command = ${session.last_command}`],
        recommendation: 'Add a scan or last-files add first so later reasoning stays anchored to the real code entry point.'
      });
    }

    if (latestExecutor && ['failed', 'error'].includes(latestExecutor.status)) {
      findings.push({
        key: 'latest_executor_failed',
        severity: latestExecutor.status === 'error' ? 'high' : 'medium',
        title: 'The latest executor run failed',
        evidence: [
          `executor = ${latestExecutor.name}`,
          `status = ${latestExecutor.status}`,
          latestExecutor.exit_code === null ? '' : `exit_code = ${latestExecutor.exit_code}`,
          latestExecutor.cwd ? `cwd = ${latestExecutor.cwd}` : '',
          latestExecutor.stderr_preview ? `stderr = ${latestExecutor.stderr_preview}` : '',
          ...((latestExecutor.evidence_hint || []).slice(0, 3).map(item => `evidence_hint = ${item}`))
        ].filter(Boolean),
        recommendation: 'Add evidence around the latest failed executor first, then decide whether to fix the script, fill inputs, or enter deeper forensics.'
      });
    }

    const requiredArtifacts = [
      runtime.getProjectAssetRelativePath('hw.yaml'),
      runtime.getProjectAssetRelativePath('req.yaml'),
      'docs'
    ];
    const missingArtifacts = requiredArtifacts.filter(item =>
      !fs.existsSync(path.join(projectRoot, item))
    );
    if (missingArtifacts.length > 0) {
      findings.push({
        key: 'missing_truth_artifacts',
        severity: 'high',
        title: 'Minimal truth artifacts are missing',
        evidence: missingArtifacts.map(item => `missing: ${item}`),
        recommendation: 'Fill in the hardware/requirement truth layers first before letting agents continue planning or execution.'
      });
    }

    if (contextHygiene.level !== 'stable') {
      findings.push({
        key: 'heavy_context',
        severity: contextHygiene.level === 'suggest-clearing' ? 'high' : 'low',
        title: 'Current context is already heavy',
        evidence: [
          `context_hygiene.level = ${contextHygiene.level}`,
          ...contextHygiene.reasons.slice(0, 4)
        ],
        recommendation: contextHygiene.recommendation
      });
    }

    if (git.available && git.dirty) {
      findings.push({
        key: 'dirty_worktree',
        severity: 'low',
        title: 'The current repository has uncommitted changes',
        evidence: git.lines.slice(0, 6),
        recommendation: 'Confirm whether these changes are part of the current problem or should be isolated first.'
      });
    }

    if (threadStats.open > 0) {
      findings.push({
        key: 'open_threads',
        severity: 'low',
        title: 'There are already open lightweight threads',
        evidence: [
          `open_threads = ${threadStats.open}`,
          `resolved_threads = ${threadStats.resolved}`
        ],
        recommendation: 'Confirm whether the current problem should attach to an existing thread instead of creating duplicate context.'
      });
    }

    if (findings.length === 0) {
      findings.push({
        key: 'no_major_anomaly',
        severity: 'info',
        title: 'No obvious structural anomaly was found',
        evidence: ['session / handoff / truth artifacts appear complete'],
        recommendation: 'If the problem persists, move to debug or review first instead of piling on more context.'
      });
    }

    return {
      projectRoot,
      session,
      handoff,
      contextHygiene,
      git,
      threadStats,
      latestExecutor,
      findings,
      problemText: problemText || ''
    };
  }

  function buildReportMarkdown(report) {
    const lines = [
      '# Emb-Agent Forensics Report',
      '',
      `- Generated: ${new Date().toISOString()}`,
      `- Project: ${report.projectRoot}`,
      `- Problem: ${report.problemText || '(not provided)'}`,
      `- Linked Thread: ${report.linkedThread ? report.linkedThread.name : '(none)'}`,
      '',
      '## Session Snapshot',
      '',
      `- last_command: ${report.session.last_command || '(empty)'}`,
      `- focus: ${report.session.focus || '(empty)'}`,
      `- last_files: ${(report.session.last_files || []).join(', ') || '(none)'}`,
      `- open_questions: ${(report.session.open_questions || []).join(' | ') || '(none)'}`,
      `- known_risks: ${(report.session.known_risks || []).join(' | ') || '(none)'}`,
      `- handoff: ${report.handoff ? 'present' : 'absent'}`,
      `- context_hygiene: ${report.contextHygiene.level}`,
      `- open_threads: ${report.threadStats.open}`,
      '',
      '## Findings',
      ''
    ];

    if (report.latestExecutor) {
      lines.splice(lines.length - 2, 0,
        '## Latest Executor',
        '',
        `- name: ${report.latestExecutor.name}`,
        `- status: ${report.latestExecutor.status}`,
        `- risk: ${report.latestExecutor.risk || '(empty)'}`,
        `- exit_code: ${report.latestExecutor.exit_code === null ? '(none)' : report.latestExecutor.exit_code}`,
        `- duration_ms: ${report.latestExecutor.duration_ms === null ? '(none)' : report.latestExecutor.duration_ms}`,
        `- ran_at: ${report.latestExecutor.ran_at || '(empty)'}`,
        `- cwd: ${report.latestExecutor.cwd || '(empty)'}`,
        `- argv: ${(report.latestExecutor.argv || []).join(' ') || '(none)'}`,
        `- evidence_hint: ${(report.latestExecutor.evidence_hint || []).join(', ') || '(none)'}`,
        `- stdout_preview: ${report.latestExecutor.stdout_preview || '(empty)'}`,
        `- stderr_preview: ${report.latestExecutor.stderr_preview || '(empty)'}`,
        ''
      );
    }

    report.findings.forEach((item, index) => {
      lines.push(`### ${index + 1}. [${item.severity}] ${item.title}`);
      lines.push('');
      lines.push('Evidence:');
      item.evidence.forEach(line => lines.push(`- ${line}`));
      lines.push('');
      lines.push(`Recommendation: ${item.recommendation}`);
      lines.push('');
    });

    if (report.git.available) {
      lines.push('## Git');
      lines.push('');
      lines.push(`- dirty: ${report.git.dirty ? 'yes' : 'no'}`);
      if (report.git.lines.length > 0) {
        report.git.lines.forEach(line => lines.push(`- ${line}`));
      }
      lines.push('');
    }

    lines.push('## Next Actions');
    lines.push('');
    const recommendations = runtime.unique(report.findings.map(item => item.recommendation));
    recommendations.forEach(item => lines.push(`- ${item}`));
    lines.push('');

    return lines.join('\n');
  }

  function runForensics(problemText) {
    ensureForensicsDir();

    const report = buildFindings(problemText);
    const timestamp = buildTimestampSlug(new Date().toISOString());
    const fileName = `report-${timestamp}.md`;
    const filePath = path.join(getForensicsDir(), fileName);
    const reportFile = path.relative(process.cwd(), filePath);
    const summary = (report.problemText || '').trim()
      ? `Forensics: ${report.problemText.trim()}`
      : `Forensics: ${report.findings[0].title}`;
    const highestSeverity = report.findings.some(item => item.severity === 'high')
      ? 'high'
      : report.findings.some(item => item.severity === 'medium')
        ? 'medium'
        : report.findings.some(item => item.severity === 'low')
          ? 'low'
          : 'info';
    const linkedThread = upsertForensicsThread(summary, {
      report_file: reportFile,
      problem: report.problemText,
      findings_count: report.findings.length,
      highest_severity: highestSeverity,
      primary_recommendation: report.findings[0] ? report.findings[0].recommendation : ''
    });
    report.linkedThread = linkedThread;
    const markdown = buildReportMarkdown(report);

    fs.writeFileSync(filePath, markdown, 'utf8');

    updateSession(current => {
      current.last_command = 'forensics';
      current.focus = linkedThread.title;
      current.active_thread = {
        name: linkedThread.name,
        title: linkedThread.title,
        status: linkedThread.status,
        path: linkedThread.path,
        updated_at: linkedThread.updated_at
      };
      current.diagnostics = {
        ...(current.diagnostics || {}),
        latest_forensics: {
          report_file: reportFile,
          problem: report.problemText || '',
          linked_thread: linkedThread.name,
          highest_severity: highestSeverity,
          generated_at: new Date().toISOString()
        }
      };
    });

    return {
      generated: true,
      report_file: reportFile,
      problem: report.problemText,
      linked_thread: {
        name: linkedThread.name,
        title: linkedThread.title,
        status: linkedThread.status,
        path: linkedThread.path
      },
      context_hygiene: report.contextHygiene,
      latest_executor: report.latestExecutor || null,
      findings: report.findings,
      git: report.git,
      thread_stats: report.threadStats
    };
  }

  function handleForensicsCommands(cmd, subcmd, rest) {
    if (cmd !== 'forensics') {
      return undefined;
    }

    const text = [subcmd, ...rest].filter(Boolean).join(' ').trim();
    return runForensics(text);
  }

  return {
    getForensicsDir,
    runForensics,
    handleForensicsCommands
  };
}

module.exports = {
  createForensicsCommandHelpers
};
