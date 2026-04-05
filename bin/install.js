#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMMANDS_SRC = path.join(REPO_ROOT, 'commands', 'emb');
const AGENTS_SRC = path.join(REPO_ROOT, 'agents');
const RUNTIME_SRC = path.join(REPO_ROOT, 'runtime');
const RUNTIME_HOOKS_SRC = path.join(RUNTIME_SRC, 'hooks');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const PACKAGE_VERSION = PACKAGE_JSON.version || '0.0.0';
const MANAGED_MARKER_START = '# EMB-AGENT managed start';
const MANAGED_MARKER_END = '# EMB-AGENT managed end';
const SKILL_PREFIX = 'emb-';
const AGENT_PREFIX = 'emb-';
const SANDBOX_BY_AGENT = {
  'emb-fw-doer': 'workspace-write',
  'emb-bug-hunter': 'workspace-write',
  'emb-hw-scout': 'read-only',
  'emb-sys-reviewer': 'read-only',
  'emb-release-checker': 'read-only'
};

function usage() {
  process.stdout.write(
    [
      'emb-agent usage:',
      '  emb-agent --global',
      '  emb-agent --local',
      '  emb-agent --global --config-dir <path>',
      '  emb-agent --local --uninstall',
      '  emb-agent --help',
      '',
      'Options:',
      '  --global                Install to CODEX_HOME or ~/.codex',
      '  --local                 Install to current project ./.codex',
      '  --config-dir <path>     Override target Codex directory',
      '  --uninstall             Remove emb-agent managed files from the target',
      '  --force                 Overwrite existing emb-agent runtime',
      '  --help                  Show this help'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    global: false,
    local: false,
    configDir: '',
    uninstall: false,
    force: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--global' || token === '-g') {
      result.global = true;
      continue;
    }
    if (token === '--local' || token === '-l') {
      result.local = true;
      continue;
    }
    if (token === '--uninstall' || token === '-u') {
      result.uninstall = true;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }
    if (token === '--config-dir') {
      result.configDir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (argv.includes('--config-dir') && !result.configDir) {
    throw new Error('Missing path after --config-dir');
  }
  if (result.global && result.local) {
    throw new Error('Use either --global or --local, not both');
  }
  if (!result.global && !result.local) {
    result.global = true;
  }

  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      try {
        fs.copyFileSync(sourcePath, targetPath);
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }
  }
}

function removeDirIfExists(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function getTargetDir(args) {
  if (args.configDir) {
    return path.resolve(args.configDir);
  }

  if (args.local) {
    return path.join(process.cwd(), '.codex');
  }

  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
}

function getInstalledRuntimePath(targetDir) {
  return path.resolve(targetDir, 'emb-agent').replace(/\\/g, '/');
}

function replaceInstallPaths(content, targetDir) {
  const runtimePath = `${getInstalledRuntimePath(targetDir)}/`;

  return content
    .replace(/~\/\.codex\/emb-agent\//g, runtimePath)
    .replace(/\$HOME\/\.codex\/emb-agent\//g, runtimePath)
    .replace(/\.\/\.codex\/emb-agent\//g, runtimePath)
    .replace(/\{\{EMB_VERSION\}\}/g, PACKAGE_VERSION);
}

function extractFrontmatterAndBody(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: '', body: content.trim() };
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: '', body: content.trim() };
  }

  const frontmatter = content.slice(4, endIndex).trim();
  const body = content.slice(endIndex + 4).trim();
  return { frontmatter, body };
}

function extractFrontmatterField(frontmatter, fieldName) {
  const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function toSingleLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function listManagedCommandFiles() {
  return fs
    .readdirSync(COMMANDS_SRC)
    .filter(name => name.endsWith('.md'))
    .map(name => `${SKILL_PREFIX}${name.replace(/\.md$/, '')}`)
    .sort();
}

function listManagedAgentFiles() {
  return fs
    .readdirSync(AGENTS_SRC)
    .filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'))
    .map(name => name.replace(/\.md$/, ''))
    .sort();
}

function installCommandSkills(targetDir) {
  const skillsDir = path.join(targetDir, 'skills');
  ensureDir(skillsDir);

  for (const skillName of listManagedCommandFiles()) {
    removeDirIfExists(path.join(skillsDir, skillName));
  }

  const commandFiles = fs.readdirSync(COMMANDS_SRC).filter(name => name.endsWith('.md'));
  for (const file of commandFiles) {
    const skillName = `${SKILL_PREFIX}${file.replace(/\.md$/, '')}`;
    const skillDir = path.join(skillsDir, skillName);
    ensureDir(skillDir);

    const raw = fs.readFileSync(path.join(COMMANDS_SRC, file), 'utf8');
    const content = replaceInstallPaths(raw, targetDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  }

  return commandFiles.length;
}

function generateAgentToml(agentName, content) {
  const { frontmatter, body } = extractFrontmatterAndBody(content);
  const resolvedName = extractFrontmatterField(frontmatter, 'name') || agentName;
  const description = toSingleLine(
    extractFrontmatterField(frontmatter, 'description') || `emb-agent ${resolvedName}`
  );
  const sandboxMode = SANDBOX_BY_AGENT[resolvedName] || 'read-only';

  return [
    `name = ${JSON.stringify(resolvedName)}`,
    `description = ${JSON.stringify(description)}`,
    `sandbox_mode = "${sandboxMode}"`,
    `developer_instructions = '''`,
    body.trim(),
    `'''`,
    ''
  ].join('\n');
}

function stripManagedConfigBlock(content) {
  const pattern = new RegExp(
    `${MANAGED_MARKER_START}[\\s\\S]*?${MANAGED_MARKER_END}\\n?`,
    'g'
  );
  return content.replace(pattern, '').trim();
}

function mergeManagedConfig(configPath, block) {
  let current = '';
  if (fs.existsSync(configPath)) {
    current = fs.readFileSync(configPath, 'utf8');
    current = stripManagedConfigBlock(current);
  }

  const next = current
    ? `${current}\n\n${block}\n`
    : `${block}\n`;

  fs.writeFileSync(configPath, next);
}

function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeCodexHooksAssignments(content) {
  return content.replace(
    /^(\s*(?:features\.)?(?:"codex_hooks"|codex_hooks)\s*=\s*)(?:false|true|".*"|'.*')(\s*(?:#.*)?)$/gm,
    '$1true$2'
  );
}

function hasEnabledCodexHooks(content) {
  return (
    /^\s*(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(content) ||
    /^\s*features\.(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(content)
  );
}

function ensureCodexHooksFeature(configPath) {
  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const eol = detectLineEnding(content);
  let next = normalizeCodexHooksAssignments(content);

  if (hasEnabledCodexHooks(next)) {
    if (next !== content) {
      fs.writeFileSync(configPath, next, 'utf8');
    }
    return;
  }

  if (/^\[features\](?:\s*#.*)?$/m.test(next)) {
    next = next.replace(/^\[features\](?:\s*#.*)?$/m, match => `${match}${eol}codex_hooks = true`);
  } else if (/^\s*features\.[^=\n]+\s*=.+$/m.test(next)) {
    next = `features.codex_hooks = true${eol}${next}`;
  } else {
    next = next.trim()
      ? `[features]${eol}codex_hooks = true${eol}${eol}${next}`
      : `[features]${eol}codex_hooks = true${eol}`;
  }

  fs.writeFileSync(configPath, next, 'utf8');
}

function buildConfigBlock(targetDir, agents) {
  const agentsDir = path.join(targetDir, 'agents').replace(/\\/g, '/');
  const hooksDir = path.join(targetDir, 'emb-agent', 'hooks').replace(/\\/g, '/');
  const lines = [MANAGED_MARKER_START, ''];

  for (const agent of agents) {
    lines.push(`[agents.${agent.name}]`);
    lines.push(`description = ${JSON.stringify(agent.description)}`);
    lines.push(`config_file = "${agentsDir}/${agent.name}.toml"`);
    lines.push('');
  }

  lines.push('[[hooks]]');
  lines.push('event = "SessionStart"');
  lines.push(`command = "node ${hooksDir}/emb-session-start.js"`);
  lines.push('');
  lines.push('[[hooks]]');
  lines.push('event = "PostToolUse"');
  lines.push(`command = "node ${hooksDir}/emb-context-monitor.js"`);
  lines.push('');
  lines.push(MANAGED_MARKER_END);
  return lines.join('\n');
}

function installAgents(targetDir) {
  const agentsDir = path.join(targetDir, 'agents');
  ensureDir(agentsDir);

  const agentFiles = fs.readdirSync(AGENTS_SRC).filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'));
  const installed = [];

  for (const file of agentFiles) {
    const sourcePath = path.join(AGENTS_SRC, file);
    const agentName = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const content = replaceInstallPaths(raw, targetDir);
    const toml = generateAgentToml(agentName, content);
    fs.writeFileSync(path.join(agentsDir, `${agentName}.toml`), toml);

    const { frontmatter } = extractFrontmatterAndBody(content);
    installed.push({
      name: extractFrontmatterField(frontmatter, 'name') || agentName,
      description: toSingleLine(
        extractFrontmatterField(frontmatter, 'description') || `emb-agent ${agentName}`
      )
    });
  }

  const configPath = path.join(targetDir, 'config.toml');
  mergeManagedConfig(configPath, buildConfigBlock(targetDir, installed));
  ensureCodexHooksFeature(configPath);
  return installed.length;
}

function installRuntime(targetDir, force) {
  const runtimeDir = path.join(targetDir, 'emb-agent');
  const runtimeCommandsDir = path.join(runtimeDir, 'commands');
  const runtimeAgentsDir = path.join(runtimeDir, 'agents');
  const runtimeToolsDir = path.join(runtimeDir, 'tools');
  const runtimeChipsDir = path.join(runtimeDir, 'chips');
  const runtimeExtensionsDir = path.join(runtimeDir, 'extensions');
  const runtimeHooksDir = path.join(runtimeDir, 'hooks');

  if (fs.existsSync(runtimeDir)) {
    removeDirIfExists(runtimeDir);
  }

  ensureDir(runtimeDir);
  copyDir(path.join(RUNTIME_SRC, 'bin'), path.join(runtimeDir, 'bin'));
  ensureDir(runtimeHooksDir);
  for (const file of fs.readdirSync(RUNTIME_HOOKS_SRC)) {
    const sourcePath = path.join(RUNTIME_HOOKS_SRC, file);
    if (fs.statSync(sourcePath).isDirectory()) {
      copyDir(sourcePath, path.join(runtimeHooksDir, file));
      continue;
    }
    const raw = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(path.join(runtimeHooksDir, file), replaceInstallPaths(raw, targetDir));
  }
  copyDir(path.join(RUNTIME_SRC, 'lib'), path.join(runtimeDir, 'lib'));
  copyDir(path.join(RUNTIME_SRC, 'scripts'), path.join(runtimeDir, 'scripts'));
  copyDir(path.join(RUNTIME_SRC, 'templates'), path.join(runtimeDir, 'templates'));
  copyDir(path.join(RUNTIME_SRC, 'profiles'), path.join(runtimeDir, 'profiles'));
  copyDir(path.join(RUNTIME_SRC, 'packs'), path.join(runtimeDir, 'packs'));
  copyDir(path.join(RUNTIME_SRC, 'tools'), runtimeToolsDir);
  copyDir(path.join(RUNTIME_SRC, 'chips'), runtimeChipsDir);
  copyDir(path.join(RUNTIME_SRC, 'state'), path.join(runtimeDir, 'state'));
  fs.copyFileSync(path.join(RUNTIME_SRC, 'config.json'), path.join(runtimeDir, 'config.json'));
  fs.writeFileSync(path.join(runtimeDir, 'VERSION'), `${PACKAGE_VERSION}\n`, 'utf8');
  ensureDir(path.join(runtimeDir, 'adapters'));
  ensureDir(path.join(runtimeExtensionsDir, 'tools'));
  ensureDir(path.join(runtimeExtensionsDir, 'tools', 'specs'));
  ensureDir(path.join(runtimeExtensionsDir, 'tools', 'families'));
  ensureDir(path.join(runtimeExtensionsDir, 'tools', 'devices'));
  ensureDir(path.join(runtimeExtensionsDir, 'chips'));
  ensureDir(path.join(runtimeExtensionsDir, 'chips', 'devices'));

  ensureDir(runtimeCommandsDir);
  for (const file of fs.readdirSync(COMMANDS_SRC).filter(name => name.endsWith('.md'))) {
    fs.copyFileSync(path.join(COMMANDS_SRC, file), path.join(runtimeCommandsDir, file));
  }

  ensureDir(runtimeAgentsDir);
  for (const file of fs.readdirSync(AGENTS_SRC).filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'))) {
    const targetName = file.replace(/^emb-/, '');
    fs.copyFileSync(path.join(AGENTS_SRC, file), path.join(runtimeAgentsDir, targetName));
  }

  return runtimeDir;
}

function buildEnvExampleContent() {
  return [
    '# emb-agent integration secrets',
    '# Optional: set MinerU API token here, then copy to .env if needed.',
    'MINERU_API_KEY=',
    ''
  ].join('\n');
}

function installEnvExample(filePath) {
  if (fs.existsSync(filePath)) {
    return false;
  }

  fs.writeFileSync(filePath, buildEnvExampleContent(), 'utf8');
  return true;
}

function buildEnvHintLines(envExamplePath) {
  const envPath = envExamplePath.replace(/\.example$/, '');
  if (fs.existsSync(envPath)) {
    return [];
  }

  return [
    `Tip: create ${envPath} from .env.example if you want MinerU API tokens managed locally.`,
    'Tip: set MINERU_API_KEY in that .env when switching MinerU to api/v4.'
  ];
}

function uninstall(targetDir) {
  const skillsDir = path.join(targetDir, 'skills');
  const agentsDir = path.join(targetDir, 'agents');

  for (const skillName of listManagedCommandFiles()) {
    removeDirIfExists(path.join(skillsDir, skillName));
  }

  for (const agentName of listManagedAgentFiles()) {
    const tomlPath = path.join(agentsDir, `${agentName}.toml`);
    if (fs.existsSync(tomlPath)) {
      fs.unlinkSync(tomlPath);
    }
  }

  removeDirIfExists(path.join(targetDir, 'emb-agent'));

  const configPath = path.join(targetDir, 'config.toml');
  if (fs.existsSync(configPath)) {
    const cleaned = stripManagedConfigBlock(fs.readFileSync(configPath, 'utf8'));
    if (cleaned) {
      fs.writeFileSync(configPath, `${cleaned}\n`);
    } else {
      fs.unlinkSync(configPath);
    }
  }
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const targetDir = getTargetDir(args);
  ensureDir(targetDir);

  if (args.uninstall) {
    uninstall(targetDir);
    process.stdout.write(`Uninstalled emb-agent managed files from: ${targetDir}\n`);
    return;
  }

  const runtimeDir = installRuntime(targetDir, args.force);
  const commandCount = installCommandSkills(targetDir);
  const agentCount = installAgents(targetDir);
  const envExamplePath = path.join(args.local ? process.cwd() : targetDir, '.env.example');
  const envExampleCreated = installEnvExample(envExamplePath);
  const envHintLines = buildEnvHintLines(envExamplePath);

  const lines = [
    `Installed emb-agent runtime to: ${runtimeDir}`,
    `Installed ${commandCount} Codex skills under: ${path.join(targetDir, 'skills')}`,
    `Installed ${agentCount} Codex agents under: ${path.join(targetDir, 'agents')}`,
    `Updated Codex config: ${path.join(targetDir, 'config.toml')}`,
    `${envExampleCreated ? 'Created' : 'Kept'} env example: ${envExamplePath}`,
    ...envHintLines,
    'Restart Codex to pick up new commands and agents.'
  ];

  process.stdout.write(lines.join('\n') + '\n');
}

module.exports = {
  main,
  installRuntime,
  installEnvExample,
  installCommandSkills,
  installAgents,
  uninstall
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`emb-agent install error: ${error.message}\n`);
    process.exit(1);
  }
}
