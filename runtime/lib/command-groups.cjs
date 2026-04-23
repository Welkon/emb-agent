'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');
const adapterToolChipCommandHelpers = require('./adapter-tool-chip-commands.cjs');
const dispatchCommandRuntimeHelpers = require('./dispatch-command-runtime.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createCommandGroupHelpers(deps) {
  const {
    runtime,
    scheduler,
    toolCatalog,
    toolRuntime,
    chipCatalog,
    ROOT,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    resolveSession,
    getActiveTask,
    updateSession,
    buildNextContext,
    buildStartContext,
    runSubAgentBridge,
    collectSubAgentBridgeJobs,
    buildActionOutput,
    buildReviewContext,
    buildArchReviewContext,
    buildDispatchContext,
    buildOrchestratorContext,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    bootstrapAdapterSource,
    parseAdapterSyncArgs,
    syncNamedAdapterSource,
    syncAllAdapterSources,
    runAdapterDerive,
    runAdapterGenerate,
    runAdapterAnalysisInit,
    runAdapterExport,
    runAdapterPublish,
    handleCatalogAndStateCommands,
    saveScanReport,
    savePlanReport,
    saveReviewReport,
    confirmVerifySignoff,
    rejectVerifySignoff,
    saveVerifyReport,
    addNoteEntry,
    ingestDocCli,
    referenceLookupCli
  } = deps;

  function buildCli(args) {
    return runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, Array.isArray(args) ? args : []);
  }

  function buildTaskIntakeBlockedActionOutput(action) {
    const output = buildActionOutput(action);
    const workLabel = action === 'do' ? 'mutation work' : 'task-scoped investigation';
    const reason = `No active task exists yet. Create and activate a real task before ${workLabel}.`;
    const firstCli = buildCli(['task', 'add', '<summary>']);
    const thenCli = buildCli(['task', 'activate', '<name>']);

    return {
      ...output,
      workflow_stage: {
        name: 'task-intake',
        why: reason,
        exit_criteria: 'A real task is created and activated before mutation work resumes',
        primary_command: 'task add'
      },
      action_card: {
        status: 'blocked-by-task-intake',
        stage: 'task-intake',
        action: action === 'do' ? 'Create task before mutation' : 'Create task before scan',
        summary: reason,
        reason: action === 'do'
          ? 'Mutation work without task context is blocked.'
          : 'Scan work without task context is blocked once bootstrap is already ready.',
        first_step_label: 'Create task',
        first_instruction: 'Create a task and PRD first. If scope or hardware truth is still unclear, run scan before plan/do.',
        first_cli: firstCli,
        then_cli: thenCli,
        followup: `Then: ${thenCli}`
      },
      next_actions: runtime.unique([
        `instruction=Create and activate a task before using ${action}`,
        `command=${firstCli}`,
        `followup=Then: ${thenCli}`
      ])
    };
  }

  function shouldBlockActionWithHealth(nextContext) {
    return Boolean(
      nextContext &&
      nextContext.next &&
      (nextContext.next.gated_by_health || nextContext.next.command === 'health')
    );
  }

  function buildHealthBlockedActionOutput(action, nextContext) {
    const output = buildActionOutput('health');

    return {
      ...output,
      requested_action: action,
      blocked_action: action,
      workflow_stage: nextContext && nextContext.workflow_stage
        ? nextContext.workflow_stage
        : output.workflow_stage,
      action_card: nextContext && nextContext.action_card
        ? nextContext.action_card
        : output.action_card,
      next_actions: Array.isArray(nextContext && nextContext.next_actions)
        ? nextContext.next_actions
        : output.next_actions,
      next: nextContext && nextContext.next
        ? nextContext.next
        : null
    };
  }

  function rememberDocFiles(files, commandName) {
    updateSession(current => {
      current.last_command = commandName;
      current.last_files = runtime
        .unique([...(files || []), ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
  }

  function handleDocCommands(cmd, subcmd, rest, options) {
    if (cmd === 'doc' && subcmd === 'list') {
      const docs = ingestDocCli.listDocs(resolveProjectRoot());
      updateSession(current => {
        current.last_command = 'doc list';
      });
      return docs;
    }

    if (cmd === 'doc' && subcmd === 'lookup') {
      const result = referenceLookupCli.lookupDocs(resolveProjectRoot(), rest);
      rememberDocFiles(
        (result.candidates || [])
          .filter(item => item && item.fetch_required === false)
          .map(item => item.location),
        'doc lookup'
      );
      return result;
    }

    if (cmd === 'doc' && subcmd === 'fetch') {
      return referenceLookupCli.fetchDocument(resolveProjectRoot(), rest, options).then(result => {
        rememberDocFiles([result.output], 'doc fetch');
        return result;
      });
    }

    if (cmd === 'doc' && subcmd === 'show') {
      const showArgs = ingestDocCli.parseShowArgs(rest);
      const docView = ingestDocCli.showDoc(resolveProjectRoot(), showArgs.docId, {
        preset: showArgs.preset,
        applyReady: showArgs.applyReady
      });
      rememberDocFiles([
        docView.entry.artifacts && docView.entry.artifacts.markdown,
        docView.entry.artifacts && docView.entry.artifacts.metadata,
        docView.entry.artifacts && docView.entry.artifacts.source
      ], 'doc show');
      return docView;
    }

    if (cmd === 'doc' && subcmd === 'diff') {
      if (!rest[0]) throw new Error('Missing doc id');
      const diffArgs = ingestDocCli.parseDiffArgs(['doc', ...rest]);
      const diffView = ingestDocCli.diffDoc(
        resolveProjectRoot(),
        diffArgs.docId,
        diffArgs.to,
        diffArgs.only,
        diffArgs.force
      );
      ingestDocCli.rememberLastDiff(resolveProjectRoot(), diffView);
      rememberDocFiles([diffView.draft, diffView.target], 'doc diff');
      if (!diffArgs.saveAs) {
        return diffView;
      }

      const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
        action_kind: 'write',
        action_name: 'doc-diff-save-preset',
        risk: 'normal',
        explicit_confirmation: diffArgs.explicit_confirmation === true,
        permissions:
          (resolveSession() &&
            resolveSession().project_config &&
            resolveSession().project_config.permissions) || {}
      });
      const blocked = permissionGateHelpers.applyPermissionDecision({
        ...diffView,
        saved_preset: {
          name: diffArgs.saveAs,
          saved: false
        }
      }, permissionDecision);

      if (permissionDecision.decision !== 'allow') {
        return blocked;
      }

      return permissionGateHelpers.applyPermissionDecision({
        ...diffView,
        saved_preset: ingestDocCli.saveDiffPreset(resolveProjectRoot(), diffArgs.saveAs, diffView)
      }, permissionDecision);
    }

    if (cmd === 'component' && subcmd === 'lookup') {
      const result = referenceLookupCli.lookupComponents(resolveProjectRoot(), rest);
      if (result && typeof result.then === 'function') {
        return result.then(resolved => {
          rememberDocFiles(
            (resolved.components || [])
              .map(item => item.parsed_source)
              .filter(Boolean),
            'component lookup'
          );
          return resolved;
        });
      }
      rememberDocFiles(
        (result.components || [])
          .map(item => item.parsed_source)
          .filter(Boolean),
        'component lookup'
      );
      return result;
    }

    return undefined;
  }

  function handleActionCommands(cmd, subcmd, rest) {
    if (cmd === 'scan' && subcmd === 'save') {
      return saveScanReport(rest);
    }

    if (cmd === 'scan') {
      const nextContext = typeof buildNextContext === 'function' ? buildNextContext() : null;
      const activeTask = typeof getActiveTask === 'function' ? getActiveTask() : null;

      if (shouldBlockActionWithHealth(nextContext)) {
        return buildHealthBlockedActionOutput('scan', nextContext);
      }

      const startContext =
        !activeTask && typeof buildStartContext === 'function'
          ? buildStartContext()
          : null;
      if (
        !activeTask &&
        startContext &&
        startContext.immediate &&
        startContext.immediate.command === 'task add <summary>'
      ) {
        return buildTaskIntakeBlockedActionOutput('scan');
      }

      updateSession(current => {
        current.last_command = 'scan';
      });
      return buildActionOutput('scan');
    }

    if (cmd === 'plan' && subcmd === 'save') {
      return savePlanReport(rest);
    }

    if (cmd === 'plan') {
      updateSession(current => {
        current.last_command = 'plan';
      });
      return buildActionOutput('plan');
    }

    if (cmd === 'arch-review') {
      updateSession(current => {
        current.last_command = 'arch-review';
      });
      return buildArchReviewContext();
    }

    if (cmd === 'do') {
      const nextContext = typeof buildNextContext === 'function' ? buildNextContext() : null;
      if (shouldBlockActionWithHealth(nextContext)) {
        updateSession(current => {
          current.last_command = 'do';
        });
        return buildHealthBlockedActionOutput('do', nextContext);
      }

      const activeTask = typeof getActiveTask === 'function' ? getActiveTask() : null;
      if (!activeTask) {
        updateSession(current => {
          current.last_command = 'do';
        });
        return buildTaskIntakeBlockedActionOutput('do');
      }

      updateSession(current => {
        current.last_command = 'do';
      });
      return buildActionOutput('do');
    }

    if (cmd === 'debug') {
      updateSession(current => {
        current.last_command = 'debug';
      });
      return buildActionOutput('debug');
    }

    if (cmd === 'review' && subcmd === 'context') {
      return buildReviewContext();
    }

    if (cmd === 'review' && subcmd === 'axes') {
      return { review_axes: resolveSession().effective.review_axes };
    }

    if (cmd === 'review' && subcmd === 'save') {
      return saveReviewReport(rest);
    }

    if (cmd === 'review' && !subcmd) {
      updateSession(current => {
        current.last_command = 'review';
      });
      return buildActionOutput('review');
    }

    if (cmd === 'verify' && subcmd === 'save') {
      return saveVerifyReport(rest);
    }

    if (cmd === 'verify' && subcmd === 'confirm') {
      return confirmVerifySignoff(rest);
    }

    if (cmd === 'verify' && subcmd === 'reject') {
      return rejectVerifySignoff(rest);
    }

    if (cmd === 'verify') {
      updateSession(current => {
        current.last_command = 'verify';
      });
      return buildActionOutput('verify');
    }

    if (cmd === 'note' && subcmd === 'targets') {
      return { note_targets: resolveSession().effective.note_targets };
    }

    if (cmd === 'note' && subcmd === 'add') {
      return addNoteEntry(rest);
    }

    if (cmd === 'note' && !subcmd) {
      updateSession(current => {
        current.last_command = 'note';
      });
      return buildActionOutput('note');
    }

    return undefined;
  }

  const { handleAdapterToolChipCommands } = adapterToolChipCommandHelpers.createAdapterToolChipCommandHelpers({
    toolCatalog,
    toolRuntime,
    chipCatalog,
    ROOT,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    bootstrapAdapterSource,
    parseAdapterSyncArgs,
    syncNamedAdapterSource,
    syncAllAdapterSources,
    runAdapterDerive,
    runAdapterGenerate,
    runAdapterAnalysisInit,
    runAdapterExport,
    runAdapterPublish
  });

  const {
    handleDispatchCommands,
    executeDispatchCommand,
    executeOrchestratorCommand
  } = dispatchCommandRuntimeHelpers.createDispatchCommandRuntimeHelpers({
    scheduler,
    updateSession,
    resolveSession,
    runSubAgentBridge,
    collectSubAgentBridgeJobs,
    buildDispatchContext,
    buildOrchestratorContext,
    handleCatalogAndStateCommands,
    handleActionCommands,
    handleAdapterToolChipCommands
  });

  return {
    handleDocCommands,
    handleActionCommands,
    handleDispatchCommands,
    handleAdapterToolChipCommands,
    executeDispatchCommand,
    executeOrchestratorCommand
  };
}

module.exports = {
  createCommandGroupHelpers
};
