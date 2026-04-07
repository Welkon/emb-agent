'use strict';

function createSpecCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    getProjectExtDir
  } = deps;

  const SPEC_TYPES = ['feature', 'hardware', 'workflow', 'interface'];

  function getSpecsDir() {
    return path.join(getProjectExtDir(), 'specs');
  }

  function ensureSpecsDir() {
    runtime.ensureDir(getSpecsDir());
  }

  function normalizeSpecSlug(text) {
    const slug = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    return slug || `spec-${Date.now()}`;
  }

  function buildUniqueSpecSlug(summary) {
    ensureSpecsDir();
    const base = normalizeSpecSlug(summary);
    let next = base;
    let index = 2;

    while (fs.existsSync(path.join(getSpecsDir(), `${next}.md`))) {
      next = `${base}-${index}`;
      index += 1;
    }

    return next;
  }

  function getSpecPath(name) {
    return path.join(getSpecsDir(), `${name}.md`);
  }

  function parseType(value) {
    const type = String(value || 'feature').trim().toLowerCase();
    if (!SPEC_TYPES.includes(type)) {
      throw new Error(`Spec type must be one of: ${SPEC_TYPES.join(', ')}`);
    }
    return type;
  }

  function parseSpecAddArgs(rest) {
    const result = {
      type: 'feature',
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
      throw new Error('Missing spec summary');
    }

    return result;
  }

  function readSpecMeta(filePath) {
    const content = runtime.readText(filePath);
    const lines = content.split(/\r?\n/);
    const titleLine = lines.find(line => line.startsWith('# Spec: ')) || '';
    const typeLine = lines.find(line => line.startsWith('Type: ')) || '';
    const createdLine = lines.find(line => line.startsWith('Created: ')) || '';

    return {
      title: titleLine ? titleLine.slice('# Spec: '.length).trim() : path.basename(filePath, '.md'),
      type: typeLine ? typeLine.slice('Type: '.length).trim() : '',
      created_at: createdLine ? createdLine.slice('Created: '.length).trim() : ''
    };
  }

  function buildSpecTemplate(title, type, createdAt) {
    return [
      `# Spec: ${title}`,
      `Type: ${type}`,
      `Created: ${createdAt}`,
      '',
      '## Goal',
      '- ',
      '',
      '## Context',
      '- ',
      '',
      '## Constraints',
      '- ',
      '',
      '## Acceptance',
      '- ',
      '',
      '## Open Questions',
      '- ',
      ''
    ].join('\n');
  }

  function listSpecs() {
    ensureSpecsDir();

    const specs = fs.readdirSync(getSpecsDir())
      .filter(name => name.endsWith('.md'))
      .sort()
      .map(fileName => {
        const name = fileName.slice(0, -3);
        const filePath = getSpecPath(name);
        const stats = fs.statSync(filePath);
        const meta = readSpecMeta(filePath);

        return {
          name,
          title: meta.title,
          type: meta.type,
          path: runtime.getProjectAssetRelativePath('specs', fileName),
          created_at: meta.created_at,
          updated_at: new Date(stats.mtimeMs).toISOString()
        };
      });

    return { specs };
  }

  function showSpec(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing spec name');
    }

    const filePath = getSpecPath(normalized);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Spec not found: ${normalized}`);
    }

    const meta = readSpecMeta(filePath);
    return {
      name: normalized,
      title: meta.title,
      type: meta.type,
      path: runtime.getProjectAssetRelativePath('specs', `${normalized}.md`),
      content: runtime.readText(filePath)
    };
  }

  function addSpec(rest) {
    const parsed = parseSpecAddArgs(rest);
    const slug = buildUniqueSpecSlug(parsed.summary);
    const createdAt = new Date().toISOString();
    const filePath = getSpecPath(slug);
    const content = buildSpecTemplate(parsed.summary, parsed.type, createdAt);

    fs.writeFileSync(filePath, content, 'utf8');

    return {
      created: true,
      spec: {
        name: slug,
        title: parsed.summary,
        type: parsed.type,
        created_at: createdAt,
        path: runtime.getProjectAssetRelativePath('specs', `${slug}.md`)
      }
    };
  }

  function handleSpecCommands(cmd, subcmd, rest) {
    if (cmd !== 'spec') {
      return undefined;
    }

    if (subcmd === 'list') {
      return listSpecs();
    }

    if (subcmd === 'show') {
      return showSpec(rest[0]);
    }

    if (subcmd === 'add') {
      return addSpec(rest);
    }

    throw new Error(`Unknown spec command: ${subcmd || '(missing)'}`);
  }

  return {
    handleSpecCommands
  };
}

module.exports = {
  createSpecCommandHelpers
};
