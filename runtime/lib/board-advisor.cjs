'use strict';

function makeArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function severityCounts(findings) {
  return {
    errors: findings.filter(item => item.severity === 'error').length,
    warnings: findings.filter(item => item.severity === 'warning').length,
    info: findings.filter(item => item.severity === 'info').length
  };
}

function categoryCounts(findings) {
  const counts = {};
  findings.forEach(finding => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
  });
  return counts;
}

function findingId(category, parts) {
  return [category, ...makeArray(parts)]
    .map(item => ensureString(item).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('-');
}

function reminderPolicyForSeverity(severity) {
  if (severity === 'warning' || severity === 'error') {
    return 'repeat-on-next-and-related-debug';
  }
  return 'repeat-on-related-debug';
}

function buildFinding(category, severity, confidence, summary, evidence, recommendedChecks) {
  return {
    id: findingId(category, [
      evidence && evidence.component,
      evidence && evidence.net,
      evidence && evidence.source_record,
      summary
    ]),
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
    evidence_required: ['pcb-layout', 'schematic', 'datasheet-or-layout-guideline'],
    note: 'Advisory only; confirm against schematic intent, datasheets, layout guidelines, current limits, and manufacturing rules before changing board truth.'
  };
}

function isPowerNetName(name) {
  return /^(?:gnd|ground|agnd|dgnd|pgnd|vss|vdd|vcc|vin|vbat|bat\+?|b\+|b-|3v3|3\.3v|5v|12v|24v|\+?\d+(?:\.\d+)?v)$/i.test(ensureString(name));
}

function componentRole(component) {
  const text = [
    component.designator,
    component.value,
    component.footprint
  ].map(ensureString).join(' ');
  const ref = ensureString(component.designator);
  if (/^(?:U|IC|MCU)\d*/i.test(ref)) return 'ic';
  if (/^C\d+/i.test(ref) || /\b(?:capacitor|cap|\d+(?:\.\d+)?\s*(?:pf|nf|uf))\b/i.test(text)) return 'capacitor';
  if (/^(?:J|P|CN|USB)\d*/i.test(ref) || /\b(?:connector|header|usb)\b/i.test(text)) return 'connector';
  if (/^(?:Y|X)\d*/i.test(ref) || /\b(?:crystal|oscillator|resonator)\b/i.test(text)) return 'clock';
  if (/^L\d+/i.test(ref) || /\binductor\b/i.test(text)) return 'inductor';
  return '';
}

function distance(a, b) {
  if (!a || !b) return null;
  const dx = Number(a.x_mm) - Number(b.x_mm);
  const dy = Number(a.y_mm) - Number(b.y_mm);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Math.sqrt(dx * dx + dy * dy);
}

function addCoverageFindings(findings, board) {
  const coverage = board.coverage || {};
  if ((coverage.components || 0) === 0 || (coverage.pads || 0) === 0) {
    findings.push(buildFinding(
      'layout-coverage',
      'info',
      'high',
      'PcbDoc was parsed directly, but no component/pad records were recognized in the board data stream.',
      {
        board_storage: board.cfb && board.cfb.board_storage,
        board_data_stream: board.cfb && board.cfb.board_data_stream,
        board_data_bytes: board.cfb && board.cfb.board_data_bytes,
        record_counts: coverage.record_counts || {}
      },
      [
        'Confirm whether this PcbDoc contains placed components or only board outline/configuration data.',
        'If Altium stores objects in additional streams for this file version, extend the parser with those record paths using this artifact as evidence.',
        'Do not infer placement quality until components, pads, and nets are present in parsed layout facts.'
      ]
    ));
  }

  if (!board.board || !board.board.bounds) {
    findings.push(buildFinding(
      'board-outline',
      'warning',
      'medium',
      'No board outline bounds were recognized from the PcbDoc layout data.',
      {
        outlines: coverage.outlines || 0
      },
      [
        'Check whether the board outline is on a mechanical layer or stored in another primitive stream.',
        'Board-edge connector, keepout, and enclosure checks need reliable outline geometry.'
      ]
    ));
  }
}

function addConnectorFindings(findings, board) {
  const bounds = board.board && board.board.bounds;
  if (!bounds) return;

  makeArray(board.components).forEach(component => {
    if (componentRole(component) !== 'connector' || !component.center) return;
    const distances = [
      Math.abs(component.center.x_mm - bounds.min_x_mm),
      Math.abs(component.center.x_mm - bounds.max_x_mm),
      Math.abs(component.center.y_mm - bounds.min_y_mm),
      Math.abs(component.center.y_mm - bounds.max_y_mm)
    ].filter(Number.isFinite);
    const nearest = distances.length > 0 ? Math.min(...distances) : null;
    if (nearest !== null && nearest > 8) {
      findings.push(buildFinding(
        'connector-placement',
        'info',
        'medium',
        `Connector ${component.designator} is not near the board edge; confirm cable, enclosure, and assembly intent.`,
        {
          component: component.designator,
          distance_to_edge_mm: Number(nearest.toFixed(3)),
          center: component.center
        },
        [
          'Confirm whether this connector is intentionally internal.',
          'Check cable bend radius, enclosure opening, and hand assembly access.'
        ]
      ));
    }
  });
}

function addDecouplingFindings(findings, board) {
  const components = makeArray(board.components).filter(component => component.center);
  const ics = components.filter(component => componentRole(component) === 'ic');
  const capacitors = components.filter(component => componentRole(component) === 'capacitor');
  if (ics.length === 0 || capacitors.length === 0) return;

  ics.slice(0, 16).forEach(ic => {
    const nearest = capacitors
      .map(capacitor => ({
        capacitor,
        distance_mm: distance(ic.center, capacitor.center)
      }))
      .filter(item => item.distance_mm !== null)
      .sort((a, b) => a.distance_mm - b.distance_mm)[0];

    if (nearest && nearest.distance_mm > 8) {
      findings.push(buildFinding(
        'decoupling-placement',
        'warning',
        'medium',
        `Nearest recognized capacitor ${nearest.capacitor.designator} is ${nearest.distance_mm.toFixed(1)} mm from IC ${ic.designator}.`,
        {
          component: nearest.capacitor.designator,
          target: ic.designator,
          distance_mm: Number(nearest.distance_mm.toFixed(3)),
          component_center: nearest.capacitor.center,
          target_center: ic.center
        },
        [
          'Confirm whether this capacitor is intended as local decoupling for the IC.',
          'Check the IC datasheet layout section for required capacitor value and placement.',
          'Move local decoupling closer to supply/ground pins if the schematic intent requires it.'
        ]
      ));
    }
  });
}

function addRoutingFindings(findings, board) {
  const tracks = makeArray(board.tracks);
  const nets = makeArray(board.nets);
  const powerTracks = tracks.filter(track => isPowerNetName(track.net));
  powerTracks.forEach(track => {
    if (track.width_mm !== null && track.width_mm < 0.2) {
      findings.push(buildFinding(
        'power-trace-width',
        'warning',
        'medium',
        `Power net ${track.net} has a recognized track width below 0.2 mm.`,
        {
          net: track.net,
          width_mm: Number(track.width_mm.toFixed(4)),
          layer: track.layer,
          source_record: track.source_record
        },
        [
          'Confirm expected current, copper thickness, allowed temperature rise, and manufacturer trace-width rules.',
          'Increase width or use copper pour if the current budget requires it.'
        ]
      ));
    }
  });

  if (tracks.length === 0 && nets.length > 0) {
    findings.push(buildFinding(
      'routing-coverage',
      'info',
      'medium',
      'Nets were recognized but no track/via records were recognized from the PcbDoc layout data.',
      {
        nets: nets.slice(0, 16).map(net => net.name)
      },
      [
        'Treat placement and routing advice as incomplete until tracks, vias, and zones are parsed.',
        'Extend the PcbDoc object parser for this Altium version if routing objects are stored in additional record forms.'
      ]
    ));
  }
}

function analyzeBoardAdvice(board) {
  const findings = [];
  addCoverageFindings(findings, board || {});
  addConnectorFindings(findings, board || {});
  addDecouplingFindings(findings, board || {});
  addRoutingFindings(findings, board || {});

  const counts = severityCounts(findings);
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
    summary: {
      findings: findings.length,
      ...counts,
      categories: categoryCounts(findings)
    },
    findings,
    review_focus: [
      'Treat PCB layout findings as nonblocking review prompts.',
      'Confirm placement and routing intent against schematic evidence, datasheets, current limits, mechanical constraints, and manufacturing rules.',
      'If parsed object coverage is incomplete, improve parser support before making layout-quality conclusions.'
    ]
  };
}

module.exports = {
  analyzeBoardAdvice
};
