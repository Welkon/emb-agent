'use strict';

function createCliRouter(deps) {
  const {
    process,
    usage,
    printJson,
    runInitCommand,
    runIngestCommand,
    buildStatus,
    updateSession,
    buildNextContext,
    loadHandoff,
    clearHandoff,
    buildPausePayload,
    saveHandoff,
    buildResumeContext,
    resolveSession,
    RUNTIME_CONFIG,
    parseProjectShowArgs,
    buildProjectShow,
    parseProjectSetArgs,
    setProjectConfigValue,
    handleCatalogAndStateCommands,
    handleDocCommands,
    handleActionCommands,
    handleDispatchAndTemplateCommands,
    handleAdapterToolChipCommands
  } = deps;

  async function run(argv) {
    const args = argv || process.argv.slice(2);

    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
      usage();
      process.exit(0);
    }

    const [cmd, subcmd, ...rest] = args;

    if (cmd === 'init') {
      const initialized = runInitCommand(args.slice(1), 'init');
      if (initialized) {
        printJson(initialized);
      }
      return;
    }

    if (cmd === 'attach') {
      const initialized = runInitCommand(args.slice(1), 'attach');
      if (initialized) {
        initialized.legacy_alias = true;
        printJson(initialized);
      }
      return;
    }

    if (cmd === 'ingest') {
      printJson(await runIngestCommand(subcmd, rest));
      return;
    }

    if (cmd === 'status') {
      printJson(buildStatus());
      return;
    }

    if (cmd === 'next') {
      const session = updateSession(current => {
        current.last_command = 'next';
      });
      const context = buildNextContext();
      context.current.last_command = session.last_command || '';
      printJson(context);
      return;
    }

    if (cmd === 'pause' && subcmd === 'show') {
      printJson(loadHandoff());
      return;
    }

    if (cmd === 'pause' && subcmd === 'clear') {
      clearHandoff();
      const session = updateSession(current => {
        current.last_command = 'pause clear';
        current.paused_at = '';
      });
      printJson({
        cleared: true,
        handoff: null,
        session
      });
      return;
    }

    if (cmd === 'pause') {
      const noteText = [subcmd, ...rest].filter(Boolean).join(' ').trim();
      const handoff = buildPausePayload(noteText);
      saveHandoff(handoff);
      const session = updateSession(current => {
        current.last_command = 'pause';
        current.paused_at = handoff.timestamp;
      });
      printJson({
        paused: true,
        handoff,
        session
      });
      return;
    }

    if (cmd === 'resume') {
      const session = updateSession(current => {
        current.last_command = 'resume';
        current.last_resumed_at = new Date().toISOString();
      });
      const context = buildResumeContext();
      context.summary.last_command = session.last_command || '';
      context.summary.last_resumed_at = session.last_resumed_at || '';
      printJson(context);
      return;
    }

    if (cmd === 'resolve') {
      printJson(resolveSession());
      return;
    }

    if (cmd === 'config' && subcmd === 'show') {
      printJson(RUNTIME_CONFIG);
      return;
    }

    if (cmd === 'project' && subcmd === 'show') {
      const showArgs = parseProjectShowArgs(rest);
      printJson(buildProjectShow(showArgs.effective, showArgs.field));
      return;
    }

    if (cmd === 'project' && subcmd === 'set') {
      const setArgs = parseProjectSetArgs(rest);
      printJson(setProjectConfigValue(setArgs.field, setArgs.value));
      return;
    }

    const stateCommandResult = handleCatalogAndStateCommands(cmd, subcmd, rest);
    if (stateCommandResult !== undefined) {
      printJson(stateCommandResult);
      return;
    }

    const docCommandResult = handleDocCommands(cmd, subcmd, rest);
    if (docCommandResult !== undefined) {
      printJson(docCommandResult);
      return;
    }

    const actionCommandResult = handleActionCommands(cmd, subcmd, rest);
    if (actionCommandResult !== undefined) {
      printJson(actionCommandResult);
      return;
    }

    const dispatchTemplateResult = handleDispatchAndTemplateCommands(cmd, subcmd, rest);
    if (dispatchTemplateResult !== undefined) {
      if (!dispatchTemplateResult.__side_effect_only) {
        printJson(dispatchTemplateResult);
      }
      return;
    }

    const adapterToolChipResult = handleAdapterToolChipCommands(cmd, subcmd, rest);
    if (adapterToolChipResult !== undefined) {
      printJson(adapterToolChipResult);
      return;
    }

    usage();
    process.exitCode = 1;
  }

  return {
    run
  };
}

module.exports = {
  createCliRouter
};
