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
      packs: Array.isArray(raw.packs) ? raw.packs : [],
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
      .filter(name => name.endsWith('.json'))
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

  return {
    getSessionReportsDir,
    listStoredSessionReports,
    resolveStoredSessionReport,
    buildSessionReportContinuity
  };
}

module.exports = {
  createSessionReportStoreHelpers
};
