'use strict';

function createStateCommandHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtime,
    PROFILES_DIR,
    PACKS_DIR,
    AGENTS_DIR,
    COMMANDS_DIR,
    commandVisibility,
    RUNTIME_CONFIG,
    getProjectProfilesDir,
    getProjectPacksDir,
    listPackNames,
    listSpecNames,
    loadProfile,
    loadPack,
    loadSpec,
    loadCommandMarkdown,
    loadMarkdown,
    loadSession,
    updateSession,
    getProjectStatePaths,
    getPreferences,
    getProjectConfig,
    requireRestText,
    requirePreferenceKey,
    handleScaffoldCommands,
    handleWorkflowCommands,
    handleHealthUpdateCommands,
    handleTaskCommands,
    handleExecutorCommands,
    handleSettingsCommands,
    handleSessionReportCommands,
    listSkills,
    loadSkill,
    runSkill,
    parseSkillListArgs,
    installSkillSource,
    enableInstalledSkill,
    disableInstalledSkill,
    removeInstalledSkill,
    loadInstructionLayers,
    listAutoMemory,
    loadMemoryEntry,
    rememberMemory,
    extractMemory,
    auditMemory,
    promoteMemory,
    parseMemoryRememberArgs,
    parseMemoryExtractArgs,
    parseMemoryPromoteArgs
  } = deps;

  function handleCatalogAndStateCommands(cmd, subcmd, rest) {
    const scaffoldResult = handleScaffoldCommands
      ? handleScaffoldCommands(cmd, subcmd, rest)
      : undefined;
    if (scaffoldResult !== undefined) {
      return scaffoldResult;
    }

    const workflowResult = handleWorkflowCommands
      ? handleWorkflowCommands(cmd, subcmd, rest)
      : undefined;
    if (workflowResult !== undefined) {
      return workflowResult;
    }

    const healthUpdateResult = handleHealthUpdateCommands
      ? handleHealthUpdateCommands(cmd, subcmd, rest)
      : undefined;
    if (healthUpdateResult !== undefined) {
      return healthUpdateResult;
    }

    const taskResult = handleTaskCommands ? handleTaskCommands(cmd, subcmd, rest) : undefined;
    if (taskResult !== undefined) {
      return taskResult;
    }

    const executorResult = handleExecutorCommands
      ? handleExecutorCommands(cmd, subcmd, rest)
      : undefined;
    if (executorResult !== undefined) {
      return executorResult;
    }

    const settingsResult = handleSettingsCommands
      ? handleSettingsCommands(cmd, subcmd, rest)
      : undefined;
    if (settingsResult !== undefined) {
      return settingsResult;
    }

    const sessionReportResult = handleSessionReportCommands
      ? handleSessionReportCommands(cmd, subcmd, rest)
      : undefined;
    if (sessionReportResult !== undefined) {
      return sessionReportResult;
    }

    if (cmd === 'session' && subcmd === 'show') {
      const session = loadSession();
      const statePaths = typeof getProjectStatePaths === 'function' ? getProjectStatePaths() : null;
      return {
        ...session,
        session_state: statePaths
          ? runtime.buildSessionStateView(statePaths, {
              projectRoot: session.project_root
            })
          : null
      };
    }

    if (cmd === 'skills' && subcmd === 'list') {
      updateSession(current => {
        current.last_command = 'skills list';
      });
      return listSkills(parseSkillListArgs(rest));
    }

    if (cmd === 'skills' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing skill name');
      updateSession(current => {
        current.last_command = 'skills show';
      });
      return loadSkill(rest[0], {
        include_disabled: true
      });
    }

    if (cmd === 'skills' && subcmd === 'run') {
      updateSession(current => {
        current.last_command = 'skills run';
      });
      return runSkill(rest);
    }

    if (cmd === 'skills' && subcmd === 'install') {
      updateSession(current => {
        current.last_command = 'skills install';
      });
      return installSkillSource(rest);
    }

    if (cmd === 'skills' && subcmd === 'enable') {
      if (!rest[0]) throw new Error('Missing skill or plugin name');
      updateSession(current => {
        current.last_command = 'skills enable';
      });
      return enableInstalledSkill(rest[0]);
    }

    if (cmd === 'skills' && subcmd === 'disable') {
      if (!rest[0]) throw new Error('Missing skill or plugin name');
      updateSession(current => {
        current.last_command = 'skills disable';
      });
      return disableInstalledSkill(rest[0]);
    }

    if (cmd === 'skills' && (subcmd === 'remove' || subcmd === 'uninstall')) {
      if (!rest[0]) throw new Error('Missing skill or plugin name');
      updateSession(current => {
        current.last_command = `skills ${subcmd}`;
      });
      return removeInstalledSkill(rest[0]);
    }

    if (cmd === 'memory' && subcmd === 'stack') {
      updateSession(current => {
        current.last_command = 'memory stack';
      });
      return loadInstructionLayers();
    }

    if (cmd === 'memory' && subcmd === 'list') {
      updateSession(current => {
        current.last_command = 'memory list';
      });
      return listAutoMemory();
    }

    if (cmd === 'memory' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing memory entry name');
      updateSession(current => {
        current.last_command = 'memory show';
      });
      return loadMemoryEntry(rest[0]);
    }

    if (cmd === 'memory' && subcmd === 'remember') {
      return rememberMemory(parseMemoryRememberArgs(rest));
    }

    if (cmd === 'memory' && subcmd === 'extract') {
      const parsed = parseMemoryExtractArgs(rest);
      return extractMemory(parsed.note, parsed.explicit_confirmation);
    }

    if (cmd === 'memory' && subcmd === 'audit') {
      updateSession(current => {
        current.last_command = 'memory audit';
      });
      return auditMemory();
    }

    if (cmd === 'memory' && subcmd === 'promote') {
      const parsed = parseMemoryPromoteArgs(rest);
      return promoteMemory(parsed.name, parsed.target, parsed.explicit_confirmation);
    }

    if (cmd === 'agents' && subcmd === 'list') {
      return runtime.listNames(AGENTS_DIR, '.md');
    }

    if (cmd === 'agents' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing agent name');
      return loadMarkdown(AGENTS_DIR, rest[0], 'Agent');
    }

    if (cmd === 'commands' && subcmd === 'list') {
      const commandNames = runtime.listNames(COMMANDS_DIR, '.md');
      const includeAll = Array.isArray(rest) && rest.includes('--all');
      const unknownArgs = Array.isArray(rest) ? rest.filter(token => token !== '--all') : [];
      if (unknownArgs.length > 0) {
        throw new Error(`Unknown commands list option: ${unknownArgs[0]}`);
      }
      if (includeAll) {
        return commandNames;
      }
      return (commandVisibility.PUBLIC_COMMAND_NAMES || [])
        .filter(name => commandNames.includes(name));
    }

    if (cmd === 'commands' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing command name');
      if (typeof loadCommandMarkdown === 'function') {
        return loadCommandMarkdown(rest[0]);
      }
      return loadMarkdown(COMMANDS_DIR, rest[0], 'Command');
    }

    if (cmd === 'profile' && subcmd === 'list') {
      const builtIn = runtime.listNames(PROFILES_DIR, '.yaml');
      const projectProfilesDir = getProjectProfilesDir();
      const projectLocal = fs.existsSync(projectProfilesDir)
        ? runtime.listNames(projectProfilesDir, '.yaml')
        : [];
      return runtime.unique([...projectLocal, ...builtIn]);
    }

    if (cmd === 'profile' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing profile name');
      return loadProfile(rest[0]);
    }

    if (cmd === 'profile' && subcmd === 'set') {
      if (!rest[0]) throw new Error('Missing profile name');
      loadProfile(rest[0]);
      return updateSession(current => {
        current.project_profile = rest[0];
      });
    }

    if (cmd === 'prefs' && subcmd === 'show') {
      return { preferences: getPreferences(loadSession()) };
    }

    if (cmd === 'prefs' && subcmd === 'set') {
      if (!rest[0]) throw new Error('Missing preference key');
      if (!rest[1]) throw new Error('Missing preference value');
      const key = requirePreferenceKey(rest[0]);
      const value = rest[1];
      return updateSession(current => {
        current.preferences = runtime.normalizePreferences(
          {
            ...(current.preferences || {}),
            [key]: value
          },
          RUNTIME_CONFIG
        );
      });
    }

    if (cmd === 'prefs' && subcmd === 'reset') {
      return updateSession(current => {
        current.preferences = runtime.normalizePreferences(
          {},
          runtime.mergeRuntimeDefaults(RUNTIME_CONFIG, getProjectConfig())
        );
      });
    }

    if (cmd === 'pack' && subcmd === 'list') {
      if (typeof listPackNames === 'function') {
        return listPackNames();
      }
      const builtIn = runtime.listNames(PACKS_DIR, '.yaml');
      const projectPacksDir = getProjectPacksDir();
      const projectLocal = fs.existsSync(projectPacksDir)
        ? runtime.listNames(projectPacksDir, '.yaml')
        : [];
      return runtime.unique([...projectLocal, ...builtIn]);
    }

    if (cmd === 'pack' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing pack name');
      return loadPack(rest[0]);
    }

    if (cmd === 'pack' && subcmd === 'add') {
      if (!rest[0]) throw new Error('Missing pack name');
      loadPack(rest[0]);
      return updateSession(current => {
        current.active_packs = runtime.unique([...(current.active_packs || []), rest[0]]);
      });
    }

    if (cmd === 'pack' && subcmd === 'remove') {
      if (!rest[0]) throw new Error('Missing pack name');
      return updateSession(current => {
        current.active_packs = runtime.removeValue(current.active_packs || [], rest[0]);
      });
    }

    if (cmd === 'pack' && subcmd === 'clear') {
      return updateSession(current => {
        current.active_packs = [];
      });
    }

    if (cmd === 'spec' && subcmd === 'list') {
      if (typeof listSpecNames !== 'function') {
        return [];
      }
      updateSession(current => {
        current.last_command = 'spec list';
      });
      return listSpecNames();
    }

    if (cmd === 'spec' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing spec name');
      if (typeof loadSpec !== 'function') {
        throw new Error('Spec registry is not available');
      }
      updateSession(current => {
        current.last_command = 'spec show';
      });
      return loadSpec(rest[0]);
    }

    if (cmd === 'focus' && subcmd === 'get') {
      const session = loadSession();
      return { focus: session.focus || '' };
    }

    if (cmd === 'focus' && subcmd === 'set') {
      const nextFocus = requireRestText(rest, 'focus text');
      return updateSession(current => {
        current.focus = nextFocus;
      });
    }

    if (cmd === 'last-files' && subcmd === 'list') {
      return { last_files: loadSession().last_files };
    }

    if (cmd === 'last-files' && subcmd === 'add') {
      const filePath = requireRestText(rest, 'file path');
      runtime.requireFile(path.resolve(process.cwd(), filePath), 'File');
      return updateSession(current => {
        current.last_files = runtime
          .unique([filePath, ...(current.last_files || [])])
          .slice(0, RUNTIME_CONFIG.max_last_files);
      });
    }

    if (cmd === 'last-files' && subcmd === 'clear') {
      return updateSession(current => {
        current.last_files = [];
      });
    }

    if (cmd === 'last-files' && subcmd === 'remove') {
      const filePath = requireRestText(rest, 'file path');
      return updateSession(current => {
        current.last_files = runtime.removeValue(current.last_files || [], filePath);
      });
    }

    if (cmd === 'question' && subcmd === 'list') {
      return { open_questions: loadSession().open_questions };
    }

    if (cmd === 'question' && subcmd === 'add') {
      const question = requireRestText(rest, 'question text');
      return updateSession(current => {
        current.open_questions = runtime.unique([...(current.open_questions || []), question]);
      });
    }

    if (cmd === 'question' && subcmd === 'remove') {
      const question = requireRestText(rest, 'question text');
      return updateSession(current => {
        current.open_questions = runtime.removeValue(current.open_questions || [], question);
      });
    }

    if (cmd === 'question' && subcmd === 'clear') {
      return updateSession(current => {
        current.open_questions = [];
      });
    }

    if (cmd === 'risk' && subcmd === 'list') {
      return { known_risks: loadSession().known_risks };
    }

    if (cmd === 'risk' && subcmd === 'add') {
      const risk = requireRestText(rest, 'risk text');
      return updateSession(current => {
        current.known_risks = runtime.unique([...(current.known_risks || []), risk]);
      });
    }

    if (cmd === 'risk' && subcmd === 'remove') {
      const risk = requireRestText(rest, 'risk text');
      return updateSession(current => {
        current.known_risks = runtime.removeValue(current.known_risks || [], risk);
      });
    }

    if (cmd === 'risk' && subcmd === 'clear') {
      return updateSession(current => {
        current.known_risks = [];
      });
    }

    return undefined;
  }

  return {
    handleCatalogAndStateCommands
  };
}

module.exports = {
  createStateCommandHelpers
};
