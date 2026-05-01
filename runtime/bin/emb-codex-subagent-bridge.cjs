#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[1]);
        return isObject(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(raw.slice(first, last + 1));
        return isObject(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function output(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function buildPrompt(payload) {
  const launch = isObject(payload.launch) ? payload.launch : {};
  const worker = isObject(launch.worker) ? launch.worker : {};
  const prompt = String(launch.prompt || '').trim();
  const contract = isObject(launch.contract) ? launch.contract : {};

  return [
    'You are executing one emb-agent delegated worker task.',
    '',
    'Return compact JSON only, with this shape:',
    '{"status":"ok|failed","worker_result":{"agent":"...","phase":"...","status":"ok|failed","summary":"...","output_kind":"research|implementation|verification","fresh_context":true|false}}',
    '',
    `Agent: ${worker.agent || ''}`,
    `Phase: ${worker.phase || 'research'}`,
    `Purpose: ${worker.purpose || ''}`,
    `Ownership: ${worker.ownership || ''}`,
    `Expected output: ${(worker.expected_output || []).join('; ')}`,
    '',
    'Dispatch contract:',
    JSON.stringify(contract, null, 2),
    '',
    'Worker prompt:',
    prompt || '(missing)'
  ].join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  const payload = parseJsonObject(input) || {};
  const launch = isObject(payload.launch) ? payload.launch : {};
  const worker = isObject(launch.worker) ? launch.worker : {};
  const projectRoot =
    payload.session && payload.session.project_root
      ? String(payload.session.project_root)
      : process.cwd();
  const prompt = buildPrompt(payload);
  const codexBin = process.env.EMB_AGENT_CODEX_BIN || 'codex';
  const args = [
    'exec',
    '--cd',
    projectRoot,
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'never',
    prompt
  ];

  const result = childProcess.spawnSync(codexBin, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: Number(process.env.EMB_AGENT_CODEX_BRIDGE_TIMEOUT_MS || 120000)
  });

  if (result.error) {
    output({
      status: 'failed',
      summary: result.error.message,
      worker_result: {
        agent: worker.agent || '',
        phase: worker.phase || '',
        status: 'failed',
        summary: result.error.message,
        output_kind: worker.phase === 'verification' ? 'verification' : 'research',
        fresh_context: Boolean(worker.fresh_context_required),
        updated_at: new Date().toISOString()
      }
    });
    return;
  }

  const parsed = parseJsonObject(result.stdout);
  if (parsed) {
    output(parsed);
    return;
  }

  const ok = result.status === 0;
  output({
    status: ok ? 'ok' : 'failed',
    summary: String(ok ? result.stdout : result.stderr || result.stdout || '').trim().slice(0, 1000),
    worker_result: {
      agent: worker.agent || '',
      phase: worker.phase || '',
      status: ok ? 'ok' : 'failed',
      summary: String(ok ? result.stdout : result.stderr || result.stdout || '').trim().slice(0, 1000),
      output_kind: worker.phase === 'verification' ? 'verification' : 'research',
      fresh_context: Boolean(worker.fresh_context_required),
      updated_at: new Date().toISOString()
    }
  });
});
