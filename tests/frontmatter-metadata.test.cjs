'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');
const commandsDir = path.join(repoRoot, 'commands', 'emb');
const packageJsonPath = path.join(repoRoot, 'package.json');

function readMarkdownFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort();
}

function extractFrontmatter(content, file) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} is missing valid frontmatter`);
  return match[1];
}

function extractScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function extractList(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s.+\\n?)*)`, 'm'));
  if (!match) {
    return [];
  }

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^-\s+/, '').trim());
}

test('all agent markdown files require name description tools and color', () => {
  const files = readMarkdownFiles(agentsDir);
  assert.ok(files.length > 0, 'agents/ cannot be empty');

  for (const file of files) {
    const fullPath = path.join(agentsDir, file);
    const frontmatter = extractFrontmatter(fs.readFileSync(fullPath, 'utf8'), file);
    const name = extractScalar(frontmatter, 'name');
    const description = extractScalar(frontmatter, 'description');
    const tools = extractScalar(frontmatter, 'tools');
    const color = extractScalar(frontmatter, 'color');

    assert.ok(name, `${file} is missing name`);
    assert.ok(description, `${file} is missing description`);
    assert.ok(tools, `${file} is missing tools`);
    assert.ok(color, `${file} is missing color`);
  }
});

test('all emb commands declare allowed-tools with at least one entry', () => {
  const files = readMarkdownFiles(commandsDir);
  assert.ok(files.length > 0, 'commands/emb cannot be empty');

  for (const file of files) {
    const fullPath = path.join(commandsDir, file);
    const frontmatter = extractFrontmatter(fs.readFileSync(fullPath, 'utf8'), file);
    const name = extractScalar(frontmatter, 'name');
    const description = extractScalar(frontmatter, 'description');
    const allowedTools = extractList(frontmatter, 'allowed-tools');

    assert.ok(name, `${file} is missing name`);
    assert.ok(description, `${file} is missing description`);
    assert.ok(allowedTools.length > 0, `${file} is missing allowed-tools entries`);
  }
});

test('absorbed engineering workflow stays in commands and agents, not core skills', () => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills')), false, 'emb-agent core should not ship a top-level skills catalog');
  assert.equal(
    packageJson.files.includes('skills'),
    false,
    'package.json should not publish a generic top-level skills catalog'
  );

  const bugHunter = fs.readFileSync(path.join(agentsDir, 'emb-bug-hunter.md'), 'utf8');
  const fwDoer = fs.readFileSync(path.join(agentsDir, 'emb-fw-doer.md'), 'utf8');
  const taskCommand = fs.readFileSync(path.join(commandsDir, 'task.md'), 'utf8');
  const skillsCommand = fs.readFileSync(path.join(commandsDir, 'skills.md'), 'utf8');

  assert.match(bugHunter, /fast feedback loop/);
  assert.match(bugHunter, /falsifiable prediction/);
  assert.match(fwDoer, /vertical slices/);
  assert.match(taskCommand, /vertical slices/);
  assert.match(skillsCommand, /optional integration surfaces/);
});
