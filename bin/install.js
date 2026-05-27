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
var PARTIALS_DIR = path.join(RUNTIME_SRC, "scaffolds", "shells", "_partials");

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
	var tmp = dest + ".download";
	var settled = false;
	function done(success) {
		if (settled) return;
		settled = true;
		if (!success) {
			try { fs.unlinkSync(tmp); } catch (_) {}
		}
		callback(success);
	}
	function finishFile(file) {
		file.close(function () {
			try { fs.renameSync(tmp, dest); } catch (_) { done(false); return; }
			try { fs.chmodSync(dest, 0o755); } catch (_) {}
			done(true);
		});
	}
	function fetch(url, redirects) {
		var file = fs.createWriteStream(tmp);
		var req = https.get(url, function (res) {
			if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && redirects > 0) {
				res.resume();
				file.close(function () { fetch(res.headers.location, redirects - 1); });
				return;
			}
			if (res.statusCode !== 200) {
				res.resume();
				file.close(function () { done(false); });
				return;
			}
			res.pipe(file);
			file.on("finish", function () { finishFile(file); });
		});
		req.on("error", function () { file.close(function () { done(false); }); });
		file.on("error", function () { done(false); });
	}
	var url = "https://github.com/Welkon/emb-agent/releases/download/v" + VERSION + "/" + binaryName();
	console.log("    Downloading " + binaryName() + " from GitHub Releases...");
	fetch(url, 3);
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
			"  - AI host rules (AGENTS.md, .<host>/rules/, .<host>/instructions.md)",
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

// ── Template resolution ──────────────────────────────────────────

function resolveTemplate(content, partialsDir, vars) {
	vars = vars || {};
	partialsDir = partialsDir || PARTIALS_DIR;

	// Resolve {{INCLUDE:_partials/<file>}} recursively
	content = content.replace(/\{\{INCLUDE:_partials\/([^}]+)\}\}/g, function (match, filename) {
		var partialPath = path.join(partialsDir, filename.trim());
		if (fs.existsSync(partialPath)) {
			return resolveTemplate(fs.readFileSync(partialPath, "utf8"), partialsDir, vars);
		}
		console.warn("    Warning: partial not found: " + filename);
		return match;
	});

	// Replace variable placeholders
	for (var key in vars) {
		if (vars.hasOwnProperty(key)) {
			content = content.split("{{" + key + "}}").join(vars[key]);
		}
	}

	return content;
}

function resolveAndDeploy(srcPath, destPath, vars) {
	if (!fs.existsSync(srcPath)) return false;

	var content = fs.readFileSync(srcPath, "utf8");
	content = resolveTemplate(content, PARTIALS_DIR, vars);

	ensureDir(path.dirname(destPath));
	fs.writeFileSync(destPath, content);
	return true;
}


// ── Agent spec injection ─────────────────────────────────────────

function injectSpecsIntoAgents(embDir) {
	var registryPath = path.join(RUNTIME_SRC, "registry", "workflow.json");
	if (!fs.existsSync(registryPath)) return;

	var registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
	var specs = (registry.specs || []).filter(function (s) { return s.auto_inject && s.path; });
	if (specs.length === 0) return;

	// Read and prepare spec blocks
	var specBlocks = [];
	for (var si = 0; si < specs.length; si++) {
		var spec = specs[si];
		var specPath = path.join(RUNTIME_SRC, spec.path);
		if (!fs.existsSync(specPath)) continue;

		var raw = fs.readFileSync(specPath, "utf8");
		var fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!fmMatch) continue;

		var fmText = fmMatch[1];
		var body = fmMatch[2];
		var title = (fmText.match(/^title:\s*(.+)$/m) || [])[1] || spec.title || spec.name;

		specBlocks.push({ name: spec.name, title: title, body: body });
	}
	if (specBlocks.length === 0) return;

	// Inject into each agent .md file
	var agentsDir = path.join(embDir, "agents");
	if (!fs.existsSync(agentsDir)) return;

	var agentFiles = fs.readdirSync(agentsDir).filter(function (f) { return f.endsWith(".md"); });
	for (var ai = 0; ai < agentFiles.length; ai++) {
		var agentPath = path.join(agentsDir, agentFiles[ai]);
		var content = fs.readFileSync(agentPath, "utf8");

		// Remove any previously injected spec blocks (idempotent re-install)
		content = content.replace(/\n<!-- INJECTED_SPECS_START -->[\s\S]*?<!-- INJECTED_SPECS_END -->\n?/g, "");

		// Build injection block
		var injection = "\n<!-- INJECTED_SPECS_START -->\n";
		for (var si2 = 0; si2 < specBlocks.length; si2++) {
			var sb = specBlocks[si2];
			injection += "\n## Spec: " + sb.title + "\n\n" + sb.body + "\n";
		}
		injection += "<!-- INJECTED_SPECS_END -->\n";

		fs.writeFileSync(agentPath, content + injection);
	}

	console.log("    Spec rules injected into " + agentFiles.length + " agents");
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
	var finished = false;
	var fallbackTimer = setTimeout(checkDone, 30000);
	function checkDone() {
		if (finished) return;
		finished = true;
		clearTimeout(fallbackTimer);
		finish();
	}
	deployRustBinary(embDir, checkDone);

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

		// Inject spec rules into agent prompts
		injectSpecsIntoAgents(embDir);

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

		// ── Rule injection ──────────────────────────────────────────
		var templateVars = {
			NAME: "emb-agent",
			SUMMARY: "Embedded firmware workflow — project truth, task tracking, knowledge wiki, schematic analysis, chip support"
		};

		// AGENTS.md at project root (always deployed)
		if (resolveAndDeploy(
			path.join(RUNTIME_SRC, "scaffolds", "shells", "AGENTS.md"),
			path.join(projectRoot, "AGENTS.md"),
			templateVars
		)) {
			console.log("    AGENTS.md deployed to project root");
		}

		// Host-specific root instruction files
		var hostRootFiles = { claude: "CLAUDE.md", codex: "CODEX.md" };
		var rootFile = hostRootFiles[host.name];
		if (rootFile) {
			if (resolveAndDeploy(
				path.join(RUNTIME_SRC, "scaffolds", "shells", rootFile),
				path.join(projectRoot, rootFile),
				templateVars
			)) {
				console.log("    " + rootFile + " deployed to project root");
			}
		}

		// Host-specific rules/instructions
		var hostRuleMappings = {
			codex:   { src: ".codex/instructions.md",             dest: "instructions.md" },
			cursor:  { src: ".cursor/rules/workflow.mdc",         dest: "rules/emb-agent-workflow.mdc" },
			windsurf:{ src: ".windsurf/rules/workflow.md",        dest: "rules/emb-agent-workflow.md" }
		};
		var ruleMapping = hostRuleMappings[host.name];
		if (ruleMapping) {
			var ruleSrc = path.join(RUNTIME_SRC, "scaffolds", "shells", ruleMapping.src);
			var ruleDest = path.join(hostDir, ruleMapping.dest);
			if (resolveAndDeploy(ruleSrc, ruleDest, templateVars)) {
				console.log("    " + ruleMapping.dest + " deployed to " + host.dir + "/");
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
