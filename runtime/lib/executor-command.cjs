'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');

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

  function resolveControlFlags(tokens) {
    const list = Array.isArray(tokens) ? tokens.slice() : [];
    const separatorIndex = list.indexOf('--');
    const controlTokens = separatorIndex === -1 ? list : list.slice(0, separatorIndex);
    const explicitConfirmation = controlTokens.includes('--confirm');

    if (separatorIndex === -1) {
      return {
        explicit_confirmation: explicitConfirmation,
        tokens: controlTokens.filter(token => token !== '--confirm')
      };
    }

    return {
      explicit_confirmation: explicitConfirmation,
      tokens: controlTokens.filter(token => token !== '--confirm').concat(list.slice(separatorIndex))
    };
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

  function buildHighRiskClarity(resolved) {
    if (!resolved || !resolved.config || resolved.config.risk !== 'high') {
      return null;
    }

    return {
      enabled: true,
      category: 'project-defined-executor',
      warning: `Executor ${resolved.name} is marked high risk and requires explicit confirmation before it can run.`,
      requires_explicit_confirmation: true,
      matched_signals: [`executor:${resolved.name}`, 'risk:high'],
      confirmation_template: {
        action: `executor run ${resolved.name}`,
        target: '<fill in target board / binary / device>',
        irreversible_impact: '<fill in possible destructive impact>',
        prechecks: [
          'Confirm the selected executor matches the intended hardware action',
          'Confirm the target path, board state, and required backups are ready',
          'Run the non-destructive verification executor first when available'
        ],
        execute_cli: `<fill in final executor run ${resolved.name} command>`,
        rollback_plan: '<fill in recovery steps if execution fails>'
      }
    };
  }

  function attachHighRiskClarity(result, resolved) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return result;
    }

    if (result.high_risk_clarity) {
      return result;
    }

    const highRiskClarity = buildHighRiskClarity(resolved);
    if (!highRiskClarity) {
      return result;
    }

    const next = {
      ...result,
      high_risk_clarity: highRiskClarity
    };

    return {
      ...next,
      permission_gates: permissionGateHelpers.buildPermissionGates(next)
    };
  }

  function runExecutor(name, tokens) {
    const resolved = getExecutor(name);
    const control = resolveControlFlags(tokens);
    const extraArgs = resolveExtraArgs(control.tokens);
    const highRiskClarity = buildHighRiskClarity(resolved);
    const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'executor',
      action_name: resolved.name,
      risk: highRiskClarity ? 'high' : 'normal',
      explicit_confirmation: control.explicit_confirmation,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });

    if (extraArgs.length > 0 && resolved.config.allow_extra_args !== true) {
      throw new Error(`Executor ${resolved.name} does not allow extra args`);
    }

    if (permissionDecision.decision !== 'allow') {
      return permissionGateHelpers.applyPermissionDecision(
        attachHighRiskClarity({
          executor: resolved.name,
          status: 'permission-pending',
          description: resolved.config.description || '',
          argv: resolved.config.argv || [],
          cwd: resolved.config.cwd || '.',
          risk: resolved.config.risk || 'normal',
          evidence_hint: resolved.config.evidence_hint || [],
          extra_args: extraArgs,
          exit_code: null,
          signal: '',
          stdout: '',
          stderr: '',
          duration_ms: 0,
          ran_at: '',
          error: ''
        }, resolved),
        permissionDecision
      );
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

    return permissionGateHelpers.applyPermissionDecision(
      attachHighRiskClarity({
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
      }, resolved),
      permissionDecision
    );
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
