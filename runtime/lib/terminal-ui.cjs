'use strict';

function createIdentityPainter() {
  const paint = text => String(text);
  return {
    blue: paint,
    cyan: paint,
    dim: paint,
    gray: paint,
    green: paint,
    red: paint,
    yellow: paint,
    bold: paint
  };
}

function loadChalk() {
  try {
    const resolved = require('chalk');
    return resolved && resolved.default ? resolved.default : resolved;
  } catch {
    return null;
  }
}

function loadOra() {
  try {
    const resolved = require('ora');
    return resolved && resolved.default ? resolved.default : resolved;
  } catch {
    return null;
  }
}

function ensureText(value) {
  return String(value || '').trim();
}

function normalizeColorMode(value, defaultMode = 'auto') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return defaultMode;
  }
  if (normalized === 'always' || normalized === 'auto' || normalized === 'never') {
    return normalized;
  }
  throw new Error(`Unsupported color mode: ${value}`);
}

function resolveColorMode(options = {}) {
  if (options.colorMode) {
    return normalizeColorMode(options.colorMode, 'auto');
  }

  const argv = Array.isArray(options.argv) ? options.argv : [];
  let argvMode = '';

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (token === '--no-color') {
      argvMode = 'never';
      continue;
    }
    if (token === '--color') {
      const next = String(argv[index + 1] || '').trim().toLowerCase();
      if (next === 'always' || next === 'auto' || next === 'never') {
        argvMode = next;
        index += 1;
        continue;
      }
      argvMode = 'always';
      continue;
    }
    if (token.startsWith('--color=')) {
      argvMode = normalizeColorMode(token.slice('--color='.length), 'always');
    }
  }

  if (argvMode) {
    return argvMode;
  }

  const env = options.env || {};
  if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR') && String(env.NO_COLOR || '').trim() !== '') {
    return 'never';
  }
  if (Object.prototype.hasOwnProperty.call(env, 'FORCE_COLOR')) {
    const forceColor = String(env.FORCE_COLOR || '').trim().toLowerCase();
    if (!forceColor || forceColor === '0' || forceColor === 'false') {
      return 'never';
    }
    return 'always';
  }

  return 'auto';
}

function createConfiguredPainter(chalkModule, colorEnabled) {
  if (!colorEnabled) {
    return createIdentityPainter();
  }

  if (!chalkModule) {
    return createIdentityPainter();
  }

  if (typeof chalkModule.Instance === 'function') {
    return new chalkModule.Instance({ level: 1 });
  }

  return chalkModule;
}

function createTerminalUi(options = {}) {
  const hostProcess = options.process || process;
  const stdout = hostProcess.stdout || process.stdout;
  const stderr = hostProcess.stderr || process.stderr;
  const env = options.env || hostProcess.env || process.env || {};
  const argv = Array.isArray(options.argv) ? options.argv : hostProcess.argv || process.argv || [];
  const stderrIsTty = Boolean(stderr && stderr.isTTY);
  const colorMode = resolveColorMode({
    colorMode: options.colorMode,
    argv,
    env
  });
  const colorEnabled = colorMode === 'always' || (colorMode === 'auto' && stderrIsTty);
  const chalk = createConfiguredPainter(loadChalk(), colorEnabled);
  const ora = loadOra();
  const enabled =
    options.enabled !== false &&
    Boolean(stderr && typeof stderr.write === 'function') &&
    (stderrIsTty || colorMode === 'always');

  function writeLine(text) {
    if (!enabled) {
      return;
    }
    stderr.write(`${String(text || '')}\n`);
  }

  function renderKeyValue(label, value, tone) {
    const key = chalk.bold(`${label}:`);
    const text = ensureText(value);
    if (!text) {
      return '';
    }

    const painters = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      muted: chalk.dim
    };
    const paint = painters[tone] || (input => input);
    return `${key} ${paint(text)}`;
  }

  function renderSummary(lines) {
    if (!enabled) {
      return;
    }

    const items = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (items.length === 0) {
      return;
    }

    items.forEach(line => {
      writeLine(chalk.dim(`  ${line}`));
    });
  }

  function createFallbackActivity(text) {
    let activeText = ensureText(text);

    if (activeText) {
      writeLine(chalk.blue(`• ${activeText}`));
    }

    return {
      update(nextText) {
        activeText = ensureText(nextText) || activeText;
      },
      succeed(nextText) {
        const textToShow = ensureText(nextText) || activeText;
        if (textToShow) {
          writeLine(chalk.green(`✔ ${textToShow}`));
        }
      },
      warn(nextText) {
        const textToShow = ensureText(nextText) || activeText;
        if (textToShow) {
          writeLine(chalk.yellow(`▲ ${textToShow}`));
        }
      },
      fail(nextText, error) {
        const textToShow = ensureText(nextText) || activeText;
        const detail = error && error.message ? `: ${error.message}` : '';
        if (textToShow || detail) {
          writeLine(chalk.red(`✖ ${textToShow || 'Command failed'}${detail}`));
        }
      },
      stop() {}
    };
  }

  function createActivity(text) {
    if (!enabled) {
      return {
        update() {},
        succeed() {},
        warn() {},
        fail() {},
        stop() {}
      };
    }

    if (!stderrIsTty || typeof ora !== 'function') {
      return createFallbackActivity(text);
    }

    const spinner = ora({
      text: ensureText(text),
      stream: stderr,
      discardStdin: false
    }).start();

    return {
      update(nextText) {
        const normalized = ensureText(nextText);
        if (normalized) {
          spinner.text = normalized;
        }
      },
      succeed(nextText) {
        const normalized = ensureText(nextText);
        spinner.succeed(normalized || spinner.text);
      },
      warn(nextText) {
        const normalized = ensureText(nextText);
        spinner.warn(normalized || spinner.text);
      },
      fail(nextText, error) {
        const normalized = ensureText(nextText) || spinner.text || 'Command failed';
        const detail = error && error.message ? `: ${error.message}` : '';
        spinner.fail(`${normalized}${detail}`);
      },
      stop() {
        spinner.stop();
      }
    };
  }

  function info(text) {
    if (!enabled || !ensureText(text)) {
      return;
    }
    writeLine(chalk.blue(text));
  }

  function warn(text) {
    if (!enabled || !ensureText(text)) {
      return;
    }
    writeLine(chalk.yellow(text));
  }

  function error(text) {
    if (!enabled || !ensureText(text)) {
      return;
    }
    writeLine(chalk.red(text));
  }

  return {
    enabled,
    colorMode,
    colorEnabled,
    chalk,
    info,
    warn,
    error,
    renderKeyValue,
    renderSummary,
    createActivity
  };
}

module.exports = {
  createTerminalUi,
  resolveColorMode
};
