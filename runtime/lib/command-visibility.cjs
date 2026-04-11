'use strict';

const PUBLIC_COMMAND_NAMES = [
  'help',
  'init',
  'ingest',
  'next',
  'task',
  'scan',
  'plan',
  'do',
  'debug',
  'review',
  'verify',
  'pause',
  'resume'
];

function isPublicCommandName(name) {
  return PUBLIC_COMMAND_NAMES.includes(String(name || '').trim());
}

module.exports = {
  PUBLIC_COMMAND_NAMES,
  isPublicCommandName
};
