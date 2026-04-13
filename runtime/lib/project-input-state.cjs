'use strict';

const attachProjectCli = require('../scripts/attach-project.cjs');

const GENERATED_DOCS = new Set([
  'docs/HARDWARE-LOGIC.md',
  'docs/DEBUG-NOTES.md',
  'docs/MCU-FOUNDATION-CHECKLIST.md',
  'docs/CONNECTIVITY.md',
  'docs/RELEASE-NOTES.md',
  'docs/POWER-CHARGING.md',
  'docs/VERIFICATION.md',
  'docs/REVIEW-REPORT.md',
  'docs/ARCH-REVIEW.md'
]);

function isMeaningfulProjectInput(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (GENERATED_DOCS.has(normalized)) {
    return false;
  }

  return (
    lower.endsWith('.pdf') ||
    lower.includes('datasheet') ||
    lower.includes('manual') ||
    lower.includes('reference') ||
    lower.includes('pin') ||
    lower.endsWith('.ioc') ||
    lower.endsWith('.uvprojx') ||
    lower.endsWith('.ewp') ||
    lower.endsWith('.c') ||
    lower.endsWith('.h') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.hpp') ||
    lower.endsWith('.schdoc') ||
    lower.endsWith('.sch') ||
    lower.endsWith('.dsn')
  );
}

function listMeaningfulProjectInputs(detected) {
  const resolved = detected || {};
  return [
    ...((resolved.code) || []),
    ...((resolved.projects) || []),
    ...((resolved.schematics) || []),
    ...(((resolved.docs) || []).filter(isMeaningfulProjectInput))
  ];
}

function detectBlankProjectSelectionMode(options) {
  const config = options || {};
  const projectRoot = String(config.projectRoot || '').trim();
  const hardware = config.hardware || {};
  const identity = hardware && hardware.identity ? hardware.identity : hardware;
  const hasHardwareIdentity = Boolean(identity && identity.model && identity.package);
  const hasChipProfile = Boolean(hardware && hardware.chip_profile);
  const detectProjectInputs =
    config.detectProjectInputs && typeof config.detectProjectInputs === 'function'
      ? config.detectProjectInputs
      : attachProjectCli.detectProjectInputs;

  if (!projectRoot || hasHardwareIdentity || hasChipProfile) {
    return false;
  }

  try {
    const detected = detectProjectInputs(projectRoot);
    return listMeaningfulProjectInputs(detected).length === 0;
  } catch {
    return false;
  }
}

module.exports = {
  isMeaningfulProjectInput,
  listMeaningfulProjectInputs,
  detectBlankProjectSelectionMode
};
