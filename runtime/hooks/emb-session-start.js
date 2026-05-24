#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const hookDispatchHelpers = require("../lib/hook-dispatch.cjs");
const hookTrustHelpers = require("../lib/hook-trust.cjs");
const runtimeHostHelpers = require("../lib/runtime-host.cjs");
const updateCheckHelpers = require("../lib/update-check.cjs");
const runtime = require("../lib/runtime.cjs");
const workflowRegistry = require("../lib/workflow-registry.cjs");
const sessionReportStoreHelpers = require("../lib/session-report-store.cjs");
const specLoader = require("../lib/spec-loader.cjs");
const workflowStateHelpers = require("../lib/workflow-state.cjs");

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOOK_VERSION = "{{EMB_VERSION}}";
const RUNTIME_HOST =
	runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
	fs,
	path,
	process,
	runtimeHost: RUNTIME_HOST,
});
const sessionReportStore =
	sessionReportStoreHelpers.createSessionReportStoreHelpers({
		fs,
		path,
		runtime,
	});

function getRuntimeRoot() {
	return RUNTIME_HOST.runtimeRoot;
}

function getStateRoot() {
	return RUNTIME_HOST.stateRoot;
}

function getUpdateCachePath() {
	return updateCheckHelpers.getUpdateCachePath(path, getStateRoot());
}

function readInstalledVersion() {
	return updateCheckHelpers.readInstalledVersion(fs, path, getRuntimeRoot());
}

function compareVersions(left, right) {
	return updateCheckHelpers.compareVersions(left, right);
}

function readUpdateCache() {
	return updateCheckHelpers.readUpdateCache(fs, getUpdateCachePath());
}

function isUpdateCacheStale(cache) {
	return updateCheckHelpers.isUpdateCacheStale(cache, UPDATE_CHECK_INTERVAL_MS);
}

function triggerUpdateCheck(cache) {
	const cachePath = getUpdateCachePath();
	runtime.ensureDir(path.dirname(cachePath));
	const installed = readInstalledVersion();

	return updateCheckHelpers.triggerUpdateCheck({
		fs,
		path,
		childProcess,
		process,
		cachePath,
		installed,
		packageName: "emb-agent",
		intervalMs: UPDATE_CHECK_INTERVAL_MS,
		cache,
	});
}

function detectStaleInstall() {
	const installed = readInstalledVersion();
	const hookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION || HOOK_VERSION;
	return updateCheckHelpers.detectStaleInstall(installed, hookVersion);
}

function buildUpdateLines() {
	const lines = [];
	const staleInstall = detectStaleInstall();
	const cache = readUpdateCache();
	triggerUpdateCheck(cache);

	if (staleInstall) {
		lines.push(
			`Detected stale install: hooks=${staleInstall.hook}, runtime=${staleInstall.installed}`,
		);
		lines.push(
			"Re-run emb-agent install to keep hooks / runtime / agents in sync.",
		);
	}

	if (cache && cache.update_available && cache.latest) {
		lines.push(
			`Found a newer emb-agent version: ${cache.installed || "unknown"} -> ${cache.latest}`,
		);
		lines.push(
			"Manual release mode is active; run the release check and reinstall manually when needed.",
		);
	}

	return lines;
}

function buildInjectedWorkflowSpecLines(projectRoot, resume) {
	const snapshot = workflowRegistry.buildInjectedSpecSnapshot(
		getRuntimeRoot(),
		runtime.getProjectExtDir(projectRoot),
		{
			profile: resume && resume.summary ? resume.summary.profile : "",
			specs: resume && resume.summary ? resume.summary.specs || [] : [],
			task: resume ? resume.task : null,
			handoff: resume ? resume.handoff : null,
		},
		{ limit: 5 },
	);
	const specs = snapshot.items || [];

	if (specs.length === 0) {
		return [];
	}

	return [
		"Auto-injected workflow specs:",
		...specs.map((item) => {
			const reason = item.reasons.join(", ");
			return `- ${item.name} (${item.display_path}): ${item.summary}${reason ? ` [${reason}]` : ""}`;
		}),
	];
}

function summaryHasActiveTask(start) {
	return Boolean(
		start &&
			start.summary &&
			typeof start.summary === "object" &&
			start.summary.active_task &&
			typeof start.summary.active_task === "object" &&
			start.summary.active_task.name,
	);
}

function runHook(rawInput) {
	return hookDispatch.runHookWithProjectContext(
		rawInput,
		({ data, projectRoot }) => {
			// Fast-path: delegate to Rust binary for 58x speed improvement
			if (process.env.EMB_AGENT_RUST_HOOKS !== "0") {
				try {
					const rustBin =
						process.env.EMB_AGENT_RUST_BINARY ||
						path.join(
							projectRoot,
							".pi",
							"emb-agent",
							"bin",
							process.platform === "win32"
								? "emb-agent-rs.exe"
								: "emb-agent-rs",
						);
					if (fs.existsSync(rustBin)) {
						const result = require("child_process").spawnSync(
							rustBin,
							["hook", "session-start", "--host", "pi"],
							{
								cwd: projectRoot,
								encoding: "utf8",
								timeout: 5000,
								input: JSON.stringify(data || {}),
								env: {
									...process.env,
									EMB_AGENT_WORKSPACE_TRUST: "1",
								},
							},
						);
						if (result.status === 0 && result.stdout && result.stdout.trim()) {
							return result.stdout.trim();
						}
					}
				} catch (e) {
					/* fall through to Node logic */
				}
			}

			// Full Node context (fallback: spawn Rust binary directly)
			try {
				const rustBin =
					process.env.EMB_AGENT_RUST_BINARY ||
					path.join(
						projectRoot,
						".pi",
						"emb-agent",
						"bin",
						process.platform === "win32"
							? "emb-agent-rs.exe"
							: "emb-agent-rs",
					);
				if (fs.existsSync(rustBin)) {
					const result = require("child_process").spawnSync(
						rustBin,
						["hook", "session-start", "--host", "pi"],
						{
							cwd: projectRoot,
							encoding: "utf8",
							timeout: 5000,
							input: JSON.stringify(data || {}),
							env: { ...process.env, EMB_AGENT_WORKSPACE_TRUST: "1" },
						},
					);
					if (
						result.status === 0 &&
						result.stdout &&
						result.stdout.trim()
					) {
						return result.stdout.trim();
					}
				}
			} catch (e) {
				/* fall through */
			}
			return "";
		},
	);
}

if (require.main === module) {
	hookDispatch.runHookCli(runHook);
}

module.exports = {
	buildInjectedWorkflowSpecLines,
	buildUpdateLines,
	compareVersions,
	detectStaleInstall,
	getUpdateCachePath,
	isUpdateCacheStale,
	readInstalledVersion,
	readUpdateCache,
	hookDispatch,
	hookTrustHelpers,
	runHook,
	triggerUpdateCheck,
};
