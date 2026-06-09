#!/usr/bin/env node

"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var https = require("https");
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
		path.join(process.cwd(), ".pi", "agent", "emb-agent", "bin"),
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

function readInstalledVersion() {
	try {
		return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim() || "unknown";
	} catch (_e) {
		return "unknown";
	}
}

function readStdinPayload() {
	if (process.stdin.isTTY) return undefined;
	try {
		var input = fs.readFileSync(0);
		return input && input.length ? input : undefined;
	} catch (_e) {
		return undefined;
	}
}

function compareSemver(a, b) {
	var pa = String(a || "").split(".").map(function (x) { return parseInt(x, 10) || 0; });
	var pb = String(b || "").split(".").map(function (x) { return parseInt(x, 10) || 0; });
	for (var i = 0; i < 3; i++) {
		if ((pa[i] || 0) < (pb[i] || 0)) return -1;
		if ((pa[i] || 0) > (pb[i] || 0)) return 1;
	}
	return 0;
}

function fetchJson(url, timeoutMs, callback) {
	var settled = false;
	function done(value, status) {
		if (settled) return;
		settled = true;
		callback(value, status);
	}
	var req = https.get(url, function (res) {
		if (res.statusCode !== 200) {
			res.resume();
			done(null, "http-" + res.statusCode);
			return;
		}
		var chunks = "";
		res.setEncoding("utf8");
		res.on("data", function (chunk) { chunks += chunk; });
		res.on("end", function () {
			try { done(JSON.parse(chunks), "ok"); }
			catch (_e) { done(null, "bad-json"); }
		});
	});
	req.on("error", function () { done(null, "network-error"); });
	req.setTimeout(timeoutMs, function () { req.destroy(); done(null, "timeout"); });
}

function fetchLatestVersion(callback) {
	fetchJson("https://registry.npmjs.org/emb-agent/latest", 2500, function (npmJson, npmStatus) {
		if (npmJson && npmJson.version) {
			callback(String(npmJson.version), "npm:ok");
			return;
		}
		fetchJson("https://raw.githubusercontent.com/Welkon/emb-agent/beta/package.json", 2500, function (githubJson, githubStatus) {
			if (githubJson && githubJson.version) {
				callback(String(githubJson.version), "github-beta:ok");
				return;
			}
			callback(null, "npm:" + npmStatus + ";github-beta:" + githubStatus);
		});
	});
}

function printUpdateCheck() {
	var installed = readInstalledVersion();
	fetchLatestVersion(function (latest, sourceStatus) {
		var updateAvailable = !!latest && installed !== "unknown" && compareSemver(installed, latest) < 0;
		var command = "npx emb-agent@latest update --target all --local";
		process.stdout.write(JSON.stringify({
			status: "ok",
			installed_version: installed,
			latest_version: latest || null,
			latest_source: sourceStatus && sourceStatus.indexOf("github-beta") === 0 ? "github:Welkon/emb-agent/beta/package.json" : "npm:emb-agent/latest",
			latest_status: sourceStatus,
			update_available: updateAvailable,
			manual_update_command: command,
			note: updateAvailable ? "Run the manual update command from the project root, then restart the host session." : "Installed runtime is current or latest version could not be confirmed."
		}) + "\n");
	});
}

function rustTimeoutMs(args) {
	var base = 120000;
	if (!Array.isArray(args) || args[0] !== "ingest" || args[1] !== "doc") return base;
	var requested = 300000;
	for (var i = 0; i < args.length - 1; i++) {
		if (args[i] !== "--timeout-ms") continue;
		var parsed = parseInt(args[i + 1], 10);
		if (Number.isFinite(parsed) && parsed > 0) requested = parsed;
	}
	return Math.max(base, requested + 60000);
}

function main(argv) {
	var args = Array.isArray(argv) ? argv : process.argv.slice(2);
	if (args[0] === "update" && (!args[1] || args[1] === "check" || args[1] === "command" || args[1] === "--brief" || args[1] === "--json")) {
		printUpdateCheck();
		return;
	}
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
		input: readStdinPayload(),
		maxBuffer: 1024 * 1024,
		timeout: rustTimeoutMs(args),
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (result.error) {
		process.stderr.write("emb-agent spawn error: " + result.error.message + "\n");
		process.exit(1);
	}

	if (result.stdout) fs.writeSync(1, result.stdout);
	if (result.stderr) fs.writeSync(2, result.stderr);
	process.exit(typeof result.status === "number" ? result.status : 1);
}

module.exports = { main };

if (require.main === module) {
	try { main(process.argv.slice(2)); }
	catch (error) { process.stderr.write("emb-agent error: " + error.message + "\n"); process.exit(1); }
}
