'use strict';

function createWorkflowAuthoringHelpers(deps) {
  const {
    fs,
    path,
    process,
    ROOT,
    runtime,
    workflowRegistry,
    workflowImport,
    templateCli,
    getProjectExtDir,
    loadPack,
    loadSpec,
    updateSession
  } = deps;

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workflow-item';
  }

  function titleFromSlug(value) {
    return slugify(value)
      .split('-')
      .filter(Boolean)
      .map(item => item.charAt(0).toUpperCase() + item.slice(1))
      .join(' ');
  }

  function upperSnake(value) {
    return slugify(value).replace(/-/g, '_').toUpperCase();
  }

  function ensureProjectWorkflowLayout(force = false) {
    const projectExtDir = getProjectExtDir();
    const layout = workflowRegistry.syncProjectWorkflowLayout(projectExtDir, {
      write: true,
      force
    });
    const paths = workflowRegistry.getProjectWorkflowPaths(projectExtDir);
    const registry = runtime.readJson(paths.registryPath);
    return {
      projectExtDir,
      layout,
      paths,
      registry
    };
  }

  function saveProjectRegistry(paths, registry) {
    runtime.writeJson(paths.registryPath, registry);
  }

  function upsertNamedEntry(entries, nextEntry) {
    const list = Array.isArray(entries) ? [...entries] : [];
    const index = list.findIndex(item => item && item.name === nextEntry.name);
    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...nextEntry
      };
      return list;
    }
    list.push(nextEntry);
    return list;
  }

  function ensureCreatable(filePath, label, force) {
    if (fs.existsSync(filePath) && !force) {
      throw new Error(`${label} already exists: ${filePath}`);
    }
  }

  function buildTemplateStub(name) {
    const title = titleFromSlug(name);
    return [
      `# {{PROJECT_NAME}} ${title}`,
      '',
      '- Date: {{DATE}}',
      '- Owner:',
      '- Purpose:',
      '- Inputs:',
      '- Outputs:',
      '- Risks:',
      '- Verification:',
      ''
    ].join('\n');
  }

  function createProjectTemplate(options) {
    const config = options || {};
    const name = slugify(config.name);
    const force = config.force === true;
    const output = String(config.output || `docs/${upperSnake(name)}.md`).trim();
    const {
      projectExtDir,
      paths,
      registry
    } = ensureProjectWorkflowLayout(false);
    const relativePath = `templates/${name}.md.tpl`;
    const absolutePath = path.join(projectExtDir, relativePath);

    ensureCreatable(absolutePath, 'Template', force);

    runtime.ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, buildTemplateStub(name), 'utf8');

    registry.templates = upsertNamedEntry(registry.templates, {
      name,
      source: relativePath,
      description: `Project-local template: ${name}.`,
      default_output: output
    });
    saveProjectRegistry(paths, registry);

    return {
      kind: 'template',
      name,
      file: relativePath,
      default_output: output,
      registry_path: path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/')
    };
  }

  function createProjectSpec(options) {
    const config = options || {};
    const name = slugify(config.name);
    const force = config.force === true;
    const packName = config.pack ? slugify(config.pack) : '';
    const always = config.always === true;
    const {
      projectExtDir,
      paths,
      registry
    } = ensureProjectWorkflowLayout(false);
    const relativePath = `specs/${name}.md`;
    const absolutePath = path.join(projectExtDir, relativePath);

    ensureCreatable(absolutePath, 'Spec', force);

    templateCli.fillCommand('project-spec', '', {
      SLUG: name,
      PROJECT_NAME: path.basename(process.cwd())
    }, force);

    registry.specs = upsertNamedEntry(registry.specs, {
      name,
      title: titleFromSlug(name),
      path: relativePath,
      summary: `Project-local workflow spec: ${name}.`,
      auto_inject: Boolean(packName || always),
      priority: packName ? 65 : always ? 55 : 50,
      apply_when: packName
        ? { packs: [packName] }
        : always
          ? { always: true }
          : {}
    });
    saveProjectRegistry(paths, registry);

    return {
      kind: 'spec',
      name,
      file: relativePath,
      auto_inject: Boolean(packName || always),
      apply_when: packName
        ? { packs: [packName] }
        : always
          ? { always: true }
          : {},
      registry_path: path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/')
    };
  }

  function createProjectPack(options) {
    const config = options || {};
    const name = slugify(config.name);
    const force = config.force === true;
    const withSpec = config.withSpec === true;
    const specName = config.specName ? slugify(config.specName) : `${name}-focus`;
    const withTemplate = config.withTemplate === true;
    const templateName = config.templateName ? slugify(config.templateName) : name;
    const templateOutput = String(config.output || `docs/${upperSnake(templateName)}.md`).trim();
    const {
      projectExtDir,
      paths,
      registry
    } = ensureProjectWorkflowLayout(false);
    const relativePath = `packs/${name}.yaml`;
    const absolutePath = path.join(projectExtDir, relativePath);

    ensureCreatable(absolutePath, 'Pack', force);

    templateCli.fillCommand('pack', '', {
      SLUG: name,
      FOCUS_1: 'product workflow',
      FOCUS_2: 'verification checkpoints',
      AXIS_1: 'workflow completeness',
      AXIS_2: 'failure handling',
      NOTE_TARGET_1: withTemplate ? templateOutput : 'docs/DEBUG-NOTES.md',
      NOTE_TARGET_2: 'docs/REVIEW-REPORT.md'
    }, force);

    registry.packs = upsertNamedEntry(registry.packs, {
      name,
      file: relativePath,
      description: `Project-local workflow pack: ${name}.`
    });
    saveProjectRegistry(paths, registry);

    const created = [
      {
        kind: 'pack',
        name,
        file: relativePath
      }
    ];

    if (withSpec) {
      created.push(createProjectSpec({
        name: specName,
        pack: name,
        force
      }));
    }

    if (withTemplate) {
      created.push(createProjectTemplate({
        name: templateName,
        output: templateOutput,
        force
      }));
    }

    return {
      kind: 'pack',
      name,
      registry_path: path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/'),
      created
    };
  }

  function parsePackArgs(args) {
    const options = {
      name: '',
      force: false,
      withSpec: false,
      specName: '',
      withTemplate: false,
      templateName: '',
      output: ''
    };

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!options.name && !token.startsWith('--')) {
        options.name = token;
        continue;
      }
      if (token === '--force') {
        options.force = true;
        continue;
      }
      if (token === '--with-spec') {
        options.withSpec = true;
        const nextToken = args[index + 1];
        if (nextToken && !nextToken.startsWith('--')) {
          options.specName = nextToken;
          index += 1;
        }
        continue;
      }
      if (token === '--with-template') {
        options.withTemplate = true;
        const nextToken = args[index + 1];
        if (nextToken && !nextToken.startsWith('--')) {
          options.templateName = nextToken;
          index += 1;
        }
        continue;
      }
      if (token === '--output') {
        const nextToken = args[index + 1];
        if (!nextToken) {
          throw new Error('Missing template output path');
        }
        options.output = nextToken;
        index += 1;
        continue;
      }
      throw new Error(`Unknown workflow pack option: ${token}`);
    }

    if (!options.name) {
      throw new Error('Missing workflow pack name');
    }

    return options;
  }

  function parseSpecArgs(args) {
    const options = {
      name: '',
      pack: '',
      always: false,
      force: false
    };

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!options.name && !token.startsWith('--')) {
        options.name = token;
        continue;
      }
      if (token === '--pack') {
        const nextToken = args[index + 1];
        if (!nextToken) {
          throw new Error('Missing pack name for spec');
        }
        options.pack = nextToken;
        index += 1;
        continue;
      }
      if (token === '--always') {
        options.always = true;
        continue;
      }
      if (token === '--force') {
        options.force = true;
        continue;
      }
      throw new Error(`Unknown workflow spec option: ${token}`);
    }

    if (!options.name) {
      throw new Error('Missing workflow spec name');
    }

    return options;
  }

  function parseTemplateArgs(args) {
    const options = {
      name: '',
      output: '',
      force: false
    };

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!options.name && !token.startsWith('--')) {
        options.name = token;
        continue;
      }
      if (token === '--output') {
        const nextToken = args[index + 1];
        if (!nextToken) {
          throw new Error('Missing template output path');
        }
        options.output = nextToken;
        index += 1;
        continue;
      }
      if (token === '--force') {
        options.force = true;
        continue;
      }
      throw new Error(`Unknown workflow template option: ${token}`);
    }

    if (!options.name) {
      throw new Error('Missing workflow template name');
    }

    return options;
  }

  function listWorkflowCatalog() {
    const projectExtDir = getProjectExtDir();
    const layout = workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: true });
    const registry = workflowRegistry.loadWorkflowRegistry(ROOT, { projectExtDir });

    return {
      command: 'workflow list',
      workflow_layout: layout,
      packs: (registry.packs || []).map(item => ({
        name: item.name,
        scope: item.scope,
        path: item.display_path,
        description: item.description || ''
      })),
      specs: (registry.specs || []).map(item => ({
        name: item.name,
        scope: item.scope,
        path: item.display_path,
        auto_inject: item.auto_inject,
        priority: item.priority
      })),
      templates: (registry.templates || []).map(item => ({
        name: item.name,
        scope: item.scope,
        path: item.display_path,
        default_output: item.default_output || ''
      }))
    };
  }

  function showWorkflowTarget(args) {
    const [kind, name] = args;
    if (!kind) {
      throw new Error('Missing workflow show target');
    }

    if (kind === 'registry') {
      const { projectExtDir, paths } = ensureProjectWorkflowLayout(false);
      return {
        kind: 'registry',
        path: path.relative(projectExtDir, paths.registryPath).replace(/\\/g, '/'),
        content: runtime.readJson(paths.registryPath)
      };
    }

    if (!name) {
      throw new Error(`Missing workflow ${kind} name`);
    }

    if (kind === 'pack') {
      return loadPack(name);
    }
    if (kind === 'spec') {
      return loadSpec(name);
    }
    if (kind === 'template') {
      return templateCli.showCommand(name);
    }

    throw new Error(`Unknown workflow show target: ${kind}`);
  }

  function initWorkflowLayout(args) {
    const force = Array.isArray(args) && args.includes('--force');
    const result = ensureProjectWorkflowLayout(force);
    return {
      command: 'workflow init',
      workflow_layout: result.layout
    };
  }

  function parseWorkflowImportArgs(args) {
    const options = {
      source: '',
      branch: '',
      subdir: '',
      force: false
    };

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];

      if (!options.source && !token.startsWith('--')) {
        options.source = token;
        continue;
      }
      if (token === '--branch') {
        options.branch = args[index + 1] || '';
        index += 1;
        if (!options.branch) {
          throw new Error('Missing workflow registry branch');
        }
        continue;
      }
      if (token === '--subdir') {
        options.subdir = args[index + 1] || '';
        index += 1;
        if (!options.subdir) {
          throw new Error('Missing workflow registry subdir');
        }
        continue;
      }
      if (token === '--force') {
        options.force = true;
        continue;
      }
      throw new Error(`Unknown workflow import option: ${token}`);
    }

    if (!options.source) {
      throw new Error('Missing workflow registry source');
    }

    return options;
  }

  function handleWorkflowCommands(cmd, subcmd, rest) {
    if (cmd !== 'workflow') {
      return undefined;
    }

    if (!subcmd) {
      throw new Error('workflow requires a subcommand');
    }

    if (subcmd === 'init') {
      const result = initWorkflowLayout(rest);
      updateSession(current => {
        current.last_command = 'workflow init';
      });
      return result;
    }

    if (subcmd === 'list') {
      const result = listWorkflowCatalog();
      updateSession(current => {
        current.last_command = 'workflow list';
      });
      return result;
    }

    if (subcmd === 'show') {
      const result = showWorkflowTarget(rest);
      updateSession(current => {
        current.last_command = 'workflow show';
      });
      return result;
    }

    if (subcmd === 'new') {
      const kind = rest[0];
      const args = rest.slice(1);
      let result;

      if (kind === 'pack') {
        result = createProjectPack(parsePackArgs(args));
      } else if (kind === 'spec') {
        result = createProjectSpec(parseSpecArgs(args));
      } else if (kind === 'template') {
        result = createProjectTemplate(parseTemplateArgs(args));
      } else {
        throw new Error(`Unknown workflow create target: ${kind || ''}`.trim());
      }

      updateSession(current => {
        current.last_command = `workflow new ${kind}`;
      });

      return {
        command: `workflow new ${kind}`,
        ...result
      };
    }

    if (subcmd === 'import') {
      const target = rest[0];
      if (target !== 'registry') {
        throw new Error(`Unknown workflow import target: ${target || ''}`.trim());
      }

      const options = parseWorkflowImportArgs(rest.slice(1));
      const result = workflowImport.importProjectWorkflowRegistry(process.cwd(), options.source, options);
      updateSession(current => {
        current.last_command = 'workflow import registry';
      });

      return {
        command: 'workflow import registry',
        ...result
      };
    }

    throw new Error(`Unknown workflow subcommand: ${subcmd}`);
  }

  return {
    handleWorkflowCommands
  };
}

module.exports = {
  createWorkflowAuthoringHelpers
};
