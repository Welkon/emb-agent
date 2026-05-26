#!/usr/bin/env node
// emb-agent installer v0.5.0
// Deploys Rust binary + runtime templates to target AI host directories.

var fs = require("fs");
var path = require("path");
var https = require("https");

var REPO_ROOT = path.resolve(__dirname, "..");
var PACKAGE_JSON = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
var VERSION = PACKAGE_JSON.version || "0.5.0";

var RUNTIME_SRC = path.join(REPO_ROOT, "runtime");
var RUST_BIN_DIR = path.join(REPO_ROOT, "bin");
var COMMANDS_SRC = path.join(REPO_ROOT, "commands", "emb");
var COMMAND_DOCS_SRC = path.join(REPO_ROOT, "command-docs", "emb");
var AGENTS_SRC = path.join(REPO_ROOT, "agents");

var SUPPORTED_HOSTS = [
	{ name: "codex", dir: ".codex", profile: "core" },
	{ name: "cursor", dir: ".cursor", profile: "core" },
	{ name: "claude", dir: ".claude", profile: "core" },
	{ name: "pi", dir: ".pi", profile: "core" },
	{ name: "omp", dir: ".omp", profile: "core" },
	{ name: "windsurf", dir: ".windsurf", profile: "core" },
];

// ── Platform detection ────────────────────────────────────────────

function platformKey() {
	var plat = process.platform;
	var arch = process.arch;
	if (plat === "win32") plat = "windows";
	if (plat === "darwin") plat = "macos";
	if (arch === "x64") arch = "x86_64";
	return plat + "-" + arch;
}

function binaryName() {
	var key = platformKey();
	var ext = key.startsWith("windows") ? ".exe" : "";
	return "emb-agent-rs-" + key + ext;
}

function binarySrc() { return path.join(RUST_BIN_DIR, binaryName()); }

// ── Download binary from GitHub Releases ──────────────────────────

function downloadBinary(dest, callback) {
	var key = platformKey();
	var ext = key.startsWith("windows") ? ".exe" : "";
	// Try github releases: https://github.com/Welkon/emb-agent/releases/download/v<VERSION>/emb-agent-rs-<platform><ext>
	var url = "https://github.com/Welkon/emb-agent/releases/download/v" + VERSION + "/" + binaryName();
	console.log("    Downloading " + binaryName() + " from GitHub Releases...");
	var file = fs.createWriteStream(dest);

	https.get(url, function (res) {
		if (res.statusCode === 302) {
			https.get(res.headers.location, function (r2) {
				r2.pipe(file);
				file.on("finish", function () {
					file.close();
					try { fs.chmodSync(dest, 0o755); } catch (_) {}
					callback(true);
				});
			}).on("error", function () { callback(false); });
		} else if (res.statusCode === 200) {
			res.pipe(file);
			file.on("finish", function () {
				file.close();
				try { fs.chmodSync(dest, 0o755); } catch (_) {}
				callback(true);
			});
		} else {
			callback(false);
		}
	}).on("error", function () { callback(false); });
}

function deployRustBinary(embDir, callback) {
	var destName = "emb-agent-rs" + (process.platform === "win32" ? ".exe" : "");
	var dest = path.join(embDir, "bin", destName);

	// 1. Try local build artifact
	var src = binarySrc();
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, dest);
		console.log("    Rust binary deployed (" + binaryName() + ")");
		callback();
		return;
	}

	// 2. Fallback: check for generic names in bin/
	var genericNames = process.platform === "win32"
		? ["emb-agent-rs.exe", "emb-agent-rs"]
		: ["emb-agent-rs", "emb-agent-rs.exe"];
	for (var i = 0; i < genericNames.length; i++) {
		var p = path.join(RUST_BIN_DIR, genericNames[i]);
		if (fs.existsSync(p)) {
			fs.copyFileSync(p, dest);
			console.log("    Rust binary deployed (generic fallback)");
			callback();
			return;
		}
	}

	// 3. Download from GitHub Releases
	downloadBinary(dest, function (success) {
		if (success) {
			console.log("    Rust binary downloaded (" + binaryName() + ")");
			callback();
			return;
		}
		console.log("    \u26A0 Rust binary not found for " + platformKey());
		console.log("    Build with: cargo build --release");
		console.log("    Or download: https://github.com/Welkon/emb-agent/releases");
		callback();
	});
}

// ── Utilities ─────────────────────────────────────────────────────

function usage() {
	console.log(
		[
			"emb-agent v" + VERSION + " installer",
			"",
			"Usage:",
			"  npx emb-agent                            # Interactive install",
			"  npx emb-agent --target pi                # Install for pi",
			"  npx emb-agent --target omp               # Install for Oh My Pi",
			"  npx emb-agent --target codex             # Install for Codex",
			"  npx emb-agent --target all               # Install for all hosts",
			"  npx emb-agent --help                     # Show this help",
			"",
			"The installer deploys:",
			"  - Rust binary to .<host>/emb-agent/bin/",
			"  - Thin Node.js wrapper (emb-agent.cjs)",
			"  - Runtime templates (profiles, schemas, scaffolds)",
			"  - Command documentation and agent prompts",
		].join("\n"),
	);
}

function parseArgs(argv) {
	var args = { target: "", help: false, force: false };
	for (var i = 0; i < argv.length; i++) {
		var t = argv[i];
		if (t === "--help" || t === "-h") args.help = true;
		else if (t === "--target") args.target = argv[++i] || "";
		else if (t === "--force") args.force = true;
	}
	return args;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function copyDir(src, dest) {
	if (!fs.existsSync(src)) return;
	ensureDir(dest);
	var entries = fs.readdirSync(src, { withFileTypes: true });
	for (var i = 0; i < entries.length; i++) {
		var e = entries[i];
		var s = path.join(src, e.name);
		var d = path.join(dest, e.name);
		if (e.isDirectory()) copyDir(s, d);
		else fs.copyFileSync(s, d);
	}
}

function copyIf(src, dest) {
	if (fs.existsSync(src)) {
		ensureDir(path.dirname(dest));
		fs.copyFileSync(src, dest);
		return true;
	}
	return false;
}

// ── Install per host ──────────────────────────────────────────────

function installForHost(projectRoot, host) {
	var hostDir = path.join(projectRoot, host.dir);
	var embDir = path.join(hostDir, "emb-agent");

	console.log("  Installing for " + host.name + " \u2192 " + hostDir);

	// Core directories
	ensureDir(path.join(embDir, "bin"));
	ensureDir(path.join(embDir, "commands", "emb"));
	ensureDir(path.join(embDir, "command-docs", "emb"));
	ensureDir(path.join(embDir, "agents"));

	// Rust binary (async download)
	var done = 0;
	function checkDone() {
		done++;
		if (done >= 2) finish();
	}
	deployRustBinary(embDir, checkDone);
	// Fallback timer: if download stalls, proceed without binary after 30s
	setTimeout(checkDone, 30000);

	function finish() {
		// Thin Node.js wrapper
		var wrapperPath = path.join(RUNTIME_SRC, "bin", "emb-agent.cjs");
		copyIf(wrapperPath, path.join(embDir, "bin", "emb-agent.cjs"));

		// Runtime templates
		copyDir(path.join(RUNTIME_SRC, "profiles"), path.join(embDir, "profiles"));
		copyDir(path.join(RUNTIME_SRC, "schemas"), path.join(embDir, "schemas"));
		copyDir(path.join(RUNTIME_SRC, "scaffolds"), path.join(embDir, "scaffolds"));
		copyDir(path.join(RUNTIME_SRC, "templates"), path.join(embDir, "templates"));
		copyDir(path.join(RUNTIME_SRC, "registry"), path.join(embDir, "registry"));
		copyDir(path.join(RUNTIME_SRC, "specs"), path.join(embDir, "specs"));
		copyDir(path.join(RUNTIME_SRC, "chips"), path.join(embDir, "chips"));

		// Config
		copyIf(path.join(RUNTIME_SRC, "config.json"), path.join(embDir, "config.json"));

		// Commands documentation
		copyDir(COMMANDS_SRC, path.join(embDir, "commands", "emb"));
		copyDir(COMMAND_DOCS_SRC, path.join(embDir, "command-docs", "emb"));

		// Agent prompts
		copyDir(AGENTS_SRC, path.join(embDir, "agents"));

		// Host metadata
		fs.writeFileSync(path.join(embDir, "VERSION"), VERSION + "\n");
		fs.writeFileSync(
			path.join(embDir, "HOST.json"),
			JSON.stringify({
				name: host.name,
				label: host.name.charAt(0).toUpperCase() + host.name.slice(1),
				install_profile: host.profile,
				install_scope: "local",
				target_dir: hostDir,
				runtime_dir_name: "emb-agent",
			}, null, 2) + "\n",
		);

		// Deploy host-specific extension
		var extScaffoldDir = path.join(RUNTIME_SRC, "scaffolds", "shells", host.dir, "extensions");
		if (fs.existsSync(extScaffoldDir)) {
			var extDir = path.join(hostDir, "extensions");
			ensureDir(extDir);
			var extSrc = path.join(extScaffoldDir, "emb-agent.ts");
			if (fs.existsSync(extSrc)) {
				fs.copyFileSync(extSrc, path.join(extDir, "emb-agent.ts"));
				console.log("    Extension deployed to " + host.dir + "/extensions/");
			}
		}

		// Deploy shared skill
		var skillScaffoldDir = path.join(RUNTIME_SRC, "scaffolds", "skills", "emb-agent");
		if (fs.existsSync(skillScaffoldDir)) {
			var skillDir = path.join(hostDir, "skills", "emb-agent");
			ensureDir(skillDir);
			var skillSrc = path.join(skillScaffoldDir, "SKILL.md");
			if (fs.existsSync(skillSrc)) {
				fs.copyFileSync(skillSrc, path.join(skillDir, "SKILL.md"));
				console.log("    Skill deployed to " + host.dir + "/skills/emb-agent/");
			}
		}

		// Deploy host-specific config files
		var hostShellDir = path.join(RUNTIME_SRC, "scaffolds", "shells", host.dir);
		var configFiles = ["hooks.json", "settings.json"];
		for (var ci = 0; ci < configFiles.length; ci++) {
			var cfg = configFiles[ci];
			var cfgSrc = path.join(hostShellDir, cfg);
			if (fs.existsSync(cfgSrc)) {
				fs.copyFileSync(cfgSrc, path.join(hostDir, cfg));
				console.log("    " + cfg + " deployed to " + host.dir + "/");
			}
		}

		// Cursor custom commands
		if (host.dir === ".cursor") {
			var cmdScaffoldDir = path.join(hostShellDir, "commands");
			if (fs.existsSync(cmdScaffoldDir)) {
				var cmdDir = path.join(hostDir, "commands");
				ensureDir(cmdDir);
				copyDir(cmdScaffoldDir, cmdDir);
				console.log("    Commands deployed to .cursor/commands/");
			}
		}

		console.log("");
		console.log("Done. emb-agent is now installed for your AI runtime.");
		if (process.env._EMB_INSTALL_DONE) process.exit(0);
	}
}

// ── CLI ───────────────────────────────────────────────────────────

function main(argv) {
	var args = parseArgs(argv);

	if (args.help) {
		usage();
		return;
	}

	var projectRoot = process.cwd();
	console.log("emb-agent v" + VERSION);
	console.log("Platform: " + platformKey());
	console.log("Project: " + projectRoot + "\n");

	if (args.target === "all") {
		for (var i = 0; i < SUPPORTED_HOSTS.length; i++) {
			installForHost(projectRoot, SUPPORTED_HOSTS[i]);
		}
	} else if (args.target) {
		var host = SUPPORTED_HOSTS.find(function (h) { return h.name === args.target; });
		if (!host) {
			console.error("Unknown host: " + args.target);
			console.error("Supported: " + SUPPORTED_HOSTS.map(function (h) { return h.name; }).join(", ") + ", all");
			process.exit(1);
		}
		installForHost(projectRoot, host);
	} else {
		console.log("No --target specified, defaulting to pi\n");
		var host2 = SUPPORTED_HOSTS.find(function (h) { return h.name === "pi"; });
		installForHost(projectRoot, host2);
	}
}

module.exports = { main, installForHost, SUPPORTED_HOSTS, platformKey, binaryName };

if (require.main === module) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error("emb-agent install error: " + error.message);
		process.exit(1);
	}
}
