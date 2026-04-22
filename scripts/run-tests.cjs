#!/usr/bin/env node
'use strict';

process.stderr.write(
  [
    '[run-tests] Automated wrapper execution is disabled for the emb-agent full suite.',
    '[run-tests] Nested runners can return false greens or top-level file failures in this environment.',
    '[run-tests] From the repo root, run:',
    '[run-tests] node --test --test-concurrency=1 --test-isolation=process emb-agent/tests/*.test.cjs'
  ].join('\n') + '\n'
);
process.exit(1);
