'use strict';

function createWorkspaceCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    getProjectExtDir,
    loadSession,
    updateSession
  } = deps;

  const WORKSPACE_TYPES = ['subsystem', 'board', 'flow', 'domain'];
  const WORKSPACE_LINK_TYPES = {
    task: 'tasks',
    spec: 'specs',
    thread: 'threads'
  };

  function getWorkspaceRootDir() {
    return path.join(getProjectExtDir(), 'workspace');
  }

  function ensureWorkspaceRootDir() {
    runtime.ensureDir(getWorkspaceRootDir());
  }

  function normalizeWorkspaceSlug(text) {
    const slug = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    return slug || `workspace-${Date.now()}`;
  }

  function buildUniqueWorkspaceSlug(summary) {
    ensureWorkspaceRootDir();
    const base = normalizeWorkspaceSlug(summary);
    let next = base;
    let index = 2;

    while (fs.existsSync(getWorkspaceDir(next))) {
      next = `${base}-${index}`;
      index += 1;
    }

    return next;
  }

  function getWorkspaceDir(name) {
    return path.join(getWorkspaceRootDir(), name);
  }

  function getWorkspaceManifestPath(name) {
    return path.join(getWorkspaceDir(name), 'workspace.json');
  }

  function getWorkspaceNotesPath(name) {
    return path.join(getWorkspaceDir(name), 'notes.md');
  }

  function parseType(value) {
    const type = String(value || 'subsystem').trim().toLowerCase();
    if (!WORKSPACE_TYPES.includes(type)) {
      throw new Error(`Workspace type must be one of: ${WORKSPACE_TYPES.join(', ')}`);
    }
    return type;
  }

  function parseWorkspaceAddArgs(rest) {
    const result = {
      type: 'subsystem',
      summary: ''
    };
    const summaryParts = [];

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === '--type') {
        result.type = parseType(rest[index + 1] || '');
        index += 1;
        continue;
      }
      summaryParts.push(token);
    }

    result.summary = summaryParts.join(' ').trim();
    if (!result.summary) {
      throw new Error('Missing workspace summary');
    }

    return result;
  }

  function parseWorkspaceLinkArgs(rest) {
    const workspaceName = String(rest[0] || '').trim();
    const linkType = String(rest[1] || '').trim().toLowerCase();
    const targetName = String(rest[2] || '').trim();

    if (!workspaceName) {
      throw new Error('Missing workspace name');
    }
    if (!targetName) {
      throw new Error('Missing linked target name');
    }
    if (!Object.prototype.hasOwnProperty.call(WORKSPACE_LINK_TYPES, linkType)) {
      throw new Error('Workspace link type must be one of: task, spec, thread');
    }

    return {
      workspaceName,
      linkType,
      targetName
    };
  }

  function normalizeLinkEntry(kind, entry) {
    return {
      kind,
      name: String((entry && entry.name) || '').trim(),
      title: String((entry && entry.title) || '').trim(),
      path: runtime.normalizeProjectRelativePath(String((entry && entry.path) || '').trim()),
      status: String((entry && entry.status) || '').trim(),
      type: String((entry && entry.type) || '').trim()
    };
  }

  function uniqueLinkEntries(kind, entries) {
    const map = new Map();
    (entries || [])
      .map(entry => normalizeLinkEntry(kind, entry))
      .filter(entry => entry.name)
      .forEach(entry => {
        if (!map.has(entry.name)) {
          map.set(entry.name, entry);
        }
      });
    return [...map.values()];
  }

  function normalizeWorkspaceLinks(value) {
    const source = (!value || typeof value !== 'object' || Array.isArray(value)) ? {} : value;
    return {
      tasks: uniqueLinkEntries('task', source.tasks || []),
      specs: uniqueLinkEntries('spec', source.specs || []),
      threads: uniqueLinkEntries('thread', source.threads || [])
    };
  }

  function normalizeWorkspaceSnapshot(value) {
    const source = (!value || typeof value !== 'object' || Array.isArray(value)) ? {} : value;
    return {
      last_files: runtime.unique((source.last_files || []).map(item => runtime.normalizeProjectRelativePath(item))).filter(Boolean),
      open_questions: runtime.unique((source.open_questions || []).map(item => String(item || '').trim())).filter(Boolean),
      known_risks: runtime.unique((source.known_risks || []).map(item => String(item || '').trim())).filter(Boolean),
      refreshed_at: String(source.refreshed_at || '').trim()
    };
  }

  function buildWorkspaceRefreshMeta(sourceWorkspace) {
    const workspace = sourceWorkspace || {};
    const snapshot = normalizeWorkspaceSnapshot(workspace.snapshot || {});
    const links = normalizeWorkspaceLinks(workspace.links || {});

    return {
      has_snapshot: snapshot.refreshed_at !== '',
      refreshed_at: snapshot.refreshed_at || '',
      last_files_count: snapshot.last_files.length,
      open_questions_count: snapshot.open_questions.length,
      known_risks_count: snapshot.known_risks.length,
      linked_tasks: links.tasks.length,
      linked_specs: links.specs.length,
      linked_threads: links.threads.length
    };
  }

  function buildWorkspaceManifest(name, summary, type) {
    const now = new Date().toISOString();
    return {
      name,
      title: summary,
      type,
      status: 'OPEN',
      manifest_path: runtime.getProjectAssetRelativePath('workspace', name, 'workspace.json'),
      notes_path: runtime.getProjectAssetRelativePath('workspace', name, 'notes.md'),
      links: {
        tasks: [],
        specs: [],
        threads: []
      },
      snapshot: {
        last_files: [],
        open_questions: [],
        known_risks: [],
        refreshed_at: ''
      },
      created_at: now,
      updated_at: now
    };
  }

  function buildWorkspaceNotes(title, type, createdAt) {
    return [
      `# Workspace: ${title}`,
      `Type: ${type}`,
      `Created: ${createdAt}`,
      'Status: OPEN',
      '',
      '## Goal',
      '- ',
      '',
      '## Scope',
      '- ',
      '',
      '## Linked Tasks',
      '- (none)',
      '',
      '## Linked Specs',
      '- (none)',
      '',
      '## Linked Threads',
      '- (none)',
      '',
      '## Key Files',
      '- ',
      '',
      '## Current Questions',
      '- ',
      '',
      '## Known Risks',
      '- ',
      '',
      '## Notes',
      '- ',
      ''
    ].join('\n');
  }

  function writeWorkspaceFiles(name, manifest, notes) {
    runtime.ensureDir(getWorkspaceDir(name));
    runtime.writeJson(getWorkspaceManifestPath(name), manifest);
    fs.writeFileSync(getWorkspaceNotesPath(name), notes, 'utf8');
  }

  function updateWorkspaceNotesStatus(name, status) {
    const notesPath = getWorkspaceNotesPath(name);
    if (!fs.existsSync(notesPath)) {
      return;
    }

    const content = runtime.readText(notesPath);
    const nextContent = content.replace(/^Status:\s+.*$/m, `Status: ${status}`);
    fs.writeFileSync(notesPath, nextContent, 'utf8');
  }

  function readWorkspaceNotes(name) {
    const notesPath = getWorkspaceNotesPath(name);
    return fs.existsSync(notesPath) ? runtime.readText(notesPath) : '';
  }

  function replaceWorkspaceNotesSection(content, sectionName, nextBody) {
    const pattern = new RegExp(`(## ${sectionName}\\s+)([\\s\\S]*?)(?=\\n## |$)`, 'm');
    if (pattern.test(content)) {
      return content.replace(pattern, (_match, prefix) => `${prefix}${String(nextBody || '').trim()}\n`);
    }

    const trimmed = String(content || '').replace(/\s*$/, '');
    return `${trimmed}\n\n## ${sectionName}\n${String(nextBody || '').trim()}\n`;
  }

  function formatWorkspaceLinkSection(entries) {
    if (!entries || entries.length === 0) {
      return '- (none)';
    }

    return entries.map(entry => {
      const suffix = entry.type
        ? ` | ${entry.type}`
        : entry.status
          ? ` | ${entry.status}`
          : '';
      return `- ${entry.name}: ${entry.title || entry.name}${suffix}`;
    }).join('\n');
  }

  function formatWorkspaceTextList(entries) {
    if (!entries || entries.length === 0) {
      return '- (none)';
    }

    return entries.map(entry => `- ${entry}`).join('\n');
  }

  function syncWorkspaceNotes(name, links, snapshot) {
    const notesPath = getWorkspaceNotesPath(name);
    if (!fs.existsSync(notesPath)) {
      return;
    }

    let content = readWorkspaceNotes(name);
    content = replaceWorkspaceNotesSection(content, 'Linked Tasks', formatWorkspaceLinkSection(links.tasks));
    content = replaceWorkspaceNotesSection(content, 'Linked Specs', formatWorkspaceLinkSection(links.specs));
    content = replaceWorkspaceNotesSection(content, 'Linked Threads', formatWorkspaceLinkSection(links.threads));
    content = replaceWorkspaceNotesSection(
      content,
      'Key Files',
      formatWorkspaceTextList((snapshot && snapshot.last_files) || [])
    );
    content = replaceWorkspaceNotesSection(
      content,
      'Current Questions',
      formatWorkspaceTextList((snapshot && snapshot.open_questions) || [])
    );
    content = replaceWorkspaceNotesSection(
      content,
      'Known Risks',
      formatWorkspaceTextList((snapshot && snapshot.known_risks) || [])
    );
    fs.writeFileSync(notesPath, content, 'utf8');
  }

  function getTasksDir() {
    return path.join(getProjectExtDir(), 'tasks');
  }

  function getSpecsDir() {
    return path.join(getProjectExtDir(), 'specs');
  }

  function getThreadsDir() {
    return path.join(getProjectExtDir(), 'threads');
  }

  function resolveLinkTarget(linkType, targetName) {
    if (linkType === 'task') {
      const filePath = path.join(getTasksDir(), targetName, 'task.json');
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task not found: ${targetName}`);
      }
      const manifest = runtime.readJson(filePath);
      return {
        kind: 'task',
        name: targetName,
        title: String(manifest.title || manifest.goal || targetName),
        type: String(manifest.type || ''),
        status: String(manifest.status || ''),
        path: runtime.getProjectAssetRelativePath('tasks', targetName, 'task.json')
      };
    }

    if (linkType === 'spec') {
      const filePath = path.join(getSpecsDir(), `${targetName}.md`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Spec not found: ${targetName}`);
      }
      const lines = runtime.readText(filePath).split(/\r?\n/);
      const titleLine = lines.find(line => line.startsWith('# Spec: ')) || '';
      const typeLine = lines.find(line => line.startsWith('Type: ')) || '';
      return {
        kind: 'spec',
        name: targetName,
        title: titleLine ? titleLine.slice('# Spec: '.length).trim() : targetName,
        type: typeLine ? typeLine.slice('Type: '.length).trim() : '',
        status: '',
        path: runtime.getProjectAssetRelativePath('specs', `${targetName}.md`)
      };
    }

    const filePath = path.join(getThreadsDir(), `${targetName}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Thread not found: ${targetName}`);
    }
    const content = runtime.readText(filePath);
    const titleMatch = content.match(/^# Thread:\s+(.+)$/m);
    const statusMatch = content.match(/^## Status\s+([\s\S]*?)(?=\n## |\n?$)/m);
    return {
      kind: 'thread',
      name: targetName,
      title: titleMatch ? titleMatch[1].trim() : targetName,
      type: '',
      status: statusMatch ? statusMatch[1].trim().split(/\r?\n/)[0].trim() : '',
      path: runtime.getProjectAssetRelativePath('threads', `${targetName}.md`)
    };
  }

  function readWorkspace(name) {
    const manifestPath = getWorkspaceManifestPath(name);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Workspace not found: ${name}`);
    }

    const manifest = runtime.readJson(manifestPath);
    const notesPath = getWorkspaceNotesPath(name);
    const notes = fs.existsSync(notesPath) ? runtime.readText(notesPath) : '';
    const links = normalizeWorkspaceLinks(manifest.links || {});
    const snapshot = normalizeWorkspaceSnapshot(manifest.snapshot || {});

    return {
      name: String(manifest.name || name),
      title: String(manifest.title || name),
      type: String(manifest.type || 'subsystem'),
      status: String(manifest.status || 'OPEN'),
      path: String(manifest.notes_path || runtime.getProjectAssetRelativePath('workspace', name, 'notes.md')),
      manifest_path: String(
        manifest.manifest_path || runtime.getProjectAssetRelativePath('workspace', name, 'workspace.json')
      ),
      notes_path: String(
        manifest.notes_path || runtime.getProjectAssetRelativePath('workspace', name, 'notes.md')
      ),
      links,
      link_counts: {
        tasks: links.tasks.length,
        specs: links.specs.length,
        threads: links.threads.length
      },
      snapshot,
      refresh: buildWorkspaceRefreshMeta({
        links,
        snapshot
      }),
      created_at: String(manifest.created_at || ''),
      updated_at: String(manifest.updated_at || ''),
      notes
    };
  }

  function listWorkspaces() {
    ensureWorkspaceRootDir();

    const workspaces = fs.readdirSync(getWorkspaceRootDir())
      .filter(name => fs.existsSync(getWorkspaceManifestPath(name)))
      .map(name => readWorkspace(name))
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));

    return { workspaces };
  }

  function addWorkspace(rest) {
    const parsed = parseWorkspaceAddArgs(rest);
    const name = buildUniqueWorkspaceSlug(parsed.summary);
    const manifest = buildWorkspaceManifest(name, parsed.summary, parsed.type);
    const notes = buildWorkspaceNotes(parsed.summary, parsed.type, manifest.created_at);

    writeWorkspaceFiles(name, manifest, notes);

    updateSession(current => {
      current.last_command = 'workspace add';
    });

    return {
      created: true,
      workspace: readWorkspace(name)
    };
  }

  function showWorkspace(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing workspace name');
    }

    const workspace = readWorkspace(normalized);
    updateSession(current => {
      current.last_command = 'workspace show';
    });

    return { workspace };
  }

  function writeWorkspaceManifest(name, manifest) {
    runtime.writeJson(getWorkspaceManifestPath(name), manifest);
  }

  function deactivatePreviousWorkspace(session, nextName) {
    const previous = session && session.active_workspace ? session.active_workspace : null;
    if (!previous || !previous.name || previous.name === nextName) {
      return;
    }

    const manifestPath = getWorkspaceManifestPath(previous.name);
    if (!fs.existsSync(manifestPath)) {
      return;
    }

    const manifest = runtime.readJson(manifestPath);
    manifest.status = 'OPEN';
    manifest.updated_at = new Date().toISOString();
    writeWorkspaceManifest(previous.name, manifest);
    updateWorkspaceNotesStatus(previous.name, 'OPEN');
  }

  function activateWorkspace(name) {
    const workspace = readWorkspace(name);
    const session = loadSession();

    deactivatePreviousWorkspace(session, name);

    const manifest = runtime.readJson(getWorkspaceManifestPath(name));
    manifest.status = 'ACTIVE';
    manifest.updated_at = new Date().toISOString();
    writeWorkspaceManifest(name, manifest);
    updateWorkspaceNotesStatus(name, 'ACTIVE');
    const links = normalizeWorkspaceLinks(manifest.links || {});

    updateSession(current => {
      current.last_command = 'workspace activate';
      current.focus = workspace.title;
      current.last_files = runtime
        .unique([
          workspace.notes_path,
          workspace.manifest_path,
          ...links.tasks.map(item => item.path),
          ...links.specs.map(item => item.path),
          ...links.threads.map(item => item.path),
          ...(current.last_files || [])
        ])
        .slice(0, 12);
      current.active_workspace = {
        name: workspace.name,
        title: workspace.title,
        type: workspace.type,
        status: 'ACTIVE',
        path: workspace.notes_path,
        updated_at: manifest.updated_at
      };
    });

    return {
      activated: true,
      workspace: readWorkspace(name)
    };
  }

  function linkWorkspace(rest) {
    const parsed = parseWorkspaceLinkArgs(rest);
    const manifest = runtime.readJson(getWorkspaceManifestPath(parsed.workspaceName));
    const links = normalizeWorkspaceLinks(manifest.links || {});
    const bucket = WORKSPACE_LINK_TYPES[parsed.linkType];
    const target = resolveLinkTarget(parsed.linkType, parsed.targetName);

    links[bucket] = uniqueLinkEntries(parsed.linkType, [...links[bucket], target]);
    manifest.links = links;
    manifest.updated_at = new Date().toISOString();
    writeWorkspaceManifest(parsed.workspaceName, manifest);
    syncWorkspaceNotes(parsed.workspaceName, links, normalizeWorkspaceSnapshot(manifest.snapshot || {}));

    updateSession(current => {
      current.last_command = 'workspace link';
      current.last_files = runtime
        .unique([
          target.path,
          runtime.getProjectAssetRelativePath('workspace', parsed.workspaceName, 'notes.md'),
          ...(current.last_files || [])
        ])
        .map(item => runtime.normalizeProjectRelativePath(item))
        .slice(0, 12);
      if (current.active_workspace && current.active_workspace.name === parsed.workspaceName) {
        current.active_workspace.updated_at = manifest.updated_at;
      }
    });

    return {
      linked: true,
      workspace: readWorkspace(parsed.workspaceName),
      link: target
    };
  }

  function unlinkWorkspace(rest) {
    const parsed = parseWorkspaceLinkArgs(rest);
    const manifest = runtime.readJson(getWorkspaceManifestPath(parsed.workspaceName));
    const links = normalizeWorkspaceLinks(manifest.links || {});
    const bucket = WORKSPACE_LINK_TYPES[parsed.linkType];
    const before = links[bucket].length;

    links[bucket] = links[bucket].filter(entry => entry.name !== parsed.targetName);
    if (links[bucket].length === before) {
      throw new Error(`Workspace link not found: ${parsed.linkType} ${parsed.targetName}`);
    }

    manifest.links = links;
    manifest.updated_at = new Date().toISOString();
    writeWorkspaceManifest(parsed.workspaceName, manifest);
    syncWorkspaceNotes(parsed.workspaceName, links, normalizeWorkspaceSnapshot(manifest.snapshot || {}));

    updateSession(current => {
      current.last_command = 'workspace unlink';
      if (current.active_workspace && current.active_workspace.name === parsed.workspaceName) {
        current.active_workspace.updated_at = manifest.updated_at;
      }
    });

    return {
      unlinked: true,
      workspace: readWorkspace(parsed.workspaceName),
      removed: {
        kind: parsed.linkType,
        name: parsed.targetName
      }
    };
  }

  function inferLinkTargetsFromSession(session) {
    const inferred = {
      tasks: [],
      specs: [],
      threads: []
    };

    if (session.active_task && session.active_task.name) {
      try {
        inferred.tasks.push(resolveLinkTarget('task', session.active_task.name));
      } catch {}
    }

    if (session.active_thread && session.active_thread.name) {
      try {
        inferred.threads.push(resolveLinkTarget('thread', session.active_thread.name));
      } catch {}
    }

    (session.last_files || []).forEach(item => {
      const normalized = runtime.normalizeProjectRelativePath(item);
      let match = normalized.match(/^\.emb-agent\/tasks\/([^/]+)\//);
      if (match) {
        try {
          inferred.tasks.push(resolveLinkTarget('task', match[1]));
        } catch {}
        return;
      }

      match = normalized.match(/^\.emb-agent\/specs\/([^/]+)\.md$/);
      if (match) {
        try {
          inferred.specs.push(resolveLinkTarget('spec', match[1]));
        } catch {}
        return;
      }

      match = normalized.match(/^\.emb-agent\/threads\/([^/]+)\.md$/);
      if (match) {
        try {
          inferred.threads.push(resolveLinkTarget('thread', match[1]));
        } catch {}
      }
    });

    inferred.tasks = uniqueLinkEntries('task', inferred.tasks);
    inferred.specs = uniqueLinkEntries('spec', inferred.specs);
    inferred.threads = uniqueLinkEntries('thread', inferred.threads);

    return inferred;
  }

  function refreshWorkspace(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing workspace name');
    }

    const session = loadSession();
    const manifest = runtime.readJson(getWorkspaceManifestPath(normalized));
    const currentLinks = normalizeWorkspaceLinks(manifest.links || {});
    const inferred = inferLinkTargetsFromSession(session);
    const nextLinks = {
      tasks: uniqueLinkEntries('task', [...currentLinks.tasks, ...inferred.tasks]),
      specs: uniqueLinkEntries('spec', [...currentLinks.specs, ...inferred.specs]),
      threads: uniqueLinkEntries('thread', [...currentLinks.threads, ...inferred.threads])
    };
    const snapshot = normalizeWorkspaceSnapshot({
      last_files: session.last_files || [],
      open_questions: session.open_questions || [],
      known_risks: session.known_risks || [],
      refreshed_at: new Date().toISOString()
    });

    manifest.links = nextLinks;
    manifest.snapshot = snapshot;
    manifest.updated_at = snapshot.refreshed_at;
    writeWorkspaceManifest(normalized, manifest);
    syncWorkspaceNotes(normalized, nextLinks, snapshot);

    const added = {
      tasks: nextLinks.tasks.filter(item => !currentLinks.tasks.some(prev => prev.name === item.name)),
      specs: nextLinks.specs.filter(item => !currentLinks.specs.some(prev => prev.name === item.name)),
      threads: nextLinks.threads.filter(item => !currentLinks.threads.some(prev => prev.name === item.name))
    };

    updateSession(current => {
      current.last_command = 'workspace refresh';
      current.last_files = runtime
        .unique([
          runtime.getProjectAssetRelativePath('workspace', normalized, 'notes.md'),
          runtime.getProjectAssetRelativePath('workspace', normalized, 'workspace.json'),
          ...snapshot.last_files,
          ...(current.last_files || [])
        ])
        .map(item => runtime.normalizeProjectRelativePath(item))
        .slice(0, 12);
      if (current.active_workspace && current.active_workspace.name === normalized) {
        current.active_workspace.updated_at = snapshot.refreshed_at;
      }
    });

    return {
      refreshed: true,
      workspace: readWorkspace(normalized),
      added_links: {
        tasks: added.tasks.map(item => item.name),
        specs: added.specs.map(item => item.name),
        threads: added.threads.map(item => item.name)
      },
      snapshot
    };
  }

  function getActiveWorkspace() {
    const session = loadSession();
    if (!session.active_workspace || !session.active_workspace.name) {
      return null;
    }

    try {
      return readWorkspace(session.active_workspace.name);
    } catch {
      return null;
    }
  }

  function handleWorkspaceCommands(cmd, subcmd, rest) {
    if (cmd !== 'workspace') {
      return undefined;
    }

    if (!subcmd || subcmd === 'list') {
      return listWorkspaces();
    }

    if (subcmd === 'add') {
      return addWorkspace(rest);
    }

    if (subcmd === 'show') {
      return showWorkspace(rest[0]);
    }

    if (subcmd === 'activate') {
      if (!rest[0]) throw new Error('Missing workspace name');
      return activateWorkspace(rest[0]);
    }

    if (subcmd === 'refresh') {
      return refreshWorkspace(rest[0]);
    }

    if (subcmd === 'link') {
      return linkWorkspace(rest);
    }

    if (subcmd === 'unlink') {
      return unlinkWorkspace(rest);
    }

    throw new Error(`Unknown workspace subcommand: ${subcmd}`);
  }

  return {
    listWorkspaces,
    getActiveWorkspace,
    handleWorkspaceCommands
  };
}

module.exports = {
  createWorkspaceCommandHelpers
};
