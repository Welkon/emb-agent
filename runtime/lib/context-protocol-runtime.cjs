'use strict';

function createContextProtocolRuntime(deps) {
  function buildContextOverview() {
    const resolved = deps.resolveSession();
    const sessionView = deps.buildCurrentSessionView();
    const status = deps.buildStatus();
    const next = deps.buildNextContext();
    const start = buildStartContext();
    const bootstrap = deps.buildBootstrapReport();
    const health = deps.buildHealthReport();

    return {
      entry: 'context',
      project_root: resolved && resolved.session ? resolved.session.project_root : deps.resolveProjectRoot(),
      summary: {
        profile: resolved && resolved.session ? resolved.session.project_profile : '',
        specs: resolved && resolved.session ? resolved.session.active_specs || [] : [],
        focus: resolved && resolved.session ? resolved.session.focus || '' : '',
        last_command: resolved && resolved.session ? resolved.session.last_command || '' : '',
        active_task:
          status && status.active_task && status.active_task.name
            ? {
                name: status.active_task.name,
                title: status.active_task.title || '',
                status: status.active_task.status || ''
              }
            : null,
        handoff_present: Boolean(sessionView && sessionView.handoff),
        stored_reports:
          sessionView &&
          sessionView.reports &&
          Array.isArray(sessionView.reports.reports)
            ? sessionView.reports.reports.length
            : 0,
        latest_report_present: Boolean(sessionView && sessionView.latest_report)
      },
      session_state: sessionView ? sessionView.session_state : null,
      memory_summary: deps.loadContextSummary(),
      handoff: sessionView ? sessionView.handoff : null,
      continuity: sessionView ? sessionView.continuity || null : null,
      latest_report: sessionView ? sessionView.latest_report || null : null,
      reports: sessionView ? sessionView.reports : { reports: [] },
      status,
      next,
      start,
      bootstrap,
      health
    };
  }

  function buildStartContext() {
    const projectRoot = deps.resolveProjectRoot();
    if (!deps.fs.existsSync(deps.runtime.resolveProjectDataPath(projectRoot, 'project.json'))) {
      deps.runInitCommand([], 'start');
    }
    const initialized = deps.fs.existsSync(deps.runtime.resolveProjectDataPath(projectRoot, 'project.json'));
    const resolved = initialized ? deps.resolveSession() : null;
    const initGuidance = deps.buildInitGuidance(projectRoot);
    const bootstrap = deps.buildBootstrapSummary(initGuidance);
    const bootstrapReport = initialized ? deps.buildBootstrapReport() : null;
    const nextContext = initialized ? deps.buildNextContext() : null;
    const resumeContext = initialized ? deps.buildResumeContext() : null;
    const activeTask = deps.getActiveTask();
    const handoff = deps.loadHandoff();
    const boardEvidenceSummary = deps.boardEvidence.summarizeBoardEvidence(projectRoot, {
      limit: 8
    });
    const bootstrapPending = Boolean(
      initialized &&
      bootstrap &&
      (
        bootstrap.status !== 'ready-for-next' ||
        (bootstrap.command && bootstrap.command !== 'next')
      )
    );
    const bootstrapCommand = bootstrapPending && bootstrap && bootstrap.command
      ? bootstrap.command
      : '';
    const taskIntake = deps.buildTaskIntake({
      activeTask,
      hasHandoff: Boolean(handoff),
      bootstrapPending
    });
    const immediateCommand = handoff
      ? 'resume'
      : bootstrapCommand
        ? bootstrapCommand
      : activeTask
        ? 'next'
        : initialized
          ? 'task add <summary>'
          : 'start';
    const immediateReason = handoff
      ? 'An unconsumed handoff exists and should be restored before any new work.'
      : bootstrapCommand
        ? bootstrap.summary
      : activeTask
        ? 'An active task already exists. Continue that task before starting new work.'
        : initialized
          ? 'The emb-agent project bootstrap already exists. Create and activate a task before execution.'
          : 'The emb-agent project has just been initialized in this workspace.';

    return deps.runtimeEventHelpers.appendRuntimeEvent({
      entry: 'start',
      summary: {
        project_root: projectRoot,
        initialized,
        active_task: activeTask
          ? {
              name: activeTask.name,
              title: activeTask.title,
              status: activeTask.status,
              package: activeTask.package || '',
              worktree_path: activeTask.worktree_path,
              prd_path: `.emb-agent/tasks/${activeTask.name}/prd.md`
            }
          : null,
        handoff_present: Boolean(handoff),
        default_package: resolved && resolved.session ? resolved.session.default_package || '' : '',
        active_package: resolved && resolved.session ? resolved.session.active_package || '' : '',
        hardware_identity: initGuidance.selected_identity
      },
      immediate: {
        command: immediateCommand,
        reason: immediateReason,
        cli: `${deps.getRuntimeHost().cliCommand} ${immediateCommand}`
      },
      task_intake: taskIntake,
      workflow: {
        mode: 'linear-default',
        steps: deps.buildStartWorkflow(initGuidance, {
          initialized,
          activeTask,
          hasHandoff: Boolean(handoff)
        })
      },
      bootstrap: bootstrapReport
        ? {
            ...bootstrap,
            quickstart: bootstrapReport.quickstart || null,
            next_stage: bootstrapReport.next_stage || null,
            action_card: bootstrapReport.action_card || null
          }
        : bootstrap,
      next: nextContext
        ? {
            command: nextContext.next.command,
            reason: nextContext.next.reason,
            workflow_stage: nextContext.workflow_stage,
            cli: nextContext.next.cli
          }
        : null,
      board_evidence: boardEvidenceSummary,
      resume: resumeContext
        ? {
            context_hygiene: resumeContext.context_hygiene,
            handoff: resumeContext.handoff,
            task: resumeContext.task
          }
        : null
    }, {
      type: 'workflow-start',
      category: 'workflow',
      status: bootstrapCommand ? 'pending' : 'ok',
      severity: bootstrapCommand ? 'normal' : 'info',
      summary: immediateReason,
      action: immediateCommand,
      command: `${deps.getRuntimeHost().cliCommand} ${immediateCommand}`,
      source: 'emb-agent-main',
      details: {
        initialized,
        handoff_present: Boolean(handoff),
        active_task: activeTask ? activeTask.name : '',
        board_evidence_state: boardEvidenceSummary.state,
        board_evidence_blocking: false
      }
    });
  }

  function buildExternalStartProtocol() {
    return deps.externalAgent.buildStartProtocol(deps.getRuntimeHost(), buildStartContext());
  }

  function buildExternalNextProtocol() {
    return deps.externalAgent.buildNextProtocol(deps.getRuntimeHost(), deps.buildNextContext());
  }

  function buildExternalStatusProtocol() {
    return deps.externalAgent.buildStatusProtocol(deps.getRuntimeHost(), deps.buildStatus());
  }

  function buildExternalHealthProtocol() {
    return deps.externalAgent.buildHealthProtocol(deps.getRuntimeHost(), deps.buildHealthReport());
  }

  function buildExternalDispatchNextProtocol() {
    return deps.externalAgent.buildDispatchNextProtocol(deps.getRuntimeHost(), deps.buildDispatchContext('next'));
  }

  function buildExternalInitProtocol(tokens, aliasUsed) {
    const initialized = deps.runInitCommand(tokens, aliasUsed);
    return initialized ? deps.externalAgent.buildInitProtocol(deps.getRuntimeHost(), initialized) : null;
  }

  return {
    buildContextOverview,
    buildStartContext,
    buildExternalStartProtocol,
    buildExternalNextProtocol,
    buildExternalStatusProtocol,
    buildExternalHealthProtocol,
    buildExternalDispatchNextProtocol,
    buildExternalInitProtocol
  };
}

module.exports = {
  createContextProtocolRuntime
};
