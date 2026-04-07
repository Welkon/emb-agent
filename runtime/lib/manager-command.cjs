'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createManagerCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    getProjectExtDir,
    loadSession,
    loadHandoff,
    getHealthReport,
    buildNextContext,
    buildResumeContext,
    buildToolExecutionFromNext,
    buildSettingsView,
    listThreads
  } = deps;

  function listLatestReports(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    return fs.readdirSync(dirPath)
      .filter(name => name.endsWith('.md'))
      .map(name => {
        const filePath = path.join(dirPath, name);
        return {
          name,
          path: path.relative(process.cwd(), filePath),
          updated_at: fs.statSync(filePath).mtime.toISOString()
        };
      })
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
      .slice(0, 3);
  }

  function buildRecommendedActions(next, resume, threads, handoff, health) {
    const actions = [];
    const toolExecution = buildToolExecutionFromNext(next);

    if (handoff) {
      actions.push({
        type: 'resume',
        label: '优先恢复 handoff',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
        reason: handoff.next_action || '存在未消费 handoff'
      });
    }

    if ((threads.threads || []).length > 0) {
      const openThread = (threads.threads || []).find(item => item.status !== 'RESOLVED');
      if (openThread) {
        actions.push({
          type: 'thread',
          label: `恢复 thread ${openThread.name}`,
          cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['thread', 'resume', openThread.name]),
          reason: `${openThread.title}`
        });
      }
    }

    if (toolExecution && toolExecution.recommended) {
      actions.push({
        type: 'tool',
        label: `执行 ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || '已生成首条工具执行草案'
      });
    }

    const healthCommands = health && Array.isArray(health.next_commands)
      ? health.next_commands
      : [];
    healthCommands.forEach(item => {
      actions.push({
        type: 'health',
        label: item.summary || '执行 health 建议',
        cli: item.cli,
        reason: item.summary || '来自 health 的可执行建议'
      });
    });

    actions.push({
      type: 'next',
      label: `执行 ${next.next.command}`,
      cli: next.next.cli,
      reason: next.next.reason
    });

    if (toolExecution && !toolExecution.recommended) {
      actions.push({
        type: 'tool',
        label: `执行 ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || '已生成首条工具执行草案'
      });
    }

    if ((resume.carry_over && resume.carry_over.open_questions || []).length > 0) {
      actions.push({
        type: 'forensics',
        label: '先做一次 forensics',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['forensics']),
        reason: '当前有未决问题，且 manager 只看到摘要，先补证据化诊断更稳'
      });
    }

    actions.push({
      type: 'session-report',
      label: '输出 session report',
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['session-report']),
      reason: '在切上下文或结束本轮前做一次轻量会话收口'
    });

    return actions;
  }

  function buildManagerView() {
    const session = loadSession();
    const handoff = loadHandoff();
    const health = getHealthReport ? getHealthReport() : { status: 'pass', summary: {}, next_commands: [] };
    const next = buildNextContext();
    const resume = buildResumeContext();
    const settings = buildSettingsView();
    const threads = listThreads();
    const reportsRoot = path.join(getProjectExtDir(), 'reports');
    const latestForensics = listLatestReports(path.join(reportsRoot, 'forensics'));
    const latestSessions = listLatestReports(path.join(reportsRoot, 'sessions'));
    const toolExecution = buildToolExecutionFromNext(next);

    return {
      mode: 'manager-lite',
      session: {
        project_root: session.project_root,
        profile: session.project_profile,
        packs: session.active_packs || [],
        focus: session.focus || '',
        last_command: session.last_command || '',
        last_files: session.last_files || [],
        open_questions: session.open_questions || [],
        known_risks: session.known_risks || [],
        active_thread: session.active_thread || {
          name: '',
          title: '',
          status: '',
          path: '',
          updated_at: ''
        }
      },
      next: next.next,
      health: {
        status: health.status,
        summary: health.summary,
        next_commands: health.next_commands || []
      },
      tool_execution: toolExecution,
      context_hygiene: next.context_hygiene,
      handoff: resume.handoff,
      settings: settings.settings,
      defaults: settings.defaults,
      threads: {
        total: (threads.threads || []).length,
        open: (threads.threads || []).filter(item => item.status !== 'RESOLVED').length,
        latest: (threads.threads || []).slice(0, 5)
      },
      reports: {
        forensics: latestForensics,
        sessions: latestSessions
      },
      diagnostics: session.diagnostics || { latest_forensics: {} },
      recommended_actions: buildRecommendedActions(next, resume, threads, handoff, health)
    };
  }

  function handleManagerCommands(cmd, subcmd, rest) {
    if (cmd !== 'manager') {
      return undefined;
    }

    if (subcmd && subcmd !== 'show') {
      throw new Error(`Unknown manager subcommand: ${subcmd}`);
    }

    if (rest && rest.length > 0) {
      throw new Error('manager does not accept positional arguments');
    }

    return buildManagerView();
  }

  return {
    buildManagerView,
    handleManagerCommands
  };
}

module.exports = {
  createManagerCommandHelpers
};
