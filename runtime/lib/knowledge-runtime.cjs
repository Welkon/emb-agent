'use strict';

function createKnowledgeRuntimeHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtime,
    getProjectExtDir,
    getProjectConfig,
    updateSession,
    permissionGateHelpers
  } = deps;

  const WIKI_DIRS = ['sources', 'chips', 'peripherals', 'board', 'decisions', 'risks', 'queries'];

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  }

  function titleFromSlug(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, match => match.toUpperCase());
  }

  function getWikiDir() {
    return path.join(getProjectExtDir(), 'wiki');
  }

  function getWikiPath(...parts) {
    return path.join(getWikiDir(), ...parts);
  }

  function getWikiRelativePath(...parts) {
    return runtime.getProjectAssetRelativePath('wiki', ...parts);
  }

  function ensureKnowledgeDirs() {
    const wikiDir = getWikiDir();
    runtime.ensureDir(wikiDir);
    WIKI_DIRS.forEach(name => runtime.ensureDir(path.join(wikiDir, name)));
    return wikiDir;
  }

  function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? String(fs.readFileSync(filePath, 'utf8') || '') : '';
  }

  function extractFrontmatter(content) {
    const source = String(content || '');
    if (!source.startsWith('---\n')) {
      return {};
    }
    const end = source.indexOf('\n---', 4);
    if (end === -1) {
      return {};
    }
    const block = source.slice(4, end).split('\n');
    const out = {};
    block.forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    });
    return out;
  }

  function extractTitle(relativePath, content) {
    const frontmatter = extractFrontmatter(content);
    if (frontmatter.title) return frontmatter.title;
    const heading = String(content || '').split('\n').find(line => /^#\s+/.test(line.trim()));
    if (heading) return heading.replace(/^#\s+/, '').trim();
    return titleFromSlug(path.basename(relativePath, '.md'));
  }

  function extractSummary(content) {
    const frontmatter = extractFrontmatter(content);
    if (frontmatter.summary) return frontmatter.summary;
    const lines = String(content || '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed === '---' ||
        trimmed.startsWith('title:') ||
        trimmed.startsWith('summary:') ||
        trimmed.startsWith('tags:') ||
        trimmed.startsWith('created:') ||
        trimmed.startsWith('updated:') ||
        trimmed.startsWith('#')
      ) {
        continue;
      }
      return trimmed.replace(/^[-*]\s+/, '').slice(0, 180);
    }
    return '';
  }

  function listMarkdownPages() {
    const wikiDir = getWikiDir();
    if (!fs.existsSync(wikiDir)) {
      return [];
    }

    const pages = [];
    function walk(dirPath) {
      fs.readdirSync(dirPath, { withFileTypes: true }).forEach(entry => {
        const filePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(filePath);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          return;
        }
        const relativePath = path.relative(wikiDir, filePath).replace(/\\/g, '/');
        if (relativePath === 'index.md' || relativePath === 'log.md') {
          return;
        }
        const content = readTextIfExists(filePath);
        pages.push({
          path: relativePath,
          title: extractTitle(relativePath, content),
          summary: extractSummary(content),
          category: relativePath.includes('/') ? relativePath.split('/')[0] : 'pages'
        });
      });
    }
    walk(wikiDir);
    return pages.sort((a, b) => a.path.localeCompare(b.path));
  }

  function buildIndexMarkdown(pages) {
    const grouped = new Map();
    (pages || []).forEach(page => {
      const category = page.category || 'pages';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(page);
    });

    const lines = [
      '# Knowledge Index',
      '',
      'LLM-maintained engineering wiki for persistent source synthesis, decisions, risks, and reusable project knowledge.',
      '',
      '## Overview',
      '',
      `- Total pages: ${(pages || []).length}`,
      `- Last rebuilt: ${new Date().toISOString()}`,
      ''
    ];

    WIKI_DIRS.forEach(category => {
      const entries = grouped.get(category) || [];
      lines.push(`## ${titleFromSlug(category)}`, '');
      if (entries.length === 0) {
        lines.push('- No pages yet.', '');
        return;
      }
      entries.forEach(page => {
        const summary = page.summary ? ` - ${page.summary}` : '';
        lines.push(`- [[${page.path.replace(/\.md$/, '')}]]${summary}`);
      });
      lines.push('');
    });

    const extraCategories = [...grouped.keys()].filter(category => !WIKI_DIRS.includes(category));
    extraCategories.forEach(category => {
      lines.push(`## ${titleFromSlug(category)}`, '');
      grouped.get(category).forEach(page => {
        const summary = page.summary ? ` - ${page.summary}` : '';
        lines.push(`- [[${page.path.replace(/\.md$/, '')}]]${summary}`);
      });
      lines.push('');
    });

    return `${lines.join('\n').trim()}\n`;
  }

  function buildInitialLogMarkdown() {
    return [
      '# Knowledge Log',
      '',
      'Append-only record of emb-agent knowledge wiki maintenance.',
      '',
      `## [${new Date().toISOString().slice(0, 10)}] init | Knowledge wiki`,
      '- Initialized persistent wiki structure.',
      ''
    ].join('\n');
  }

  function writeIndex() {
    const pages = listMarkdownPages();
    const indexMarkdown = buildIndexMarkdown(pages);
    fs.writeFileSync(getWikiPath('index.md'), indexMarkdown, 'utf8');
    return {
      path: getWikiRelativePath('index.md'),
      pages,
      content: indexMarkdown
    };
  }

  function appendLog(kind, title, lines) {
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, buildInitialLogMarkdown(), 'utf8');
    }
    const entryLines = [
      '',
      `## [${new Date().toISOString().slice(0, 10)}] ${kind} | ${title}`,
      ...(lines || []).map(line => `- ${line}`),
      ''
    ];
    fs.appendFileSync(logPath, entryLines.join('\n'), 'utf8');
  }

  function initKnowledgeWiki() {
    ensureKnowledgeDirs();
    const created = [];
    const indexPath = getWikiPath('index.md');
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, buildInitialLogMarkdown(), 'utf8');
      created.push(getWikiRelativePath('log.md'));
    }
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, buildIndexMarkdown(listMarkdownPages()), 'utf8');
      created.push(getWikiRelativePath('index.md'));
    }
    WIKI_DIRS.forEach(name => {
      created.push(getWikiRelativePath(name));
    });
    updateSession(current => {
      current.last_command = 'knowledge init';
    });
    return {
      initialized: true,
      wiki_dir: getWikiRelativePath(),
      index_file: getWikiRelativePath('index.md'),
      log_file: getWikiRelativePath('log.md'),
      directories: WIKI_DIRS.map(name => getWikiRelativePath(name)),
      created: runtime.unique(created)
    };
  }

  function parseFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) return '';
    return args[index + 1] || '';
  }

  function removeFlagValue(args, flag) {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === flag) {
        i += 1;
        continue;
      }
      out.push(args[i]);
    }
    return out;
  }

  function parseKnowledgeWriteArgs(rest, defaults = {}) {
    let args = Array.isArray(rest) ? rest.slice() : [];
    const explicitConfirmation = args.includes('--confirm');
    const force = args.includes('--force');
    const kind = parseFlagValue(args, '--kind') || defaults.kind || 'query';
    const summary = parseFlagValue(args, '--summary');
    const body = parseFlagValue(args, '--body');
    const titleOverride = parseFlagValue(args, '--title');
    const links = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--link' && args[i + 1]) {
        links.push(args[i + 1]);
        i += 1;
      }
    }
    ['--kind', '--summary', '--body', '--title', '--link'].forEach(flag => {
      args = removeFlagValue(args, flag);
    });
    args = args.filter(token => token !== '--confirm' && token !== '--force');
    const title = titleOverride || args.join(' ').trim();
    return {
      title,
      kind,
      summary,
      body,
      links,
      explicit_confirmation: explicitConfirmation,
      force
    };
  }

  function normalizeKnowledgeKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (value === 'decision' || value === 'decisions') return 'decisions';
    if (value === 'risk' || value === 'risks') return 'risks';
    if (value === 'source' || value === 'sources') return 'sources';
    if (value === 'chip' || value === 'chips') return 'chips';
    if (value === 'peripheral' || value === 'peripherals') return 'peripherals';
    if (value === 'board') return 'board';
    return 'queries';
  }

  function buildKnowledgePage(parsed, source = 'query') {
    const category = normalizeKnowledgeKind(parsed.kind);
    const slug = slugify(parsed.title);
    const relativePath = `${category}/${slug}.md`;
    const title = parsed.title.trim();
    const summary = parsed.summary || `Persistent ${source} synthesis for ${title}.`;
    const linkedLines = parsed.links.length > 0
      ? parsed.links.map(item => `- [[${String(item).replace(/\.md$/, '')}]]`)
      : ['- No links recorded yet.'];
    const body = parsed.body || 'Record the durable answer, evidence, contradictions, and follow-up questions here.';
    const content = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `summary: "${summary.replace(/"/g, '\\"')}"`,
      `kind: "${category}"`,
      'status: "draft"',
      `created: "${new Date().toISOString()}"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Summary',
      '',
      summary,
      '',
      '## Synthesis',
      '',
      body,
      '',
      '## Links',
      '',
      ...linkedLines,
      '',
      '## Evidence And Gaps',
      '',
      '- Evidence: not recorded yet.',
      '- Gaps: review before promoting any claim to project truth.',
      ''
    ].join('\n');
    return {
      category,
      slug,
      relative_path: relativePath,
      display_path: getWikiRelativePath(relativePath),
      file_path: getWikiPath(relativePath),
      title,
      summary,
      content
    };
  }

  function buildConfirmationPreview(page, actionName) {
    return {
      status: 'confirmation-required',
      write_mode: 'preview',
      action: actionName,
      target: page.display_path,
      summary: page.summary,
      content: page.content,
      next_steps: [
        `Re-run with --confirm to write ${page.display_path}`
      ]
    };
  }

  function evaluateKnowledgeWritePermission(actionName, explicitConfirmation) {
    return permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: actionName,
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });
  }

  function saveKnowledgePage(parsed, actionName, logKind) {
    if (!parsed.title) {
      throw new Error('Missing knowledge title');
    }
    ensureKnowledgeDirs();
    const page = buildKnowledgePage(parsed, logKind);
    if (!parsed.explicit_confirmation) {
      return buildConfirmationPreview(page, actionName);
    }
    const permissionDecision = evaluateKnowledgeWritePermission(actionName, true);
    if (permissionDecision.decision !== 'allow') {
      return permissionGateHelpers.applyPermissionDecision(
        buildConfirmationPreview(page, actionName),
        permissionDecision
      );
    }
    if (fs.existsSync(page.file_path) && !parsed.force) {
      throw new Error(`Knowledge page already exists: ${page.display_path}. Re-run with --force to overwrite.`);
    }
    runtime.ensureDir(path.dirname(page.file_path));
    fs.writeFileSync(page.file_path, page.content, 'utf8');
    const index = writeIndex();
    appendLog(logKind, page.title, [
      `Wrote [[${page.relative_path.replace(/\.md$/, '')}]]`,
      `Updated ${index.path}`,
      'Review before promoting any claim into hw.yaml or req.yaml.'
    ]);
    updateSession(current => {
      current.last_command = `knowledge ${logKind}`;
      current.last_files = runtime.unique([
        page.display_path,
        index.path,
        getWikiRelativePath('log.md'),
        ...(current.last_files || [])
      ]).slice(0, 8);
    });
    return permissionGateHelpers.applyPermissionDecision({
      status: 'written',
      write_mode: 'confirmed-write',
      action: actionName,
      page: {
        title: page.title,
        path: page.display_path,
        summary: page.summary
      },
      index_file: index.path,
      log_file: getWikiRelativePath('log.md')
    }, permissionDecision);
  }

  function readKnowledgeIndex(options = {}) {
    const wikiDir = getWikiDir();
    if (!fs.existsSync(wikiDir)) {
      return {
        initialized: false,
        wiki_dir: getWikiRelativePath(),
        next_steps: ['knowledge init']
      };
    }
    if (options.rebuild === true) {
      const index = writeIndex();
      appendLog('lint', 'Rebuild index', [`Updated ${index.path}`]);
      return {
        initialized: true,
        rebuilt: true,
        index_file: index.path,
        pages: index.pages,
        content: index.content
      };
    }
    const indexPath = getWikiPath('index.md');
    return {
      initialized: true,
      index_file: getWikiRelativePath('index.md'),
      pages: listMarkdownPages(),
      content: readTextIfExists(indexPath)
    };
  }

  function readKnowledgeLog(rest) {
    const tailArg = parseFlagValue(rest || [], '--tail');
    const tail = tailArg ? Number(tailArg) : 20;
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      return {
        initialized: false,
        log_file: getWikiRelativePath('log.md'),
        entries: [],
        next_steps: ['knowledge init']
      };
    }
    const content = readTextIfExists(logPath);
    const entries = content
      .split('\n')
      .filter(line => /^## \[/.test(line))
      .slice(Number.isFinite(tail) && tail > 0 ? -tail : -20);
    return {
      initialized: true,
      log_file: getWikiRelativePath('log.md'),
      entries,
      content
    };
  }

  function extractWikiLinks(content) {
    const links = [];
    const wikiPattern = /\[\[([^\]]+)\]\]/g;
    const mdPattern = /\]\(([^)]+\.md)\)/g;
    let match = wikiPattern.exec(content);
    while (match) {
      links.push(match[1].replace(/\.md$/, ''));
      match = wikiPattern.exec(content);
    }
    match = mdPattern.exec(content);
    while (match) {
      links.push(match[1].replace(/^\.?\//, '').replace(/\.md$/, ''));
      match = mdPattern.exec(content);
    }
    return runtime.unique(links);
  }

  function readHardwareChipSlug() {
    const hwPath = path.join(getProjectExtDir(), 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
      return '';
    }
    const parsed = runtime.parseSimpleYaml(hwPath);
    return parsed && parsed.chip ? slugify(parsed.chip) : '';
  }

  function lintKnowledgeWiki() {
    const wikiDir = getWikiDir();
    const issues = [];
    if (!fs.existsSync(wikiDir)) {
      return {
        status: 'missing',
        issues: [
          {
            severity: 'warn',
            code: 'wiki-missing',
            summary: 'Knowledge wiki has not been initialized.',
            recommendation: 'Run knowledge init.'
          }
        ],
        next_steps: ['knowledge init']
      };
    }
    WIKI_DIRS.forEach(dirName => {
      if (!fs.existsSync(path.join(wikiDir, dirName))) {
        issues.push({
          severity: 'warn',
          code: 'missing-directory',
          path: getWikiRelativePath(dirName),
          summary: `Missing knowledge directory: ${dirName}`,
          recommendation: 'Run knowledge init.'
        });
      }
    });
    ['index.md', 'log.md'].forEach(fileName => {
      if (!fs.existsSync(path.join(wikiDir, fileName))) {
        issues.push({
          severity: 'warn',
          code: 'missing-control-file',
          path: getWikiRelativePath(fileName),
          summary: `Missing knowledge control file: ${fileName}`,
          recommendation: 'Run knowledge init.'
        });
      }
    });

    const pages = listMarkdownPages();
    const pageKeys = new Set(pages.map(page => page.path.replace(/\.md$/, '')));
    const inbound = new Map();
    pages.forEach(page => inbound.set(page.path.replace(/\.md$/, ''), 0));
    pages.forEach(page => {
      const content = readTextIfExists(getWikiPath(page.path));
      extractWikiLinks(content).forEach(link => {
        const normalized = link.replace(/^wiki\//, '').replace(/\.md$/, '');
        if (inbound.has(normalized)) {
          inbound.set(normalized, inbound.get(normalized) + 1);
        }
      });
    });
    [...inbound.entries()]
      .filter(([key, count]) => count === 0 && !key.startsWith('sources/'))
      .forEach(([key]) => {
        issues.push({
          severity: 'info',
          code: 'orphan-page',
          path: getWikiRelativePath(`${key}.md`),
          summary: 'Knowledge page has no inbound wiki links.',
          recommendation: 'Add cross-references or confirm the page should remain standalone.'
        });
      });

    const indexContent = readTextIfExists(getWikiPath('index.md'));
    pages.forEach(page => {
      const key = page.path.replace(/\.md$/, '');
      if (indexContent && !indexContent.includes(`[[${key}]]`)) {
        issues.push({
          severity: 'warn',
          code: 'unindexed-page',
          path: getWikiRelativePath(page.path),
          summary: 'Knowledge page is not listed in index.md.',
          recommendation: 'Run knowledge index --rebuild.'
        });
      }
    });

    const chipSlug = readHardwareChipSlug();
    if (chipSlug && !pageKeys.has(`chips/${chipSlug}`)) {
      issues.push({
        severity: 'info',
        code: 'missing-chip-page',
        path: getWikiRelativePath(`chips/${chipSlug}.md`),
        summary: 'Hardware truth declares a chip but no matching chip wiki page exists.',
        recommendation: `Run knowledge save-query --kind chip "${chipSlug}" --confirm after reviewing source evidence.`
      });
    }

    const status = issues.some(item => item.severity === 'warn') ? 'warn' : 'ok';
    updateSession(current => {
      current.last_command = 'knowledge lint';
    });
    return {
      status,
      wiki_dir: getWikiRelativePath(),
      page_count: pages.length,
      issues,
      next_steps: issues.length > 0
        ? runtime.unique(issues.map(item => item.recommendation).filter(Boolean)).slice(0, 5)
        : []
    };
  }

  function showKnowledgePage(target) {
    if (!target) {
      throw new Error('Missing knowledge page path');
    }
    const cleanTarget = String(target || '').replace(/^\.emb-agent\/wiki\//, '').replace(/\.md$/, '');
    const filePath = getWikiPath(`${cleanTarget}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Knowledge page not found: ${target}`);
    }
    return {
      path: getWikiRelativePath(`${cleanTarget}.md`),
      content: readTextIfExists(filePath)
    };
  }

  function handleKnowledgeCommands(cmd, subcmd, rest) {
    if (cmd !== 'knowledge') {
      return undefined;
    }
    if (!subcmd || subcmd === 'init') {
      return initKnowledgeWiki();
    }
    if (subcmd === 'index') {
      return readKnowledgeIndex({ rebuild: (rest || []).includes('--rebuild') });
    }
    if (subcmd === 'log') {
      return readKnowledgeLog(rest || []);
    }
    if (subcmd === 'lint') {
      return lintKnowledgeWiki();
    }
    if (subcmd === 'show') {
      return showKnowledgePage(rest[0]);
    }
    if (subcmd === 'save-query') {
      return saveKnowledgePage(
        parseKnowledgeWriteArgs(rest, { kind: 'query' }),
        'knowledge-save-query',
        'query'
      );
    }
    if (subcmd === 'ingest') {
      return saveKnowledgePage(
        parseKnowledgeWriteArgs(rest, { kind: 'source' }),
        'knowledge-ingest',
        'ingest'
      );
    }
    throw new Error(`Unknown knowledge command: ${subcmd}`);
  }

  return {
    handleKnowledgeCommands,
    initKnowledgeWiki,
    lintKnowledgeWiki,
    readKnowledgeIndex,
    readKnowledgeLog,
    saveKnowledgePage
  };
}

module.exports = {
  createKnowledgeRuntimeHelpers
};
