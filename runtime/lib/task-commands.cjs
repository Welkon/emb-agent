'use strict';

const os = require('os');

const permissionGateHelpers = require('./permission-gates.cjs');
const workflowRegistry = require('./workflow-registry.cjs');

function createTaskCommandHelpers(deps) {
  const {
    childProcess,
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
  const AAR_QUESTION_DEFS = [
    {
      id: 'new_pattern',
      flag: '--aar-new-pattern',
      prompt: '新模式? — 用了未记录的模式或约定吗?'
    },
    {
      id: 'new_trap',
      flag: '--aar-new-trap',
      prompt: '新陷阱? — 遇到了不提前知道就会浪费大量时间的问题吗?'
    },
    {
      id: 'missing_rule',
      flag: '--aar-missing-rule',
      prompt: '缺失规则? — 因为缺少某条规则导致走了弯路吗?'
    },
    {
      id: 'outdated_rule',
      flag: '--aar-outdated-rule',
      prompt: '过时规则? — 发现现有规则已经不准确或不再适用吗?'
    }
  ];
  const AAR_SKIP_REASON_ALIASES = {
    'format-only': 'format-only',
    'comment-only': 'comment-only',
    'dependency-version-only': 'dependency-version-only',
    'deps-only': 'dependency-version-only',
    'dependency-only': 'dependency-version-only',
    'no-new-lesson-refactor': 'no-new-lesson-refactor',
    'refactor-no-lesson': 'no-new-lesson-refactor'
  };
  const AAR_SKIP_REASON_LABELS = {
    'format-only': '仅格式化',
    'comment-only': '仅注释',
    'dependency-version-only': '仅依赖版本变更',
    'no-new-lesson-refactor': '无新教训的重构'
  };
  const AAR_RATIONALIZATIONS = [
    {
      excuse: '这次任务很小,AAR 没必要',
      rebuttal: '小任务正是教训藏身的地方。30 秒扫完,跳过比做还慢'
    },
    {
      excuse: '等会话结束再一起补 AAR',
      rebuttal: '你会忘。扫描必须在任务收尾做,不能批处理'
    },
    {
      excuse: '用户在赶时间',
      rebuttal: '赶时间是最容易踩坑的时刻。压力是跑 AAR 的理由,不是跳过的理由'
    },
    {
      excuse: '这条经验我已经知道了,不用记',
      rebuttal: '记录是给未来的 Agent 看的,不是给现在的你'
    },
    {
      excuse: '这个已经在现有规则里了',
      rebuttal: '那 10 秒内就能扫完,跑了比争论快'
    }
  ];
  const AAR_RED_FLAGS = [
    '发现自己在想"这次 AAR 就算了"',
    '任务声明完成但没跑 30 秒扫描',
    '把 gotcha 写进了 reference,但没更新对应 workflow 的完成清单',
    '修了同一类 bug 第二次,但规则文件没动过'
  ];
  const DEFAULT_TASK_PHASES = [
    { phase: 1, action: 'implement' },
    { phase: 2, action: 'check' },
    { phase: 3, action: 'finish' },
    { phase: 4, action: 'create-pr' }
  ];

  function stripPermissionControlTokens(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    const filtered = [];
    let explicitConfirmation = false;

    for (const token of list) {
      if (token === '--confirm') {
        explicitConfirmation = true;
        continue;
      }
      filtered.push(token);
    }

    return {
      tokens: filtered,
      explicit_confirmation: explicitConfirmation
    };
  }

  function applyTaskWritePermission(result, actionName, explicitConfirmation) {
    const permission = permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: actionName,
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });

    return {
      permission,
      result: permissionGateHelpers.applyPermissionDecision(result, permission)
    };
  }

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

  function getManagedTaskWorkspaceRoot() {
    return path.join(os.tmpdir(), 'emb-agent-task-worktrees', runtime.getProjectKey(resolveProjectRoot()));
  }

  function getDefaultTaskWorkspacePath(name) {
    return path.join(getManagedTaskWorkspaceRoot(), name);
  }

  function getTaskManifestPath(name) {
    return path.join(getTaskDir(name), 'task.json');
  }

  function getTaskContextPath(name, channel) {
    return path.join(getTaskDir(name), `${channel}.jsonl`);
  }

  function getCurrentTaskPointerPath() {
    return path.join(getProjectExtDir(), '.current-task');
  }

  function syncCurrentTaskPointer(name) {
    const normalized = String(name || '').trim();
    fs.writeFileSync(getCurrentTaskPointerPath(), normalized ? `${normalized}\n` : '', 'utf8');
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
    const control = stripPermissionControlTokens(rest);
    const tokens = control.tokens;
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

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === '--type') {
        result.type = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--description') {
        result.description = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--dev-type') {
        result.devType = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--scope') {
        result.scope = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--priority') {
        result.priority = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--creator') {
        result.creator = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--assignee') {
        result.assignee = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--branch') {
        result.branch = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--base-branch') {
        result.baseBranch = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--worktree-path') {
        result.worktreePath = tokens[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--note') {
        result.notes = tokens[index + 1] || '';
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
    result.explicit_confirmation = control.explicit_confirmation;
    return result;
  }

  function parseTaskContextArgs(rest) {
    const control = stripPermissionControlTokens(rest);
    const tokens = control.tokens;
    if (!tokens[0]) throw new Error('Missing task name');
    if (!tokens[1]) throw new Error('Missing context channel');
    if (!tokens[2]) throw new Error('Missing context path');

    return {
      name: tokens[0],
      channel: ensureContextChannel(tokens[1]),
      targetPath: runtime.normalizeProjectRelativePath(tokens[2]),
      reason: tokens.slice(3).join(' ').trim() || 'Added manually',
      explicit_confirmation: control.explicit_confirmation
    };
  }

  function parseNamedTaskWriteArgs(rest, commandLabel) {
    const control = stripPermissionControlTokens(rest);
    const tokens = control.tokens;
    const name = String(tokens[0] || '').trim();

    if (!name) {
      throw new Error(`Missing task name${commandLabel ? ` for ${commandLabel}` : ''}`);
    }

    return {
      name,
      rest: tokens.slice(1),
      explicit_confirmation: control.explicit_confirmation
    };
  }

  function buildDefaultAarState() {
    return {
      required: true,
      scan_completed: false,
      scan_completed_at: '',
      skip_reason: '',
      questions: Object.fromEntries(AAR_QUESTION_DEFS.map(item => [item.id, null])),
      triggered_questions: [],
      record_required: false,
      record_completed: false,
      record_completed_at: '',
      summary: '',
      detail: '',
      artifact_path: '',
      workflow_update_needed: false
    };
  }

  function normalizeAarQuestionValue(value) {
    if (value === true || value === false) {
      return value;
    }
    if (value === null) {
      return null;
    }
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (['yes', 'y', 'true', '1'].includes(normalized)) {
      return true;
    }
    if (['no', 'n', 'false', '0'].includes(normalized)) {
      return false;
    }
    throw new Error(`Unsupported AAR answer: ${value}`);
  }

  function normalizeAarSkipReason(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }
    const alias = AAR_SKIP_REASON_ALIASES[normalized];
    if (!alias) {
      throw new Error(`Unsupported AAR skip reason: ${value}`);
    }
    return alias;
  }

  function normalizeTaskAar(source) {
    const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const questions = buildDefaultAarState().questions;
    Object.keys(questions).forEach(key => {
      questions[key] = normalizeAarQuestionValue(value.questions ? value.questions[key] : null);
    });
    const triggered = AAR_QUESTION_DEFS
      .filter(item => questions[item.id] === true)
      .map(item => item.id);

    return {
      required: value.required !== false,
      scan_completed: value.scan_completed === true,
      scan_completed_at: String(value.scan_completed_at || ''),
      skip_reason: normalizeAarSkipReason(value.skip_reason || ''),
      questions,
      triggered_questions: Array.isArray(value.triggered_questions) && value.triggered_questions.length > 0
        ? value.triggered_questions.map(item => String(item))
        : triggered,
      record_required: value.record_required === true || triggered.length > 0,
      record_completed: value.record_completed === true,
      record_completed_at: String(value.record_completed_at || ''),
      summary: String(value.summary || ''),
      detail: String(value.detail || ''),
      artifact_path: String(value.artifact_path || ''),
      workflow_update_needed: value.workflow_update_needed === true
    };
  }

  function getTaskAarArtifactPath(name) {
    return path.join(getTaskDir(name), 'aar.md');
  }

  function buildAarQuestionPrompts() {
    return AAR_QUESTION_DEFS.map(item => ({
      id: item.id,
      flag: item.flag,
      prompt: item.prompt
    }));
  }

  function buildAarGuidance() {
    return {
      protocol: [
        '主体工作完成并验证',
        '完成 30 秒 AAR 扫描',
        '若任一答案为 yes, 必须完成录入并通过后才能声明任务完成'
      ],
      skip_reasons: Object.entries(AAR_SKIP_REASON_LABELS).map(([key, label]) => ({
        id: key,
        label
      })),
      rationalizations: AAR_RATIONALIZATIONS.slice(),
      red_flags: AAR_RED_FLAGS.slice()
    };
  }

  function parseTaskAarFlags(tokens, options = {}) {
    const result = {
      note_parts: [],
      questions: {},
      skip_reason: '',
      summary: '',
      detail: ''
    };
    const allowFreeText = options.allowFreeText !== false;

    for (let index = 0; index < tokens.length; index += 1) {
      const token = String(tokens[index] || '');
      const question = AAR_QUESTION_DEFS.find(item => item.flag === token);
      if (question) {
        result.questions[question.id] = normalizeAarQuestionValue(tokens[index + 1]);
        index += 1;
        continue;
      }
      if (token === '--aar-skip-reason') {
        result.skip_reason = normalizeAarSkipReason(tokens[index + 1]);
        index += 1;
        continue;
      }
      if (token === '--aar-summary') {
        result.summary = String(tokens[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--aar-detail') {
        result.detail = String(tokens[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (!allowFreeText && token.startsWith('--aar-')) {
        throw new Error(`Unknown AAR flag: ${token}`);
      }
      if (allowFreeText) {
        result.note_parts.push(token);
      }
    }

    return result;
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function hasAnyAarQuestionInput(input) {
    return AAR_QUESTION_DEFS.some(item => hasOwn(input.questions, item.id));
  }

  function getMissingAarQuestions(questions) {
    return AAR_QUESTION_DEFS
      .filter(item => questions[item.id] !== true && questions[item.id] !== false)
      .map(item => item.id);
  }

  function buildAarTriggeredQuestions(questions) {
    return AAR_QUESTION_DEFS
      .filter(item => questions[item.id] === true)
      .map(item => item.id);
  }

  function shouldFlagWorkflowUpdate(triggeredQuestions) {
    return (triggeredQuestions || []).some(item => item === 'missing_rule' || item === 'outdated_rule');
  }

  function buildTaskAarArtifactContent(task, aar) {
    const questionLines = AAR_QUESTION_DEFS.map(item => {
      const answer = aar.questions[item.id] === true ? 'yes' : aar.questions[item.id] === false ? 'no' : 'unanswered';
      return `- ${item.prompt} ${answer}`;
    });
    const triggeredLabels = (aar.triggered_questions || [])
      .map(id => {
        const match = AAR_QUESTION_DEFS.find(item => item.id === id);
        return match ? match.prompt : id;
      });

    return [
      '# Task AAR',
      '',
      `- Task: ${task.name}`,
      `- Title: ${task.title}`,
      `- Completed scan: ${aar.scan_completed_at || ''}`,
      `- Completed record: ${aar.record_completed_at || ''}`,
      `- Skip reason: ${aar.skip_reason || 'none'}`,
      '',
      '## Scan',
      '',
      ...questionLines,
      '',
      '## Triggered',
      '',
      ...(triggeredLabels.length > 0 ? triggeredLabels.map(item => `- ${item}`) : ['- none']),
      '',
      '## Summary',
      '',
      aar.summary || 'None.',
      '',
      '## Detail',
      '',
      aar.detail || 'None.',
      '',
      '## Workflow Follow-up',
      '',
      `- Needed: ${aar.workflow_update_needed ? 'yes' : 'no'}`,
      ''
    ].join('\n');
  }

  function removeTaskAarArtifact(name) {
    const artifactPath = getTaskAarArtifactPath(name);
    if (fs.existsSync(artifactPath)) {
      fs.unlinkSync(artifactPath);
    }
  }

  function writeTaskAarArtifact(task, aar) {
    const artifactPath = getTaskAarArtifactPath(task.name);
    runtime.ensureDir(path.dirname(artifactPath));
    fs.writeFileSync(artifactPath, buildTaskAarArtifactContent(task, aar), 'utf8');
    return path.relative(resolveProjectRoot(), artifactPath);
  }

  function buildAarGateResult(status, task, aar, extra = {}) {
    return {
      status,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      },
      aar,
      guidance: {
        questions: buildAarQuestionPrompts(),
        ...buildAarGuidance()
      },
      ...extra
    };
  }

  function applyAarUpdate(task, manifest, input, options = {}) {
    const now = new Date().toISOString();
    const current = normalizeTaskAar(manifest.aar);
    const next = normalizeTaskAar({
      ...current,
      questions: current.questions
    });
    const scanTouched = hasAnyAarQuestionInput(input) || Boolean(input.skip_reason);
    const recordTouched = Boolean(input.summary || input.detail);

    if (scanTouched) {
      AAR_QUESTION_DEFS.forEach(item => {
        if (hasOwn(input.questions, item.id)) {
          next.questions[item.id] = normalizeAarQuestionValue(input.questions[item.id]);
        }
      });
      next.skip_reason = input.skip_reason || '';

      const missingQuestions = getMissingAarQuestions(next.questions);
      if (missingQuestions.length > 0) {
        return {
          ok: false,
          result: buildAarGateResult('aar-required', task, next, {
            message: 'Task completion requires a full 30-second AAR scan.',
            missing_questions: missingQuestions
          })
        };
      }

      next.scan_completed = true;
      next.scan_completed_at = now;
      next.triggered_questions = buildAarTriggeredQuestions(next.questions);
      next.record_required = next.triggered_questions.length > 0;
      next.record_completed = false;
      next.record_completed_at = '';
      next.summary = '';
      next.detail = '';
      next.artifact_path = '';
      next.workflow_update_needed = shouldFlagWorkflowUpdate(next.triggered_questions);

      if (next.skip_reason && next.record_required) {
        return {
          ok: false,
          result: buildAarGateResult('aar-invalid', task, next, {
            message: 'A trivial-task skip reason cannot be combined with triggered AAR questions.'
          })
        };
      }

      removeTaskAarArtifact(task.name);
    }

    if (options.requireScan && !next.scan_completed) {
      return {
        ok: false,
        result: buildAarGateResult('aar-required', task, next, {
          message: 'Task completion requires a completed AAR scan before resolve.',
          missing_questions: getMissingAarQuestions(next.questions)
        })
      };
    }

    if (recordTouched && !next.record_required) {
      return {
        ok: false,
        result: buildAarGateResult('aar-record-not-needed', task, next, {
          message: 'AAR record input is only valid when at least one scan answer is yes.'
        })
      };
    }

    if (recordTouched) {
      if (!input.summary || !input.detail) {
        return {
          ok: false,
          result: buildAarGateResult('aar-record-required', task, next, {
            message: 'Triggered AAR questions require both --aar-summary and --aar-detail.',
            missing_fields: ['summary', 'detail'].filter(field => !input[field])
          })
        };
      }
      next.record_completed = true;
      next.record_completed_at = now;
      next.summary = input.summary;
      next.detail = input.detail;
      next.artifact_path = writeTaskAarArtifact(task, next);
    }

    if (options.requireRecord && next.record_required && !next.record_completed) {
      return {
        ok: false,
        result: buildAarGateResult('aar-record-required', task, next, {
          message: 'At least one AAR answer is yes, so a recorded AAR entry is required before resolve.',
          missing_fields: ['summary', 'detail']
        })
      };
    }

    return {
      ok: true,
      aar: next
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

    (session.last_files || []).forEach(item => {
      baseEntries.push({
        path: item,
        reason: 'Recently related files'
      });
    });

    return uniqueContextEntries(baseEntries);
  }

  function buildInjectedSpecContext(taskLike, session) {
    const summary = session || loadSession();
    return workflowRegistry.buildInjectedSpecSnapshot(rootDir, getProjectExtDir(), {
      profile: (summary && summary.project_profile) || '',
      packs: (summary && summary.active_packs) || [],
      task: taskLike || null,
      handoff: null
    }, { limit: 8 });
  }

  function getTaskAutoSpecsPath(name) {
    return path.join(getTaskDir(name), 'auto-specs.md');
  }

  function getTaskPrdPath(name) {
    return path.join(getTaskDir(name), 'prd.md');
  }

  function buildTaskPrdContent(task) {
    const taskLike = task || {};
    const bindings = taskLike.bindings || {};
    const hardware = bindings.hardware && bindings.hardware.identity ? bindings.hardware.identity : {};
    const references = Array.isArray(taskLike.references) ? taskLike.references.filter(Boolean) : [];
    const openQuestions = Array.isArray(taskLike.open_questions) ? taskLike.open_questions.filter(Boolean) : [];
    const knownRisks = Array.isArray(taskLike.known_risks) ? taskLike.known_risks.filter(Boolean) : [];
    const constraints = [];

    if (hardware.model || hardware.package) {
      constraints.push(`${hardware.model || 'unknown MCU'} ${hardware.package || ''}`.trim());
    }

    return [
      `# ${taskLike.title || taskLike.name || 'Task PRD'}`,
      '',
      '## Goal',
      '',
      taskLike.goal || taskLike.description || taskLike.title || 'Define the smallest durable outcome for this task.',
      '',
      '## Scope',
      '',
      `- Type: ${taskLike.type || 'implement'}`,
      `- Priority: ${taskLike.priority || 'P2'}`,
      `- Status: ${taskLike.status || 'planning'}`,
      '',
      '## Constraints',
      '',
      ...(constraints.length > 0 ? constraints.map(item => `- ${item}`) : ['- Keep the change narrow and tied to project truth/evidence.']),
      '',
      '## Acceptance Checklist',
      '',
      '- [ ] Relevant truth and evidence were re-read before changing code or docs',
      '- [ ] The minimal required implementation or analysis result is produced',
      '- [ ] Verification evidence is captured explicitly',
      '- [ ] AAR scan is completed before task resolve',
      '',
      '## References',
      '',
      ...(references.length > 0 ? references.map(item => `- ${item}`) : ['- None yet']),
      '',
      '## Open Questions',
      '',
      ...(openQuestions.length > 0 ? openQuestions.map(item => `- ${item}`) : ['- None recorded']),
      '',
      '## Known Risks',
      '',
      ...(knownRisks.length > 0 ? knownRisks.map(item => `- ${item}`) : ['- None recorded']),
      ''
    ].join('\n');
  }

  function ensureTaskPrd(taskLike) {
    const task = taskLike || {};
    const prdPath = getTaskPrdPath(task.name);
    runtime.ensureDir(path.dirname(prdPath));
    fs.writeFileSync(prdPath, buildTaskPrdContent(task), 'utf8');
    return path.relative(resolveProjectRoot(), prdPath).replace(/\\/g, '/');
  }

  function buildTaskAutoSpecsArtifact(taskName, taskLike, session) {
    const injected = buildInjectedSpecContext(taskLike, session);
    const lines = [
      '# Auto Injected Specs',
      '',
      `- Task: ${taskLike && taskLike.name ? taskLike.name : taskName}`,
      `- Profile: ${(session && session.project_profile) || ''}`,
      `- Packs: ${((session && session.active_packs) || []).join(', ') || '-'}`,
      ''
    ];

    if ((injected.items || []).length === 0) {
      lines.push('- No auto-injected specs matched this task state.', '');
    } else {
      lines.push('## Selected Specs', '');
      injected.items.forEach(item => {
        lines.push(`### ${item.title || item.name}`);
        lines.push(`- Name: ${item.name}`);
        lines.push(`- Path: ${item.display_path}`);
        lines.push(`- Scope: ${item.scope}`);
        lines.push(`- Priority: ${item.priority}`);
        lines.push(`- Reasons: ${(item.reasons || []).join(', ') || '-'}`);
        if (item.summary) {
          lines.push(`- Summary: ${item.summary}`);
        }
        lines.push('');
        lines.push('```md');
        lines.push(runtime.readText(item.absolute_path).trim());
        lines.push('```');
        lines.push('');
      });
    }

    fs.writeFileSync(getTaskAutoSpecsPath(taskName), `${lines.join('\n').trim()}\n`, 'utf8');
    return {
      path: path.relative(resolveProjectRoot(), getTaskAutoSpecsPath(taskName)).replace(/\\/g, '/'),
      specs: injected.items.map(item => ({
        name: item.name,
        title: item.title || item.name,
        summary: item.summary,
        display_path: item.display_path,
        scope: item.scope,
        priority: item.priority,
        reasons: item.reasons || []
      }))
    };
  }

  function ensureTaskInjectedSpecContext(taskName, taskLike, session) {
    const generated = buildTaskAutoSpecsArtifact(taskName, taskLike, session);
    CONTEXT_CHANNELS.forEach(channel => {
      const next = uniqueContextEntries([
        {
          kind: 'file',
          path: generated.path,
          reason: 'Auto-injected task specs'
        },
        ...readJsonl(getTaskContextPath(taskName, channel))
      ]);
      writeJsonl(getTaskContextPath(taskName, channel), next);
    });
    return generated;
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
      aar: buildDefaultAarState(),
      injected_specs: [],
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

  function runGit(args, cwd, label) {
    try {
      return childProcess.execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      const detail = error && error.stderr ? String(error.stderr).trim() : error.message;
      throw new Error(`${label} failed: ${detail}`);
    }
  }

  function hasGitRoot(projectRoot) {
    return fs.existsSync(path.join(projectRoot, '.git'));
  }

  function resolveTaskWorkspacePath(task) {
    const configuredPath = String(task && task.worktree_path ? task.worktree_path : '').trim();
    if (configuredPath) {
      return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(resolveProjectRoot(), configuredPath);
    }
    return getDefaultTaskWorkspacePath(task.name);
  }

  function isManagedTaskWorkspace(targetPath) {
    const root = getManagedTaskWorkspaceRoot();
    const relative = path.relative(root, targetPath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  function removePathIfManaged(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return;
    }
    if (!isManagedTaskWorkspace(targetPath)) {
      throw new Error(`Refusing to remove unmanaged task workspace: ${targetPath}`);
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  function resolveGitBaseRef(task) {
    const projectRoot = resolveProjectRoot();
    const candidate = String(task.base_branch || '').trim();

    if (candidate) {
      try {
        runGit(['rev-parse', '--verify', candidate], projectRoot, `git rev-parse for ${candidate}`);
        return candidate;
      } catch {
        // fall through to HEAD
      }
    }

    return 'HEAD';
  }

  function copyProjectTree(sourceRoot, targetRoot) {
    const skipTopLevel = new Set(['.git', '.emb-agent']);

    function copyRecursive(currentSource, currentTarget, depth) {
      runtime.ensureDir(currentTarget);

      fs.readdirSync(currentSource, { withFileTypes: true }).forEach(entry => {
        if (depth === 0 && skipTopLevel.has(entry.name)) {
          return;
        }

        const sourcePath = path.join(currentSource, entry.name);
        const targetPath = path.join(currentTarget, entry.name);

        if (entry.isDirectory()) {
          copyRecursive(sourcePath, targetPath, depth + 1);
          return;
        }

        if (entry.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(sourcePath);
          fs.symlinkSync(linkTarget, targetPath);
          return;
        }

        if (entry.isFile()) {
          runtime.ensureDir(path.dirname(targetPath));
          fs.copyFileSync(sourcePath, targetPath);
        }
      });
    }

    copyRecursive(sourceRoot, targetRoot, 0);
  }

  function ensureTaskWorkspace(task) {
    const projectRoot = resolveProjectRoot();
    const targetPath = resolveTaskWorkspacePath(task);
    const created = !fs.existsSync(targetPath);

    if (!created) {
      return {
        mode: hasGitRoot(projectRoot) ? 'git-worktree' : 'copy',
        created: false,
        path: targetPath
      };
    }

    runtime.ensureDir(path.dirname(targetPath));

    if (hasGitRoot(projectRoot)) {
      const baseRef = resolveGitBaseRef(task);
      const branchName = String(task.branch || '').trim();

      if (branchName) {
        let branchExists = false;
        try {
          runGit(['rev-parse', '--verify', `refs/heads/${branchName}`], projectRoot, `git branch lookup for ${branchName}`);
          branchExists = true;
        } catch {
          branchExists = false;
        }

        runGit(
          branchExists
            ? ['worktree', 'add', targetPath, branchName]
            : ['worktree', 'add', '-b', branchName, targetPath, baseRef],
          projectRoot,
          `git worktree add for task ${task.name}`
        );
      } else {
        runGit(
          ['worktree', 'add', '--detach', targetPath, baseRef],
          projectRoot,
          `git worktree add for task ${task.name}`
        );
      }

      return {
        mode: 'git-worktree',
        created: true,
        path: targetPath
      };
    }

    copyProjectTree(projectRoot, targetPath);
    return {
      mode: 'copy',
      created: true,
      path: targetPath
    };
  }

  function cleanupTaskWorkspace(task) {
    const targetPath = resolveTaskWorkspacePath(task);
    if (!targetPath || !fs.existsSync(targetPath)) {
      return {
        cleaned: false,
        path: targetPath
      };
    }

    if (hasGitRoot(resolveProjectRoot())) {
      try {
        runGit(['worktree', 'remove', '--force', targetPath], resolveProjectRoot(), `git worktree remove for task ${task.name}`);
        return {
          cleaned: true,
          path: targetPath
        };
      } catch (error) {
        if (!isManagedTaskWorkspace(targetPath)) {
          return {
            cleaned: false,
            path: targetPath,
            error: error.message
          };
        }
      }
    }

    try {
      removePathIfManaged(targetPath);
      return {
        cleaned: true,
        path: targetPath
      };
    } catch (error) {
      return {
        cleaned: false,
        path: targetPath,
        error: error.message
      };
    }
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
      injected_specs: Array.isArray(manifest.injected_specs) ? manifest.injected_specs : [],
      aar: normalizeTaskAar(manifest.aar),
      artifacts: {
        prd: fs.existsSync(getTaskPrdPath(name))
          ? path.relative(resolveProjectRoot(), getTaskPrdPath(name)).replace(/\\/g, '/')
          : '',
        auto_specs: fs.existsSync(getTaskAutoSpecsPath(name))
          ? path.relative(resolveProjectRoot(), getTaskAutoSpecsPath(name)).replace(/\\/g, '/')
          : '',
        aar: fs.existsSync(getTaskAarArtifactPath(name))
          ? path.relative(resolveProjectRoot(), getTaskAarArtifactPath(name)).replace(/\\/g, '/')
          : ''
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
    const previewBindings = buildTaskBindings(parsed.summary);
    const blocked = applyTaskWritePermission({
      created: false,
      task: {
        title: parsed.summary,
        status: 'planning',
        dev_type: parsed.devType,
        scope: parsed.scope,
        priority: parsed.priority,
        assignee: parsed.assignee || parsed.creator || '',
        type: parsed.type,
        bindings: previewBindings
      }
    }, 'task-add', parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const session = loadSession();
    const name = buildUniqueTaskSlug(parsed.summary);
    const bindings = previewBindings;
    const manifest = buildTaskManifest(name, parsed, parsed.type, session, bindings);

    writeTask(name, manifest);
    const prdPath = ensureTaskPrd({
      ...manifest,
      name,
      title: parsed.summary,
      status: 'planning',
      type: parsed.type
    });
    const injected = ensureTaskInjectedSpecContext(name, {
      name,
      title: parsed.summary,
      status: 'planning',
      type: parsed.type
    }, session);
    CONTEXT_CHANNELS.forEach(channel => {
      writeJsonl(
        getTaskContextPath(name, channel),
        uniqueContextEntries([
          {
            kind: 'file',
            path: injected.path,
            reason: 'Auto-injected task specs'
          },
          {
            kind: 'file',
            path: prdPath,
            reason: 'Task goal, constraints, and acceptance checklist'
          },
          ...buildBindingContextEntries(channel, bindings),
          ...buildDefaultContextEntries(channel, session)
        ])
      );
    });
    writeTask(name, updateTaskTimestamps({
      ...runtime.readJson(getTaskManifestPath(name)),
      injected_specs: injected.specs
    }));

    updateSession(current => {
      current.last_command = 'task add';
    });

    return permissionGateHelpers.applyPermissionDecision({
      created: true,
      task: readTask(name)
    }, blocked.permission);
  }

  function showTask(name) {
    const task = readTask(name);
    updateSession(current => {
      current.last_command = 'task show';
    });
    return { task };
  }

  function activateTask(rest) {
    const input = parseNamedTaskWriteArgs(rest, 'task activate');
    const task = readTask(input.name);
    const blocked = applyTaskWritePermission({
      activated: false,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      }
    }, 'task-activate', input.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const workspace = ensureTaskWorkspace(task);
    const manifest = runtime.readJson(getTaskManifestPath(input.name));
    const session = loadSession();
    const prdPath = ensureTaskPrd({
      ...manifest,
      name: task.name,
      title: task.title,
      status: 'in_progress',
      type: task.type,
      goal: task.goal,
      description: task.description,
      bindings: task.bindings,
      references: task.references,
      open_questions: task.open_questions,
      known_risks: task.known_risks,
      priority: task.priority
    });
    const injected = ensureTaskInjectedSpecContext(input.name, {
      name: task.name,
      title: task.title,
      status: 'in_progress',
      type: task.type
    }, session);
    writeTask(input.name, updateTaskTimestamps({
      ...manifest,
      status: 'in_progress',
      current_phase: 1,
      worktree_path: workspace.path,
      injected_specs: injected.specs
    }));
    CONTEXT_CHANNELS.forEach(channel => {
      const next = uniqueContextEntries([
        {
          kind: 'file',
          path: prdPath,
          reason: 'Task goal, constraints, and acceptance checklist'
        },
        ...readJsonl(getTaskContextPath(input.name, channel))
      ]);
      writeJsonl(getTaskContextPath(input.name, channel), next);
    });

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
    syncCurrentTaskPointer(task.name);

    return permissionGateHelpers.applyPermissionDecision({
      activated: true,
      task: readTask(input.name),
      workspace
    }, blocked.permission);
  }

  function resolveTask(rest) {
    const input = parseNamedTaskWriteArgs(rest, 'task resolve');
    const aarInput = parseTaskAarFlags(input.rest, { allowFreeText: true });
    const note = aarInput.note_parts.join(' ').trim();
    const task = readTask(input.name);
    const blocked = applyTaskWritePermission({
      resolved: false,
      task: {
        name: task.name,
        title: task.title,
        status: task.status,
        notes: note
      }
    }, 'task-resolve', input.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const manifestPath = getTaskManifestPath(input.name);
    const manifest = runtime.readJson(manifestPath);
    const aarUpdate = applyAarUpdate(task, manifest, aarInput, {
      requireScan: true,
      requireRecord: true
    });
    if (!aarUpdate.ok) {
      return aarUpdate.result;
    }
    const workspaceCleanup = cleanupTaskWorkspace(task);
    const session = loadSession();
    const shouldClearActiveTask = Boolean(session.active_task && session.active_task.name === input.name);
    writeTask(input.name, updateTaskTimestamps({
      ...manifest,
      status: 'completed',
      current_phase: 4,
      completedAt: new Date().toISOString(),
      worktree_path: null,
      notes: note || manifest.notes || '',
      resolution_note: note || manifest.resolution_note || '',
      aar: aarUpdate.aar
    }));

    updateSession(current => {
      current.last_command = 'task resolve';
      if (current.active_task && current.active_task.name === input.name) {
        current.active_task = {
          name: '',
          title: '',
          status: '',
          path: '',
          updated_at: ''
        };
      }
    });
    if (shouldClearActiveTask) {
      syncCurrentTaskPointer('');
    }

    return permissionGateHelpers.applyPermissionDecision({
      resolved: true,
      task: readTask(input.name),
      workspace_cleanup: workspaceCleanup
    }, blocked.permission);
  }

  function scanTaskAar(rest) {
    const input = parseNamedTaskWriteArgs(rest, 'task aar scan');
    const task = readTask(input.name);
    const blocked = applyTaskWritePermission({
      scanned: false,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      }
    }, 'task-aar-scan', input.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const manifestPath = getTaskManifestPath(input.name);
    const manifest = runtime.readJson(manifestPath);
    const aarInput = parseTaskAarFlags(input.rest, { allowFreeText: false });
    const aarUpdate = applyAarUpdate(task, manifest, aarInput, {});
    if (!aarUpdate.ok) {
      return aarUpdate.result;
    }

    if (!hasAnyAarQuestionInput(aarInput) && !aarInput.skip_reason) {
      return buildAarGateResult('aar-required', task, normalizeTaskAar(manifest.aar), {
        message: 'Provide all four AAR answers to complete the scan step.',
        missing_questions: getMissingAarQuestions(normalizeTaskAar(manifest.aar).questions)
      });
    }

    writeTask(input.name, updateTaskTimestamps({
      ...manifest,
      aar: aarUpdate.aar
    }));

    updateSession(current => {
      current.last_command = 'task aar scan';
    });

    return permissionGateHelpers.applyPermissionDecision({
      scanned: true,
      task: readTask(input.name),
      aar: readTask(input.name).aar,
      guidance: {
        questions: buildAarQuestionPrompts(),
        ...buildAarGuidance()
      }
    }, blocked.permission);
  }

  function recordTaskAar(rest) {
    const input = parseNamedTaskWriteArgs(rest, 'task aar record');
    const task = readTask(input.name);
    const blocked = applyTaskWritePermission({
      recorded: false,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      }
    }, 'task-aar-record', input.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    const manifestPath = getTaskManifestPath(input.name);
    const manifest = runtime.readJson(manifestPath);
    const aarInput = parseTaskAarFlags(input.rest, { allowFreeText: false });
    const aarUpdate = applyAarUpdate(task, manifest, aarInput, {
      requireScan: true,
      requireRecord: true
    });
    if (!aarUpdate.ok) {
      return aarUpdate.result;
    }

    writeTask(input.name, updateTaskTimestamps({
      ...manifest,
      aar: aarUpdate.aar
    }));

    updateSession(current => {
      current.last_command = 'task aar record';
    });

    return permissionGateHelpers.applyPermissionDecision({
      recorded: true,
      task: readTask(input.name),
      aar: readTask(input.name).aar,
      guidance: {
        questions: buildAarQuestionPrompts(),
        ...buildAarGuidance()
      }
    }, blocked.permission);
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
    const blocked = applyTaskWritePermission({
      updated: false,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      },
      channel: parsed.channel,
      entries: [
        {
          kind: 'file',
          path: parsed.targetPath,
          reason: parsed.reason
        }
      ]
    }, 'task-context-add', parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

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

    return permissionGateHelpers.applyPermissionDecision({
      updated: true,
      task: {
        name: task.name,
        title: task.title,
        status: task.status
      },
      channel: parsed.channel,
      entries: next
    }, blocked.permission);
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
      return activateTask(rest);
    }

    if (subcmd === 'resolve') {
      return resolveTask(rest);
    }

    if (subcmd === 'aar' && (!rest[0] || rest[0] === 'help')) {
      return {
        guidance: {
          questions: buildAarQuestionPrompts(),
          ...buildAarGuidance()
        }
      };
    }

    if (subcmd === 'aar' && rest[0] === 'scan') {
      return scanTaskAar(rest.slice(1));
    }

    if (subcmd === 'aar' && rest[0] === 'record') {
      return recordTaskAar(rest.slice(1));
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
