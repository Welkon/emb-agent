'use strict';

function createCliEntryHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtime,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    getProjectExtDir,
    initProjectLayout,
    ensureSession,
    updateSession,
    attachProjectCli,
    ingestTruthCli,
    ingestDocCli
  } = deps;

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

  function buildInitGuidance(projectRoot) {
    const hardware = loadInitHardwareIdentity(projectRoot);
    const configPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const projectConfig = fs.existsSync(configPath) ? runtime.readJson(configPath) : { adapter_sources: [] };
    const sources = Array.isArray(projectConfig.adapter_sources) ? projectConfig.adapter_sources : [];
    const nextSteps = [];
    const hardwareReady = Boolean(hardware.model && hardware.package);

    if (!hardwareReady) {
      nextSteps.push(`补全 ${runtime.getProjectAssetRelativePath('hw.yaml')} 里的 vendor / model / package`);
      nextSteps.push('补完后直接执行: adapter bootstrap -> next');
    }

    nextSteps.push('运行 health');

    if (sources.length === 0) {
      if (hardwareReady) {
        nextSteps.push('运行 adapter bootstrap');
        nextSteps.push('执行完 adapter bootstrap 后运行 next');
      } else {
        nextSteps.push('填完 hw.yaml 后运行 adapter bootstrap');
      }
    } else {
      if (hardwareReady) {
        nextSteps.push(`运行 adapter bootstrap ${sources[0].name}`);
        nextSteps.push('执行完 adapter bootstrap 后运行 next');
      } else {
        nextSteps.push(`填完 hw.yaml 后运行 adapter bootstrap ${sources[0].name}`);
      }
    }

    return {
      hardware_identity_present: Boolean(hardware.model),
      package_present: Boolean(hardware.package),
      adapter_sources_registered: sources.length,
      next_steps: nextSteps
    };
  }

  function usage() {
    const text = [
      'emb-agent usage:',
      '  help',
      '  init [--profile <name>] [--pack <name>] [--mcu <name>] [--board <name>] [--target <name>] [--goal <text>] [--force]',
      '  ingest hardware [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '  ingest requirements [--goal <text>] [--feature <text>] [--constraint <text>] [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>]',
      '  ingest doc --file <path> [--provider mineru] [--kind datasheet] [--title <text>] [--pages <range>] [--language ch|en] [--ocr] [--force] [--to hardware|requirements]',
      '  ingest apply doc <doc-id> --to hardware|requirements [--only field1,field2] [--force]',
      '  ingest apply doc <doc-id> --from-last-diff',
      '  ingest apply doc <doc-id> --preset <name>',
      '  doc list',
      '  doc show <doc-id> [--preset <name>] [--apply-ready]',
      '  doc diff <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]',
      '  status',
      '  next',
      '  health',
      '  update [check]',
      '  pause [note]',
      '  pause show',
      '  pause clear',
      '  resume',
      '  task list',
      '  task add <summary> [--type implement|debug|review|investigate]',
      '  task show <name>',
      '  task activate <name>',
      '  task resolve <name> [note]',
      '  task context list <name> [implement|check|debug|all]',
      '  task context add <name> <implement|check|debug> <path> [reason]',
      '  workspace list',
      '  workspace add <summary> [--type subsystem|board|flow|domain]',
      '  workspace show <name>',
      '  workspace activate <name>',
      '  workspace refresh <name>',
      '  workspace link <workspace> <task|spec|thread> <name>',
      '  workspace unlink <workspace> <task|spec|thread> <name>',
      '  spec list',
      '  spec add <summary> [--type feature|hardware|workflow|interface]',
      '  spec show <name>',
      '  thread list',
      '  thread add <summary>',
      '  thread show <name>',
      '  thread resume <name>',
      '  thread resolve <name> [note]',
      '  forensics [problem description]',
      '  settings show',
      '  settings set <key> <value>',
      '  settings reset',
      '  session-report [summary]',
      '  manager',
      '  resolve',
      '  config show',
      '  project show [--effective] [--field <path>]',
      '  project set --field <path> --value <json-or-string>',
      '  scan',
      '  scan save <target> <summary> [--fact <text>] [--question <text>] [--read <text>]',
      '  plan',
      '  plan save <summary> [--target <target>] [--risk <text>] [--step <text>] [--verify <text>]',
      '  arch-review',
      '  do',
      '  debug',
      '  review',
      '  review save <summary> [--scope <text>] [--finding <text>] [--check <text>]',
      '  verify',
      '  verify save <summary> [--target <target>] [--check <text>] [--result <text>] [--evidence <text>] [--followup <text>]',
      '  note',
      '  note add <target> <summary> [--kind <kind>] [--evidence <text>] [--unverified <text>]',
      '  dispatch show <action>',
      '  dispatch next',
      '  schedule show <action>',
      '  orchestrate [next]',
      '  orchestrate show <action>',
      '  template list',
      '  template show <name>',
      '  template fill <name> [--output <path>] [--field KEY=VALUE] [--force]',
      '  review context',
      '  review axes',
      '  note targets',
      '  adapter status [<name>]',
      '  adapter source list',
      '  adapter source show <name>',
      '  adapter source add <name> --type path|git --location <path-or-url> [--branch <name>] [--subdir <path>] [--disabled]',
      '  adapter source remove <name>',
      '  adapter bootstrap [<name>] [--type path|git --location <path-or-url>] [--branch <name>] [--subdir <path>] [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter sync <name> [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter sync --all [--to project|runtime] [--force] [--tool <name>] [--family <slug>] [--device <slug>] [--chip <slug>] [--match-project|--no-match-project]',
      '  adapter derive [--from-project] [--from-doc <doc-id>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] [--target project|runtime] [--force]',
      '  adapter generate [--from-project] [--from-doc <doc-id>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>] [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] --output-root <path> [--force]',
      '  tool list',
      '  tool show <name>',
      '  tool run <name> [--family <name>] [--device <name>] [tool options]',
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
      '  skills list',
      '  skills show <name>',
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
    ].join('\n');

    process.stdout.write(text + '\n');
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
        '--board',
        '--target',
        '--goal',
        '--force'
      ].includes(token)
    );
    const existingProjectConfig = runtime.resolveProjectDataPath(resolveProjectRoot(), 'project.json');

    if (fs.existsSync(existingProjectConfig) && !hasInitOptions) {
      initProjectLayout();
      const session = ensureSession();
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
        onboarding: guidance,
        next_steps: guidance.next_steps
      };
    }

    const attached = attachProjectCli.attachProject(rest);
    initProjectLayout();
    const session = updateSession(current => {
      current.last_command = 'init';
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
      const truthFile =
        ingested.domain === 'hardware'
          ? runtime.getProjectAssetRelativePath('hw.yaml')
          : runtime.getProjectAssetRelativePath('req.yaml');
      lastFiles = [truthFile];
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
