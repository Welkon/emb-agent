'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const runtime = require(path.join(__dirname, 'runtime.cjs'));

function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function hashString(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function getDocsCacheRoot(projectRoot) {
  return path.join(runtime.getProjectExtDir(projectRoot), 'cache', 'docs');
}

function getDocsIndexPath(projectRoot) {
  return path.join(getDocsCacheRoot(projectRoot), 'index.json');
}

function normalizeDiffSelection(input, timeField) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const docId = String(input.doc_id || '').trim();
  const to = String(input.to || '').trim();
  if (!docId || !['hardware', 'requirements'].includes(to)) {
    return null;
  }

  return {
    doc_id: docId,
    to,
    only: runtime.unique((input.only || []).map(item => String(item || '').trim()).filter(Boolean)),
    force: Boolean(input.force),
    target: String(input.target || '').trim(),
    draft: String(input.draft || '').trim(),
    [timeField]: String(input[timeField] || '').trim()
  };
}

function normalizeLastDiffSelection(input) {
  return normalizeDiffSelection(input, 'recorded_at');
}

function normalizePresetName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(normalized)) {
    throw new Error('Preset name must match [a-z0-9][a-z0-9._-]{0,31}');
  }
  return normalized;
}

function normalizeDiffPresets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const result = {};
  for (const [name, value] of Object.entries(input)) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      continue;
    }
    const normalizedValue = normalizeDiffSelection(value, 'saved_at');
    if (!normalizedValue) {
      continue;
    }
    result[normalizedName] = normalizedValue;
  }
  return result;
}

function ensureDocsCache(projectRoot) {
  runtime.ensureDir(getDocsCacheRoot(projectRoot));
}

function loadDocsIndex(projectRoot) {
  const indexPath = getDocsIndexPath(projectRoot);
  if (!fs.existsSync(indexPath)) {
    return { version: 1, documents: [] };
  }

  const raw = runtime.readJson(indexPath);
  return {
    version: Number(raw.version || 1),
    documents: Array.isArray(raw.documents) ? raw.documents : [],
    session: {
      last_diff: normalizeLastDiffSelection(raw.session && raw.session.last_diff),
      diff_presets: normalizeDiffPresets(raw.session && raw.session.diff_presets)
    }
  };
}

function saveDocsIndex(projectRoot, index) {
  const payload = {
    version: Number((index && index.version) || 1),
    documents: Array.isArray(index && index.documents) ? index.documents : []
  };
  const lastDiff = normalizeLastDiffSelection(index && index.session && index.session.last_diff);
  const diffPresets = normalizeDiffPresets(index && index.session && index.session.diff_presets);
  if (lastDiff || Object.keys(diffPresets).length > 0) {
    payload.session = {};
    if (lastDiff) {
      payload.session.last_diff = lastDiff;
    }
    if (Object.keys(diffPresets).length > 0) {
      payload.session.diff_presets = diffPresets;
    }
  }
  runtime.writeJson(getDocsIndexPath(projectRoot), payload);
}

function buildCacheKey(input) {
  return hashString(JSON.stringify(input));
}

function getDocumentDir(projectRoot, docId) {
  return path.join(getDocsCacheRoot(projectRoot), docId);
}

function writeDocumentArtifacts(projectRoot, docId, artifactMap) {
  const docDir = getDocumentDir(projectRoot, docId);
  runtime.ensureDir(docDir);

  for (const [name, value] of Object.entries(artifactMap)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const filePath = path.join(docDir, name);
    if (typeof value === 'string') {
      fs.writeFileSync(filePath, value, 'utf8');
      continue;
    }

    runtime.writeJson(filePath, value);
  }

  return docDir;
}

function upsertDocumentIndex(projectRoot, entry) {
  const index = loadDocsIndex(projectRoot);
  const nextDocuments = index.documents.filter(item => item.doc_id !== entry.doc_id);
  nextDocuments.unshift(entry);
  saveDocsIndex(projectRoot, {
    version: index.version || 1,
    documents: nextDocuments,
    session: index.session || {}
  });
  return {
    index_path: path.relative(projectRoot, getDocsIndexPath(projectRoot)),
    documents: nextDocuments
  };
}

function updateDocumentEntry(projectRoot, docId, updater) {
  const index = loadDocsIndex(projectRoot);
  let updatedEntry = null;
  const nextDocuments = index.documents.map(item => {
    if (item.doc_id !== docId) {
      return item;
    }

    updatedEntry = updater({ ...item });
    return updatedEntry;
  });

  if (!updatedEntry) {
    return null;
  }

  saveDocsIndex(projectRoot, {
    version: index.version || 1,
    documents: nextDocuments,
    session: index.session || {}
  });

  return updatedEntry;
}

function getCachedEntry(projectRoot, docId) {
  const index = loadDocsIndex(projectRoot);
  return index.documents.find(item => item.doc_id === docId) || null;
}

function setLastDiffSelection(projectRoot, diffSelection) {
  const index = loadDocsIndex(projectRoot);
  const lastDiff = normalizeLastDiffSelection(diffSelection);
  saveDocsIndex(projectRoot, {
    version: index.version || 1,
    documents: index.documents,
    session: {
      ...(index.session || {}),
      last_diff: lastDiff
    }
  });
  return lastDiff;
}

function getLastDiffSelection(projectRoot) {
  const index = loadDocsIndex(projectRoot);
  return (index.session && index.session.last_diff) || null;
}

function setDiffPreset(projectRoot, name, diffSelection) {
  const presetName = normalizePresetName(name);
  if (!presetName) {
    throw new Error('Missing preset name');
  }

  const index = loadDocsIndex(projectRoot);
  const presets = normalizeDiffPresets(index.session && index.session.diff_presets);
  const presetValue = normalizeDiffSelection(
    {
      ...(diffSelection || {}),
      saved_at: new Date().toISOString()
    },
    'saved_at'
  );
  if (!presetValue) {
    throw new Error(`Invalid diff preset payload for ${presetName}`);
  }

  presets[presetName] = presetValue;
  saveDocsIndex(projectRoot, {
    version: index.version || 1,
    documents: index.documents,
    session: {
      ...(index.session || {}),
      diff_presets: presets
    }
  });

  return {
    name: presetName,
    ...presetValue
  };
}

function getDiffPreset(projectRoot, name) {
  const presetName = normalizePresetName(name);
  if (!presetName) {
    return null;
  }

  const index = loadDocsIndex(projectRoot);
  const presets = normalizeDiffPresets(index.session && index.session.diff_presets);
  const preset = presets[presetName];
  if (!preset) {
    return null;
  }

  return {
    name: presetName,
    ...preset
  };
}

function buildDocumentIdentity(projectRoot, filePath, options) {
  const absolutePath = path.resolve(projectRoot, filePath);
  runtime.requireFile(absolutePath, 'Document source');
  const buffer = fs.readFileSync(absolutePath);
  const sourceHash = hashBuffer(buffer);
  const relativePath = path.relative(projectRoot, absolutePath);
  const docId = buildCacheKey({
    provider: options.provider,
    kind: options.kind,
    file: relativePath,
    source_hash: sourceHash,
    pages: options.pages || '',
    language: options.language || '',
    ocr: Boolean(options.ocr)
  }).slice(0, 16);

  return {
    doc_id: docId,
    absolute_path: absolutePath,
    source_path: relativePath,
    source_hash: sourceHash
  };
}

module.exports = {
  buildCacheKey,
  buildDocumentIdentity,
  ensureDocsCache,
  getCachedEntry,
  getDiffPreset,
  getLastDiffSelection,
  getDocumentDir,
  getDocsCacheRoot,
  getDocsIndexPath,
  hashBuffer,
  hashString,
  loadDocsIndex,
  saveDocsIndex,
  setDiffPreset,
  setLastDiffSelection,
  updateDocumentEntry,
  upsertDocumentIndex,
  writeDocumentArtifacts
};
