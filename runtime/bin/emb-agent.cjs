#!/usr/bin/env node

'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let mainModule = null;

function normalizeArgv(argv) {
  return Array.isArray(argv) ? argv.map(item => String(item)) : [];
}

function resolveHelpRequest(argv) {
  const args = normalizeArgv(argv);
  const filtered = [];
  let json = false;

  args.forEach(arg => {
    if (arg === '--json') {
      json = true;
      return;
    }
    filtered.push(arg);
  });

  if (filtered.length === 0) {
    return {
      mode: 'compact',
      json
    };
  }

  if (filtered.length === 1 && (filtered[0] === 'help' || filtered[0] === '--help')) {
    return {
      mode: 'compact',
      json
    };
  }

  if (
    filtered.length === 2 &&
    ((filtered[0] === 'help' && (filtered[1] === 'advanced' || filtered[1] === '--all')) ||
      (filtered[0] === '--help' && filtered[1] === '--all'))
  ) {
    return {
      mode: 'advanced',
      json
    };
  }

  return {
    mode: '',
    json
  };
}

function resolveHelpMode(argv) {
  return resolveHelpRequest(argv).mode;
}

function renderUsage(mode, options) {
  const settings = options && typeof options === 'object' ? options : {};
  const cliEntryHelpers = require(path.join(ROOT, 'lib', 'cli-entrypoints.cjs'));
  const {
    usage,
    buildUsagePayload
  } = cliEntryHelpers.createCliEntryHelpers({ process });

  if (settings.json) {
    process.stdout.write(JSON.stringify(buildUsagePayload({ advanced: mode === 'advanced' }), null, 2) + '\n');
    return;
  }

  usage({ advanced: mode === 'advanced' });
}

function runFastPath(argv) {
  const request = resolveHelpRequest(argv);
  if (!request.mode) {
    return false;
  }

  renderUsage(request.mode, {
    json: request.json
  });
  return true;
}

function isJsonOutputRequested(argv) {
  const outputModeHelpers = require(path.join(ROOT, 'lib', 'output-mode.cjs'));
  return outputModeHelpers.parseOutputModeArgs(normalizeArgv(argv)).json === true;
}

function writeJsonError(error, argv) {
  process.stdout.write(
    JSON.stringify(
      {
        status: 'error',
        error: {
          message: error && error.message ? error.message : String(error || 'Unknown error'),
          code: error && error.code ? error.code : '',
          command: normalizeArgv(argv)
        }
      },
      null,
      2
    ) + '\n'
  );
}

function loadMainModule() {
  if (!mainModule) {
    mainModule = require(path.join(ROOT, 'lib', 'emb-agent-main.cjs'));
  }
  return mainModule;
}

async function main(argv) {
  const resolvedArgv = Array.isArray(argv) ? argv : process.argv.slice(2);
  if (runFastPath(resolvedArgv)) {
    return;
  }

  await loadMainModule().main(resolvedArgv);
}

const exported = new Proxy(
  {
    main,
    runFastPath,
    loadMainModule,
    resolveHelpMode,
    resolveHelpRequest
  },
  {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      return loadMainModule()[prop];
    },
    has(target, prop) {
      return Reflect.has(target, prop) || prop in loadMainModule();
    },
    ownKeys(target) {
      return Array.from(new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(loadMainModule())]));
    },
    getOwnPropertyDescriptor(target, prop) {
      if (Reflect.has(target, prop)) {
        return Object.getOwnPropertyDescriptor(target, prop);
      }
      const descriptor = Object.getOwnPropertyDescriptor(loadMainModule(), prop);
      if (!descriptor) {
        return descriptor;
      }
      return {
        ...descriptor,
        configurable: true
      };
    }
  }
);

module.exports = exported;

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    if (isJsonOutputRequested(process.argv.slice(2))) {
      writeJsonError(error, process.argv.slice(2));
      process.exit(1);
      return;
    }
    process.stderr.write(`emb-agent error: ${error.message}\n`);
    process.exit(1);
  });
}
