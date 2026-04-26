'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');
const capabilityCatalog = require('./capability-catalog.cjs');
const capabilityRouter = require('./capability-router.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createCapabilityRuntimeHelpers(deps) {
  const {
    updateSession,
    buildActionOutput,
    buildArchReviewContext,
    buildNextContext,
    buildStartContext,
    buildStatus,
    getActiveTask,
    handleCatalogAndStateCommands,
    capabilityMaterializer
  } = deps;

  function buildCli(args) {
    return runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, Array.isArray(args) ? args : []);
  }

  function buildCapabilityRunCli(name) {
    return buildCli(['capability', 'run', name]);
  }

  function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function buildPreferredCapabilityCommand(name) {
    return capabilityCatalog.getCapabilityPrimaryArgs(name).join(' ');
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
        first_instruction: `Create a task and PRD first. If scope or hardware truth is still unclear, run ${buildPreferredCapabilityCommand('scan')} before ${buildPreferredCapabilityCommand('plan')} or ${buildPreferredCapabilityCommand('do')}.`,
        first_cli: firstCli,
        then_cli: thenCli,
        followup: `Then: ${thenCli}`
      },
      next_actions: unique([
        `instruction=Create and activate a task before using ${action}`,
        `command=${firstCli}`,
        `followup=Then: ${thenCli}`
      ])
    };
  }

  function buildCapabilityDescriptor(definition) {
    const materializationPlan =
      capabilityMaterializer && typeof capabilityMaterializer.buildMaterializationPlan === 'function'
        ? capabilityMaterializer.buildMaterializationPlan(definition)
        : null;
    const primaryEntryCli =
      definition.category === 'workflow-capability'
        ? buildCapabilityRunCli(definition.name)
        : buildCli([definition.primary_command || definition.name]);

    return {
      name: definition.name,
      title: definition.title || definition.name,
      category: definition.category,
      execution_kind: definition.execution_kind,
      description: definition.description || '',
      orchestratable: Boolean(definition.orchestratable),
      materializable: Boolean(definition.materializable),
      capability_route: capabilityRouter.buildCapabilityRoute(definition.name, {
        command: definition.primary_command || definition.name,
        cli: primaryEntryCli,
        primary_entry_cli: primaryEntryCli
      }),
      materialization: materializationPlan
        ? {
            spec_name: materializationPlan.spec_name,
            spec_relative_path: materializationPlan.spec_relative_path,
            template_name: materializationPlan.template_name,
            template_relative_path: materializationPlan.template_relative_path,
            default_output: materializationPlan.default_output
          }
        : null
    };
  }

  function listCapabilities(args) {
    const tokens = Array.isArray(args) ? args : [];
    const includeRuntimeSurfaces = tokens.includes('--all');
    const unknown = tokens.filter(token => token !== '--all');

    if (unknown.length > 0) {
      throw new Error(`Unknown capability list option: ${unknown[0]}`);
    }

    return {
      command: 'capability list',
      capabilities: capabilityCatalog
        .listCapabilityDefinitions({
          include_runtime_surfaces: includeRuntimeSurfaces
        })
        .map(buildCapabilityDescriptor)
    };
  }

  function showCapability(name) {
    const definition = capabilityCatalog.requireCapabilityDefinition(name, {
      include_runtime_surfaces: true
    });

    return {
      command: 'capability show',
      capability: buildCapabilityDescriptor(definition)
    };
  }

  function executeCapability(name, options = {}) {
    const definition = capabilityCatalog.requireCapabilityDefinition(name, {
      include_runtime_surfaces: true
    });
    const skipSessionUpdate = options.skip_session_update === true;
    const sessionCommand = String(options.session_command || `capability run ${definition.name}`).trim();

    if (!skipSessionUpdate && typeof updateSession === 'function') {
      updateSession(current => {
        current.last_command = sessionCommand;
      });
    }

    if (definition.execution_kind === 'workflow-action') {
      const action = definition.action_name || definition.name;
      const nextContext = typeof buildNextContext === 'function' ? buildNextContext() : null;

      if ((action === 'scan' || action === 'do') && shouldBlockActionWithHealth(nextContext)) {
        return buildHealthBlockedActionOutput(action, nextContext);
      }

      if (action === 'scan') {
        const activeTask = typeof getActiveTask === 'function' ? getActiveTask() : null;
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
          return buildTaskIntakeBlockedActionOutput(action);
        }
      }

      if (action === 'do') {
        const activeTask = typeof getActiveTask === 'function' ? getActiveTask() : null;
        if (!activeTask) {
          return buildTaskIntakeBlockedActionOutput(action);
        }
      }

      return buildActionOutput(action);
    }

    if (definition.execution_kind === 'arch-review') {
      return buildArchReviewContext();
    }

    if (definition.execution_kind === 'runtime-surface') {
      if (definition.name === 'status') {
        return buildStatus();
      }
      if (definition.name === 'next') {
        return buildNextContext();
      }
      if (definition.name === 'health') {
        return handleCatalogAndStateCommands('health', '', []);
      }
    }

    throw new Error(`Capability is not executable: ${definition.name}`);
  }

  function parseMaterializeArgs(args) {
    const tokens = Array.isArray(args) ? args : [];
    const options = {
      target: 'all',
      force: false
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!options.target || options.target === 'all') {
        if (!token.startsWith('--')) {
          options.target = token;
          continue;
        }
      }
      if (token === '--force') {
        options.force = true;
        continue;
      }
      throw new Error(`Unknown capability materialize option: ${token}`);
    }

    return options;
  }

  function materializeCapabilities(args) {
    const parsed = parseMaterializeArgs(args);
    const result = capabilityMaterializer.materializeCapabilitySet(parsed.target, {
      force: parsed.force
    });

    if (typeof updateSession === 'function') {
      updateSession(current => {
        current.last_command = `capability materialize ${parsed.target}`;
      });
    }

    return {
      command: 'capability materialize',
      ...result
    };
  }

  function handleCapabilityCommands(cmd, subcmd, rest) {
    if (cmd !== 'capability') {
      return undefined;
    }

    if (!subcmd) {
      throw new Error('capability requires a subcommand');
    }

    if (subcmd === 'list') {
      return listCapabilities(rest);
    }

    if (subcmd === 'show') {
      if (!rest[0]) {
        throw new Error('Missing capability name');
      }
      return showCapability(rest[0]);
    }

    if (subcmd === 'run') {
      if (!rest[0]) {
        throw new Error('Missing capability name');
      }
      return executeCapability(rest[0], {
        session_command: `capability run ${capabilityCatalog.resolveCapabilityName(rest[0]) || rest[0]}`
      });
    }

    if (subcmd === 'materialize') {
      return materializeCapabilities(rest);
    }

    throw new Error(`Unknown capability subcommand: ${subcmd}`);
  }

  return {
    buildCapabilityRunCli,
    buildCapabilityDescriptor,
    executeCapability,
    handleCapabilityCommands,
    listCapabilities,
    materializeCapabilities,
    showCapability
  };
}

module.exports = {
  createCapabilityRuntimeHelpers
};
