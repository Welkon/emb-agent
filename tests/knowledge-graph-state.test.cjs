'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const knowledgeGraphState = require(path.join(repoRoot, 'runtime', 'lib', 'knowledge-graph-state.cjs'));

test('knowledge graph state shares tracked manifest freshness', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-graph-state-'));
  const projectEmbDir = path.join(tempProject, '.emb-agent');
  fs.mkdirSync(path.join(projectEmbDir, 'formulas'), { recursive: true });
  fs.mkdirSync(path.join(projectEmbDir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(projectEmbDir, 'firmware-snippets'), { recursive: true });
  fs.mkdirSync(path.join(projectEmbDir, 'wiki', 'chips'), { recursive: true });
  fs.mkdirSync(path.join(projectEmbDir, 'graph', 'cache'), { recursive: true });

  fs.writeFileSync(path.join(projectEmbDir, 'project.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'hw.yaml'), 'chip: SC8P052B\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'req.yaml'), 'requirements: []\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'formulas', 'timer.json'), '{"kind":"timer"}\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'runs', 'timer.json'), '{"registers":["TM2CON"]}\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'firmware-snippets', 'pwm.md'), '# PWM\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'wiki', 'chips', 'sc8p052b.md'), '# SC8P052B\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'wiki', 'index.md'), '# Index\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'wiki', 'log.md'), '# Log\n', 'utf8');

  const deps = { fs, path, runtime };
  const tracked = knowledgeGraphState
    .listKnowledgeGraphTrackedFiles(tempProject, deps)
    .map(filePath => path.relative(tempProject, filePath).replace(/\\/g, '/'));

  assert.ok(tracked.includes('.emb-agent/runs/timer.json'));
  assert.ok(tracked.includes('.emb-agent/firmware-snippets/pwm.md'));
  assert.ok(tracked.includes('.emb-agent/wiki/chips/sc8p052b.md'));
  assert.equal(tracked.includes('.emb-agent/wiki/index.md'), false);
  assert.equal(tracked.includes('.emb-agent/wiki/log.md'), false);

  const missing = knowledgeGraphState.summarizeKnowledgeGraph(tempProject, deps);
  assert.equal(missing.state, 'missing');
  assert.deepEqual(missing.next_steps, ['knowledge graph refresh']);

  const manifest = knowledgeGraphState.buildKnowledgeGraphManifest(tempProject, deps);
  const graph = {
    version: 'emb-agent.graph/1',
    stats: {
      nodes: 1,
      edges: 0,
      ambiguous_edges: 0
    },
    manifest
  };
  fs.writeFileSync(path.join(projectEmbDir, 'graph', 'graph.json'), JSON.stringify(graph, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'graph', 'cache', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const fresh = knowledgeGraphState.summarizeKnowledgeGraph(tempProject, deps);
  assert.equal(fresh.state, 'fresh');
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.next_steps, []);

  fs.writeFileSync(path.join(projectEmbDir, 'runs', 'timer.json'), '{"registers":["TM2CON","PWMCON"]}\n', 'utf8');
  fs.writeFileSync(path.join(projectEmbDir, 'wiki', 'chips', 'timers.md'), '# Timers\n', 'utf8');

  const stale = knowledgeGraphState.summarizeKnowledgeGraph(tempProject, deps);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.stale, true);
  assert.ok(stale.modified_files.includes('.emb-agent/runs/timer.json'));
  assert.ok(stale.added_files.includes('.emb-agent/wiki/chips/timers.md'));
  assert.ok(stale.next_steps.includes('knowledge graph refresh'));
});
