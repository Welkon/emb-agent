'use strict';

function createThreadCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    resolveProjectRoot,
    getProjectExtDir,
    loadSession,
    updateSession,
    requireRestText
  } = deps;

  function getThreadsDir() {
    return path.join(getProjectExtDir(), 'threads');
  }

  function ensureThreadsDir() {
    runtime.ensureDir(getThreadsDir());
  }

  function normalizeThreadSlug(text) {
    const slug = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    return slug || `thread-${Date.now()}`;
  }

  function buildUniqueThreadSlug(summary) {
    ensureThreadsDir();
    const base = normalizeThreadSlug(summary);
    let next = base;
    let index = 2;

    while (fs.existsSync(path.join(getThreadsDir(), `${next}.md`))) {
      next = `${base}-${index}`;
      index += 1;
    }

    return next;
  }

  function getThreadPath(name) {
    return path.join(getThreadsDir(), `${name}.md`);
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildThreadFile(summary, session) {
    const now = new Date().toISOString();
    const references = (session.last_files || []).length > 0
      ? (session.last_files || []).map(item => `- ${item}`)
      : ['- *(待补充相关文件、文档或 issue)*'];
    const nextSteps = [];

    if (session.open_questions && session.open_questions.length > 0) {
      nextSteps.push(`- 先回答未决问题：${session.open_questions[0]}`);
    } else if (session.known_risks && session.known_risks.length > 0) {
      nextSteps.push(`- 先收敛风险：${session.known_risks[0]}`);
    } else {
      nextSteps.push('- 先补最小事实，再决定是否进入 scan / debug / review');
    }

    const contextLines = [
      `Created: ${now}`,
      `Project: ${resolveProjectRoot()}`,
      `Focus: ${session.focus || '(empty)'}`,
      `Last Command: ${session.last_command || '(empty)'}`,
      '',
      '### Session Snapshot',
      `- profile: ${session.project_profile || ''}`,
      `- packs: ${(session.active_packs || []).join(', ') || '(none)'}`,
      `- open_questions: ${(session.open_questions || []).join(' | ') || '(none)'}`,
      `- known_risks: ${(session.known_risks || []).join(' | ') || '(none)'}`
    ];

    return [
      `# Thread: ${summary}`,
      '',
      '## Status',
      'OPEN',
      '',
      '## Goal',
      summary,
      '',
      '## Context',
      ...contextLines,
      '',
      '## References',
      ...references,
      '',
      '## Next Steps',
      ...nextSteps,
      ''
    ].join('\n');
  }

  function readThread(name) {
    const filePath = getThreadPath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Thread not found: ${name}`);
    }

    const content = runtime.readText(filePath);
    const titleMatch = content.match(/^# Thread:\s+(.+)$/m);
    const statusMatch = content.match(/^## Status\s+([\s\S]*?)(?=\n## |\n?$)/m);

    return {
      name,
      title: titleMatch ? titleMatch[1].trim() : name,
      status: statusMatch ? statusMatch[1].trim().split(/\r?\n/)[0].trim() : 'OPEN',
      path: path.relative(process.cwd(), filePath),
      updated_at: fs.statSync(filePath).mtime.toISOString(),
      content
    };
  }

  function listThreads() {
    ensureThreadsDir();

    const threads = fs.readdirSync(getThreadsDir())
      .filter(name => name.endsWith('.md'))
      .map(name => readThread(name.replace(/\.md$/, '')))
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));

    return { threads };
  }

  function writeThread(name, content) {
    ensureThreadsDir();
    fs.writeFileSync(getThreadPath(name), content, 'utf8');
  }

  function replaceThreadSection(content, sectionName, nextBody) {
    const pattern = new RegExp(`(## ${escapeRegExp(sectionName)}\\s+)([\\s\\S]*?)(?=\\n## |$)`, 'm');

    if (!pattern.test(content)) {
      return content;
    }

    return content.replace(pattern, (_match, prefix) => `${prefix}${String(nextBody || '').trim()}\n`);
  }

  function appendThreadContext(content, note) {
    const current = readThreadSection(content, 'Context');
    const next = [
      current.trim(),
      '',
      `- ${new Date().toISOString()}: ${note}`
    ].filter(Boolean).join('\n');

    return replaceThreadSection(content, 'Context', next);
  }

  function readThreadSection(content, sectionName) {
    const match = String(content || '').match(
      new RegExp(`## ${escapeRegExp(sectionName)}\\s+([\\s\\S]*?)(?=\\n## |$)`, 'm')
    );

    return match ? match[1].trimEnd() : '';
  }

  function addThread(rest) {
    const summary = requireRestText(rest, 'thread summary');
    const session = loadSession();
    const name = buildUniqueThreadSlug(summary);
    writeThread(name, buildThreadFile(summary, session));
    const thread = readThread(name);

    updateSession(current => {
      current.last_command = 'thread add';
    });

    return {
      created: true,
      thread
    };
  }

  function showThread(name) {
    const thread = readThread(name);

    updateSession(current => {
      current.last_command = 'thread show';
    });

    return {
      thread
    };
  }

  function resumeThread(name) {
    const thread = readThread(name);
    let content = thread.content;

    content = replaceThreadSection(content, 'Status', 'IN_PROGRESS');
    writeThread(name, content);

    updateSession(current => {
      current.last_command = 'thread resume';
      current.focus = thread.title;
    });

    return {
      resumed: true,
      thread: readThread(name)
    };
  }

  function resolveThread(name, rest) {
    const note = rest.length > 0 ? rest.join(' ').trim() : '';
    let thread = readThread(name);
    let content = replaceThreadSection(thread.content, 'Status', 'RESOLVED');

    if (note) {
      content = appendThreadContext(content, `resolved: ${note}`);
    }

    writeThread(name, content);

    updateSession(current => {
      current.last_command = 'thread resolve';
    });

    thread = readThread(name);

    return {
      resolved: true,
      thread
    };
  }

  function handleThreadCommands(cmd, subcmd, rest) {
    if (cmd !== 'thread') {
      return undefined;
    }

    if (!subcmd || subcmd === 'list') {
      return listThreads();
    }

    if (subcmd === 'add') {
      return addThread(rest);
    }

    if (subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing thread name');
      return showThread(rest[0]);
    }

    if (subcmd === 'resume') {
      if (!rest[0]) throw new Error('Missing thread name');
      return resumeThread(rest[0]);
    }

    if (subcmd === 'resolve') {
      if (!rest[0]) throw new Error('Missing thread name');
      return resolveThread(rest[0], rest.slice(1));
    }

    throw new Error(`Unknown thread subcommand: ${subcmd}`);
  }

  return {
    getThreadsDir,
    listThreads,
    readThread,
    handleThreadCommands
  };
}

module.exports = {
  createThreadCommandHelpers
};
