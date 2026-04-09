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
    listThreads,
    listExecutors
  } = deps;

  function getDiagnostics(session) {
    return session && session.diagnostics
      ? session.diagnostics
      : { latest_forensics: {}, latest_executor: {} };
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
      reasons.push('workspace has not run refresh yet');
    }
    if ((session.last_files || []).length > 0 && (snapshot.last_files || []).length === 0) {
      reasons.push('recent files have not been captured in the workspace snapshot');
    }
    if ((session.open_questions || []).some(item => !(snapshot.open_questions || []).includes(item))) {
      reasons.push('current open questions have not been captured in the workspace snapshot');
    }
    if ((session.known_risks || []).some(item => !(snapshot.known_risks || []).includes(item))) {
      reasons.push('current known risks have not been captured in the workspace snapshot');
    }
    if (
      session.active_task &&
      session.active_task.name &&
      !(links.tasks || []).some(item => item.name === session.active_task.name)
    ) {
      reasons.push(`active task ${session.active_task.name} is not linked to the workspace yet`);
    }
    if (
      session.active_thread &&
      session.active_thread.name &&
      !(links.threads || []).some(item => item.name === session.active_thread.name)
    ) {
      reasons.push(`active thread ${session.active_thread.name} is not linked to the workspace yet`);
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

  function getLatestExecutor(session) {
    return session &&
      session.diagnostics &&
      session.diagnostics.latest_executor &&
      session.diagnostics.latest_executor.name
      ? session.diagnostics.latest_executor
      : null;
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
        label: `Fix trust for ${primary.tool} first`,
        cli: matchedCommand.cli,
        reason: `${primary.summary} Current grade is ${primary.grade}; recommended first action: ${primary.recommended_action}`
      };
    }

    if (toolExecution && toolExecution.cli) {
      return {
        type: 'adapter-health',
        label: `Calibrate the ${toolExecution.tool} adapter first`,
        cli: toolExecution.cli,
        reason: `${primary.summary} Current grade is ${primary.grade}; do not treat tool output as ground truth yet`
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
    const latestExecutor = getLatestExecutor(session);

    if (handoff) {
      pushAction(actions, {
        type: 'resume',
        label: 'Resume the handoff first',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
        reason: handoff.next_action || 'An unconsumed handoff exists'
      });
    }

    if ((threads.threads || []).length > 0) {
      const openThread = (threads.threads || []).find(item => item.status !== 'RESOLVED');
      if (openThread) {
        pushAction(actions, {
          type: 'thread',
          label: `Resume thread ${openThread.name}`,
          cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['thread', 'resume', openThread.name]),
          reason: `${openThread.title}`
        });
      }
    }

    if (activeWorkspace) {
      if (workspaceRefresh && workspaceRefresh.recommended) {
        pushAction(actions, {
          type: 'workspace-refresh',
          label: `Refresh workspace ${activeWorkspace.name}`,
          cli: workspaceRefresh.refresh_cli,
          reason: workspaceRefresh.reasons[0] || 'the current workspace needs to sync recent context'
        });
      }

      pushAction(actions, {
        type: 'workspace',
        label: `Inspect workspace ${activeWorkspace.name}`,
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['workspace', 'show', activeWorkspace.name]),
        reason: activeWorkspace.title || 'an active workspace exists'
      });
    }

    if (adapterHealthAction) {
      pushAction(actions, adapterHealthAction);
    }

    if (toolExecution && toolExecution.recommended) {
      pushAction(actions, {
        type: 'tool',
        label: `Run ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || 'the first tool execution draft is ready'
      });
    }

    if (quickstart && Array.isArray(quickstart.steps) && quickstart.steps[0] && quickstart.steps[0].cli) {
      pushAction(actions, {
        type: 'quickstart',
        label: quickstart.summary || 'Run the first closure',
        cli: quickstart.steps[0].cli,
        reason: quickstart.followup || 'run the shortest integration steps first, then execute next'
      });
    }

    const healthCommands = health && Array.isArray(health.next_commands)
      ? health.next_commands
      : [];
    healthCommands.forEach(item => {
      pushAction(actions, {
        type: 'health',
        label: item.summary || 'Run the health recommendation',
        cli: item.cli,
        reason: item.summary || 'actionable recommendation from health'
      });
    });

    if (latestExecutor && ['failed', 'error'].includes(latestExecutor.status)) {
      pushAction(actions, {
        type: 'forensics',
        label: `Analyze the failed run of ${latestExecutor.name}`,
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [
          'forensics',
          `Latest executor ${latestExecutor.name} ${latestExecutor.status}`
        ]),
        reason: `The latest executor was ${latestExecutor.name} with status ${latestExecutor.status}${
          latestExecutor.exit_code === null ? '' : `，exit_code=${latestExecutor.exit_code}`
        }`
      });
    }

    pushAction(actions, {
      type: 'next',
      label: `Run ${next.next.command}`,
      cli: next.next.cli,
      reason: next.next.reason
    });

    if (toolExecution && !toolExecution.recommended) {
      pushAction(actions, {
        type: 'tool',
        label: `Run ${toolExecution.tool}`,
        cli: toolExecution.cli,
        reason: toolExecution.reason || 'the first tool execution draft is ready'
      });
    }

    if ((resume.carry_over && resume.carry_over.open_questions || []).length > 0) {
      pushAction(actions, {
        type: 'forensics',
        label: 'Run forensics first',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['forensics']),
        reason: 'Open questions exist and manager only sees the summary, so evidence-based diagnostics should come first'
      });
    }

    pushAction(actions, {
      type: 'session-report',
      label: 'Output the session report',
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['session-report']),
      reason: 'Do a lightweight session closure before switching context or ending this round'
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
    const executorCatalog = listExecutors ? listExecutors() : { executors: [] };
    const diagnostics = getDiagnostics(session);
    const executorSignal = buildExecutorSignal(diagnostics.latest_executor);

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
      diagnostics,
      executor_signal: executorSignal,
      executors: executorCatalog.executors || [],
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
