'use strict';

const fs = require('fs');
const path = require('path');

const runtime = require('./runtime.cjs');

const BOARD_EXTENSIONS = new Set([
  '.pcbdoc',
  '.kicad_pcb',
  '.brd'
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage'
]);

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function toRelative(projectRoot, filePath) {
  return normalizePath(path.relative(projectRoot, filePath));
}

function isIgnoredDirectory(projectRoot, dirPath) {
  const name = path.basename(dirPath);
  if (IGNORED_DIRS.has(name)) return true;
  const relative = toRelative(projectRoot, dirPath);
  if (relative === '.emb-agent/cache') return true;
  if (relative.startsWith('.emb-agent/cache/')) return true;
  return false;
}

function listBoardCandidates(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const maxFiles = Number(options.maxFiles || 5000);
  const maxDepth = Number(options.maxDepth || 6);
  const candidates = [];
  let visitedFiles = 0;

  function visit(dirPath, depth) {
    if (depth > maxDepth || candidates.length >= Number(options.limit || 20)) return;
    if (isIgnoredDirectory(projectRoot, dirPath)) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(entry => {
        if (visitedFiles >= maxFiles || candidates.length >= Number(options.limit || 20)) return;
        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath, depth + 1);
          return;
        }
        if (!entry.isFile()) return;
        visitedFiles += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (!BOARD_EXTENSIONS.has(ext)) return;
        candidates.push({
          path: toRelative(projectRoot, absolutePath),
          format: ext === '.pcbdoc' ? 'altium-pcbdoc' : ext.slice(1),
          supported: ext === '.pcbdoc'
        });
      });
  }

  visit(projectRoot, 0);
  return candidates;
}

function listParsedBoards(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const cacheRoot = path.join(runtime.getProjectExtDir(projectRoot), 'cache', 'boards');
  if (!fs.existsSync(cacheRoot)) return [];

  return fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const summaryPath = path.join(cacheRoot, entry.name, 'summary.json');
      if (!fs.existsSync(summaryPath)) return null;
      let summary = {};
      try {
        summary = runtime.readJson(summaryPath);
      } catch (_error) {
        return null;
      }
      return {
        board_id: summary.board_id || entry.name,
        source_path: summary.source_path || '',
        format: summary.format || '',
        layout: summary.artifacts && summary.artifacts.layout ? summary.artifacts.layout : '',
        board_advice: summary.artifacts && summary.artifacts.board_advice ? summary.artifacts.board_advice : '',
        summary: toRelative(projectRoot, summaryPath),
        coverage: summary.summary || {}
      };
    })
    .filter(Boolean)
    .slice(0, Number(options.limit || 20));
}

function summarizeBoardEvidence(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const parsed = listParsedBoards(projectRoot, options);
  const candidates = listBoardCandidates(projectRoot, options);
  const supportedCandidates = candidates.filter(item => item.supported);
  const firstCandidate = supportedCandidates[0] || candidates[0] || null;
  const firstParsed = parsed[0] || null;

  const state = firstParsed
    ? 'parsed'
    : firstCandidate
      ? 'available'
      : 'missing';

  return {
    state,
    required: false,
    blocking: false,
    can_continue: true,
    advisory_only: true,
    parser_available: true,
    supported_formats: ['altium-pcbdoc'],
    candidates,
    parsed,
    command: firstParsed && firstParsed.layout
      ? `board summary --parsed ${firstParsed.layout}`
      : firstCandidate && firstCandidate.supported
        ? `ingest board --file ${firstCandidate.path}`
        : '',
    optional_next_step: firstParsed && firstParsed.layout
      ? `Use board advice --parsed ${firstParsed.layout} only when layout evidence is relevant.`
      : firstCandidate && firstCandidate.supported
        ? `Optional: run ingest board --file ${firstCandidate.path} when layout, routing, connector, bring-up, or manufacturing evidence is relevant.`
        : 'No PCB layout file was found; continue without layout evidence and skip placement/routing/copper/DFM checks.',
    skipped_checks: state === 'missing'
      ? ['placement', 'routing', 'copper-area', 'via-count', 'connector-access', 'dfm', 'emi-layout']
      : [],
    note: 'PCB layout evidence is opportunistic and advisory-only; missing PCB files must not block firmware, schematic, datasheet, or task workflow progress.'
  };
}

module.exports = {
  listBoardCandidates,
  listParsedBoards,
  summarizeBoardEvidence
};
