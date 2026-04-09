'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('scan save appends scan snapshot to hardware logic doc', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scan-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.writeFileSync(path.join(tempProject, 'main.c'), 'void main(void) {}\n', 'utf8');

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['last-files', 'add', 'main.c']);
    cli.main([
      'scan',
      'save',
      'hardware',
      'Mapped current firmware entry and truth sources',
      '--fact',
      'main.c is current entry reference',
      '--question',
      'Need pin map confirmation from schematic',
      '--read',
      'docs/PMS150G-manual.md'
    ]);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md'), 'utf8');
    const hwTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.match(content, /## Emb-Agent Scans/);
    assert.match(content, /Mapped current firmware entry and truth sources/);
    assert.match(content, /main\.c is current entry reference/);
    assert.match(content, /Need pin map confirmation from schematic/);
    assert.match(content, /docs\/PMS150G-manual\.md/);
    assert.match(content, /profile=baremetal-8bit/);
    assert.match(hwTruth, /main\.c is current entry reference/);
    assert.match(hwTruth, /Need pin map confirmation from schematic/);
    assert.match(hwTruth, /docs\/PMS150G-manual\.md/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('scan save can create debug notes target when missing', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scan-debug-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.unlinkSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md'));

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main([
      'scan',
      'save',
      'debug',
      'Scanned wakeup path and current debug gaps',
      '--question',
      'Need scope capture on wakeup edge'
    ]);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md'), 'utf8');

    assert.match(content, /# .* Debug Notes/);
    assert.match(content, /## Emb-Agent Scans/);
    assert.match(content, /Scanned wakeup path and current debug gaps/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
