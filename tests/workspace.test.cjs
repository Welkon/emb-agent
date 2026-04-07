'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('workspace commands create list show and activate visible workspaces', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workspace-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const created = await captureCliJson(['workspace', 'add', 'Power stage bring-up', '--type', 'board']);
    const workspaceName = created.workspace.name;
    const workspaceDir = path.join(tempProject, '.emb-agent', 'workspace', workspaceName);

    assert.equal(created.created, true);
    assert.equal(created.workspace.type, 'board');
    assert.equal(fs.existsSync(path.join(workspaceDir, 'workspace.json')), true);
    assert.equal(fs.existsSync(path.join(workspaceDir, 'notes.md')), true);

    const listed = await captureCliJson(['workspace', 'list']);
    assert.ok(listed.workspaces.some(item => item.name === workspaceName));

    const shown = await captureCliJson(['workspace', 'show', workspaceName]);
    assert.equal(shown.workspace.name, workspaceName);
    assert.match(shown.workspace.notes, /# Workspace: Power stage bring-up/);

    const activated = await captureCliJson(['workspace', 'activate', workspaceName]);
    assert.equal(activated.activated, true);
    assert.equal(activated.workspace.status, 'ACTIVE');
    assert.equal(cli.loadSession().active_workspace.name, workspaceName);
    assert.equal(cli.loadSession().active_workspace.type, 'board');
    assert.equal(cli.loadSession().active_workspace.status, 'ACTIVE');
    assert.ok(cli.loadSession().last_files.includes(`.emb-agent/workspace/${workspaceName}/notes.md`));

    const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'workspace.json'), 'utf8'));
    const notes = fs.readFileSync(path.join(workspaceDir, 'notes.md'), 'utf8');
    assert.equal(manifest.status, 'ACTIVE');
    assert.match(notes, /Status: ACTIVE/);

    const resume = await captureCliJson(['resume']);
    assert.equal(resume.workspace.name, workspaceName);
    assert.equal(resume.workspace.type, 'board');
  } finally {
    process.chdir(currentCwd);
  }
});

test('workspace commands can link and unlink task spec and thread', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workspace-links-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const workspaceCreated = await captureCliJson(['workspace', 'add', 'Motor control lane', '--type', 'subsystem']);
    const workspaceName = workspaceCreated.workspace.name;

    const taskCreated = await captureCliJson(['task', 'add', 'Tune PWM ramp', '--type', 'implement']);
    const specCreated = await captureCliJson(['spec', 'add', 'PWM contract', '--type', 'interface']);
    const threadCreated = await captureCliJson(['thread', 'add', 'Track PWM edge jitter']);

    const taskName = taskCreated.task.name;
    const specName = specCreated.spec.name;
    const threadName = threadCreated.thread.name;

    const linkedTask = await captureCliJson(['workspace', 'link', workspaceName, 'task', taskName]);
    const linkedSpec = await captureCliJson(['workspace', 'link', workspaceName, 'spec', specName]);
    const linkedThread = await captureCliJson(['workspace', 'link', workspaceName, 'thread', threadName]);

    assert.equal(linkedTask.linked, true);
    assert.equal(linkedSpec.linked, true);
    assert.equal(linkedThread.linked, true);

    const shown = await captureCliJson(['workspace', 'show', workspaceName]);
    assert.ok(shown.workspace.links.tasks.some(item => item.name === taskName));
    assert.ok(shown.workspace.links.specs.some(item => item.name === specName));
    assert.ok(shown.workspace.links.threads.some(item => item.name === threadName));
    assert.equal(shown.workspace.link_counts.tasks, 1);
    assert.equal(shown.workspace.link_counts.specs, 1);
    assert.equal(shown.workspace.link_counts.threads, 1);
    assert.match(shown.workspace.notes, new RegExp(`- ${taskName}: Tune PWM ramp`));
    assert.match(shown.workspace.notes, new RegExp(`- ${specName}: PWM contract`));
    assert.match(shown.workspace.notes, new RegExp(`- ${threadName}: Track PWM edge jitter`));

    await captureCliJson(['workspace', 'activate', workspaceName]);
    assert.ok(cli.loadSession().last_files.includes(`.emb-agent/tasks/${taskName}/task.json`));
    assert.ok(cli.loadSession().last_files.includes(`.emb-agent/specs/${specName}.md`));
    assert.ok(cli.loadSession().last_files.includes(`.emb-agent/threads/${threadName}.md`));

    const resume = await captureCliJson(['resume']);
    assert.ok(resume.workspace.links.tasks.some(item => item.name === taskName));
    assert.ok(resume.workspace.links.specs.some(item => item.name === specName));
    assert.ok(resume.workspace.links.threads.some(item => item.name === threadName));

    const unlinked = await captureCliJson(['workspace', 'unlink', workspaceName, 'spec', specName]);
    assert.equal(unlinked.unlinked, true);
    assert.ok(!unlinked.workspace.links.specs.some(item => item.name === specName));
    assert.equal(unlinked.workspace.link_counts.specs, 0);
    assert.match(unlinked.workspace.notes, /## Linked Specs/);
    assert.match(unlinked.workspace.notes, /- \(none\)/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('workspace refresh absorbs current session context and inferred links', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workspace-refresh-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const workspaceCreated = await captureCliJson(['workspace', 'add', 'Sensor lane', '--type', 'domain']);
    const workspaceName = workspaceCreated.workspace.name;
    const taskCreated = await captureCliJson(['task', 'add', 'Calibrate ADC sampling', '--type', 'debug']);
    const specCreated = await captureCliJson(['spec', 'add', 'ADC interface contract', '--type', 'interface']);
    const threadCreated = await captureCliJson(['thread', 'add', 'Track ADC drift']);
    const taskName = taskCreated.task.name;
    const specName = specCreated.spec.name;
    const threadName = threadCreated.thread.name;

    await cli.main(['task', 'activate', taskName]);
    await cli.main(['thread', 'resume', threadName]);
    await cli.main(['last-files', 'add', `.emb-agent/specs/${specName}.md`]);
    await cli.main(['question', 'add', 'why adc zero drifts after wakeup']);
    await cli.main(['risk', 'add', 'sampling capacitor may not settle']);

    const refreshed = await captureCliJson(['workspace', 'refresh', workspaceName]);

    assert.equal(refreshed.refreshed, true);
    assert.ok(refreshed.added_links.tasks.includes(taskName));
    assert.ok(refreshed.added_links.specs.includes(specName));
    assert.ok(refreshed.added_links.threads.includes(threadName));
    assert.ok(refreshed.workspace.links.tasks.some(item => item.name === taskName));
    assert.ok(refreshed.workspace.links.specs.some(item => item.name === specName));
    assert.ok(refreshed.workspace.links.threads.some(item => item.name === threadName));
    assert.ok(refreshed.workspace.snapshot.last_files.includes(`.emb-agent/specs/${specName}.md`));
    assert.ok(refreshed.workspace.snapshot.open_questions.includes('why adc zero drifts after wakeup'));
    assert.ok(refreshed.workspace.snapshot.known_risks.includes('sampling capacitor may not settle'));
    assert.match(refreshed.workspace.notes, /## Key Files/);
    assert.match(refreshed.workspace.notes, new RegExp(`- \\.emb-agent/specs/${specName}\\.md`));
    assert.match(refreshed.workspace.notes, /## Current Questions/);
    assert.match(refreshed.workspace.notes, /why adc zero drifts after wakeup/);
    assert.match(refreshed.workspace.notes, /## Known Risks/);
    assert.match(refreshed.workspace.notes, /sampling capacitor may not settle/);

    const shown = await captureCliJson(['workspace', 'show', workspaceName]);
    assert.equal(shown.workspace.snapshot.refreshed_at !== '', true);
  } finally {
    process.chdir(currentCwd);
  }
});
