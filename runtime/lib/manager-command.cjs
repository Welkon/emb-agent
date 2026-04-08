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

  function buildWorkspaceRefreshAnalysis(workspace, session) {
    if (!workspace || !workspace.name) {
      return null;
    }

    const snapshot = workspace.snapshot || {
      last_files: [],
      open_questions: [],
      known_risks: [],
      refreshed_at: ''
    };
    const links = workspace.links || {
      tasks: [],
      specs: [],
      threads: []
    };
    const reasons = [];

    if (!snapshot.refreshed_at) {
      reasons.push('workspace 还没有执行过 refresh');
    }
    if ((session.last_files || []).length > 0 && (snapshot.last_files || []).length === 0) {
      reasons.push('最近文件还没沉到 workspace snapshot');
    }
    if ((session.open_questions || []).some(item => !(snapshot.open_questions || []).includes(item))) {
      reasons.push('当前未决问题还没沉到 workspace snapshot');
    }
    if ((session.known_risks || []).some(item => !(snapshot.known_risks || []).includes(item))) {
      reasons.push('当前已知风险还没沉到 workspace snapshot');
    }
    if (
      session.active_task &&
      session.active_task.name &&
      !(links.tasks || []).some(item => item.name === session.active_task.name)
    ) {
      reasons.push(`active task ${session.active_task.name} 还没挂到 workspace`);
    }
    if (
      session.active_thread &&
      session.active_thread.name &&
      !(links.threads || []).some(item => item.name === session.active_thread.name)
    ) {
      reasons.push(`active thread ${session.active_thread.name} 还没挂到 workspace`);
    }

    return {
      recommended: reasons.length > 0,
      reasons,
      refresh_cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['workspace', 'refresh', workspace.name])
    };
  }

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

  function pushAction(actions, action) {
    if (!action) {
      return;
    }

    if (
      action.cli &&
      actions.some(item => item.cli && item.cli === action.cli)
    ) {
      return;
    }

    actions.push(action);
  }

  function buildAdapterHealthAction(health, toolExecution) {
    const adapterHealth = health && health.adapter_health ? health.adapter_health : null;
    const primary = adapterHealth && adapterHealth.primary ? adapterHealth.primary : null;
    const healthCommands = health && Array.isArray(health.next_commands)
      ? health.next_commands
      : [];

    if (!primary || primary.executable) {
      return null;
    }

    const preferredKeysByAction = {
      'map-chip-profile': ['adapter-bootstrap', 'adapter-source-add'],
      'sync-adapter': ['adapter-bootstrap', 'adapter-sync', 'adapter-source-add'],
      'implement-adapter': ['adapter-derive-from-doc', 'tool-run-primary'],
      'add-binding': ['adapter-derive-from-doc', 'tool-run-primary'],
      'add-source-refs': ['tool-run-primary'],
      'add-register-summary': ['tool-run-primary'],
      'review-profile': ['tool-run-primary'],
      'run-tool': ['tool-run-primary']
    };
    const preferredKeys = preferredKeysByAction[primary.recommended_action] || ['tool-run-primary'];
    const matchedCommand = preferredKeys
      .map(key => healthCommands.find(item => item.key === key))
      .find(Boolean);

    if (matchedCommand && matchedCommand.cli) {
      return {
        type: 'adapter-health',
        label: `先修复 ${primary.tool} 可信度`,
        cli: matchedCommand.cli,
        reason: `${primary.summary} 当前等级 ${primary.grade}，建议先 ${primary.recommended_action}`
      };
    }

    if (toolExecution && toolExecution.cli) {
      return {
        type: 'adapter-health',
        label: `先校准 ${toolExecution.tool} adapter`,
        cli: toolExecution.cli,
        reason: `${primary.summary} 当前等级 ${primary.grade}，不要把工具输出直接当真值`
      };
    }

    return null;
  }

  function buildRecommendedActions(next, resume, threads, handoff, health, session) {
    const actions = [];
    const toolExecution = buildToolExecutionFromNext(next);
    const quickstart = health && health.quickstart ? health.quickstart : null;
    const activeWorkspace = resume && resume.workspace ? resume.workspace : null;
    const workspaceRefresh = buildWorkspaceRefreshAnalysis(activeWorkspace, session || {});
    const adapterHealthAction = buildAdapterHealthAction(health, toolExecution);

    if (handoff) {
      pushAction(actions, {
        type: 'resume',
        label: '优先恢复 handoff',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
        reason: handoff.next_action || '存在未消费 handoff'
      });
    }

    if ((threads.threads || []).length > 0) {
      const openThread = (threads.threads || []).find(item => item.status !== 'RESOLVED');
      if (openThread) {
        pushAction(actions, {
          type: 'thread',
          label: `恢复 thread ${openThread.name}`,
          cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['thread', 'resume', openThread.name]),
          reason: `${openThread.title}`
        });
      }
    }

    if (activeWorkspace) {
      if (workspaceRefresh && workspaceRefresh.recommended) {
        pushAction(actions, {
          type: 'workspace-refresh',
          label: `刷新 workspace ${activeWorkspace.name}`,
          cli: workspaceRefresh.refresh_cli,
          reason: workspaceRefresh.reasons[0] || '当前 workspace 需要同步最近上下文'
        });
      }

      pushAction(actions, {
        type: 'workspace',
        label: `查看 workspace ${activeWorkspace.name}`,
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['workspace', 'show', activeWorkspace.name]),
        reason: activeWorkspace.title || '当前存在活跃 workspace'
      });
    }

    if (adapterHealthAction) {
      pushAction(actions, adapterHealthAction);
    }

    if (toolExecution && toolExecution.recommended) {
      pushAction(actions, {
        type: 'tool',
        label: `执行 ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || '已生成首条工具执行草案'
      });
    }

    if (quickstart && Array.isArray(quickstart.steps) && quickstart.steps[0] && quickstart.steps[0].cli) {
      pushAction(actions, {
        type: 'quickstart',
        label: quickstart.summary || '执行首次闭环',
        cli: quickstart.steps[0].cli,
        reason: quickstart.followup || '先跑最短接入步骤，再执行 next'
      });
    }

    const healthCommands = health && Array.isArray(health.next_commands)
      ? health.next_commands
      : [];
    healthCommands.forEach(item => {
      pushAction(actions, {
        type: 'health',
        label: item.summary || '执行 health 建议',
        cli: item.cli,
        reason: item.summary || '来自 health 的可执行建议'
      });
    });

    pushAction(actions, {
      type: 'next',
      label: `执行 ${next.next.command}`,
      cli: next.next.cli,
      reason: next.next.reason
    });

    if (toolExecution && !toolExecution.recommended) {
      pushAction(actions, {
        type: 'tool',
        label: `执行 ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || '已生成首条工具执行草案'
      });
    }

    if ((resume.carry_over && resume.carry_over.open_questions || []).length > 0) {
      pushAction(actions, {
        type: 'forensics',
        label: '先做一次 forensics',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['forensics']),
        reason: '当前有未决问题，且 manager 只看到摘要，先补证据化诊断更稳'
      });
    }

    pushAction(actions, {
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
    const workspace = resume.workspace || null;
    const workspaceRefresh = buildWorkspaceRefreshAnalysis(workspace, session);

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
        active_workspace: session.active_workspace || {
          name: '',
          title: '',
          type: '',
          status: '',
          path: '',
          updated_at: ''
        },
        active_task: session.active_task || {
          name: '',
          title: '',
          status: '',
          path: '',
          updated_at: ''
        },
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
        adapter_health: health.adapter_health || null,
        next_commands: health.next_commands || [],
        quickstart: health.quickstart || null
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
      workspace: workspace
        ? {
            ...workspace,
            refresh_recommendation: workspaceRefresh
          }
        : null,
      recommended_actions: buildRecommendedActions(next, resume, threads, handoff, health, session)
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
