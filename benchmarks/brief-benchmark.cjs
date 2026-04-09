#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    runs: 3,
    commands: ['next', 'plan', 'review', 'verify'],
    runtimeCli: path.join(__dirname, '..', 'runtime', 'bin', 'emb-agent.cjs'),
    output: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--project' && next) {
      args.project = path.resolve(next);
      index += 1;
      continue;
    }

    if (token === '--runs' && next) {
      const value = Number(next);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --runs value: ${next}`);
      }
      args.runs = value;
      index += 1;
      continue;
    }

    if (token === '--commands' && next) {
      args.commands = next
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      if (args.commands.length === 0) {
        throw new Error('Invalid --commands value');
      }
      index += 1;
      continue;
    }

    if (token === '--runtime-cli' && next) {
      args.runtimeCli = path.resolve(next);
      index += 1;
      continue;
    }

    if (token === '--output' && next) {
      args.output = path.resolve(next);
      index += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function usage() {
  const lines = [
    'brief-benchmark usage:',
    '  node benchmarks/brief-benchmark.cjs [--project <path>] [--runs <n>]',
    '      [--commands "next,plan,review,verify"] [--runtime-cli <path>]',
    '      [--output <result.json>]',
    '',
    'Example:',
    '  node benchmarks/brief-benchmark.cjs --project . --runs 5 --output ./benchmarks/results/brief.json'
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function parseCommand(command) {
  return String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function median(values) {
  const list = values.slice().sort((a, b) => a - b);
  if (list.length === 0) {
    return 0;
  }
  const mid = Math.floor(list.length / 2);
  if (list.length % 2 === 1) {
    return list[mid];
  }
  return (list[mid - 1] + list[mid]) / 2;
}

function estimateTokensFromText(text) {
  return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 4);
}

async function runCli(cliModule, projectRoot, commandTokens, brief) {
  const args = commandTokens.slice();
  if (brief) {
    args.push('--brief');
  }

  const previousCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  const started = process.hrtime.bigint();

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = chunk => {
    stderr += String(chunk);
    return true;
  };

  try {
    process.chdir(projectRoot);
    await cliModule.main(args);
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      ok: false,
      duration_ms: durationMs,
      error: String(error && error.message ? error.message : error),
      stderr: stderr.trim()
    };
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    ok: true,
    duration_ms: durationMs,
    bytes: Buffer.byteLength(stdout, 'utf8'),
    estimated_tokens: estimateTokensFromText(stdout),
    raw_output: stdout
  };
}

function buildModeSummary(records) {
  const durations = records.map(item => item.duration_ms);
  const bytes = records.map(item => item.bytes);
  const tokens = records.map(item => item.estimated_tokens);

  return {
    median_duration_ms: Number(median(durations).toFixed(2)),
    median_bytes: Math.round(median(bytes)),
    median_estimated_tokens: Math.round(median(tokens))
  };
}

function buildRow(command, fullRecords, briefRecords) {
  const full = buildModeSummary(fullRecords);
  const brief = buildModeSummary(briefRecords);
  const tokenSavedPct = full.median_estimated_tokens > 0
    ? Number((((full.median_estimated_tokens - brief.median_estimated_tokens) / full.median_estimated_tokens) * 100).toFixed(2))
    : 0;
  const bytesSavedPct = full.median_bytes > 0
    ? Number((((full.median_bytes - brief.median_bytes) / full.median_bytes) * 100).toFixed(2))
    : 0;
  const speedup = brief.median_duration_ms > 0
    ? Number((full.median_duration_ms / brief.median_duration_ms).toFixed(2))
    : 0;

  return {
    command,
    full,
    brief,
    savings: {
      estimated_token_saved_pct: tokenSavedPct,
      bytes_saved_pct: bytesSavedPct,
      speedup_ratio_full_over_brief: speedup
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!fs.existsSync(args.runtimeCli)) {
    throw new Error(`runtime cli not found: ${args.runtimeCli}`);
  }
  if (!fs.existsSync(args.project)) {
    throw new Error(`project path not found: ${args.project}`);
  }

  const cliModule = require(args.runtimeCli);
  const rows = [];

  for (const command of args.commands) {
    const tokens = parseCommand(command);
    if (tokens.length === 0) {
      continue;
    }

    const fullRecords = [];
    const briefRecords = [];

    for (let trial = 0; trial < args.runs; trial += 1) {
      const fullResult = await runCli(cliModule, args.project, tokens, false);
      if (!fullResult.ok) {
        throw new Error(`[${command}] full mode failed: ${fullResult.error}`);
      }
      fullRecords.push(fullResult);

      const briefResult = await runCli(cliModule, args.project, tokens, true);
      if (!briefResult.ok) {
        throw new Error(`[${command}] brief mode failed: ${briefResult.error}`);
      }
      briefRecords.push(briefResult);
    }

    rows.push(buildRow(command, fullRecords, briefRecords));
  }

  const summary = {
    avg_estimated_token_saved_pct: rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.savings.estimated_token_saved_pct, 0) / rows.length).toFixed(2))
      : 0,
    avg_bytes_saved_pct: rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.savings.bytes_saved_pct, 0) / rows.length).toFixed(2))
      : 0,
    avg_speedup_ratio_full_over_brief: rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.savings.speedup_ratio_full_over_brief, 0) / rows.length).toFixed(2))
      : 0
  };

  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      project: args.project,
      runs: args.runs,
      runtime_cli: args.runtimeCli,
      commands: args.commands
    },
    summary,
    rows
  };

  const payload = JSON.stringify(output, null, 2) + '\n';
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, payload, 'utf8');
    process.stdout.write(`Benchmark result written to ${args.output}\n`);
    return;
  }

  process.stdout.write(payload);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`brief-benchmark error: ${error.message}\n`);
    process.exit(1);
  });
}
