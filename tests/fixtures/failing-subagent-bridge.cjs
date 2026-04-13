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

  process.stdout.write(JSON.stringify({
    status: 'failed',
    worker_result: {
      agent: worker.agent || '',
      phase,
      status: 'failed',
      summary: `${worker.agent || 'worker'} failed ${phase}`,
      output_kind: phase === 'verification' ? 'verification' : 'research',
      fresh_context: Boolean(worker.fresh_context_required),
      updated_at: '2026-04-13T00:00:00.000Z'
    }
  }));
});
