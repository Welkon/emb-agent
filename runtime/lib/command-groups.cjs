'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');
const adapterToolChipCommandHelpers = require('./adapter-tool-chip-commands.cjs');
const dispatchCommandRuntimeHelpers = require('./dispatch-command-runtime.cjs');

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
    updateSession,
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

  function rememberDocFiles(files, commandName) {
    updateSession(current => {
      current.last_command = commandName;
      current.last_files = runtime
        .unique([...(files || []), ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
  }

  function handleDocCommands(cmd, subcmd, rest) {
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
      return referenceLookupCli.fetchDocument(resolveProjectRoot(), rest).then(result => {
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
    runAdapterGenerate
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
