'use strict';

function makeArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function unique(values) {
  return Array.from(new Set(makeArray(values).map(ensureString).filter(Boolean)));
}

function isPowerNetName(name) {
  return /^(?:gnd|ground|agnd|dgnd|vss|vdd|vcc|vin|vbat|bat\+?|b\+|b-|3v3|3\.3v|5v|12v|24v|\+?\d+(?:\.\d+)?v)$/i.test(ensureString(name));
}

function isUnnamedNetName(name) {
  return /(?:^|:)UNNAMED_NET_\d+$/i.test(ensureString(name));
}

function memberDesignator(member) {
  const text = ensureString(member);
  const match = text.match(/^([A-Za-z][A-Za-z0-9_+\-]*)[.\-:]/u);
  return match ? match[1] : text;
}

function normalizeDesignator(value) {
  return ensureString(value).toUpperCase();
}

function componentText(component) {
  return [
    component.designator,
    component.value,
    component.comment,
    component.libref,
    component.library_ref,
    component.footprint,
    component.package
  ].map(ensureString).join(' ');
}

function guessComponentRole(component) {
  const designator = ensureString(component.designator);
  const text = componentText(component);
  if (/^R\d+/i.test(designator) || /\b(?:resistor|ohm|kohm|mohm|\d+(?:\.\d+)?[kKmM]?[rR])\b/i.test(text)) return 'resistor';
  if (/^C\d+/i.test(designator) || /\b(?:capacitor|cap|\d+(?:\.\d+)?\s*(?:pf|nf|uf))\b/i.test(text)) return 'capacitor';
  if (/^(?:D|LED)\d*/i.test(designator) || /\bled\b/i.test(text)) return 'led';
  if (/^(?:SW|S|KEY)\d*/i.test(designator) || /\b(?:switch|button|key|tact)\b/i.test(text)) return 'switch';
  if (/^Q\d*/i.test(designator) || /\b(?:npn|pnp|mosfet|transistor|ss8050|ss8550|s8050|s8550|2n\d+)\b/i.test(text)) return 'transistor';
  if (/^(?:J|P|CN|USB)\d*/i.test(designator) || /\b(?:connector|usb|header|test\s*point|testpoint)\b/i.test(text)) return 'connector';
  if (/^(?:U|IC)\d*/i.test(designator)) return 'ic';
  return '';
}

function buildIndexes(parsed) {
  const components = makeArray(parsed && parsed.components);
  const nets = makeArray(parsed && parsed.nets);
  const byDesignator = new Map();
  components.forEach(component => {
    const key = normalizeDesignator(component.designator);
    if (key) byDesignator.set(key, component);
  });

  const netByName = new Map();
  const netByMember = new Map();
  nets.forEach(net => {
    const name = ensureString(net.name);
    if (name) netByName.set(name, net);
    makeArray(net.members).forEach(member => {
      const text = ensureString(member);
      if (text) netByMember.set(text.toUpperCase(), net);
    });
  });

  components.forEach(component => {
    makeArray(component.pins).forEach(pin => {
      const netName = ensureString(pin.net);
      if (!netName) return;
      const current = netByName.get(netName) || { name: netName, members: [] };
      const member = `${component.designator}.${pin.number || pin.name || '?'}`;
      current.members = unique([...(makeArray(current.members)), member]);
      netByName.set(netName, current);
      netByMember.set(member.toUpperCase(), current);
    });
  });

  return { components, nets: Array.from(netByName.values()), byDesignator, netByName, netByMember };
}

function componentForMember(member, byDesignator) {
  return byDesignator.get(normalizeDesignator(memberDesignator(member))) || null;
}

function roleMembers(net, role, byDesignator) {
  return makeArray(net.members).filter(member => {
    const component = componentForMember(member, byDesignator);
    return component && guessComponentRole(component) === role;
  });
}

function netHasRole(net, role, byDesignator) {
  return roleMembers(net, role, byDesignator).length > 0;
}

function findingId(category, parts) {
  return [category, ...makeArray(parts)]
    .map(item => ensureString(item).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('-');
}

function evidenceRequiredForCategory(category) {
  if (category === 'gpio-bias') {
    return ['schematic', 'mcu-datasheet', 'firmware-init'];
  }
  if (category === 'transistor-drive') {
    return ['schematic', 'mcu-datasheet', 'transistor-datasheet', 'load-current'];
  }
  if (category === 'power-decoupling') {
    return ['schematic', 'mcu-datasheet', 'layout-or-board-photo'];
  }
  if (category === 'led-current-limit') {
    return ['schematic', 'bom-values', 'led-datasheet'];
  }
  return ['schematic'];
}

function reminderPolicyForSeverity(severity) {
  if (severity === 'warning' || severity === 'error') {
    return 'repeat-on-next-and-related-debug';
  }
  return 'repeat-on-related-debug';
}

function buildFinding(category, severity, confidence, summary, evidence, recommendedChecks) {
  const idParts = [
    evidence && evidence.net,
    evidence && evidence.component,
    evidence && evidence.pin
  ].filter(Boolean);
  return {
    id: findingId(category, idParts.length > 0 ? idParts : [summary]),
    category,
    severity,
    confidence,
    summary,
    evidence: evidence || {},
    recommended_checks: makeArray(recommendedChecks),
    status: 'open',
    dismissible: true,
    blocking: false,
    reminder_policy: reminderPolicyForSeverity(severity),
    evidence_required: evidenceRequiredForCategory(category),
    note: 'Advisory only; confirm against datasheets, firmware defaults, BOM values, and board requirements before changing hardware truth.'
  };
}

function pinNet(component, pin, indexes) {
  const direct = ensureString(pin.net);
  if (direct && indexes.netByName.has(direct)) return indexes.netByName.get(direct);
  const candidates = [
    `${component.designator}.${pin.number || ''}`,
    `${component.designator}.${pin.name || ''}`,
    `${component.designator}.${pin.number || pin.name || '?'}`
  ].map(item => item.toUpperCase());
  for (const candidate of candidates) {
    if (indexes.netByMember.has(candidate)) return indexes.netByMember.get(candidate);
  }
  return direct ? { name: direct, members: [] } : null;
}

function collectComponentNets(component, indexes) {
  return unique(makeArray(component.pins).map(pin => {
    const net = pinNet(component, pin, indexes);
    return net && net.name ? net.name : '';
  })).map(name => indexes.netByName.get(name) || { name, members: [] });
}

function isLikelyMcuOrIc(component) {
  const role = guessComponentRole(component);
  const pinCount = makeArray(component.pins).length;
  const text = componentText(component);
  return role === 'ic' || pinCount >= 6 || /\b(?:mcu|microcontroller|stm32|attiny|atmega|pms\d+|sc8|pic\d+|gd32|esp32)\b/i.test(text);
}

function memberLooksLikeIcReference(member) {
  const designator = normalizeDesignator(memberDesignator(member));
  return /^(?:MCU|CPU|U\d+|IC\d+)$/i.test(designator);
}

function hasExternalBiasCandidate(net, byDesignator) {
  return netHasRole(net, 'resistor', byDesignator) || isPowerNetName(net.name);
}

function connectedNetsForComponent(component, indexes) {
  return collectComponentNets(component, indexes);
}

function isSwitchToGroundNet(net, indexes) {
  if (!netHasRole(net, 'switch', indexes.byDesignator)) return false;
  return makeArray(net.members).some(member => {
    const component = componentForMember(member, indexes.byDesignator);
    return component &&
      guessComponentRole(component) === 'switch' &&
      connectedNetsForComponent(component, indexes).some(componentNet => /^(?:gnd|ground|agnd|dgnd|vss)$/i.test(componentNet.name));
  });
}

function buildGpioBiasAdvice(name, net, indexes) {
  if (isSwitchToGroundNet(net, indexes) || /(?:key|button|sw)/i.test(name)) {
    return {
      severity: 'info',
      summary: `Signal ${name} is a switch/input net without an external bias resistor; default to MCU weak pull-up when board cost is prioritized.`,
      recommended_checks: [
        'Confirm firmware enables the internal weak pull-up before sampling the input.',
        'Check reset, boot, sleep, and wake-up behavior because internal pull-ups may be disabled during some states.',
        'Use an external bias resistor only if leakage, EMI/noise margin, long wiring, or deterministic pre-firmware state requires it.'
      ]
    };
  }

  return {
    severity: 'warning',
    summary: `Signal ${name} reaches an IC/MCU input-like net but no external pull-up or pull-down candidate was detected.`,
    recommended_checks: [
      'Confirm whether the MCU pin has an internal pull-up/down and when firmware enables it.',
      'Check reset, sleep, and boot-time behavior before relying only on firmware bias.',
      'Add or verify an external bias resistor if the input must be deterministic without firmware.'
    ]
  };
}

function addDanglingNetFindings(findings, indexes, visualNetlist) {
  const dangling = makeArray(visualNetlist && visualNetlist.dangling_nets).length > 0
    ? makeArray(visualNetlist.dangling_nets)
    : indexes.nets.filter(net => makeArray(net.members).length <= 1);
  dangling.slice(0, 24).forEach(net => {
    if (!net || isPowerNetName(net.name)) return;
    findings.push(buildFinding(
      'dangling-net',
      'info',
      'medium',
      `Net ${ensureString(net.name) || '(unnamed)'} has one or fewer connected members.`,
      { net: ensureString(net.name), members: makeArray(net.members), sheets: makeArray(net.sheets) },
      [
        'Confirm this is an intentional test point, no-connect, or single-ended label.',
        'If it should connect elsewhere, inspect the schematic preview and source record evidence.'
      ]
    ));
  });
}

function addFloatingInputFindings(findings, indexes) {
  indexes.nets.forEach(net => {
    const name = ensureString(net.name);
    if (!name || isPowerNetName(name)) return;
    const signalLike = /(?:key|button|sw|rst|reset|boot|en|wake|irq|int|rx|input|in\b|pir|sensor|sense|detect)/i.test(name);
    const members = makeArray(net.members);
    const hasSwitch = netHasRole(net, 'switch', indexes.byDesignator);
    const hasIc = members.some(member => {
      const component = componentForMember(member, indexes.byDesignator);
      return component ? isLikelyMcuOrIc(component) : memberLooksLikeIcReference(member);
    });
    if (!(signalLike || hasSwitch) || !hasIc || hasExternalBiasCandidate(net, indexes.byDesignator)) {
      return;
    }
    const biasAdvice = buildGpioBiasAdvice(name, net, indexes);
    findings.push(buildFinding(
      'gpio-bias',
      biasAdvice.severity,
      'medium',
      biasAdvice.summary,
      { net: name, members },
      biasAdvice.recommended_checks
    ));
  });
}

function addLedCurrentLimitFindings(findings, indexes) {
  indexes.components
    .filter(component => guessComponentRole(component) === 'led')
    .forEach(component => {
      const nets = collectComponentNets(component, indexes);
      const hasResistor = nets.some(net => netHasRole(net, 'resistor', indexes.byDesignator));
      if (hasResistor) return;
      findings.push(buildFinding(
        'led-current-limit',
        'warning',
        'medium',
        `LED-like component ${component.designator} has no resistor candidate on its directly connected nets.`,
        {
          component: component.designator,
          value: component.value || component.comment || '',
          nets: nets.map(net => net.name).filter(Boolean)
        },
        [
          'Confirm the LED current path includes a resistor or current-regulated driver.',
          'Verify LED current against GPIO or driver current limits.'
        ]
      ));
    });
}

function addTransistorDriveFindings(findings, indexes) {
  indexes.components
    .filter(component => guessComponentRole(component) === 'transistor')
    .forEach(component => {
      makeArray(component.pins)
        .filter(pin => /^(?:b|base|g|gate)$/i.test(ensureString(pin.name) || ensureString(pin.number)))
        .forEach(pin => {
          const net = pinNet(component, pin, indexes);
          if (!net || netHasRole(net, 'resistor', indexes.byDesignator)) return;
          const hasIcDriver = makeArray(net.members).some(member => {
            const other = componentForMember(member, indexes.byDesignator);
            return other && other.designator !== component.designator && isLikelyMcuOrIc(other);
          });
          if (!hasIcDriver) return;
          findings.push(buildFinding(
            'transistor-drive',
            'warning',
            'medium',
            `Transistor ${component.designator} ${pin.name || pin.number} drive net has no resistor candidate.`,
            { component: component.designator, pin: pin.name || pin.number || '', net: net.name, members: makeArray(net.members) },
            [
              'For BJTs, verify the base resistor value and MCU source/sink current.',
              'For MOSFETs, verify gate resistor or damping needs and boot/reset default state.'
            ]
          ));
        });
    });
}

function addDecouplingFindings(findings, indexes) {
  indexes.components
    .filter(isLikelyMcuOrIc)
    .forEach(component => {
      const nets = collectComponentNets(component, indexes);
      const hasPower = nets.some(net => isPowerNetName(net.name) && !/gnd|ground|vss/i.test(net.name));
      const hasGround = nets.some(net => /^(?:gnd|ground|agnd|dgnd|vss)$/i.test(ensureString(net.name)));
      if (!hasPower || !hasGround) return;
      const hasCap = nets.some(net => netHasRole(net, 'capacitor', indexes.byDesignator));
      if (hasCap) return;
      findings.push(buildFinding(
        'power-decoupling',
        'info',
        'low',
        `IC-like component ${component.designator} has power and ground nets but no local decoupling capacitor candidate was detected on those nets.`,
        { component: component.designator, nets: nets.map(net => net.name).filter(Boolean) },
        [
          'Confirm the schematic has local decoupling near each IC power pin.',
          'Verify capacitor value, voltage rating, placement, and datasheet recommendations.'
        ]
      ));
    });
}

function addUnnamedCriticalNetFindings(findings, indexes) {
  indexes.nets.forEach(net => {
    if (!isUnnamedNetName(net.name)) return;
    const hasIc = makeArray(net.members).some(member => {
      const component = componentForMember(member, indexes.byDesignator);
      return component && isLikelyMcuOrIc(component);
    });
    if (!hasIc) return;
    findings.push(buildFinding(
      'unnamed-critical-net',
      'info',
      'medium',
      `Unnamed net ${net.name} touches an IC-like component.`,
      { net: net.name, members: makeArray(net.members) },
      [
        'Name this net if it carries a meaningful signal, boot strap, reset, power control, or debug function.',
        'Keep the unnamed net only if it is genuinely local and unambiguous.'
      ]
    ));
  });
}

function summarizeFindings(findings) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byCategory = {};
  findings.forEach(finding => {
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
  });
  return {
    findings: findings.length,
    errors: bySeverity.error || 0,
    warnings: bySeverity.warning || 0,
    info: bySeverity.info || 0,
    categories: byCategory
  };
}

function analyzeSchematicAdvice(parsed) {
  const indexes = buildIndexes(parsed || {});
  const visualNetlist = parsed && parsed.visual_netlist ? parsed.visual_netlist : {};
  const findings = [];

  addDanglingNetFindings(findings, indexes, visualNetlist);
  addFloatingInputFindings(findings, indexes);
  addLedCurrentLimitFindings(findings, indexes);
  addTransistorDriveFindings(findings, indexes);
  addDecouplingFindings(findings, indexes);
  addUnnamedCriticalNetFindings(findings, indexes);

  const deduped = [];
  const seen = new Set();
  findings.forEach(finding => {
    if (seen.has(finding.id)) return;
    seen.add(finding.id);
    deduped.push(finding);
  });

  return {
    version: 1,
    status: 'analysis-only',
    policy: {
      advisory_only: true,
      truth_write: false,
      user_can_dismiss: true,
      blocking: false,
      manual_override_allowed: true
    },
    summary: summarizeFindings(deduped),
    findings: deduped,
    review_focus: [
      'Treat findings as review prompts, not schematic errors.',
      'Dismiss a finding when board intent, datasheet limits, or firmware defaults make it irrelevant.',
      'Promote only confirmed facts into hardware truth files.'
    ]
  };
}

module.exports = {
  analyzeSchematicAdvice,
  guessComponentRole
};
