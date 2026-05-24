#!/usr/bin/env node

"use strict";

const path = require("path");
const childProcess = require("child_process");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");

function findRustBinary() {
	const exeName =
		process.platform === "win32" ? "emb-agent-rs.exe" : "emb-agent-rs";
	const candidates = [
		path.join(process.cwd(), ".pi", "emb-agent", "bin", exeName),
		path.join(ROOT, "..", "target", "release", exeName),
		path.join(ROOT, "..", "target", "debug", exeName),
		exeName,
	];
	return (
		candidates.find((c) => {
			try {
				return fs.existsSync(c);
			} catch {
				return false;
			}
		}) || ""
	);
}

async function main(argv) {
	const args = Array.isArray(argv) ? argv : process.argv.slice(2);
	const rustBin = findRustBinary();

	if (rustBin && process.env.EMB_AGENT_RUST_HOOKS !== "0") {
		// Primary: spawn Rust binary
		const result = childProcess.spawnSync(rustBin, args, {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 120000,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, EMB_AGENT_RUST_HOOKS: "0" },
		});

		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.status || 0);
		return;
	}

	// Fallback: Node runtime (only when Rust binary not installed)
	process.stderr.write(
		"emb-agent: Rust binary not found, falling back to Node runtime\n",
	);
	const mainModule = require(path.join(ROOT, "lib", "emb-agent-main.cjs"));
	await mainModule.main(args);
}

// Lazy-load Node main module for backward compat (buildStartContext etc.)
let _mainModule = null;
function loadMainModule() {
	if (!_mainModule)
		_mainModule = require(path.join(ROOT, "lib", "emb-agent-main.cjs"));
	return _mainModule;
}

const exported = new Proxy(
	{ main, loadMainModule },
	{
		get(target, prop, receiver) {
			if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
			return loadMainModule()[prop];
		},
		has(target, prop) {
			return Reflect.has(target, prop) || prop in loadMainModule();
		},
		ownKeys(target) {
			return Array.from(
				new Set([
					...Reflect.ownKeys(target),
					...Reflect.ownKeys(loadMainModule()),
				]),
			);
		},
		getOwnPropertyDescriptor(target, prop) {
			if (Reflect.has(target, prop))
				return Object.getOwnPropertyDescriptor(target, prop);
			const desc = Object.getOwnPropertyDescriptor(loadMainModule(), prop);
			if (!desc) return desc;
			return { ...desc, configurable: true };
		},
	},
);

module.exports = exported;

if (require.main === module) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`emb-agent error: ${error.message}\n`);
		process.exit(1);
	});
}
