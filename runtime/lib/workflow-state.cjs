'use strict';

const WORKFLOW_STATES = [
  'unknown',
  'hw_declared',
  'datasheet_ingested',
  'bootstrap_ready',
  'implementing',
  'board_verified',
  'resolved'
];

const WORKFLOW_NEXT = {
  unknown: { command: 'declare hardware', reason: 'Hardware not yet declared. Run declare hardware to set MCU, package, and constraints.' },
  hw_declared: { command: 'ingest doc', reason: 'Hardware declared. Ingest datasheet or schematic to populate chip truth.' },
  datasheet_ingested: { command: 'bootstrap run --confirm', reason: 'Datasheet ingested. Run bootstrap to initialize project.' },
  bootstrap_ready: { command: 'next', reason: 'Project bootstrapped. Follow next command for the shortest path.' },
  implementing: { command: 'capability run do', reason: 'Task in progress. Execute the current capability.' },
  board_verified: { command: 'verify', reason: 'Board verified. Run verify to close quality gates.' },
  resolved: { command: 'next', reason: 'Task resolved. Run next for the next task.' }
};

function getWorkflowNext(state) {
  return WORKFLOW_NEXT[state] || WORKFLOW_NEXT.unknown;
}

function hasChipIdentity(hwConfig) {
  if (!hwConfig || typeof hwConfig !== 'object') {
    return false;
  }
  if (typeof hwConfig.chip === 'string' && hwConfig.chip.trim()) {
    return true;
  }
  if (hwConfig.chip && typeof hwConfig.chip === 'object' && (hwConfig.chip.model || hwConfig.chip.name)) {
    return true;
  }
  if (hwConfig.mcu && (hwConfig.mcu.model || hwConfig.mcu.name)) {
    return true;
  }
  return false;
}

function hasDatasheet(hwConfig) {
  if (!hwConfig || typeof hwConfig !== 'object') {
    return false;
  }

  if (Array.isArray(hwConfig.datasheets)) {
    return hwConfig.datasheets.filter(Boolean).length > 0;
  }

  if (typeof hwConfig.datasheets === 'string') {
    return hwConfig.datasheets.trim() !== '';
  }

  if (Array.isArray(hwConfig.datasheet)) {
    return hwConfig.datasheet.filter(Boolean).length > 0;
  }

  if (typeof hwConfig.datasheet === 'string') {
    return hwConfig.datasheet.trim() !== '';
  }

  return false;
}

function bootstrapSignalReady(bootstrapState) {
  if (!bootstrapState || typeof bootstrapState !== 'object') {
    return false;
  }

  const status = String(bootstrapState.status || '').trim();
  const stage = String(bootstrapState.stage || '').trim();
  const currentStage = String(bootstrapState.current_stage || '').trim();
  const nextStage = bootstrapState.next_stage && typeof bootstrapState.next_stage === 'object'
    ? bootstrapState.next_stage
    : null;

  if (status === 'complete') {
    return true;
  }

  if (status === 'ready-for-next' && String(bootstrapState.command || '').trim() === 'next') {
    return true;
  }

  if (stage === 'continue-with-next' || currentStage === 'continue-with-next') {
    return true;
  }

  return currentStage === 'next-step' && (!nextStage || nextStage.id === 'next-step');
}

function hasBootstrapReadySignal(projectRoot, deps) {
  const helpers = deps && typeof deps === 'object' ? deps : {};
  const fs = helpers.fs;
  const path = helpers.path;

  if (!projectRoot || !fs || !path) {
    return false;
  }

  const supportDir = path.join(projectRoot, '.emb-agent', 'chip-support');
  if (fs.existsSync(supportDir)) {
    return true;
  }

  return false;
}

function resolveWorkflowState(hwConfig, activeTask, options) {
  const settings = options && typeof options === 'object' ? options : {};
  const bootstrapReady = Boolean(
    settings.bootstrapReady ||
    bootstrapSignalReady(settings.bootstrap) ||
    hasBootstrapReadySignal(settings.projectRoot, settings)
  );

  if (!hasChipIdentity(hwConfig)) {
    return 'unknown';
  }

  if (!hasDatasheet(hwConfig)) {
    return 'hw_declared';
  }

  if (!bootstrapReady) {
    return 'datasheet_ingested';
  }

  if (!activeTask) {
    return 'bootstrap_ready';
  }

  if (activeTask.status === 'completed' || activeTask.status === 'rejected') {
    return 'resolved';
  }

  if (activeTask.status === 'review') {
    return 'board_verified';
  }

  return 'implementing';
}

function readHardwareConfig(projectRoot, deps) {
  const helpers = deps && typeof deps === 'object' ? deps : {};
  const fs = helpers.fs;
  const path = helpers.path;
  const runtime = helpers.runtime;

  if (!projectRoot || !fs || !path) {
    return null;
  }

  const hwPath = runtime && typeof runtime.resolveProjectDataPath === 'function'
    ? runtime.resolveProjectDataPath(projectRoot, 'hw.yaml')
    : path.join(projectRoot, '.emb-agent', 'hw.yaml');

  if (!fs.existsSync(hwPath)) {
    return null;
  }

  const content = fs.readFileSync(hwPath, 'utf8');
  const lines = Array.isArray(content) ? content : String(content || '').split(/\r?\n/);

  function readIndentedKey(prefix) {
    const line = lines.find(item => item.startsWith(prefix));
    if (!line) return '';
    const value = line.slice(prefix.length).trim();
    const cleaned = value.replace(/^["']|["']$/g, '');
    return cleaned.trim();
  }

  const model = readIndentedKey('  model:');
  const vendor = readIndentedKey('  vendor:');
  const packageName = readIndentedKey('  package:');

  const config = {};
  if (model) {
    config.chip = model;
  }
  if (model || packageName) {
    config.mcu = {
      model: model || '',
      vendor: vendor || '',
      package: packageName || ''
    };
  }

  const datasheetLines = [];
  let inDatasheetBlock = false;
  for (const raw of lines) {
    if (raw.startsWith('  datasheet:')) {
      inDatasheetBlock = true;
      continue;
    }
    if (inDatasheetBlock && raw.startsWith('    - ')) {
      const val = raw.slice(6).trim().replace(/^["']|["']$/g, '');
      if (val) datasheetLines.push(val);
    } else if (inDatasheetBlock && raw.trim() === '') {
      continue;
    } else if (inDatasheetBlock && !raw.startsWith('    ')) {
      inDatasheetBlock = false;
    }
  }
  if (datasheetLines.length > 0) {
    config.datasheets = datasheetLines;
  }

  return config;
}

function resolveProjectWorkflowState(projectRoot, activeTask, deps) {
  const helpers = deps && typeof deps === 'object' ? deps : {};
  const hwConfig = helpers.hwConfig || readHardwareConfig(projectRoot, helpers);

  return resolveWorkflowState(hwConfig, activeTask, {
    ...helpers,
    projectRoot
  });
}

module.exports = {
  WORKFLOW_NEXT,
  WORKFLOW_STATES,
  bootstrapSignalReady,
  getWorkflowNext,
  hasBootstrapReadySignal,
  hasChipIdentity,
  hasDatasheet,
  readHardwareConfig,
  resolveProjectWorkflowState,
  resolveWorkflowState
};
