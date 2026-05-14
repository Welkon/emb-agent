#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const repoRoot = path.resolve(__dirname, '..');
const ITERATIONS = Number(process.env.EMB_BENCH_ITER || 25) || 25;

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-bench-'));
  const embDir = path.join(root, '.emb-agent');
  const taskDir = path.join(embDir, 'tasks', 'bench-task');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(embDir, 'project.json'), JSON.stringify({
    default_package: 'fw',
    active_package: 'fw'
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(embDir, '.developer'), JSON.stringify({ name: 'bench' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(embDir, '.current-task'), 'bench-task\n', 'utf8');
  fs.writeFileSync(path.join(embDir, 'hw.yaml'), [
    'mcu:',
    '  vendor: Espressif',
    '  model: ESP32-C3',
    '  package: QFN32',
    ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({
    name: 'bench-task',
    title: 'Benchmark statusline hook',
    status: 'active',
    priority: 'P2',
    package: 'fw'
  }, null, 2) + '\n', 'utf8');
  return root;
}

function timeRun(label, command, args, options) {
  const times = [];
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now();
    const result = childProcess.spawnSync(command, args, {
      ...options,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const elapsed = performance.now() - started;
    if (result.status !== 0 || result.error) {
      throw new Error(`${label} failed: ${result.error || result.stderr || result.stdout}`);
    }
    times.push(elapsed);
  }
  return summarize(label, times);
}

function summarize(label, times) {
  const sorted = times.slice().sort((left, right) => left - right);
  const sum = times.reduce((total, value) => total + value, 0);
  return {
    label,
    iterations: times.length,
    min_ms: sorted[0],
    median_ms: sorted[Math.floor(sorted.length / 2)],
    mean_ms: sum / times.length,
    max_ms: sorted[sorted.length - 1]
  };
}

function printSummary(summary) {
  console.log([
    summary.label.padEnd(28),
    `n=${summary.iterations}`,
    `min=${summary.min_ms.toFixed(1)}ms`,
    `median=${summary.median_ms.toFixed(1)}ms`,
    `mean=${summary.mean_ms.toFixed(1)}ms`,
    `max=${summary.max_ms.toFixed(1)}ms`
  ].join('  '));
}

function main() {
  childProcess.execFileSync('cargo', ['build', '-q', '-p', 'emb-agent-rs'], {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  const projectRoot = makeProject();
  const input = JSON.stringify({ cwd: projectRoot, cost: { total_duration_ms: 60000 } });
  const nodeHook = path.join(repoRoot, 'runtime', 'hooks', 'emb-statusline.js');
  const rustBinary = path.join(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'emb-agent-rs.exe' : 'emb-agent-rs');

  try {
    console.log(`emb-agent hook startup benchmark (${ITERATIONS} iterations)`);
    console.log(`project: ${projectRoot}`);
    console.log('');

    const results = [
      timeRun('node statusline hook', process.execPath, [nodeHook], {
        cwd: projectRoot,
        input
      }),
      timeRun('cargo run statusline', 'cargo', ['run', '-q', '-p', 'emb-agent-rs', '--', 'hook', 'statusline', '--cwd', projectRoot], {
        cwd: repoRoot
      }),
      timeRun('rust binary statusline', rustBinary, ['hook', 'statusline', '--cwd', projectRoot], {
        cwd: projectRoot
      })
    ];

    results.forEach(printSummary);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

main();
