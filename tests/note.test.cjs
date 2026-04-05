'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('note add appends structured entry to hardware doc', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-note-'));
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
      'note',
      'add',
      'hardware',
      'PA5 is reserved for programming path',
      '--kind',
      'hardware_truth',
      '--evidence',
      'docs/PMS150G文档.md',
      '--unverified',
      'Need board-level probe confirmation'
    ]);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md'), 'utf8');
    const hwTruth = fs.readFileSync(path.join(tempProject, 'emb-agent', 'hw.yaml'), 'utf8');

    assert.match(content, /## Emb-Agent Notes/);
    assert.match(content, /PA5 is reserved for programming path/);
    assert.match(content, /hardware_truth/);
    assert.match(content, /docs\/PMS150G文档\.md/);
    assert.match(content, /Need board-level probe confirmation/);
    assert.match(hwTruth, /PA5 is reserved for programming path/);
    assert.match(hwTruth, /Need board-level probe confirmation/);
    assert.match(hwTruth, /docs\/PMS150G文档\.md/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('note add can create missing connectivity note target from template', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-note-rtos-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['profile', 'set', 'rtos-iot']);
    cli.main(['pack', 'add', 'connected-appliance']);
    cli.main([
      'note',
      'add',
      'connectivity',
      'Offline mode must keep local relay control available',
      '--kind',
      'safe_default',
      '--evidence',
      'local control requirement'
    ]);

    const connectivityPath = path.join(tempProject, 'docs', 'CONNECTIVITY.md');
    const content = fs.readFileSync(connectivityPath, 'utf8');

    assert.equal(fs.existsSync(connectivityPath), true);
    assert.match(content, /# .* Connectivity/);
    assert.match(content, /## Emb-Agent Notes/);
    assert.match(content, /Offline mode must keep local relay control available/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
