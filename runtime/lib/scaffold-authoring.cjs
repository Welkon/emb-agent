'use strict';

function createScaffoldAuthoringHelpers(deps) {
  const {
    fs,
    path,
    process,
    ROOT,
    runtime,
    templateCli,
    updateSession
  } = deps;

  const SCAFFOLDS_DIR = path.join(ROOT, 'scaffolds');
  const REGISTRY_PATH = path.join(SCAFFOLDS_DIR, 'registry.json');

  function ensureScaffoldRegistry() {
    if (!fs.existsSync(REGISTRY_PATH)) {
      throw new Error(`Scaffold registry not found: ${REGISTRY_PATH}`);
    }
    const raw = runtime.readJson(REGISTRY_PATH);
    const entries = Array.isArray(raw.scaffolds) ? raw.scaffolds : [];

    return entries.map((entry, index) => {
      const name = String(entry && entry.name || '').trim();
      const source = String(entry && entry.source || '').trim();
      const description = String(entry && entry.description || '').trim();
      const defaultOutput = String(entry && entry.default_output || '').trim();
      if (!name) {
        throw new Error(`Scaffold registry entry ${index} is missing name`);
      }
      if (!source) {
        throw new Error(`Scaffold registry entry ${name} is missing source`);
      }
      return {
        name,
        source,
        description,
        default_output: defaultOutput,
        source_path: path.join(SCAFFOLDS_DIR, source)
      };
    });
  }

  function getScaffoldMeta(name) {
    const normalized = String(name || '').trim();
    const meta = ensureScaffoldRegistry().find(item => item.name === normalized);
    if (!meta) {
      throw new Error(`Unknown scaffold: ${name}`);
    }
    if (!fs.existsSync(meta.source_path)) {
      throw new Error(`Scaffold source not found: ${meta.source}`);
    }
    return meta;
  }

  function listScaffoldFiles(sourcePath) {
    if (!fs.existsSync(sourcePath)) {
      return [];
    }
    const stats = fs.statSync(sourcePath);
    if (stats.isFile()) {
      return [path.basename(sourcePath)];
    }

    const files = [];
    const queue = [''];

    while (queue.length > 0) {
      const current = queue.shift();
      const absolute = current ? path.join(sourcePath, current) : sourcePath;
      for (const name of fs.readdirSync(absolute)) {
        const relative = current ? path.posix.join(current.replace(/\\/g, '/'), name) : name;
        const fullPath = path.join(sourcePath, relative);
        const entryStats = fs.statSync(fullPath);
        if (entryStats.isDirectory()) {
          queue.push(relative);
          continue;
        }
        files.push(relative.replace(/\\/g, '/'));
      }
    }

    return files.sort();
  }

  function parseInstallArgs(rest) {
    const tokens = Array.isArray(rest) ? rest.slice() : [];
    const result = {
      name: '',
      output: '',
      force: false,
      fields: {}
    };
    let outputConsumed = false;

    for (let index = 0; index < tokens.length; index += 1) {
      const token = String(tokens[index] || '');
      if (!result.name) {
        result.name = token;
        continue;
      }
      if (token === '--force') {
        result.force = true;
        continue;
      }
      if (token === '--output') {
        result.output = String(tokens[index + 1] || '').trim();
        if (!result.output) {
          throw new Error('Missing output path after --output');
        }
        outputConsumed = true;
        index += 1;
        continue;
      }
      const separator = token.indexOf('=');
      if (separator !== -1) {
        const key = token.slice(0, separator).trim();
        const value = token.slice(separator + 1);
        if (!key) {
          throw new Error(`Invalid scaffold field assignment: ${token}`);
        }
        result.fields[key] = value;
        continue;
      }
      if (!outputConsumed) {
        result.output = token;
        outputConsumed = true;
        continue;
      }
      throw new Error(`Unknown scaffold install option: ${token}`);
    }

    if (!result.name) {
      throw new Error('Missing scaffold name');
    }

    return result;
  }

  function findTemplateTokens(text) {
    return Array.from(new Set(String(text || '').match(/\{\{[A-Z0-9_]+\}\}/g) || []));
  }

  function collectFillMarkers(content, relativePath) {
    const markers = [];
    String(content || '')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (!line.includes('FILL:')) {
          return;
        }
        markers.push({
          path: relativePath,
          line: index + 1,
          text: line.trim()
        });
      });
    return markers;
  }

  function buildInstallPlan(meta, outputArg, fields) {
    const projectRoot = process.cwd();
    const context = templateCli.buildContext(fields || {}, projectRoot);
    const outputTemplate = String(outputArg || meta.default_output || '').trim() || '.';
    const renderedOutputRoot = templateCli.applyTemplate(outputTemplate, context);
    const unresolvedOutputTokens = findTemplateTokens(renderedOutputRoot);

    if (unresolvedOutputTokens.length > 0) {
      throw new Error(`Scaffold output path still has unresolved placeholders: ${unresolvedOutputTokens.join(', ')}`);
    }

    const outputRoot = path.resolve(projectRoot, renderedOutputRoot);
    const items = [];
    const unresolved = [];
    const fillMarkers = [];

    function visit(currentSourcePath, currentRelativePath) {
      const stats = fs.statSync(currentSourcePath);
      const renderedRelativePath = currentRelativePath
        ? templateCli.applyTemplate(currentRelativePath.replace(/\\/g, '/'), context)
        : '';
      const unresolvedPathTokens = findTemplateTokens(renderedRelativePath);
      if (unresolvedPathTokens.length > 0) {
        unresolved.push({
          type: 'path',
          source: currentRelativePath.replace(/\\/g, '/'),
          placeholders: unresolvedPathTokens
        });
        return;
      }

      const targetPath = renderedRelativePath
        ? path.join(outputRoot, renderedRelativePath)
        : outputRoot;

      if (stats.isDirectory()) {
        items.push({
          kind: 'directory',
          source: currentSourcePath,
          source_relative: currentRelativePath.replace(/\\/g, '/'),
          relative_path: renderedRelativePath,
          target_path: targetPath,
          mode: stats.mode
        });

        for (const name of fs.readdirSync(currentSourcePath)) {
          const nextRelative = currentRelativePath
            ? path.posix.join(currentRelativePath.replace(/\\/g, '/'), name)
            : name;
          visit(path.join(currentSourcePath, name), nextRelative);
        }
        return;
      }

      const rawContent = fs.readFileSync(currentSourcePath, 'utf8');
      const renderedContent = templateCli.applyTemplate(rawContent, context);
      const unresolvedContentTokens = findTemplateTokens(renderedContent);
      if (unresolvedContentTokens.length > 0) {
        unresolved.push({
          type: 'content',
          source: currentRelativePath.replace(/\\/g, '/'),
          placeholders: unresolvedContentTokens
        });
        return;
      }

      const relativePath = renderedRelativePath || path.basename(currentSourcePath);
      fillMarkers.push(...collectFillMarkers(renderedContent, relativePath));
      items.push({
        kind: 'file',
        source: currentSourcePath,
        source_relative: currentRelativePath.replace(/\\/g, '/'),
        relative_path: relativePath,
        target_path: targetPath,
        content: renderedContent,
        mode: stats.mode
      });
    }

    visit(meta.source_path, '');

    if (unresolved.length > 0) {
      return {
        ok: false,
        meta,
        context,
        output_root: outputRoot,
        unresolved
      };
    }

    return {
      ok: true,
      meta,
      context,
      output_root: outputRoot,
      items,
      fill_markers: fillMarkers
    };
  }

  function listScaffolds() {
    return {
      scaffolds: ensureScaffoldRegistry().map(item => ({
        name: item.name,
        source: item.source,
        description: item.description,
        default_output: item.default_output,
        files: listScaffoldFiles(item.source_path)
      }))
    };
  }

  function showScaffold(name) {
    const meta = getScaffoldMeta(name);
    return {
      scaffold: {
        name: meta.name,
        source: meta.source,
        description: meta.description,
        default_output: meta.default_output,
        files: listScaffoldFiles(meta.source_path)
      }
    };
  }

  function installScaffold(rest) {
    const parsed = parseInstallArgs(rest);
    const meta = getScaffoldMeta(parsed.name);
    const plan = buildInstallPlan(meta, parsed.output, parsed.fields);

    if (!plan.ok) {
      return {
        installed: false,
        status: 'placeholder-required',
        scaffold: meta.name,
        unresolved: plan.unresolved
      };
    }

    const conflicts = plan.items
      .filter(item => item.kind === 'file' && fs.existsSync(item.target_path) && !parsed.force)
      .map(item => path.relative(process.cwd(), item.target_path).replace(/\\/g, '/'));
    if (conflicts.length > 0) {
      throw new Error(`Scaffold output already exists: ${conflicts.join(', ')}`);
    }

    const created = [];
    plan.items
      .filter(item => item.kind === 'directory')
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
      .forEach(item => {
        runtime.ensureDir(item.target_path);
      });

    plan.items
      .filter(item => item.kind === 'file')
      .forEach(item => {
        runtime.ensureDir(path.dirname(item.target_path));
        fs.writeFileSync(item.target_path, item.content, 'utf8');
        fs.chmodSync(item.target_path, item.mode);
        created.push(path.relative(process.cwd(), item.target_path).replace(/\\/g, '/'));
      });

    updateSession(current => {
      current.last_command = 'scaffold install';
    });

    return {
      installed: true,
      scaffold: meta.name,
      output_root: path.relative(process.cwd(), plan.output_root).replace(/\\/g, '/') || '.',
      created,
      fields: parsed.fields,
      validation: {
        unresolved_placeholders: [],
        fill_markers: plan.fill_markers,
        fill_count: plan.fill_markers.length,
        needs_manual_completion: plan.fill_markers.length > 0,
        grep_hint: plan.fill_markers.length > 0
          ? `rg -n "FILL:" ${path.relative(process.cwd(), plan.output_root).replace(/\\/g, '/') || '.'}`
          : ''
      }
    };
  }

  function handleScaffoldCommands(cmd, subcmd, rest) {
    if (cmd !== 'scaffold') {
      return undefined;
    }

    if (!subcmd || subcmd === 'list') {
      updateSession(current => {
        current.last_command = 'scaffold list';
      });
      return listScaffolds();
    }

    if (subcmd === 'show') {
      if (!rest[0]) {
        throw new Error('Missing scaffold name');
      }
      updateSession(current => {
        current.last_command = 'scaffold show';
      });
      return showScaffold(rest[0]);
    }

    if (subcmd === 'install') {
      return installScaffold(rest);
    }

    throw new Error(`Unknown scaffold subcommand: ${subcmd}`);
  }

  return {
    handleScaffoldCommands
  };
}

module.exports = {
  createScaffoldAuthoringHelpers
};
