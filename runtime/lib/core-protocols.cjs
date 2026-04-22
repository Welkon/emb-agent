'use strict';

const CORE_PROTOCOLS = Object.freeze([
  Object.freeze({
    id: 'truth-first',
    title: 'Truth first',
    summary:
      'Update .emb-agent/hw.yaml and .emb-agent/req.yaml before relying on inferred hardware or requirement facts. Keep unknowns explicit.'
  }),
  Object.freeze({
    id: 'task-discipline',
    title: 'Task discipline',
    summary:
      'Activate the current task before major work, keep implement context accurate, and record verification evidence before closure.'
  }),
  Object.freeze({
    id: 'worker-discipline',
    title: 'Worker discipline',
    summary:
      'Independent workers execute one immutable contract each. If Stage A contract review fails, tighten the contract and redispatch instead of patching inline.'
  }),
  Object.freeze({
    id: 'completion-discipline',
    title: 'Completion discipline',
    summary:
      'Task resolve stays blocked until verification is done and the full AAR scan is answered. Triggered lessons must be recorded before closure.'
  }),
  Object.freeze({
    id: 'implementation-discipline',
    title: 'Implementation discipline',
    summary:
      'Register formulas, timing constants, and magic numbers should stay tied to manual-backed notes. Mark unverified limits as gaps instead of presenting them as fact.'
  })
]);

function listCoreProtocols() {
  return CORE_PROTOCOLS.map(item => ({ ...item }));
}

function buildCoreProtocolLines() {
  return [
    'Core runtime protocols:',
    ...CORE_PROTOCOLS.map(item => `- ${item.title}: ${item.summary}`)
  ];
}

module.exports = {
  buildCoreProtocolLines,
  listCoreProtocols
};
