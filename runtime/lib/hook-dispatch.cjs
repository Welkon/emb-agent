'use strict';

const hookTrustHelpers = require('./hook-trust.cjs');
const runtimeEventHelpers = require('./runtime-events.cjs');

function createHookDispatchHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtimeHost
  } = deps;

  function parseHookInput(rawInput) {
    if (typeof rawInput === 'string') {
      return rawInput.trim() ? JSON.parse(rawInput) : {};
    }

    if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
      return rawInput;
    }

    return {};
  }

  function resolveHookCliOutput(result) {
    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return typeof result.output === 'string' ? result.output : '';
    }

    return '';
  }

  function runHookWithProjectContext(rawInput, handler) {
    const data = parseHookInput(rawInput);
    const eventName = String(data.hook_event_name || data.event || '').trim();
    const cwd = data.cwd || process.cwd();
    const projectRoot = path.resolve(cwd);

    if (!hookTrustHelpers.isWorkspaceTrusted(data, process.env, { fs, path, runtimeHost })) {
      return runtimeEventHelpers.appendRuntimeEvent({
        trusted: false,
        status: 'skipped',
        event: eventName,
        cwd,
        project_root: projectRoot,
        output: ''
      }, {
        type: 'hook-dispatch',
        category: 'hook',
        status: 'blocked',
        severity: 'normal',
        summary: 'Hook execution skipped because the workspace is not trusted.',
        action: eventName,
        source: 'hook-dispatch',
        details: {
          trusted: false,
          project_root: projectRoot
        }
      });
    }

    const previousCwd = process.cwd();

    try {
      process.chdir(projectRoot);
      const output = handler({
        data,
        projectRoot
      });
      return runtimeEventHelpers.appendRuntimeEvent({
        trusted: true,
        status: 'ok',
        event: eventName,
        cwd,
        project_root: projectRoot,
        output
      }, {
        type: 'hook-dispatch',
        category: 'hook',
        status: 'ok',
        severity: 'normal',
        summary: eventName
          ? `Hook ${eventName} executed with trusted project context.`
          : 'Hook executed with trusted project context.',
        action: eventName,
        source: 'hook-dispatch',
        details: {
          trusted: true,
          project_root: projectRoot
        }
      });
    } finally {
      process.chdir(previousCwd);
    }
  }

  function runHookCli(entrypoint) {
    let input = '';
    const stdinTimeout = setTimeout(() => process.exit(0), 5000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      input += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(stdinTimeout);

      try {
        const output = resolveHookCliOutput(entrypoint(input));
        if (output) {
          process.stdout.write(output);
        }
      } catch {
        process.exit(0);
      }
    });
  }

  return {
    parseHookInput,
    resolveHookCliOutput,
    runHookCli,
    runHookWithProjectContext
  };
}

module.exports = {
  createHookDispatchHelpers
};
