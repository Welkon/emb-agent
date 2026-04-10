'use strict';

function createExecutorCommandHelpers(deps) {
  const {
    path,
    process,
    childProcess,
    runtime,
    resolveProjectRoot,
    getProjectConfig,
    updateSession
  } = deps;
  const EXECUTOR_PREVIEW_MAX = 240;

  function getProjectConfigPath() {
    return runtime.resolveProjectDataPath(resolveProjectRoot(), 'project.json');
  }

  function getExecutors() {
    const projectConfig = getProjectConfig();
    if (!projectConfig || !projectConfig.executors || typeof projectConfig.executors !== 'object') {
      return {};
    }
    return projectConfig.executors;
  }

  function buildExecutorSummary(name, config) {
    return {
      name,
      description: config.description || '',
      argv: config.argv || [],
      cwd: config.cwd || '.',
      allow_extra_args: config.allow_extra_args === true,
      risk: config.risk || 'normal',
      evidence_hint: config.evidence_hint || []
    };
  }

  function listExecutors() {
    const executors = getExecutors();

    return {
      path: getProjectConfigPath(),
      executors: Object.entries(executors)
        .map(([name, config]) => buildExecutorSummary(name, config))
        .sort((left, right) => left.name.localeCompare(right.name))
    };
  }

  function getExecutor(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing executor name');
    }

    const executors = getExecutors();
    const config = executors[normalized];
    if (!config) {
      throw new Error(`Executor not found: ${normalized}`);
    }

    return {
      name: normalized,
      config
    };
  }

  function showExecutor(name) {
    const resolved = getExecutor(name);
    const projectRoot = resolveProjectRoot();
    const resolvedCwd = resolved.config.cwd
      ? path.resolve(projectRoot, resolved.config.cwd)
      : projectRoot;

    return {
      path: getProjectConfigPath(),
      executor: {
        ...buildExecutorSummary(resolved.name, resolved.config),
        resolved_cwd: path.relative(projectRoot, resolvedCwd) || '.'
      }
    };
  }

  function resolveExtraArgs(tokens) {
    const list = Array.isArray(tokens) ? tokens.slice() : [];
    const separatorIndex = list.indexOf('--');
    if (separatorIndex === -1) {
      return list;
    }

    return list.slice(separatorIndex + 1);
  }

  function buildPreview(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, EXECUTOR_PREVIEW_MAX);
  }

  function buildLatestExecutorSummary(resolved, result, argv, resolvedCwd, ranAt) {
    const projectRoot = resolveProjectRoot();

    return {
      name: resolved.name,
      status: result.error ? 'error' : result.status === 0 ? 'ok' : 'failed',
      risk: resolved.config.risk || 'normal',
      exit_code: typeof result.status === 'number' ? result.status : null,
      duration_ms: Date.now() - ranAt.valueOf(),
      ran_at: ranAt.toISOString(),
      cwd: path.relative(projectRoot, resolvedCwd) || '.',
      argv,
      evidence_hint: resolved.config.evidence_hint || [],
      stdout_preview: buildPreview(result.stdout),
      stderr_preview: buildPreview(result.stderr || (result.error ? result.error.message : ''))
    };
  }

  function runExecutor(name, tokens) {
    const resolved = getExecutor(name);
    const extraArgs = resolveExtraArgs(tokens);

    if (extraArgs.length > 0 && resolved.config.allow_extra_args !== true) {
      throw new Error(`Executor ${resolved.name} does not allow extra args`);
    }

    const projectRoot = resolveProjectRoot();
    const resolvedCwd = resolved.config.cwd
      ? path.resolve(projectRoot, resolved.config.cwd)
      : projectRoot;
    const argv = [...(resolved.config.argv || []), ...extraArgs];
    const [command, ...args] = argv;
    const startedAt = new Date();
    const result = childProcess.spawnSync(command, args, {
      cwd: resolvedCwd,
      env: {
        ...process.env,
        ...(resolved.config.env || {})
      },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const latestExecutor = buildLatestExecutorSummary(resolved, result, argv, resolvedCwd, startedAt);

    updateSession(current => {
      current.last_command = `executor run ${resolved.name}`;
      const diagnostics = current.diagnostics || {};
      const history =
        diagnostics.executor_history &&
        typeof diagnostics.executor_history === 'object' &&
        !Array.isArray(diagnostics.executor_history)
          ? diagnostics.executor_history
          : {};
      current.diagnostics = {
        ...diagnostics,
        latest_executor: latestExecutor,
        executor_history: {
          ...history,
          [resolved.name]: latestExecutor
        }
      };
    });

    return {
      executor: resolved.name,
      status: latestExecutor.status,
      description: resolved.config.description || '',
      argv,
      cwd: latestExecutor.cwd,
      risk: latestExecutor.risk,
      evidence_hint: latestExecutor.evidence_hint,
      extra_args: extraArgs,
      exit_code: latestExecutor.exit_code,
      signal: result.signal || '',
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      duration_ms: latestExecutor.duration_ms,
      ran_at: latestExecutor.ran_at,
      error: result.error ? result.error.message : ''
    };
  }

  function handleExecutorCommands(cmd, subcmd, rest) {
    if (cmd !== 'executor') {
      return undefined;
    }

    if (!subcmd || subcmd === 'list') {
      return listExecutors();
    }

    if (subcmd === 'show') {
      return showExecutor(rest[0]);
    }

    if (subcmd === 'run') {
      if (!rest[0]) {
        throw new Error('Missing executor name');
      }
      return runExecutor(rest[0], rest.slice(1));
    }

    throw new Error(`Unknown executor subcommand: ${subcmd}`);
  }

  return {
    listExecutors,
    showExecutor,
    runExecutor,
    handleExecutorCommands
  };
}

module.exports = {
  createExecutorCommandHelpers
};
