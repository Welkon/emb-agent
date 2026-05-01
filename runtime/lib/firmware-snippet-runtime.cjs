'use strict';

function createFirmwareSnippetRuntimeHelpers(deps) {
  const {
    childProcess,
    fs,
    path,
    runtime,
    permissionGateHelpers,
    getProjectConfig,
    getProjectExtDir,
    updateSession
  } = deps;

  const SOURCE_EXTENSIONS = new Set([
    '.c',
    '.cc',
    '.cpp',
    '.cxx',
    '.h',
    '.hh',
    '.hpp',
    '.hxx',
    '.s',
    '.S',
    '.asm',
    '.ino',
    '.rs'
  ]);

  function projectRoot() {
    return path.resolve(process.cwd());
  }

  function projectRelative(absolutePath) {
    return path.relative(projectRoot(), absolutePath).split(path.sep).join('/');
  }

  function slugify(value) {
    return String(value || 'firmware-snippet')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'firmware-snippet';
  }

  function parseFlagValue(args, flagNames) {
    const names = Array.isArray(flagNames) ? flagNames : [flagNames];
    for (let i = 0; i < args.length; i += 1) {
      if (names.includes(args[i]) && args[i + 1]) {
        return args[i + 1];
      }
    }
    return '';
  }

  function stripFlagValues(args, flagNames) {
    const names = Array.isArray(flagNames) ? flagNames : [flagNames];
    const next = [];
    for (let i = 0; i < args.length; i += 1) {
      if (names.includes(args[i])) {
        i += 1;
        continue;
      }
      next.push(args[i]);
    }
    return next;
  }

  function parseSnippetDraftArgs(rest) {
    let args = Array.isArray(rest) ? rest.slice() : [];
    const explicitConfirmation = args.includes('--confirm');
    const force = args.includes('--force');
    const fromToolOutput = parseFlagValue(args, ['--from-tool-output', '--from']);
    const title = parseFlagValue(args, '--title');
    const output = parseFlagValue(args, '--output');
    ['--from-tool-output', '--from', '--title', '--output'].forEach(flag => {
      args = stripFlagValues(args, flag);
    });
    args = args.filter(token => token !== '--confirm' && token !== '--force');
    return {
      from_tool_output: fromToolOutput,
      title: title || args.join(' ').trim(),
      output,
      explicit_confirmation: explicitConfirmation,
      force
    };
  }

  function readJsonFile(relativeOrAbsolutePath) {
    if (!relativeOrAbsolutePath) {
      throw new Error('Missing --from-tool-output <file>');
    }
    const absolutePath = path.resolve(projectRoot(), relativeOrAbsolutePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Tool output file not found: ${relativeOrAbsolutePath}`);
    }
    try {
      return {
        absolute_path: absolutePath,
        relative_path: projectRelative(absolutePath),
        data: JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
      };
    } catch (error) {
      throw new Error(`Failed to parse tool output JSON: ${error.message}`);
    }
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function findRegisterWrites(value, trail = []) {
    if (!isObject(value)) {
      return null;
    }
    if (isObject(value.register_writes) && isObject(value.register_writes.firmware_snippet_request)) {
      return {
        register_writes: value.register_writes,
        path: [...trail, 'register_writes'].join('.'),
        candidate: value
      };
    }
    if (isObject(value.firmware_snippet_request) && Array.isArray(value.registers)) {
      return {
        register_writes: value,
        path: trail.join('.') || '<root>',
        candidate: value
      };
    }
    const preferredKeys = ['best_candidate', 'threshold_selection', 'selection', 'result'];
    for (const key of preferredKeys) {
      const found = findRegisterWrites(value[key], [...trail, key]);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(value)) {
      if (preferredKeys.includes(key)) continue;
      const found = findRegisterWrites(child, [...trail, key]);
      if (found) return found;
    }
    return null;
  }

  function normalizeRegisters(registerWrites) {
    const registers = Array.isArray(registerWrites.registers) ? registerWrites.registers : [];
    return registers.map(item => ({
      register: String(item.register || '').trim(),
      mask_hex: String(item.mask_hex || '').trim(),
      write_value_hex: String(item.write_value_hex || '').trim(),
      fields: Array.isArray(item.fields) ? item.fields.map(field => String(field || '').trim()).filter(Boolean) : [],
      c_statement: String(item.c_statement || '').trim(),
      hal_statement: String(item.hal_statement || '').trim()
    })).filter(item => item.register);
  }

  function parseGitStatusLine(line) {
    const text = String(line || '');
    if (!text.trim()) return null;
    const status = text.slice(0, 2);
    let filePath = text.slice(3).trim();
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop().trim();
    }
    return {
      status,
      path: filePath
    };
  }

  function isFirmwareSourcePath(filePath) {
    const ext = path.extname(String(filePath || ''));
    return SOURCE_EXTENSIONS.has(ext);
  }

  function readWorktreeStatus() {
    try {
      const stdout = childProcess.execFileSync('git', ['status', '--short', '--untracked-files=all'], {
        cwd: projectRoot(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const entries = stdout.split(/\r?\n/).map(parseGitStatusLine).filter(Boolean);
      return {
        available: true,
        entries,
        dirty_files: entries.map(item => item.path),
        dirty_source_files: entries.filter(item => isFirmwareSourcePath(item.path)).map(item => item.path)
      };
    } catch (_error) {
      return {
        available: false,
        entries: [],
        dirty_files: [],
        dirty_source_files: []
      };
    }
  }

  function shouldSkipDir(name) {
    return ['.git', 'node_modules', '.emb-agent', 'dist', 'build', 'out', 'coverage'].includes(name);
  }

  function discoverFirmwareFiles() {
    const root = projectRoot();
    const files = [];
    function visit(dir, depth) {
      if (depth > 4 || files.length >= 40 || !fs.existsSync(dir)) {
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(entry => {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!shouldSkipDir(entry.name)) {
            visit(absolutePath, depth + 1);
          }
          return;
        }
        if (entry.isFile() && isFirmwareSourcePath(entry.name)) {
          files.push(projectRelative(absolutePath));
        }
      });
    }
    ['src', 'firmware', 'Core', 'app', 'source', 'Sources', 'Inc'].forEach(dir => {
      visit(path.join(root, dir), 0);
    });
    ['main.c', 'main.cpp', 'app.c', 'app.h'].forEach(file => {
      const absolutePath = path.join(root, file);
      if (fs.existsSync(absolutePath)) {
        files.push(projectRelative(absolutePath));
      }
    });
    return [...new Set(files)].sort();
  }

  function analyzeFirmwareStyle(files) {
    const samples = files.slice(0, 8);
    const text = samples.map(file => {
      try {
        return fs.readFileSync(path.join(projectRoot(), file), 'utf8').slice(0, 12000);
      } catch (_error) {
        return '';
      }
    }).join('\n');
    const traits = [];
    if (/\bMODIFY_REG\s*\(/.test(text)) traits.push('uses MODIFY_REG-style macros');
    if (/\bHAL_[A-Za-z0-9_]+\s*\(/.test(text) || /\b__HAL_/.test(text)) traits.push('uses vendor HAL calls/macros');
    if (/\b[A-Z][A-Z0-9_]*\s*=\s*(?:0x[0-9A-Fa-f]+|\d+)U?\s*;/.test(text)) traits.push('uses direct register writes');
    if (/0x[0-9A-Fa-f]+U\b|\b\d+U\b/.test(text)) traits.push('uses unsigned literal suffixes');
    if (/\/\/ [\u4e00-\u9fff]/.test(text)) traits.push('uses Chinese line comments');
    if (/\/\*/.test(text)) traits.push('uses block comments');
    return {
      sample_files: samples,
      traits: traits.length > 0 ? [...new Set(traits)] : ['no firmware style sample found']
    };
  }

  function inferBehaviorCouplings(registers, worktreeStatus) {
    const names = registers.map(item => item.register.toUpperCase()).join(' ');
    const couplings = [];
    if (/\b(TMR|TIM|TIMER|PR\d|ARR|CCR|PSC)\b/.test(names)) {
      couplings.push('timer/register changes may affect ISR cadence scheduler ticks debounce and sleep/wake restore paths');
    }
    if (/\bPWM|CCR|CCMR|CCER\b/.test(names)) {
      couplings.push('PWM changes may affect output polarity duty latching interrupt cadence and user-visible waveform timing');
    }
    if (/\bCMP|COMP|ADC|VREF|REF\b/.test(names)) {
      couplings.push('analog threshold changes may affect calibration low-power wake thresholds and protection behavior');
    }
    if (worktreeStatus.dirty_source_files.length > 0) {
      couplings.push('dirty firmware source files block automatic source patching until reviewed');
    }
    return couplings.length > 0 ? couplings : ['no obvious behavior coupling inferred from register names; review neighboring code before source edits'];
  }

  function buildSourceEditPolicy(worktreeStatus, behaviorCouplings) {
    const blocked = worktreeStatus.dirty_source_files.length > 0 || behaviorCouplings.length > 0;
    return {
      mode: blocked ? 'artifact-only' : 'artifact-first',
      source_patch_status: blocked ? 'blocked-until-reviewed' : 'not-attempted',
      reason: blocked
        ? 'Firmware source edits require explicit integration review because dirty files or behavior couplings are present.'
        : 'No source patch was attempted; snippet draft remains a review artifact first.'
    };
  }

  function buildArtifactContent(context) {
    const {
      title,
      toolOutputPath,
      foundPath,
      registerWrites,
      registers,
      request,
      worktreeStatus,
      firmwareFiles,
      firmwareStyle,
      behaviorCouplings,
      sourceEditPolicy
    } = context;
    const cStatements = registers.map(item => item.c_statement).filter(Boolean);
    const halStatements = registers.map(item => item.hal_statement).filter(Boolean);
    const requiredContext = request.inputs && Array.isArray(request.inputs.required_context)
      ? request.inputs.required_context
      : [];
    const requiredOutput = Array.isArray(request.required_output) ? request.required_output : [];
    const gates = Array.isArray(request.gates) ? request.gates : [];
    const constraints = Array.isArray(request.constraints) ? request.constraints : [];

    return [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      'status: "draft"',
      `protocol: "${String(request.protocol || 'emb-agent.firmware-snippet-request/1').replace(/"/g, '\\"')}"`,
      'authoring: "ai-authored"',
      `created: "${new Date().toISOString()}"`,
      `source_tool_output: "${toolOutputPath.replace(/"/g, '\\"')}"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Scope',
      '',
      'This is a project-local firmware snippet review artifact generated from an emb-agent register write plan. It is not an applied firmware patch.',
      '',
      '## Source Edit Policy',
      '',
      `- Mode: \`${sourceEditPolicy.mode}\`.`,
      `- Source patch status: \`${sourceEditPolicy.source_patch_status}\`.`,
      `- Reason: ${sourceEditPolicy.reason}`,
      `- Dirty source files: ${worktreeStatus.dirty_source_files.length > 0 ? worktreeStatus.dirty_source_files.map(item => `\`${item}\``).join(', ') : 'none detected'}.`,
      '',
      '## Inputs',
      '',
      `- Tool output: \`${toolOutputPath}\`.`,
      `- Register write path: \`${foundPath}\`.`,
      `- Protocol: \`${request.protocol || ''}\`.`,
      `- Authoring: \`${request.authoring || ''}\`.`,
      `- Status: \`${request.status || ''}\`.`,
      `- Required context: ${requiredContext.length > 0 ? requiredContext.map(item => `\`${item}\``).join(', ') : 'not declared'}.`,
      '',
      '## Register Writes',
      '',
      ...registers.map(item => `- \`${item.register}\`: mask \`${item.mask_hex}\`, value \`${item.write_value_hex}\`, fields ${item.fields.length > 0 ? item.fields.map(field => `\`${field}\``).join(', ') : 'not declared'}.`),
      '',
      '## Code Snippet',
      '',
      'Direct C statements from the register write plan, pending project-local integration review:',
      '',
      '```c',
      ...(cStatements.length > 0 ? cStatements : ['/* No direct C statements were present in the register write plan. */']),
      '```',
      '',
      'HAL-style macro statements from the same plan, only usable when the local SDK defines compatible macros:',
      '',
      '```c',
      ...(halStatements.length > 0 ? halStatements : ['/* No HAL-style statements were present in the register write plan. */']),
      '```',
      '',
      '## Firmware Context',
      '',
      `- Firmware files inspected: ${firmwareFiles.length > 0 ? firmwareFiles.slice(0, 20).map(item => `\`${item}\``).join(', ') : 'none detected'}.`,
      `- Style traits: ${firmwareStyle.traits.map(item => `\`${item}\``).join(', ')}.`,
      `- Style sample files: ${firmwareStyle.sample_files.length > 0 ? firmwareStyle.sample_files.map(item => `\`${item}\``).join(', ') : 'none'}.`,
      '',
      '## Behavior Couplings',
      '',
      ...behaviorCouplings.map(item => `- ${item}`),
      '',
      '## Required Output Coverage',
      '',
      ...requiredOutput.map(item => `- ${item}`),
      '',
      '## Gates',
      '',
      ...gates.map(item => `- ${item}`),
      '',
      '## Constraints',
      '',
      ...constraints.map(item => `- ${item}`),
      '',
      '## Verification Evidence',
      '',
      '- Register write provenance is linked to the tool output above.',
      '- No firmware compile or static check was run by this command.',
      '- Source files were not modified by this command.',
      '',
      '## Residual Risks',
      '',
      '- Verify register encodings against source documentation before promoting this draft.',
      '- Review neighboring initialization, ISR, clock, low-power, and restore paths before applying source edits.',
      '- Confirm local SDK/HAL symbols before using HAL-style statements.',
      '',
      '<!-- emb-agent:raw-register-writes -->',
      '```json',
      JSON.stringify(registerWrites, null, 2),
      '```',
      ''
    ].join('\n');
  }

  function evaluateSnippetWritePermission(explicitConfirmation) {
    return permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: 'snippet-draft',
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });
  }

  function buildConfirmationPreview(artifact) {
    return {
      status: 'confirmation-required',
      write_mode: 'preview',
      action: 'snippet-draft',
      target: artifact.relative_path,
      summary: artifact.summary,
      content: artifact.content,
      next_steps: [
        `Re-run with --confirm to write ${artifact.relative_path}`
      ]
    };
  }

  function draftFirmwareSnippet(parsed) {
    const source = readJsonFile(parsed.from_tool_output);
    const found = findRegisterWrites(source.data);
    if (!found) {
      throw new Error('No register_writes.firmware_snippet_request found in tool output');
    }
    const registerWrites = found.register_writes;
    const request = registerWrites.firmware_snippet_request || {};
    if (request.protocol !== 'emb-agent.firmware-snippet-request/1') {
      throw new Error(`Unsupported firmware snippet protocol: ${request.protocol || '(missing)'}`);
    }
    const registers = normalizeRegisters(registerWrites);
    if (registers.length === 0) {
      throw new Error('No register writes found for firmware snippet draft');
    }
    const title = parsed.title || `Firmware snippet draft for ${registers.map(item => item.register).join(' ')}`;
    const slug = slugify(title);
    const relativePath = parsed.output
      ? parsed.output.replace(/\\/g, '/')
      : `.emb-agent/firmware-snippets/${slug}.md`;
    const absolutePath = path.resolve(projectRoot(), relativePath);
    const worktreeStatus = readWorktreeStatus();
    const firmwareFiles = discoverFirmwareFiles();
    const firmwareStyle = analyzeFirmwareStyle(firmwareFiles);
    const behaviorCouplings = inferBehaviorCouplings(registers, worktreeStatus);
    const sourceEditPolicy = buildSourceEditPolicy(worktreeStatus, behaviorCouplings);
    const content = buildArtifactContent({
      title,
      toolOutputPath: source.relative_path,
      foundPath: found.path,
      registerWrites,
      registers,
      request,
      worktreeStatus,
      firmwareFiles,
      firmwareStyle,
      behaviorCouplings,
      sourceEditPolicy
    });
    const artifact = {
      relative_path: relativePath,
      absolute_path: absolutePath,
      summary: `Draft firmware snippet artifact for ${registers.map(item => item.register).join(', ')}.`,
      content
    };

    if (!parsed.explicit_confirmation) {
      return {
        ...buildConfirmationPreview(artifact),
        source_edit_policy: sourceEditPolicy,
        behavior_couplings: behaviorCouplings,
        register_writes: {
          path: found.path,
          registers
        },
        worktree: worktreeStatus,
        firmware_context: {
          files: firmwareFiles,
          style: firmwareStyle
        }
      };
    }

    const permissionDecision = evaluateSnippetWritePermission(true);
    if (permissionDecision.decision !== 'allow') {
      return permissionGateHelpers.applyPermissionDecision(
        buildConfirmationPreview(artifact),
        permissionDecision
      );
    }
    if (fs.existsSync(absolutePath) && !parsed.force) {
      throw new Error(`Firmware snippet artifact already exists: ${relativePath}. Re-run with --force to overwrite.`);
    }
    runtime.ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, content, 'utf8');
    updateSession(current => {
      current.last_command = 'snippet draft';
      current.last_files = [relativePath, ...((current.last_files || []).filter(item => item !== relativePath))].slice(0, 10);
    });
    return {
      status: 'written',
      write_mode: 'artifact',
      artifact_path: relativePath,
      source_edit_policy: sourceEditPolicy,
      behavior_couplings: behaviorCouplings,
      register_writes: {
        path: found.path,
        registers
      },
      worktree: worktreeStatus,
      firmware_context: {
        files: firmwareFiles,
        style: firmwareStyle
      },
      next_steps: [
        `Review ${relativePath}`,
        'Compile or static-check the project before applying source edits',
        'Patch firmware sources only after behavior couplings are reviewed',
        'knowledge graph refresh',
        `knowledge graph query ${registers[0].register}`
      ]
    };
  }

  function handleSnippetCommands(cmd, subcmd, rest) {
    if (cmd !== 'snippet') {
      return undefined;
    }
    if (!subcmd || subcmd === 'draft') {
      return draftFirmwareSnippet(parseSnippetDraftArgs(rest || []));
    }
    throw new Error(`Unknown snippet command: ${subcmd}`);
  }

  return {
    handleSnippetCommands,
    draftFirmwareSnippet,
    parseSnippetDraftArgs
  };
}

module.exports = {
  createFirmwareSnippetRuntimeHelpers
};
