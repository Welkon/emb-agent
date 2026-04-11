'use strict';

function createCliEntryHelpers(deps) {
  const {
    fs,
    path,
    process,
    ROOT,
    runtime,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    getProjectExtDir,
    initProjectLayout,
    ensureSession,
    updateSession,
    attachProjectCli,
    chipCatalog,
    ingestTruthCli,
    ingestDocCli
  } = deps;

  const GENERATED_DOCS = new Set([
    'docs/HARDWARE-LOGIC.md',
    'docs/DEBUG-NOTES.md',
    'docs/MCU-FOUNDATION-CHECKLIST.md',
    'docs/CONNECTIVITY.md',
    'docs/RELEASE-NOTES.md',
    'docs/POWER-CHARGING.md',
    'docs/VERIFICATION.md',
    'docs/REVIEW-REPORT.md',
    'docs/ARCH-REVIEW.md'
  ]);

  function parseScalar(content, key) {
    const line = String(content || '')
      .split(/\r?\n/)
      .find(item => item.trim().startsWith(`${key}:`));

    if (!line) {
      return '';
    }

    return line
      .split(':')
      .slice(1)
      .join(':')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  function loadInitHardwareIdentity(projectRoot) {
    const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
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

  function loadInitDeveloperIdentity(projectRoot) {
    const configPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const projectConfig = fs.existsSync(configPath) ? runtime.readJson(configPath) : {};
    const developer =
      projectConfig && typeof projectConfig === 'object' && projectConfig.developer
        ? projectConfig.developer
        : {};
    return runtime.validateDeveloperConfig(developer);
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

  function normalizePackageName(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.toUpperCase() : '';
  }

  function findChipProfileByModel(model, packageName) {
    const normalizedModel = String(model || '').trim();
    const normalizedPackage = String(packageName || '').trim();
    if (!normalizedModel) {
      return null;
    }

    const candidates = runtime.unique([
      normalizedModel,
      compactSlug(normalizedModel),
      normalizedPackage ? compactSlug(`${normalizedModel}${normalizedPackage}`) : '',
      normalizedPackage ? compactSlug(`${normalizedModel}-${normalizedPackage}`) : ''
    ].filter(Boolean));

    for (const candidate of candidates) {
      try {
        return chipCatalog.loadChip(ROOT, candidate);
      } catch {
        // keep trying fallback candidates
      }
    }

    let listed = [];
    try {
      listed = chipCatalog.listChips(ROOT);
    } catch {
      listed = [];
    }

    const matched = listed.find(item => {
      const itemName = String(item.name || '').toLowerCase();
      return candidates.some(candidate => itemName === String(candidate).toLowerCase());
    });

    return matched ? chipCatalog.loadChip(ROOT, matched.name) : null;
  }

  function parsePackageToken(input) {
    const match = String(input || '').match(/\b(QFN\d+|LQFP\d+|TQFP\d+|QFP\d+|SOP\d+|SSOP\d+|DIP\d+|SOIC\d+|MSOP\d+)\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  function loadKnownHardwareHints() {
    const byKey = new Map();

    let listed = [];
    try {
      listed = chipCatalog.listChips(ROOT);
    } catch {
      listed = [];
    }

    listed.forEach(item => {
      const key = `${String(item.name).toLowerCase()}::${String(item.package || '').toLowerCase()}::chip`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          model: item.name,
          package: normalizePackageName(item.package || ''),
          vendor: item.vendor || '',
          source: 'chip-profile',
          hint: item.name
        });
      }
    });

    return Array.from(byKey.values());
  }

  function readFileSample(projectRoot, relativePath) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return '';
    }

    try {
      return fs.readFileSync(absolutePath, 'utf8').slice(0, 4096);
    } catch {
      return '';
    }
  }

  function isMeaningfulProjectInput(relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    if (GENERATED_DOCS.has(normalized)) {
      return false;
    }
    return (
      lower.endsWith('.pdf') ||
      lower.includes('datasheet') ||
      lower.includes('manual') ||
      lower.includes('reference') ||
      lower.includes('pin') ||
      lower.endsWith('.ioc') ||
      lower.endsWith('.uvprojx') ||
      lower.endsWith('.ewp') ||
      lower.endsWith('.c') ||
      lower.endsWith('.h') ||
      lower.endsWith('.cpp') ||
      lower.endsWith('.hpp') ||
      lower.endsWith('.schdoc') ||
      lower.endsWith('.sch') ||
      lower.endsWith('.dsn')
    );
  }

  function detectHardwareCandidates(projectRoot, detected) {
    const hints = loadKnownHardwareHints();
    const files = runtime.unique([
      ...((detected && detected.docs) || []),
      ...((detected && detected.projects) || []),
      ...((detected && detected.code) || []).slice(0, 6),
      ...((detected && detected.schematics) || [])
    ]).filter(Boolean);

    return hints
      .map(hint => {
        const modelNeedle = String(hint.model || '').toLowerCase();
        if (!modelNeedle) {
          return null;
        }

        const matchedFiles = files.filter(relativePath => {
          const haystack = `${relativePath}\n${readFileSample(projectRoot, relativePath)}`.toLowerCase();
          return haystack.includes(modelNeedle);
        });

        if (matchedFiles.length === 0) {
          return null;
        }

        const packageMatch = hint.package
          ? matchedFiles.some(relativePath => {
              const haystack = `${relativePath}\n${readFileSample(projectRoot, relativePath)}`.toLowerCase();
              return haystack.includes(String(hint.package).toLowerCase());
            })
          : matchedFiles.some(relativePath => {
              const haystack = `${relativePath}\n${readFileSample(projectRoot, relativePath)}`;
              return Boolean(parsePackageToken(haystack));
            });

        const inferredPackage = hint.package || parsePackageToken(
          matchedFiles
            .map(relativePath => `${relativePath}\n${readFileSample(projectRoot, relativePath)}`)
            .join('\n')
        );

        return {
          vendor: hint.vendor || '',
          model: hint.model,
          package: normalizePackageName(inferredPackage || ''),
          source: hint.source,
          matched_files: matchedFiles.slice(0, 4),
          confidence: packageMatch ? 'high' : 'medium'
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const confidenceWeight = value => (value === 'high' ? 2 : 1);
        return confidenceWeight(right.confidence) - confidenceWeight(left.confidence) ||
          right.matched_files.length - left.matched_files.length ||
          left.model.localeCompare(right.model);
      })
      .filter((item, index, list) =>
        index === list.findIndex(other =>
          other.model === item.model && other.package === item.package
        )
      );
  }

  function buildPinSummary(chipProfile, packageName, provisional) {
    if (!chipProfile) {
      return null;
    }

    const normalizedPackage = normalizeSlug(packageName || chipProfile.package || '');
    const packageEntry =
      (chipProfile.packages || []).find(item => normalizeSlug(item.name) === normalizedPackage) ||
      (chipProfile.packages || [])[0] ||
      null;

    if (!packageEntry || !Array.isArray(packageEntry.pins) || packageEntry.pins.length === 0) {
      return null;
    }

    const reservedPattern = /\b(vdd|vss|gnd|vcc|avdd|avss|reset|nreset|rst|program|programming|icsp)\b/i;
    const usablePins = [];
    const reservedPins = [];

    packageEntry.pins.forEach(pin => {
      const summary = {
        number: pin.number,
        signal: pin.signal,
        label: pin.label || '',
        default_function: pin.default_function || '',
        mux: Array.isArray(pin.mux) ? pin.mux : [],
        notes: Array.isArray(pin.notes) ? pin.notes : []
      };

      if (
        reservedPattern.test(pin.signal || '') ||
        reservedPattern.test(pin.default_function || '') ||
        summary.notes.some(note => reservedPattern.test(note))
      ) {
        reservedPins.push(summary);
      } else {
        usablePins.push(summary);
      }
    });

    return {
      source: 'chip_profile',
      provisional: Boolean(provisional),
      chip: chipProfile.name,
      package: packageEntry.name,
      pin_count: packageEntry.pin_count || packageEntry.pins.length,
      usable_pins: usablePins,
      reserved_pins: reservedPins
    };
  }

  function buildDeclareHardwareCommand(options) {
    const config = options || {};
    const parts = ['declare hardware'];

    if (config.mcu) {
      parts.push(`--mcu ${config.mcu}`);
    }
    if (config.package) {
      parts.push(`--package ${config.package}`);
    }
    if (config.board) {
      parts.push(`--board ${config.board}`);
    }
    if (config.target) {
      parts.push(`--target ${config.target}`);
    }

    return parts.join(' ');
  }

  function buildDocIngestCommand(filePath) {
    return `ingest doc --file ${filePath} --kind datasheet --to hardware`;
  }

  function buildInitGuidance(projectRoot, context) {
    const initContext = context || {};
    const hardware = loadInitHardwareIdentity(projectRoot);
    const configPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const projectConfig = fs.existsSync(configPath) ? runtime.readJson(configPath) : { adapter_sources: [] };
    const sources = Array.isArray(projectConfig.adapter_sources) ? projectConfig.adapter_sources : [];
    const detected = attachProjectCli.detectProjectInputs(projectRoot);
    const nextSteps = [];
    const hardwareReady = Boolean(hardware.model && hardware.package);
    const candidateDocs = ((detected && detected.docs) || [])
      .filter(item => String(item).toLowerCase().endsWith('.pdf'))
      .slice(0, 4);
    const candidateHardware = detectHardwareCandidates(projectRoot, detected);
    const meaningfulInputCount = runtime.unique([
      ...((detected && detected.code) || []),
      ...((detected && detected.projects) || []),
      ...((detected && detected.schematics) || []),
      ...((detected && detected.docs) || []).filter(isMeaningfulProjectInput)
    ]).length;
    const selectedHardware = hardwareReady
      ? hardware
      : candidateHardware.length > 0
        ? candidateHardware[0]
        : null;
    const selectedChipProfile = selectedHardware
      ? findChipProfileByModel(selectedHardware.model, selectedHardware.package)
      : null;
    const pinSummary = buildPinSummary(selectedChipProfile, selectedHardware && selectedHardware.package, !hardwareReady);
    const firstUsablePin =
      pinSummary && Array.isArray(pinSummary.usable_pins) && pinSummary.usable_pins.length > 0
        ? pinSummary.usable_pins[0]
        : null;

    if (!hardwareReady) {
      if (candidateHardware.length > 0) {
        const suggested = candidateHardware[0];
        nextSteps.push(
          `Declare the detected hardware identity with: ${buildDeclareHardwareCommand({
            mcu: suggested.model,
            package: suggested.package
          })}`
        );
      } else {
        nextSteps.push('Declare MCU/package first with: declare hardware --mcu <name> --package <name>');
      }
      if (candidateDocs.length > 0) {
        nextSteps.push(`After hardware confirmation, parse docs only if needed: ${buildDocIngestCommand(candidateDocs[0])}`);
      }
      if (sources.length === 0) {
        nextSteps.push('Run adapter bootstrap after hardware identity is declared');
      } else {
        nextSteps.push(`Run adapter bootstrap ${sources[0].name} after hardware identity is declared`);
      }
      nextSteps.push('Run next after hardware identity is declared');
    } else {
      nextSteps.push(
        firstUsablePin
          ? `Declare board pins/peripherals with agent-selected pins (first candidate ${firstUsablePin.signal}): declare hardware --signal SIGNAL_NAME --dir input|output --auto-pin`
          : 'Declare board pins/peripherals with agent-selected pins: declare hardware --signal SIGNAL_NAME --dir input|output --auto-pin'
      );

      if (sources.length === 0) {
        nextSteps.push('Run adapter bootstrap');
      } else {
        nextSteps.push(`Run adapter bootstrap ${sources[0].name}`);
      }

      if (candidateDocs.length > 0) {
        nextSteps.push(`If docs still need to be parsed, run ${buildDocIngestCommand(candidateDocs[0])}`);
      }

      nextSteps.push('Run next');
    }

    return {
      hardware_identity_present: Boolean(hardware.model),
      package_present: Boolean(hardware.package),
      adapter_sources_registered: sources.length,
      existing_project_detected: meaningfulInputCount > 0,
      hardware_confirmation_required: !hardwareReady,
      hardware_candidates: candidateHardware,
      selected_identity: selectedHardware
        ? {
            vendor: selectedHardware.vendor || '',
            model: selectedHardware.model || '',
            package: selectedHardware.package || '',
            source: hardwareReady ? 'hw.yaml' : selectedHardware.source
          }
        : null,
      chip_profile: selectedChipProfile
        ? {
            name: selectedChipProfile.name,
            vendor: selectedChipProfile.vendor,
            family: selectedChipProfile.family,
            package: selectedChipProfile.package
          }
        : null,
      pin_summary: pinSummary,
      doc_parse_suggestion: {
        suggested: candidateDocs.length > 0,
        requires_hardware_confirmation: candidateDocs.length > 0 && !hardwareReady,
        candidate_docs: candidateDocs,
        suggested_command: candidateDocs.length > 0
          ? buildDocIngestCommand(candidateDocs[0])
          : ''
      },
      next_steps: nextSteps
    };
  }

  function usage(options) {
    const advanced = Boolean(options && options.advanced);
    const coreLines = [
      'emb-agent usage:',
      'Global option: --brief outputs compact JSON (recommended for action commands such as next/plan/review/verify)',
      'Core workflow:',
      '  init [--profile <name>] [--pack <name>] [--mcu <name>] [--package <name>] [--board <name>] [--target <name>] [--goal <text>] [--runtime <codex|claude>|--codex|--claude] [--user <name>|-u <name>] [--force]',
      '  declare hardware [--confirm] [--mcu <name>] [--package <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '    [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
      '    [--peripheral <name> --usage <text>]',
      '  next [run]',
      '  ingest doc --file <path> [--provider mineru] [--kind datasheet] [--title <text>] [--pages <range>] [--language ch|en] [--ocr] [--force] [--to hardware|requirements]',
      '  task add [--confirm] <summary> [--type implement|debug|review|investigate] [--dev-type backend|frontend|fullstack|test|docs|embedded] [--scope <name>] [--priority P0|P1|P2|P3] [--assignee <name>]',
      '  task show <name>',
      '  task activate [--confirm] <name>',
      '  task resolve [--confirm] <name> [note]',
      '',
      'Useful follow-ups:',
      '  scan',
      '  plan',
      '  do',
      '  debug',
      '  verify',
      '  bootstrap [run [--confirm]]',
      '  pause [note]',
      '  resume',
      '',
      'Show the full command set:',
      '  help advanced',
      '  help --all',
      '  --help --all'
    ];

    const advancedLines = [
      'Advanced commands:',
      '  help',
      '  ingest hardware [--confirm] [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '    [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
      '    [--peripheral <name> --usage <text>]',
      '  ingest requirements [--confirm] [--goal <text>] [--feature <text>] [--constraint <text>] [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>]',
      '  ingest apply doc <doc-id> [--confirm] --to hardware|requirements [--only field1,field2] [--force]',
      '  ingest apply doc <doc-id> --from-last-diff',
      '  ingest apply doc <doc-id> --preset <name>',
      '  doc list',
      '  doc show <doc-id> [--preset <name>] [--apply-ready]',
      '  doc diff [--confirm] <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]',
      '  status',
      '  bootstrap [run [--confirm]]',
      '  health',
      '  update [check]',
      '  context compress [note]',
      '  context show',
      '  context clear',
      '  pause show',
      '  pause clear',
      '  task list',
      '  task context list <name> [implement|check|debug|all]',
      '  task context add [--confirm] <name> <implement|check|debug> <path> [reason]',
      '  settings show',
      '  settings set <key> <value>',
      '  settings reset',
      '  session-report [--confirm] [summary]',
      '  resolve',
      '  config show',
      '  project show [--effective] [--field <path>]',
      '  project set [--confirm] --field <path> --value <json-or-string>',
      '  executor list',
      '  executor show <name>',
      '  executor run <name> [--confirm] [-- <args...>]',
      '  scan save [--confirm] <target> <summary> [--fact <text>] [--question <text>] [--read <text>]',
      '  plan save [--confirm] <summary> [--target <target>] [--risk <text>] [--step <text>] [--verify <text>]',
      '  arch-review',
      '  review',
      '  review save [--confirm] <summary> [--scope <text>] [--finding <text>] [--check <text>]',
      '  verify save [--confirm] <summary> [--target <target>] [--check <text>] [--result <text>] [--evidence <text>] [--followup <text>]',
      '  verify confirm [--confirm] <name> [note]',
      '  verify reject [--confirm] <name> [note]',
      '  note',
      '  note add [--confirm] <target> <summary> [--kind <kind>] [--evidence <text>] [--unverified <text>]',
      '  dispatch show <action>',
      '  dispatch next',
      '  dispatch launch [next|<action>]',
      '  dispatch collect',
      '  dispatch run [next|<action>]',
      '  schedule show <action>',
      '  orchestrate [next]',
      '  orchestrate launch [next|<action>]',
      '  orchestrate collect',
      '  orchestrate run [next|<action>]',
      '  orchestrate show <action>',
      '  review context',
      '  review axes',
      '  note targets',
      '  adapter status [<name>]',
      '  adapter source list',
      '  adapter source show <name>',
      '  adapter source add <name> [--confirm] --type path|git --location <path-or-url> [--branch <name>] [--subdir <path>] [--disabled]',
      '  adapter source remove <name> [--confirm]',
      '  adapter bootstrap [<name>] [--confirm] [--type path|git --location <path-or-url>] [--branch <name>] [--subdir <path>] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter sync <name> [--confirm] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter sync --all [--confirm] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter derive [--confirm] [--from-project] [--from-doc <doc-id>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] [--target project|runtime] [--force]',
      '  adapter generate [--confirm] [--from-project] [--from-doc <doc-id>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] --output-root <path> [--force]',
      '  tool list',
      '  tool show <name>',
      '  tool run <name> [--confirm] [--family <name>] [--device <name>] [tool options]',
      '  tool family list',
      '  tool family show <name>',
      '  tool device list',
      '  tool device show <name>',
      '  chip list',
      '  chip show <name>',
      '  agents list',
      '  agents show <name>',
      '  commands list',
      '  commands show <name>',
      '  profile list',
      '  profile show <name>',
      '  profile set <name>',
      '  prefs show',
      '  prefs set <key> <value>',
      '  prefs reset',
      '  pack list',
      '  pack show <name>',
      '  pack add <name>',
      '  pack remove <name>',
      '  pack clear',
      '  focus get',
      '  focus set <text>',
      '  last-files list',
      '  last-files add <path>',
      '  last-files remove <path>',
      '  last-files clear',
      '  question list',
      '  question add <text>',
      '  question remove <text>',
      '  question clear',
      '  risk list',
      '  risk add <text>',
      '  risk remove <text>',
      '  risk clear',
      '  session show'
    ];

    process.stdout.write(
      [...coreLines, ...(advanced ? ['', ...advancedLines] : [])].join('\n') + '\n'
    );
  }

  function runInitCommand(tokens, aliasUsed) {
    const rest = tokens || [];
    if (rest.includes('--help') || rest.includes('-h')) {
      usage();
      return null;
    }

    const hasInitOptions = rest.some(token =>
      [
        '--profile',
        '--pack',
        '--mcu',
        '--package',
        '--board',
        '--target',
        '--goal',
        '--runtime',
        '--codex',
        '--claude',
        '--user',
        '-u',
        '--force'
      ].includes(token)
    );
    const existingProjectConfig = runtime.resolveProjectDataPath(resolveProjectRoot(), 'project.json');

    if (fs.existsSync(existingProjectConfig) && !hasInitOptions) {
      initProjectLayout();
      const developer = loadInitDeveloperIdentity(resolveProjectRoot());
      const session = updateSession(current => {
        current.last_command = 'init';
        current.developer = developer;
      });
      const guidance = buildInitGuidance(resolveProjectRoot());
      return {
        initialized: true,
        reused_existing: true,
        init_alias: aliasUsed || 'init',
        session_version: session.session_version,
        project_root: session.project_root,
        project_dir: path.relative(process.cwd(), getProjectExtDir()) || runtime.getProjectAssetRelativePath(),
        project_profile: session.project_profile,
        active_packs: session.active_packs,
        developer: session.developer,
        onboarding: guidance,
        next_steps: guidance.next_steps
      };
    }

    const attached = attachProjectCli.attachProject(rest);
    initProjectLayout();
    const developer = loadInitDeveloperIdentity(resolveProjectRoot());
    const session = updateSession(current => {
      current.last_command = 'init';
      current.developer = developer;
      current.last_files = runtime
        .unique([...(attached.detected.code || []), ...(attached.detected.projects || []), ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
    const guidance = buildInitGuidance(resolveProjectRoot());

    return {
      ...attached,
      initialized: true,
      init_alias: aliasUsed || 'init',
      onboarding: guidance,
      next_steps: guidance.next_steps,
      session: {
        project_profile: session.project_profile,
        active_packs: session.active_packs,
        developer: session.developer,
        last_files: session.last_files
      }
    };
  }

  async function runIngestCommand(subcmd, rest, options) {
    let ingested;
    let lastFiles;

    if (subcmd === 'apply') {
      ingested = await ingestDocCli.applyDoc(rest, {
        projectRoot: resolveProjectRoot(),
        ...(options || {})
      });
      lastFiles = ingested.last_files || [];
    } else if (subcmd === 'doc') {
      ingested = await ingestDocCli.ingestDoc(rest, {
        projectRoot: resolveProjectRoot(),
        ...(options || {})
      });
      lastFiles = ingested.last_files || [];
    } else {
      ingested = ingestTruthCli.ingestTruth([subcmd, ...rest]);
      if (Array.isArray(ingested.last_files)) {
        lastFiles = ingested.last_files;
      } else if (ingested.status === 'permission-pending' || ingested.status === 'permission-denied') {
        lastFiles = [];
      } else {
        const truthFile =
          ingested.domain === 'hardware'
            ? runtime.getProjectAssetRelativePath('hw.yaml')
            : runtime.getProjectAssetRelativePath('req.yaml');
        lastFiles = [truthFile];
      }
    }

    const session = updateSession(current => {
      current.last_command = `ingest ${ingested.domain}`;
      current.last_files = runtime
        .unique([...(lastFiles || []), ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });

    return {
      ...ingested,
      session: {
        last_command: session.last_command,
        last_files: session.last_files
      }
    };
  }

  return {
    usage,
    runInitCommand,
    runIngestCommand
  };
}

module.exports = {
  createCliEntryHelpers
};
