'use strict';

const outputModeHelpers = require('./output-mode.cjs');

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
    const parsedOutputMode = outputModeHelpers.parseOutputModeArgs(argv || process.argv.slice(2));
    const args = parsedOutputMode.args;

    function emitJson(value) {
      printJson(outputModeHelpers.applyOutputMode(value, parsedOutputMode.brief));
    }

    if (args.length === 0) {
      usage();
      process.exit(0);
    }

    if (args[0] === 'help' || args[0] === '--help') {
      const advanced = args.includes('advanced') || args.includes('--all');
      usage({ advanced });
      process.exit(0);
    }

    const [cmd, subcmd, ...rest] = args;

    if (cmd === 'init') {
      const initialized = runInitCommand(args.slice(1), 'init');
      if (initialized) {
        emitJson(initialized);
      }
      return;
    }

    if (cmd === 'attach') {
      const initialized = runInitCommand(args.slice(1), 'attach');
      if (initialized) {
        initialized.legacy_alias = true;
        emitJson(initialized);
      }
      return;
    }

    if (cmd === 'ingest') {
      emitJson(await runIngestCommand(subcmd, rest));
      return;
    }

    if (cmd === 'declare') {
      if (!subcmd || subcmd === '--help') {
        usage();
        process.exitCode = subcmd ? 1 : 0;
        return;
      }
      if (subcmd !== 'hardware') {
        throw new Error(`Unknown declare domain: ${subcmd}`);
      }
      emitJson(await runIngestCommand('hardware', rest));
      return;
    }

    if (cmd === 'status') {
      emitJson(buildStatus());
      return;
    }

    if (cmd === 'next') {
      const session = updateSession(current => {
        current.last_command = 'next';
      });
      const context = buildNextContext();
      context.current.last_command = session.last_command || '';
      emitJson(context);
      return;
    }

    if (cmd === 'pause' && subcmd === 'show') {
      emitJson(loadHandoff());
      return;
    }

    if (cmd === 'pause' && subcmd === 'clear') {
      clearHandoff();
      const session = updateSession(current => {
        current.last_command = 'pause clear';
        current.paused_at = '';
      });
      emitJson({
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
      emitJson({
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
      emitJson(context);
      return;
    }

    if (cmd === 'resolve') {
      emitJson(resolveSession());
      return;
    }

    if (cmd === 'config' && subcmd === 'show') {
      emitJson(RUNTIME_CONFIG);
      return;
    }

    if (cmd === 'project' && subcmd === 'show') {
      const showArgs = parseProjectShowArgs(rest);
      emitJson(buildProjectShow(showArgs.effective, showArgs.field));
      return;
    }

    if (cmd === 'project' && subcmd === 'set') {
      const setArgs = parseProjectSetArgs(rest);
      emitJson(setProjectConfigValue(setArgs.field, setArgs.value));
      return;
    }

    const stateCommandResult = handleCatalogAndStateCommands(cmd, subcmd, rest);
    if (stateCommandResult !== undefined) {
      emitJson(stateCommandResult);
      return;
    }

    const docCommandResult = handleDocCommands(cmd, subcmd, rest);
    if (docCommandResult !== undefined) {
      emitJson(docCommandResult);
      return;
    }

    const actionCommandResult = handleActionCommands(cmd, subcmd, rest);
    if (actionCommandResult !== undefined) {
      emitJson(actionCommandResult);
      return;
    }

    const dispatchTemplateResult = handleDispatchAndTemplateCommands(cmd, subcmd, rest);
    if (dispatchTemplateResult !== undefined) {
      if (!dispatchTemplateResult.__side_effect_only) {
        emitJson(dispatchTemplateResult);
      }
      return;
    }

    const adapterToolChipResult = handleAdapterToolChipCommands(cmd, subcmd, rest);
    if (adapterToolChipResult !== undefined) {
      emitJson(adapterToolChipResult);
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
