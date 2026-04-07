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
    const findings = [];

    if (handoff) {
      findings.push({
        key: 'unconsumed_handoff',
        severity: 'high',
        title: '存在未消费的 handoff',
        evidence: [
          `handoff.next_action = ${handoff.next_action || '(empty)'}`,
          `handoff.focus = ${handoff.focus || '(empty)'}`,
          `resume_cli = ${contextHygiene.resume_cli}`
        ],
        recommendation: '先执行 resume 把现场接回，再继续扩展问题空间。'
      });
    }

    if ((session.open_questions || []).length > 0) {
      findings.push({
        key: 'open_questions',
        severity: 'medium',
        title: '未决问题仍在堆积',
        evidence: (session.open_questions || []).slice(0, 4).map(item => `question: ${item}`),
        recommendation: '优先收敛最早的未决问题，否则计划和执行都会漂。'
      });
    }

    if ((session.known_risks || []).length > 0) {
      findings.push({
        key: 'known_risks',
        severity: 'medium',
        title: '已知风险仍未闭环',
        evidence: (session.known_risks || []).slice(0, 4).map(item => `risk: ${item}`),
        recommendation: '先决定这些风险是转成 thread、进入 review，还是直接 bench 验证。'
      });
    }

    if ((session.last_files || []).length === 0 && (session.last_command || '').trim() !== '') {
      findings.push({
        key: 'lost_file_context',
        severity: 'medium',
        title: '有最近动作，但缺少最近文件',
        evidence: [`last_command = ${session.last_command}`],
        recommendation: '先补一次 scan 或 last-files add，避免后续推断脱离真实代码入口。'
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
        title: '最小真值工件缺失',
        evidence: missingArtifacts.map(item => `missing: ${item}`),
        recommendation: '先补齐硬件/需求真值层，再让 agent 继续规划或执行。'
      });
    }

    if (contextHygiene.level !== 'stable') {
      findings.push({
        key: 'heavy_context',
        severity: contextHygiene.level === 'suggest-clearing' ? 'high' : 'low',
        title: '当前上下文已经偏重',
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
        title: '当前仓库存在未提交改动',
        evidence: git.lines.slice(0, 6),
        recommendation: '确认这些改动是当前问题的一部分，还是需要先隔离。'
      });
    }

    if (threadStats.open > 0) {
      findings.push({
        key: 'open_threads',
        severity: 'low',
        title: '已有未关闭的轻量线程',
        evidence: [
          `open_threads = ${threadStats.open}`,
          `resolved_threads = ${threadStats.resolved}`
        ],
        recommendation: '确认当前问题是否应该挂到已有 thread，而不是重复创建上下文。'
      });
    }

    if (findings.length === 0) {
      findings.push({
        key: 'no_major_anomaly',
        severity: 'info',
        title: '未发现明显结构异常',
        evidence: ['session / handoff / truth artifacts 看起来完整'],
        recommendation: '如果问题仍在，优先转入 debug 或 review，别继续堆上下文。'
      });
    }

    return {
      projectRoot,
      session,
      handoff,
      contextHygiene,
      git,
      threadStats,
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
