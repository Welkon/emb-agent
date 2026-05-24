#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const runtime = require("../lib/runtime.cjs");
const sessionReportStoreHelpers = require("../lib/session-report-store.cjs");
const workflowStateHelpers = require("../lib/workflow-state.cjs");
const knowledgeGraphState = require("../lib/knowledge-graph-state.cjs");

const sessionReportStore =
	sessionReportStoreHelpers.createSessionReportStoreHelpers({
		fs,
		path,
		runtime,
	});

function findProjectRoot(startDir) {
	let current = path.resolve(startDir || process.cwd());

	while (true) {
		if (fs.existsSync(path.join(current, ".emb-agent"))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return "";
		}
		current = parent;
	}
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return {};
	}
}

function readText(filePath) {
	try {
		return String(fs.readFileSync(filePath, "utf8") || "").trim();
	} catch {
		return "";
	}
}

function getKnowledgeGraphState(projectRoot) {
	return knowledgeGraphState.summarizeKnowledgeGraph(projectRoot, {
		fs,
		path,
		runtime,
	}).state;
}

function getGitBranch(projectRoot) {
	if (!projectRoot || !fs.existsSync(path.join(projectRoot, ".git"))) {
		return "";
	}

	try {
		return String(
			childProcess.execFileSync("git", ["branch", "--show-current"], {
				cwd: projectRoot,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}) || "",
		).trim();
	} catch {
		return "";
	}
}

function getDeveloper(projectRoot) {
	const payload = readJson(path.join(projectRoot, ".emb-agent", ".developer"));
	return String(payload.name || "").trim();
}

const CLOSED_TASK_STATUSES = new Set([
	"completed",
	"resolved",
	"closed",
	"rejected",
	"archived",
	"cancelled",
	"canceled",
]);
const BOOTSTRAP_TASK_NAMES = new Set([
	"00-bootstrap-project",
	"bootstrap-project",
]);

function normalizeTaskStatus(task) {
	return String(task && task.status ? task.status : "")
		.trim()
		.toLowerCase();
}

function isClosedTask(task) {
	const status = normalizeTaskStatus(task);
	return status ? CLOSED_TASK_STATUSES.has(status) : false;
}

function isBootstrapTask(task) {
	const name = String(task && task.name ? task.name : "")
		.trim()
		.toLowerCase();
	const title = String(task && task.title ? task.title : "")
		.trim()
		.toLowerCase();
	return BOOTSTRAP_TASK_NAMES.has(name) || title === "bootstrap project notes";
}

function getCurrentTask(projectRoot) {
	const taskName = readText(
		path.join(projectRoot, ".emb-agent", ".current-task"),
	);
	if (!taskName) {
		return null;
	}

	const manifest = readJson(
		path.join(projectRoot, ".emb-agent", "tasks", taskName, "task.json"),
	);
	if (!manifest || typeof manifest !== "object") {
		return null;
	}

	const task = {
		name: taskName,
		title: String(manifest.title || manifest.name || taskName).trim(),
		status: String(manifest.status || "").trim(),
		priority: String(manifest.priority || "P2").trim(),
		package: String(manifest.package || "").trim(),
	};

	if (isClosedTask(task) || isBootstrapTask(task)) {
		return null;
	}

	return {
		name: taskName,
		title: task.title,
		status: task.status,
		priority: task.priority,
		package: task.package,
	};
}

function getProjectPackageState(projectRoot) {
	const payload = readJson(
		path.join(projectRoot, ".emb-agent", "project.json"),
	);
	return {
		default_package: String(payload.default_package || "").trim(),
		active_package: String(payload.active_package || "").trim(),
	};
}

function getWorkflowState(projectRoot, task) {
	return workflowStateHelpers.resolveProjectWorkflowState(projectRoot, task, {
		fs,
		path,
		runtime,
	});
}

function countOpenTasks(projectRoot) {
	const tasksDir = path.join(projectRoot, ".emb-agent", "tasks");
	if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
		return 0;
	}

	return fs
		.readdirSync(tasksDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "archive")
		.map((entry) => readJson(path.join(tasksDir, entry.name, "task.json")))
		.filter((task) => task && typeof task === "object")
		.filter((task) => !isClosedTask(task) && !isBootstrapTask(task)).length;
}

function countWikiPages(projectRoot) {
	const wikiDir = path.join(projectRoot, ".emb-agent", "wiki");
	if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) {
		return 0;
	}
	let count = 0;
	function walk(dir) {
		fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name));
				return;
			}
			if (
				entry.name.endsWith(".md") &&
				entry.name !== "index.md" &&
				entry.name !== "log.md"
			) {
				count += 1;
			}
		});
	}
	walk(wikiDir);
	return count;
}

function getSessionCheckpoint(projectRoot, branch) {
	try {
		return sessionReportStore.buildSessionReportContinuity(
			path.join(projectRoot, ".emb-agent"),
			{
				cwd: projectRoot,
				current_branch: branch,
			},
		);
	} catch {
		return {
			present: false,
			branch_status: "none",
			preferred: null,
		};
	}
}

function colorize(code, text) {
	return `\u001b[${code}m${text}\u001b[0m`;
}

function formatDuration(rawMs) {
	const totalSeconds = Math.max(0, Math.floor(Number(rawMs || 0) / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) {
		return `${hours}h${minutes}m`;
	}
	return `${minutes}m`;
}

function buildStatusLine(input) {
	const cwd =
		String((input && input.cwd) || process.cwd()).trim() || process.cwd();
	const projectRoot = findProjectRoot(cwd);
	if (!projectRoot) {
		return "";
	}

	const task = getCurrentTask(projectRoot);
	const workflowState = getWorkflowState(projectRoot, task);
	const developer = getDeveloper(projectRoot);
	const branch = getGitBranch(projectRoot);
	const taskCount = countOpenTasks(projectRoot);
	const wikiPageCount = countWikiPages(projectRoot);
	const packageState = getProjectPackageState(projectRoot);
	const sessionCheckpoint = getSessionCheckpoint(projectRoot, branch);
	const graphState = getKnowledgeGraphState(projectRoot);
	const durationMs =
		(input && input.cost && input.cost.total_duration_ms) ||
		(input && input.duration_ms) ||
		0;

	const sep = ` ${colorize(90, "·")} `;
	const infoParts = [];

	if (branch) {
		infoParts.push(colorize(35, branch));
	}
	if (sessionCheckpoint.present) {
		if (sessionCheckpoint.branch_status === "mismatch") {
			infoParts.push(colorize(33, "snapshot!"));
		} else if (sessionCheckpoint.branch_status === "match") {
			infoParts.push(colorize(32, "snapshot"));
		} else {
			infoParts.push(colorize(90, "snapshot?"));
		}
	}
	if (graphState === "fresh") {
		infoParts.push(colorize(32, "graph fresh"));
	} else if (graphState === "stale") {
		infoParts.push(colorize(33, "graph stale"));
	} else {
		infoParts.push(colorize(90, "graph missing"));
	}
	if (wikiPageCount === 0) {
		infoParts.push(colorize(90, "wiki empty"));
	} else {
		infoParts.push(colorize(36, `wiki ${wikiPageCount}`));
	}
	const packageName =
		task && task.package
			? task.package
			: packageState.active_package || packageState.default_package || "";
	if (packageName) {
		infoParts.push(colorize(36, `pkg:${packageName}`));
	}
	infoParts.push(formatDuration(durationMs));
	if (developer) {
		infoParts.push(colorize(32, developer));
	}
	if (taskCount > 0) {
		infoParts.push(`${taskCount} open task(s)`);
	} else if (workflowState !== "unknown" && workflowState !== "hw_declared") {
		infoParts.push(colorize(33, "no task"));
	}

	const lines = [infoParts.join(sep)];

	if (task) {
		lines.push(
			`${colorize(36, `[${task.priority || "P2"}]`)} ${task.title} ${colorize(33, `(${task.status || "unknown"})`)}`,
		);
	}
	return `${lines.filter(Boolean).join("\n")}\n`;
}

function readStdin(callback) {
	let raw = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk) => {
		raw += chunk;
	});
	process.stdin.on("end", () => {
		if (!raw.trim()) {
			callback({});
			return;
		}
		try {
			callback(JSON.parse(raw));
		} catch {
			callback({});
		}
	});
}

if (require.main === module) {
	readStdin((input) => {
		// Fast-path: delegate to Rust binary
		if (process.env.EMB_AGENT_RUST_HOOKS !== "0") {
			try {
				const projectRoot = findProjectRoot(input.cwd || process.cwd());
				const rustBin =
					process.env.EMB_AGENT_RUST_BINARY ||
					path.join(
						projectRoot,
						".pi",
						"emb-agent",
						"bin",
						process.platform === "win32" ? "emb-agent-rs.exe" : "emb-agent-rs",
					);
				if (fs.existsSync(rustBin)) {
					const result = childProcess.spawnSync(
						rustBin,
						["statusline", "--cwd", projectRoot],
						{
							encoding: "utf8",
							timeout: 3000,
							env: { ...process.env, EMB_AGENT_WORKSPACE_TRUST: "1" },
						},
					);
					if (result.status === 0 && result.stdout && result.stdout.trim()) {
						process.stdout.write(result.stdout.trim());
						return;
					}
				}
			} catch (e) {
				/* fall through */
			}
		}
		const output = buildStatusLine(input);
		if (output) {
			process.stdout.write(output);
		}
	});
}

module.exports = {
	buildStatusLine,
};
