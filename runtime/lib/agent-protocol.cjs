'use strict';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactObject(value) {
  const output = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      const next = raw.filter(item => item !== undefined && item !== null && item !== '');
      if (next.length > 0) output[key] = next;
      continue;
    }
    if (isObject(raw)) {
      const next = compactObject(raw);
      if (Object.keys(next).length > 0) output[key] = next;
      continue;
    }
    if (raw === '') continue;
    output[key] = raw;
  }
  return output;
}

function unique(values) {
  return [...new Set(toArray(values).map(item => String(item || '').trim()).filter(Boolean))];
}

function firstText(values) {
  return toArray(values)
    .map(item => {
      if (item === undefined || item === null) return '';
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return String(item).trim();
      }
      return '';
    })
    .find(Boolean) || '';
}

function commandFromCli(cli) {
  const text = String(cli || '').trim();
  if (!text) return '';

  const runtimeMarker = 'emb-agent.cjs';
  const runtimeIndex = text.indexOf(runtimeMarker);
  if (runtimeIndex >= 0) {
    return text.slice(runtimeIndex + runtimeMarker.length).trim();
  }

  return text;
}

function shouldPreferNextOverImmediate(next, immediate) {
  const nextCommand = firstText([isObject(next) ? next.command : '']);
  const immediateCommand = firstText([isObject(immediate) ? immediate.command : '']);
  if (!nextCommand || !immediateCommand || nextCommand === immediateCommand) return false;
  if (nextCommand.startsWith('prd confirm')) return true;
  if (isObject(next) && next.gated_by_health === true) return true;
  return false;
}

function getCommand(value) {
  const next = isObject(value.next) ? value.next : {};
  const immediate = isObject(value.immediate) ? value.immediate : {};
  const action = isObject(value.action_card) ? value.action_card : {};
  const workflowStage = isObject(value.workflow_stage) ? value.workflow_stage : {};
  const taskConvergence = isObject(value.task_convergence) ? value.task_convergence : {};
  const humanReply = isObject(value.human_reply) ? value.human_reply : {};
  const preferImmediate = value.entry === 'start' && !shouldPreferNextOverImmediate(next, immediate);
  const actionCommand = firstText([action.primary_command, commandFromCli(action.first_cli)]);
  const followupCommand = firstText([
    commandFromCli(taskConvergence.next_cli),
    commandFromCli(humanReply.next)
  ]);
  return preferImmediate
    ? firstText([
        immediate.command,
        next.command,
        actionCommand,
        workflowStage.primary_command,
        followupCommand,
        value.command
      ])
    : firstText([
        next.command,
        immediate.command,
        actionCommand,
        workflowStage.primary_command,
        followupCommand,
        value.command
      ]);
}

function getCli(value, command) {
  const next = isObject(value.next) ? value.next : {};
  const immediate = isObject(value.immediate) ? value.immediate : {};
  const action = isObject(value.action_card) ? value.action_card : {};
  const taskConvergence = isObject(value.task_convergence) ? value.task_convergence : {};
  const humanReply = isObject(value.human_reply) ? value.human_reply : {};
  const preferImmediate = value.entry === 'start' && !shouldPreferNextOverImmediate(next, immediate);
  return preferImmediate
    ? firstText([
        immediate.cli,
        next.cli,
        action.first_cli,
        taskConvergence.next_cli,
        humanReply.next,
        command
      ])
    : firstText([
        next.cli,
        immediate.cli,
        action.first_cli,
        taskConvergence.next_cli,
        humanReply.next,
        command
      ]);
}

function inferGateKind(status, command, value) {
  const normalizedStatus = String(status || '').trim();
  const normalizedCommand = String(command || '').trim();
  const sourceCommand = String(value.command || '').trim();
  const next = isObject(value.next) ? value.next : {};
  const action = isObject(value.action_card) ? value.action_card : {};
  const stage = firstText([
    action.stage,
    value.current_stage,
    isObject(value.next_stage) ? value.next_stage.id : '',
    isObject(value.next_stage) ? value.next_stage.display_id : ''
  ]);

  if (normalizedStatus.includes('prd-confirmation') || normalizedCommand.startsWith('prd confirm')) return 'prd-confirmation';
  if (normalizedStatus.includes('decision-review') || normalizedCommand.startsWith('decision review') || normalizedCommand.startsWith('decision record')) return 'decision-review';
  if (normalizedStatus.includes('task-selection') || normalizedCommand.startsWith('task activate')) return 'task-selection';
  if (normalizedStatus.includes('task-intake') || normalizedCommand === 'task add <summary>' || normalizedCommand === 'task add') return 'task-intake';
  if (
    normalizedStatus.includes('health') ||
    next.gated_by_health === true ||
    normalizedCommand.startsWith('health') ||
    sourceCommand.startsWith('health') ||
    (Array.isArray(value.checks) && Array.isArray(value.recommendations)) ||
    normalizedCommand === 'bootstrap' ||
    stage === 'host-readiness' ||
    normalizedStatus === 'needs-user-input'
  ) return 'health';
  if (normalizedStatus.includes('permission')) return 'permission';
  if (normalizedStatus.includes('quality')) return 'quality';
  if (normalizedCommand === 'transcript-review') return 'transcript-review';
  return normalizedStatus.startsWith('blocked') ? 'workflow' : '';
}

function inferGate(value, command, cli) {
  const action = isObject(value.action_card) ? value.action_card : {};
  const workflowStage = isObject(value.workflow_stage) ? value.workflow_stage : {};
  const status = firstText([action.status, value.status]);
  const kind = inferGateKind(status, command, value);
  const blocking = Boolean(
    kind &&
    (
      String(status).startsWith('blocked') ||
      ['prd-confirmation', 'task-intake', 'task-selection', 'health', 'permission', 'quality'].includes(kind)
    )
  );
  const reason = firstText([
    action.summary,
    isObject(value.next) ? value.next.reason : '',
    workflowStage.why,
    value.reason,
    value.summary
  ]);
  const allowed = [];
  if (command) allowed.push(command);
  if (cli && cli !== command) allowed.push(cli);
  if (kind === 'prd-confirmation') allowed.push('prd status', 'prd confirm --create-tasks');
  if (kind === 'decision-review') allowed.push('decision status', 'decision review --question <text>', 'decision record --question <text> --chosen <choice>');
  if (kind === 'task-intake') allowed.push('task add <summary>', 'task activate <name>');
  if (kind === 'task-selection') allowed.push(command, 'task status');
  if (kind === 'health') {
    const health = isObject(value.health) ? value.health : {};
    allowed.push(
      'health',
      ...toArray(value.next_commands).map(item => item && item.cli).filter(Boolean),
      ...toArray(health.next_commands).map(item => item && item.cli).filter(Boolean)
    );
  }

  const forbiddenByKind = {
    'prd-confirmation': ['scan', 'plan', 'do', 'task add <summary>'],
    'decision-review': ['do', 'capability run do', 'mutate', 'write implementation'],
    'task-intake': ['scan', 'plan', 'do', 'verify'],
    'task-selection': ['scan', 'plan', 'do', 'verify'],
    health: ['scan', 'plan', 'do', 'verify'],
    permission: ['write', 'mutate', 'execute-high-risk'],
    quality: ['task resolve', 'close task']
  };

  const humanPromptByKind = {
    'prd-confirmation': 'Ask the user to confirm the PRD contract before creating execution tasks.',
    'decision-review': 'Ask for explicit technical-decision review before implementation.',
    'task-intake': 'Ask the user for the concrete task in one sentence, unless a task was already specified.',
    'task-selection': 'Tell the user which existing task should be activated before continuing.',
    health: 'Explain the health blocker and ask to close it before workflow execution.',
    permission: 'Ask for explicit confirmation before the gated action.',
    quality: 'Explain which verification or signoff remains before closure.'
  };

  return compactObject({
    kind,
    status: status || (blocking ? `blocked-by-${kind}` : 'ready'),
    blocking,
    reason,
    allowed_actions: unique(allowed),
    forbidden_actions: forbiddenByKind[kind] || [],
    human_prompt: humanPromptByKind[kind] || ''
  });
}

function buildAiInstruction(gate, recommendation, value) {
  const kind = gate.kind || '';
  const reason = gate.reason || recommendation.reason || '';
  const doNot = unique([
    'Do not show raw JSON or a full emb-agent command transcript to the human.',
    'Do not expose long node .../emb-agent.cjs paths unless the user asks for copy-paste automation output.',
    ...(gate.forbidden_actions || []).map(action => `Do not run ${action} while gate ${kind} is blocking.`)
  ]);

  const promptByKind = {
    'prd-confirmation': '请确认当前 docs/prd 是否可以作为实现基线。确认后我会让 emb-agent 自动创建执行任务。',
    'decision-review': '这个技术选择还没有被审视。请先确认问题、备选方案、取舍理由和证据，再进入实现。',
    'task-intake': '请用一句话说明要做的具体任务。',
    'task-selection': '当前需要先激活已有任务，然后再继续执行。',
    health: '当前有健康检查阻塞项，需要先关闭后再继续。',
    permission: '该操作需要明确确认后才能执行。',
    quality: '当前还有验证或签核项未关闭。'
  };

  return compactObject({
    audience: 'ai-host',
    summary: reason,
    ask_user: promptByKind[kind] || gate.human_prompt || '',
    recommended_response_style: 'Answer the human in concise Chinese. Summarize the state and ask only for the next needed confirmation or input.',
    do_not: doNot,
    raw_output_policy: 'Machine output is for AI routing only; do not paste it verbatim to the human.'
  });
}

function buildRecommendation(value, command, cli) {
  const next = isObject(value.next) ? value.next : {};
  const action = isObject(value.action_card) ? value.action_card : {};
  const taskConvergence = isObject(value.task_convergence) ? value.task_convergence : {};
  const humanReply = isObject(value.human_reply) ? value.human_reply : {};
  return compactObject({
    command,
    cli,
    reason: firstText([next.reason, action.summary, taskConvergence.summary, value.reason, value.summary, humanReply.en, humanReply.zh]),
    requires_human_confirmation: String(command || '').startsWith('prd confirm') || String(action.status || '').includes('permission')
  });
}

function buildAgentProtocol(value) {
  if (!isObject(value)) return null;
  if (isObject(value.agent_protocol)) return value.agent_protocol;

  const command = getCommand(value);
  const cli = getCli(value, command);
  const recommendation = buildRecommendation(value, command, cli);
  const gate = inferGate(value, command, cli);

  if (!command && !gate.kind && !recommendation.reason) {
    return null;
  }

  return compactObject({
    version: 'emb-agent.protocol/1',
    audience: 'ai-host',
    visibility: {
      raw_output: 'hidden-from-human-by-default',
      human_output_owner: 'host-ai'
    },
    gate,
    recommendation,
    ai_instruction: buildAiInstruction(gate, recommendation, value)
  });
}

function enrich(value) {
  if (!isObject(value) || isObject(value.agent_protocol)) {
    return value;
  }
  const protocol = buildAgentProtocol(value);
  if (!protocol) {
    return value;
  }
  return {
    ...value,
    agent_protocol: protocol
  };
}

module.exports = {
  buildAgentProtocol,
  enrich,
  compactObject
};
