'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');
const commandsDir = path.join(repoRoot, 'commands', 'emb');

function readMarkdownFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort();
}

function extractFrontmatter(content, file) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} 缺少有效 frontmatter`);
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
  assert.ok(files.length > 0, 'agents/ 不能为空');

  for (const file of files) {
    const fullPath = path.join(agentsDir, file);
    const frontmatter = extractFrontmatter(fs.readFileSync(fullPath, 'utf8'), file);
    const name = extractScalar(frontmatter, 'name');
    const description = extractScalar(frontmatter, 'description');
    const tools = extractScalar(frontmatter, 'tools');
    const color = extractScalar(frontmatter, 'color');

    assert.ok(name, `${file} 缺少 name`);
    assert.ok(description, `${file} 缺少 description`);
    assert.ok(tools, `${file} 缺少 tools`);
    assert.ok(color, `${file} 缺少 color`);
  }
});

test('all emb commands declare allowed-tools with at least one entry', () => {
  const files = readMarkdownFiles(commandsDir);
  assert.ok(files.length > 0, 'commands/emb 不能为空');

  for (const file of files) {
    const fullPath = path.join(commandsDir, file);
    const frontmatter = extractFrontmatter(fs.readFileSync(fullPath, 'utf8'), file);
    const name = extractScalar(frontmatter, 'name');
    const description = extractScalar(frontmatter, 'description');
    const allowedTools = extractList(frontmatter, 'allowed-tools');

    assert.ok(name, `${file} 缺少 name`);
    assert.ok(description, `${file} 缺少 description`);
    assert.ok(allowedTools.length > 0, `${file} 缺少 allowed-tools 条目`);
  }
});
