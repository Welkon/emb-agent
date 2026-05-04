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
    executeCapability,
    buildReviewContext,
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
    handleCapabilityCommands,
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
      return Promise.resolve(result).then(resolved => {
        rememberDocFiles(
          (resolved.candidates || [])
            .filter(item => item && item.fetch_required === false)
            .map(item => item.location),
          'doc lookup'
        );
        return resolved;
      });
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

    if (cmd === 'schematic') {
      const subject = subcmd || 'summary';
      const result = referenceLookupCli.querySchematic(resolveProjectRoot(), subject, rest);
      rememberDocFiles(
        [
          result && result.scope && result.scope.parsed,
          result && result.scope && result.scope.source_schematic
        ].filter(Boolean),
        `schematic ${subject}`
      );
      return result;
    }

    if (cmd === 'board') {
      const subject = subcmd || 'summary';
      const result = referenceLookupCli.queryBoard(resolveProjectRoot(), subject, rest);
      rememberDocFiles(
        [
          result && result.scope && result.scope.parsed,
          result && result.scope && result.scope.source_board
        ].filter(Boolean),
        `board ${subject}`
      );
      return result;
    }

    return undefined;
  }

  function handleActionCommands(cmd, subcmd, rest) {
    if (cmd === 'capability') {
      return typeof handleCapabilityCommands === 'function'
        ? handleCapabilityCommands(cmd, subcmd, rest)
        : undefined;
    }

    if (cmd === 'scan' && subcmd === 'save') {
      return saveScanReport(rest);
    }

    if (cmd === 'plan' && subcmd === 'save') {
      return savePlanReport(rest);
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

    if (cmd === 'verify' && subcmd === 'save') {
      return saveVerifyReport(rest);
    }

    if (cmd === 'verify' && subcmd === 'confirm') {
      return confirmVerifySignoff(rest);
    }

    if (cmd === 'verify' && subcmd === 'reject') {
      return rejectVerifySignoff(rest);
    }

    if (cmd === 'note' && subcmd === 'targets') {
      return { note_targets: resolveSession().effective.note_targets };
    }

    if (cmd === 'note' && subcmd === 'add') {
      return addNoteEntry(rest);
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
    executeCapability,
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
