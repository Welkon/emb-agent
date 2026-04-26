'use strict';

const PUBLIC_COMMAND_NAMES = [
  'help',
  'start',
  'ingest',
  'next',
  'task',
  'capability',
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
