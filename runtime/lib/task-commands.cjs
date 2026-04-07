'use strict';

function createTaskCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    resolveProjectRoot,
    getProjectExtDir,
    getProjectConfig,
    loadSession,
    resolveSession,
    updateSession,
    requireRestText,
    docCache,
    adapterSources,
    rootDir
  } = deps;

  const CONTEXT_CHANNELS = ['implement', 'check', 'debug'];

  function getTasksDir() {
    return path.join(getProjectExtDir(), 'tasks');
  }

  function ensureTasksDir() {
    runtime.ensureDir(getTasksDir());
  }

  function normalizeTaskSlug(text) {
    const slug = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    return slug || `task-${Date.now()}`;
  }

  function buildUniqueTaskSlug(summary) {
    ensureTasksDir();
    const base = normalizeTaskSlug(summary);
    let next = base;
    let index = 2;

    while (fs.existsSync(path.join(getTasksDir(), next))) {
      next = `${base}-${index}`;
      index += 1;
    }

    return next;
  }

  function getTaskDir(name) {
    return path.join(getTasksDir(), name);
  }

  function getTaskManifestPath(name) {
    return path.join(getTaskDir(name), 'task.json');
  }

  function getTaskContextPath(name, channel) {
    return path.join(getTaskDir(name), `${channel}.jsonl`);
  }

  function ensureContextChannel(channel) {
    if (!CONTEXT_CHANNELS.includes(channel)) {
      throw new Error(`Unknown task context channel: ${channel}`);
    }
    return channel;
  }

  function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    return runtime.readText(filePath)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  function writeJsonl(filePath, entries) {
    const lines = (entries || []).map(entry => JSON.stringify(entry, null, 0));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  }

  function contextEntryKey(entry) {
    return `${entry.kind || 'file'}:${entry.path || ''}`;
  }

  function normalizeContextEntry(entry) {
    return {
      kind: entry && entry.kind === 'directory' ? 'directory' : 'file',
      path: runtime.normalizeProjectRelativePath(String((entry && entry.path) || '').trim()),
      reason: String((entry && entry.reason) || '').trim()
    };
  }

  function uniqueContextEntries(entries) {
    const map = new Map();
    (entries || [])
      .map(item => normalizeContextEntry(item))
      .filter(item => item.path)
      .forEach(item => {
        const key = contextEntryKey(item);
        if (!map.has(key)) {
          map.set(key, item);
          return;
        }
        const current = map.get(key);
        map.set(key, {
          ...current,
          reason: runtime.unique([current.reason, item.reason]).filter(Boolean).join(' | ')
        });
      });
    return [...map.values()];
  }

  function parseTaskAddArgs(rest) {
    const result = {
      type: 'implement',
      summary: ''
    };
    const summaryParts = [];

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === '--type') {
        result.type = rest[index + 1] || '';
        index += 1;
        continue;
      }
      summaryParts.push(token);
    }

    result.summary = summaryParts.join(' ').trim();
    if (!result.summary) {
      throw new Error('Missing task summary');
    }
    return result;
  }

  function parseTaskContextArgs(rest) {
    if (!rest[0]) throw new Error('Missing task name');
    if (!rest[1]) throw new Error('Missing context channel');
    if (!rest[2]) throw new Error('Missing context path');

    return {
      name: rest[0],
      channel: ensureContextChannel(rest[1]),
      targetPath: runtime.normalizeProjectRelativePath(rest[2]),
      reason: rest.slice(3).join(' ').trim() || 'Added manually'
    };
  }

  function buildDefaultContextEntries(channel, session) {
    const baseEntries = [
      {
        path: runtime.getProjectAssetRelativePath('hw.yaml'),
        reason: '硬件真值'
      },
      {
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: '需求真值'
      }
    ];

    if (channel === 'implement') {
      baseEntries.push(
        {
          path: 'docs/HARDWARE-LOGIC.md',
          reason: '硬件逻辑记录'
        },
        {
          path: 'docs/DEBUG-NOTES.md',
          reason: '调试记录'
        }
      );
    }

    if (channel === 'debug') {
      baseEntries.push({
        path: 'docs/DEBUG-NOTES.md',
        reason: '调试记录'
      });
    }

    if (session.active_thread && session.active_thread.path) {
      baseEntries.push({
        path: session.active_thread.path,
        reason: '当前活跃 thread'
      });
    }

    if (session.active_workspace && session.active_workspace.path) {
      baseEntries.push({
        path: session.active_workspace.path,
        reason: '当前活跃 workspace'
      });
    }

    (session.last_files || []).forEach(item => {
      baseEntries.push({
        path: item,
        reason: '最近相关文件'
      });
    });

    return uniqueContextEntries(baseEntries);
  }

  function tokenizeText(text) {
    return runtime.unique(
      String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(item => item.trim())
        .filter(item => item.length >= 3)
    );
  }

  function scoreDocEntry(entry, summary, resolved) {
    const summaryTokens = tokenizeText(summary);
    const model = String(
      resolved &&
      resolved.hardware &&
      resolved.hardware.identity &&
      resolved.hardware.identity.model
        ? resolved.hardware.identity.model
        : ''
    ).toLowerCase();
    const haystack = [
      entry.doc_id,
      entry.title,
      entry.source,
      entry.intended_to
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 0;
    if (model && haystack.includes(model)) {
      score += 3;
    }
    if (entry.intended_to === 'hardware') {
      score += 2;
    }
    summaryTokens.forEach(token => {
      if (haystack.includes(token)) {
        score += 1;
      }
    });
    return score;
  }

  function buildDocBindings(summary, resolved) {
    const projectRoot = resolveProjectRoot();
    const index = docCache.loadDocsIndex(projectRoot);
    const ranked = (index.documents || [])
      .map(entry => ({
        entry,
        score: scoreDocEntry(entry, summary, resolved)
      }))
      .filter(item => item.score > 0 || item.entry.intended_to === 'hardware')
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(right.entry.cached_at || '').localeCompare(String(left.entry.cached_at || ''));
      })
      .slice(0, 4)
      .map(item => item.entry);

    return ranked.map(entry => ({
      doc_id: entry.doc_id,
      title: entry.title || '',
      intended_to: entry.intended_to || '',
      source: entry.source || '',
      markdown: entry.artifacts && entry.artifacts.markdown ? entry.artifacts.markdown : '',
      metadata: entry.artifacts && entry.artifacts.metadata ? entry.artifacts.metadata : '',
      hardware_facts: entry.artifacts && entry.artifacts.hardware_facts ? entry.artifacts.hardware_facts : '',
      requirements_facts: entry.artifacts && entry.artifacts.requirements_facts ? entry.artifacts.requirements_facts : ''
    }));
  }

  function buildAdapterBindings(resolved) {
    const projectConfig = getProjectConfig ? getProjectConfig() : {};
    const statuses = adapterSources.listSourceStatus(rootDir, resolveProjectRoot(), projectConfig);

    return statuses
      .filter(item => item && item.targets && item.targets.project && item.targets.project.synced)
      .map(item => {
        const selection = item.targets.project.selection || {};
        const matched = selection.matched || {};
        return {
          source: item.name,
          synced: Boolean(item.targets.project.synced),
          matched_chips: matched.chips || [],
          matched_tools: matched.tools || [],
          matched_devices: matched.devices || [],
          matched_families: matched.families || [],
          filtered: selection.filtered !== false
        };
      });
  }

  function buildToolBindings(resolved) {
    const suggestedTools =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.suggested_tools)
        ? resolved.effective.suggested_tools
        : [];
    const toolRecommendations =
      resolved &&
      resolved.effective &&
      Array.isArray(resolved.effective.tool_recommendations)
        ? resolved.effective.tool_recommendations
        : [];

    return toolRecommendations.map(item => {
      const suggested = suggestedTools.find(tool => tool.name === item.tool) || null;
      return {
        tool: item.tool,
        status: item.status,
        adapter_status: item.adapter_status,
        binding_source: item.binding_source,
        binding_algorithm: item.binding_algorithm,
        cli_draft: item.cli_draft,
        missing_inputs: item.missing_inputs || [],
        discovered_from: suggested ? suggested.discovered_from : '',
        adapter_path: suggested ? suggested.adapter_path : ''
      };
    });
  }

  function buildTaskBindings(summary) {
    const resolved = resolveSession();
    const hardwareIdentity = resolved && resolved.hardware ? resolved.hardware.identity : null;
    const chipProfile = resolved && resolved.hardware ? resolved.hardware.chip_profile : null;

    return {
      hardware: {
        identity: hardwareIdentity || {
          vendor: '',
          model: '',
          package: '',
          file: runtime.getProjectAssetRelativePath('hw.yaml')
        },
        chip_profile: chipProfile
          ? {
              name: chipProfile.name,
              vendor: chipProfile.vendor,
              family: chipProfile.family,
              package: chipProfile.package,
              runtime_model: chipProfile.runtime_model
            }
          : null
      },
      docs: buildDocBindings(summary, resolved),
      adapters: buildAdapterBindings(resolved),
      tools: buildToolBindings(resolved)
    };
  }

  function buildBindingContextEntries(channel, bindings) {
    const docs = Array.isArray(bindings.docs) ? bindings.docs : [];
    const entries = [];

    docs.forEach(doc => {
      if (doc.markdown && (channel === 'implement' || channel === 'debug')) {
        entries.push({
          path: doc.markdown,
          reason: `关联文档 markdown: ${doc.doc_id}`
        });
      }
      if (doc.hardware_facts && (channel === 'implement' || channel === 'check')) {
        entries.push({
          path: doc.hardware_facts,
          reason: `关联文档硬件草稿: ${doc.doc_id}`
        });
      }
      if (doc.requirements_facts && channel === 'check') {
        entries.push({
          path: doc.requirements_facts,
          reason: `关联文档需求草稿: ${doc.doc_id}`
        });
      }
    });

    return uniqueContextEntries(entries);
  }

  function buildTaskManifest(name, summary, type, session, bindings) {
    const now = new Date().toISOString();
    return {
      name,
      title: summary,
      status: 'OPEN',
      type,
      goal: summary,
      focus: session.focus || '',
      references: runtime.unique(session.last_files || []),
      open_questions: runtime.unique(session.open_questions || []),
      known_risks: runtime.unique(session.known_risks || []),
      bindings: bindings || {
        hardware: {
          identity: {
            vendor: '',
            model: '',
            package: '',
            file: runtime.getProjectAssetRelativePath('hw.yaml')
          },
          chip_profile: null
        },
        docs: [],
        adapters: [],
        tools: []
      },
      context: Object.fromEntries(
        CONTEXT_CHANNELS.map(channel => [
          channel,
          path.relative(resolveProjectRoot(), getTaskContextPath(name, channel))
        ])
      ),
      created_at: now,
      updated_at: now
    };
  }

  function writeTask(name, manifest) {
    const taskDir = getTaskDir(name);
    runtime.ensureDir(taskDir);
    runtime.writeJson(getTaskManifestPath(name), manifest);
  }

  function readTask(name) {
    const manifestPath = getTaskManifestPath(name);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Task not found: ${name}`);
    }

    const manifest = runtime.readJson(manifestPath);
    const context = {};
    CONTEXT_CHANNELS.forEach(channel => {
      context[channel] = readJsonl(getTaskContextPath(name, channel));
    });

    return {
      name: String(manifest.name || name),
      title: String(manifest.title || manifest.goal || name),
      status: String(manifest.status || 'OPEN'),
      type: String(manifest.type || 'implement'),
      goal: String(manifest.goal || manifest.title || ''),
      focus: String(manifest.focus || ''),
      references: Array.isArray(manifest.references) ? manifest.references : [],
      open_questions: Array.isArray(manifest.open_questions) ? manifest.open_questions : [],
      known_risks: Array.isArray(manifest.known_risks) ? manifest.known_risks : [],
      bindings: manifest.bindings || {
        hardware: {
          identity: {
            vendor: '',
            model: '',
            package: '',
            file: runtime.getProjectAssetRelativePath('hw.yaml')
          },
          chip_profile: null
        },
        docs: [],
        adapters: [],
        tools: []
      },
      context_files: manifest.context || {},
      created_at: String(manifest.created_at || ''),
      updated_at: String(manifest.updated_at || ''),
      path: path.relative(process.cwd(), manifestPath),
      context
    };
  }

  function listTasks() {
    ensureTasksDir();
    const tasks = fs.readdirSync(getTasksDir())
      .filter(name => fs.existsSync(getTaskManifestPath(name)))
      .map(name => readTask(name))
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));

    return { tasks };
  }

  function createTask(rest) {
    const parsed = parseTaskAddArgs(rest);
    const session = loadSession();
    const name = buildUniqueTaskSlug(parsed.summary);
    const bindings = buildTaskBindings(parsed.summary);
    const manifest = buildTaskManifest(name, parsed.summary, parsed.type, session, bindings);

    writeTask(name, manifest);
    CONTEXT_CHANNELS.forEach(channel => {
      writeJsonl(
        getTaskContextPath(name, channel),
        uniqueContextEntries([
          ...buildBindingContextEntries(channel, bindings),
          ...buildDefaultContextEntries(channel, session)
        ])
      );
    });

    updateSession(current => {
      current.last_command = 'task add';
    });

    return {
      created: true,
      task: readTask(name)
    };
  }

  function showTask(name) {
    const task = readTask(name);
    updateSession(current => {
      current.last_command = 'task show';
    });
    return { task };
  }

  function activateTask(name) {
    const task = readTask(name);
    const manifest = runtime.readJson(getTaskManifestPath(name));
    manifest.status = 'IN_PROGRESS';
    manifest.updated_at = new Date().toISOString();
    writeTask(name, manifest);

    updateSession(current => {
      current.last_command = 'task activate';
      current.focus = task.title;
      current.last_files = runtime
        .unique([
          ...(((task.context || {}).implement) || []).map(item => item.path),
          ...(current.last_files || [])
        ])
        .slice(0, 12);
      current.active_task = {
        name: task.name,
        title: task.title,
        status: 'IN_PROGRESS',
        path: task.path,
        updated_at: manifest.updated_at
      };
    });

    return {
      activated: true,
      task: readTask(name)
    };
  }

  function resolveTask(name, rest) {
    const note = rest.join(' ').trim();
    const manifestPath = getTaskManifestPath(name);
    const manifest = runtime.readJson(manifestPath);
    manifest.status = 'RESOLVED';
    manifest.updated_at = new Date().toISOString();
    if (note) {
      manifest.resolution_note = note;
    }
    writeTask(name, manifest);

    updateSession(current => {
      current.last_command = 'task resolve';
      if (current.active_task && current.active_task.name === name) {
        current.active_task = {
          name: '',
          title: '',
          status: '',
          path: '',
          updated_at: ''
        };
      }
    });

    return {
      resolved: true,
      task: readTask(name)
    };
  }

  function listTaskContext(name, channel) {
    const task = readTask(name);
    if (!channel || channel === 'all') {
      return {
        task: {
          name: task.name,
          title: task.title,
          status: task.status
        },
        context: task.context
      };
    }

    const normalized = ensureContextChannel(channel);
    return {
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      },
      channel: normalized,
      entries: task.context[normalized]
    };
  }

  function addTaskContext(rest) {
    const parsed = parseTaskContextArgs(rest);
    const task = readTask(parsed.name);
    const contextPath = getTaskContextPath(parsed.name, parsed.channel);
    const existing = readJsonl(contextPath);
    const fullPath = path.join(resolveProjectRoot(), parsed.targetPath);
    const entry = {
      kind: fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory() ? 'directory' : 'file',
      path: parsed.targetPath,
      reason: parsed.reason
    };
    const next = uniqueContextEntries([entry, ...existing]);
    writeJsonl(contextPath, next);

    const manifest = runtime.readJson(getTaskManifestPath(parsed.name));
    manifest.updated_at = new Date().toISOString();
    writeTask(parsed.name, manifest);

    updateSession(current => {
      current.last_command = 'task context add';
    });

    return {
      updated: true,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      },
      channel: parsed.channel,
      entries: next
    };
  }

  function getActiveTask() {
    const session = loadSession();
    if (!session.active_task || !session.active_task.name) {
      return null;
    }

    try {
      return readTask(session.active_task.name);
    } catch {
      return null;
    }
  }

  function handleTaskCommands(cmd, subcmd, rest) {
    if (cmd !== 'task') {
      return undefined;
    }

    if (!subcmd || subcmd === 'list') {
      return listTasks();
    }

    if (subcmd === 'add') {
      return createTask(rest);
    }

    if (subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing task name');
      return showTask(rest[0]);
    }

    if (subcmd === 'activate') {
      if (!rest[0]) throw new Error('Missing task name');
      return activateTask(rest[0]);
    }

    if (subcmd === 'resolve') {
      if (!rest[0]) throw new Error('Missing task name');
      return resolveTask(rest[0], rest.slice(1));
    }

    if (subcmd === 'context' && (rest[0] === 'list' || rest[0] === 'show')) {
      if (!rest[1]) throw new Error('Missing task name');
      return listTaskContext(rest[1], rest[2] || 'all');
    }

    if (subcmd === 'context' && rest[0] === 'add') {
      return addTaskContext(rest.slice(1));
    }

    throw new Error(`Unknown task subcommand: ${subcmd}`);
  }

  return {
    getTasksDir,
    getActiveTask,
    handleTaskCommands
  };
}

module.exports = {
  createTaskCommandHelpers
};
