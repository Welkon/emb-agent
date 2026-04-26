'use strict';

function createPinCheckerHelpers(deps) {
  const { fs, path } = deps;

  function loadChipProfile(adaptersDir, chipName) {
    if (!chipName) return null;
    const profilePath = path.join(adaptersDir, 'extensions', 'chips', 'profiles', `${chipName}.json`);
    if (!fs.existsSync(profilePath)) return null;
    try { return JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch { return null; }
  }

  function loadDeviceBinding(adaptersDir, chipName) {
    if (!chipName) return null;
    const bindingPath = path.join(adaptersDir, 'extensions', 'tools', 'devices', `${chipName}.json`);
    if (!fs.existsSync(bindingPath)) return null;
    try { return JSON.parse(fs.readFileSync(bindingPath, 'utf8')); } catch { return null; }
  }

  function buildPinMap(chipProfile) {
    const map = {};
    if (!chipProfile || !Array.isArray(chipProfile.packages)) return map;

    for (const pkg of chipProfile.packages) {
      if (!Array.isArray(pkg.pins)) continue;
      for (const pin of pkg.pins) {
        const label = (pin.label || '').toUpperCase();
        const signal = (pin.signal || '').toLowerCase();
        const key = label || `pin_${pin.number}`;

        map[key] = {
          number: pin.number,
          label,
          signal,
          default_function: pin.default_function || '',
          mux: Array.isArray(pin.mux) ? pin.mux : [],
          notes: Array.isArray(pin.notes) ? pin.notes : [],
          package: pkg.name || ''
        };
      }
    }

    return map;
  }

  function getStrappingPins(constraints) {
    if (!constraints) return [];
    const pins = [];
    const strapping = constraints['specs/mcu/peripheral-conflicts.md'];
    if (strapping && Array.isArray(strapping.strapping_pins)) {
      pins.push(...strapping.strapping_pins.map(p => p.toUpperCase()));
    }
    return pins;
  }

  function getFlashPins(constraints) {
    if (!constraints) return [];
    const pins = [];
    const conflicts = constraints['specs/mcu/peripheral-conflicts.md'];
    if (conflicts && Array.isArray(conflicts.flash_pins)) {
      pins.push(...conflicts.flash_pins.map(p => p.toUpperCase()));
    }
    return pins;
  }

  function getUsbJtagPins(constraints) {
    if (!constraints) return [];
    const pins = [];
    const conflicts = constraints['specs/mcu/peripheral-conflicts.md'];
    if (conflicts && Array.isArray(conflicts.usb_jtag_pins)) {
      pins.push(...conflicts.usb_jtag_pins.map(p => p.toUpperCase()));
    }
    return pins;
  }

  function checkPinConflicts(adaptersDir, chipName, claimedPins, hwConfig, existingTasks) {
    const chipProfile = loadChipProfile(adaptersDir, chipName);
    if (!chipProfile) {
      return { status: 'no-chip-profile', notes: [`Chip profile not found for: ${chipName}`] };
    }

    const pinMap = buildPinMap(chipProfile);
    const constraints = chipProfile.constraints || {};
    const strappingPins = getStrappingPins(constraints);
    const flashPins = getFlashPins(constraints);
    const usbJtagPins = getUsbJtagPins(constraints);

    const results = [];
    const claimedSet = new Set((Array.isArray(claimedPins) ? claimedPins : [])
      .map(p => String(p).toUpperCase()));

    for (const claimed of claimedSet) {
      const pinInfo = pinMap[claimed] || findPinByLabel(pinMap, claimed);

      if (!pinInfo) {
        results.push({
          pin: claimed,
          status: 'unknown',
          severity: 'warning',
          message: `Pin ${claimed} not found in chip profile ${chipName}. Verify the pin label matches the datasheet.`
        });
        continue;
      }

      const pinEntry = {
        pin: pinInfo.label,
        number: pinInfo.number,
        package: pinInfo.package,
        signal: pinInfo.signal,
        default_function: pinInfo.default_function,
        status: 'ok',
        severity: 'ok',
        messages: []
      };

      if (strappingPins.includes(pinEntry.pin)) {
        pinEntry.status = 'warning';
        pinEntry.severity = 'warning';
        pinEntry.messages.push({
          type: 'strapping',
          message: `Strapping pin — sampled at reset/boot. External circuitry must not drive this pin.`,
          severity: 'warning'
        });
      }

      if (flashPins.includes(pinEntry.pin)) {
        pinEntry.status = 'conflict';
        pinEntry.severity = 'error';
        pinEntry.messages.push({
          type: 'flash-pin',
          message: `Flash pin — reserved for external flash. Cannot be repurposed as GPIO.`,
          severity: 'error'
        });
      }

      if (usbJtagPins.includes(pinEntry.pin)) {
        pinEntry.status = 'warning';
        pinEntry.severity = 'warning';
        pinEntry.messages.push({
          type: 'usb-jtag',
          message: `USB Serial/JTAG pin — debug interface. Using as GPIO forfeits USB debugging.`,
          severity: 'warning'
        });
      }

      if (pinInfo.default_function && pinInfo.default_function !== 'gpio' && pinInfo.default_function !== '') {
        if (pinEntry.severity !== 'error') {
          pinEntry.messages.push({
            type: 'default-function',
            message: `Default function: ${pinInfo.default_function}. Verify this pin is not used for its default function in hardware.`,
            severity: 'info'
          });
        }
      }

      const pinNotes = Array.isArray(pinInfo.notes) ? pinInfo.notes : [];
      for (const note of pinNotes) {
        pinEntry.messages.push({
          type: 'chip-note',
          message: note,
          severity: 'info'
        });
      }

      if (pinEntry.messages.length === 0) {
        pinEntry.messages.push({
          type: 'ok',
          message: 'No conflicts detected.',
          severity: 'ok'
        });
      }

      results.push(pinEntry);
    }

    const conflicts = results.filter(r => r.severity === 'error');
    const warnings = results.filter(r => r.severity === 'warning');
    const ok = results.filter(r => r.severity === 'ok');

    return {
      status: conflicts.length > 0 ? 'conflict' : (warnings.length > 0 ? 'warning' : 'ok'),
      chip: chipName,
      package: chipProfile.package || '',
      pins_checked: results.length,
      conflicts: conflicts.length,
      warnings: warnings.length,
      ok: ok.length,
      results,
      summary: conflicts.length > 0
        ? `BLOCKED: ${conflicts.length} pin conflict(s). ${conflicts.map(c => c.pin).join(', ')}`
        : warnings.length > 0
          ? `WARNING: ${warnings.length} pin(s) need attention. ${warnings.map(w => w.pin).join(', ')}`
          : `OK: all ${results.length} pin(s) clear.`
    };
  }

  function findPinByLabel(pinMap, label) {
    const upper = label.toUpperCase();
    for (const pin of Object.values(pinMap)) {
      if (pin.label === upper || pin.signal === upper.toLowerCase() ||
          String(pin.number) === label) {
        return pin;
      }
    }
    return null;
  }

  function extractClaimedPinsFromHwConfig(hwConfig) {
    if (!hwConfig || !hwConfig.pins) return [];
    if (Array.isArray(hwConfig.pins)) return hwConfig.pins.map(String);
    if (typeof hwConfig.pins === 'string') {
      return hwConfig.pins.split(',').map(p => p.trim()).filter(Boolean);
    }
    return [];
  }

  function extractClaimedPinsFromTask(taskConfig) {
    if (!taskConfig) return [];
    const pins = [];
    if (Array.isArray(taskConfig.relatedFiles)) {
      for (const f of taskConfig.relatedFiles) {
        const pinMatch = String(f).match(/gpio(\d+|[a-z]\d+)/i);
        if (pinMatch) pins.push(pinMatch[0].toUpperCase());
      }
    }
    if (taskConfig.notes) {
      const pinRefs = String(taskConfig.notes).match(/\b(?:GPIO|PA|PB|PC)\d+\b/gi);
      if (pinRefs) pins.push(...pinRefs.map(p => p.toUpperCase()));
    }
    return [...new Set(pins)];
  }

  return {
    checkPinConflicts,
    buildPinMap,
    extractClaimedPinsFromHwConfig,
    extractClaimedPinsFromTask,
    loadChipProfile
  };
}

module.exports = { createPinCheckerHelpers };
