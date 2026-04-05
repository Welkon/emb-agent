'use strict';

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
    buildActionOutput,
    buildReviewContext,
    buildArchReviewContext,
    buildDispatchContext,
    buildOrchestratorContext,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    parseAdapterSyncArgs,
    syncNamedAdapterSource,
    syncAllAdapterSources,
    saveScanReport,
    savePlanReport,
    saveReviewReport,
    addNoteEntry,
    runTemplateScript,
    ingestDocCli
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
      const savedPreset = diffArgs.saveAs
        ? ingestDocCli.saveDiffPreset(resolveProjectRoot(), diffArgs.saveAs, diffView)
        : null;
      rememberDocFiles([diffView.draft, diffView.target], 'doc diff');
      return savedPreset ? { ...diffView, saved_preset: savedPreset } : diffView;
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

  function handleDispatchAndTemplateCommands(cmd, subcmd, rest) {
    if (cmd === 'schedule' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return scheduler.buildSchedule(rest[0], resolveSession());
    }

    if (cmd === 'dispatch' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return buildDispatchContext(rest[0]);
    }

    if (cmd === 'dispatch' && subcmd === 'next') {
      return buildDispatchContext('next');
    }

    if (cmd === 'orchestrate' && (!subcmd || subcmd === 'next')) {
      return buildOrchestratorContext('next');
    }

    if (cmd === 'orchestrate' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing action name');
      return buildOrchestratorContext(rest[0]);
    }

    if (cmd === 'orchestrate' && ['scan', 'plan', 'do', 'debug', 'review', 'note', 'arch-review'].includes(subcmd)) {
      return buildOrchestratorContext(subcmd);
    }

    if (cmd === 'template' && subcmd === 'list') {
      runTemplateScript(['list']);
      return { __side_effect_only: true };
    }

    if (cmd === 'template' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing template name');
      runTemplateScript(['show', rest[0]]);
      return { __side_effect_only: true };
    }

    if (cmd === 'template' && subcmd === 'fill') {
      if (!rest[0]) throw new Error('Missing template name');
      runTemplateScript(['fill', rest[0], ...rest.slice(1)]);
      return { __side_effect_only: true };
    }

    return undefined;
  }

  function handleAdapterToolChipCommands(cmd, subcmd, rest) {
    if (cmd === 'adapter' && subcmd === 'status') {
      return buildAdapterStatus(rest[0] || '');
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'list') {
      return buildAdapterStatus();
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing source name');
      return buildAdapterStatus(rest[1]);
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'add') {
      if (!rest[1]) throw new Error('Missing source name');
      return addAdapterSource(rest[1], rest.slice(2));
    }

    if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'remove') {
      if (!rest[1]) throw new Error('Missing source name');
      return removeAdapterSource(rest[1]);
    }

    if (cmd === 'adapter' && subcmd === 'sync') {
      if (rest[0] === '--all') {
        const parsedAll = parseAdapterSyncArgs(rest);
        return syncAllAdapterSources(parsedAll);
      }

      if (!rest[0] || rest[0].startsWith('--')) {
        throw new Error('Missing source name');
      }

      return syncNamedAdapterSource(rest[0], parseAdapterSyncArgs(rest.slice(1)));
    }

    if (cmd === 'tool' && subcmd === 'list') {
      return toolCatalog.listToolSpecs(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing tool name');
      return toolCatalog.loadToolSpec(ROOT, rest[0]);
    }

    if (cmd === 'tool' && subcmd === 'run') {
      if (!rest[0]) throw new Error('Missing tool name');
      return toolRuntime.runTool(ROOT, rest[0], rest.slice(1));
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'list') {
      return toolCatalog.listFamilies(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing family name');
      return toolCatalog.loadFamily(ROOT, rest[1]);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'list') {
      return toolCatalog.listDevices(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing device name');
      return toolCatalog.loadDevice(ROOT, rest[1]);
    }

    if (cmd === 'chip' && subcmd === 'list') {
      return chipCatalog.listChips(ROOT);
    }

    if (cmd === 'chip' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing chip name');
      return chipCatalog.loadChip(ROOT, rest[0]);
    }

    return undefined;
  }

  return {
    handleDocCommands,
    handleActionCommands,
    handleDispatchAndTemplateCommands,
    handleAdapterToolChipCommands
  };
}

module.exports = {
  createCommandGroupHelpers
};
