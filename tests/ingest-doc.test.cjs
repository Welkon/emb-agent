'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const ingestDocCli = require(path.join(repoRoot, 'runtime', 'scripts', 'ingest-doc.cjs'));

test('ingest doc caches parsed markdown and reuses cache on repeated call', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-doc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let parseCalls = 0;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument(request) {
          parseCalls += 1;
          assert.equal(path.basename(request.file_path), 'PMS150G.pdf');
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-demo',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PWM output supported\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const first = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    const status = cli.buildStatus();
    const cacheDir = path.join(tempProject, first.cache_dir);

    assert.equal(first.cached, false);
    assert.equal(parseCalls, 1);
    assert.equal(first.intended_to, 'hardware');
    assert.equal(first.write_mode, 'staged-truth');
    assert.equal(first.truth_write.direct, false);
    assert.equal(first.truth_write.performed, false);
    assert.equal(first.truth_write.requires_confirmation, true);
    assert.equal(first.truth_write.status, 'ready-to-apply');
    assert.equal(first.truth_write.domain, 'hardware');
    assert.equal(first.truth_write.target, '.emb-agent/hw.yaml');
    assert.equal(first.truth_write.apply_via, 'ingest apply doc');
    assert.equal(first.agent_analysis.recommended_agent, 'emb-hw-scout');
    assert.equal(first.agent_analysis.status, 'agent-analysis-recommended');
    assert.equal(first.agent_analysis.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.match(first.agent_analysis.init_command, /adapter analysis init --chip PMS150G --package SOP8/);
    assert.match(first.agent_analysis.derive_command, /adapter derive --from-analysis \.emb-agent\/analysis\/pms150g\.json/);
    assert.equal(first.recommended_flow.id, 'doc-to-chip-support-analysis');
    assert.equal(first.recommended_flow.mode, 'analysis-artifact-first');
    assert.equal(first.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');
    assert.equal(first.handoff_protocol.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.equal(first.apply_ready.to, 'hardware');
    assert.match(first.apply_ready.command, /ingest apply doc .* --to hardware/);
    assert.equal(fs.existsSync(path.join(cacheDir, 'parse.md')), true);
    assert.equal(fs.existsSync(path.join(cacheDir, 'parse.json')), true);
    assert.equal(fs.existsSync(path.join(cacheDir, 'summary.json')), true);
    assert.equal(fs.existsSync(path.join(cacheDir, 'source.json')), true);
    assert.equal(fs.existsSync(path.join(cacheDir, 'facts.hardware.yaml')), true);
    assert.equal(fs.existsSync(path.join(cacheDir, 'facts.hardware.json')), true);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'docs', 'index.json')),
      true
    );
    assert.match(
      fs.readFileSync(path.join(cacheDir, 'parse.md'), 'utf8'),
      /Timer16 exists/
    );
    assert.match(
      fs.readFileSync(path.join(cacheDir, 'facts.hardware.yaml'), 'utf8'),
      /package: "SOP8"/
    );
    assert.match(
      fs.readFileSync(path.join(cacheDir, 'facts.hardware.yaml'), 'utf8'),
      /Parsed document mentions peripheral PWM/
    );
    assert.match(
      fs.readFileSync(path.join(cacheDir, 'facts.hardware.yaml'), 'utf8'),
      /PA5 reserved for programming/
    );
    assert.equal(status.last_files[0], first.artifacts.markdown);
    const docsListBeforeApply = ingestDocCli.listDocs(tempProject);
    assert.equal(docsListBeforeApply.documents[0].intended_to, 'hardware');
    assert.equal(docsListBeforeApply.documents[0].apply_pending, true);
    const docViewBeforeApply = ingestDocCli.showDoc(tempProject, first.doc_id);
    assert.equal(docViewBeforeApply.auto_apply_ready.to, 'hardware');
    assert.match(docViewBeforeApply.auto_apply_ready.command, /ingest apply doc .* --to hardware/);
    assert.equal(docViewBeforeApply.summary_info.agent_analysis.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.equal(docViewBeforeApply.summary_info.recommended_flow.id, 'doc-to-chip-support-analysis');
    assert.equal(docViewBeforeApply.summary_info.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');

    const nextContext = cli.buildNextContext();
    assert.equal(nextContext.hardware_doc_analysis.recommended_agent, 'emb-hw-scout');
    assert.equal(nextContext.hardware_doc_analysis.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.equal(nextContext.recommended_flow.id, 'doc-to-chip-support-analysis');
    assert.equal(nextContext.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');
    assert.equal(nextContext.next.recommended_flow.id, 'doc-to-chip-support-analysis');
    assert.equal(nextContext.next.handoff_protocol.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.ok(nextContext.next_actions.some(item => item.includes('hardware_doc_analysis=emb-hw-scout')));
    assert.ok(nextContext.next_actions.some(item => item.startsWith('analysis_init=')));
    assert.ok(nextContext.next_actions.some(item => item.startsWith('analysis_derive=')));

    const second = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(second.cached, true);
    assert.equal(parseCalls, 1);
    assert.equal(second.write_mode, 'staged-truth');
    assert.equal(second.truth_write.status, 'ready-to-apply');
    assert.equal(second.agent_analysis.artifact_path, '.emb-agent/analysis/pms150g.json');

    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', first.doc_id, '--to', 'hardware'],
      { providerImpls }
    );

    const hwTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');
    const appliedStatus = cli.buildStatus();

    assert.equal(applied.write_mode, 'truth-write');
    assert.equal(applied.truth_write.direct, true);
    assert.equal(applied.truth_write.performed, true);
    assert.equal(applied.truth_write.status, 'written');
    assert.equal(applied.truth_write.domain, 'hardware');
    assert.equal(applied.truth_write.target, '.emb-agent/hw.yaml');
    assert.equal(applied.target, '.emb-agent/hw.yaml');
    assert.equal(applied.skipped, undefined);
    assert.match(hwTruth, /model: "PMS150G"/);
    assert.match(hwTruth, /package: "SOP8"/);
    assert.match(hwTruth, /PA5 reserved for programming/);
    assert.equal(appliedStatus.last_files[0], '.emb-agent/hw.yaml');

    const docsList = ingestDocCli.listDocs(tempProject);
    assert.equal(docsList.documents.length, 1);
    assert.equal(docsList.documents[0].doc_id, first.doc_id);
    assert.equal(docsList.documents[0].intended_to, 'hardware');
    assert.equal(docsList.documents[0].apply_pending, false);
    assert.equal(typeof docsList.documents[0].applied.hardware.applied_at, 'string');

    const docView = ingestDocCli.showDoc(tempProject, first.doc_id);
    assert.equal(docView.entry.doc_id, first.doc_id);
    assert.equal(docView.artifact_state.markdown, true);
    assert.equal(docView.parse_info.provider, 'mineru');
    assert.equal(docView.auto_apply_ready, null);
    assert.equal(docView.entry.applied.hardware.target, '.emb-agent/hw.yaml');

    const skipped = await cli.runIngestCommand(
      'apply',
      ['doc', first.doc_id, '--to', 'hardware'],
      { providerImpls }
    );
    const hwTruthAfterSkipped = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'already_applied');
    assert.equal(skipped.write_mode, 'truth-write');
    assert.equal(skipped.truth_write.performed, false);
    assert.equal(skipped.truth_write.status, 'already-applied');
    assert.equal(hwTruthAfterSkipped, hwTruth);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('apply doc supports selective field application with --only', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-apply-only-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-only',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(ingested.write_mode, 'staged-truth');
    assert.equal(ingested.truth_write.status, 'ready-to-apply');

    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--to', 'hardware', '--only', 'constraints,sources'],
      { providerImpls }
    );

    const hwTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.deepEqual(applied.only, ['constraints', 'sources']);
    assert.match(hwTruth, /constraints:\n  - "PA5 reserved for programming"/);
    assert.match(hwTruth, /datasheet:\n    - "docs\/PMS150G\.pdf"/);
    assert.match(hwTruth, /model: ""/);
    assert.match(hwTruth, /package: ""/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc diff previews selective hardware application before apply', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-diff-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-diff',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(ingested.write_mode, 'staged-truth');
    const diffView = ingestDocCli.diffDoc(
      tempProject,
      ingested.doc_id,
      'hardware',
      ['constraints', 'sources'],
      false
    );

    assert.deepEqual(diffView.only, ['constraints', 'sources']);
    assert.equal(diffView.target, '.emb-agent/hw.yaml');
    assert.equal(diffView.changes.find(item => item.field === 'constraints').action, 'append');
    assert.equal(diffView.changes.find(item => item.field === 'sources').action, 'append');
    assert.equal(diffView.changes.find(item => item.field === 'constraints').additions[0], 'PA5 reserved for programming');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('apply doc can replay the latest diff selection', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-replay-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-replay',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources'
    ]);

    const indexPath = path.join(tempProject, '.emb-agent', 'cache', 'docs', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.deepEqual(index.session.last_diff.only, ['constraints', 'sources']);
    assert.equal(index.session.last_diff.doc_id, ingested.doc_id);

    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--from-last-diff'],
      { providerImpls }
    );

    const hwTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.equal(applied.from_last_diff, true);
    assert.deepEqual(applied.only, ['constraints', 'sources']);
    assert.match(hwTruth, /constraints:\n  - "PA5 reserved for programming"/);
    assert.match(hwTruth, /datasheet:\n    - "docs\/PMS150G\.pdf"/);
    assert.match(hwTruth, /model: ""/);
    assert.match(hwTruth, /package: ""/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc show exposes the latest diff summary for the current doc', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-show-diff-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-show-diff',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources'
    ]);

    const docView = ingestDocCli.showDoc(tempProject, ingested.doc_id);

    assert.equal(docView.last_diff.current_doc, true);
    assert.equal(docView.last_diff.doc_id, ingested.doc_id);
    assert.equal(docView.last_diff.to, 'hardware');
    assert.deepEqual(docView.last_diff.only, ['constraints', 'sources']);
    assert.equal(docView.last_diff.target, '.emb-agent/hw.yaml');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc list exposes minimal last diff hit summary', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-list-diff-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-list-diff',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources'
    ]);

    const docsList = ingestDocCli.listDocs(tempProject);

    assert.equal(docsList.documents.length, 1);
    assert.equal(docsList.documents[0].doc_id, ingested.doc_id);
    assert.equal(docsList.documents[0].last_diff_hit, true);
    assert.equal(docsList.documents[0].last_diff_to, 'hardware');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc list exposes truncated preset summary for each document', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-list-presets-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-list-presets',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);
    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-fast'
    ]);
    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-bench'
    ]);
    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-prod'
    ]);

    const docsList = ingestDocCli.listDocs(tempProject);

    assert.equal(docsList.documents.length, 1);
    assert.equal(docsList.documents[0].preset_count, 4);
    assert.deepEqual(docsList.documents[0].preset_names, ['hw-bench', 'hw-fast', 'hw-prod']);
    assert.equal(docsList.documents[0].preset_names_more, 1);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc diff can save a named preset and apply can replay it', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-preset-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-preset',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);

    const indexPath = path.join(tempProject, '.emb-agent', 'cache', 'docs', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.deepEqual(index.session.diff_presets['hw-safe'].only, ['constraints', 'sources']);
    assert.equal(index.session.diff_presets['hw-safe'].to, 'hardware');

    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--preset', 'hw-safe'],
      { providerImpls }
    );

    const hwTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.equal(applied.from_preset, true);
    assert.equal(applied.replayed_preset.name, 'hw-safe');
    assert.deepEqual(applied.only, ['constraints', 'sources']);
    assert.match(hwTruth, /constraints:\n  - "PA5 reserved for programming"/);
    assert.match(hwTruth, /datasheet:\n    - "docs\/PMS150G\.pdf"/);
    assert.match(hwTruth, /model: ""/);
    assert.match(hwTruth, /package: ""/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc show exposes available diff presets with current-doc marker', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-show-presets-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-show-presets',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);

    const docView = ingestDocCli.showDoc(tempProject, ingested.doc_id);
    const preset = docView.diff_presets.find(item => item.name === 'hw-safe');

    assert.equal(Array.isArray(docView.diff_presets), true);
    assert.equal(preset.current_doc, true);
    assert.equal(preset.doc_id, ingested.doc_id);
    assert.equal(preset.to, 'hardware');
    assert.deepEqual(preset.only, ['constraints', 'sources']);
    assert.equal(preset.target, '.emb-agent/hw.yaml');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc show can preview a named preset on the current doc', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-show-preset-preview-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-show-preset-preview',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);

    const docView = ingestDocCli.showDoc(tempProject, ingested.doc_id, {
      preset: 'hw-safe'
    });

    assert.equal(docView.selected_preset.name, 'hw-safe');
    assert.equal(docView.selected_preset.current_doc, true);
    assert.equal(docView.preset_diff.doc_id, ingested.doc_id);
    assert.equal(docView.preset_diff.to, 'hardware');
    assert.deepEqual(docView.preset_diff.only, ['constraints', 'sources']);
    assert.equal(docView.preset_diff.changes.find(item => item.field === 'constraints').action, 'append');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc show can emit an apply-ready hint for a preset preview', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-show-apply-ready-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-show-apply-ready',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    await cli.main([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);

    const docView = ingestDocCli.showDoc(tempProject, ingested.doc_id, {
      preset: 'hw-safe',
      applyReady: true
    });

    assert.equal(docView.apply_ready.preset, 'hw-safe');
    assert.equal(docView.apply_ready.doc_id, ingested.doc_id);
    assert.equal(docView.apply_ready.to, 'hardware');
    assert.deepEqual(docView.apply_ready.only, ['constraints', 'sources']);
    assert.equal(docView.apply_ready.target, '.emb-agent/hw.yaml');
    assert.equal(
      docView.apply_ready.command,
      `node ~/.codex/emb-agent/bin/emb-agent.cjs ingest apply doc ${ingested.doc_id} --preset hw-safe`
    );
    assert.deepEqual(docView.apply_ready.argv, [
      'ingest',
      'apply',
      'doc',
      ingested.doc_id,
      '--preset',
      'hw-safe'
    ]);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
