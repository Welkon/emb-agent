'use strict';

const hardwareTruthHelpers = require('./hardware-truth.cjs');
const projectInputState = require('./project-input-state.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');

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
    ingestDocCli,
    ingestSchematicCli
  } = deps;

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function loadInitHardwareTruth(projectRoot) {
    const truth = hardwareTruthHelpers.loadHardwareTruth(runtime, projectRoot);
    return {
      vendor: truth.vendor,
      model: truth.model,
      package: truth.package,
      signals: Array.isArray(truth.signals) ? truth.signals : [],
      peripherals: Array.isArray(truth.peripherals) ? truth.peripherals : []
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

  function buildAdapterBootstrapCommand(sources) {
    if (Array.isArray(sources) && sources.length > 0 && sources[0] && sources[0].name) {
      return `support bootstrap ${sources[0].name}`;
    }
    return 'support bootstrap';
  }

  function hasConfiguredDefaultAdapterSource() {
    const source = (RUNTIME_CONFIG && RUNTIME_CONFIG.default_chip_support_source) || {};
    return Boolean(source.location);
  }

  function loadBootstrapTaskSummary(projectRoot) {
    const taskPath = path.join(
      runtime.getProjectExtDir(projectRoot),
      'tasks',
      '00-bootstrap-project',
      'task.json'
    );

    if (!fs.existsSync(taskPath)) {
      return null;
    }

    const task = runtime.readJson(taskPath);
    return {
      name: String(task.name || '00-bootstrap-project'),
      title: String(task.title || 'Bootstrap project notes'),
      status: String(task.status || 'planning'),
      path: path.relative(projectRoot, taskPath).replace(/\\/g, '/'),
      related_files: Array.isArray(task.relatedFiles) ? task.relatedFiles : []
    };
  }

  function buildInitGuidance(projectRoot, context) {
    const initContext = context || {};
    const hardware = loadInitHardwareTruth(projectRoot);
    const configPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const projectConfig = fs.existsSync(configPath) ? runtime.readJson(configPath) : { chip_support_sources: [] };
    const sources = Array.isArray(projectConfig.chip_support_sources) ? projectConfig.chip_support_sources : [];
    const detected = attachProjectCli.detectProjectInputs(projectRoot);
    const nextSteps = [];
    const hardwareReady = Boolean(hardware.model && hardware.package);
    const candidateDocs = ((detected && detected.docs) || [])
      .filter(item => String(item).toLowerCase().endsWith('.pdf'))
      .slice(0, 4);
    const candidateHardware = detectHardwareCandidates(projectRoot, detected);
    const meaningfulInputCount = runtime.unique(projectInputState.listMeaningfulProjectInputs(detected)).length;
    const blankProject = !hardwareReady && meaningfulInputCount === 0 && candidateHardware.length === 0;
    const selectedHardware = hardwareReady
      ? hardware
      : candidateHardware.length > 0
        ? candidateHardware[0]
        : null;
    const selectedChipProfile = selectedHardware
      ? findChipProfileByModel(selectedHardware.model, selectedHardware.package)
      : null;
    const bootstrapTask = loadBootstrapTaskSummary(projectRoot);
    const pinSummary = buildPinSummary(selectedChipProfile, selectedHardware && selectedHardware.package, !hardwareReady);
    const declareHardwareCommand = candidateHardware.length > 0
      ? buildDeclareHardwareCommand({
          mcu: candidateHardware[0].model,
          package: candidateHardware[0].package
        })
      : 'declare hardware --mcu <name> --package <name>';
    const adapterBootstrapCommand = buildAdapterBootstrapCommand(sources);
    const adapterSourceReady = sources.length > 0 || hasConfiguredDefaultAdapterSource();
    const bootstrapFastPathCommand = adapterSourceReady ? 'bootstrap run --confirm' : adapterBootstrapCommand;
    const projectDeriveCommand = 'support derive --from-project';
    const agentActions = [];
    const declaredIntentPresent =
      (Array.isArray(hardware.signals) && hardware.signals.some(item => item && (item.name || item.pin || item.note))) ||
      (Array.isArray(hardware.peripherals) && hardware.peripherals.some(item => item && (item.name || item.usage)));
    const firstUsablePin =
      pinSummary && Array.isArray(pinSummary.usable_pins) && pinSummary.usable_pins.length > 0
        ? pinSummary.usable_pins[0]
        : null;

    if (!hardwareReady) {
      if (blankProject) {
        agentActions.push({
          kind: 'define-project-constraints',
          status: 'required',
          target_file: runtime.getProjectAssetRelativePath('req.yaml'),
          summary: `Ask the agent to define the project in ${runtime.getProjectAssetRelativePath('req.yaml')} first: record the project type, intended inputs/outputs, interfaces, and constraints. Leave ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until a chip candidate or hardware reference is real.`,
          cli_fallback: 'next'
        });

        nextSteps.push(`Let the agent fill ${runtime.getProjectAssetRelativePath('req.yaml')} with the project type, intended inputs/outputs, interfaces, and constraints before selecting a chip.`);
        nextSteps.push(`Keep ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until you have a real chip candidate or hardware reference.`);
        nextSteps.push('If you already have materials, add datasheets/manuals under docs/ and schematics/BOM/board photos under hardware/ or docs/.');
      } else {
        agentActions.push({
          kind: 'confirm-hardware-identity',
          status: 'required',
          target_file: runtime.getProjectAssetRelativePath('hw.yaml'),
          summary:
            candidateHardware.length > 0
              ? `Ask the agent to confirm which chip and package were detected, then write that into ${runtime.getProjectAssetRelativePath('hw.yaml')}.`
              : `Ask the agent to inspect the project and fill which chip and package this board uses in ${runtime.getProjectAssetRelativePath('hw.yaml')}. If the only clue is a top marking, datasheet, BOM, or board photo, that is still enough to start.`,
          cli_fallback: declareHardwareCommand
        });

        nextSteps.push(`Let the agent confirm which chip and package this board uses in ${runtime.getProjectAssetRelativePath('hw.yaml')} before continuing.`);
      }

      if (!blankProject && candidateDocs.length > 0) {
        agentActions.push({
          kind: 'inspect-hardware-doc',
          status: 'optional',
          target_file: candidateDocs[0],
          summary: `If hardware is still unclear, let the agent inspect ${candidateDocs[0]} before writing truth.`,
          cli_fallback: buildDocIngestCommand(candidateDocs[0])
        });
        nextSteps.push(`If hardware is still unclear, let the agent inspect ${candidateDocs[0]}.`);
      }

      agentActions.push({
        kind: 'bootstrap-chip-support',
        status: adapterSourceReady ? 'blocked' : 'unconfigured',
        blocked_by: blankProject
          ? adapterSourceReady
            ? ['project_constraints', 'hardware_identity']
            : ['project_constraints', 'hardware_identity', 'chip_support_source']
          : adapterSourceReady
            ? ['hardware_identity']
            : ['hardware_identity', 'chip_support_source'],
        summary: adapterSourceReady
          ? blankProject
            ? 'Chip support install should wait until project constraints are recorded and a chip candidate is chosen.'
            : 'Chip support install can continue automatically after hardware identity is confirmed.'
          : blankProject
            ? 'Configure a chip support source later, after project constraints are recorded and a chip candidate is chosen.'
            : 'Configure a chip support source before chip support can be installed.',
        cli_fallback: adapterBootstrapCommand
      });

      nextSteps.push(blankProject
        ? 'Run next after the requirements are recorded so the agent can help narrow chip candidates.'
        : adapterSourceReady
          ? 'Run next after the chip is identified so the agent can continue bootstrap.'
          : 'Configure a chip support source, then run next after the chip is identified.');
    } else {
      agentActions.push({
        kind: 'bootstrap-chip-support',
        status: 'ready',
        blocked_by: [],
        summary: adapterSourceReady
          ? declaredIntentPresent
            ? 'Chip support install is ready. Prefer bootstrap run so emb-agent can continue the known-chip path directly.'
            : 'Chip support install is ready. Prefer bootstrap run so emb-agent can continue the known-chip path directly.'
          : 'Project-local draft chip support can be derived now. Configure a source later only when you want reusable install.',
        cli_fallback: adapterSourceReady ? bootstrapFastPathCommand : projectDeriveCommand
      });

      agentActions.push({
        kind: 'declare-board-pins',
        status: declaredIntentPresent ? 'optional' : 'recommended',
        target_file: runtime.getProjectAssetRelativePath('hw.yaml'),
        summary: declaredIntentPresent
          ? `Board signals/peripherals already exist in ${runtime.getProjectAssetRelativePath('hw.yaml')}. Add more pin mappings only when the next tool result needs them.`
          : firstUsablePin
            ? `Ask the agent to map board signals into ${runtime.getProjectAssetRelativePath('hw.yaml')} with auto-selected pins (first candidate ${firstUsablePin.signal}).`
            : `Ask the agent to map board signals into ${runtime.getProjectAssetRelativePath('hw.yaml')} with auto-selected pins.`,
        cli_fallback: 'declare hardware --signal SIGNAL_NAME --dir input|output --auto-pin'
      });

      nextSteps.push(
        adapterSourceReady
          ? 'Prefer `bootstrap run --confirm` for the shortest guided path. It will execute the current bootstrap step directly, then hand you back to next.'
          : 'Prefer `support derive --from-project` first so the current project gets draft chip support without requiring any shared source.'
      );
      nextSteps.push(
        declaredIntentPresent
          ? adapterSourceReady
            ? `The current ${runtime.getProjectAssetRelativePath('hw.yaml')} already contains signals/peripherals, so you can move straight into chip support bootstrap first.`
            : `The current ${runtime.getProjectAssetRelativePath('hw.yaml')} already contains signals/peripherals, so you can derive project-local chip support first.`
          : firstUsablePin
            ? `Then let the agent map board pins/peripherals into ${runtime.getProjectAssetRelativePath('hw.yaml')} (first candidate ${firstUsablePin.signal}).`
            : `Then let the agent map board pins/peripherals into ${runtime.getProjectAssetRelativePath('hw.yaml')}.`
      );

      if (candidateDocs.length > 0) {
        agentActions.push({
          kind: 'inspect-hardware-doc',
          status: 'optional',
          target_file: candidateDocs[0],
          summary: `If more hardware detail is needed, let the agent inspect ${candidateDocs[0]}.`,
          cli_fallback: buildDocIngestCommand(candidateDocs[0])
        });
        nextSteps.push(`If more hardware detail is needed, let the agent inspect ${candidateDocs[0]}.`);
      }

      nextSteps.push(adapterSourceReady
        ? 'After bootstrap completes, run `next` or `next run` to enter the recommended execution stage.'
        : 'After chip support is available, run `next` or `next run` to continue the guided path.');
    }

    if (meaningfulInputCount === 0) {
      nextSteps.push('Optional evidence boost: add any datasheet/manual under docs/, any schematic/BOM/board photo under hardware/ or docs/, and any firmware tree under src/ or the project root.');
    }

    if (bootstrapTask) {
      nextSteps.push(`Optional: inspect deferred note targets with task show ${bootstrapTask.name}.`);
    }

    return {
      hardware_identity_present: Boolean(hardware.model),
      package_present: Boolean(hardware.package),
      declared_intent_present: Boolean(declaredIntentPresent),
      chip_support_sources_registered: sources.length,
      existing_project_detected: meaningfulInputCount > 0,
      hardware_confirmation_required: !hardwareReady && !blankProject,
      project_definition_required: blankProject,
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
      bootstrap_task: bootstrapTask,
      agent_actions: agentActions,
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

  function buildUsagePayload(options) {
    const advanced = Boolean(options && options.advanced);
    const compactSections = [
      {
        title: 'Start here',
        entries: [
          'start',
          'bootstrap [run [--confirm]]',
          'next [run]',
          'task add [--confirm] <summary> [--type implement|debug|review|investigate] [--dev-type backend|frontend|fullstack|test|docs|embedded] [--scope <name>] [--package <name>] [--priority P0|P1|P2|P3] [--assignee <name>]',
          'task activate [--confirm] <name>',
          'task worktree <list|status|show|create|cleanup> [name]'
        ]
      },
      {
        title: 'Import truth',
        entries: [
          'declare hardware [--confirm] [--mcu <name>] [--package <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
          '  [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
          '  [--peripheral <name> --usage <text>]',
          'ingest doc --file <path> [--provider mineru] [--kind datasheet] [--title <text>] [--pages <range>] [--language ch|en] [--ocr] [--force] [--to hardware|requirements]',
          'ingest schematic --file <path> [--format auto|altium-json|netlist|bom-csv|text] [--title <text>] [--force]'
        ]
      },
      {
        title: 'Execute current work',
        entries: [
          'scan',
          'plan',
          'do',
          'debug'
        ]
      },
      {
        title: 'Close and hand off',
        entries: [
          'review',
          'verify',
          'bootstrap [run [--confirm]]',
          'task show <name>',
          'task resolve [--confirm] <name> [note]',
          'pause [note]',
          'resume',
          'external <start|status|next|health|dispatch-next>'
        ]
      }
    ];

    const advancedSections = [
      {
        title: 'Truth and document intake',
        entries: [
          'ingest hardware [--confirm] [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
          '  [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
          '  [--peripheral <name> --usage <text>]',
          'ingest requirements [--confirm] [--goal <text>] [--feature <text>] [--constraint <text>] [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>]',
          'ingest apply doc <doc-id> [--confirm] --to hardware|requirements [--only field1,field2] [--force]',
          'ingest apply doc <doc-id> --from-last-diff',
          'ingest apply doc <doc-id> --preset <name>',
          'ingest schematic --file <path> [--format auto|altium-json|netlist|bom-csv|text] [--title <text>] [--force]',
          'doc list',
          'doc lookup [--chip <name>] [--vendor <name>] [--package <name>] [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--limit <n>]',
          'doc fetch --url <http(s)-url> [--output <path>] [--confirm]',
          'doc show <doc-id> [--preset <name>] [--apply-ready]',
          'doc diff [--confirm] <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]',
          'component lookup [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--provider local|szlcsc] [--limit <n>]'
        ]
      },
      {
        title: 'Bootstrap and project state',
        entries: [
          'status',
          'bootstrap [run [--confirm]]',
          'health',
          'external <start|status|next|health|dispatch-next>',
          'update [check]',
          'project show [--effective] [--field <path>]',
          'project set [--confirm] --field <path> --value <json-or-string>',
          'settings show',
          'settings set <key> <value>',
          'settings reset',
          'config show',
          'session show',
          'session history',
          'session show [current|latest|<report-id>]',
          'session record [--confirm] [summary]',
          'session-report [--confirm] [summary]'
        ]
      },
      {
        title: 'Execution support and closure',
        entries: [
          'context compress [note]',
          'context show',
          'context clear',
          'executor list',
          'executor show <name>',
          'executor run <name> [--confirm] [-- <args...>]',
          'scan save [--confirm] <target> <summary> [--fact <text>] [--question <text>] [--read <text>]',
          'plan save [--confirm] <summary> [--target <target>] [--risk <text>] [--step <text>] [--verify <text>]',
          'arch-review',
          'review',
          'review context',
          'review axes',
          'review save [--confirm] <summary> [--scope <text>] [--finding <text>] [--check <text>]',
          'verify save [--confirm] <summary> [--target <target>] [--check <text>] [--result <text>] [--evidence <text>] [--followup <text>]',
          'verify confirm [--confirm] <name> [note]',
          'verify reject [--confirm] <name> [note]',
          'note',
          'note targets',
          'note add [--confirm] <target> <summary> [--kind <kind>] [--evidence <text>] [--unverified <text>]',
          'resolve'
        ]
      },
      {
        title: 'Task, skills, and memory',
        entries: [
          'task list',
          'task show <name>',
          'task set-branch [--confirm] <name> <branch>',
          'task set-base-branch [--confirm] <name> <branch>',
          'task subtask add [--confirm] <parent> <child>',
          'task subtask remove [--confirm] <parent> <child>',
          'task create-pr [--confirm] <name> [--dry-run]',
          'task context list <name> [implement|check|debug|all]',
          'task context add [--confirm] <name> <implement|check|debug> <path> [reason]',
          'pause show',
          'pause clear',
          'skills list',
          'skills show <name>',
          'skills run <name> [--isolated] [input]',
          'memory stack',
          'memory list',
          'memory show <entry>',
          'memory remember [--confirm] --type <user|feedback|project|reference> <summary> [--detail <text>]',
          'memory extract [--confirm] [note]',
          'memory audit',
          'memory promote [--confirm] <entry> --to <organization|user|project|local>'
        ]
      },
      {
        title: 'Workflow and scaffold authoring',
        entries: [
          'spec list',
          'spec show <name>',
          'workflow init [--force]',
          'workflow list',
          'workflow import registry <source> [--branch <name>] [--subdir <path>] [--force]',
          'workflow show registry',
          'workflow show <pack|spec|template> <name>',
          'workflow new pack <name> [--with-spec [<name>]] [--with-template [<name>]] [--output <path>] [--force]',
          'workflow new spec <name> [--pack <name>|--always] [--force]',
          'workflow new template <name> [--output <path>] [--force]',
          'scaffold list',
          'scaffold show <name>',
          'scaffold install <name> [output] [--force] [KEY=VALUE ...]',
          'profile list',
          'profile show <name>',
          'profile set <name>',
          'pack list',
          'pack show <name>',
          'pack add <name>',
          'pack remove <name>',
          'pack clear'
        ]
      },
      {
        title: 'Delegation and chip support runtime',
        entries: [
          'dispatch show <action>',
          'dispatch next',
          'dispatch launch [next|<action>]',
          'dispatch collect',
          'dispatch run [next|<action>]',
          'schedule show <action>',
          'orchestrate [next]',
          'orchestrate launch [next|<action>]',
          'orchestrate collect',
          'orchestrate run [next|<action>]',
          'orchestrate show <action>',
          'prefs show',
          'prefs set <key> <value>',
          'prefs reset',
          'support status [<name>]',
          'support source list',
          'support source show <name>',
          'support source add <name> [--confirm] --type path|git --location <path-or-url> [--branch <name>] [--subdir <path>] [--disabled]',
          'support source remove <name> [--confirm]',
          'support bootstrap [<name>] [--confirm] [--type path|git --location <path-or-url>] [--branch <name>] [--subdir <path>] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
          'support sync <name> [--confirm] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
          'support sync --all [--confirm] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
          'support analysis init --chip <name> [--model <name>] [--vendor <name>] [--series <name>] [--family <slug>] [--device <slug>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] [--output <path>] [--force]',
          'support derive [--confirm] [--from-project] [--from-doc <doc-id>] [--from-analysis <path>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] [--target project|runtime] [--force]',
          'support export [<source>] [--confirm] [--chip <slug>] [--device <slug>] [--family <slug>] [--output-root <path>] [--force]',
          'support publish [<source>] [--confirm] [--chip <slug>] [--device <slug>] [--family <slug>] [--output-root <path>] [--force]',
          'support generate [--confirm] [--from-project] [--from-doc <doc-id>] [--from-analysis <path>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] --output-root <path> [--force]',
          'tool list',
          'tool show <name>',
          'tool run <name> [--confirm] [--family <name>] [--device <name>] [tool options]',
          'tool family list',
          'tool family show <name>',
          'tool device list',
          'tool device show <name>',
          'chip list',
          'chip show <name>'
        ]
      },
      {
        title: 'Inspection and discovery',
        entries: [
          'agents list',
          'agents show <name>',
          'commands list',
          'commands list --all',
          'commands show <name>',
          'focus get',
          'focus set <text>',
          'last-files list',
          'last-files add <path>',
          'last-files remove <path>',
          'last-files clear',
          'question list',
          'question add <text>',
          'question remove <text>',
          'question clear',
          'risk list',
          'risk add <text>',
          'risk remove <text>',
          'risk clear',
          'help'
        ]
      }
    ];

    return {
      entry: 'help',
      mode: advanced ? 'advanced' : 'compact',
      global_options: [
        {
          flag: '--json',
          description: 'outputs structured JSON for help/usage and keeps command responses explicit for automation'
        },
        {
          flag: '--brief',
          description: 'outputs compact JSON with summarized runtime_events (recommended for action commands such as start/next/status/plan/review/verify)'
        }
      ],
      sections: advanced ? advancedSections : compactSections,
      followups: advanced
        ? []
        : ['help advanced', 'help --all', '--help --all']
    };
  }

  function renderUsageText(payload) {
    const helpPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : buildUsagePayload();
    const lines = [
      'emb-agent usage:'
    ];

    if (helpPayload.mode === 'advanced') {
      lines.push('Advanced commands:');
    }

    lines.push(
      ...toArray(helpPayload.global_options).map(item => `Global option: ${item.flag} ${item.description}`)
    );

    toArray(helpPayload.sections).forEach(section => {
      lines.push(section.title + ':');
      toArray(section.entries).forEach(entry => {
        lines.push(entry.startsWith('  ') ? entry : `  ${entry}`);
      });
      lines.push('');
    });

    if (toArray(helpPayload.followups).length > 0) {
      lines.push('Show the full command set:');
      toArray(helpPayload.followups).forEach(entry => {
        lines.push(`  ${entry}`);
      });
      lines.push('');
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n') + '\n';
  }

  function usage(options) {
    process.stdout.write(renderUsageText(buildUsagePayload(options)));
  }

  function buildStartWorkflow(initGuidance, options) {
    const settings = options || {};
    const activeTask = settings.activeTask || null;
    const hasHandoff = settings.hasHandoff === true;
    const initialized = settings.initialized !== false;
    const knownChipPath = Boolean(initGuidance && initGuidance.hardware_identity_present);
    const sourceReady = Boolean(initGuidance && initGuidance.chip_support_sources_registered > 0);
    const workflow = [
      {
        id: 'project-bootstrap',
        title: 'Project bootstrap',
        commands: knownChipPath
          ? sourceReady
            ? [
                'declare hardware / ingest doc / ingest schematic as needed',
                'bootstrap run --confirm (or support bootstrap for direct control)',
                'next [run]'
              ]
            : [
                'declare hardware / ingest doc / ingest schematic as needed',
                'support derive --from-project (or support analysis init -> support derive --from-analysis)',
                'next [run]'
              ]
          : ['declare hardware / ingest doc / ingest schematic as needed', 'next'],
        outcome: 'Project truth is explicit enough for task work.'
      },
      {
        id: 'task-bootstrap',
        title: 'Task bootstrap',
        commands: activeTask
          ? [`task activate ${activeTask.name} (already active)`]
          : ['task add <summary>', 'task activate <name>'],
        outcome: 'The current change has an isolated task context and PRD.'
      },
      {
        id: 'execution-loop',
        title: 'Execution loop',
        commands: hasHandoff
          ? ['resume', 'next', 'do/debug', 'verify', 'task aar scan', 'task resolve']
          : ['next', 'do/debug', 'verify', 'task aar scan', 'task resolve'],
        outcome: 'The active task is implemented, verified, and closed with AAR.'
      }
    ];

    if (initGuidance && initGuidance.project_definition_required) {
      workflow[0].note = `Keep ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until req/constraints are explicit.`;
    } else if (initGuidance && initGuidance.hardware_confirmation_required) {
      workflow[0].note = `Confirm the real MCU/package in ${runtime.getProjectAssetRelativePath('hw.yaml')} before execution.`;
    } else if (knownChipPath) {
      workflow[0].note = sourceReady
        ? 'When reusable chip support is already configured, guided bootstrap can install it before deeper task work.'
        : 'When the chip is already known, prefer project-local derive first. Configure or bootstrap a shared source later only if you want reusable install.';
    }

    return workflow;
  }

  function buildBootstrapSummary(initGuidance) {
    const guidance = initGuidance && typeof initGuidance === 'object' ? initGuidance : {};
    const actions = Array.isArray(guidance.agent_actions) ? guidance.agent_actions : [];
    const primaryAction =
      actions.find(item => item && ['required', 'recommended', 'ready'].includes(item.status)) ||
      actions.find(item => item && ['unconfigured', 'blocked', 'optional'].includes(item.status)) ||
      null;

    if (guidance.project_definition_required) {
      return {
        status: 'needs-project-definition',
        stage: 'define-project-constraints',
        summary: `Project definition is still required. Fill ${runtime.getProjectAssetRelativePath('req.yaml')} with the project type, intended inputs/outputs, interfaces, and constraints. Keep ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until a real chip or board reference exists.`,
        command: primaryAction && primaryAction.cli_fallback ? primaryAction.cli_fallback : 'next',
        bootstrap_task: guidance.bootstrap_task || null
      };
    }

    if (guidance.hardware_confirmation_required) {
      return {
        status: 'needs-hardware-identity',
        stage: 'confirm-hardware-identity',
        summary: `Hardware identity is still missing. Record the real MCU and package in ${runtime.getProjectAssetRelativePath('hw.yaml')} before execution.`,
        command: primaryAction && primaryAction.cli_fallback
          ? primaryAction.cli_fallback
          : 'declare hardware --mcu <name> --package <name>',
        bootstrap_task: guidance.bootstrap_task || null
      };
    }

    if (primaryAction) {
      return {
        status: primaryAction.status === 'unconfigured' ? 'needs-chip-support-source' : 'ready-for-next',
        stage: primaryAction.kind,
        summary: String(primaryAction.summary || '').trim() || 'Bootstrap is ready. Run next.',
        command: primaryAction.cli_fallback || 'next',
        bootstrap_task: guidance.bootstrap_task || null
      };
    }

    return {
      status: 'ready-for-next',
      stage: 'continue-with-next',
      summary: 'Bootstrap is ready. Run next.',
      command: 'next',
      bootstrap_task: guidance.bootstrap_task || null
    };
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
        '--external',
        '--codex',
        '--claude',
        '--cursor',
        '--registry',
        '-r',
        '--registry-branch',
        '--registry-subdir',
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
      const bootstrap = buildBootstrapSummary(guidance);
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
        bootstrap_task: guidance.bootstrap_task || null,
        bootstrap
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
    const bootstrap = buildBootstrapSummary(guidance);

    return {
      ...attached,
      initialized: true,
      init_alias: aliasUsed || 'init',
      bootstrap_task: guidance.bootstrap_task || null,
      bootstrap,
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
    } else if (subcmd === 'schematic') {
      ingested = ingestSchematicCli.ingestSchematic(rest, {
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
    buildInitGuidance,
    buildBootstrapSummary,
    buildStartWorkflow,
    buildUsagePayload,
    usage,
    runInitCommand,
    runIngestCommand
  };
}

module.exports = {
  createCliEntryHelpers
};
