'use strict';

let delayMs = 200;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--delay-ms') {
    delayMs = Number.parseInt(process.argv[index + 1] || '200', 10);
    index += 1;
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const worker = payload.launch && payload.launch.worker ? payload.launch.worker : {};
  const phase = String(worker.phase || 'research');

  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      status: 'ok',
      worker_result: {
        agent: worker.agent || '',
        phase,
        status: 'ok',
        summary: `${worker.agent || 'worker'} completed ${phase}`,
        output_kind: phase === 'verification' ? 'verification' : 'research',
        fresh_context: Boolean(worker.fresh_context_required),
        updated_at: new Date().toISOString()
      }
    }));
  }, Number.isInteger(delayMs) && delayMs > 0 ? delayMs : 200);
});
