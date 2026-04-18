#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));

const ANALYSIS_SCHEMA_ID = 'https://emb-agent.dev/schemas/chip-support-analysis.schema.json';

function usage() {
  process.stdout.write(
    [
      'support-analysis usage:',
      '  node scripts/support-analysis.cjs init --chip <name>',
      '    [--model <name>] [--vendor <name>] [--series <name>]',
      '    [--family <slug>] [--device <slug>] [--package <name>] [--pin-count <n>]',
      '    [--architecture <text>] [--runtime-model <name>]',
      '    [--output <path>] [--force]'
    ].join('\n') + '\n'
  );
}

function ensureNonEmpty(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Missing value for ${label}`);
  }
  return normalized;
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compactSlug(value) {
  return normalizeSlug(value).replace(/-/g, '');
}

function parseInitArgs(argv) {
  const result = {
    chip: '',
    model: '',
    vendor: '',
    series: '',
    family: '',
    device: '',
    package: '',
    pinCount: 0,
    architecture: '',
    runtimeModel: 'main_loop_plus_isr',
    output: '',
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--chip') {
      result.chip = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--model') {
      result.model = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--vendor') {
      result.vendor = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--series') {
      result.series = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--family') {
      result.family = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--device') {
      result.device = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--package') {
      result.package = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--pin-count') {
      result.pinCount = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--architecture') {
      result.architecture = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--runtime-model') {
      result.runtimeModel = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--output') {
      result.output = argv[index + 1] || '';
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

  result.runtimeModel = ensureNonEmpty(result.runtimeModel, '--runtime-model');
  if (result.pinCount !== 0 && (!Number.isInteger(result.pinCount) || result.pinCount < 1)) {
    throw new Error('--pin-count must be a positive integer');
  }

  if (!String(result.chip || result.model || result.device).trim()) {
    throw new Error('support analysis init requires --chip, --model, or --device');
  }

  return result;
}

function resolveSeedName(parsed) {
  return String(parsed.chip || parsed.model || parsed.device || '').trim();
}

function resolveOutputPath(projectRoot, parsed) {
  if (String(parsed.output || '').trim()) {
    return path.resolve(projectRoot, parsed.output);
  }

  return path.join(runtime.getProjectExtDir(projectRoot), 'analysis', `${normalizeSlug(resolveSeedName(parsed))}.json`);
}

function buildArtifact(parsed) {
  const model = String(parsed.model || parsed.chip || '').trim();
  const device = normalizeSlug(parsed.device || model || parsed.chip);
  const chip =
    String(parsed.chip || '').trim()
      ? normalizeSlug(parsed.chip)
      : parsed.package
        ? compactSlug(`${device}-${parsed.package}`)
        : device;
  const family = normalizeSlug(parsed.family || [parsed.vendor, parsed.series || model].filter(Boolean).join('-'));

  return {
    $schema: ANALYSIS_SCHEMA_ID,
    chip_support_analysis: {
      vendor: String(parsed.vendor || '').trim(),
      series: String(parsed.series || '').trim(),
      model,
      family,
      device,
      chip,
      package: String(parsed.package || '').trim(),
      pin_count: parsed.pinCount || 0,
      architecture: String(parsed.architecture || '').trim(),
      runtime_model: parsed.runtimeModel,
      tools: [],
      capabilities: [],
      docs: [],
      truths: [],
      constraints: [],
      unknowns: [],
      signals: [],
      peripherals: [],
      bindings: {},
      notes: [
        'Draft analysis artifact for AI-assisted chip-support derivation.',
        'Keep only evidence-backed facts from datasheets/manuals/schematics here.',
        'Executable bindings remain draft after support derive/generate; use unsupported plus reason for negative conclusions.'
      ]
    }
  };
}

function initAnalysis(argv, options = {}) {
  const parsed = parseInitArgs(argv || []);
  if (parsed.help) {
    usage();
    return { __side_effect_only: true };
  }

  const projectRoot = path.resolve((options && options.projectRoot) || process.cwd());
  const outputPath = resolveOutputPath(projectRoot, parsed);
  const relativePath = path.relative(projectRoot, outputPath).replace(/\\/g, '/');

  if (fs.existsSync(outputPath) && !parsed.force) {
    throw new Error(`Analysis artifact already exists: ${relativePath}`);
  }

  runtime.ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(buildArtifact(parsed), null, 2) + '\n', 'utf8');

  return {
    status: 'ok',
    command: 'support analysis init',
    schema_id: ANALYSIS_SCHEMA_ID,
    draft: true,
    artifact_path: relativePath,
    family: normalizeSlug(parsed.family || ''),
    device: normalizeSlug(parsed.device || parsed.model || parsed.chip),
    chip: buildArtifact(parsed).chip_support_analysis.chip,
    derive_hint: `support derive --from-analysis ${relativePath}`,
    notes: [
      'Fill this artifact with evidence-backed facts before deriving adapters.',
      'Keep executable bindings as proposals only; derive/generate will still write them as draft.'
    ]
  };
}

function main(argv = process.argv.slice(2)) {
  const [subcmd, ...rest] = argv;
  if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    usage();
    return;
  }

  if (subcmd === 'init') {
    process.stdout.write(JSON.stringify(initAnalysis(rest), null, 2) + '\n');
    return;
  }

  throw new Error(`Unknown support-analysis subcommand: ${subcmd}`);
}

module.exports = {
  ANALYSIS_SCHEMA_ID,
  parseInitArgs,
  buildArtifact,
  initAnalysis,
  main
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`support-analysis error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
