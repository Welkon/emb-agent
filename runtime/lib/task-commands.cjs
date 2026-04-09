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
  const TASK_STATUSES = ['planning', 'in_progress', 'review', 'completed', 'rejected'];
  const TASK_DEV_TYPES = ['backend', 'frontend', 'fullstack', 'test', 'docs', 'embedded'];
  const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
  const DEFAULT_TASK_PHASES = [
    { phase: 1, action: 'implement' },
    { phase: 2, action: 'check' },
    { phase: 3, action: 'finish' },
    { phase: 4, action: 'create-pr' }
  ];

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

  function normalizeTaskStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return 'planning';
    }
    if (normalized === 'open') {
      return 'planning';
    }
    if (normalized === 'resolved') {
      return 'completed';
    }
    if (TASK_STATUSES.includes(normalized)) {
      return normalized;
    }
    if (normalized === 'in-progress') {
      return 'in_progress';
    }
    if (normalized === 'in progress') {
      return 'in_progress';
    }
    return 'planning';
  }

  function normalizeTaskDevType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return 'embedded';
    }
    if (!TASK_DEV_TYPES.includes(normalized)) {
      throw new Error(`Unsupported task dev type: ${value}`);
    }
    return normalized;
  }

  function normalizeTaskPriority(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) {
      return 'P2';
    }
    if (!TASK_PRIORITIES.includes(normalized)) {
      throw new Error(`Unsupported task priority: ${value}`);
    }
    return normalized;
  }

  function deriveCurrentPhase(status) {
    const normalized = normalizeTaskStatus(status);
    if (normalized === 'planning' || normalized === 'in_progress') {
      return 1;
    }
    if (normalized === 'review') {
      return 2;
    }
    return 4;
  }

  function buildTaskId(timestamp, slug) {
    const date = String(timestamp || new Date().toISOString()).slice(5, 10);
    return `${date.replace('-', '-')}-${slug}`;
  }

  function updateTaskTimestamps(manifest) {
    const now = new Date().toISOString();
    return {
      ...manifest,
      updatedAt: now,
      updated_at: now
    };
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
      summary: '',
      description: '',
      devType: 'embedded',
      scope: '',
      priority: 'P2',
      creator: '',
      assignee: '',
      branch: '',
      baseBranch: 'main',
      worktreePath: '',
      notes: ''
    };
    const summaryParts = [];

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === '--type') {
        result.type = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--description') {
        result.description = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--dev-type') {
        result.devType = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--scope') {
        result.scope = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--priority') {
        result.priority = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--creator') {
        result.creator = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--assignee') {
        result.assignee = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--branch') {
        result.branch = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--base-branch') {
        result.baseBranch = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--worktree-path') {
        result.worktreePath = rest[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--note') {
        result.notes = rest[index + 1] || '';
        index += 1;
        continue;
      }
      summaryParts.push(token);
    }

    result.summary = summaryParts.join(' ').trim();
    if (!result.summary) {
      throw new Error('Missing task summary');
    }
    result.devType = normalizeTaskDevType(result.devType);
    result.priority = normalizeTaskPriority(result.priority);
    result.scope = normalizeTaskSlug(result.scope);
    result.baseBranch = String(result.baseBranch || '').trim() || 'main';
    result.branch = String(result.branch || '').trim();
    result.creator = String(result.creator || '').trim();
    result.assignee = String(result.assignee || '').trim();
    result.description = String(result.description || '').trim();
    result.worktreePath = String(result.worktreePath || '').trim();
    result.notes = String(result.notes || '').trim();
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
        reason: 'Hardware truth'
      },
      {
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: 'Requirement truth'
      }
    ];

    if (channel === 'implement') {
      baseEntries.push(
        {
          path: 'docs/HARDWARE-LOGIC.md',
          reason: 'Hardware logic notes'
        },
        {
          path: 'docs/DEBUG-NOTES.md',
          reason: 'Debug notes'
        }
      );
    }

    if (channel === 'debug') {
      baseEntries.push({
        path: 'docs/DEBUG-NOTES.md',
        reason: 'Debug notes'
      });
    }

    if (session.active_thread && session.active_thread.path) {
      baseEntries.push({
        path: session.active_thread.path,
        reason: 'Current active thread'
      });
    }

    if (session.active_workspace && session.active_workspace.path) {
      baseEntries.push({
        path: session.active_workspace.path,
        reason: 'Current active workspace'
      });
    }

    (session.last_files || []).forEach(item => {
      baseEntries.push({
        path: item,
        reason: 'Recently related files'
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
          reason: `Linked document markdown: ${doc.doc_id}`
        });
      }
      if (doc.hardware_facts && (channel === 'implement' || channel === 'check')) {
        entries.push({
          path: doc.hardware_facts,
          reason: `Linked hardware draft: ${doc.doc_id}`
        });
      }
      if (doc.requirements_facts && channel === 'check') {
        entries.push({
          path: doc.requirements_facts,
          reason: `Linked requirement draft: ${doc.doc_id}`
        });
      }
    });

    return uniqueContextEntries(entries);
  }

  function buildTaskManifest(name, summary, type, session, bindings) {
    const now = new Date().toISOString();
    const parsedSummary = typeof summary === 'object' && summary !== null ? summary : { summary };
    const title = String(parsedSummary.summary || summary || '');
    const projectConfig = getProjectConfig ? getProjectConfig() : {};
    const projectDeveloper =
      projectConfig && projectConfig.developer && typeof projectConfig.developer === 'object'
        ? projectConfig.developer
        : {};
    const creator = parsedSummary.creator || projectDeveloper.name || '';
    const assignee = parsedSummary.assignee || creator;
    const references = runtime.unique(session.last_files || []);
    const status = 'planning';
    const slug = String(name || normalizeTaskSlug(title));

    return {
      id: buildTaskId(now, slug),
      name: slug,
      title,
      description: parsedSummary.description || title,
      status,
      dev_type: parsedSummary.devType || 'embedded',
      scope: parsedSummary.scope || '',
      priority: parsedSummary.priority || 'P2',
      creator,
      assignee,
      createdAt: now,
      completedAt: null,
      branch: parsedSummary.branch || '',
      base_branch: parsedSummary.baseBranch || 'main',
      worktree_path: parsedSummary.worktreePath || null,
      current_phase: deriveCurrentPhase(status),
      next_action: DEFAULT_TASK_PHASES.map(item => ({ ...item })),
      commit: '',
      pr_url: '',
      subtasks: [],
      relatedFiles: references.slice(),
      notes: parsedSummary.notes || '',
      type,
      goal: title,
      focus: session.focus || '',
      references,
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
          path.relative(resolveProjectRoot(), getTaskContextPath(slug, channel))
        ])
      ),
      created_at: now,
      updated_at: now,
      updatedAt: now
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

    const status = normalizeTaskStatus(manifest.status || 'planning');
    const updatedAt = String(manifest.updatedAt || manifest.updated_at || manifest.createdAt || manifest.created_at || '');
    const createdAt = String(manifest.createdAt || manifest.created_at || '');
    const relatedFiles = Array.isArray(manifest.relatedFiles)
      ? manifest.relatedFiles
      : (Array.isArray(manifest.references) ? manifest.references : []);

    return {
      name: String(manifest.name || name),
      title: String(manifest.title || manifest.goal || name),
      id: String(manifest.id || buildTaskId(createdAt || new Date().toISOString(), String(manifest.name || name))),
      description: String(manifest.description || manifest.goal || manifest.title || ''),
      status,
      dev_type: normalizeTaskDevType(manifest.dev_type || 'embedded'),
      scope: String(manifest.scope || ''),
      priority: normalizeTaskPriority(manifest.priority || 'P2'),
      creator: String(manifest.creator || ''),
      assignee: String(manifest.assignee || ''),
      createdAt,
      completedAt: manifest.completedAt === null ? null : String(manifest.completedAt || ''),
      branch: String(manifest.branch || ''),
      base_branch: String(manifest.base_branch || 'main'),
      worktree_path: manifest.worktree_path ? String(manifest.worktree_path) : null,
      current_phase: Number(manifest.current_phase || deriveCurrentPhase(status)),
      next_action: Array.isArray(manifest.next_action) ? manifest.next_action : DEFAULT_TASK_PHASES.map(item => ({ ...item })),
      commit: String(manifest.commit || ''),
      pr_url: String(manifest.pr_url || ''),
      subtasks: Array.isArray(manifest.subtasks) ? manifest.subtasks : [],
      relatedFiles,
      notes: String(manifest.notes || manifest.resolution_note || ''),
      type: String(manifest.type || 'implement'),
      goal: String(manifest.goal || manifest.title || ''),
      focus: String(manifest.focus || ''),
      references: Array.isArray(manifest.references) ? manifest.references : relatedFiles,
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
      created_at: String(manifest.created_at || createdAt),
      updated_at: updatedAt,
      path: path.relative(process.cwd(), manifestPath),
      context
    };
  }

  function listTasks() {
    ensureTasksDir();
    const tasks = fs.readdirSync(getTasksDir())
      .filter(name => fs.existsSync(getTaskManifestPath(name)))
      .map(name => readTask(name))
      .sort((left, right) => String(right.updated_at || right.updatedAt || '').localeCompare(String(left.updated_at || left.updatedAt || '')));

    return { tasks };
  }

  function createTask(rest) {
    const parsed = parseTaskAddArgs(rest);
    const session = loadSession();
    const name = buildUniqueTaskSlug(parsed.summary);
    const bindings = buildTaskBindings(parsed.summary);
    const manifest = buildTaskManifest(name, parsed, parsed.type, session, bindings);

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
    writeTask(name, updateTaskTimestamps({
      ...manifest,
      status: 'in_progress',
      current_phase: 1
    }));

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
        status: 'in_progress',
        path: task.path,
        updated_at: new Date().toISOString()
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
    writeTask(name, updateTaskTimestamps({
      ...manifest,
      status: 'completed',
      current_phase: 4,
      completedAt: new Date().toISOString(),
      notes: note || manifest.notes || '',
      resolution_note: note || manifest.resolution_note || ''
    }));

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
    writeTask(parsed.name, updateTaskTimestamps(manifest));

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
