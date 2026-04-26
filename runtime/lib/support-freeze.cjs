'use strict';

const crypto = require('crypto');

function createSupportFreezeHelpers(deps) {
  const { fs, path } = deps;

  function hashFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  function generateLock(adaptersDir, chipName) {
    const chipProfilePath = path.join(adaptersDir, 'extensions', 'chips', 'profiles', `${chipName}.json`);
    const deviceBindingPath = path.join(adaptersDir, 'extensions', 'tools', 'devices', `${chipName}.json`);

    const chipProfileHash = hashFile(chipProfilePath);
    const deviceBindingHash = hashFile(deviceBindingPath);

    if (!chipProfileHash && !deviceBindingHash) {
      return {
        status: 'error',
        notes: [`No chip profile or device binding found for: ${chipName}`]
      };
    }

    const deviceBinding = deviceBindingHash ? JSON.parse(fs.readFileSync(deviceBindingPath, 'utf8')) : null;
    const algorithmHashes = {};

    if (deviceBinding && deviceBinding.bindings) {
      for (const [tool, binding] of Object.entries(deviceBinding.bindings)) {
        if (binding.algorithm && binding.algorithm !== 'unsupported') {
          const algorithmPath = path.join(adaptersDir, 'chip-support', 'algorithms', `${binding.algorithm}.cjs`);
          const hash = hashFile(algorithmPath);
          if (hash) {
            algorithmHashes[binding.algorithm] = hash;
          }
        }
      }
    }

    const routeHashes = {};
    const routesDir = path.join(adaptersDir, 'chip-support', 'routes');
    if (fs.existsSync(routesDir)) {
      const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.cjs'));
      for (const routeFile of routeFiles) {
        const hash = hashFile(path.join(routesDir, routeFile));
        if (hash) {
          routeHashes[routeFile.replace('.cjs', '')] = hash;
        }
      }
    }

    return {
      status: 'ok',
      chip: chipName,
      frozen_at: new Date().toISOString(),
      chip_profile_sha256: chipProfileHash,
      device_binding_sha256: deviceBindingHash,
      algorithms: algorithmHashes,
      routes: routeHashes
    };
  }

  function checkLock(adaptersDir, lockPath) {
    if (!fs.existsSync(lockPath)) {
      return { status: 'no-lock', notes: ['No lock file found. Run support freeze first.'] };
    }

    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      return { status: 'invalid-lock', notes: ['Lock file is corrupt.'] };
    }

    if (!lock.chip) {
      return { status: 'invalid-lock', notes: ['Lock file missing chip identifier.'] };
    }

    const current = generateLock(adaptersDir, lock.chip);
    if (current.status !== 'ok') {
      return { status: 'error', notes: current.notes };
    }

    const changes = [];

    if (lock.chip_profile_sha256 !== current.chip_profile_sha256) {
      changes.push({ file: 'chip_profile', old: lock.chip_profile_sha256, new: current.chip_profile_sha256 });
    }
    if (lock.device_binding_sha256 !== current.device_binding_sha256) {
      changes.push({ file: 'device_binding', old: lock.device_binding_sha256, new: current.device_binding_sha256 });
    }
    for (const [name, hash] of Object.entries(lock.algorithms || {})) {
      if (current.algorithms[name] && current.algorithms[name] !== hash) {
        changes.push({ file: `algorithm:${name}`, old: hash, new: current.algorithms[name] });
      }
    }

    if (changes.length === 0) {
      return { status: 'ok', notes: ['Lock matches current support. No drift detected.'], changes: [] };
    }

    return {
      status: 'drift',
      notes: [`${changes.length} support files have changed since freeze. Run support verify to confirm compatibility.`],
      changes,
      recommendation: changes.length > 0 ? 'Run support verify <chip> before proceeding.' : ''
    };
  }

  return {
    generateLock,
    checkLock,
    hashFile
  };
}

module.exports = { createSupportFreezeHelpers };
