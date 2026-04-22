'use strict';

function createSessionReportStoreHelpers(deps) {
  const {
    fs,
    path,
    runtime
  } = deps;

  function getSessionReportsDir(projectExtDir) {
    return path.join(projectExtDir, 'reports', 'sessions');
  }

  function getSessionContinuityJsonPath(projectExtDir) {
    return path.join(getSessionReportsDir(projectExtDir), 'CURRENT.json');
  }

  function getSessionContinuityMarkdownPath(projectExtDir) {
    return path.join(getSessionReportsDir(projectExtDir), 'CURRENT.md');
  }

  function getSessionReportsIndexPath(projectExtDir) {
    return path.join(getSessionReportsDir(projectExtDir), 'INDEX.md');
  }

  function safeReadJson(filePath) {
    try {
      return runtime.readJson(filePath);
    } catch {
      return null;
    }
  }

  function normalizeStoredSessionReport(raw, filePath, cwd) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const baseName = path.basename(String(filePath || ''), '.json');
    const reportDir = path.dirname(String(filePath || ''));
    const normalizedCwd = String(cwd || process.cwd()).trim() || process.cwd();
    const defaultMarkdownPath = path.join(reportDir, `${baseName}.md`);

    return {
      id: String(raw.id || baseName),
      generated_at: String(raw.generated_at || ''),
      summary: String(raw.summary || ''),
      project_root: String(raw.project_root || ''),
      git_branch: String(raw.git_branch || ''),
      profile: String(raw.profile || ''),
      specs: Array.isArray(raw.specs) ? raw.specs : [],
      focus: String(raw.focus || ''),
      last_command: String(raw.last_command || ''),
      next_command: String(raw.next_command || ''),
      next_reason: String(raw.next_reason || ''),
      handoff_present: raw.handoff_present === true,
      executor_signal: raw.executor_signal || null,
      chip_support_health: raw.chip_support_health || null,
      markdown_file: String(
        raw.markdown_file ||
        path.relative(normalizedCwd, defaultMarkdownPath)
      ),
      json_file: String(
        raw.json_file ||
        path.relative(normalizedCwd, filePath)
      )
    };
  }

  function listStoredSessionReports(projectExtDir, options = {}) {
    const cwd = String(options.cwd || process.cwd()).trim() || process.cwd();
    const currentBranch = String(options.current_branch || '').trim();
    const reportsDir = getSessionReportsDir(projectExtDir);

    if (!fs.existsSync(reportsDir)) {
      return {
        reports: [],
        latest: null,
        preferred: null,
        current_branch: currentBranch
      };
    }

    const reports = fs.readdirSync(reportsDir)
      .filter(name => /^report-.+\.json$/i.test(name))
      .map(name => normalizeStoredSessionReport(safeReadJson(path.join(reportsDir, name)), path.join(reportsDir, name), cwd))
      .filter(Boolean)
      .sort((left, right) => String(right.generated_at || '').localeCompare(String(left.generated_at || '')));

    const latest = reports[0] || null;
    const preferred = currentBranch
      ? reports.find(item => item.git_branch === currentBranch) || latest
      : latest;

    return {
      reports,
      latest,
      preferred,
      current_branch: currentBranch
    };
  }

  function resolveStoredSessionReport(projectExtDir, target, options = {}) {
    const history = listStoredSessionReports(projectExtDir, options);
    const normalized = String(target || '').trim();

    if (!normalized || normalized === 'latest') {
      return history.latest || null;
    }

    return history.reports.find(item =>
      item.id === normalized ||
      item.json_file === normalized ||
      item.markdown_file === normalized ||
      path.basename(item.json_file || '') === normalized ||
      path.basename(item.markdown_file || '') === normalized
    ) || null;
  }

  function buildSessionReportContinuity(projectExtDir, options = {}) {
    const currentBranch = String(options.current_branch || '').trim();
    const history = listStoredSessionReports(projectExtDir, options);
    const preferred = history.preferred || null;

    if (!preferred) {
      return {
        present: false,
        current_branch: currentBranch,
        latest: history.latest,
        preferred: null,
        branch_status: 'none'
      };
    }

    let branchStatus = 'unknown';
    if (currentBranch && preferred.git_branch) {
      branchStatus = currentBranch === preferred.git_branch ? 'match' : 'mismatch';
    }

    return {
      present: true,
      current_branch: currentBranch,
      latest: history.latest,
      preferred,
      branch_status: branchStatus,
      branch_matches_current: branchStatus === 'match'
    };
  }

  function readStoredSessionContinuity(projectExtDir, options = {}) {
    const cwd = String(options.cwd || process.cwd()).trim() || process.cwd();
    const filePath = getSessionContinuityJsonPath(projectExtDir);
    const raw = safeReadJson(filePath);

    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const markdownPath = getSessionContinuityMarkdownPath(projectExtDir);
    const indexPath = getSessionReportsIndexPath(projectExtDir);
    const latestReport =
      raw.latest_report && typeof raw.latest_report === 'object'
        ? raw.latest_report
        : null;

    return {
      version: String(raw.version || '1.0'),
      generated_at: String(raw.generated_at || ''),
      source: String(raw.source || ''),
      project_root: String(raw.project_root || ''),
      git_branch: String(raw.git_branch || ''),
      profile: String(raw.profile || ''),
      specs: Array.isArray(raw.specs) ? raw.specs : [],
      focus: String(raw.focus || ''),
      last_command: String(raw.last_command || ''),
      default_package: String(raw.default_package || ''),
      active_package: String(raw.active_package || ''),
      active_task:
        raw.active_task && typeof raw.active_task === 'object'
          ? raw.active_task
          : null,
      handoff:
        raw.handoff && typeof raw.handoff === 'object'
          ? raw.handoff
          : null,
      memory_summary:
        raw.memory_summary && typeof raw.memory_summary === 'object'
          ? raw.memory_summary
          : null,
      next:
        raw.next && typeof raw.next === 'object'
          ? raw.next
          : null,
      resume:
        raw.resume && typeof raw.resume === 'object'
          ? raw.resume
          : null,
      reports:
        raw.reports && typeof raw.reports === 'object'
          ? raw.reports
          : { count: 0, latest_id: '', preferred_id: '' },
      latest_report: latestReport,
      markdown_file: path.relative(cwd, markdownPath),
      json_file: path.relative(cwd, filePath),
      index_file: path.relative(cwd, indexPath)
    };
  }

  return {
    getSessionReportsDir,
    getSessionContinuityJsonPath,
    getSessionContinuityMarkdownPath,
    getSessionReportsIndexPath,
    listStoredSessionReports,
    resolveStoredSessionReport,
    buildSessionReportContinuity,
    readStoredSessionContinuity
  };
}

module.exports = {
  createSessionReportStoreHelpers
};
