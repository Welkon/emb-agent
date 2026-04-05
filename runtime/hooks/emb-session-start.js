#!/usr/bin/env node

'use strict';

const path = require('path');

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
    const resume = cli.buildResumeContext();

    if (!resume.handoff) {
      return '';
    }

    const nextAction = resume.handoff.next_action || '先执行 resume 恢复现场';
    return [
      '## Emb-Agent Session Reminder',
      '',
      `发现未消费的 handoff，优先执行: ${resume.context_hygiene.resume_cli}`,
      `下一步: ${nextAction}`,
      `建议链路: ${resume.context_hygiene.clear_hint}`,
      ''
    ].join('\n');
  } finally {
    process.chdir(previousCwd);
  }
}

let input = '';

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
  runHook
};
