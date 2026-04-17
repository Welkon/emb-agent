'use strict';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(toArray(values).map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeRuntimeEvent(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return {
    type: String(source.type || '').trim(),
    category: String(source.category || '').trim(),
    status: String(source.status || '').trim(),
    severity: String(source.severity || '').trim(),
    summary: String(source.summary || '').trim(),
    command: String(source.command || '').trim(),
    action: String(source.action || '').trim(),
    source: String(source.source || '').trim(),
    details:
      source.details && typeof source.details === 'object' && !Array.isArray(source.details)
        ? source.details
        : {}
  };
}

function appendRuntimeEvents(value, events) {
  const base = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const nextEvents = unique(
    toArray(base.runtime_events)
      .concat(toArray(events))
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map(item => JSON.stringify(normalizeRuntimeEvent(item)))
  ).map(item => JSON.parse(item));

  return {
    ...base,
    runtime_events: nextEvents
  };
}

function appendRuntimeEvent(value, event) {
  return appendRuntimeEvents(value, [event]);
}

function summarizeRuntimeEvents(events) {
  const list = toArray(events)
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(normalizeRuntimeEvent)
    .filter(item => item.type || item.summary);

  const blocked = list.filter(item => item.status === 'blocked');
  const pending = list.filter(item => item.status === 'pending');
  const failed = list.filter(item => item.status === 'failed');

  return {
    status:
      blocked.length > 0
        ? 'blocked'
        : failed.length > 0
          ? 'failed'
          : pending.length > 0
            ? 'pending'
            : list.length > 0
              ? 'ok'
              : 'clear',
    total: list.length,
    blocked: blocked.length,
    pending: pending.length,
    failed: failed.length,
    types: unique(list.map(item => item.type)),
    categories: unique(list.map(item => item.category)),
    summaries: unique(list.map(item => item.summary))
  };
}

module.exports = {
  appendRuntimeEvent,
  appendRuntimeEvents,
  normalizeRuntimeEvent,
  summarizeRuntimeEvents
};
