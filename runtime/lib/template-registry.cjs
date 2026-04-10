'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const TEMPLATE_CONFIG = Object.freeze({
  'hardware-logic': Object.freeze({
    source: 'hardware-logic.md.tpl',
    description: 'Generate the hardware logic working note.',
    default_output: 'docs/HARDWARE-LOGIC.md'
  }),
  'hw-truth': Object.freeze({
    source: 'hw.yaml.tpl',
    description: 'Generate the hardware truth file.',
    default_output: '.emb-agent/hw.yaml'
  }),
  'req-truth': Object.freeze({
    source: 'req.yaml.tpl',
    description: 'Generate the requirements truth file.',
    default_output: '.emb-agent/req.yaml'
  }),
  'mcu-foundation-checklist': Object.freeze({
    source: 'mcu-foundation-checklist.md.tpl',
    description: 'Generate the MCU foundation checklist.',
    default_output: 'docs/MCU-FOUNDATION-CHECKLIST.md'
  }),
  'debug-notes': Object.freeze({
    source: 'debug-notes.md.tpl',
    description: 'Generate the debug notes document.',
    default_output: 'docs/DEBUG-NOTES.md'
  }),
  'review-report': Object.freeze({
    source: 'review-report.md.tpl',
    description: 'Generate the review report document.',
    default_output: 'docs/REVIEW-REPORT.md'
  }),
  'verification-report': Object.freeze({
    source: 'verification-report.md.tpl',
    description: 'Generate the verification report document.',
    default_output: 'docs/VERIFICATION.md'
  }),
  'architecture-review': Object.freeze({
    source: 'architecture-review.md.tpl',
    description: 'Generate the architecture review document.',
    default_output: 'docs/ARCH-REVIEW.md'
  }),
  connectivity: Object.freeze({
    source: 'connectivity.md.tpl',
    description: 'Generate the connectivity document.',
    default_output: 'docs/CONNECTIVITY.md'
  }),
  'power-charging': Object.freeze({
    source: 'power-charging.md.tpl',
    description: 'Generate the power and charging document.',
    default_output: 'docs/POWER-CHARGING.md'
  }),
  'release-notes': Object.freeze({
    source: 'release-notes.md.tpl',
    description: 'Generate the release notes document.',
    default_output: 'docs/RELEASE-NOTES.md'
  }),
  profile: Object.freeze({
    source: 'profile.yaml.tpl',
    description: 'Generate a runtime profile skeleton.',
    default_output: '.emb-agent/profiles/{{SLUG}}.yaml'
  }),
  pack: Object.freeze({
    source: 'pack.yaml.tpl',
    description: 'Generate a pack definition skeleton.',
    default_output: '.emb-agent/packs/{{SLUG}}.yaml'
  }),
  'tool-extension-registry': Object.freeze({
    source: 'tool-extension-registry.json.tpl',
    description: 'Generate the tool extension registry.',
    default_output: '.emb-agent/extensions/tools/registry.json'
  }),
  'chip-extension-registry': Object.freeze({
    source: 'chip-extension-registry.json.tpl',
    description: 'Generate the chip extension registry.',
    default_output: '.emb-agent/extensions/chips/registry.json'
  }),
  'tool-adapter': Object.freeze({
    source: 'tool-adapter.cjs.tpl',
    description: 'Generate a tool adapter skeleton.',
    default_output: '.emb-agent/extensions/tools/{{TOOL_NAME}}.cjs'
  }),
  'tool-family': Object.freeze({
    source: 'tool-family.json.tpl',
    description: 'Generate a tool family definition.',
    default_output: '.emb-agent/extensions/tools/families/{{SLUG}}.json'
  }),
  'tool-device': Object.freeze({
    source: 'tool-device.json.tpl',
    description: 'Generate a tool device definition.',
    default_output: '.emb-agent/extensions/tools/devices/{{SLUG}}.json'
  }),
  'chip-profile': Object.freeze({
    source: 'chip-profile.json.tpl',
    description: 'Generate a chip profile definition.',
    default_output: '.emb-agent/extensions/chips/profiles/{{SLUG}}.json'
  }),
  'task-manifest': Object.freeze({
    source: 'task.json.tpl',
    description: 'Generate a task manifest.',
    default_output: '.emb-agent/tasks/{{SLUG}}/task.json'
  })
});


module.exports = {
  ROOT,
  TEMPLATES_DIR,
  TEMPLATE_CONFIG
};
