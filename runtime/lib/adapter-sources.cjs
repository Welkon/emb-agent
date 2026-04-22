'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const runtime = require('./runtime.cjs');

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function ensureTarget(value) {
  const target = ensureString(value || 'project', 'target');
  if (!['project', 'runtime'].includes(target)) {
    throw new Error('target must be one of: project, runtime');
  }
  return target;
}

function getProjectEmbDir(projectRoot) {
  return runtime.getProjectExtDir(projectRoot);
}

function getTargetEmbDir(rootDir, projectRoot, target) {
  return ensureTarget(target) === 'runtime' ? rootDir : getProjectEmbDir(projectRoot);
}

function getTargetCacheDir(rootDir, projectRoot, target) {
  return path.join(getTargetEmbDir(rootDir, projectRoot, target), 'cache', 'chip-support-sources');
}

function getManifestPath(rootDir, projectRoot, target) {
  return path.join(getTargetEmbDir(rootDir, projectRoot, target), 'cache', 'chip-support-sync-manifest.json');
}

function emptyManifest(target) {
  return {
    version: 1,
    target: ensureTarget(target),
    entries: {}
  };
}

function loadManifest(rootDir, projectRoot, target) {
  const manifestPath = getManifestPath(rootDir, projectRoot, target);
  if (!fs.existsSync(manifestPath)) {
    return emptyManifest(target);
  }

  const raw = runtime.readJson(manifestPath);
  return {
    version: Number(raw.version || 1),
    target: ensureTarget(raw.target || target),
    entries:
      raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {}
  };
}

function saveManifest(rootDir, projectRoot, target, manifest) {
  const manifestPath = getManifestPath(rootDir, projectRoot, target);
  runtime.ensureDir(path.dirname(manifestPath));
  runtime.writeJson(manifestPath, manifest);
}

function buildEntryKey(target, name) {
  return `${ensureTarget(target)}:${ensureString(name, 'source name')}`;
}

function findSource(projectConfig, name) {
  const normalized = ensureString(name, 'source name');
  const sources = (projectConfig && projectConfig.chip_support_sources) || [];
  return sources.find(item => item.name === normalized) || null;
}

function runGit(args, cwd, label) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`${label} failed: ${detail}`);
  }
}

function normalizeRelativePath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function joinRelativePath(prefix, relativePath) {
  const normalizedPrefix = normalizeRelativePath(prefix);
  const normalizedRelative = normalizeRelativePath(relativePath);

  if (!normalizedPrefix) {
    return normalizedRelative;
  }
  if (!normalizedRelative) {
    return normalizedPrefix;
  }

  return `${normalizedPrefix}/${normalizedRelative}`;
}

function isRemoteGitLocation(location) {
  const normalized = String(location || '').trim();
  return (
    normalized.includes('://') ||
    normalized.startsWith('git@') ||
    normalized.startsWith('ssh://')
  );
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function getMarkdownSectionBody(content, heading) {
  const normalizedContent = String(content || '');
  const normalizedHeading = String(heading || '').trim();
  if (!normalizedContent || !normalizedHeading) {
    return '';
  }

  const start = normalizedContent.indexOf(normalizedHeading);
  if (start === -1) {
    return '';
  }

  const afterHeading = normalizedContent.slice(start + normalizedHeading.length);
  const nextSectionIndex = afterHeading.search(/\n##\s+/);
  if (nextSectionIndex === -1) {
    return afterHeading;
  }
  return afterHeading.slice(0, nextSectionIndex);
}

function inspectPromotionEvidence(projectRoot) {
  const checks = [
    {
      key: 'review',
      label: 'docs/REVIEW-REPORT.md',
      filePath: path.join(projectRoot, 'docs', 'REVIEW-REPORT.md'),
      sectionHeading: '## Emb-Agent Reviews'
    },
    {
      key: 'verification',
      label: 'docs/VERIFICATION.md',
      filePath: path.join(projectRoot, 'docs', 'VERIFICATION.md'),
      sectionHeading: '## Emb-Agent Verifications'
    }
  ];

  const evidence = checks.map(item => {
    if (!pathExists(item.filePath)) {
      return {
        key: item.key,
        label: item.label,
        present: false,
        has_section: false,
        has_entry: false
      };
    }

    const content = runtime.readText(item.filePath);
    const sectionBody = getMarkdownSectionBody(content, item.sectionHeading);
    return {
      key: item.key,
      label: item.label,
      present: true,
      has_section: Boolean(sectionBody),
      has_entry: /^###\s+/m.test(sectionBody)
    };
  });

  const missing = evidence
    .filter(item => !item.present || !item.has_section || !item.has_entry)
    .map(item => item.label);

  return {
    passed: missing.length === 0,
    required: checks.map(item => item.label),
    missing_evidence: missing,
    evidence
  };
}

function hasLayoutContent(layoutRoot) {
  return (
    pathExists(path.join(layoutRoot, 'chip-support')) ||
    pathExists(path.join(layoutRoot, 'extensions', 'tools')) ||
    pathExists(path.join(layoutRoot, 'extensions', 'chips'))
  );
}

function resolveLayoutRoot(baseRoot, subdir) {
  const rootWithSubdir = subdir ? path.resolve(baseRoot, subdir) : baseRoot;
  const candidates = [
    rootWithSubdir,
    path.join(rootWithSubdir, '.emb-agent'),
    path.join(rootWithSubdir, 'emb-agent')
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate) && hasLayoutContent(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Adapter source layout not found under: ${rootWithSubdir}`);
}

function buildCandidateLayoutPrefixes(source) {
  const prefixes = [];
  const base = normalizeRelativePath(source && source.subdir);
  const push = value => {
    const normalized = normalizeRelativePath(value);
    if (!prefixes.includes(normalized)) {
      prefixes.push(normalized);
    }
  };

  push(base);
  push(joinRelativePath(base, '.emb-agent'));
  push(joinRelativePath(base, 'emb-agent'));
  return prefixes;
}

function buildGitMetadataSparsePatterns(source) {
  const patterns = new Set();
  const layoutPrefixes = buildCandidateLayoutPrefixes(source);
  const relativePaths = [
    'chip-support/core/**',
    'extensions/tools/specs/**',
    'extensions/tools/families/**',
    'extensions/tools/devices/**',
    'extensions/chips/profiles/**',
    'extensions/chips/devices/**'
  ];

  layoutPrefixes.forEach(prefix => {
    relativePaths.forEach(relativePath => {
      patterns.add(joinRelativePath(prefix, relativePath));
    });
  });

  return Array.from(patterns).sort();
}

function configureGitWorkingTree(repoDir, source, patterns) {
  const hasPatterns = Array.isArray(patterns) && patterns.length > 0;

  if (hasPatterns) {
    runGit(['sparse-checkout', 'init', '--no-cone'], repoDir, `git sparse-checkout init for source ${source.name}`);
    runGit(
      ['sparse-checkout', 'set'].concat(patterns.map(pattern => normalizeRelativePath(pattern)).filter(Boolean)),
      repoDir,
      `git sparse-checkout set for source ${source.name}`
    );
    runGit(['checkout', '--force', 'HEAD'], repoDir, `git checkout for source ${source.name}`);
    return;
  }

  try {
    runGit(['sparse-checkout', 'disable'], repoDir, `git sparse-checkout disable for source ${source.name}`);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (!message.includes('disable')) {
      throw error;
    }
  }
}

function materializeGitSource(rootDir, projectRoot, source, target, sparsePatterns, options) {
  const cacheDir = path.join(getTargetCacheDir(rootDir, projectRoot, target), source.name);
  const repoDir = path.join(cacheDir, 'repo');
  const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  runtime.ensureDir(cacheDir);

  if (!pathExists(repoDir)) {
    const cloneArgs = ['clone'];
    const useSparse = Array.isArray(sparsePatterns) && sparsePatterns.length > 0;
    if (useSparse) {
      cloneArgs.push('--no-checkout', '--sparse');
      if (isRemoteGitLocation(source.location)) {
        cloneArgs.push('--filter=blob:none');
      }
    }
    if (source.branch) {
      cloneArgs.push('--branch', source.branch, '--single-branch');
    }
    cloneArgs.push(source.location, repoDir);
    runGit(cloneArgs, projectRoot, `git clone for source ${source.name}`);
    configureGitWorkingTree(repoDir, source, sparsePatterns);
  } else {
    if (!pathExists(path.join(repoDir, '.git'))) {
      throw new Error(`Cached source is not a git repository: ${repoDir}`);
    }

    if (settings.skip_update !== true) {
      runGit(['fetch', '--all', '--tags'], repoDir, `git fetch for source ${source.name}`);
      if (source.branch) {
        runGit(['checkout', source.branch], repoDir, `git checkout for source ${source.name}`);
        runGit(['pull', '--ff-only', 'origin', source.branch], repoDir, `git pull for source ${source.name}`);
      } else {
        runGit(['pull', '--ff-only'], repoDir, `git pull for source ${source.name}`);
      }
    }

    configureGitWorkingTree(repoDir, source, sparsePatterns);
  }

  return repoDir;
}

function resolveSourceRoot(rootDir, projectRoot, source, target, sparsePatterns, options) {
  if (source.type === 'path') {
    const location = path.isAbsolute(source.location)
      ? source.location
      : path.resolve(projectRoot, source.location);
    return {
      checkout_root: location,
      layout_root: resolveLayoutRoot(location, source.subdir),
      source_kind: 'path'
    };
  }

  const checkoutRoot = materializeGitSource(rootDir, projectRoot, source, target, sparsePatterns, options);
  return {
    checkout_root: checkoutRoot,
    layout_root: resolveLayoutRoot(checkoutRoot, source.subdir),
    source_kind: 'git'
  };
}

function listFiles(dirPath, extension) {
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(name => name.endsWith(extension))
    .sort();
}

function walkFiles(dirPath, extension, prefixParts) {
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  entries.forEach(entry => {
    const sourcePath = path.join(dirPath, entry.name);
    const relativeParts = (prefixParts || []).concat(entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(sourcePath, extension, relativeParts));
      return;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push({
        sourcePath,
        relativePath: path.join(...relativeParts)
      });
    }
  });

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function collectSourceFiles(layoutRoot) {
  const mappings = [];
  const seen = new Set();

  const pushMapping = item => {
    if (seen.has(item.relativePath)) {
      return;
    }
    seen.add(item.relativePath);
    mappings.push(item);
  };

  const addFiles = (sourceDir, extension, targetParts, recursive, mapRelativePath) => {
    const nextFiles = recursive
      ? walkFiles(sourceDir, extension, targetParts)
      : listFiles(sourceDir, extension).map(fileName => ({
          sourcePath: path.join(sourceDir, fileName),
          relativePath: path.join(...targetParts, fileName)
        }));

    nextFiles.forEach(item => {
      pushMapping({
        sourcePath: item.sourcePath,
        relativePath: mapRelativePath ? mapRelativePath(item.relativePath) : item.relativePath
      });
    });
  };

  addFiles(path.join(layoutRoot, 'chip-support'), '.cjs', ['chip-support'], true);
  addFiles(path.join(layoutRoot, 'extensions', 'tools'), '.cjs', ['extensions', 'tools'], true);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'specs'), '.json', ['extensions', 'tools', 'specs']);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'families'), '.json', [
    'extensions',
    'tools',
    'families'
  ]);
  addFiles(path.join(layoutRoot, 'extensions', 'tools', 'devices'), '.json', [
    'extensions',
    'tools',
    'devices'
  ]);
  addFiles(path.join(layoutRoot, 'extensions', 'chips', 'profiles'), '.json', [
    'extensions',
    'chips',
    'profiles'
  ]);
  addFiles(path.join(layoutRoot, 'extensions', 'chips', 'devices'), '.json', [
    'extensions',
    'chips',
    'devices'
  ], false, relativePath => relativePath.replace(`${path.sep}devices${path.sep}`, `${path.sep}profiles${path.sep}`));
  addFiles(path.join(layoutRoot, 'docs', 'sources'), '.md', ['docs', 'sources'], true);

  return mappings;
}

function parseScalar(content, key) {
  const lines = String(content || '').split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${key}:\\s*(.*)$`);

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    return String(match[1] || '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  return '';
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

function ensureArrayStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function readProjectHardwareIdentity(projectRoot) {
  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  if (!pathExists(hwPath)) {
    return {
      vendor: '',
      model: '',
      package: ''
    };
  }

  const content = runtime.readText(hwPath);
  return {
    vendor: parseScalar(content, 'vendor'),
    model: parseScalar(content, 'model'),
    package: parseScalar(content, 'package')
  };
}

function inferProjectChipCandidates(projectRoot) {
  const hardware = readProjectHardwareIdentity(projectRoot);
  const model = String(hardware.model || '').trim();
  const packageName = String(hardware.package || '').trim();

  if (!model) {
    return {
      hardware,
      chips: []
    };
  }

  return {
    hardware,
    chips: runtime.unique(
      [
        model,
        normalizeSlug(model),
        compactSlug(model),
        packageName ? compactSlug(`${model}-${packageName}`) : '',
        packageName ? compactSlug(`${model}${packageName}`) : ''
      ]
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )
  };
}

function relativePathStartsWith(relativePath, parts) {
  return relativePath.startsWith(path.join(...parts) + path.sep);
}

function fileBaseName(relativePath) {
  return path.basename(relativePath, path.extname(relativePath));
}

function tryReadJson(filePath) {
  try {
    return runtime.readJson(filePath);
  } catch {
    return null;
  }
}

function sourceRefIdFromRelativePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized.startsWith('docs/sources/') || !normalized.endsWith('.md')) {
    return '';
  }

  return normalized.slice('docs/sources/'.length, -3);
}

function buildSyncSelection(projectRoot, options) {
  const tools = ensureArrayStrings(options && options.tools);
  const families = ensureArrayStrings(options && options.families);
  const devices = ensureArrayStrings(options && options.devices);
  const chips = ensureArrayStrings(options && options.chips);
  const hasExplicit =
    tools.length > 0 || families.length > 0 || devices.length > 0 || chips.length > 0;

  if (hasExplicit) {
    return {
      filtered: true,
      inferred_from_project: false,
      hardware: {
        vendor: '',
        model: '',
        package: ''
      },
      selectors: {
        tools,
        families,
        devices,
        chips
      }
    };
  }

  if (options && options.match_project === false) {
    return {
      filtered: false,
      inferred_from_project: false,
      hardware: {
        vendor: '',
        model: '',
        package: ''
      },
      selectors: {
        tools: [],
        families: [],
        devices: [],
        chips: []
      }
    };
  }

  const inferred = inferProjectChipCandidates(projectRoot);
  if (inferred.chips.length === 0) {
    return {
      filtered: true,
      skipped: true,
      skip_reason: 'missing-project-chip',
      inferred_from_project: false,
      hardware: inferred.hardware,
      selectors: {
        tools: [],
        families: [],
        devices: [],
        chips: []
      }
    };
  }

  return {
    filtered: true,
    inferred_from_project: true,
    hardware: inferred.hardware,
    selectors: {
      tools: [],
      families: [],
      devices: [],
      chips: inferred.chips
    }
  };
}

function scanLocalRequires(layoutRoot, selectedPaths) {
  const queue = Array.from(selectedPaths);
  const discovered = new Set(selectedPaths);

  while (queue.length > 0) {
    const relativePath = queue.shift();
    const fullPath = path.join(layoutRoot, relativePath);

    if (!pathExists(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }

    const content = runtime.readText(fullPath);
    const requirePattern = /require\(\s*['"](\.[^'"]*)['"]\s*\)/g;
    let match = requirePattern.exec(content);

    while (match) {
      const rawImport = match[1];
      const resolved = path.normalize(path.join(path.dirname(relativePath), rawImport));
      const candidates = [resolved, `${resolved}.cjs`, path.join(resolved, 'index.cjs')];

      candidates.forEach(candidate => {
        const normalized = path.normalize(candidate);
        const targetPath = path.join(layoutRoot, normalized);
        if (!normalized.startsWith('..') && pathExists(targetPath) && !discovered.has(normalized)) {
          discovered.add(normalized);
          queue.push(normalized);
        }
      });

      match = requirePattern.exec(content);
    }
  }

  return discovered;
}

function analyzeSourceSelection(layoutRoot, files, selection) {
  if (selection && selection.skipped) {
    return {
      selection: {
        filtered: true,
        skipped: true,
        skip_reason: selection.skip_reason || '',
        inferred_from_project: false,
        hardware: selection.hardware || {
          vendor: '',
          model: '',
          package: ''
        },
        requested: selection.selectors || {
          tools: [],
          families: [],
          devices: [],
          chips: []
        },
        matched: {
          tools: [],
          families: [],
          devices: [],
          chips: []
        },
        total_files: files.length,
        selected_files: 0
      },
      selected_relative_paths: new Set(),
      matched_tools: [],
      matched_families: [],
      matched_devices: [],
      matched_chips: [],
      selected_source_refs: [],
      selected_algorithms: []
    };
  }

  if (!selection || !selection.filtered) {
    return {
      selection: {
        filtered: false,
        inferred_from_project: false,
        hardware: (selection && selection.hardware) || {
          vendor: '',
          model: '',
          package: ''
        },
        requested: {
          tools: [],
          families: [],
          devices: [],
          chips: []
        },
        matched: {
          tools: [],
          families: [],
          devices: [],
          chips: []
        },
        total_files: files.length,
        selected_files: files.length
      },
      selected_relative_paths: new Set(),
      matched_tools: [],
      matched_families: [],
      matched_devices: [],
      matched_chips: [],
      selected_source_refs: [],
      selected_algorithms: []
    };
  }

  const requestedTools = new Set(selection.selectors.tools);
  const requestedFamilies = new Set(selection.selectors.families);
  const requestedDevices = new Set(selection.selectors.devices);
  const requestedChips = new Set(selection.selectors.chips);
  const chipProfiles = new Map();
  const toolFamilies = new Map();
  const toolDevices = new Map();
  const specFiles = new Map();
  const routeFiles = new Map();
  const sourceDocs = new Map();
  const adapterFiles = [];
  const selectedRelativePaths = new Set();

  files.forEach(item => {
    const fileName = fileBaseName(item.relativePath);

    if (relativePathStartsWith(item.relativePath, ['extensions', 'chips', 'profiles'])) {
      chipProfiles.set(fileName, {
        file: item,
        json: tryReadJson(item.sourcePath) || {}
      });
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['extensions', 'tools', 'families'])) {
      toolFamilies.set(fileName, {
        file: item,
        json: tryReadJson(item.sourcePath) || {}
      });
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['extensions', 'tools', 'devices'])) {
      toolDevices.set(fileName, {
        file: item,
        json: tryReadJson(item.sourcePath) || {}
      });
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['extensions', 'tools', 'specs'])) {
      specFiles.set(fileName, item);
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['chip-support', 'routes'])) {
      routeFiles.set(fileName, item);
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['docs', 'sources'])) {
      const refId = sourceRefIdFromRelativePath(item.relativePath);
      if (refId) {
        sourceDocs.set(refId, item);
      }
      return;
    }

    if (relativePathStartsWith(item.relativePath, ['chip-support'])) {
      adapterFiles.push(item);
    }
  });

  if (requestedFamilies.size > 0) {
    toolDevices.forEach((entry, name) => {
      if (requestedFamilies.has(String(entry.json.family || '').trim())) {
        requestedDevices.add(name);
      }
    });

    chipProfiles.forEach((entry, name) => {
      if (requestedFamilies.has(String(entry.json.family || '').trim())) {
        requestedChips.add(name);
      }
    });
  }

  if (requestedChips.size > 0) {
    requestedChips.forEach(name => {
      const chip = chipProfiles.get(name);
      if (!chip) {
        return;
      }

      const chipFamily = String(chip.json.family || '').trim();
      if (chipFamily) {
        requestedFamilies.add(chipFamily);
      }

      if (toolDevices.has(name)) {
        requestedDevices.add(name);
      }

      toolDevices.forEach((deviceEntry, deviceName) => {
        const deviceFamily = String(deviceEntry.json.family || '').trim();
        if (!deviceFamily || deviceFamily !== chipFamily) {
          return;
        }

        if (name.startsWith(deviceName) || deviceName.startsWith(name)) {
          requestedDevices.add(deviceName);
        }
      });
    });
  }

  if (requestedDevices.size > 0) {
    requestedDevices.forEach(name => {
      const device = toolDevices.get(name);
      if (!device) {
        return;
      }

      const familyName = String(device.json.family || '').trim();
      if (familyName) {
        requestedFamilies.add(familyName);
      }

      if (chipProfiles.has(name)) {
        requestedChips.add(name);
      }
    });
  }

  const matchedChips = Array.from(requestedChips).filter(name => chipProfiles.has(name)).sort();
  const matchedDevices = Array.from(requestedDevices).filter(name => toolDevices.has(name)).sort();
  const matchedFamilies = Array.from(requestedFamilies).filter(name => toolFamilies.has(name)).sort();
  const matchedTools = new Set(requestedTools);

  matchedChips.forEach(name => {
    const chip = chipProfiles.get(name).json || {};
    ensureArrayStrings(chip.related_tools).forEach(toolName => matchedTools.add(toolName));
    ensureArrayStrings(chip.supported_tools).forEach(toolName => matchedTools.add(toolName));
  });

  matchedDevices.forEach(name => {
    const device = toolDevices.get(name).json || {};
    ensureArrayStrings(device.supported_tools).forEach(toolName => matchedTools.add(toolName));
  });

  matchedFamilies.forEach(name => {
    const family = toolFamilies.get(name).json || {};
    ensureArrayStrings(family.supported_tools).forEach(toolName => matchedTools.add(toolName));
  });

  matchedFamilies.forEach(name => {
    selectedRelativePaths.add(toolFamilies.get(name).file.relativePath);
  });
  matchedDevices.forEach(name => {
    selectedRelativePaths.add(toolDevices.get(name).file.relativePath);
  });
  matchedChips.forEach(name => {
    selectedRelativePaths.add(chipProfiles.get(name).file.relativePath);
  });

  matchedTools.forEach(name => {
    if (specFiles.has(name)) {
      selectedRelativePaths.add(specFiles.get(name).relativePath);
    }
    if (routeFiles.has(name)) {
      selectedRelativePaths.add(routeFiles.get(name).relativePath);
    }
  });

  const selectedSourceRefs = new Set();
  const collectProfileRefs = profile => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return;
    }

    ensureArrayStrings(profile.source_refs).forEach(refId => selectedSourceRefs.add(refId));
    ensureArrayStrings(profile.component_refs).forEach(refId => selectedSourceRefs.add(refId));
  };

  matchedFamilies.forEach(name => collectProfileRefs(toolFamilies.get(name).json));
  matchedDevices.forEach(name => collectProfileRefs(toolDevices.get(name).json));
  matchedChips.forEach(name => collectProfileRefs(chipProfiles.get(name).json));

  selectedSourceRefs.forEach(refId => {
    if (sourceDocs.has(refId)) {
      selectedRelativePaths.add(sourceDocs.get(refId).relativePath);
    }
  });

  const selectedAlgorithms = new Set();
  const collectAlgorithmsFromBindings = bindings => {
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
      return;
    }

    Object.entries(bindings).forEach(([toolName, binding]) => {
      if (!matchedTools.has(toolName)) {
        return;
      }

      if (binding && typeof binding === 'object' && typeof binding.algorithm === 'string' && binding.algorithm.trim()) {
        selectedAlgorithms.add(binding.algorithm.trim());
      }
    });
  };

  matchedFamilies.forEach(name => collectAlgorithmsFromBindings(toolFamilies.get(name).json.bindings));
  matchedDevices.forEach(name => collectAlgorithmsFromBindings(toolDevices.get(name).json.bindings));

  adapterFiles.forEach(item => {
    if (relativePathStartsWith(item.relativePath, ['chip-support', 'core'])) {
      selectedRelativePaths.add(item.relativePath);
      return;
    }

    if (
      relativePathStartsWith(item.relativePath, ['chip-support', 'algorithms']) &&
      selectedAlgorithms.has(fileBaseName(item.relativePath))
    ) {
      selectedRelativePaths.add(item.relativePath);
    }
  });

  return {
    selection: {
      filtered: true,
      inferred_from_project: selection.inferred_from_project,
      hardware: selection.hardware,
      requested: selection.selectors,
      matched: {
        tools: Array.from(matchedTools).sort(),
        families: matchedFamilies,
        devices: matchedDevices,
        chips: matchedChips
      },
      total_files: files.length,
      selected_files: 0
    },
    selected_relative_paths: selectedRelativePaths,
    matched_tools: Array.from(matchedTools).sort(),
    matched_families: matchedFamilies,
    matched_devices: matchedDevices,
    matched_chips: matchedChips,
    selected_source_refs: Array.from(selectedSourceRefs).sort(),
    selected_algorithms: Array.from(selectedAlgorithms).sort()
  };
}

function buildGitSelectionSparsePatterns(checkoutRoot, layoutRoot, analysis) {
  if (!analysis || !analysis.selection || !analysis.selection.filtered) {
    return [];
  }

  const matched =
    analysis.selection.matched || { tools: [], families: [], devices: [], chips: [] };
  const hasMeaningfulSelection =
    matched.tools.length > 0 ||
    matched.families.length > 0 ||
    matched.devices.length > 0 ||
    matched.chips.length > 0;

  if (!hasMeaningfulSelection) {
    return [];
  }

  const prefix = normalizeRelativePath(path.relative(checkoutRoot, layoutRoot));
  const patterns = new Set();
  const add = relativePath => {
    const normalized = normalizeRelativePath(relativePath);
    if (normalized) {
      patterns.add(joinRelativePath(prefix, normalized));
    }
  };

  add('chip-support/core/**');
  (analysis.selected_algorithms || []).forEach(name => add(`chip-support/algorithms/${name}.cjs`));

  matched.tools.forEach(name => {
    add(`extensions/tools/specs/${name}.json`);
    add(`chip-support/routes/${name}.cjs`);
  });
  matched.families.forEach(name => add(`extensions/tools/families/${name}.json`));
  matched.devices.forEach(name => add(`extensions/tools/devices/${name}.json`));
  matched.chips.forEach(name => {
    add(`extensions/chips/profiles/${name}.json`);
    add(`extensions/chips/devices/${name}.json`);
  });
  (analysis.selected_source_refs || []).forEach(refId => add(`docs/sources/${refId}.md`));

  return Array.from(patterns).sort();
}

function filterSourceFiles(layoutRoot, files, selection) {
  const analysis = analyzeSourceSelection(layoutRoot, files, selection);

  if (analysis.selection.skipped) {
    return {
      files: [],
      selection: analysis.selection
    };
  }

  if (!analysis.selection.filtered) {
    return {
      files,
      selection: analysis.selection
    };
  }

  const discovered = scanLocalRequires(layoutRoot, analysis.selected_relative_paths);
  const filteredFiles = files.filter(
    item => discovered.has(item.relativePath) || analysis.selected_relative_paths.has(item.relativePath)
  );

  if (filteredFiles.length === 0) {
    return {
      files,
      selection: {
        filtered: false,
        fallback_to_full_sync: true,
        inferred_from_project: analysis.selection.inferred_from_project,
        hardware: analysis.selection.hardware,
        requested: analysis.selection.requested,
        matched: analysis.selection.matched,
        total_files: files.length,
        selected_files: files.length
      }
    };
  }

  return {
    files: filteredFiles,
    selection: {
      filtered: true,
      inferred_from_project: analysis.selection.inferred_from_project,
      hardware: analysis.selection.hardware,
      requested: analysis.selection.requested,
      matched: analysis.selection.matched,
      total_files: files.length,
      selected_files: filteredFiles.length
    }
  };
}

function buildOwnedPathMap(manifest, excludeKey) {
  const owned = new Map();

  Object.entries(manifest.entries || {}).forEach(([entryKey, entry]) => {
    if (entryKey === excludeKey || !entry || !Array.isArray(entry.files)) {
      return;
    }

    entry.files.forEach(filePath => {
      if (!owned.has(filePath)) {
        owned.set(filePath, entryKey);
      }
    });
  });

  return owned;
}

function removeEmptyParents(filePath, stopDir) {
  let current = path.dirname(filePath);
  const limit = path.resolve(stopDir);

  while (current.startsWith(limit) && current !== limit) {
    if (!pathExists(current) || fs.readdirSync(current).length > 0) {
      break;
    }
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function rebuildRegistries(targetEmbDir) {
  const toolsRoot = path.join(targetEmbDir, 'extensions', 'tools');
  const chipsRoot = path.join(targetEmbDir, 'extensions', 'chips');
  const toolSpecsDir = path.join(toolsRoot, 'specs');
  const toolFamiliesDir = path.join(toolsRoot, 'families');
  const toolDevicesDir = path.join(toolsRoot, 'devices');
  const chipProfilesDir = path.join(chipsRoot, 'profiles');
  const chipDevicesDir = path.join(chipsRoot, 'devices');

  runtime.ensureDir(toolSpecsDir);
  runtime.ensureDir(toolFamiliesDir);
  runtime.ensureDir(toolDevicesDir);
  runtime.ensureDir(chipProfilesDir);
  runtime.ensureDir(chipDevicesDir);

  runtime.writeJson(path.join(toolsRoot, 'registry.json'), {
    specs: listFiles(toolSpecsDir, '.json').map(name => name.slice(0, -5)),
    families: listFiles(toolFamiliesDir, '.json').map(name => name.slice(0, -5)),
    devices: listFiles(toolDevicesDir, '.json').map(name => name.slice(0, -5))
  });

  runtime.writeJson(path.join(chipsRoot, 'registry.json'), {
    devices: runtime.unique(
      listFiles(chipProfilesDir, '.json')
        .concat(listFiles(chipDevicesDir, '.json'))
        .map(name => name.slice(0, -5))
    )
  });

  return [
    path.join('extensions', 'tools', 'registry.json'),
    path.join('extensions', 'chips', 'registry.json')
  ];
}

function syncAdapterSource(rootDir, projectRoot, source, options) {
  const target = ensureTarget((options && options.target) || 'project');
  const force = Boolean(options && options.force);
  const targetEmbDir = getTargetEmbDir(rootDir, projectRoot, target);
  const manifest = loadManifest(rootDir, projectRoot, target);
  const entryKey = buildEntryKey(target, source.name);
  const previousEntry = manifest.entries[entryKey] || null;
  const ownedByOthers = buildOwnedPathMap(manifest, entryKey);
  const selectionRequest = buildSyncSelection(projectRoot, options || {});

  if (selectionRequest.skipped) {
    return {
      name: source.name,
      target,
      status: 'skipped',
      reason: selectionRequest.skip_reason || 'skipped',
      source_type: source.type,
      checkout_root: previousEntry && previousEntry.checkout_root ? previousEntry.checkout_root : '',
      source_root: previousEntry && previousEntry.source_root ? previousEntry.source_root : '',
      selection: {
        filtered: true,
        skipped: true,
        skip_reason: selectionRequest.skip_reason || '',
        inferred_from_project: false,
        hardware: selectionRequest.hardware,
        requested: selectionRequest.selectors,
        matched: {
          tools: [],
          families: [],
          devices: [],
          chips: []
        },
        total_files: 0,
        selected_files: 0
      },
      files: [],
      generated: [],
      manifest: getManifestPath(rootDir, projectRoot, target)
    };
  }

  const metadataPatterns =
    source.type === 'git' && selectionRequest.filtered ? buildGitMetadataSparsePatterns(source) : null;
  let resolved = resolveSourceRoot(rootDir, projectRoot, source, target, metadataPatterns);
  let allFiles = collectSourceFiles(resolved.layout_root);

  if (source.type === 'git' && selectionRequest.filtered) {
    const analysis = analyzeSourceSelection(resolved.layout_root, allFiles, selectionRequest);
    const sparsePatterns = buildGitSelectionSparsePatterns(resolved.checkout_root, resolved.layout_root, analysis);

    resolved = resolveSourceRoot(
      rootDir,
      projectRoot,
      source,
      target,
      sparsePatterns.length > 0 ? sparsePatterns : null,
      { skip_update: true }
    );
    allFiles = collectSourceFiles(resolved.layout_root);
  }

  const filtered = filterSourceFiles(resolved.layout_root, allFiles, selectionRequest);
  const files = filtered.files;

  if (files.length === 0) {
    throw new Error(`Adapter source ${source.name} does not contain any syncable adapter files`);
  }

  const conflicts = [];
  files.forEach(item => {
    const destinationPath = path.join(targetEmbDir, item.relativePath);
    const owner = ownedByOthers.get(item.relativePath);

    if (owner && !force) {
      conflicts.push({
        path: item.relativePath,
        owner
      });
      return;
    }

    if (pathExists(destinationPath) && !owner) {
      const alreadyOwnedByThisSource =
        previousEntry && Array.isArray(previousEntry.files) && previousEntry.files.includes(item.relativePath);
      if (!alreadyOwnedByThisSource && !force) {
        conflicts.push({
          path: item.relativePath,
          owner: 'manual'
        });
      }
    }
  });

  if (conflicts.length > 0) {
    throw new Error(
      `Sync conflict for source ${source.name}: ${conflicts
        .map(item => `${item.path} (${item.owner})`)
        .join(', ')}`
    );
  }

  files.forEach(item => {
    const destinationPath = path.join(targetEmbDir, item.relativePath);
    runtime.ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(item.sourcePath, destinationPath);
  });

  const nextFiles = files.map(item => item.relativePath);
  const previousFiles = previousEntry && Array.isArray(previousEntry.files) ? previousEntry.files : [];

  previousFiles.forEach(relativePath => {
    if (nextFiles.includes(relativePath) || ownedByOthers.has(relativePath)) {
      return;
    }

    const filePath = path.join(targetEmbDir, relativePath);
    if (pathExists(filePath)) {
      fs.unlinkSync(filePath);
      removeEmptyParents(filePath, targetEmbDir);
    }
  });

  const generated = rebuildRegistries(targetEmbDir);
  manifest.entries[entryKey] = {
    name: source.name,
    target,
    type: source.type,
    location: source.location,
    branch: source.branch || '',
    subdir: source.subdir || '',
    enabled: source.enabled !== false,
    synced_at: new Date().toISOString(),
    checkout_root: resolved.checkout_root,
    source_root: resolved.layout_root,
    selection: filtered.selection,
    files: nextFiles,
    generated
  };
  saveManifest(rootDir, projectRoot, target, manifest);

  return {
    name: source.name,
    target,
    status: 'synced',
    source_type: source.type,
    checkout_root: resolved.checkout_root,
    source_root: resolved.layout_root,
    selection: filtered.selection,
    files: nextFiles,
    generated,
    manifest: getManifestPath(rootDir, projectRoot, target)
  };
}

function removeSyncedSource(rootDir, projectRoot, name, target) {
  const normalizedTarget = ensureTarget(target);
  const targetEmbDir = getTargetEmbDir(rootDir, projectRoot, normalizedTarget);
  const manifest = loadManifest(rootDir, projectRoot, normalizedTarget);
  const entryKey = buildEntryKey(normalizedTarget, name);
  const entry = manifest.entries[entryKey];

  if (!entry) {
    return {
      name,
      target: normalizedTarget,
      removed: false,
      files: []
    };
  }

  delete manifest.entries[entryKey];
  const ownedByOthers = buildOwnedPathMap(manifest, '');
  const removedFiles = [];

  (entry.files || []).forEach(relativePath => {
    if (ownedByOthers.has(relativePath)) {
      return;
    }

    const filePath = path.join(targetEmbDir, relativePath);
    if (pathExists(filePath)) {
      fs.unlinkSync(filePath);
      removeEmptyParents(filePath, targetEmbDir);
      removedFiles.push(relativePath);
    }
  });

  rebuildRegistries(targetEmbDir);
  saveManifest(rootDir, projectRoot, normalizedTarget, manifest);

  return {
    name,
    target: normalizedTarget,
    removed: true,
    files: removedFiles,
    manifest: getManifestPath(rootDir, projectRoot, normalizedTarget)
  };
}

function summarizeManifestEntry(entry) {
  if (!entry) {
    return {
      synced: false,
      synced_at: '',
      files_count: 0,
      source_root: '',
      checkout_root: '',
      selection: null
    };
  }

  return {
    synced: true,
    synced_at: entry.synced_at || '',
    files_count: Array.isArray(entry.files) ? entry.files.length : 0,
    source_root: entry.source_root || '',
    checkout_root: entry.checkout_root || '',
    selection: entry.selection || null
  };
}

function buildSourceStatus(rootDir, projectRoot, source) {
  const projectManifest = loadManifest(rootDir, projectRoot, 'project');
  const runtimeManifest = loadManifest(rootDir, projectRoot, 'runtime');

  return {
    ...source,
    targets: {
      project: summarizeManifestEntry(projectManifest.entries[buildEntryKey('project', source.name)]),
      runtime: summarizeManifestEntry(runtimeManifest.entries[buildEntryKey('runtime', source.name)])
    }
  };
}

function listSourceStatus(rootDir, projectRoot, projectConfig) {
  return ((projectConfig && projectConfig.chip_support_sources) || []).map(source =>
    buildSourceStatus(rootDir, projectRoot, source)
  );
}

function syncAllAdapterSources(rootDir, projectRoot, projectConfig, options) {
  const sources = ((projectConfig && projectConfig.chip_support_sources) || []).filter(
    source => source.enabled !== false
  );

  return sources.map(source => syncAdapterSource(rootDir, projectRoot, source, options));
}

function resolvePromoteLayoutRoot(baseRoot, subdir) {
  const rootWithSubdir = subdir ? path.resolve(baseRoot, subdir) : path.resolve(baseRoot);
  const candidates = [
    rootWithSubdir,
    path.join(rootWithSubdir, '.emb-agent'),
    path.join(rootWithSubdir, 'emb-agent')
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate) && hasLayoutContent(candidate)) {
      return candidate;
    }
  }

  return rootWithSubdir;
}

function hasSameFileContent(sourcePath, targetPath) {
  if (!pathExists(sourcePath) || !pathExists(targetPath)) {
    return false;
  }

  const sourceStats = fs.statSync(sourcePath);
  const targetStats = fs.statSync(targetPath);
  if (sourceStats.size !== targetStats.size) {
    return false;
  }

  return fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
}

function selectPromoteSource(projectConfig, sourceName) {
  const sources = ((projectConfig && projectConfig.chip_support_sources) || [])
    .filter(source => source && source.enabled !== false);
  const normalizedName = String(sourceName || '').trim();

  if (normalizedName) {
    const matched = findSource(projectConfig, normalizedName);
    if (!matched) {
      throw new Error(`Adapter source not found: ${normalizedName}`);
    }
    return matched;
  }

  const pathSources = sources.filter(source => source.type === 'path');
  if (pathSources.length === 1) {
    return pathSources[0];
  }
  if (pathSources.length === 0) {
    throw new Error('No enabled path-based chip support source is available; use --output-root or add a path source first');
  }

  throw new Error('Multiple enabled path-based chip support sources exist; specify the target source name explicitly');
}

function transferDerivedSupport(rootDir, projectRoot, projectConfig, options) {
  const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const inspection = settings.inspection && typeof settings.inspection === 'object' ? settings.inspection : null;
  const operation = settings.operation === 'export' ? 'export' : 'publish';
  const requirePromotionGate = settings.requirePromotionGate !== false;
  const verbLabel = operation === 'export' ? 'adapter export' : 'adapter publish';
  const pastVerb = operation === 'export' ? 'Exported' : 'Published';
  const conflictLabel = operation === 'export' ? 'Export conflict' : 'Publish conflict';
  const targetLabel = operation === 'export' ? 'private target' : 'shared source';
  if (!inspection || inspection.status !== 'ok') {
    throw new Error(`${verbLabel} requires a valid derived support inspection result`);
  }

  const force = Boolean(settings.force);
  const embRoot = getProjectEmbDir(projectRoot);
  const reviewSummary =
    inspection.review_summary && typeof inspection.review_summary === 'object'
      ? inspection.review_summary
      : {};
  const promotionGate = inspectPromotionEvidence(projectRoot);

  if (requirePromotionGate && inspection.reusability && inspection.reusability.status !== 'reusable-candidate' && !force) {
    throw new Error(
      `Derived support is ${inspection.reusability.status || 'not-promotable'}; only reusable-candidate can be published without --force`
    );
  }

  if (requirePromotionGate && !promotionGate.passed && !force) {
    throw new Error(
      `${verbLabel} requires saved review and verification evidence before publishing shared support; missing: ${promotionGate.missing_evidence.join(', ')}`
    );
  }

  let destinationRoot = '';
  let source = null;
  let destinationMode = 'output-root';

  if (settings.outputRoot) {
    destinationRoot = resolvePromoteLayoutRoot(settings.outputRoot, '');
  } else {
    source = selectPromoteSource(projectConfig, settings.sourceName);
    if (source.type !== 'path') {
      throw new Error(`${verbLabel} currently supports only path-based sources; use --output-root for other targets`);
    }
    const sourceLocation = path.isAbsolute(source.location)
      ? source.location
      : path.resolve(projectRoot, source.location);
    destinationRoot = resolvePromoteLayoutRoot(sourceLocation, source.subdir || '');
    destinationMode = 'source';
  }

  const conflicts = [];
  const copied = [];
  const overwritten = [];
  const unchanged = [];
  const files = Array.isArray(inspection.files) ? inspection.files : [];

  files.forEach(item => {
    const relativePath = normalizeRelativePath(item && item.path);
    if (!relativePath) {
      return;
    }

    const sourcePath = path.join(embRoot, relativePath);
    const targetPath = path.join(destinationRoot, relativePath);
    if (!pathExists(sourcePath)) {
      throw new Error(`Derived support file is missing: ${relativePath}`);
    }

    if (pathExists(targetPath)) {
      if (hasSameFileContent(sourcePath, targetPath)) {
        unchanged.push(relativePath);
        return;
      }
      if (!force) {
        conflicts.push(relativePath);
        return;
      }
      overwritten.push(relativePath);
    }

    runtime.ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    copied.push(relativePath);
  });

  if (conflicts.length > 0) {
    throw new Error(
      `${conflictLabel} at destination: ${conflicts.join(', ')}. Re-run with --force if overwrite is intended`
    );
  }

  const generated = rebuildRegistries(destinationRoot);

  return {
    status: 'ok',
    mode: destinationMode,
    source: source
      ? {
          name: source.name,
          type: source.type,
          location: source.location,
          subdir: source.subdir || ''
        }
      : null,
    destination_root: destinationRoot,
    family: inspection.family || '',
    device: inspection.device || '',
    chip: inspection.chip || '',
    tools: Array.isArray(inspection.tools) ? inspection.tools : [],
    operation,
    transferred_files: copied,
    promoted_files: copied,
    overwritten_files: overwritten,
    unchanged_files: unchanged,
    generated,
    reusability: inspection.reusability || null,
    promotion_gate: {
      enabled: requirePromotionGate,
      passed: requirePromotionGate ? promotionGate.passed : false,
      forced: requirePromotionGate ? (!promotionGate.passed && force) : false,
      missing_evidence: requirePromotionGate ? promotionGate.missing_evidence : [],
      required: requirePromotionGate ? promotionGate.required : []
    },
    trust: inspection.trust || null,
    review_summary: {
      recommended_action: reviewSummary.recommended_action || '',
      review_required: Boolean(reviewSummary.review_required),
      reasons: Array.isArray(reviewSummary.reasons) ? reviewSummary.reasons : [],
      blockers: Array.isArray(reviewSummary.blockers) ? reviewSummary.blockers : []
    },
    notes: runtime.unique([
      inspection.reusability && inspection.reusability.summary ? inspection.reusability.summary : '',
      requirePromotionGate
        ? (!promotionGate.passed && force
          ? `Promotion evidence gate was overridden with --force (${promotionGate.missing_evidence.join(', ')}).`
          : 'Promotion evidence gate passed with saved review and verification records.')
        : 'Private export keeps current draft/reuse status and does not require promotion evidence.',
      source
        ? `${pastVerb} derived support into ${targetLabel} ${source.name}.`
        : `${pastVerb} derived support into the requested output root.`,
      generated.length > 0 ? 'Extension registries were rebuilt at the destination.' : ''
    ])
  };
}

function exportDerivedSupport(rootDir, projectRoot, projectConfig, options) {
  return transferDerivedSupport(rootDir, projectRoot, projectConfig, {
    ...(options || {}),
    operation: 'export',
    requirePromotionGate: false
  });
}

function publishDerivedSupport(rootDir, projectRoot, projectConfig, options) {
  return transferDerivedSupport(rootDir, projectRoot, projectConfig, {
    ...(options || {}),
    operation: 'publish',
    requirePromotionGate: true
  });
}

function promoteDerivedSupport(rootDir, projectRoot, projectConfig, options) {
  return publishDerivedSupport(rootDir, projectRoot, projectConfig, options);
}

module.exports = {
  buildSourceStatus,
  findSource,
  getManifestPath,
  getTargetEmbDir,
  listSourceStatus,
  loadManifest,
  exportDerivedSupport,
  publishDerivedSupport,
  promoteDerivedSupport,
  removeSyncedSource,
  resolveSourceRoot,
  syncAdapterSource,
  syncAllAdapterSources
};
