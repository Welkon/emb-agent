'use strict';

const GRAPH_REFRESH_STEP = 'knowledge graph refresh';

function unique(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function buildSavedToolRunFollowups(options) {
  const input = options && typeof options === 'object' ? options : {};
  const relativePath = String(input.relativePath || '').trim();
  const firstRegister = String(input.firstRegister || '').trim();
  const steps = Array.isArray(input.existing) ? input.existing.slice() : [];

  if (input.hasSnippetRequest && relativePath) {
    steps.push(`snippet draft --from-tool-output ${relativePath} --confirm`);
  }
  if (firstRegister && relativePath) {
    steps.push(`knowledge formula draft --from-tool-output ${relativePath} --confirm`);
    steps.push(GRAPH_REFRESH_STEP);
    steps.push(`knowledge graph explain ${firstRegister}`);
  } else {
    steps.push(GRAPH_REFRESH_STEP);
  }

  return unique(steps);
}

function buildFirmwareSnippetFollowups(options) {
  const input = options && typeof options === 'object' ? options : {};
  const artifactPath = String(input.artifactPath || '').trim();
  const firstRegister = String(input.firstRegister || '').trim();
  return unique([
    artifactPath ? `Review ${artifactPath}` : '',
    'Compile or static-check the project before applying source edits',
    'Patch firmware sources only after behavior couplings are reviewed',
    GRAPH_REFRESH_STEP,
    firstRegister ? `knowledge graph explain ${firstRegister}` : '',
    firstRegister ? `knowledge graph query ${firstRegister}` : ''
  ]);
}

function buildFormulaDraftFollowups(options) {
  const input = options && typeof options === 'object' ? options : {};
  const formulaId = String(input.formulaId || '').trim();
  const firstRegister = String(input.firstRegister || '').trim();
  return unique([
    GRAPH_REFRESH_STEP,
    formulaId ? `knowledge graph explain formula:${formulaId}` : '',
    firstRegister ? `knowledge graph query ${firstRegister}` : ''
  ]);
}

module.exports = {
  GRAPH_REFRESH_STEP,
  buildFirmwareSnippetFollowups,
  buildFormulaDraftFollowups,
  buildSavedToolRunFollowups,
  unique
};
