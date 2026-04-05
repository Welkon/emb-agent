#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEBOUNCE_CALLS = 5;

function getWarnPath(projectRoot) {
  const key = crypto.createHash('sha1').update(projectRoot).digest('hex');
  return path.join(os.tmpdir(), `emb-agent-ctx-${key}.json`);
}

function buildMessage(contextHygiene) {
  if (!contextHygiene || contextHygiene.level === 'stable') {
    return '';
  }

  const prefix = contextHygiene.level === 'suggest-clearing'
    ? 'EMB CONTEXT WARNING:'
    : 'EMB CONTEXT NOTICE:';
  const reasons = Array.isArray(contextHygiene.reasons) && contextHygiene.reasons.length > 0
    ? ` 原因: ${contextHygiene.reasons.join('；')}。`
    : '';

  return `${prefix} ${contextHygiene.recommendation}${reasons} 建议链路: ${contextHygiene.clear_hint}.`;
}

function shouldEmit(projectRoot, level) {
  const warnPath = getWarnPath(projectRoot);
  let warnData = { callsSinceWarn: 0, lastLevel: 'stable' };
  let firstWarn = true;

  if (fs.existsSync(warnPath)) {
    try {
      warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      firstWarn = false;
    } catch {
      warnData = { callsSinceWarn: 0, lastLevel: 'stable' };
    }
  }

  warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;
  const severityEscalated =
    level === 'suggest-clearing' && warnData.lastLevel !== 'suggest-clearing';

  if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
    fs.writeFileSync(warnPath, JSON.stringify(warnData), 'utf8');
    return false;
  }

  warnData.callsSinceWarn = 0;
  warnData.lastLevel = level;
  fs.writeFileSync(warnPath, JSON.stringify(warnData), 'utf8');
  return true;
}

let input = '';
function runHook(rawInput) {
  const data = typeof rawInput === 'string'
    ? (rawInput.trim() ? JSON.parse(rawInput) : {})
    : (rawInput || {});
  const cwd = data.cwd || process.cwd();
  const projectRoot = path.resolve(cwd);
  const cli = require(path.join(__dirname, '..', 'bin', 'emb-agent.cjs'));
  const previousCwd = process.cwd();

  try {
    process.chdir(projectRoot);
    const status = cli.buildStatus();
    const contextHygiene = status.context_hygiene;
    const message = buildMessage(contextHygiene);

    if (!message || !contextHygiene || contextHygiene.level === 'stable') {
      return '';
    }

    if (!shouldEmit(projectRoot, contextHygiene.level)) {
      return '';
    }

    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: data.hook_event_name || data.event || 'PostToolUse',
        additionalContext: message
      }
    });
  } finally {
    process.chdir(previousCwd);
  }
}

if (require.main === module) {
  const stdinTimeout = setTimeout(() => process.exit(0), 5000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
  });

  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);

    try {
      const output = runHook(input);
      if (output) {
        process.stdout.write(output);
      }
    } catch {
      process.exit(0);
    }
  });
}

module.exports = {
  buildMessage,
  shouldEmit,
  runHook
};
