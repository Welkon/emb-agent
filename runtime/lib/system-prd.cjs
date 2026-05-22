"use strict";

const path = require("path");

const SYSTEM_PRD_RELATIVE_PATH = "docs/prd/system.md";

function normalizeLanguage(language) {
	const value = String(language || "")
		.trim()
		.toLowerCase();
	if (["zh", "cn", "chinese", "zh-cn", "zh_cn"].includes(value)) {
		return "zh";
	}
	return "en";
}

function getSystemPrdRelativePath(runtime) {
	return SYSTEM_PRD_RELATIVE_PATH;
}

function getSystemPrdAbsolutePath(runtime, projectRoot) {
	return path.join(path.resolve(projectRoot), SYSTEM_PRD_RELATIVE_PATH);
}

function buildSystemPrdContent(options = {}) {
	const language = normalizeLanguage(options.language);
	const projectName =
		String(options.projectName || "project").trim() || "project";
	const projectProfile = String(options.projectProfile || "").trim() || "unset";
	const productGoal = String(options.goal || "").trim();
	const activeSpecs = Array.isArray(options.activeSpecs)
		? options.activeSpecs
				.map((item) => String(item || "").trim())
				.filter(Boolean)
		: [];

	if (language === "zh") {
		return [
			"# 系统级 PRD",
			"",
			"> 项目级契约。保持轻量：任务 PRD 继承这里的边界，结构化字段同步到 `.emb-agent/req.yaml` 和 `.emb-agent/hw.yaml`。",
			"",
			"## 产品目标",
			"",
			`- 项目: ${projectName}`,
			productGoal ? `- ${productGoal}` : "- 写清第一个可验证的产品/板级结果。",
			"",
			"## 需求探索记录",
			"",
			"- 在确认 PRD 前，先和用户探索/拷问：目标用户、使用场景、输入输出、默认状态、异常/掉电/复位行为、资源约束和验收证据。",
			"- 原理图/手册推断必须标注来源；封装脚号到 GPIO/外设/网络的映射未确认前不能写成事实。",
			"- 将用户确认后的结构化目标、功能、约束、验收、未知项和来源同步到 `.emb-agent/req.yaml`。",
			"",
			"## 子 PRD / 任务拆分",
			"",
			"- 系统 PRD 确认前，至少拆出一个可执行子 PRD：`docs/prd/features/*.md`、`docs/prd/modules/*.md`、`docs/prd/components/*.md` 或 `docs/prd/subsystems/*.md`。",
			"- 不要直接从系统 PRD 跳到 `task add`；先让 `prd confirm --create-tasks` 从子 PRD 生成执行任务。",
			"",
			"## 非目标",
			"",
			"- 写清当前版本刻意不做的行为，避免任务 PRD 扩散。",
			"",
			"## 硬件基线",
			"",
			"- MCU / 板卡 / 封装: 未确认前保持 unknown，并在 `.emb-agent/hw.yaml` 记录来源。",
			"- 输入、输出、接口、供电和时序只记录已确认事实或明确假设。",
			"",
			"## 固件组织形态",
			"",
			"- 默认立场: compact-direct，直到系统约束证明需要更深结构。",
			"- 从满足约束的最小、最易读组织开始；只有在能降低重复寄存器风险、隔离真实接口边界、或让验证更清楚时才增加层级。",
			"- 对 C 固件，优先从入口文件、板级配置/引脚映射、单一功能实现文件开始；需要时再增加 `hw.c` / `isr.c` / driver/service 边界。",
			"- ISR 边界保持薄：优先 flags、计数器、状态交接，避免深 callback 或事件总线。",
			"",
			"## 资源与验证约束",
			"",
			"- 记录 ROM/RAM/栈/时序/引脚/工具链/烧录策略等约束；不要在这里写芯片特例规则。",
			"- 每个约束标明来源：datasheet、schematic、BOM、legacy code、bench result 或 explicit assumption。",
			"",
			"## 对外行为",
			"",
			"- 写清用户可观察行为、输入输出、默认状态、异常/掉电/复位行为。",
			"",
			"## 验收边界",
			"",
			"- 写清第一个版本必须通过的板级、仿真、构建或人工验收证据。",
			"",
			"## 待确认",
			"",
			"- 列出会影响芯片选择、固件组织、接口或验收的未知项。",
			"- PRD 或任务创建后，必须把不明确项和用户逐条沟通，更新本文或任务 PRD，直到明确达成一致再进入实现。",
			"",
			"## 元数据",
			"",
			`- Project profile: ${projectProfile}`,
			`- Active specs: ${activeSpecs.join(", ") || "none"}`,
			"",
		].join("\n");
	}

	return [
		"# System PRD",
		"",
		"> Project-level contract. Keep this lightweight: task PRDs inherit this boundary, while structured facts are mirrored into `.emb-agent/req.yaml` and `.emb-agent/hw.yaml`.",
		"",
		"## Product Goal",
		"",
		`- Project: ${projectName}`,
		productGoal
			? `- ${productGoal}`
			: "- Define the first product or board-level outcome that can be verified.",
		"",
		"## Requirement Exploration Record",
		"",
		"- Before confirming the PRD, explore with the user: target user, scenarios, inputs/outputs, defaults, abnormal/power-loss/reset behavior, resource constraints, and acceptance evidence.",
		"- Mark schematic/manual inference with sources; package pin number to GPIO/peripheral/net mappings must not become facts until evidence or user confirmation exists.",
		"- Mirror confirmed structured goals, features, constraints, acceptance, unknowns, and sources into `.emb-agent/req.yaml`.",
		"",
		"## Child PRDs / Task Split",
		"",
		"- Before system PRD confirmation, create at least one execution PRD under `docs/prd/features/*.md`, `docs/prd/modules/*.md`, `docs/prd/components/*.md`, or `docs/prd/subsystems/*.md`.",
		"- Do not jump directly from the system PRD to `task add`; let `prd confirm --create-tasks` derive execution tasks from child PRDs first.",
		"",
		"## Non-Goals",
		"",
		"- List behavior intentionally out of scope for the current version so task PRDs do not drift.",
		"",
		"## Hardware Baseline",
		"",
		"- MCU / board / package: keep unknown until a real source is recorded in `.emb-agent/hw.yaml`.",
		"- Record inputs, outputs, interfaces, power, and timing as confirmed facts or explicit assumptions only.",
		"",
		"## Firmware Shape",
		"",
		"- Default stance: compact-direct until system constraints prove that deeper structure is needed.",
		"- Start with the smallest understandable organization that satisfies the documented constraints.",
		"- For C firmware, prefer an entry file, explicit board/config or pin mapping, and one feature implementation file first; add `hw.c`, `isr.c`, driver, or service boundaries only when they reduce repeated register risk, isolate a real interface boundary, or make verification clearer.",
		"- Keep ISR boundaries thin: prefer flags, counters, and state handoff over deep callbacks or event buses.",
		"",
		"## Resource And Verification Constraints",
		"",
		"- Record ROM, RAM, stack, timing, pin, toolchain, and programming-strategy constraints; do not encode chip-specific exception rules here.",
		"- Give each constraint a source: datasheet, schematic, BOM, legacy code, bench result, or explicit assumption.",
		"",
		"## User-Facing Behavior",
		"",
		"- Define observable behavior, inputs, outputs, default states, abnormal cases, power loss, and reset behavior.",
		"",
		"## Acceptance Boundary",
		"",
		"- Define the board, simulation, build, or human evidence required for the first version to be accepted.",
		"",
		"## Unknowns",
		"",
		"- List unknowns that affect chip selection, firmware organization, interfaces, or acceptance.",
		"- After creating a PRD or task, discuss unclear items with the user, update this PRD or the task PRD, and continue only after explicit agreement.",
		"",
		"## Metadata",
		"",
		`- Project profile: ${projectProfile}`,
		`- Active specs: ${activeSpecs.join(", ") || "none"}`,
		"",
	].join("\n");
}

module.exports = {
	SYSTEM_PRD_RELATIVE_PATH,
	buildSystemPrdContent,
	getSystemPrdAbsolutePath,
	getSystemPrdRelativePath,
	normalizeLanguage,
};
