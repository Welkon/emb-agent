'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const terminalUi = require(path.join(__dirname, '..', 'runtime', 'lib', 'terminal-ui.cjs'));

test('createTerminalUi enables colored output when stderr is tty but stdout is not', () => {
  let stderr = '';
  const ui = terminalUi.createTerminalUi({
    process: {
      env: {},
      argv: ['node', 'emb-agent'],
      stdout: {
        isTTY: false
      },
      stderr: {
        isTTY: true,
        write(chunk) {
          stderr += String(chunk);
          return true;
        }
      }
    }
  });

  assert.equal(ui.enabled, true);
  assert.equal(ui.colorMode, 'auto');
  assert.equal(ui.colorEnabled, true);
  ui.info('hello');
  assert.match(stderr, /\u001b\[/);
});

test('createTerminalUi honors FORCE_COLOR in non-tty sessions', () => {
  let stderr = '';
  const ui = terminalUi.createTerminalUi({
    process: {
      env: { FORCE_COLOR: '1' },
      argv: ['node', 'emb-agent'],
      stdout: {
        isTTY: false
      },
      stderr: {
        isTTY: false,
        write(chunk) {
          stderr += String(chunk);
          return true;
        }
      }
    }
  });

  assert.equal(ui.enabled, true);
  assert.equal(ui.colorMode, 'always');
  assert.equal(ui.colorEnabled, true);
  ui.createActivity('Installing').succeed('Installed');
  assert.match(stderr, /Installed/);
  assert.match(stderr, /\u001b\[/);
});

test('createTerminalUi disables colors when NO_COLOR is set', () => {
  let stderr = '';
  const ui = terminalUi.createTerminalUi({
    process: {
      env: { NO_COLOR: '1' },
      argv: ['node', 'emb-agent'],
      stdout: {
        isTTY: true
      },
      stderr: {
        isTTY: true,
        write(chunk) {
          stderr += String(chunk);
          return true;
        }
      }
    }
  });

  assert.equal(ui.enabled, true);
  assert.equal(ui.colorMode, 'never');
  assert.equal(ui.colorEnabled, false);
  ui.warn('plain');
  assert.doesNotMatch(stderr, /\u001b\[/);
  assert.match(stderr, /plain/);
});

test('resolveColorMode honors argv overrides before env', () => {
  const mode = terminalUi.resolveColorMode({
    argv: ['node', 'emb-agent', '--no-color', '--color=always'],
    env: { NO_COLOR: '1', FORCE_COLOR: '0' }
  });

  assert.equal(mode, 'always');
});
