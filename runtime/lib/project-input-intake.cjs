'use strict';

function normalizeRelativePath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function listPdfDocs(detected) {
  return ((detected && detected.docs) || [])
    .map(normalizeRelativePath)
    .filter(Boolean)
    .filter(item => item.toLowerCase().endsWith('.pdf'));
}

function listSchematicFiles(detected) {
  return ((detected && detected.schematics) || [])
    .map(normalizeRelativePath)
    .filter(Boolean);
}

function listIngestedDocSources(projectRoot, ingestDocCli) {
  if (!projectRoot || !ingestDocCli || typeof ingestDocCli.listDocs !== 'function') {
    return new Set();
  }

  try {
    const listing = ingestDocCli.listDocs(projectRoot);
    return new Set(
      ((listing && listing.documents) || [])
        .map(item => normalizeRelativePath(item && (item.source || item.source_path || '')))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function listIngestedSchematicSources(projectRoot, deps) {
  const {
    fs,
    path,
    runtime
  } = deps || {};

  if (!projectRoot || !fs || !path || !runtime || typeof runtime.getProjectExtDir !== 'function') {
    return new Set();
  }

  const cacheRoot = path.join(runtime.getProjectExtDir(projectRoot), 'cache', 'schematics');
  if (!fs.existsSync(cacheRoot) || !fs.statSync(cacheRoot).isDirectory()) {
    return new Set();
  }

  const results = new Set();
  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });

  entries.forEach(entry => {
    if (!entry.isDirectory()) {
      return;
    }

    const summaryPath = path.join(cacheRoot, entry.name, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      return;
    }

    try {
      const summary = runtime.readJson(summaryPath);
      const sourcePath = normalizeRelativePath(summary && summary.source_path);
      if (sourcePath) {
        results.add(sourcePath);
      }
    } catch {
      // Ignore malformed cache entries; intake should remain actionable.
    }
  });

  return results;
}

function buildPendingProjectInputIntake(projectRoot, options = {}) {
  const detectProjectInputs =
    options.detectProjectInputs && typeof options.detectProjectInputs === 'function'
      ? options.detectProjectInputs
      : null;
  const runtime = options.runtime || null;
  const ingestDocCli = options.ingestDocCli || null;
  const detected = options.detected || (detectProjectInputs ? detectProjectInputs(projectRoot) : {}) || {};
  const schematics = listSchematicFiles(detected);
  const docs = listPdfDocs(detected);
  const ingestedDocSources = listIngestedDocSources(projectRoot, ingestDocCli);
  const ingestedSchematicSources = listIngestedSchematicSources(projectRoot, options);
  const pendingSchematics = schematics.filter(item => !ingestedSchematicSources.has(normalizeRelativePath(item)));
  const pendingDocs = docs.filter(item => !ingestedDocSources.has(normalizeRelativePath(item)));
  const hwPath = runtime && typeof runtime.getProjectAssetRelativePath === 'function'
    ? runtime.getProjectAssetRelativePath('hw.yaml')
    : '.emb-agent/hw.yaml';

  let preferred = null;
  if (pendingSchematics.length > 0) {
    preferred = {
      type: 'schematic',
      file: pendingSchematics[0],
      summary: `Discovered schematic ${pendingSchematics[0]}. Normalize it first so the agent can inspect controller/package candidates before editing ${hwPath}.`,
      cli: `ingest schematic --file ${pendingSchematics[0]}`,
      argv: ['ingest', 'schematic', '--file', pendingSchematics[0]]
    };
  } else if (pendingDocs.length > 0) {
    preferred = {
      type: 'doc',
      file: pendingDocs[0],
      summary: `Discovered hardware PDF ${pendingDocs[0]}. Parse it into staged hardware facts before confirming the MCU/package in ${hwPath}.`,
      cli: `ingest doc --file ${pendingDocs[0]} --kind datasheet --to hardware`,
      argv: ['ingest', 'doc', '--file', pendingDocs[0], '--kind', 'datasheet', '--to', 'hardware']
    };
  }

  return {
    detected,
    docs,
    schematics,
    pending_docs: pendingDocs,
    pending_schematics: pendingSchematics,
    preferred
  };
}

module.exports = {
  buildPendingProjectInputIntake,
  listIngestedDocSources,
  listIngestedSchematicSources,
  listPdfDocs,
  listSchematicFiles,
  normalizeRelativePath
};
