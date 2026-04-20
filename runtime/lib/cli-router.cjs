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
    buildContextOverview,
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

    function emitCommandResult(meta, value, options) {
      const commandMeta =
        meta && typeof meta === 'object' && !Array.isArray(meta)
          ? meta
          : { cmd: '', subcmd: '' };
      const settings =
        options && typeof options === 'object' && !Array.isArray(options)
          ? options
          : {};

      if (terminalUi.enabled && parsedOutputMode.json !== true) {
        if (settings.summary_already_rendered !== true) {
          if (settings.success_text) {
            terminalUi.info(settings.success_text);
          }
          terminalUi.renderSummary(buildSummaryLines(commandMeta.cmd, commandMeta.subcmd, value));
        }
        return;
      }

      emitJson(value);
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
      if (cmd === 'support' && subcmd === 'analysis' && rest[0] === 'init') {
        return 'Initializing chip support analysis artifact';
      }
      if (cmd === 'support' && subcmd === 'export') {
        return 'Exporting derived chip support into a private target';
      }
      if (cmd === 'support' && subcmd === 'publish') {
        return 'Publishing derived chip support into a shared catalog';
      }
      if (cmd === 'support' && (subcmd === 'derive' || subcmd === 'generate')) {
        return `Generating chip support artifacts via ${scope}`;
      }

      return scope ? `Running ${scope}` : 'Running emb-agent command';
    }

    function humanizeTerminalHint(text) {
      const value = String(text || '').trim();
      if (!value) {
        return '';
      }

      if (/^flow=/i.test(value)) {
        const flow = value.replace(/^flow=/i, '').trim();
        return flow ? `Follow the recommended flow: ${flow}.` : '';
      }

      if (/^checkpoint=/i.test(value)) {
        return value.replace(/^checkpoint=/i, '').trim();
      }

      if (/^command=/i.test(value)) {
        return '';
      }

      return value;
    }

    function pushActionCardLines(lines, actionCard) {
      const card = actionCard && typeof actionCard === 'object' && !Array.isArray(actionCard) ? actionCard : {};
      const firstInstruction = humanizeTerminalHint(card.first_instruction);

      if (card.stage) {
        lines.push(terminalUi.renderKeyValue('Stage', card.stage, 'info'));
      }
      if (card.action) {
        lines.push(terminalUi.renderKeyValue('Action', card.action, 'success'));
      }
      if (card.summary) {
        lines.push(terminalUi.renderKeyValue('Summary', card.summary, 'muted'));
      }
      if (firstInstruction) {
        lines.push(terminalUi.renderKeyValue('First', firstInstruction, 'muted'));
      }
      if (card.first_cli) {
        lines.push(terminalUi.renderKeyValue('CLI', card.first_cli, 'success'));
      }
      if (card.then_cli) {
        lines.push(terminalUi.renderKeyValue('Then', card.then_cli, 'muted'));
      }
    }

    function pushNextActions(lines, actions, actionCard) {
      const card = actionCard && typeof actionCard === 'object' && !Array.isArray(actionCard) ? actionCard : {};
      const alreadyShown = new Set(
        [
          humanizeTerminalHint(card.first_instruction),
          humanizeTerminalHint(card.summary),
          humanizeTerminalHint(card.reason),
          humanizeTerminalHint(card.then_cli)
        ]
          .map(item => String(item || '').trim())
          .filter(Boolean)
      );
      const items = (Array.isArray(actions) ? actions : [])
        .map(humanizeTerminalHint)
        .filter(Boolean)
        .filter(item => !alreadyShown.has(String(item).trim()));
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

      if (cmd === 'start') {
        const summary =
          payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
            ? payload.summary
            : {};
        const immediate =
          payload.immediate && typeof payload.immediate === 'object' && !Array.isArray(payload.immediate)
            ? payload.immediate
            : {};
        const bootstrapStage =
          payload.bootstrap && payload.bootstrap.stage
            ? String(payload.bootstrap.stage).trim()
            : '';
        let firstInstruction = '';

        if (bootstrapStage === 'define-project-constraints') {
          firstInstruction = 'Open .emb-agent/req.yaml and record the project type, inputs/outputs, interfaces, and constraints.';
        } else if (bootstrapStage === 'confirm-hardware-identity') {
          firstInstruction = 'Open .emb-agent/hw.yaml and record the real MCU and package before execution.';
        } else if (summary.active_task && summary.active_task.name) {
          firstInstruction = `Continue the active task ${summary.active_task.name} before starting new work.`;
        }

        if (summary.project_root) {
          lines.push(terminalUi.renderKeyValue('Project', summary.project_root, 'info'));
        }
        if (summary.active_task && summary.active_task.name) {
          lines.push(terminalUi.renderKeyValue('Task', summary.active_task.name, 'success'));
        }
        if (summary.active_task && summary.active_task.package) {
          lines.push(terminalUi.renderKeyValue('Package', summary.active_task.package, 'info'));
        } else if (summary.active_package) {
          lines.push(terminalUi.renderKeyValue('Package', summary.active_package, 'info'));
        }
        if (summary.default_package && summary.default_package !== summary.active_package) {
          lines.push(terminalUi.renderKeyValue('Default Package', summary.default_package, 'muted'));
        }
        if (bootstrapStage) {
          lines.push(terminalUi.renderKeyValue('Bootstrap', bootstrapStage, 'info'));
        }
        if (immediate.command) {
          lines.push(terminalUi.renderKeyValue('Next', immediate.command, 'success'));
        }
        if (immediate.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', immediate.reason, 'muted'));
        }
        if (firstInstruction) {
          lines.push(terminalUi.renderKeyValue('First', firstInstruction, 'muted'));
        }
        if (immediate.cli && immediate.command && immediate.command !== 'next') {
          lines.push(terminalUi.renderKeyValue('CLI', immediate.cli, 'success'));
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
        if (payload.active_task && payload.active_task.package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.active_task.package, 'info'));
        } else if (payload.active_package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.active_package, 'info'));
        }
        if (payload.default_package && payload.default_package !== payload.active_package) {
          lines.push(terminalUi.renderKeyValue('Default Package', payload.default_package, 'muted'));
        }
        if (payload.focus) {
          lines.push(terminalUi.renderKeyValue('Focus', payload.focus, 'muted'));
        }
        if (payload.context_hygiene && payload.context_hygiene.recommendation) {
          lines.push(terminalUi.renderKeyValue('Context', payload.context_hygiene.recommendation, 'muted'));
        }
        pushNextActions(lines, payload.next_actions, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'context' && subcmd === 'show') {
        if (payload.summary && payload.summary.active_task && payload.summary.active_task.name) {
          lines.push(terminalUi.renderKeyValue('Task', payload.summary.active_task.name, 'info'));
        }
        if (payload.next && payload.next.next && payload.next.next.command) {
          lines.push(terminalUi.renderKeyValue('Next', payload.next.next.command, 'success'));
        }
        if (payload.health && payload.health.status) {
          lines.push(terminalUi.renderKeyValue('Health', payload.health.status, 'success'));
        }
        if (payload.bootstrap && payload.bootstrap.display_current_stage) {
          lines.push(terminalUi.renderKeyValue('Bootstrap', payload.bootstrap.display_current_stage, 'muted'));
        }
        if (payload.status && payload.status.context_hygiene && payload.status.context_hygiene.recommendation) {
          lines.push(terminalUi.renderKeyValue('Context', payload.status.context_hygiene.recommendation, 'muted'));
        }
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
        if (payload.task && payload.task.package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.task.package, 'info'));
        } else if (payload.current && payload.current.active_package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.current.active_package, 'info'));
        }
        if (
          payload.current &&
          payload.current.default_package &&
          payload.current.default_package !== payload.current.active_package
        ) {
          lines.push(terminalUi.renderKeyValue('Default Package', payload.current.default_package, 'muted'));
        }
        if (payload.next && payload.next.command) {
          lines.push(terminalUi.renderKeyValue('Next', payload.next.command, 'success'));
        }
        if (payload.next && payload.next.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', payload.next.reason, 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions, nestedActionCard);
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
        pushNextActions(lines, payload.next_actions, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'ingest' && payload.domain === 'doc') {
        lines.push(terminalUi.renderKeyValue('Doc', payload.doc_id || payload.title, 'info'));
        lines.push(terminalUi.renderKeyValue('Provider', payload.provider, 'muted'));
        if (payload.truth_write && payload.truth_write.target) {
          lines.push(terminalUi.renderKeyValue('Truth Target', payload.truth_write.target, 'success'));
        }
        if (payload.agent_analysis && payload.agent_analysis.artifact_path) {
          lines.push(terminalUi.renderKeyValue('Analysis', payload.agent_analysis.artifact_path, 'warning'));
        }
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
        pushNextActions(lines, payload.next_actions, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'plan' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Goal', payload.goal, 'info'));
        lines.push(terminalUi.renderKeyValue('Steps', String((payload.steps || []).length), 'success'));
        if (Array.isArray(payload.verification) && payload.verification.length > 0) {
          lines.push(terminalUi.renderKeyValue('Verify', payload.verification[0], 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions, nestedActionCard);
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
        pushNextActions(lines, payload.next_actions, nestedActionCard);
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
        pushNextActions(lines, payload.next_actions, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'review' && !subcmd) {
        lines.push(terminalUi.renderKeyValue('Axes', String((payload.axes || []).length), 'info'));
        lines.push(terminalUi.renderKeyValue('Checks', String((payload.required_checks || []).length), 'success'));
        if (Array.isArray(payload.review_agents) && payload.review_agents.length > 0) {
          lines.push(terminalUi.renderKeyValue('Reviewers', payload.review_agents.join(', '), 'muted'));
        }
        pushActionCardLines(lines, nestedActionCard);
        pushNextActions(lines, payload.next_actions, nestedActionCard);
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
        pushNextActions(lines, payload.next_actions, nestedActionCard);
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'task' && subcmd === 'worktree') {
        const worktree =
          payload.worktree && typeof payload.worktree === 'object' && !Array.isArray(payload.worktree)
            ? payload.worktree
            : {};
        const worktreeSummary =
          payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
            ? payload.summary
            : {};

        if (payload.created === true) {
          lines.push(terminalUi.renderKeyValue('Created', 'yes', 'success'));
          if (payload.task && payload.task.name) {
            lines.push(terminalUi.renderKeyValue('Task', payload.task.name, 'info'));
          }
          if (payload.workspace && payload.workspace.package_scope) {
            lines.push(terminalUi.renderKeyValue('Scope', payload.workspace.package_scope, 'muted'));
          }
          if (payload.workspace && payload.workspace.package) {
            lines.push(terminalUi.renderKeyValue('Package', payload.workspace.package, 'info'));
          }
          if (payload.workspace && payload.workspace.package_path) {
            lines.push(terminalUi.renderKeyValue('Package Path', payload.workspace.package_path, 'muted'));
          }
          if (worktree.workspace_state) {
            lines.push(
              terminalUi.renderKeyValue(
                'State',
                worktree.workspace_state,
                worktree.attention === 'warn' ? 'warning' : 'success'
              )
            );
          }
          if (payload.workspace && payload.workspace.mode) {
            lines.push(terminalUi.renderKeyValue('Mode', payload.workspace.mode, 'muted'));
          }
          if (payload.workspace && payload.workspace.path) {
            lines.push(terminalUi.renderKeyValue('Path', payload.workspace.path, 'muted'));
          }
          if (worktree.summary) {
            lines.push(terminalUi.renderKeyValue('Summary', worktree.summary, 'muted'));
          }
          return appendRuntimeEventsSummary(lines, payload);
        }

        if (payload.cleaned === true) {
          lines.push(
            terminalUi.renderKeyValue(
              'Cleaned',
              payload.workspace_cleanup && payload.workspace_cleanup.cleaned ? 'yes' : 'no',
              payload.workspace_cleanup && payload.workspace_cleanup.cleaned ? 'success' : 'warning'
            )
          );
          if (payload.task && payload.task.name) {
            lines.push(terminalUi.renderKeyValue('Task', payload.task.name, 'info'));
          }
          if (payload.workspace_cleanup && payload.workspace_cleanup.path) {
            lines.push(terminalUi.renderKeyValue('Path', payload.workspace_cleanup.path, 'muted'));
          }
          if (payload.workspace_cleanup && payload.workspace_cleanup.error) {
            lines.push(terminalUi.renderKeyValue('Error', payload.workspace_cleanup.error, 'error'));
          }
          return appendRuntimeEventsSummary(lines, payload);
        }

        if (Object.keys(worktree).length > 0) {
          if (worktree.task_name) {
            lines.push(terminalUi.renderKeyValue('Task', worktree.task_name, 'info'));
          }
          if (worktree.package_scope) {
            lines.push(terminalUi.renderKeyValue('Scope', worktree.package_scope, 'muted'));
          }
          if (worktree.package) {
            lines.push(terminalUi.renderKeyValue('Package', worktree.package, 'info'));
          }
          if (worktree.package_path) {
            lines.push(terminalUi.renderKeyValue('Package Path', worktree.package_path, 'muted'));
          }
          if (worktree.workspace_state) {
            lines.push(
              terminalUi.renderKeyValue(
                'State',
                worktree.workspace_state,
                worktree.attention === 'warn' ? 'warning' : 'success'
              )
            );
          }
          if (worktree.path) {
            lines.push(terminalUi.renderKeyValue('Path', worktree.path, 'muted'));
          }
          if (worktree.summary) {
            lines.push(terminalUi.renderKeyValue('Summary', worktree.summary, 'muted'));
          }
          return appendRuntimeEventsSummary(lines, payload);
        }

        if (Array.isArray(payload.worktrees)) {
          lines.push(terminalUi.renderKeyValue('Worktrees', String(payload.worktrees.length), 'info'));
          if (typeof worktreeSummary.active === 'number') {
            lines.push(terminalUi.renderKeyValue('Active', String(worktreeSummary.active), 'success'));
          }
          if (typeof worktreeSummary.dirty === 'number') {
            lines.push(
              terminalUi.renderKeyValue(
                'Dirty',
                String(worktreeSummary.dirty),
                worktreeSummary.dirty > 0 ? 'warning' : 'success'
              )
            );
          }
          if (typeof worktreeSummary.attention_required === 'number') {
            lines.push(
              terminalUi.renderKeyValue(
                'Attention',
                String(worktreeSummary.attention_required),
                worktreeSummary.attention_required > 0 ? 'warning' : 'success'
              )
            );
          }
          if (payload.registry_path) {
            lines.push(terminalUi.renderKeyValue('Registry', payload.registry_path, 'muted'));
          }
          return appendRuntimeEventsSummary(lines, payload);
        }
      }

      if (cmd === 'task' && subcmd === 'add') {
        if (payload.created === true) {
          lines.push(terminalUi.renderKeyValue('Created', 'yes', 'success'));
        }
        if (payload.task && payload.task.name) {
          lines.push(terminalUi.renderKeyValue('Task', payload.task.name, 'info'));
        }
        if (payload.task && payload.task.package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.task.package, 'info'));
        }
        if (payload.task && payload.task.path) {
          lines.push(terminalUi.renderKeyValue('Path', payload.task.path, 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'task' && subcmd === 'activate') {
        if (payload.activated === true) {
          lines.push(terminalUi.renderKeyValue('Activated', 'yes', 'success'));
        }
        if (payload.task && payload.task.name) {
          lines.push(terminalUi.renderKeyValue('Task', payload.task.name, 'info'));
        }
        if (payload.task && payload.task.package) {
          lines.push(terminalUi.renderKeyValue('Package', payload.task.package, 'info'));
        }
        if (payload.workspace && payload.workspace.mode) {
          lines.push(terminalUi.renderKeyValue('Mode', payload.workspace.mode, 'muted'));
        }
        if (payload.workspace && payload.workspace.path) {
          lines.push(terminalUi.renderKeyValue('Path', payload.workspace.path, 'muted'));
        }
        if (payload.worktree && payload.worktree.summary) {
          lines.push(terminalUi.renderKeyValue('Summary', payload.worktree.summary, 'muted'));
        }
        return appendRuntimeEventsSummary(lines, payload);
      }

      if (cmd === 'session-report' || (cmd === 'session' && subcmd === 'record')) {
        if (payload.generated === true) {
          lines.push(terminalUi.renderKeyValue('Generated', 'yes', 'success'));
        }
        if (payload.report_file) {
          lines.push(terminalUi.renderKeyValue('Report', payload.report_file, 'info'));
        }
        if (payload.next && payload.next.command) {
          lines.push(terminalUi.renderKeyValue('Next', payload.next.command, 'success'));
        }
        if (payload.next && payload.next.reason) {
          lines.push(terminalUi.renderKeyValue('Reason', payload.next.reason, 'muted'));
        }
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

    function resolveBootstrapRunStage(bootstrap, stage) {
      const nextStage = stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : null;
      if (!nextStage) {
        return null;
      }

      if (nextStage.id !== 'startup-hooks' || nextStage.manual !== true) {
        return nextStage;
      }

      const stages = Array.isArray(bootstrap && bootstrap.stages) ? bootstrap.stages : [];
      const blockingStage = stages.find(item =>
        item &&
        item.id !== 'startup-hooks' &&
        item.id !== 'next-step' &&
        ['ready', 'manual'].includes(String(item.status || ''))
      );
      if (blockingStage) {
        return nextStage;
      }

      const continueStage = stages.find(item =>
        item &&
        item.id === 'next-step' &&
        Array.isArray(item.argv) &&
        item.argv.length > 0
      );
      if (!continueStage) {
        return nextStage;
      }

      return {
        ...continueStage,
        status: 'ready',
        bypassed_manual_stage: {
          id: nextStage.id || '',
          label: nextStage.label || '',
          summary: nextStage.summary || ''
        }
      };
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
        emitCommandResult({ cmd, subcmd }, initialized, { summary_already_rendered: true });
      }
      return;
    }

    if (cmd === 'start') {
      emitCommandResult({ cmd, subcmd }, buildStartContext());
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
        emitCommandResult({ cmd, subcmd }, initialized, { summary_already_rendered: true });
      }
      return;
    }

    if (cmd === 'ingest') {
      emitCommandResult({ cmd, subcmd }, await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `ingest ${subcmd || ''}`.trim() + ' completed',
        failure_text: `ingest ${subcmd || ''}`.trim() + ' failed'
      }, activity => runIngestCommand(subcmd, rest, {
        ui: buildIngestProgressBridge(activity)
      })), { summary_already_rendered: true });
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
      emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'status updated',
        failure_text: 'status inspection failed',
        activity: false
      }, () => buildStatus()), { summary_already_rendered: true });
      return;
    }

    if (cmd === 'bootstrap') {
      if (!subcmd || subcmd === 'show') {
        emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
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
        }), { summary_already_rendered: true });
        return;
      }

      if (subcmd === 'run') {
        const bootstrap = buildBootstrapReport();
        const runOptions = parseBootstrapRunOptions(rest);
        const stage = applyBootstrapRunOptions(
          resolveBootstrapRunStage(bootstrap, bootstrap.next_stage || null),
          runOptions
        );

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
            summary: 'Network access is required for the default chip support install. Provide an explicit source or run this step in a network-enabled session.',
            stage,
            bootstrap
          });
          return;
        }

        emitCommandResult({ cmd, subcmd }, await runWithTerminalUi({
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
        }), { summary_already_rendered: true });
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
        emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, subcmd, rest),
          success_text: 'next stage entered',
          failure_text: 'next run failed'
        }, () => executeDispatchCommand('next', { entered_via: 'next run' })), { summary_already_rendered: true });
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
      emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
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
      }), { summary_already_rendered: true });
      return;
    }

    if (cmd === 'pause' && subcmd === 'show') {
      emitJson(loadHandoff());
      return;
    }

    if (cmd === 'context' && subcmd === 'show') {
      emitJson(buildContextOverview());
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
      emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleCatalogAndStateCommands(cmd, subcmd, rest)), { summary_already_rendered: true });
      return;
    }

    const stateCommandResult = handleCatalogAndStateCommands(cmd, subcmd, rest);
    if (stateCommandResult !== undefined) {
      if (cmd === 'task' && subcmd === 'worktree') {
        const worktreeAction = rest[0] || 'list';
        const interactiveAction = worktreeAction === 'create' || worktreeAction === 'cleanup' || worktreeAction === 'remove';
        emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, `${subcmd} ${worktreeAction}`.trim(), rest.slice(1)),
          success_text: `task worktree ${worktreeAction}`.trim() + ' updated',
          failure_text: `task worktree ${worktreeAction}`.trim() + ' failed',
          activity: interactiveAction
        }, () => stateCommandResult), { summary_already_rendered: true });
        return;
      }

      if (
        (cmd === 'task' && ['add', 'activate'].includes(subcmd || '')) ||
        cmd === 'session-report' ||
        (cmd === 'session' && subcmd === 'record')
      ) {
        emitCommandResult({ cmd, subcmd }, stateCommandResult);
        return;
      }

      emitJson(stateCommandResult);
      return;
    }

    if (cmd === 'doc' && subcmd === 'fetch') {
      emitCommandResult({ cmd, subcmd }, await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: 'doc fetch completed',
        failure_text: 'doc fetch failed'
      }, activity => handleDocCommands(cmd, subcmd, rest, {
        ui: buildDocCommandProgressBridge(activity)
      })), { summary_already_rendered: true });
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
        emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
          cmd,
          subcmd,
          text: buildOperationText(cmd, subcmd, rest),
          success_text: `${cmd} context updated`,
          failure_text: `${cmd} failed`,
          activity: false
        }, () => actionCommandResult), { summary_already_rendered: true });
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
      emitCommandResult({ cmd, subcmd }, runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleAdapterToolChipCommands(cmd, subcmd, rest)), { summary_already_rendered: true });
      return;
    }

    if (
      cmd === 'support' &&
      (
        ['bootstrap', 'sync', 'derive', 'generate'].includes(subcmd || '') ||
        (subcmd === 'analysis' && rest[0] === 'init')
      )
    ) {
      emitCommandResult({ cmd, subcmd }, await runWithTerminalUi({
        cmd,
        subcmd,
        text: buildOperationText(cmd, subcmd, rest),
        success_text: `${cmd} ${subcmd}`.trim() + ' completed',
        failure_text: `${cmd} ${subcmd}`.trim() + ' failed'
      }, () => handleAdapterToolChipCommands(cmd, subcmd, rest)), { summary_already_rendered: true });
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
