'use strict';

const crypto = require('crypto');

const PRD_CONFIRMATION_FILE = 'prd-confirmation.json';
const PRD_ROOT = 'docs/prd';
const PRD_TASK_ALIGNMENT_PROMPTS = [
  '生成的任务拆分是否符合用户期望的实现顺序和边界？',
  '每个任务的目标、非目标、约束和验收证据是否清楚？',
  '还有哪些待确认项会影响实现，必须先追问到一致？'
];
const IGNORED_PRD_DIRS = new Set(['archive', 'tasks']);
const EXECUTION_PRD_DIRS = new Set(['subsystems', 'features', 'modules', 'components']);
const VERIFICATION_FILE_NAMES = new Set(['verification', 'validation', 'test-plan', 'acceptance']);

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function readJson(fs, filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(fs, filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function ensureDir(fs, dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function extractTitle(text, fallback) {
  const lines = String(text || '').split(/\r?\n/);
  const heading = lines.find(line => /^#\s+/.test(line));
  return heading ? heading.replace(/^#\s+/, '').trim() : fallback;
}

function containsCjk(value) {
  return /[\u4e00-\u9fff]/u.test(String(value || ''));
}

function humanizeSlug(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return normalized || String(fallback || 'prd-task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'prd-task';
}

function cleanPrdTitle(title, fallback) {
  const raw = String(title || fallback || '').trim();
  const withoutMarker = raw
    .replace(/\s*(?:子\s*)?PRD\s*[:：-]?\s*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutMarker || raw || String(fallback || 'PRD').trim();
}

function getProjectExtDir(runtime, projectRoot) {
  return runtime.resolveProjectDataPath(projectRoot, '');
}

function getConfirmationPath(projectRoot, deps) {
  const { path, runtime } = deps;
  return path.join(getProjectExtDir(runtime, projectRoot), PRD_CONFIRMATION_FILE);
}

function walkMarkdownFiles(fs, path, rootPath) {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return [];
  }

  const results = [];
  function walk(dirPath) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(entryPath);
      }
    }
  }
  walk(rootPath);
  return results;
}

function classifyPrdPath(relativePath) {
  const normalized = normalizePath(relativePath);
  const parts = normalized.split('/');
  const prdIndex = parts[0] === 'docs' && parts[1] === 'prd' ? 2 : 0;
  const afterRoot = parts.slice(prdIndex);
  const first = afterRoot[0] || '';
  const fileName = (afterRoot[afterRoot.length - 1] || '').replace(/\.md$/i, '');

  if (first === 'system.md' || (afterRoot.length === 1 && fileName === 'system')) {
    return 'system';
  }
  if (EXECUTION_PRD_DIRS.has(first)) {
    return 'execution';
  }
  if (afterRoot.length === 1 && VERIFICATION_FILE_NAMES.has(fileName)) {
    return 'verification';
  }
  return 'reference';
}

function shouldIgnorePrdPath(relativePath) {
  const normalized = normalizePath(relativePath);
  const parts = normalized.split('/');
  const afterRoot = parts[0] === 'docs' && parts[1] === 'prd' ? parts.slice(2) : parts;
  return afterRoot.some(part => IGNORED_PRD_DIRS.has(part));
}

function listPrdDocuments(projectRoot, deps) {
  const { fs, path } = deps;
  const prdRoot = path.join(projectRoot, PRD_ROOT);
  return walkMarkdownFiles(fs, path, prdRoot)
    .map(filePath => {
      const relativePath = normalizePath(path.relative(projectRoot, filePath));
      if (shouldIgnorePrdPath(relativePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return {
        path: relativePath,
        title: extractTitle(content, relativePath),
        kind: classifyPrdPath(relativePath),
        sha256: sha256(content),
        bytes: Buffer.byteLength(content, 'utf8')
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const order = { system: 0, execution: 1, verification: 2, reference: 3 };
      return (order[left.kind] || 9) - (order[right.kind] || 9) || left.path.localeCompare(right.path);
    });
}

function buildTaskName(doc, usedNames) {
  const pathParts = normalizePath(doc.path).split('/');
  const fileBase = (pathParts[pathParts.length - 1] || 'prd-task').replace(/\.md$/i, '');
  const parent = pathParts[pathParts.length - 2] || '';
  const baseSlug = slugify(fileBase, slugify(cleanPrdTitle(doc.title), 'prd-task'));
  const prefix = doc.kind === 'verification' ? 'run' : 'implement';
  let name = `${prefix}-${baseSlug}`;
  if (parent && EXECUTION_PRD_DIRS.has(parent) && parent !== 'subsystems') {
    name = `${prefix}-${slugify(parent, parent)}-${baseSlug}`;
  }
  let candidate = name;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${name}-${index}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function buildTaskTitle(doc) {
  const cleanTitle = cleanPrdTitle(doc.title, humanizeSlug(doc.path));
  if (doc.kind === 'verification') {
    return containsCjk(cleanTitle) ? `执行 ${cleanTitle}` : `Run ${cleanTitle}`;
  }
  return containsCjk(cleanTitle) ? `实现 ${cleanTitle}` : `Implement ${cleanTitle}`;
}

function buildTaskDescription(doc) {
  const cleanTitle = cleanPrdTitle(doc.title, doc.path);
  return containsCjk(cleanTitle)
    ? `根据 ${doc.path} 实现该 PRD 定义的最小可验证交付。`
    : `Implement the smallest verifiable deliverable defined by ${doc.path}.`;
}

function isExecutionPrd(doc) {
  return Boolean(doc && (doc.kind === 'execution' || doc.kind === 'verification'));
}

function buildPrdTaskPlan(projectRoot, deps) {
  const { fs, path } = deps;
  const existingTasksDir = path.join(projectRoot, '.emb-agent', 'tasks');
  const documents = listPrdDocuments(projectRoot, deps);
  const usedNames = new Set();

  return documents
    .filter(isExecutionPrd)
    .map(doc => {
      const name = buildTaskName(doc, usedNames);
      const exists = fs.existsSync(path.join(existingTasksDir, name, 'task.json'));
      return {
        source: doc.path,
        kind: doc.kind,
        name,
        title: buildTaskTitle(doc),
        priority: doc.kind === 'verification' ? 'P2' : 'P1',
        description: buildTaskDescription(doc),
        status: exists ? 'exists' : 'planned',
        task_prd: normalizePath(path.join(PRD_ROOT, 'tasks', `${name}.md`))
      };
    });
}

function compareManifest(left, right) {
  const leftDocs = Array.isArray(left) ? left : [];
  const rightDocs = Array.isArray(right) ? right : [];
  if (leftDocs.length !== rightDocs.length) {
    return false;
  }
  const byPath = new Map(leftDocs.map(item => [normalizePath(item.path), item.sha256]));
  return rightDocs.every(item => byPath.get(normalizePath(item.path)) === item.sha256);
}

function summarizePrdConfirmationState(projectRoot, deps) {
  const { fs } = deps;
  const documents = listPrdDocuments(projectRoot, deps);
  const confirmationPath = getConfirmationPath(projectRoot, deps);
  const confirmation = fs.existsSync(confirmationPath) ? readJson(fs, confirmationPath) : null;
  const confirmed = Boolean(
    confirmation &&
    confirmation.status === 'confirmed' &&
    compareManifest(confirmation.document_manifest, documents)
  );
  const stale = Boolean(confirmation && confirmation.status === 'confirmed' && !confirmed);
  const taskPlan = buildPrdTaskPlan(projectRoot, deps);
  const plannedTasks = taskPlan.filter(item => item.status === 'planned');

  return {
    status: confirmed ? 'confirmed' : stale ? 'stale' : 'unconfirmed',
    confirmed,
    stale,
    confirmation_path: normalizePath(deps.path.relative(projectRoot, confirmationPath)),
    confirmed_at: confirmation && confirmation.confirmed_at ? confirmation.confirmed_at : '',
    documents,
    task_plan: taskPlan,
    planned_task_count: plannedTasks.length,
    generated_tasks: Array.isArray(confirmation && confirmation.generated_tasks)
      ? confirmation.generated_tasks
      : []
  };
}

function buildTaskId(name) {
  return `task-${Date.now()}-${slugify(name, 'task')}`;
}

function buildTaskPrdContent(task, sourceTitle) {
  const chinese = containsCjk(task.title) || containsCjk(sourceTitle);
  if (chinese) {
    return [
      `# ${task.title}`,
      '',
      '## 系统上下文',
      '',
      '- 系统 PRD: docs/prd/system.md',
      `- 源 PRD: ${task.source}`,
      '- 结构化需求: .emb-agent/req.yaml',
      '- 硬件 truth: .emb-agent/hw.yaml',
      '',
      '## 目标',
      '',
      task.description,
      '',
      '## 范围',
      '',
      '- 类型: implement',
      `- 优先级: ${task.priority}`,
      '- 状态: planning',
      '',
      '## 约束',
      '',
      `- 先重读并遵守 ${task.source}。`,
      '- 不重新发明需求；如发现 PRD 不足，先更新 docs/prd 后再改实现。',
      '- 保持改动收敛：只实现本任务对应边界，不跨模块隐式改变契约。',
      '',
      '## 验收清单',
      '',
      `- [ ] 已和用户确认 ${sourceTitle || task.source} 中的目标、边界和待确认项；不明确处已反复沟通达成一致`,
      '- [ ] 产出最小必要实现或验证结果',
      '- [ ] 记录构建、静态检查或实板验证证据',
      '- [ ] task resolve 前完成 AAR scan',
      '',
      '## 参考',
      '',
      '- docs/prd/system.md',
      `- ${task.source}`,
      '- .emb-agent/hw.yaml',
      '- .emb-agent/req.yaml',
      ''
    ].join('\n');
  }

  return [
    `# ${task.title}`,
    '',
    '## System Context',
    '',
    '- System PRD: docs/prd/system.md',
    `- Source PRD: ${task.source}`,
    '- Requirement truth: .emb-agent/req.yaml',
    '- Hardware truth: .emb-agent/hw.yaml',
    '',
    '## Goal',
    '',
    task.description,
    '',
    '## Scope',
    '',
    '- Type: implement',
    `- Priority: ${task.priority}`,
    '- Status: planning',
    '',
    '## Constraints',
    '',
    `- Re-read and follow ${task.source} before implementation.`,
    '- Do not invent requirements; update docs/prd first if the PRD is incomplete.',
    '- Keep the change narrow and inside this task boundary.',
    '',
    '## Acceptance Checklist',
    '',
    `- [ ] Goal, boundaries, and unknowns from ${sourceTitle || task.source} were aligned with the user; ambiguous items were iterated until agreement`,
    '- [ ] The smallest required implementation or verification result is produced',
    '- [ ] Build, static check, or bench evidence is recorded',
    '- [ ] AAR scan is completed before task resolve',
    '',
    '## References',
    '',
    '- docs/prd/system.md',
    `- ${task.source}`,
    '- .emb-agent/hw.yaml',
    '- .emb-agent/req.yaml',
    ''
  ].join('\n');
}

function writeJsonl(fs, filePath, entries) {
  fs.writeFileSync(
    filePath,
    entries.map(item => JSON.stringify(item)).join('\n') + '\n',
    'utf8'
  );
}

function createExecutionTasks(projectRoot, deps, taskPlan, documents) {
  const { fs, path } = deps;
  const tasksDir = path.join(projectRoot, '.emb-agent', 'tasks');
  const taskPrdDir = path.join(projectRoot, PRD_ROOT, 'tasks');
  ensureDir(fs, tasksDir);
  ensureDir(fs, taskPrdDir);
  const docTitleByPath = new Map(documents.map(item => [item.path, item.title]));
  const existingVerification = documents.find(item => item.kind === 'verification');
  const now = new Date().toISOString();
  const created = [];
  const skipped = [];

  for (const task of taskPlan) {
    const taskDir = path.join(tasksDir, task.name);
    const manifestPath = path.join(taskDir, 'task.json');
    if (fs.existsSync(manifestPath)) {
      skipped.push({ name: task.name, reason: 'exists' });
      continue;
    }

    ensureDir(fs, taskDir);
    const taskPrd = normalizePath(path.join(PRD_ROOT, 'tasks', `${task.name}.md`));
    const references = [
      documents.some(item => item.path === 'docs/prd/system.md') ? 'docs/prd/system.md' : '',
      task.source,
      existingVerification && existingVerification.path !== task.source ? existingVerification.path : '',
      fs.existsSync(path.join(projectRoot, '.emb-agent', 'hw.yaml')) ? '.emb-agent/hw.yaml' : '',
      fs.existsSync(path.join(projectRoot, '.emb-agent', 'req.yaml')) ? '.emb-agent/req.yaml' : ''
    ].filter((item, index, arr) => item && arr.indexOf(item) === index);
    const manifest = {
      name: task.name,
      title: task.title,
      id: buildTaskId(task.name),
      description: task.description,
      goal: task.description,
      status: 'planning',
      type: 'implement',
      dev_type: 'embedded',
      priority: task.priority,
      creator: '',
      assignee: '',
      created_at: now,
      updated_at: now,
      createdAt: now,
      updatedAt: now,
      references,
      relatedFiles: references,
      open_questions: [],
      known_risks: [],
      artifacts: {
        prd: taskPrd,
        source_prd: task.source
      },
      current_phase: 1,
      next_action: [
        { phase: 1, action: 'implement' },
        { phase: 2, action: 'check' },
        { phase: 3, action: 'finish' },
        { phase: 4, action: 'create-pr' }
      ]
    };

    writeJson(fs, manifestPath, manifest);
    fs.writeFileSync(
      path.join(projectRoot, taskPrd),
      buildTaskPrdContent(task, docTitleByPath.get(task.source)),
      'utf8'
    );

    const contextEntries = references.map(reference => ({
      kind: 'file',
      path: reference,
      reason: reference === taskPrd
        ? 'Execution task PRD'
        : reference === task.source
          ? 'Confirmed source PRD'
          : 'Project truth and verification context'
    }));
    const allContextEntries = [
      { kind: 'file', path: taskPrd, reason: 'Execution task PRD' },
      ...contextEntries
    ];
    ['implement', 'check', 'debug'].forEach(channel => {
      writeJsonl(fs, path.join(taskDir, `${channel}.jsonl`), allContextEntries);
    });

    created.push({
      name: task.name,
      title: task.title,
      priority: task.priority,
      source_prd: task.source,
      task_prd: taskPrd
    });
  }

  return { created, skipped };
}

function buildPrdTaskAlignment(taskCreation) {
  const created = Array.isArray(taskCreation && taskCreation.created)
    ? taskCreation.created
    : [];
  if (created.length === 0) return null;

  const first = created[0] || {};
  return {
    status: 'needs-human-alignment',
    scope: 'prd-generated-tasks',
    subject: `${created.length} generated execution task(s)`,
    prd_path: first.task_prd || '',
    summary: 'After PRD confirmation creates execution tasks, align the generated task split, unclear requirements, boundaries, and acceptance evidence with the user before activation or implementation.',
    prompts: PRD_TASK_ALIGNMENT_PROMPTS.slice(),
    created_tasks: created.map(task => ({
      name: task.name,
      title: task.title,
      source_prd: task.source_prd,
      task_prd: task.task_prd
    })),
    next_after_agreement: first.name
      ? {
          command: `task activate ${first.name}`,
          reason: 'User has explicitly agreed that the generated task split and first task PRD are clear enough to proceed.'
        }
      : null
  };
}

function parseConfirmArgs(tokens) {
  const args = Array.isArray(tokens) ? tokens : [];
  const options = {
    create_tasks: true
  };

  for (const token of args) {
    if (token === '--create-tasks') {
      options.create_tasks = true;
      continue;
    }
    if (token === '--no-create-tasks') {
      options.create_tasks = false;
      continue;
    }
    if (token === '--confirm') {
      continue;
    }
    throw new Error(`Unknown prd confirm option: ${token}`);
  }

  return options;
}

function createPrdCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    resolveProjectRoot,
    updateSession
  } = deps;

  function handlePrdCommands(cmd, subcmd, rest) {
    if (cmd !== 'prd') {
      return undefined;
    }

    const projectRoot = resolveProjectRoot();
    if (!fs.existsSync(runtime.resolveProjectDataPath(projectRoot, 'project.json'))) {
      throw new Error('emb-agent project is not initialized; run init first');
    }

    if (!subcmd || subcmd === 'status' || subcmd === 'show') {
      updateSession(current => {
        current.last_command = 'prd status';
      });
      return {
        command: 'prd status',
        ...summarizePrdConfirmationState(projectRoot, { fs, path, runtime })
      };
    }

    if (subcmd === 'confirm') {
      const options = parseConfirmArgs(rest);
      const state = summarizePrdConfirmationState(projectRoot, { fs, path, runtime });
      const now = new Date().toISOString();
      const taskCreation = options.create_tasks
        ? createExecutionTasks(projectRoot, { fs, path, runtime }, state.task_plan, state.documents)
        : { created: [], skipped: [] };
      const confirmation = {
        status: 'confirmed',
        confirmed_at: now,
        document_manifest: state.documents,
        create_tasks: options.create_tasks,
        generated_tasks: taskCreation.created,
        skipped_tasks: taskCreation.skipped
      };
      const confirmationPath = getConfirmationPath(projectRoot, { fs, path, runtime });
      ensureDir(fs, path.dirname(confirmationPath));
      writeJson(fs, confirmationPath, confirmation);
      updateSession(current => {
        current.last_command = 'prd confirm';
        current.focus = taskCreation.created.length > 0
          ? taskCreation.created[0].title
          : current.focus || '';
      });
      return {
        command: 'prd confirm',
        status: 'confirmed',
        summary: options.create_tasks
          ? `PRD confirmed. Created ${taskCreation.created.length} execution task(s).`
          : 'PRD confirmed. No execution tasks were created.',
        confirmation_path: normalizePath(path.relative(projectRoot, confirmationPath)),
        documents: state.documents,
        created_tasks: taskCreation.created,
        skipped_tasks: taskCreation.skipped,
        alignment: buildPrdTaskAlignment(taskCreation),
        next: taskCreation.created.length > 0
          ? {
              command: `task activate ${taskCreation.created[0].name}`,
              reason: `PRD is confirmed. Activate ${taskCreation.created[0].name} to start implementation.`,
              cli: `task activate ${taskCreation.created[0].name}`
            }
          : {
              command: 'task add <summary>',
              reason: 'PRD is confirmed. Create a concrete execution task when ready.',
              cli: 'task add <summary>'
            }
      };
    }

    if (subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
      return {
        command: 'prd',
        usage: [
          'prd status',
          'prd confirm [--create-tasks|--no-create-tasks]'
        ],
        notes: [
          'prd confirm records the current docs/prd manifest as the approved contract.',
          'By default, prd confirm creates concrete execution tasks from execution PRDs under docs/prd/subsystems, docs/prd/features, docs/prd/modules, docs/prd/components, plus docs/prd/verification.md when present.'
        ]
      };
    }

    throw new Error(`Unknown prd subcommand: ${subcmd}`);
  }

  return {
    handlePrdCommands
  };
}

module.exports = {
  PRD_CONFIRMATION_FILE,
  summarizePrdConfirmationState,
  buildPrdTaskPlan,
  createPrdCommandHelpers
};
