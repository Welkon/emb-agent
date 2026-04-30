#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const altiumPcbDocParser = require(path.join(ROOT, 'lib', 'altium-pcbdoc-parser.cjs'));
const boardAdvisor = require(path.join(ROOT, 'lib', 'board-advisor.cjs'));

const ALTIUM_PCBDOC_EXTS = new Set(['.pcbdoc']);

function usage() {
  process.stdout.write(
    [
      'ingest-board usage:',
      '  node scripts/ingest-board.cjs --file <board.PcbDoc> [--format auto|altium-pcbdoc] [--title <text>] [--force]',
      '  node scripts/ingest-board.cjs --file docs/board.PcbDoc'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    file: '',
    format: 'auto',
    title: '',
    force: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--file') {
      result.file = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--format') {
      result.format = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--title') {
      result.title = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (result.help) {
    return result;
  }
  if (!result.file) {
    throw new Error('Missing path after --file');
  }
  if (!['auto', 'altium-pcbdoc'].includes(result.format)) {
    throw new Error('format must be auto or altium-pcbdoc');
  }

  return result;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function detectFormat(filePath, requestedFormat) {
  if (requestedFormat && requestedFormat !== 'auto') {
    return requestedFormat;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ALTIUM_PCBDOC_EXTS.has(ext)) return 'altium-pcbdoc';
  return 'altium-pcbdoc';
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function getBoardCacheRoot(projectRoot) {
  return path.join(runtime.getProjectExtDir(projectRoot), 'cache', 'boards');
}

function getArtifactPaths(cacheDir) {
  return {
    layoutJson: path.join(cacheDir, 'analysis.board-layout.json'),
    adviceJson: path.join(cacheDir, 'analysis.board-advice.json'),
    sourceJson: path.join(cacheDir, 'source.json'),
    summaryJson: path.join(cacheDir, 'summary.json')
  };
}

function boardCacheIsComplete(artifactPaths) {
  return [
    artifactPaths.layoutJson,
    artifactPaths.adviceJson,
    artifactPaths.sourceJson,
    artifactPaths.summaryJson
  ].every(filePath => fs.existsSync(filePath));
}

function buildAnalysisOnlySemantics(artifacts) {
  return {
    result_mode: 'analysis-only',
    write_mode: 'analysis-only',
    truth_write: {
      direct: false,
      requires_confirmation: true,
      domain: 'hardware',
      target: runtime.getProjectAssetRelativePath('hw.yaml'),
      source_artifacts: [
        artifacts.layout,
        artifacts.board_advice
      ].filter(Boolean),
      confirmation_targets: ['placement', 'routing', 'board-outline', 'manufacturing-rules']
    },
    apply_ready: null
  };
}

function buildHardwareReviewHandoff(parsed, artifacts) {
  return {
    required: false,
    status: 'optional-review-evidence',
    evidence_role: 'optional-layout-evidence',
    blocking: false,
    advisory_only: true,
    can_continue: true,
    command: artifacts && artifacts.layout ? `board advice --parsed ${artifacts.layout}` : 'board advice',
    inputs: [
      artifacts && artifacts.layout,
      artifacts && artifacts.board_advice
    ].filter(Boolean),
    summary: parsed && parsed.coverage ? parsed.coverage : {},
    reminder_policy: 'repeat-on-next-and-related-debug',
    skipped_when_missing: ['placement', 'routing', 'copper-area', 'via-count', 'connector-access', 'dfm', 'emi-layout'],
    note: 'PCB layout review is optional and advisory-only; missing PCB files must not block firmware, schematic, datasheet, or task workflow progress.'
  };
}

function normalizeBoardResult(summary) {
  return summary;
}

function ingestBoard(argv, options) {
  const args = parseArgs(argv || []);
  if (args.help) {
    usage();
    return { __side_effect_only: true };
  }

  const projectRoot = path.resolve(args.project || ((options && options.projectRoot) || process.cwd()));
  runtime.initProjectLayout(projectRoot);
  const absolutePath = path.resolve(projectRoot, args.file);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Board source not found: ${args.file}`);
  }

  const sourceBuffer = fs.readFileSync(absolutePath);
  const relativePath = normalizePath(path.relative(projectRoot, absolutePath));
  const detectedFormat = detectFormat(absolutePath, args.format);
  if (detectedFormat !== 'altium-pcbdoc') {
    throw new Error(`Unsupported board format: ${detectedFormat}`);
  }

  const cacheKey = hashBuffer(Buffer.concat([
    Buffer.from(JSON.stringify({
      file: relativePath,
      format: detectedFormat,
      title: args.title,
      parser: 'altium-pcbdoc-layout-v1'
    })),
    sourceBuffer
  ]));
  const boardId = `board-${cacheKey.slice(0, 12)}`;
  const cacheDir = path.join(getBoardCacheRoot(projectRoot), boardId);
  const artifactPaths = getArtifactPaths(cacheDir);
  runtime.ensureDir(getBoardCacheRoot(projectRoot));

  if (!args.force && boardCacheIsComplete(artifactPaths)) {
    const cached = runtime.readJson(artifactPaths.summaryJson);
    return {
      ...normalizeBoardResult(cached),
      cached: true,
      last_files: [normalizePath(path.relative(projectRoot, artifactPaths.summaryJson))]
    };
  }

  const parsed = altiumPcbDocParser.parseAltiumPcbDocBuffer(sourceBuffer);
  const advice = boardAdvisor.analyzeBoardAdvice(parsed);
  const artifacts = {
    layout: normalizePath(path.relative(projectRoot, artifactPaths.layoutJson)),
    board_advice: normalizePath(path.relative(projectRoot, artifactPaths.adviceJson)),
    source: normalizePath(path.relative(projectRoot, artifactPaths.sourceJson)),
    summary: normalizePath(path.relative(projectRoot, artifactPaths.summaryJson))
  };

  parsed.board_advice = advice;

  const summary = {
    ...buildAnalysisOnlySemantics(artifacts),
    status: 'ok',
    domain: 'board',
    cached: false,
    source_path: relativePath,
    format: detectedFormat,
    board_id: boardId,
    parser: {
      mode: parsed.parser_mode,
      summary: 'Altium PcbDoc was read directly from its OLE/CFB container and normalized across Board, Component, Net, Pad, Track, Via, Arc, Polygon, and Region streams.'
    },
    evidence_policy: {
      role: 'optional-layout-evidence',
      blocking: false,
      can_continue_without_board: true,
      missing_board_behavior: 'skip layout-dependent checks and continue with schematic, datasheet, firmware, and task workflow evidence'
    },
    summary: {
      records: parsed.coverage.records,
      components: parsed.coverage.components,
      pads: parsed.coverage.pads,
      texts: parsed.coverage.texts,
      tracks: parsed.coverage.tracks,
      vias: parsed.coverage.vias,
      arcs: parsed.coverage.arcs,
      polygons: parsed.coverage.polygons,
      nets: parsed.coverage.nets,
      outlines: parsed.coverage.outlines,
      layer_stack: parsed.coverage.layer_stack,
      advice_findings: advice.summary.findings,
      advice_warnings: advice.summary.warnings
    },
    metadata: parsed.metadata,
    board: {
      bounds: parsed.board.bounds
    },
    cache_dir: normalizePath(path.relative(projectRoot, cacheDir)),
    artifacts,
    hardware_review: buildHardwareReviewHandoff(parsed, artifacts),
    next_steps: [
      `Inspect ${artifacts.layout} to confirm parsed object coverage before judging placement quality.`,
      `Use ${artifacts.board_advice} as nonblocking layout review prompts and cross-check against schematic and datasheets.`
    ],
    last_files: [
      artifacts.layout,
      artifacts.board_advice,
      artifacts.summary
    ]
  };

  runtime.writeJson(artifactPaths.sourceJson, {
    source_path: relativePath,
    title: args.title || path.basename(relativePath),
    format: detectedFormat,
    parser_mode: parsed.parser_mode,
    content_hash: cacheKey
  });
  runtime.writeJson(artifactPaths.layoutJson, parsed);
  runtime.writeJson(artifactPaths.adviceJson, advice);
  runtime.writeJson(artifactPaths.summaryJson, summary);

  return summary;
}

module.exports = {
  ingestBoard,
  parseArgs,
  usage
};

if (require.main === module) {
  try {
    const result = ingestBoard(process.argv.slice(2));
    if (result && !result.__side_effect_only) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write(`ingest-board error: ${error.message}\n`);
    process.exit(1);
  }
}
