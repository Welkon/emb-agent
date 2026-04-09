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
    SKILLS_DIR,
    RUNTIME_CONFIG,
    getProjectProfilesDir,
    getProjectPacksDir,
    loadProfile,
    loadPack,
    loadMarkdown,
    loadSkill,
    loadSession,
    updateSession,
    getPreferences,
    getProjectConfig,
    requireRestText,
    requirePreferenceKey,
    handleHealthUpdateCommands,
    handleSpecCommands,
    handleTaskCommands,
    handleWorkspaceCommands,
    handleThreadCommands,
    handleForensicsCommands,
    handleExecutorCommands,
    handleSettingsCommands,
    handleSessionReportCommands,
    handleManagerCommands
  } = deps;

  function handleCatalogAndStateCommands(cmd, subcmd, rest) {
    const healthUpdateResult = handleHealthUpdateCommands
      ? handleHealthUpdateCommands(cmd, subcmd, rest)
      : undefined;
    if (healthUpdateResult !== undefined) {
      return healthUpdateResult;
    }

    const specResult = handleSpecCommands ? handleSpecCommands(cmd, subcmd, rest) : undefined;
    if (specResult !== undefined) {
      return specResult;
    }

    const taskResult = handleTaskCommands ? handleTaskCommands(cmd, subcmd, rest) : undefined;
    if (taskResult !== undefined) {
      return taskResult;
    }

    const workspaceResult = handleWorkspaceCommands ? handleWorkspaceCommands(cmd, subcmd, rest) : undefined;
    if (workspaceResult !== undefined) {
      return workspaceResult;
    }

    const threadResult = handleThreadCommands ? handleThreadCommands(cmd, subcmd, rest) : undefined;
    if (threadResult !== undefined) {
      return threadResult;
    }

    const forensicsResult = handleForensicsCommands
      ? handleForensicsCommands(cmd, subcmd, rest)
      : undefined;
    if (forensicsResult !== undefined) {
      return forensicsResult;
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

    const managerResult = handleManagerCommands
      ? handleManagerCommands(cmd, subcmd, rest)
      : undefined;
    if (managerResult !== undefined) {
      return managerResult;
    }

    if (cmd === 'session' && subcmd === 'show') {
      return loadSession();
    }

    if (cmd === 'agents' && subcmd === 'list') {
      return runtime.listNames(AGENTS_DIR, '.md');
    }

    if (cmd === 'agents' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing agent name');
      return loadMarkdown(AGENTS_DIR, rest[0], 'Agent');
    }

    if (cmd === 'commands' && subcmd === 'list') {
      return runtime
        .listNames(COMMANDS_DIR, '.md')
        .filter(name => name !== 'attach');
    }

    if (cmd === 'commands' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing command name');
      return loadMarkdown(COMMANDS_DIR, rest[0], 'Command');
    }

    if (cmd === 'skills' && subcmd === 'list') {
      if (!fs.existsSync(SKILLS_DIR)) {
        return [];
      }

      return fs
        .readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
        .map(entry => entry.name)
        .sort();
    }

    if (cmd === 'skills' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing skill name');
      return loadSkill(rest[0]);
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
