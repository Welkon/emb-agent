#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

function findProjectRoot(startDir) {
	let current = path.resolve(startDir || process.cwd());
	while (true) {
		if (fs.existsSync(path.join(current, ".emb-agent"))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) return "";
		current = parent;
	}
}

function buildStatusLine(data) {
	// Delegated to Rust binary (0.01s vs 0.5s Node)
	try {
		const projectRoot = findProjectRoot(data.cwd || process.cwd());
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
				return result.stdout.trim();
			}
		}
	} catch (e) {
		/* fall through */
	}
	return "emb";
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
		if (output) process.stdout.write(output);
	});
}

module.exports = { buildStatusLine };
