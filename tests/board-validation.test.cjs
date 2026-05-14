'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('verify board records bench validation and syncs explicit board truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-board-validation-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main([
      'verify',
      'board',
      '--result',
      'pass',
      '--build',
      'sleep-retry-official',
      '--metric',
      'standby current <35uA',
      '--evidence',
      'bench measurement by user',
      '--truth',
      'KEY and USB wake from sleep are validated on the real board',
      'Validated sleep wake path on board'
    ]);

    const markdownPath = path.join(tempProject, '.emb-agent', 'board-truth', 'BOARD-VALIDATION.md');
    const jsonPath = path.join(tempProject, '.emb-agent', 'board-truth', 'board-validation.json');
    const hwPath = path.join(tempProject, '.emb-agent', 'hw.yaml');

    assert.equal(fs.existsSync(markdownPath), true);
    assert.equal(fs.existsSync(jsonPath), true);

    const markdown = fs.readFileSync(markdownPath, 'utf8');
    assert.match(markdown, /Validated sleep wake path on board/);
    assert.match(markdown, /sleep-retry-official/);
    assert.match(markdown, /standby current <35uA/);
    assert.match(markdown, /KEY and USB wake from sleep are validated/);

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(json.records[0].result, 'pass');
    assert.equal(json.records[0].build, 'sleep-retry-official');

    const hw = fs.readFileSync(hwPath, 'utf8');
    assert.match(hw, /KEY and USB wake from sleep are validated on the real board/);
    assert.match(hw, /bench measurement by user/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
