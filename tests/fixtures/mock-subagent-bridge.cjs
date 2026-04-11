'use strict';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const worker = payload.launch && payload.launch.worker ? payload.launch.worker : {};
  const phase = String(worker.phase || 'research');
  const outputKind = phase === 'verification'
    ? 'verification'
    : phase === 'implementation'
      ? 'implementation'
      : 'research';

  process.stdout.write(JSON.stringify({
    status: 'ok',
    worker_result: {
      agent: worker.agent || '',
      phase,
      status: 'ok',
      summary: `${worker.agent || 'worker'} completed ${phase}`,
      output_kind: outputKind,
      fresh_context: Boolean(worker.fresh_context_required),
      updated_at: '2026-04-11T00:00:00.000Z'
    }
  }));
});
