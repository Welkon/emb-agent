'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');

function createMemoryRuntimeHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    runtimeHost,
    resolveProjectRoot,
    getProjectExtDir,
    resolveSession,
    updateSession,
    builtInMemoryDir,
    builtInDisplayRoot
  } = deps;

  const AUTO_MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

  function getRuntimeHost() {
    return typeof runtimeHost === 'function' ? runtimeHost() : runtimeHost;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `memory-${Date.now()}`;
  }

  function getBuiltInOrganizationMemoryPath() {
    return path.join(builtInMemoryDir, 'organization.md');
  }

  function getUserMemoryDir() {
    return path.join(getRuntimeHost().runtimeHome, 'memory');
  }

  function getUserMemoryPath() {
    return path.join(getUserMemoryDir(), 'user.md');
  }

  function getProjectMemoryDir() {
    return path.join(getProjectExtDir(), 'memory');
  }

  function getProjectInstructionPath() {
    return path.join(getProjectMemoryDir(), 'project.md');
  }

  function getLocalInstructionPath() {
    return path.join(getProjectMemoryDir(), 'local.md');
  }

  function getAutoMemoryDir() {
    return path.join(getProjectMemoryDir(), 'auto');
  }

  function getAutoTopicsDir() {
    return path.join(getAutoMemoryDir(), 'topics');
  }

  function getAutoMemoryIndexPath() {
    return path.join(getAutoMemoryDir(), 'MEMORY.md');
  }

  function getDisplayPath(filePath, rootPath) {
    return path.relative(rootPath, filePath).replace(/\\/g, '/');
  }

  function ensureMemoryLayout() {
    runtime.ensureDir(getUserMemoryDir());
    runtime.ensureDir(getProjectMemoryDir());
    runtime.ensureDir(getAutoTopicsDir());
    if (!fs.existsSync(getAutoMemoryIndexPath())) {
      fs.writeFileSync(getAutoMemoryIndexPath(), '# Auto Memory Index\n', 'utf8');
    }
  }

  function normalizeMemoryType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!AUTO_MEMORY_TYPES.includes(normalized)) {
      throw new Error(`Unsupported memory type: ${value}`);
    }
    return normalized;
  }

  function readInstructionWithIncludes(filePath, seen) {
    if (!fs.existsSync(filePath)) {
      return '';
    }

    const resolvedPath = path.resolve(filePath);
    const visited = seen || new Set();
    if (visited.has(resolvedPath)) {
      return '';
    }
    visited.add(resolvedPath);

    const baseDir = path.dirname(resolvedPath);
    return runtime.readText(resolvedPath)
      .split(/\r?\n/)
      .map(line => {
        const match = line.match(/^@include\s+(.+)$/u);
        if (!match) {
          return line;
        }
        const includePath = path.resolve(baseDir, match[1].trim());
        return readInstructionWithIncludes(includePath, visited).trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function loadInstructionLayers() {
    ensureMemoryLayout();
    const projectRoot = resolveProjectRoot();
    const host = getRuntimeHost();
    const layers = [
      {
        scope: 'organization',
        file_path: getBuiltInOrganizationMemoryPath(),
        display_path: getDisplayPath(getBuiltInOrganizationMemoryPath(), builtInDisplayRoot || builtInMemoryDir),
        source: 'built-in'
      },
      {
        scope: 'user',
        file_path: getUserMemoryPath(),
        display_path: getDisplayPath(getUserMemoryPath(), host.runtimeHome),
        source: 'user'
      },
      {
        scope: 'project',
        file_path: getProjectInstructionPath(),
        display_path: getDisplayPath(getProjectInstructionPath(), projectRoot),
        source: 'project'
      },
      {
        scope: 'local',
        file_path: getLocalInstructionPath(),
        display_path: getDisplayPath(getLocalInstructionPath(), projectRoot),
        source: 'local'
      }
    ].map(layer => ({
      ...layer,
      content: readInstructionWithIncludes(layer.file_path),
      present: fs.existsSync(layer.file_path)
    }));

    return {
      layers,
      merged_content: layers
        .filter(layer => layer.content)
        .map(layer => `## ${layer.scope}\n${layer.content}`)
        .join('\n\n')
        .trim()
    };
  }

  function parseIndexEntries() {
    ensureMemoryLayout();
    const lines = runtime.readText(getAutoMemoryIndexPath()).split(/\r?\n/);
    const entries = [];

    lines.forEach(line => {
      const match = line.match(/^- \[(.+?)\]\((.+?)\) \| type=(.+?) \| created_at=(.+?) \| (.+)$/u);
      if (!match) {
        return;
      }
      entries.push({
        name: match[1],
        topic_path: match[2],
        type: match[3],
        created_at: match[4],
        summary: match[5]
      });
    });

    return entries;
  }

  function listAutoMemory() {
    return parseIndexEntries().map(entry => ({
      ...entry,
      path: runtime.getProjectAssetRelativePath('memory', 'auto', entry.topic_path.replace(/^\.?\//, ''))
    }));
  }

  function buildTopicContent(entry) {
    return [
      '---',
      `name: ${entry.name}`,
      `type: ${entry.type}`,
      `created_at: ${entry.created_at}`,
      `summary: ${entry.summary}`,
      '---',
      '',
      `# ${entry.name}`,
      '',
      entry.detail || entry.summary,
      ''
    ].join('\n');
  }

  function applyMemoryWritePermission(actionName, explicitConfirmation) {
    const resolved = resolveSession();
    const permission = permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: actionName,
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (resolved && resolved.project_config && resolved.project_config.permissions) || {}
    });

    return permission;
  }

  function appendIndexEntry(entry) {
    const line = `- [${entry.name}](${entry.topic_path}) | type=${entry.type} | created_at=${entry.created_at} | ${entry.summary}`;
    const current = runtime.readText(getAutoMemoryIndexPath());
    const next = current.endsWith('\n') ? current : `${current}\n`;
    fs.writeFileSync(getAutoMemoryIndexPath(), `${next}${line}\n`, 'utf8');
  }

  function rememberMemory(input) {
    ensureMemoryLayout();
    const source = isObject(input) ? input : {};
    const type = normalizeMemoryType(source.type || 'project');
    const summary = String(source.summary || '').trim();
    const detail = String(source.detail || '').trim();
    const explicitConfirmation = source.explicit_confirmation === true;

    if (!summary) {
      throw new Error('Memory summary is required');
    }

    const permission = applyMemoryWritePermission('memory-write-auto', explicitConfirmation);
    const permissionResult = permissionGateHelpers.applyPermissionDecision({
      action: 'remember',
      type,
      summary
    }, permission);
    if (permissionResult.status === 'permission-pending' || permissionResult.status === 'permission-denied') {
      return permissionResult;
    }

    const createdAt = new Date().toISOString();
    const slug = `${createdAt.slice(0, 10)}-${slugify(summary)}`;
    const topicPath = path.join(getAutoTopicsDir(), `${slug}.md`);
    const relativeTopicPath = `topics/${slug}.md`;
    const entry = {
      name: slug,
      type,
      created_at: createdAt,
      summary,
      detail,
      topic_path: relativeTopicPath
    };

    fs.writeFileSync(topicPath, buildTopicContent(entry), 'utf8');
    appendIndexEntry(entry);

    updateSession(current => {
      current.last_command = 'memory remember';
      current.memory = isObject(current.memory) ? current.memory : {};
      current.memory.last_written_at = createdAt;
      current.memory.last_written_entry = slug;
    });

    return {
      remembered: true,
      entry: {
        ...entry,
        path: runtime.getProjectAssetRelativePath('memory', 'auto', relativeTopicPath)
      }
    };
  }

  function loadMemoryEntry(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing memory entry name');
    }
    const entry = parseIndexEntries().find(item => item.name === normalized);
    if (!entry) {
      throw new Error(`Memory entry not found: ${name}`);
    }
    const topicPath = path.join(getAutoMemoryDir(), entry.topic_path);
    return {
      ...entry,
      path: runtime.getProjectAssetRelativePath('memory', 'auto', entry.topic_path),
      content: runtime.readText(topicPath)
    };
  }

  function buildSessionExtraction(note) {
    const resolved = resolveSession();
    const session = resolved && resolved.session ? resolved.session : {};
    const detailLines = [
      `Focus: ${session.focus || '(empty)'}`,
      `Last command: ${session.last_command || '(empty)'}`,
      `Last files: ${(session.last_files || []).join(', ') || '(none)'}`,
      `Open questions: ${(session.open_questions || []).join(' | ') || '(none)'}`,
      `Known risks: ${(session.known_risks || []).join(' | ') || '(none)'}`,
      note ? `Note: ${note}` : ''
    ].filter(Boolean);

    const summary = session.focus
      ? `Session extraction: ${session.focus}`
      : session.open_questions && session.open_questions.length > 0
        ? `Session extraction: ${session.open_questions[0]}`
        : 'Session extraction: current emb working state';

    return {
      type: 'project',
      summary,
      detail: detailLines.join('\n')
    };
  }

  function extractMemory(note, explicitConfirmation) {
    const remembered = rememberMemory({
      ...buildSessionExtraction(note),
      explicit_confirmation: explicitConfirmation === true
    });

    if (remembered.remembered) {
      updateSession(current => {
        current.last_command = 'memory extract';
        current.memory = isObject(current.memory) ? current.memory : {};
        current.memory.last_extracted_at = new Date().toISOString();
      });
    }

    return remembered;
  }

  function suggestPromotionTarget(entry) {
    if (entry.type === 'user' || entry.type === 'feedback') {
      return 'user';
    }
    if (entry.type === 'reference') {
      return 'project';
    }
    return 'project';
  }

  function auditMemory() {
    const stack = loadInstructionLayers();
    const entries = listAutoMemory();
    return {
      stack,
      entries: entries.map(entry => ({
        ...entry,
        suggested_target: suggestPromotionTarget(entry),
        suggestion_reason:
          entry.type === 'user' || entry.type === 'feedback'
            ? 'User/feedback memory is usually better promoted into persistent user instructions'
            : 'Project/reference memory is usually better promoted into persistent project instructions'
      }))
    };
  }

  function resolvePromotionPath(target) {
    const normalized = String(target || '').trim().toLowerCase();
    if (normalized === 'organization') {
      return {
        action_name: 'memory-promote-organization',
        file_path: getBuiltInOrganizationMemoryPath(),
        display_path: getDisplayPath(getBuiltInOrganizationMemoryPath(), builtInDisplayRoot || builtInMemoryDir)
      };
    }
    if (normalized === 'user') {
      return {
        action_name: 'memory-promote-user',
        file_path: getUserMemoryPath(),
        display_path: getDisplayPath(getUserMemoryPath(), getRuntimeHost().runtimeHome)
      };
    }
    if (normalized === 'project') {
      return {
        action_name: 'memory-promote-project',
        file_path: getProjectInstructionPath(),
        display_path: getDisplayPath(getProjectInstructionPath(), resolveProjectRoot())
      };
    }
    if (normalized === 'local') {
      return {
        action_name: 'memory-promote-local',
        file_path: getLocalInstructionPath(),
        display_path: getDisplayPath(getLocalInstructionPath(), resolveProjectRoot())
      };
    }
    throw new Error(`Unknown memory promotion target: ${target}`);
  }

  function promoteMemory(name, target, explicitConfirmation) {
    ensureMemoryLayout();
    const entry = loadMemoryEntry(name);
    const destination = resolvePromotionPath(target);
    const permission = applyMemoryWritePermission(destination.action_name, explicitConfirmation === true);
    const permissionResult = permissionGateHelpers.applyPermissionDecision({
      promoted: false,
      entry: {
        name: entry.name,
        target
      }
    }, permission);
    if (permissionResult.status === 'permission-pending' || permissionResult.status === 'permission-denied') {
      return permissionResult;
    }

    runtime.ensureDir(path.dirname(destination.file_path));
    const current = fs.existsSync(destination.file_path) ? runtime.readText(destination.file_path) : '';
    const block = [
      current.trimEnd(),
      '',
      `## Promoted Memory | ${new Date().toISOString()}`,
      `- Source: ${entry.name}`,
      `- Type: ${entry.type}`,
      `- Summary: ${entry.summary}`,
      '',
      entry.content.trim(),
      ''
    ].filter(Boolean).join('\n');
    fs.writeFileSync(destination.file_path, `${block}\n`, 'utf8');

    updateSession(currentSession => {
      currentSession.last_command = 'memory promote';
      currentSession.memory = isObject(currentSession.memory) ? currentSession.memory : {};
      currentSession.memory.last_promoted_at = new Date().toISOString();
      currentSession.memory.last_promoted_entry = entry.name;
      currentSession.memory.last_promoted_target = String(target || '');
    });

    return {
      promoted: true,
      entry: {
        name: entry.name,
        type: entry.type,
        summary: entry.summary
      },
      target: String(target || '').trim().toLowerCase(),
      path: destination.display_path
    };
  }

  function parseMemoryRememberArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const options = {
      type: 'project',
      detail: '',
      explicit_confirmation: false,
      summary: ''
    };

    const summaryParts = [];
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--confirm') {
        options.explicit_confirmation = true;
        continue;
      }
      if (token === '--type') {
        options.type = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--detail') {
        options.detail = argv[index + 1] || '';
        index += 1;
        continue;
      }
      summaryParts.push(token);
    }

    options.summary = summaryParts.join(' ').trim();
    return options;
  }

  function parseMemoryExtractArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const options = {
      explicit_confirmation: false,
      note: ''
    };
    const noteParts = [];
    argv.forEach(token => {
      if (token === '--confirm') {
        options.explicit_confirmation = true;
      } else {
        noteParts.push(token);
      }
    });
    options.note = noteParts.join(' ').trim();
    return options;
  }

  function parseMemoryPromoteArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const options = {
      name: '',
      target: '',
      explicit_confirmation: false
    };
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--confirm') {
        options.explicit_confirmation = true;
        continue;
      }
      if (token === '--to') {
        options.target = argv[index + 1] || '';
        index += 1;
        continue;
      }

      if (!options.name) {
        options.name = token;
      }
    }

    if (!options.name) {
      throw new Error('Missing memory entry name');
    }
    if (!options.target) {
      throw new Error('Missing memory promotion target');
    }
    return options;
  }

  function maybeAutoExtractAtBoundary(noteText, boundary) {
    const disabled = String(process.env.EMB_AGENT_MEMORY_DISABLED || '').trim() === '1';
    if (disabled) {
      return null;
    }
    const boundaryLabel = String(boundary || '').trim().toLowerCase();
    const noteBody = String(noteText || '').trim();
    const finalNote = boundaryLabel
      ? `${boundaryLabel}: ${noteBody}`.trim()
      : noteBody;
    return extractMemory(finalNote, true);
  }

  function maybeAutoExtractOnPause(noteText) {
    return maybeAutoExtractAtBoundary(noteText, 'pause');
  }

  function maybeAutoExtractOnSessionReport(noteText) {
    return maybeAutoExtractAtBoundary(noteText, 'session record');
  }

  return {
    loadInstructionLayers,
    listAutoMemory,
    loadMemoryEntry,
    rememberMemory,
    extractMemory,
    auditMemory,
    promoteMemory,
    parseMemoryRememberArgs,
    parseMemoryExtractArgs,
    parseMemoryPromoteArgs,
    maybeAutoExtractAtBoundary,
    maybeAutoExtractOnPause,
    maybeAutoExtractOnSessionReport
  };
}

module.exports = {
  createMemoryRuntimeHelpers
};
