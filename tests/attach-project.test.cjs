'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('attach seeds hw and req truth from existing project inputs', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-attach-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G_datasheet.md'), '# ds\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, 'docs', 'board.SchDoc'), 'schematic\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, 'src', 'main.c'), 'void main(void) {}\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, 'project.ioc'), '# ioc\n', 'utf8');

    process.chdir(tempProject);
    cli.main([
      'attach',
      '--mcu',
      'PMS150G',
      '--board',
      'DemoBoard',
      '--target',
      'vendor-ide-project',
      '--goal',
      'stabilize wakeup path'
    ]);

    const hwContent = fs.readFileSync(path.join(tempProject, 'emb-agent', 'hw.yaml'), 'utf8');
    const reqContent = fs.readFileSync(path.join(tempProject, 'emb-agent', 'req.yaml'), 'utf8');
    const status = cli.buildStatus();

    assert.match(hwContent, /model: "PMS150G"/);
    assert.match(hwContent, /name: "DemoBoard"/);
    assert.match(hwContent, /target: "vendor-ide-project"/);
    assert.match(hwContent, /docs\/PMS150G_datasheet\.md/);
    assert.match(hwContent, /docs\/board\.SchDoc/);
    assert.match(hwContent, /src\/main\.c/);
    assert.match(hwContent, /project\.ioc/);
    assert.match(reqContent, /stabilize wakeup path/);
    assert.match(reqContent, /docs\/PMS150G_datasheet\.md/);
    assert.equal(status.last_files.includes('src/main.c'), true);
    assert.equal(status.last_files.includes('project.ioc'), true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
