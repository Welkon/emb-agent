'use strict';

function createSupportGapHelpers(deps) {
  const { fs, path } = deps;

  function analyzeCapabilityGap(chipProfilePath, deviceBindingPath) {
    let chipProfile = null;
    let deviceBinding = null;

    if (fs.existsSync(chipProfilePath)) {
      try {
        chipProfile = JSON.parse(fs.readFileSync(chipProfilePath, 'utf8'));
      } catch {}
    }
    if (fs.existsSync(deviceBindingPath)) {
      try {
        deviceBinding = JSON.parse(fs.readFileSync(deviceBindingPath, 'utf8'));
      } catch {}
    }

    if (!chipProfile) {
      return { status: 'missing-chip-profile', path: chipProfilePath };
    }
    if (!deviceBinding) {
      return { status: 'missing-device-binding', path: deviceBindingPath };
    }

    const capabilities = Array.isArray(chipProfile.capabilities) ? chipProfile.capabilities : [];
    const bindings = (deviceBinding.bindings && typeof deviceBinding.bindings === 'object') ? deviceBinding.bindings : {};
    const supportedTools = Array.isArray(deviceBinding.supported_tools) ? deviceBinding.supported_tools : [];
    const bindingKeys = Object.keys(bindings);

    const covered = supportedTools.filter(t => bindings[t] && bindings[t].algorithm !== 'unsupported');
    const explicitlyUnsupported = bindingKeys.filter(t => bindings[t] && bindings[t].algorithm === 'unsupported');
    const noRoute = capabilities.filter(c => !bindingKeys.includes(c) && !bindingKeys.some(k => k.includes(c)));

    const totalRouteable = covered.length + explicitlyUnsupported.length;
    const totalCapabilities = capabilities.length;
    const coveragePercent = totalCapabilities > 0 ? Math.round((totalRouteable / totalCapabilities) * 100) : 0;

    return {
      status: 'ok',
      chip: chipProfile.name || '',
      vendor: chipProfile.vendor || '',
      family: chipProfile.family || '',
      capabilities: totalCapabilities,
      covered: covered.length,
      explicitly_unsupported: explicitlyUnsupported.length,
      no_route: noRoute.length,
      coverage_percent: coveragePercent,
      details: {
        covered: covered.map(t => ({ tool: t, algorithm: bindings[t].algorithm })),
        unsupported: explicitlyUnsupported.map(t => ({ tool: t, reason: bindings[t].reason || '' })),
        gap: noRoute.map(t => ({ capability: t, note: getGapNote(t) }))
      }
    };
  }

  function getGapNote(capability) {
    const notes = {
      uart: 'UART initialization and baud rate calculation',
      spi: 'SPI configuration (mode, speed, data bits)',
      i2c: 'I2C configuration (speed, address)',
      i2s: 'I2S audio interface configuration',
      wifi: 'WiFi stack config — typically not a calculator route; belongs in protocol stack layer',
      ble: 'BLE stack config — typically not a calculator route; belongs in protocol stack layer',
      crypto: 'Crypto engine — typically not a calculator route; belongs in API layer',
      gpio: 'GPIO initialization and interrupt configuration',
      dma: 'DMA channel allocation and configuration',
      rtc: 'RTC clock and alarm configuration'
    };
    return notes[capability] || `Uncovered capability: ${capability}`;
  }

  function scanChipSupportDir(adaptersDir) {
    const profilesDir = path.join(adaptersDir, 'extensions', 'chips', 'profiles');
    const devicesDir = path.join(adaptersDir, 'extensions', 'tools', 'devices');

    if (!fs.existsSync(profilesDir) || !fs.existsSync(devicesDir)) {
      return { status: 'no-support-dir', profilesDir, devicesDir };
    }

    const profileFiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
    const results = profileFiles.map(pf => {
      const chipName = pf.replace('.json', '');
      const chipProfilePath = path.join(profilesDir, pf);
      const deviceBindingPath = path.join(devicesDir, pf);
      return analyzeCapabilityGap(chipProfilePath, deviceBindingPath);
    });

    const totalCoverage = results
      .filter(r => r.status === 'ok')
      .reduce((sum, r) => sum + r.coverage_percent, 0);
    const okCount = results.filter(r => r.status === 'ok').length;
    const avgCoverage = okCount > 0 ? Math.round(totalCoverage / okCount) : 0;

    return {
      status: 'ok',
      chips: results.length,
      average_coverage_percent: avgCoverage,
      results
    };
  }

  return {
    analyzeCapabilityGap,
    scanChipSupportDir,
    getGapNote
  };
}

module.exports = { createSupportGapHelpers };
