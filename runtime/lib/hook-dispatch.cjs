'use strict';

const hookTrustHelpers = require('./hook-trust.cjs');

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

  function runHookWithProjectContext(rawInput, handler) {
    const data = parseHookInput(rawInput);

    if (!hookTrustHelpers.isWorkspaceTrusted(data, process.env, { fs, path, runtimeHost })) {
      return '';
    }

    const cwd = data.cwd || process.cwd();
    const projectRoot = path.resolve(cwd);
    const previousCwd = process.cwd();

    try {
      process.chdir(projectRoot);
      return handler({
        data,
        projectRoot
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
        const output = entrypoint(input);
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
    runHookCli,
    runHookWithProjectContext
  };
}

module.exports = {
  createHookDispatchHelpers
};
