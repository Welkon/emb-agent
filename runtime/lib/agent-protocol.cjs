"use strict";

function isObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toArray(value) {
	return Array.isArray(value) ? value : [];
}

function compactObject(value) {
	const output = {};
	for (const [key, raw] of Object.entries(value || {})) {
		if (raw === undefined || raw === null) continue;
		if (Array.isArray(raw)) {
			const next = raw.filter(
				(item) => item !== undefined && item !== null && item !== "",
			);
			if (next.length > 0) output[key] = next;
			continue;
		}
		if (isObject(raw)) {
			const next = compactObject(raw);
			if (Object.keys(next).length > 0) output[key] = next;
			continue;
		}
		if (raw === "") continue;
		output[key] = raw;
	}
	return output;
}

function unique(values) {
	return [
		...new Set(
			toArray(values)
				.map((item) => String(item || "").trim())
				.filter(Boolean),
		),
	];
}

function firstText(values) {
	return (
		toArray(values)
			.map((item) => {
				if (item === undefined || item === null) return "";
				if (
					typeof item === "string" ||
					typeof item === "number" ||
					typeof item === "boolean"
				) {
					return String(item).trim();
				}
				return "";
			})
			.find(Boolean) || ""
	);
}

function firstObject(values) {
	return toArray(values).find(isObject) || {};
}

function commandFromCli(cli) {
	const text = String(cli || "").trim();
	if (!text) return "";

	const runtimeMarker = "emb-agent.cjs";
	const runtimeIndex = text.indexOf(runtimeMarker);
	if (runtimeIndex >= 0) {
		return text.slice(runtimeIndex + runtimeMarker.length).trim();
	}

	return text;
}

function shouldPreferNextOverImmediate(next, immediate) {
	const nextCommand = firstText([isObject(next) ? next.command : ""]);
	const immediateCommand = firstText([
		isObject(immediate) ? immediate.command : "",
	]);
	if (!nextCommand || !immediateCommand || nextCommand === immediateCommand)
		return false;
	if (nextCommand.startsWith("prd confirm")) return true;
	if (isObject(next) && next.gated_by_health === true) return true;
	return false;
}

function getCommand(value) {
	const next = isObject(value.next) ? value.next : {};
	const immediate = isObject(value.immediate) ? value.immediate : {};
	const action = isObject(value.action_card) ? value.action_card : {};
	const workflowStage = isObject(value.workflow_stage)
		? value.workflow_stage
		: {};
	const taskConvergence = isObject(value.task_convergence)
		? value.task_convergence
		: {};
	const humanReply = isObject(value.human_reply) ? value.human_reply : {};
	const preferImmediate =
		value.entry === "start" && !shouldPreferNextOverImmediate(next, immediate);
	const actionCommand = firstText([
		action.primary_command,
		commandFromCli(action.first_cli),
	]);
	const followupCommand = firstText([
		commandFromCli(taskConvergence.next_cli),
		commandFromCli(humanReply.next),
	]);
	return preferImmediate
		? firstText([
				immediate.command,
				next.command,
				actionCommand,
				workflowStage.primary_command,
				followupCommand,
				value.command,
			])
		: firstText([
				next.command,
				immediate.command,
				actionCommand,
				workflowStage.primary_command,
				followupCommand,
				value.command,
			]);
}

function getCli(value, command) {
	const next = isObject(value.next) ? value.next : {};
	const immediate = isObject(value.immediate) ? value.immediate : {};
	const action = isObject(value.action_card) ? value.action_card : {};
	const taskConvergence = isObject(value.task_convergence)
		? value.task_convergence
		: {};
	const humanReply = isObject(value.human_reply) ? value.human_reply : {};
	const preferImmediate =
		value.entry === "start" && !shouldPreferNextOverImmediate(next, immediate);
	return preferImmediate
		? firstText([
				immediate.cli,
				next.cli,
				action.first_cli,
				taskConvergence.next_cli,
				humanReply.next,
				command,
			])
		: firstText([
				next.cli,
				immediate.cli,
				action.first_cli,
				taskConvergence.next_cli,
				humanReply.next,
				command,
			]);
}

function inferGateKind(status, command, value) {
	const normalizedStatus = String(status || "").trim();
	const normalizedCommand = String(command || "").trim();
	const sourceCommand = String(value.command || "").trim();
	const next = isObject(value.next) ? value.next : {};
	const action = isObject(value.action_card) ? value.action_card : {};
	const stage = firstText([
		action.stage,
		value.current_stage,
		isObject(value.next_stage) ? value.next_stage.id : "",
		isObject(value.next_stage) ? value.next_stage.display_id : "",
	]);

	if (
		normalizedStatus.includes("prd-exploration") ||
		normalizedCommand === "ai-host explore-prd" ||
		isObject(next.prd_exploration) ||
		isObject(value.prd_exploration) ||
		isObject(value.exploration)
	)
		return "prd-exploration";
	if (
		normalizedStatus.includes("prd-confirmation") ||
		normalizedCommand.startsWith("prd confirm")
	)
		return "prd-confirmation";
	if (
		normalizedStatus.includes("decision-review") ||
		normalizedCommand.startsWith("decision review") ||
		normalizedCommand.startsWith("decision record")
	)
		return "decision-review";
	if (
		normalizedStatus.includes("task-selection") ||
		normalizedCommand.startsWith("task activate")
	)
		return "task-selection";
	if (
		normalizedStatus.includes("task-intake") ||
		normalizedCommand === "task add <summary>" ||
		normalizedCommand === "task add"
	)
		return "task-intake";
	if (
		normalizedStatus.includes("health") ||
		next.gated_by_health === true ||
		normalizedCommand.startsWith("health") ||
		sourceCommand.startsWith("health") ||
		(Array.isArray(value.checks) && Array.isArray(value.recommendations)) ||
		normalizedCommand === "bootstrap" ||
		stage === "host-readiness" ||
		normalizedStatus === "needs-user-input"
	)
		return "health";
	if (normalizedStatus.includes("permission")) return "permission";
	if (normalizedStatus.includes("quality")) return "quality";
	if (normalizedCommand === "transcript-review") return "transcript-review";
	return normalizedStatus.startsWith("blocked") ? "workflow" : "";
}

function inferGate(value, command, cli) {
	const action = isObject(value.action_card) ? value.action_card : {};
	const workflowStage = isObject(value.workflow_stage)
		? value.workflow_stage
		: {};
	const status = firstText([action.status, value.status]);
	const kind = inferGateKind(status, command, value);
	const blocking = Boolean(
		kind &&
			(String(status).startsWith("blocked") ||
				[
					"prd-exploration",
					"prd-confirmation",
					"task-intake",
					"task-selection",
					"health",
					"permission",
					"quality",
				].includes(kind)),
	);
	const reason = firstText([
		action.summary,
		isObject(value.next) ? value.next.reason : "",
		workflowStage.why,
		value.reason,
		value.summary,
	]);
	const allowed = [];
	if (command) allowed.push(command);
	if (cli && cli !== command) allowed.push(cli);
	if (kind === "prd-exploration") {
		allowed.push(
			"read docs/prd/system.md",
			"ask user requirement-exploration questions",
			"update docs/prd/system.md",
			"update .emb-agent/req.yaml",
			"create docs/prd/features|modules|components|subsystems/*.md",
		);
	}
	if (kind === "prd-confirmation")
		allowed.push("prd status", "prd confirm --create-tasks");
	if (kind === "decision-review")
		allowed.push(
			"decision status",
			"decision review --question <text>",
			"decision record --question <text> --chosen <choice>",
		);
	if (kind === "task-intake")
		allowed.push("task add <summary>", "task activate <name>");
	if (kind === "task-selection") allowed.push(command, "task status");
	if (kind === "health") {
		const health = isObject(value.health) ? value.health : {};
		allowed.push(
			"health",
			...toArray(value.next_commands)
				.map((item) => item && item.cli)
				.filter(Boolean),
			...toArray(health.next_commands)
				.map((item) => item && item.cli)
				.filter(Boolean),
		);
	}

	const forbiddenByKind = {
		"prd-exploration": [
			"prd confirm --create-tasks",
			"task add <summary>",
			"task activate <name>",
			"scan",
			"plan",
			"do",
			"verify",
		],
		"prd-confirmation": ["scan", "plan", "do", "task add <summary>"],
		"decision-review": [
			"do",
			"capability run do",
			"mutate",
			"write implementation",
		],
		"task-intake": ["scan", "plan", "do", "verify"],
		"task-selection": ["scan", "plan", "do", "verify"],
		health: ["scan", "plan", "do", "verify"],
		permission: ["write", "mutate", "execute-high-risk"],
		quality: ["task resolve", "close task"],
	};

	const humanPromptByKind = {
		"prd-exploration":
			"Explore and align requirements with the user, sync req.yaml, and create child execution PRDs before confirmation.",
		"prd-confirmation":
			"Ask the user to confirm the PRD contract before creating execution tasks.",
		"decision-review":
			"Ask for explicit technical-decision review before implementation.",
		"task-intake":
			"Ask the user for the concrete task in one sentence, unless a task was already specified.",
		"task-selection":
			"Tell the user which existing task should be activated before continuing.",
		health:
			"Explain the health blocker and ask to close it before workflow execution.",
		permission: "Ask for explicit confirmation before the gated action.",
		quality: "Explain which verification or signoff remains before closure.",
	};

	return compactObject({
		kind,
		status: status || (blocking ? `blocked-by-${kind}` : "ready"),
		blocking,
		reason,
		allowed_actions: unique(allowed),
		forbidden_actions: forbiddenByKind[kind] || [],
		human_prompt: humanPromptByKind[kind] || "",
	});
}

function buildAiInstruction(gate, recommendation, value) {
	const kind = gate.kind || "";
	const reason = gate.reason || recommendation.reason || "";
	const next = isObject(value.next) ? value.next : {};
	const exploration = firstObject([
		next.prd_exploration,
		value.prd_exploration,
		value.exploration,
	]);
	const doNot = unique([
		"Do not show raw JSON or a full emb-agent command transcript to the human.",
		"Do not expose long node .../emb-agent.cjs paths unless the user asks for copy-paste automation output.",
		kind === "prd-exploration"
			? "Do not fill or confirm PRD from hardware guesses alone; ask the user about behavior, constraints, and acceptance first."
			: "",
		kind === "prd-exploration"
			? "Do not skip child PRD creation before PRD confirmation creates tasks."
			: "",
		...(gate.forbidden_actions || []).map(
			(action) => `Do not run ${action} while gate ${kind} is blocking.`,
		),
	]);

	const promptByKind = {
		"prd-exploration":
			"在确认 PRD 前，先和用户详细探索/拷问需求与功能，记录不确定项，同步 req.yaml，并创建子 PRD。",
		"prd-confirmation":
			"请确认当前 docs/prd 是否可以作为实现基线。确认后我会让 emb-agent 自动创建执行任务。",
		"decision-review":
			"这个技术选择还没有被审视。请先确认问题、备选方案、取舍理由和证据，再进入实现。",
		"task-intake": "请用一句话说明要做的具体任务。",
		"task-selection": "当前需要先激活已有任务，然后再继续执行。",
		health: "当前有健康检查阻塞项，需要先关闭后再继续。",
		permission: "该操作需要明确确认后才能执行。",
		quality: "当前还有验证或签核项未关闭。",
	};

	return compactObject({
		audience: "ai-host",
		summary: reason,
		ask_user: promptByKind[kind] || gate.human_prompt || "",
		recommended_response_style:
			kind === "prd-exploration"
				? "Answer in concise Chinese. Ask focused exploratory questions before editing PRD; after each answer update docs/prd/system.md, .emb-agent/req.yaml, and child PRDs, then stop until explicit agreement."
				: "Answer the human in concise Chinese. Summarize the state and ask only for the next needed confirmation or input.",
		do_not: doNot,
		prompts:
			kind === "prd-exploration"
				? toArray(exploration.prompts).slice(0, 6)
				: [],
		required_updates:
			kind === "prd-exploration"
				? toArray(exploration.required_updates).slice(0, 6)
				: [],
		raw_output_policy:
			"Machine output is for AI routing only; do not paste it verbatim to the human.",
	});
}

function buildRecommendation(value, command, cli) {
	const next = isObject(value.next) ? value.next : {};
	const action = isObject(value.action_card) ? value.action_card : {};
	const taskConvergence = isObject(value.task_convergence)
		? value.task_convergence
		: {};
	const humanReply = isObject(value.human_reply) ? value.human_reply : {};
	return compactObject({
		command,
		cli,
		reason: firstText([
			next.reason,
			action.summary,
			taskConvergence.summary,
			value.reason,
			value.summary,
			humanReply.en,
			humanReply.zh,
		]),
		requires_human_confirmation:
			String(command || "").startsWith("prd confirm") ||
			command === "ai-host explore-prd" ||
			String(action.status || "").includes("permission"),
	});
}

function isAlignmentPayload(value) {
	if (!isObject(value)) return false;
	const alignment = isObject(value.alignment) ? value.alignment : {};
	if (String(alignment.status || "").includes("needs-human-alignment"))
		return true;
	if (
		value.created === true &&
		isObject(value.task) &&
		isObject(value.task_convergence)
	)
		return true;
	if (
		String(value.command || "") === "prd confirm" &&
		toArray(value.created_tasks).length > 0
	)
		return true;
	return false;
}

function getAlignmentNextCommand(value, alignment) {
	const task = isObject(value.task) ? value.task : {};
	const taskConvergence = isObject(value.task_convergence)
		? value.task_convergence
		: {};
	const createdTasks = toArray(value.created_tasks).filter(isObject);
	const firstCreatedTask = createdTasks[0] || {};
	const nextAfterAgreement = isObject(alignment.next_after_agreement)
		? alignment.next_after_agreement
		: {};
	const next = isObject(value.next) ? value.next : {};

	return firstText([
		nextAfterAgreement.command,
		next.command,
		commandFromCli(taskConvergence.next_cli),
		task.name ? `task activate ${task.name}` : "",
		firstCreatedTask.name ? `task activate ${firstCreatedTask.name}` : "",
	]);
}

function buildAlignmentProtocol(value) {
	const alignment = isObject(value.alignment) ? value.alignment : {};
	const task = isObject(value.task) ? value.task : {};
	const taskConvergence = isObject(value.task_convergence)
		? value.task_convergence
		: {};
	const createdTasks = toArray(value.created_tasks).filter(isObject);
	const firstCreatedTask = createdTasks[0] || {};
	const nextCommand = getAlignmentNextCommand(value, alignment);
	const prdPath = firstText([
		alignment.prd_path,
		isObject(task.artifacts) ? task.artifacts.prd : "",
		taskConvergence.prd_path,
		firstCreatedTask.task_prd,
	]);
	const promptList = unique([
		...toArray(alignment.prompts),
		...toArray(taskConvergence.prompts),
		"确认目标、边界、约束、验收和待确认项是否一致；不明确就逐条追问。",
	]);
	const scope = firstText([
		alignment.scope,
		createdTasks.length > 0 ? "prd-generated-tasks" : "",
		value.created === true ? "task-prd" : "",
	]);
	const subject = firstText([
		alignment.subject,
		task.title,
		task.name,
		firstCreatedTask.title,
		firstCreatedTask.name,
		prdPath,
		"PRD/task",
	]);
	const summary = firstText([
		alignment.summary,
		createdTasks.length > 0
			? `Created ${createdTasks.length} execution task(s) from PRD; align unclear goals, boundaries, acceptance, and open questions with the user before activation or implementation.`
			: "",
		value.created === true
			? `Created task ${task.name || subject}; align the generated PRD with the user before activation or implementation.`
			: "",
		"After creating a PRD or task, clarify all ambiguous parts with the user until explicit agreement.",
	]);
	const allowed = [
		"ask user to review unclear PRD/task items",
		"update PRD or task PRD with clarified agreement",
		prdPath ? `review ${prdPath}` : "",
		nextCommand ? `${nextCommand} after explicit user agreement` : "",
	];

	return compactObject({
		version: "emb-agent.protocol/1",
		audience: "ai-host",
		visibility: {
			raw_output: "hidden-from-human-by-default",
			human_output_owner: "host-ai",
		},
		gate: {
			kind: "alignment",
			status: "blocked-by-human-alignment",
			blocking: true,
			reason: summary,
			allowed_actions: unique(allowed),
			forbidden_actions: [
				"task activate before user confirms PRD/task agreement",
				"scan before user confirms PRD/task agreement",
				"plan before user confirms PRD/task agreement",
				"do before user confirms PRD/task agreement",
				"verify before user confirms PRD/task agreement",
			],
			human_prompt:
				"Ask the user to review unclear PRD/task items and iterate until explicit agreement before continuing.",
		},
		recommendation: {
			command: "ai-host clarify-prd-task-alignment",
			reason: summary,
			requires_human_confirmation: true,
		},
		ai_instruction: {
			audience: "ai-host",
			summary,
			ask_user: `我已创建${scope === "prd-generated-tasks" ? " PRD 派生任务" : "任务/PRD"}。请确认目标、边界、约束、验收和待确认项是否一致；不明确的地方我们逐条沟通，达成一致后我再继续。${prdPath ? ` 先从 ${prdPath} 开始。` : ""}`,
			recommended_response_style:
				"Answer in concise Chinese. List only the unclear items or confirmation points, ask the user to confirm/correct them, update PRD/task truth when clarified, and stop until agreement is explicit.",
			raw_output_policy:
				"Machine output is for AI routing only; do not paste it verbatim to the human.",
			do_not: [
				"Do not continue to task activation, scan, plan, do, verify, or task resolve just because a PRD/task was created.",
				"Do not silently assume unclear requirements, hardware truth, scope boundaries, or acceptance checks.",
				"Do not leave resolved clarification only in chat; update the PRD/task truth before continuing.",
				"Do not expose long node .../emb-agent.cjs paths unless the user asks for copy-paste automation output.",
			],
			prompts: promptList.slice(0, 6),
		},
	});
}

function isExecutionBrief(value) {
	return (
		isObject(value) &&
		isObject(value.execution_brief) &&
		Array.isArray(value.prerequisites)
	);
}

function buildExecutionProtocol(value) {
	const workflowStage = isObject(value.workflow_stage)
		? value.workflow_stage
		: {};
	const action = isObject(value.action_card) ? value.action_card : {};
	const executionBrief = isObject(value.execution_brief)
		? value.execution_brief
		: {};
	const firstStep = firstText([
		toArray(executionBrief.suggested_steps)[0],
		toArray(value.prerequisites)[0],
		action.first_instruction,
	]);
	const summary = firstText([
		action.summary,
		firstStep,
		workflowStage.why,
		"Use this execution brief to make the requested repository changes.",
	]);

	return compactObject({
		version: "emb-agent.protocol/1",
		audience: "ai-host",
		visibility: {
			raw_output: "hidden-from-human-by-default",
			human_output_owner: "host-ai",
		},
		gate: {
			kind: "execution",
			status: "ready-for-ai-implementation",
			blocking: false,
			reason: summary,
			allowed_actions: [
				"read required specs and task PRD",
				"edit repository files for the active task",
				"run targeted local checks",
				"capability run verify after implementation evidence exists",
			],
			forbidden_actions: [
				"capability run verify before making implementation changes or recording no-op evidence",
				"claim implementation is complete without repository changes or explicit no-op rationale",
				"task resolve before verification",
			],
			human_prompt: "",
		},
		recommendation: {
			command: "ai-host implement",
			reason:
				"emb-agent returned an execution brief only; the AI host must now perform the actual repository change, then verify.",
			requires_human_confirmation: false,
		},
		ai_instruction: {
			audience: "ai-host",
			summary:
				"This payload is an execution brief, not evidence that implementation already happened.",
			ask_user: "",
			recommended_response_style:
				"Do not stop at summarizing the do output. Implement the smallest durable change within the brief, then run verification when evidence exists.",
			raw_output_policy:
				"Machine output is for AI routing only; do not paste it verbatim to the human.",
			do_not: [
				"Do not tell the human the implementation is done just because emb-agent do returned successfully.",
				"Do not run capability run verify until you have made the requested change or recorded an explicit no-op rationale.",
				"Do not expose long node .../emb-agent.cjs paths unless the user asks for copy-paste automation output.",
			],
		},
	});
}

function buildAgentProtocol(value) {
	if (!isObject(value)) return null;
	if (isObject(value.agent_protocol)) return value.agent_protocol;
	if (isAlignmentPayload(value)) return buildAlignmentProtocol(value);
	if (isExecutionBrief(value)) return buildExecutionProtocol(value);

	const command = getCommand(value);
	const cli = getCli(value, command);
	const recommendation = buildRecommendation(value, command, cli);
	const gate = inferGate(value, command, cli);

	if (!command && !gate.kind && !recommendation.reason) {
		return null;
	}

	return compactObject({
		version: "emb-agent.protocol/1",
		audience: "ai-host",
		visibility: {
			raw_output: "hidden-from-human-by-default",
			human_output_owner: "host-ai",
		},
		gate,
		recommendation,
		ai_instruction: buildAiInstruction(gate, recommendation, value),
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
		agent_protocol: protocol,
	};
}

module.exports = {
	buildAgentProtocol,
	enrich,
	compactObject,
};
