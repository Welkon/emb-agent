#!/usr/bin/env node

'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let mainModule = null;

function normalizeArgv(argv) {
  return Array.isArray(argv) ? argv.map(item => String(item)) : [];
}

function resolveHelpMode(argv) {
  const args = normalizeArgv(argv);
  if (args.length === 0) {
    return 'compact';
  }

  if (args.length === 1 && (args[0] === 'help' || args[0] === '--help')) {
    return 'compact';
  }

  if (
    args.length === 2 &&
    ((args[0] === 'help' && (args[1] === 'advanced' || args[1] === '--all')) ||
      (args[0] === '--help' && args[1] === '--all'))
  ) {
    return 'advanced';
  }

  return '';
}

function renderUsage(mode) {
  const cliEntryHelpers = require(path.join(ROOT, 'lib', 'cli-entrypoints.cjs'));
  const { usage } = cliEntryHelpers.createCliEntryHelpers({ process });
  usage({ advanced: mode === 'advanced' });
}

function runFastPath(argv) {
  const mode = resolveHelpMode(argv);
  if (!mode) {
    return false;
  }

  renderUsage(mode);
  return true;
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
    resolveHelpMode
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
    process.stderr.write(`emb-agent error: ${error.message}\n`);
    process.exit(1);
  });
}
