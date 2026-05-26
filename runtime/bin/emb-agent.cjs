#!/usr/bin/env node

"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

function findRustBinary() {
	var names = process.platform === "win32"
		? ["emb-agent-rs.exe", "emb-agent-rs"]
		: ["emb-agent-rs", "emb-agent-rs.exe"];
	var dirs = [
		__dirname,
		path.join(process.cwd(), ".cursor", "emb-agent", "bin"),
		path.join(process.cwd(), ".omp", "emb-agent", "bin"),
		path.join(process.cwd(), ".claude", "emb-agent", "bin"),
		path.join(process.cwd(), ".codex", "emb-agent", "bin"),
		path.join(process.cwd(), ".pi", "emb-agent", "bin"),
		"",
	];
	for (var di = 0; di < dirs.length; di++) {
		for (var ni = 0; ni < names.length; ni++) {
			var p = dirs[di] ? path.join(dirs[di], names[ni]) : names[ni];
			try { if (fs.existsSync(p)) return p; } catch (_e) {}
		}
	}
	return "";
}

function main(argv) {
	var args = Array.isArray(argv) ? argv : process.argv.slice(2);
	var rustBin = findRustBinary();

	if (!rustBin) {
		process.stderr.write("emb-agent: Rust binary (emb-agent-rs) not found.\n");
		process.stderr.write("Build it with: cd emb-agent && cargo build --release\n");
		if (process.platform === "win32") {
			process.stderr.write("On Windows, also try: cargo build --release --target x86_64-pc-windows-msvc\n");
		}
		process.exit(1);
	}

	var result = childProcess.spawnSync(rustBin, args, {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		timeout: 120000,
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exit(result.status || 0);
}

module.exports = { main };

if (require.main === module) {
	try { main(process.argv.slice(2)); }
	catch (error) { process.stderr.write("emb-agent error: " + error.message + "\n"); process.exit(1); }
}
