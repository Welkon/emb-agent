'use strict';

const outputModeHelpers = require('./output-mode.cjs');
const runtimeEventHelpers = require('./runtime-events.cjs');
const terminalUiHelpers = require('./terminal-ui.cjs');

function createCliRouter(deps) {
  const {
    process,
    usage,
    buildUsagePayload,
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
    const terminalUi = terminalUiHelpers.createTerminalUi({
      process,
      enabled: parsedOutputMode.json !== true
    });

    function emitJson(value) {
      printJson(outputModeHelpers.applyOutputMode(value, parsedOutputMode.brief));
    }

    function buildOperationText(cmd, subcmd, rest) {
      const scope = [cmd, subcmd].filter(Boolean).join(' ');

      if (cmd === 'init' || cmd === 'attach') {
        return 'Initializing emb-agent project';
      }
      if (cmd === 'ingest' && subcmd === 'doc') {
        return 'Parsing document and updating cache';
      }
      if (cmd === 'ingest' && subcmd === 'apply') {
        return 'Applying parsed document facts';
      }
      if (cmd === 'ingest' && subcmd === 'schematic') {
        return 'Ingesting schematic artifacts';
      }
      if (cmd === 'doc' && subcmd === 'fetch') {
        return 'Downloading remote document';
      }
      if (cmd === 'status') {
        return 'Inspecting current emb-agent session';
      }
      if (cmd === 'bootstrap' && (!subcmd || subcmd === 'show')) {
        return 'Inspecting bootstrap state';
      }
      if (cmd === 'bootstrap' && subcmd === 'run') {
        return 'Running the bootstrap next stage';
      }
      if (cmd === 'next' && !subcmd) {
        return 'Resolving the recommended next stage';
      }
      if (cmd === 'next' && subcmd === 'run') {
        return 'Entering the recommended next stage';
      }
      if (['scan', 'plan', 'do', 'debug', 'review', 'verify'].includes(cmd) && !subcmd) {
        return `Preparing ${cmd} action context`;
      }
      if (cmd === 'executor' && subcmd === 'run') {
        return `Running executor ${rest[0] || ''}`.trim();
      }
      if (cmd === 'tool' && subcmd === 'run') {
        return `Running tool ${rest[0] || ''}`.trim();
      }
      if (cmd === 'support' && subcmd === 'sync') {
        return rest[0] === '--all'
          ? 'Synchronizing all chip support sources'
          : `Synchronizing chip support source ${rest[0] || ''}`.trim();
      }
      if (cmd === 'support' && subcmd === 'bootstrap') {
        return 'Bootstrapping chip support source';
      }
      if (cmd === 'support' && (subcmd === 'derive' || subcmd === 'generate')) {
        return `Generating chip support artifacts via ${scope}`;
      }

      return scope ? `Running ${scope}` : 'Running emb-agent command';
    }

    function pushActionCardLines(lines, actionCard) {
      const card = actionCard && typeof actionCard === 'object' && !Array.isArray(actionCard) ? actionCard : {};

      if (card.stage) {
        lines.push(terminalUi.renderKeyValue('Stage', card.stage, 'info'));
      }
      if (card.action) {
        lines.push(terminalUi.renderKeyValue('Action', card.action, 'success'));
      }
      if (card.summary) {
        lines.push(terminalUi.renderKeyValue('Summary', card.summary, 'muted'));
      }
      if (card.first_instruction) {
        lines.push(terminalUi.renderKeyValue('First', card.first_instruction, 'muted'));
      }
      if (card.first_cli) {
        lines.push(terminalUi.renderKeyValue('CLI', card.first_cli, 'success'));
      }
      if (card.then_cli) {
        lines.push(terminalUi.renderKeyValue('Then', card.then_cli, 'muted'));
      }
    }

    function pushNextActions(lines, actions) {
      const items = Array.isArray(actions) ? actions.filter(Boolean) : [];
      if (items[0]) {
        lines.push(terminalUi.renderKeyValue('Hint', items[0], 'muted'));
      }
      if (items[1]) {
        lines.push(terminalUi.renderKeyValue('Next Hint', items[1], 'muted'));
      }
    }

    function resolveRuntimeEventsTone(status) {
      if (status === 'blocked' || status === 'failed') {
        return 'error';
      }
      if (status === 'pending') {
        return 'warning';
      }
      if (status === 'ok') {
        return 'success';
      }
      return 'muted';
    }

    function formatRuntimeEventsSummary(summary) {
      if (!summary || typeof summary !== 'object' || summary.total < 1) {
        return '';
      }

      const detailItems = Array.isArray(summary.types) && summary.types.length > 0
        ? summary.types
        : Array.isArray(summary.categories) && summary.categories.length > 0
          ? summary.categories
          : Array.isArray(summary.summaries)
            ? summary.summaries
            : [];
      const visibleDetails = detailItems.slice(0, 2);
      const overflow = detailItems.length > visibleDetails.length ? ', ...' : '';
      const detailText = visibleDetails.length > 0 ? ` (${visibleDetails.join(', ')}${overflow})` : '';

      return `${summary.status} / ${summary.total}${detailText}`;
    }

    function appendRuntimeEventsSummary(lines, payload) {
      const summary = runtimeEventHelpers.summarizeRuntimeEvents(payload && payload.runtime_events);
      const text = formatRuntimeEventsSummary(summary);
      if (!text) {
        return lines;
      }

      lines.push(terminalUi.renderKeyValue('Events', text, resolveRuntimeEventsTone(summary.status)));
      return lines;
    }

    function buildSummaryLines(cmd, subcmd, result) {
      const lines = [];
      const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      const nestedActionCard =
        payload.action_card ||
        (payload.action_context && payload.action_context.action_card) ||
        (payload.bootstrap_after && payload.bootstrap_after.action_card) ||
        (payload.result && payload.result.action_context && payload.result.action_context.action_card) ||
        null;

      if ((cmd === 'init' || cmd === 'attach') && payload.project_root) {
        lines.push(terminalUi.renderKeyValue('Project', payload.project_root, 'info'));
        if (payload.bootstrap && payload.bootstrap.status) {
          lines.push(terminalUi.renderKeyValue('Bootstrap', payload.bootstrap.status, 'success'));
        }
        if (Array.isArray(payload.created) && payload.created.length > 0) {
          lines.push(terminalUi.renderKeyValue('Created', String(payload.created.length), 'success'));
        }
        if (Array.isArray(payload.reused) && payload.reused.length > 0) {
          lines.push(terminalUi.renderKeyValue('Reused', String(payload.reused.length), 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'status') {
        if (payload.project_root) {
          lines.push(terminalUi.renderKeyValue('Project', payload.project_root, 'info'));
        }
        if (payload.active_task && payload.active_task.name) {
          lines.push(terminalUi.renderKeyValue('Task', payload.active_task.name, 'success'));
        }
        if (payload.focus) {
          lines.push(terminalUi.renderKeyValue('Focus', payload.focus, 'muted'));
        }
        if (payload.context_hygiene && payload.context_hygiene.recommendation) {
          lines.push(terminalUi.renderKeyValue('Context', payload.context_hygiene.recommendation, 'muted'));
        }
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'bootstrap' && (!subcmd || subcmd === 'show')) {
        lines.push(terminalUi.renderKeyValue('Status', payload.display_status || payload.status, 'success'));
        lines.push(terminalUi.renderKeyValue('Current', payload.display_current_stage || payload.current_stage, 'info'));
        if (payload.next_stage && payload.next_stage.label) {
          lines.push(terminalUi.renderKeyValue('Next Stage', payload.next_stage.label, 'success'));
        }
        pushActionCardLines(lines, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'bootstrap' && subcmd === 'run') {
        lines.push(
          terminalUi.renderKeyValue(
            'Executed',
            payload.executed === false ? 'no' : 'yes',
            payload.executed === false ? 'warning' : 'success'
          )
        );
        if (payload.stage && payload.stage.label) {
          lines.push(terminalUi.renderKeyValue('Stage', payload.stage.label, 'info'));
        }
        if (payload.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', payload.reason, 'warning'));
        }
        if (payload.result && payload.result.resolved_action) {
          lines.push(terminalUi.renderKeyValue('Resolved', payload.result.resolved_action, 'success'));
        }
        pushActionCardLines(lines, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'next' && !subcmd) {
        if (payload.workflow_stage && payload.workflow_stage.name) {
          lines.push(terminalUi.renderKeyValue('Workflow', payload.workflow_stage.name, 'info'));
        }
        if (payload.next && payload.next.command) {
          lines.push(terminalUi.renderKeyValue('Next', payload.next.command, 'success'));
        }
        if (payload.next && payload.next.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', payload.next.reason, 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'next' && subcmd === 'run') {
        if (payload.resolved_action) {
          lines.push(terminalUi.renderKeyValue('Resolved', payload.resolved_action, 'success'));
        }
        if (payload.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', payload.reason, 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'ingest' && payload.domain === 'doc') {
        lines.push(terminalUi.renderKeyValue('Doc', payload.doc_id || payload.title, 'info'));
        lines.push(terminalUi.renderKeyValue('Provider', payload.provider, 'muted'));
        if (payload.cached === true) {
          lines.push(terminalUi.renderKeyValue('Cache', 'hit', 'success'));
        }
        if (payload.cache_dir) {
          lines.push(terminalUi.renderKeyValue('Cache Dir', payload.cache_dir, 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'ingest' && subcmd === 'apply') {
        lines.push(terminalUi.renderKeyValue('Apply', payload.doc_id || payload.domain, 'info'));
        if (payload.to) {
          lines.push(terminalUi.renderKeyValue('Target', payload.to, 'success'));
        }
        if (Array.isArray(payload.applied_fields) && payload.applied_fields.length > 0) {
          lines.push(terminalUi.renderKeyValue('Fields', payload.applied_fields.join(', '), 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'support' && subcmd === 'sync') {
        if (Array.isArray(payload.results)) {
          const synced = payload.results.filter(item => item.status === 'synced').length;
          const skipped = payload.results.filter(item => item.status === 'skipped').length;
          lines.push(terminalUi.renderKeyValue('Target', payload.target, 'info'));
          lines.push(terminalUi.renderKeyValue('Sources', String(payload.results.length), 'success'));
          lines.push(terminalUi.renderKeyValue('Synced', String(synced), 'success'));
          if (skipped > 0) {
            lines.push(terminalUi.renderKeyValue('Skipped', String(skipped), 'warning'));
          }
          return appendRuntimeEventsSummary(lines, payload);
        }

        lines.push(terminalUi.renderKeyValue('Source', payload.name, 'info'));
        lines.push(terminalUi.renderKeyValue('Target', payload.target, 'success'));
        lines.push(terminalUi.renderKeyValue('Status', payload.status, payload.status === 'synced' ? 'success' : 'warning'));
        if (Array.isArray(payload.files)) {
          lines.push(terminalUi.renderKeyValue('Files', String(payload.files.length), 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'support' && subcmd === 'bootstrap') {
        if (payload.source && payload.source.name) {
          lines.push(terminalUi.renderKeyValue('Source', payload.source.name, 'info'));
        }
        if (payload.sync && payload.sync.status) {
          lines.push(terminalUi.renderKeyValue('Sync', payload.sync.status, 'success'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'doc' && subcmd === 'fetch') {
        lines.push(terminalUi.renderKeyValue('Output', payload.output, 'success'));
        if (payload.url) {
          lines.push(terminalUi.renderKeyValue('URL', payload.url, 'muted'));
        }
        if (typeof payload.size_bytes === 'number') {
          lines.push(terminalUi.renderKeyValue('Bytes', String(payload.size_bytes), 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'scan' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Files', String((payload.relevant_files || []).length), 'info'));
        lines.push(terminalUi.renderKeyValue('Questions', String((payload.open_questions || []).length), 'success'));
        if (Array.isArray(payload.next_reads) && payload.next_reads.length > 0) {
          lines.push(terminalUi.renderKeyValue('Read Next', payload.next_reads[0], 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'plan' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Goal', payload.goal, 'info'));
        lines.push(terminalUi.renderKeyValue('Steps', String((payload.steps || []).length), 'success'));
        if (Array.isArray(payload.verification) && payload.verification.length > 0) {
          lines.push(terminalUi.renderKeyValue('Verify', payload.verification[0], 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'do' && !subcmd) {
        if (payload.chosen_agent) {
          lines.push(terminalUi.renderKeyValue('Agent', payload.chosen_agent, 'info'));
        }
        lines.push(terminalUi.renderKeyValue('Checks', String((payload.safety_checks || []).length), 'success'));
        if (payload.execution_brief && Array.isArray(payload.execution_brief.suggested_steps) && payload.execution_brief.suggested_steps.length > 0) {
          lines.push(terminalUi.renderKeyValue('Execute', payload.execution_brief.suggested_steps[0], 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'debug' && !subcmd) {
        if (payload.chosen_agent) {
          lines.push(terminalUi.renderKeyValue('Agent', payload.chosen_agent, 'info'));
        }
        lines.push(terminalUi.renderKeyValue('Hypotheses', String((payload.hypotheses || []).length), 'success'));
        if (payload.next_step) {
          lines.push(terminalUi.renderKeyValue('Next Step', payload.next_step, 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'review' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Axes', String((payload.axes || []).length), 'info'));
        lines.push(terminalUi.renderKeyValue('Checks', String((payload.required_checks || []).length), 'success'));
        if (Array.isArray(payload.review_agents) && payload.review_agents.length > 0) {
          lines.push(terminalUi.renderKeyValue('Reviewers', payload.review_agents.join(', '), 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'verify' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Checklist', String((payload.checklist || []).length), 'info'));
        if (payload.closure_status) {
          lines.push(terminalUi.renderKeyValue('Closure', payload.closure_status, 'success'));
        }
        if (payload.next_step) {
          lines.push(terminalUi.renderKeyValue('Next Step', payload.next_step, 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'executor' && subcmd === 'run') {
        lines.push(terminalUi.renderKeyValue('Executor', payload.executor, 'info'));
        lines.push(
          terminalUi.renderKeyValue(
            'Status',
            payload.status,
            payload.status === 'ok' ? 'success' : payload.status === 'failed' || payload.status === 'error' ? 'error' : 'warning'
          )
        );
        if (typeof payload.exit_code === 'number') {
          lines.push(
            terminalUi.renderKeyValue(
              'Exit',
              String(payload.exit_code),
              payload.exit_code === 0 ? 'success' : 'error'
            )
          );
        }
        if (typeof payload.duration_ms === 'number') {
          lines.push(terminalUi.renderKeyValue('Duration', `${payload.duration_ms} ms`, 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'tool' && subcmd === 'run') {
        lines.push(terminalUi.renderKeyValue('Tool', payload.tool, 'info'));
        if (payload.status) {
          lines.push(
            terminalUi.renderKeyValue(
              'Status',
              payload.status,
              payload.status === 'ok' ? 'success' : payload.status === 'failed' || payload.status === 'error' ? 'error' : 'warning'
            )
          );
        }
        if (payload.implementation) {
          lines.push(terminalUi.renderKeyValue('Implementation', payload.implementation, 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      return appendRuntimeEventsSummary(lines, payload);
    }

    function buildIngestProgressBridge(activity) {
      return {
        emit(event, payload) {
          if (!activity) {
            return;
          }

          if (event === 'doc-cache-hit') {
            activity.update('Document cache hit, loading parsed artifacts');
            return;
          }
          if (event === 'doc-parse-start') {
            activity.update(`Parsing document with ${payload && payload.provider ? payload.provider : 'provider'}`);
            return;
          }
          if (event === 'doc-parse-finished') {
            activity.update('Persisting parsed document artifacts');
            return;
          }
          if (event === 'doc-cache-write') {
            activity.update('Writing document cache and draft facts');
            return;
          }
          if (event === 'doc-index-update') {
            activity.update('Updating document index');
            return;
          }
          if (event === 'doc-apply-start') {
            activity.update(`Applying document facts to ${payload && payload.to ? payload.to : 'target'}`);
          }
        }
      };
    }

    function buildDocCommandProgressBridge(activity) {
      return {
        emit(event, payload) {
          if (!activity) {
            return;
          }

          if (event === 'doc-fetch-start') {
            activity.update(`Fetching ${payload && payload.url ? payload.url : 'remote document'}`);
            return;
          }
          if (event === 'doc-fetch-response') {
            activity.update('Response received, streaming document to disk');
            return;
          }
          if (event === 'doc-fetch-write') {
            activity.update(`Writing ${payload && payload.output ? payload.output : 'downloaded file'}`);
            return;
          }
          if (event === 'doc-fetch-finished') {
            activity.update(`Saved ${payload && payload.output ? payload.output : 'document'}`);
          }
        }
      };
    }

    function resolveUiOutcome(meta, result) {
      const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : {};

      if (meta.cmd === 'executor' && meta.subcmd === 'run') {
        if (payload.status === 'ok') {
          return { kind: 'succeed', text: meta.success_text || meta.text };
        }
        if (payload.status === 'failed' || payload.status === 'error') {
          return {
            kind: 'fail',
            text: `${meta.failure_text || meta.text}${typeof payload.exit_code === 'number' ? ` (exit ${payload.exit_code})` : ''}`
          };
        }
        return { kind: 'warn', text: meta.success_text || meta.text };
      }

      if (meta.cmd === 'tool' && meta.subcmd === 'run') {
        if (payload.status === 'ok') {
          return { kind: 'succeed', text: meta.success_text || meta.text };
        }
        if (payload.status === 'failed' || payload.status === 'error') {
          return { kind: 'fail', text: meta.failure_text || meta.text };
        }
        return { kind: 'warn', text: `${meta.success_text || meta.text} (${payload.status || 'partial'})` };
      }

      return { kind: 'succeed', text: meta.success_text || meta.text };
    }

    function runWithTerminalUi(meta, handler) {
      const useActivity = !(meta && meta.activity === false);
      const activity = useActivity ? terminalUi.createActivity(meta.text) : null;
      try {
        const result = handler(activity);
        if (result && typeof result.then === 'function') {
          return result
            .then(resolved => {
              const outcome = resolveUiOutcome(meta, resolved);
              if (activity) {
                if (outcome.kind === 'fail') {
                  activity.fail(outcome.text);
                } else if (outcome.kind === 'warn') {
                  activity.warn(outcome.text);
                } else {
                  activity.succeed(outcome.text);
                }
              } else {
                if (outcome.kind === 'fail') {
                  terminalUi.error(outcome.text);
                } else if (outcome.kind === 'warn') {
                  terminalUi.warn(outcome.text);
                } else {
                  terminalUi.info(outcome.text);
                }
              }
              terminalUi.renderSummary(buildSummaryLines(meta.cmd, meta.subcmd, resolved));
              return resolved;
            })
            .catch(error => {
              if (activity) {
                activity.fail(meta.failure_text || meta.text, error);
              } else {
                terminalUi.error(`${meta.failure_text || meta.text}: ${error.message}`);
              }
              throw error;
            });
        }

        const outcome = resolveUiOutcome(meta, result);
        if (activity) {
          if (outcome.kind === 'fail') {
            activity.fail(outcome.text);
          } else if (outcome.kind === 'warn') {
            activity.warn(outcome.text);
          } else {
            activity.succeed(outcome.text);
          }
        } else {
          if (outcome.kind === 'fail') {
            terminalUi.error(outcome.text);
          } else if (outcome.kind === 'warn') {
            terminalUi.warn(outcome.text);
          } else {
            terminalUi.info(outcome.text);
          }
        }
        terminalUi.renderSummary(buildSummaryLines(meta.cmd, meta.subcmd, result));
        return result;
      } catch (error) {
        if (activity) {
          activity.fail(meta.failure_text || meta.text, error);
        } else {
          terminalUi.error(`${meta.failure_text || meta.text}: ${error.message}`);
        }
        throw error;
      }
    }

    function emitUsage(options) {
      const settings = options && typeof options === 'object' && !Array.isArray(options)
        ? options
        : {};
      if (parsedOutputMode.json) {
        emitJson({
          ...buildUsagePayload({
            advanced: settings.advanced
          }),
          status: settings.status || 'ok',
          error:
            settings.error && typeof settings.error === 'object' && !Array.isArray(settings.error)
              ? settings.error
              : null
        });
        return;
      }

      usage({
        advanced: settings.advanced
      });
    }

    if (args.length === 0) {
      emitUsage();
      process.exit(0);
    }

    if (args[0] === 'help' || args[0] === '--help') {
      const advanced = args.includes('advanced') || args.includes('--all');
      emitUsage({ advanced });
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
      const initialized = runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'emb-agent project is ready',
        failure_text: 'emb-agent init failed'
      }, () => runInitCommand(args.slice(1), 'init'));
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
        emitUsage({
          advanced: true,
          ...(subcmd
            ? {}
            : {
                status: 'error',
                error: {
                  code: 'missing-subcommand',
                  message: 'external requires a subcommand',
                  command: 'external'
                }
              })
        });
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
        updateSession(current => {
          current.last_command = 'next';
        });
        emitJson(buildExternalNextProtocol());
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

      emitUsage({
        advanced: true,
        status: 'error',
        error: {
          code: 'unknown-subcommand',
          message: `Unknown external subcommand: ${subcmd}`,
          command: `external ${subcmd}`
        }
      });
      process.exitCode = 1;
      return;
    }

    if (cmd === 'attach') {
      const initialized = runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'emb-agent project is attached',
        failure_text: 'emb-agent attach failed'
      }, () => runInitCommand(args.slice(1), 'attach'));
      if (initialized) {
        initialized.legacy_alias = true;
        emitJson(initialized);
      }
      return;
    }

    if (cmd === 'ingest') {
      emitJson(await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `ingest ${subcmd || ''}`.trim() + ' completed',
        failure_text: `ingest ${subcmd || ''}`.trim() + ' failed'
      }, activity => runIngestCommand(subcmd, rest, {
        ui: buildIngestProgressBridge(activity)
      })));
      return;
    }

    if (cmd === 'declare') {
      if (!subcmd || subcmd === '--help') {
        emitUsage({
          ...(subcmd
            ? {}
            : {
                status: 'error',
                error: {
                  code: 'missing-subcommand',
                  message: 'declare requires a domain',
                  command: 'declare'
                }
              })
        });
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
      emitJson(runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'status updated',
        failure_text: 'status inspection failed',
        activity: false
      }, () => buildStatus()));
      return;
    }

    if (cmd === 'bootstrap') {
      if (!subcmd || subcmd === 'show') {
        emitJson(runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, subcmd, rest),
          success_text: 'bootstrap state updated',
          failure_text: 'bootstrap inspection failed',
          activity: false
        }, () => {
          updateSession(current => {
            current.last_command = 'bootstrap';
          });
          return buildBootstrapReport();
        }));
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

        emitJson(await runWithTerminalUi({
          cmd,
          subcmd,
          text: stage.label ? `Bootstrap: ${stage.label}` : buildOperationText(cmd, subcmd, rest),
          success_text: 'bootstrap run completed',
          failure_text: 'bootstrap run failed'
        }, async () => {
          if (stage.argv[0] === 'init') {
            const initialized = runInitCommand(stage.argv.slice(1), 'init');
            return buildBootstrapRunResponse(stage, initialized);
          }

          if (stage.argv[0] === 'ingest' && stage.argv[1] === 'apply') {
            const applied = await runIngestCommand('apply', stage.argv.slice(2));
            return buildBootstrapRunResponse(stage, applied);
          }

          if (stage.argv[0] === 'support' || stage.argv[0] === 'tool') {
            const result = handleAdapterToolChipCommands(stage.argv[0], stage.argv[1], stage.argv.slice(2));
            return buildBootstrapRunResponse(stage, result);
          }

          if (stage.argv[0] === 'next') {
            return {
              executed: true,
              stage,
              result: executeDispatchCommand('next', { entered_via: 'bootstrap run' }),
              bootstrap_after: buildBootstrapReport()
            };
          }

          if (stage.argv[0] === 'resume') {
            const session = updateSession(current => {
              current.last_command = 'resume';
              current.last_resumed_at = new Date().toISOString();
            });
            const context = buildResumeContext();
            context.summary.last_command = session.last_command || '';
            context.summary.last_resumed_at = session.last_resumed_at || '';
            return {
              executed: true,
              stage,
              result: context,
              bootstrap_after: buildBootstrapReport()
            };
          }

          return {
            executed: false,
            reason: 'unsupported-stage-runner',
            stage,
            bootstrap
          };
        }));
        return;
      }

      emitUsage({
        status: 'error',
        error: {
          code: 'invalid-command',
          message: 'Unknown bootstrap arguments',
          command: ['bootstrap', subcmd].filter(Boolean).join(' ')
        }
      });
      process.exitCode = 1;
      return;
    }

    if (cmd === 'next') {
      if (subcmd === 'run') {
        emitJson(runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, subcmd, rest),
          success_text: 'next stage entered',
          failure_text: 'next run failed'
        }, () => executeDispatchCommand('next', { entered_via: 'next run' })));
        return;
      }

      if (subcmd === '--help') {
        emitUsage();
        return;
      }

      if (subcmd) {
        emitUsage({
          status: 'error',
          error: {
            code: 'unexpected-argument',
            message: `next does not accept subcommand: ${subcmd}`,
            command: `next ${subcmd}`
          }
        });
        process.exitCode = 1;
        return;
      }

      const context = buildNextContext();
      emitJson(runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'next recommendation updated',
        failure_text: 'next inspection failed',
        activity: false
      }, () => {
        const session = updateSession(current => {
          current.last_command = 'next';
        });
        context.current.last_command = session.last_command || '';
        return context;
      }));
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

    if (cmd === 'executor' && subcmd === 'run') {
      emitJson(runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleCatalogAndStateCommands(cmd, subcmd, rest)));
      return;
    }

    const stateCommandResult = handleCatalogAndStateCommands(cmd, subcmd, rest);
    if (stateCommandResult !== undefined) {
      emitJson(stateCommandResult);
      return;
    }

    if (cmd === 'doc' && subcmd === 'fetch') {
      emitJson(await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'doc fetch completed',
        failure_text: 'doc fetch failed'
      }, activity => handleDocCommands(cmd, subcmd, rest, {
        ui: buildDocCommandProgressBridge(activity)
      })));
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
      if (['scan', 'plan', 'do', 'debug', 'review', 'verify'].includes(cmd) && !subcmd) {
        emitJson(runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, subcmd, rest),
          success_text: `${cmd} context updated`,
          failure_text: `${cmd} failed`,
          activity: false
        }, () => actionCommandResult));
      } else {
        emitJson(actionCommandResult);
      }
      return;
    }

    const dispatchResult = handleDispatchCommands(cmd, subcmd, rest);
    if (dispatchResult !== undefined) {
      if (!dispatchResult.__side_effect_only) {
        emitJson(dispatchResult);
      }
      return;
    }

    if (cmd === 'tool' && subcmd === 'run') {
      emitJson(runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleAdapterToolChipCommands(cmd, subcmd, rest)));
      return;
    }

    if (cmd === 'support' && ['bootstrap', 'sync', 'derive', 'generate'].includes(subcmd || '')) {
      emitJson(await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleAdapterToolChipCommands(cmd, subcmd, rest)));
      return;
    }

    const adapterToolChipResult = handleAdapterToolChipCommands(cmd, subcmd, rest);
    if (adapterToolChipResult !== undefined) {
      emitJson(adapterToolChipResult);
      return;
    }

    emitUsage({
      status: 'error',
      error: {
        code: 'unknown-command',
        message: `Unknown command: ${[cmd, subcmd].filter(Boolean).join(' ')}`,
        command: [cmd, subcmd].filter(Boolean).join(' ')
      }
    });
    process.exitCode = 1;
  }

  return {
    run
  };
}

module.exports = {
  createCliRouter
};
