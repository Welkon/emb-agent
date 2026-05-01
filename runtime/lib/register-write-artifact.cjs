'use strict';

const PREFERRED_KEYS = ['best_candidate', 'threshold_selection', 'selection', 'result'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findRegisterWriteCandidate(value, trail = []) {
  if (!isObject(value)) {
    return null;
  }

  if (isObject(value.register_writes) && Array.isArray(value.register_writes.registers)) {
    return {
      register_writes: value.register_writes,
      path: [...trail, 'register_writes'].join('.'),
      candidate: value
    };
  }

  if (Array.isArray(value.registers)) {
    return {
      register_writes: value,
      path: trail.join('.') || '<root>',
      candidate: value
    };
  }

  for (const key of PREFERRED_KEYS) {
    const found = findRegisterWriteCandidate(value[key], [...trail, key]);
    if (found) return found;
  }

  for (const [key, child] of Object.entries(value)) {
    if (PREFERRED_KEYS.includes(key)) continue;
    const found = findRegisterWriteCandidate(child, [...trail, key]);
    if (found) return found;
  }

  return null;
}

function findRegisterWrites(value) {
  const found = findRegisterWriteCandidate(value);
  return found ? found.register_writes : null;
}

function normalizeRegisters(registerWrites) {
  const registers = Array.isArray(registerWrites && registerWrites.registers)
    ? registerWrites.registers
    : [];
  return registers.map(item => ({
    register: String(item && item.register ? item.register : '').trim(),
    mask_hex: String(item && item.mask_hex ? item.mask_hex : '').trim(),
    write_value_hex: String(item && item.write_value_hex ? item.write_value_hex : '').trim(),
    fields: Array.isArray(item && item.fields) ? item.fields.map(field => String(field || '').trim()).filter(Boolean) : [],
    c_statement: String(item && item.c_statement ? item.c_statement : '').trim(),
    hal_statement: String(item && item.hal_statement ? item.hal_statement : '').trim()
  })).filter(item => item.register);
}

function normalizeRegisterNames(registerWrites) {
  return normalizeRegisters(registerWrites).map(item => item.register);
}

function firstRegisterName(value) {
  const registerWrites = Array.isArray(value && value.registers) ? value : findRegisterWrites(value);
  return normalizeRegisterNames(registerWrites)[0] || '';
}

function findFirmwareSnippetRequest(value) {
  const registerWrites = findRegisterWrites(value);
  return isObject(registerWrites && registerWrites.firmware_snippet_request)
    ? registerWrites.firmware_snippet_request
    : null;
}

module.exports = {
  findFirmwareSnippetRequest,
  findRegisterWriteCandidate,
  findRegisterWrites,
  firstRegisterName,
  normalizeRegisterNames,
  normalizeRegisters
};
