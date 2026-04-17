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
    return createIdentityPainter();
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

function createTerminalUi(options = {}) {
  const hostProcess = options.process || process;
  const stdout = hostProcess.stdout || process.stdout;
  const stderr = hostProcess.stderr || process.stderr;
  const chalk = loadChalk();
  const ora = loadOra();
  const enabled = options.enabled !== false && Boolean(stdout && stdout.isTTY && stderr && stderr.isTTY);

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
        fail() {},
        stop() {}
      };
    }

    if (typeof ora !== 'function') {
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
  createTerminalUi
};
