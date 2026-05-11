'use strict';

const crypto = require('crypto');

const DECISION_DIR = 'wiki/decisions';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function ensureDir(fs, dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 8);
}

function slugify(value, fallback) {
  const base = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return base || `${String(fallback || 'decision').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${shortHash(value).slice(0, 6)}`;
}

function quoteCli(value) {
  const text = String(value || '');
  if (!text) return "''";
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function parseOptionValue(tokens, index, flag) {
  const next = tokens[index + 1];
  if (next === undefined || String(next).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return String(next);
}

function parseDecisionArgs(tokens) {
  const args = Array.isArray(tokens) ? tokens.map(item => String(item)) : [];
  const options = {
    question: '',
    context: '',
    chosen: '',
    options: [],
    rejected: [],
    evidence: [],
    notes: [],
    confirm: false,
    positionals: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--confirm') {
      options.confirm = true;
      continue;
    }
    if (token === '--question' || token === '-q') {
      options.question = parseOptionValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--context' || token === '-c') {
      options.context = parseOptionValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--chosen' || token === '--choice') {
      options.chosen = parseOptionValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--option' || token === '-o') {
      options.options.push(parseOptionValue(args, index, token));
      index += 1;
      continue;
    }
    if (token === '--reject' || token === '--rejected') {
      const raw = parseOptionValue(args, index, token);
      const match = raw.match(/^([^:]+)::?\s*(.*)$/);
      options.rejected.push(match
        ? { option: match[1].trim(), reason: match[2].trim() }
        : { option: raw.trim(), reason: '' });
      index += 1;
      continue;
    }
    if (token === '--evidence' || token === '-e') {
      options.evidence.push(parseOptionValue(args, index, token));
      index += 1;
      continue;
    }
    if (token === '--note' || token === '--reason') {
      options.notes.push(parseOptionValue(args, index, token));
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown decision option: ${token}`);
    }
    options.positionals.push(token);
  }

  if (!options.question && options.positionals.length > 0) {
    options.question = options.positionals.join(' ').trim();
  }
  options.question = String(options.question || '').trim();
  options.context = String(options.context || '').trim();
  options.chosen = String(options.chosen || '').trim();
  options.options = [...new Set(options.options.map(item => String(item || '').trim()).filter(Boolean))];
  options.evidence = [...new Set(options.evidence.map(item => normalizePath(item)).filter(Boolean))];
  options.notes = options.notes.map(item => String(item || '').trim()).filter(Boolean);
  options.rejected = options.rejected
    .map(item => ({
      option: String(item.option || '').trim(),
      reason: String(item.reason || '').trim()
    }))
    .filter(item => item.option);

  return options;
}

function getDecisionRoot(projectRoot, deps) {
  const { path, runtime } = deps;
  return path.join(runtime.resolveProjectDataPath(projectRoot, ''), DECISION_DIR);
}

function decisionRelativePath(filePath, projectRoot, deps) {
  const { path } = deps;
  return normalizePath(path.relative(projectRoot, filePath));
}

function buildReviewQuestions(options) {
  const hasOptions = options.options.length > 0;
  const hasEvidence = options.evidence.length > 0;
  return [
    'What problem does this decision actually solve?',
    hasOptions
      ? 'Which option is the simplest one that satisfies the constraints, and why are the others rejected?'
      : 'What alternatives should be compared before choosing?',
    hasEvidence
      ? 'Does the evidence directly support the chosen option, or only the general problem?'
      : 'Which PRD, code, hardware, or runtime evidence supports this decision?',
    'What failure mode or maintenance cost does this choice introduce?',
    'What would make this decision stale or force a revisit?'
  ];
}

function buildSuggestedRecordCommand(options) {
  const parts = ['decision record', '--question', quoteCli(options.question || '<question>'), '--chosen', '<choice>'];
  for (const option of options.options) {
    parts.push('--option', quoteCli(option));
  }
  for (const evidence of options.evidence) {
    parts.push('--evidence', quoteCli(evidence));
  }
  return parts.join(' ');
}

function buildDecisionMarkdown(decision) {
  const rejected = toArray(decision.rejected);
  const evidence = toArray(decision.evidence);
  const notes = toArray(decision.notes);
  return [
    `# ${decision.question}`,
    '',
    `- Status: ${decision.status}`,
    `- Chosen: ${decision.chosen}`,
    `- Recorded at: ${decision.recorded_at}`,
    '',
    '## Context',
    '',
    decision.context || 'Not specified.',
    '',
    '## Options',
    '',
    ...(toArray(decision.options).length > 0
      ? toArray(decision.options).map(item => `- ${item}`)
      : ['- Not specified.']),
    '',
    '## Rejected options',
    '',
    ...(rejected.length > 0
      ? rejected.map(item => `- ${item.option}${item.reason ? `: ${item.reason}` : ''}`)
      : ['- Not specified.']),
    '',
    '## Evidence',
    '',
    ...(evidence.length > 0 ? evidence.map(item => `- ${item}`) : ['- Not specified.']),
    '',
    '## Notes',
    '',
    ...(notes.length > 0 ? notes.map(item => `- ${item}`) : ['- Not specified.']),
    ''
  ].join('\n');
}

function listDecisionRecords(projectRoot, deps) {
  const { fs, path } = deps;
  const root = getDecisionRoot(projectRoot, deps);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(root)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const filePath = path.join(root, name);
      const record = readJson(fs, filePath);
      if (!record) return null;
      return {
        id: record.id || name.replace(/\.json$/i, ''),
        question: record.question || '',
        chosen: record.chosen || '',
        status: record.status || '',
        recorded_at: record.recorded_at || '',
        path: decisionRelativePath(filePath, projectRoot, deps),
        markdown_path: record.markdown_path || ''
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.recorded_at || '').localeCompare(String(left.recorded_at || '')));
}

function allocateDecisionPaths(projectRoot, options, deps) {
  const { fs, path } = deps;
  const root = getDecisionRoot(projectRoot, deps);
  const base = slugify(options.question, 'decision');
  let id = base;
  let counter = 2;
  while (fs.existsSync(path.join(root, `${id}.json`)) || fs.existsSync(path.join(root, `${id}.md`))) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return {
    id,
    jsonPath: path.join(root, `${id}.json`),
    markdownPath: path.join(root, `${id}.md`)
  };
}

function createDecisionCommandHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    resolveProjectRoot,
    updateSession
  } = deps;

  function requireInitialized(projectRoot) {
    if (!fs.existsSync(runtime.resolveProjectDataPath(projectRoot, 'project.json'))) {
      throw new Error('emb-agent project is not initialized; run init first');
    }
  }

  function handleDecisionCommands(cmd, subcmd, rest) {
    if (cmd !== 'decision') {
      return undefined;
    }

    const projectRoot = resolveProjectRoot();
    requireInitialized(projectRoot);
    const action = subcmd || 'status';
    const args = parseDecisionArgs(rest);

    if (action === 'help' || action === '--help' || action === '-h' || args.help) {
      return {
        command: 'decision',
        usage: [
          'decision status',
          'decision review --question <text> [--option <text> ...] [--evidence <path> ...]',
          'decision record --question <text> --chosen <text> [--option <text> ...] [--reject <option>::<reason> ...] [--evidence <path> ...] [--note <text> ...]'
        ],
        notes: [
          'Use decision review before implementing an unconfirmed technical choice.',
          'Use decision record to make the chosen option, rejected alternatives, and evidence auditable.'
        ]
      };
    }

    if (action === 'status' || action === 'list') {
      updateSession(current => {
        current.last_command = 'decision status';
      });
      const decisions = listDecisionRecords(projectRoot, { fs, path, runtime });
      return {
        command: 'decision status',
        status: decisions.length > 0 ? 'ok' : 'empty',
        decision_dir: decisionRelativePath(getDecisionRoot(projectRoot, { fs, path, runtime }), projectRoot, { fs, path, runtime }),
        count: decisions.length,
        decisions,
        next: decisions.length > 0
          ? { command: 'next', reason: 'Decision log exists; continue workflow routing.', cli: 'next' }
          : { command: 'decision review', reason: 'No decisions are recorded yet. Review significant technical choices before implementation.', cli: 'decision review --question <text>' }
      };
    }

    if (action === 'review') {
      if (!args.question) {
        throw new Error('decision review requires --question <text> or a positional question');
      }
      updateSession(current => {
        current.last_command = 'decision review';
      });
      const reviewQuestions = buildReviewQuestions(args);
      const suggestedRecordCommand = buildSuggestedRecordCommand(args);
      return {
        command: 'decision review',
        status: 'blocked-by-decision-review',
        summary: 'Technical decision needs explicit review before implementation.',
        decision_review: {
          status: 'needs-decision-record',
          question: args.question,
          context: args.context,
          options: args.options,
          evidence: args.evidence,
          review_questions: reviewQuestions,
          next_command: suggestedRecordCommand
        },
        next: {
          command: 'decision record',
          reason: 'Record the chosen option, rejected alternatives, and evidence before implementation.',
          cli: suggestedRecordCommand
        }
      };
    }

    if (action === 'record') {
      if (!args.question) {
        throw new Error('decision record requires --question <text> or a positional question');
      }
      if (!args.chosen) {
        throw new Error('decision record requires --chosen <text>');
      }
      const root = getDecisionRoot(projectRoot, { fs, path, runtime });
      ensureDir(fs, root);
      const allocated = allocateDecisionPaths(projectRoot, args, { fs, path, runtime });
      const now = new Date().toISOString();
      const options = [...new Set([args.chosen, ...args.options].filter(Boolean))];
      const decision = {
        id: allocated.id,
        status: 'recorded',
        question: args.question,
        context: args.context,
        chosen: args.chosen,
        options,
        rejected: args.rejected,
        evidence: args.evidence,
        notes: args.notes,
        recorded_at: now,
        path: decisionRelativePath(allocated.jsonPath, projectRoot, { fs, path, runtime }),
        markdown_path: decisionRelativePath(allocated.markdownPath, projectRoot, { fs, path, runtime })
      };
      writeJson(fs, allocated.jsonPath, decision);
      fs.writeFileSync(allocated.markdownPath, buildDecisionMarkdown(decision), 'utf8');
      updateSession(current => {
        current.last_command = 'decision record';
        current.focus = args.question;
      });
      return {
        command: 'decision record',
        status: 'recorded',
        summary: `Decision recorded: ${args.chosen}`,
        decision,
        next: {
          command: 'next',
          reason: 'Decision is recorded; return to workflow routing.',
          cli: 'next'
        }
      };
    }

    throw new Error(`Unknown decision subcommand: ${action}`);
  }

  return {
    handleDecisionCommands
  };
}

module.exports = {
  DECISION_DIR,
  createDecisionCommandHelpers,
  parseDecisionArgs,
  listDecisionRecords
};
