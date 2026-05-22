"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const cli = require(path.join(repoRoot, "runtime", "bin", "emb-agent.cjs"));

async function captureCliJson(args) {
	const originalWrite = process.stdout.write;
	let stdout = "";

	process.stdout.write = (chunk) => {
		stdout += String(chunk);
		return true;
	};

	try {
		await cli.main(args);
	} finally {
		process.stdout.write = originalWrite;
	}

	return JSON.parse(stdout);
}

function writeMeaningfulReqYaml(projectRoot) {
	fs.writeFileSync(
		path.join(projectRoot, ".emb-agent", "req.yaml"),
		[
			"goals:",
			'  - "Deliver a sensor loop that can be verified on the board"',
			"features:",
			'  - "Read the sensor and close visible evidence"',
			"constraints:",
			'  - "Keep changes tied to confirmed PRD and hardware truth"',
			"acceptance:",
			'  - "Build succeeds and sensor-loop evidence is recorded"',
			"failure_policy:",
			'  - "Record unknowns before guessing"',
			"unknowns:",
			'  - "Bench fixture is still pending"',
			"sources:",
			'  - "docs/prd/system.md"',
			"",
		].join("\n"),
		"utf8",
	);
}

test("prd exploration blocks confirmation until req.yaml and child PRDs are ready", async () => {
	const tempProject = fs.mkdtempSync(
		path.join(os.tmpdir(), "emb-agent-prd-explore-"),
	);
	const currentCwd = process.cwd();

	try {
		process.chdir(tempProject);
		await captureCliJson(["init"]);
		await captureCliJson([
			"declare",
			"hardware",
			"--confirm",
			"--mcu",
			"DEMO123",
			"--package",
			"SOP8",
		]);

		const next = await captureCliJson(["next", "--brief"]);
		assert.equal(next.next.command, "ai-host explore-prd");
		assert.equal(next.agent_protocol.gate.kind, "prd-exploration");
		assert.equal(next.agent_protocol.gate.blocking, true);
		assert.ok(
			next.agent_protocol.gate.forbidden_actions.includes(
				"prd confirm --create-tasks",
			),
		);
		assert.equal(next.prd_exploration.missing_execution_prds, true);
		assert.equal(next.prd_exploration.requirement_truth.status, "template");
		assert.match(
			next.agent_protocol.ai_instruction.ask_user,
			/探索|拷问|子 PRD/,
		);

		const blocked = await captureCliJson(["prd", "confirm", "--create-tasks"]);
		assert.equal(blocked.status, "blocked-by-prd-exploration");
		assert.equal(blocked.agent_protocol.gate.kind, "prd-exploration");
		assert.equal(blocked.exploration.blocks_confirmation, true);
		assert.equal(
			fs.existsSync(
				path.join(tempProject, ".emb-agent", "prd-confirmation.json"),
			),
			false,
		);
	} finally {
		process.chdir(currentCwd);
	}
});

test("prd confirmation is generic and creates execution tasks from docs/prd structure", async () => {
	const tempProject = fs.mkdtempSync(
		path.join(os.tmpdir(), "emb-agent-prd-confirm-"),
	);
	const currentCwd = process.cwd();

	try {
		process.chdir(tempProject);
		await captureCliJson(["init"]);
		await captureCliJson([
			"declare",
			"hardware",
			"--confirm",
			"--mcu",
			"DEMO123",
			"--package",
			"SOP8",
		]);

		fs.mkdirSync(path.join(tempProject, "docs", "prd", "subsystems"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(tempProject, "docs", "prd", "subsystems", "sensor-loop.md"),
			"# Sensor loop PRD\n\n## Goal\n\nRead a sensor.\n",
			"utf8",
		);
		fs.writeFileSync(
			path.join(tempProject, "docs", "prd", "verification.md"),
			"# Verification PRD\n\n## Goal\n\nClose evidence.\n",
			"utf8",
		);
		writeMeaningfulReqYaml(tempProject);

		const next = await captureCliJson(["next", "--brief"]);
		assert.equal("action_card" in next, false);
		assert.equal(next.next.command, "prd confirm --create-tasks");
		assert.equal(next.agent_protocol.gate.kind, "prd-confirmation");
		assert.equal(next.agent_protocol.gate.blocking, true);
		assert.ok(next.agent_protocol.gate.forbidden_actions.includes("scan"));
		assert.match(
			next.agent_protocol.ai_instruction.raw_output_policy,
			/Machine output is for AI routing only/,
		);
		assert.equal(next.prd_confirmation.planned_task_count, 2);
		const start = await captureCliJson(["start", "--brief"]);
		assert.equal(start.agent_protocol.gate.kind, "prd-confirmation");
		assert.equal(
			start.agent_protocol.recommendation.command,
			"prd confirm --create-tasks",
		);
		assert.deepEqual(
			next.prd_confirmation.task_plan.map((item) => item.name),
			["implement-sensor-loop", "run-verification"],
		);
		assert.doesNotMatch(
			JSON.stringify(next.prd_confirmation),
			/RH-SZZ|battery-sense|system-state/,
		);

		const confirmed = await captureCliJson([
			"prd",
			"confirm",
			"--create-tasks",
		]);
		assert.equal(confirmed.status, "confirmed");
		assert.deepEqual(
			confirmed.created_tasks.map((item) => item.name),
			["implement-sensor-loop", "run-verification"],
		);
		assert.equal(confirmed.alignment.status, "needs-human-alignment");
		assert.equal(confirmed.agent_protocol.gate.kind, "alignment");
		assert.equal(confirmed.agent_protocol.gate.blocking, true);
		assert.equal(
			confirmed.agent_protocol.recommendation.command,
			"ai-host clarify-prd-task-alignment",
		);
		assert.match(
			confirmed.agent_protocol.ai_instruction.ask_user,
			/不明确|一致/,
		);
		assert.equal(
			fs.existsSync(
				path.join(
					tempProject,
					".emb-agent",
					"tasks",
					"implement-sensor-loop",
					"task.json",
				),
			),
			true,
		);
		assert.equal(
			fs.existsSync(
				path.join(
					tempProject,
					"docs",
					"prd",
					"tasks",
					"implement-sensor-loop.md",
				),
			),
			true,
		);

		const after = await captureCliJson(["next", "--brief"]);
		assert.equal(after.next.command, "task activate implement-sensor-loop");
	} finally {
		process.chdir(currentCwd);
	}
});
