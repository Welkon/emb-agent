"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const statuslineHook = require(
	path.join(repoRoot, "runtime", "hooks", "emb-statusline.js"),
);
const contextMonitorHook = require(
	path.join(repoRoot, "runtime", "hooks", "emb-context-monitor.js"),
);

function hasCargo() {
	try {
		childProcess.execFileSync("cargo", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function runRust(args, cwd = repoRoot, input = "", env = {}) {
	return childProcess
		.execFileSync("cargo", ["run", "-q", "-p", "emb-agent-rs", "--", ...args], {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				...env,
			},
			input,
			stdio: ["pipe", "pipe", "pipe"],
		})
		.trim();
}

function resolveHookPlan(hook, env = {}, host = "pi") {
	return JSON.parse(
		runRust(
			[
				"hook",
				"resolve",
				"--host",
				host,
				"--hook",
				hook,
				"--runtime-dir",
				"runtime",
				"--json",
			],
			repoRoot,
			"",
			env,
		),
	);
}

function makeProject() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "emb-agent-rust-parity-"));
	const embDir = path.join(root, ".emb-agent");
	const taskDir = path.join(embDir, "tasks", "adc-task");
	const wikiDir = path.join(embDir, "wiki", "chips");
	fs.mkdirSync(taskDir, { recursive: true });
	fs.mkdirSync(wikiDir, { recursive: true });
	fs.writeFileSync(
		path.join(embDir, "project.json"),
		JSON.stringify(
			{
				project_profile: "baremetal-loop",
				active_specs: ["project-local"],
				packages: [
					{
						name: "fw",
						path: "firmware",
						type: "firmware",
						submodule: false,
					},
				],
				default_package: "fw",
				active_package: "fw",
				flash_flow: "repo_hex",
				preferences: {
					verification_mode: "strict",
				},
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	fs.writeFileSync(
		path.join(embDir, ".developer"),
		JSON.stringify({ name: "felix" }, null, 2) + "\n",
		"utf8",
	);
	fs.writeFileSync(path.join(embDir, ".current-task"), "adc-task\n", "utf8");
	fs.writeFileSync(
		path.join(embDir, "hw.yaml"),
		[
			"mcu:",
			"  vendor: Espressif",
			"  model: ESP32-C3",
			"  package: QFN32",
			"board:",
			"  name: RustParityBoard",
			"  target: repo_hex",
			"signals:",
			"  - name: ADC_IN",
			"    pin: GPIO4",
			"    direction: input",
			"    default_state: floating",
			"    confirmed: true",
			"    note: battery divider",
			"peripherals:",
			"  - name: ADC1",
			"    usage: battery sense",
			"constraints:",
			"  - Preserve sleep current",
			"unknowns:",
			"  - Divider tolerance",
			"",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(embDir, "req.yaml"),
		[
			"goals:",
			"  - Exercise ADC path",
			"features:",
			"  - Battery telemetry",
			"constraints:",
			"  - Reuse existing board pins",
			"acceptance:",
			"  - ADC path is stable over ten samples",
			"failure_policy:",
			"  - Fail safe on ADC timeout",
			"unknowns:",
			"  - Production temperature range",
			"sources:",
			"  - docs/prd/system.md",
			"",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(taskDir, "task.json"),
		JSON.stringify(
			{
				name: "adc-task",
				title: "Exercise ADC path",
				status: "in_progress",
				priority: "P1",
				package: "fw",
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	fs.writeFileSync(path.join(wikiDir, "esp32-c3.md"), "# ESP32-C3\n", "utf8");
	childProcess.execFileSync("git", ["init", "-b", "feat/rust-parity"], {
		cwd: root,
		stdio: "ignore",
	});
	return root;
}

test("rust start --brief --json captures the same lightweight project facts", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const payload = JSON.parse(
			runRust(["start", "--brief", "--json", "--cwd", root]),
		);
		assert.equal(payload.status, "ok");
		assert.equal(payload.runtime, "emb-agent-rs-spike");
		assert.equal(payload.summary.initialized, true);
		assert.equal(payload.summary.project_root, fs.realpathSync(root));
		assert.equal(payload.summary.mcu_model, "ESP32-C3");
		assert.equal(payload.summary.mcu_package, "QFN32");
		assert.equal(payload.summary.open_tasks, 1);
		assert.equal(payload.summary.wiki_pages, 1);
		assert.equal(payload.summary.active_task.name, "adc-task");
		assert.equal(payload.summary.active_task.title, "Exercise ADC path");
		assert.equal(payload.summary.active_task.priority, "P1");
		assert.equal(payload.immediate.command, "do");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust diagnostics project exposes typed project-state fixture", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const payload = JSON.parse(
			runRust(["diagnostics", "project", "--json", "--cwd", root]),
		);
		assert.equal(payload.status, "ok");
		assert.equal(payload.initialized, true);
		assert.equal(payload.project_root, fs.realpathSync(root));
		assert.equal(payload.config.project_profile, "baremetal-loop");
		assert.deepEqual(payload.config.active_specs, ["project-local"]);
		assert.equal(payload.config.packages[0].name, "fw");
		assert.equal(payload.config.packages[0].path, "firmware");
		assert.equal(payload.config.packages[0].type, "firmware");
		assert.equal(payload.config.default_package, "fw");
		assert.equal(payload.config.active_package, "fw");
		assert.equal(payload.config.flash_flow, "repo_hex");
		assert.equal(payload.config.preferences.verification_mode, "strict");
		assert.equal(payload.config.preferences.plan_mode, "auto");
		assert.equal(payload.hardware.model, "ESP32-C3");
		assert.equal(payload.hardware.board_name, "RustParityBoard");
		assert.equal(payload.hardware.signals[0].name, "ADC_IN");
		assert.equal(payload.hardware.signals[0].confirmed, true);
		assert.equal(payload.hardware.peripherals[0].name, "ADC1");
		assert.deepEqual(payload.requirements.goals, ["Exercise ADC path"]);
		assert.deepEqual(payload.requirements.features, ["Battery telemetry"]);
		assert.equal(
			payload.requirements.acceptance[0],
			"ADC path is stable over ten samples",
		);
		assert.equal(payload.current_task.name, "adc-task");
		assert.equal(payload.current_task.package, "fw");
		assert.equal(payload.open_tasks, 1);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust diagnostics state-paths mirrors Node storage path conventions", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const payload = JSON.parse(
			runRust([
				"diagnostics",
				"state-paths",
				"--json",
				"--cwd",
				root,
				"--runtime-dir",
				"runtime",
			]),
		);
		assert.equal(payload.status, "ok");
		assert.equal(payload.project_root, fs.realpathSync(root));
		assert.match(payload.project_key, /^[a-f0-9]{12}$/);
		assert.match(payload.state_dir, /state\/emb-agent\/projects$/);
		assert.match(payload.legacy_state_dir, /runtime\/state\/projects$/);
		assert.match(
			payload.session_path,
			new RegExp(`${payload.project_key}\\.json$`),
		);
		assert.match(
			payload.handoff_path,
			new RegExp(`${payload.project_key}\\.handoff\\.json$`),
		);
		assert.match(
			payload.context_summary_path,
			new RegExp(`${payload.project_key}\\.context-summary\\.json$`),
		);
		assert.match(
			payload.fallback_state_dir,
			/emb-agent-state\/[^/]+\/projects$/,
		);
		assert.equal(payload.primary.session_path, payload.session_path);
		assert.equal(
			payload.fallback.session_path,
			`${payload.fallback_state_dir}/${payload.project_key}.json`,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust statusline preserves core statusline semantics from node hook", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const nodeLine = statuslineHook.buildStatusLine({
			cwd: root,
			cost: { total_duration_ms: 60000 },
		});
		const rustLine = runRust(["statusline", "--cwd", root]);

		assert.match(nodeLine, /Exercise ADC path/);
		assert.match(nodeLine, /\[P1\]/);
		assert.match(nodeLine, /1 open task\(s\)/);
		assert.match(nodeLine, /feat\/rust-parity/);

		assert.match(rustLine, /Exercise ADC path/);
		assert.match(rustLine, /\[P1\]/);
		assert.match(rustLine, /1 task\(s\)/);
		assert.match(rustLine, /feat\/rust-parity/);
		assert.match(rustLine, /ESP32-C3 QFN32/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust session-start hook payload is pi-compatible and self-contained", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const payload = JSON.parse(
			runRust(["hook", "session-start", "--cwd", root, "--host", "pi"]),
		);
		assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
		const context = payload.hookSpecificOutput.additionalContext;
		assert.match(context, /emb-agent Rust spike context is injected/);
		assert.match(context, /Project root:/);
		assert.match(context, /MCU: ESP32-C3/);
		assert.match(context, /MCU package: QFN32/);
		assert.match(context, /Active task: adc-task \(Exercise ADC path\)/);
		assert.match(context, /Recommended next command: do/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust hook resolver emits a unified source-layout command plan", {
	skip: !hasCargo(),
}, () => {
	const plan = JSON.parse(
		runRust([
			"hook",
			"resolve",
			"--host",
			"pi",
			"--hook",
			"session-start",
			"--runtime-dir",
			"runtime",
			"--json",
		]),
	);
	assert.equal(plan.hook, "session-start");
	assert.equal(plan.host, "pi");
	assert.equal(plan.runtime, "rust");
	assert.equal(plan.reason, "source-runtime-default");
	assert.match(plan.command, /hook session-start --host pi/);
	assert.match(plan.fallback, /node runtime\/hooks\/emb-session-start\.js/);

	const contextMonitor = JSON.parse(
		runRust([
			"hook",
			"resolve",
			"--host",
			"cursor",
			"--hook",
			"context-monitor",
			"--runtime-dir",
			"runtime",
			"--json",
		]),
	);
	assert.equal(contextMonitor.hook, "context-monitor");
	assert.equal(contextMonitor.host, "cursor");
	assert.equal(contextMonitor.runtime, "rust");
	assert.equal(contextMonitor.reason, "source-runtime-default");
	assert.match(contextMonitor.command, /hook context-monitor/);
	assert.match(
		contextMonitor.fallback,
		/node runtime\/hooks\/emb-context-monitor\.js/,
	);
});

test("rust context-monitor hook emits pi-compatible critical context warning", {
	skip: !hasCargo(),
}, () => {
	const root = makeProject();
	try {
		const input = {
			cwd: root,
			event: "PostToolUse",
			workspace_trusted: true,
			context_window: {
				remaining_percentage: 18,
			},
		};
		const nodeMetrics = contextMonitorHook.parseContextMetrics(input);
		assert.equal(nodeMetrics.remaining, 18);
		assert.equal(nodeMetrics.used, 82);

		const output = runRust(
			["hook", "context-monitor"],
			repoRoot,
			JSON.stringify(input),
		);
		assert.notEqual(output, "");
		const payload = JSON.parse(output);
		assert.equal(payload.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(
			payload.hookSpecificOutput.additionalContext,
			/EMB CONTEXT CRITICAL/,
		);
		assert.match(payload.hookSpecificOutput.additionalContext, /pause/);
		assert.match(
			payload.hookSpecificOutput.additionalContext,
			/host clear\/new-context control/,
		);

		const repeated = runRust(
			["hook", "context-monitor"],
			repoRoot,
			JSON.stringify(input),
		);
		assert.equal(repeated, "");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("rust hook resolver honors runtime override environment", {
	skip: !hasCargo(),
}, () => {
	const hooks = ["session-start", "statusline", "context-monitor"];

	for (const hook of hooks) {
		const nodePlan = resolveHookPlan(hook, { EMB_AGENT_RUST_HOOKS: "0" });
		assert.equal(nodePlan.hook, hook);
		assert.equal(nodePlan.runtime, "node");
		assert.equal(nodePlan.reason, "forced-node");
		assert.match(nodePlan.command, new RegExp(`emb-${hook}\\.js`));
		assert.equal(nodePlan.fallback, "");

		const rustPlan = resolveHookPlan(hook, { EMB_AGENT_RUST_HOOKS: "1" });
		assert.equal(rustPlan.hook, hook);
		assert.equal(rustPlan.runtime, "rust");
		assert.equal(rustPlan.reason, "forced-rust");
		assert.match(rustPlan.command, new RegExp(`hook ${hook}`));
		assert.match(rustPlan.fallback, new RegExp(`emb-${hook}\\.js`));
	}

	for (const hook of hooks) {
		const customPlan = resolveHookPlan(hook, {
			EMB_AGENT_RUST_HOOKS: "1",
			EMB_AGENT_RUST_HOOK_CMD: "/tmp/custom-emb-agent-rs",
		});
		assert.equal(customPlan.runtime, "rust");
		assert.match(
			customPlan.command,
			new RegExp(`^/tmp/custom-emb-agent-rs hook ${hook}`),
		);
	}
});

test("rust hook diagnostics reports all hook plans and fallback state", {
	skip: !hasCargo(),
}, () => {
	const diagnostics = JSON.parse(
		runRust([
			"diagnostics",
			"hooks",
			"--json",
			"--host",
			"pi",
			"--runtime-dir",
			"runtime",
		]),
	);
	assert.equal(diagnostics.status, "ok");
	assert.equal(diagnostics.runtime, "emb-agent-rs-spike");
	assert.equal(diagnostics.host, "pi");
	assert.equal(diagnostics.source_runtime, true);
	assert.equal(typeof diagnostics.rust_binary, "string");
	assert.equal(typeof diagnostics.rust_binary_exists, "boolean");
	assert.equal(diagnostics.hooks.session_start.runtime, "rust");
	assert.equal(diagnostics.hooks.statusline.runtime, "rust");
	assert.equal(diagnostics.hooks.context_monitor.runtime, "rust");
	assert.equal(
		diagnostics.hooks.context_monitor.reason,
		"source-runtime-default",
	);
});
