'use strict';

const outputModeHelpers = require('./output-mode.cjs');

function createCliRouter(deps) {
  const {
    process,
    usage,
    printJson,
    runInitCommand,
    buildExternalInitProtocol,
    runIngestCommand,
    buildStartContext,
    buildExternalStartProtocol,
    buildStatus,
    buildExternalStatusProtocol,
    buildExternalHealthProtocol,
    buildBootstrapReport,
    updateSession,
    buildNextContext,
    buildExternalNextProtocol,
    buildExternalDispatchNextProtocol,
    buildDispatchContext,
    executeDispatchCommand,
    executeOrchestratorCommand,
    loadHandoff,
    loadContextSummary,
    clearHandoff,
    clearContextSummary,
    buildPausePayload,
    buildPauseContextSummary,
    maybeAutoExtractOnPause,
    buildCompressContextSummary,
    saveHandoff,
    saveContextSummary,
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
    handleDispatchCommands,
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

    function isDefaultRemoteChipSupportBootstrapStage(stage) {
      return Boolean(
        stage &&
          Array.isArray(stage.argv) &&
          stage.argv[0] === 'support' &&
          stage.argv[1] === 'bootstrap' &&
          stage.argv.length === 2
      );
    }

    function parseBootstrapRunOptions(tokens) {
      const options = {
        confirm: false
      };
      const extras = Array.isArray(tokens) ? tokens : [];

      extras.forEach(token => {
        if (token === '--confirm') {
          options.confirm = true;
          return;
        }

        throw new Error(`Unknown bootstrap run option: ${token}`);
      });

      return options;
    }

    function applyBootstrapRunOptions(stage, options) {
      const nextStage = stage && typeof stage === 'object' && !Array.isArray(stage)
        ? {
            ...stage,
            argv: Array.isArray(stage.argv) ? [...stage.argv] : []
          }
        : stage;
      const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};

      if (!nextStage || !Array.isArray(nextStage.argv) || nextStage.argv.length === 0) {
        return nextStage;
      }

      if (settings.confirm && !nextStage.argv.includes('--confirm')) {
        nextStage.argv.push('--confirm');
      }

      return nextStage;
    }

    function buildBootstrapRunResponse(stage, result) {
      const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      const blocked =
        payload.status === 'permission-pending' || payload.status === 'permission-denied';

      return {
        executed: !blocked,
        ...(blocked ? { reason: payload.status } : {}),
        stage,
        result: payload,
        bootstrap_after: buildBootstrapReport()
      };
    }

    if (cmd === 'init') {
      const initialized = runInitCommand(args.slice(1), 'init');
      if (initialized) {
        emitJson(initialized);
      }
      return;
    }

    if (cmd === 'start') {
      emitJson(buildStartContext());
      return;
    }

    if (cmd === 'external') {
      if (!subcmd || subcmd === '--help') {
        usage({ advanced: true });
        return;
      }

      if (subcmd === 'start') {
        emitJson(buildExternalStartProtocol());
        return;
      }

      if (subcmd === 'status') {
        emitJson(buildExternalStatusProtocol());
        return;
      }

      if (subcmd === 'health') {
        emitJson(buildExternalHealthProtocol());
        return;
      }

      if (subcmd === 'next') {
        const session = updateSession(current => {
          current.last_command = 'next';
        });
        const protocol = buildExternalNextProtocol();
        if (protocol && protocol.next) {
          protocol.next.last_command = session.last_command || '';
        }
        emitJson(protocol);
        return;
      }

      if (subcmd === 'dispatch-next') {
        emitJson(buildExternalDispatchNextProtocol());
        return;
      }

      if (subcmd === 'init') {
        const protocol = buildExternalInitProtocol(rest, 'init');
        if (protocol) {
          emitJson(protocol);
        }
        return;
      }

      usage({ advanced: true });
      process.exitCode = 1;
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

    if (cmd === 'bootstrap') {
      if (!subcmd || subcmd === 'show') {
        updateSession(current => {
          current.last_command = 'bootstrap';
        });
        emitJson(buildBootstrapReport());
        return;
      }

      if (subcmd === 'run') {
        const bootstrap = buildBootstrapReport();
        const runOptions = parseBootstrapRunOptions(rest);
        const stage = applyBootstrapRunOptions(bootstrap.next_stage || null, runOptions);

        if (!stage) {
          emitJson({
            executed: false,
            reason: 'bootstrap-complete',
            bootstrap
          });
          return;
        }

        if (stage.manual || !Array.isArray(stage.argv) || stage.argv.length === 0) {
          emitJson({
            executed: false,
            reason: stage.manual ? 'manual-stage' : 'no-executable-stage',
            stage,
            bootstrap
          });
          return;
        }

        if (isDefaultRemoteChipSupportBootstrapStage(stage)) {
          emitJson({
            executed: false,
            reason: 'network-bootstrap-required',
            summary: 'Default chip support install requires an explicit source or manual network-enabled execution',
            stage,
            bootstrap
          });
          return;
        }

        if (stage.argv[0] === 'init') {
          const initialized = runInitCommand(stage.argv.slice(1), 'init');
          emitJson(buildBootstrapRunResponse(stage, initialized));
          return;
        }

        if (stage.argv[0] === 'ingest' && stage.argv[1] === 'apply') {
          const applied = await runIngestCommand('apply', stage.argv.slice(2));
          emitJson(buildBootstrapRunResponse(stage, applied));
          return;
        }

        if (stage.argv[0] === 'support' || stage.argv[0] === 'tool') {
          const result = handleAdapterToolChipCommands(stage.argv[0], stage.argv[1], stage.argv.slice(2));
          emitJson(buildBootstrapRunResponse(stage, result));
          return;
        }

        if (stage.argv[0] === 'next') {
          emitJson({
            executed: true,
            stage,
            result: executeDispatchCommand('next', { entered_via: 'bootstrap run' }),
            bootstrap_after: buildBootstrapReport()
          });
          return;
        }

        if (stage.argv[0] === 'resume') {
          const session = updateSession(current => {
            current.last_command = 'resume';
            current.last_resumed_at = new Date().toISOString();
          });
          const context = buildResumeContext();
          context.summary.last_command = session.last_command || '';
          context.summary.last_resumed_at = session.last_resumed_at || '';
          emitJson({
            executed: true,
            stage,
            result: context,
            bootstrap_after: buildBootstrapReport()
          });
          return;
        }

        emitJson({
          executed: false,
          reason: 'unsupported-stage-runner',
          stage,
          bootstrap
        });
        return;
      }

      usage();
      process.exitCode = 1;
      return;
    }

    if (cmd === 'next') {
      if (subcmd === 'run') {
        emitJson(executeDispatchCommand('next', { entered_via: 'next run' }));
        return;
      }

      if (subcmd === '--help') {
        usage();
        return;
      }

      if (subcmd) {
        usage();
        process.exitCode = 1;
        return;
      }

      const context = buildNextContext();
      const session = updateSession(current => {
        current.last_command = 'next';
      });
      context.current.last_command = session.last_command || '';
      emitJson(context);
      return;
    }

    if (cmd === 'pause' && subcmd === 'show') {
      emitJson(loadHandoff());
      return;
    }

    if (cmd === 'context' && subcmd === 'show') {
      emitJson(loadContextSummary());
      return;
    }

    if (cmd === 'context' && subcmd === 'clear') {
      clearContextSummary();
      const session = updateSession(current => {
        current.last_command = 'context clear';
      });
      emitJson({
        cleared: true,
        memory_summary: null,
        session
      });
      return;
    }

    if (cmd === 'context' && subcmd === 'compress') {
      const noteText = rest.join(' ').trim();
      const summary = buildCompressContextSummary(noteText);
      saveContextSummary(summary);
      const session = updateSession(current => {
        current.last_command = 'context compress';
      });
      emitJson({
        compressed: true,
        memory_summary: summary,
        session
      });
      return;
    }

    if (cmd === 'pause' && subcmd === 'clear') {
      clearHandoff();
      clearContextSummary();
      const session = updateSession(current => {
        current.last_command = 'pause clear';
        current.paused_at = '';
      });
      emitJson({
        cleared: true,
        handoff: null,
        memory_summary: null,
        session
      });
      return;
    }

    if (cmd === 'pause') {
      const noteText = [subcmd, ...rest].filter(Boolean).join(' ').trim();
      const pausedContext = buildPauseContextSummary
        ? buildPauseContextSummary(noteText)
        : {
            handoff: buildPausePayload(noteText),
            summary: null
          };
      const handoff = pausedContext.handoff;
      saveHandoff(handoff);
      if (pausedContext.summary) {
        saveContextSummary(pausedContext.summary);
      }
      const session = updateSession(current => {
        current.last_command = 'pause';
        current.paused_at = handoff.timestamp;
      });
      const autoMemory = typeof maybeAutoExtractOnPause === 'function'
        ? maybeAutoExtractOnPause(noteText)
        : null;
      emitJson({
        paused: true,
        handoff,
        memory_summary: pausedContext.summary,
        auto_memory: autoMemory,
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
      emitJson(setProjectConfigValue(setArgs.field, setArgs.value, {
        explicit_confirmation: setArgs.explicit_confirmation
      }));
      return;
    }

    const stateCommandResult = handleCatalogAndStateCommands(cmd, subcmd, rest);
    if (stateCommandResult !== undefined) {
      emitJson(stateCommandResult);
      return;
    }

    const docCommandResult = handleDocCommands(cmd, subcmd, rest);
    if (docCommandResult !== undefined) {
      const resolvedDocCommandResult =
        docCommandResult && typeof docCommandResult.then === 'function'
          ? await docCommandResult
          : docCommandResult;
      emitJson(resolvedDocCommandResult);
      return;
    }

    const actionCommandResult = handleActionCommands(cmd, subcmd, rest);
    if (actionCommandResult !== undefined) {
      emitJson(actionCommandResult);
      return;
    }

    const dispatchResult = handleDispatchCommands(cmd, subcmd, rest);
    if (dispatchResult !== undefined) {
      if (!dispatchResult.__side_effect_only) {
        emitJson(dispatchResult);
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
