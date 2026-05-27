#!/usr/bin/env node
// emb-agent installer v0.5.0
// Deploys Rust binary + runtime templates to target AI host directories.

var childProcess = require("child_process");
var os = require("os");
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
var REFERENCE_SRC = path.join(RUNTIME_SRC, "reference");

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
		req.setTimeout(30000, function () { req.destroy(); file.close(function () { done(false); }); });
	}
	fetch("https://github.com/Welkon/emb-agent/releases/latest/download/" + binaryName(), 3);
}

function deployRustBinary(embDir, callback) {
	var dest = path.join(embDir, "bin", "emb-agent-rs" + (process.platform === "win32" ? ".exe" : ""));
	// 1. Try local build artifact
	var src = binarySrc();
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, dest);
		console.log("\x1b[2m    Rust binary deployed (" + binaryName() + ")\x1b[0m");
		callback();
		return;
	}
	// 2. Try generic fallback names
	var genericNames = ["emb-agent-rs-linux-x86_64", "emb-agent-rs-macos-x86_64", "emb-agent-rs-windows-x86_64.exe"];
	for (var i = 0; i < genericNames.length; i++) {
		var p = path.join(RUST_BIN_DIR, genericNames[i]);
		if (fs.existsSync(p)) {
			fs.copyFileSync(p, dest);
			console.log("\x1b[2m    Rust binary deployed (generic fallback)\x1b[0m");
			callback();
			return;
		}
	}
	// 3. Download from GitHub
	downloadBinary(dest, function (ok) {
		if (ok) console.log("\x1b[2m    Rust binary deployed (downloaded)\x1b[0m");
		else console.log("\x1b[33m    Warning: binary not found, skipping\x1b[0m");
		callback();
	});
}

// ── Parse CLI args ────────────────────────────────────────────────

function usage() {
	console.log([
		"emb-agent v" + VERSION,
		"",
		"Usage:",
		"  npx emb-agent                            # Interactive install",
		"  npx emb-agent --target pi                # Install for pi",
		"  npx emb-agent --target all               # Install for all hosts",
		"",
		"Options:",
		"  --target <name>   Host: codex, cursor, claude, pi, omp, windsurf, all",
		"  --developer <name> Developer identity",
		"  --local, -l        Install to project directory (recommended)",
		"  --global, -g       Install to global config",
		"  --profile <name>   Install profile (default: core)",
		"  --lang <en|zh>     Reply language",
		"  --spec <name>      Enable external spec (repeatable)",
		"  --skill <name>     Enable external skill (repeatable)",
		"  --registry <url>   External spec registry URL",
		"  --skill-source <url> External skill source URL",
		"  --force            Overwrite existing files",
		"  --help, -h         Show this help",
		"",
		"Examples:",
		"  npx emb-agent                                                    # Interactive",
		"  npx emb-agent --target omp --developer felix --spec scmcu-space  # Direct",
		"",
		"Installs to:",
		"  - Rust binary (cached/downloaded)",
		"  - Runtime scaffolds, templates, agents, specs",
		"  - Host-specific config (settings.json, hooks.json, AGENTS.md)",
		"  - AI host rules (AGENTS.md, .<host>/rules/, .<host>/instructions.md)",
	].join("\n"));
}

function parseArgs(argv) {
	var args = { target: "", developer: "", local: false, global: false, profile: "core", lang: "", specs: [], skills: [], registry: "", skillSource: "", help: false, force: false };
	for (var i = 0; i < argv.length; i++) {
		var t = argv[i];
		if (t === "--help" || t === "-h") args.help = true;
		else if (t === "--target") args.target = argv[++i] || "";
		else if (t === "--force") args.force = true;
		else if (t === "--developer") args.developer = argv[++i] || "";
		else if (t === "--local" || t === "-l") args.local = true;
		else if (t === "--global" || t === "-g") args.global = true;
		else if (t === "--profile") args.profile = argv[++i] || "core";
		else if (t === "--lang") args.lang = argv[++i] || "";
		else if (t === "--spec") { var s = argv[++i]; if (s) args.specs.push(s); }
		else if (t === "--skill") { var sk = argv[++i]; if (sk) args.skills.push(sk); }
		else if (t === "--registry" || t === "-r") args.registry = argv[++i] || "";
		else if (t === "--skill-source") args.skillSource = argv[++i] || "";
	}
	return args;
}

// ── Helpers ───────────────────────────────────────────────────────

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function copyDir(src, dest) {
	if (!fs.existsSync(src)) return;
	ensureDir(dest);
	var entries = fs.readdirSync(src, { withFileTypes: true });
	for (var i = 0; i < entries.length; i++) {
		var e = entries[i];
		var s = path.join(src, e.name);
		var d = path.join(dest, e.name);
		if (e.isDirectory()) { copyDir(s, d); }
		else { fs.copyFileSync(s, d); }
	}
}

function copyIf(src, dest) {
	if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

// ── AGENTS.md deployment ──────────────────────────────────────────

function resolveIncludes(content) {
	return content.replace(/\{\{INCLUDE:_partials\/([^}]+)\}\}/g, function (_, name) {
		var incPath = path.join(PARTIALS_DIR, name);
		if (fs.existsSync(incPath)) return fs.readFileSync(incPath, "utf8").trim();
		return "<!-- missing: " + name + " -->";
	});
}

function applyTemplate(content, vars) {
	return content.replace(/\{\{([A-Z_]+)\}\}/g, function (_, key) {
		return vars[key] !== undefined ? vars[key] : "{{" + key + "}}";
	});
}

function resolveAndDeploy(srcPath, destPath, vars) {
	if (!fs.existsSync(srcPath)) return false;
	var raw = fs.readFileSync(srcPath, "utf8");
	var resolved = resolveIncludes(raw);
	var rendered = applyTemplate(resolved, vars);
	return deployAgentsMd(srcPath, destPath, rendered);
}

function deployAgentsMd(templatePath, destPath, templateContent) {
	if (!templateContent) {
		if (!fs.existsSync(templatePath)) return false;
		templateContent = fs.readFileSync(templatePath, "utf8");
		templateContent = resolveIncludes(templateContent);
	}

	if (!fs.existsSync(destPath)) {
		fs.writeFileSync(destPath, templateContent);
		return true;
	}

	var existing = fs.readFileSync(destPath, "utf8");
	var blockRe = /<!-- EMB-AGENT:START -->[\s\S]*?<!-- EMB-AGENT:END -->/;
	var templateBlock = templateContent.match(blockRe);
	if (!templateBlock) {
		fs.writeFileSync(destPath, templateContent);
		return true;
	}

	if (blockRe.test(existing)) {
		var updated = existing.replace(blockRe, templateBlock[0]);
		fs.writeFileSync(destPath, updated);
		return true;
	}

	fs.writeFileSync(destPath, templateContent);
	console.log("    " + path.basename(destPath) + " overwritten with managed template");
	return true;
}

// ── Agent spec injection ─────────────────────────────────────────

function injectSpecsIntoAgents(embDir) {
	var registryPath = path.join(RUNTIME_SRC, "registry", "workflow.json");
	if (!fs.existsSync(registryPath)) return;

	var registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
	var specs = (registry.specs || []).filter(function (s) { return s.auto_inject && s.path; });
	if (specs.length === 0) return;

	var specEntries = [];
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
		var scopes = spec.enforcement_scopes || [];
		var agentNames = [];
		for (var sci = 0; sci < scopes.length; sci++) {
			var s = scopes[sci].trim();
			if (s.startsWith("emb-")) agentNames.push(s);
		}

		specEntries.push({ name: spec.name, title: title, body: body, agentNames: agentNames, scopes: scopes });
	}
	if (specEntries.length === 0) return;

	var agentsDir = path.join(embDir, "agents");
	if (!fs.existsSync(agentsDir)) return;

	var agentFiles = fs.readdirSync(agentsDir).filter(function (f) { return f.endsWith(".md"); });
	var injectedCount = 0;
	for (var ai = 0; ai < agentFiles.length; ai++) {
		var agentFile = agentFiles[ai];
		var agentPath = path.join(agentsDir, agentFile);
		var agentName = agentFile.replace(/\.md$/, "");
		var content = fs.readFileSync(agentPath, "utf8");

		content = content.replace(/\n<!-- INJECTED_SPECS_START -->[\s\S]*?<!-- INJECTED_SPECS_END -->\n?/g, "");

		var applicable = [];
		for (var si2 = 0; si2 < specEntries.length; si2++) {
			var se = specEntries[si2];
			if (se.agentNames.length === 0) { applicable.push(se); }
			else if (se.agentNames.indexOf(agentName) >= 0) { applicable.push(se); }
		}
		if (applicable.length === 0) continue;

		var block = "\n<!-- INJECTED_SPECS_START -->\n";
		block += "<!-- Auto-generated by emb-agent installer. Do not edit manually. -->\n\n";
		for (var ai2 = 0; ai2 < applicable.length; ai2++) {
			block += "## " + applicable[ai2].title + "\n\n";
			block += applicable[ai2].body.trim() + "\n\n---\n";
		}
		block += "<!-- INJECTED_SPECS_END -->\n";

		content = content.replace(/\n?<!-- INJECTED_SPECS_END -->\s*$/, "");
		content += block;
		fs.writeFileSync(agentPath, content);
		injectedCount++;
	}
	if (injectedCount > 0) console.log("    Spec rules injected into " + injectedCount + " agents (enforcement-scoped)");
}

// ── Keypress list selection ───────────────────────────────────────

function supportsKeyboardSelection() {
	return Boolean(
		process.stdin &&
		process.stdin.isTTY &&
		process.stdout &&
		process.stdout.isTTY &&
		typeof process.stdin.setRawMode === "function" &&
		typeof process.stdin.on === "function" &&
		(typeof process.stdin.off === "function" || typeof process.stdin.removeListener === "function")
	);
}

function summarizeListText(value, maxLength) {
	var normalized = String(value || "").replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	var limit = maxLength || 120;
	var sentence = normalized.match(/^(.+?[.?!。！？])(?:\s|$)/);
	var preferred = sentence && sentence[1] && sentence[1].length <= limit ? sentence[1] : normalized;
	if (preferred.length <= limit) return preferred;
	return preferred.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

function selectListFallback(title, items, callback) {
	var readline = require("readline");
	var C = { reset: "\x1b[0m", dim: "\x1b[2m", cyan: "\x1b[36m", yellow: "\x1b[33m", blue: "\x1b[34m", white: "\x1b[37m" };
	console.log(C.blue + "▶ " + title + C.reset);
	console.log(C.dim + "  Type numbers separated by spaces or commas. Press Enter to skip." + C.reset);
	for (var i = 0; i < items.length; i++) {
		console.log("  " + C.cyan + (i + 1) + "." + C.reset + " " + C.white + items[i].label + C.reset + (items[i].desc ? C.dim + " - " + summarizeListText(items[i].desc) + C.reset : ""));
	}
	var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	rl.question(C.yellow + "Choice [skip] > " + C.reset, function (answer) {
		rl.close();
		var tokens = String(answer || "").trim().split(/[\s,]+/).filter(Boolean);
		var seen = {};
		var result = [];
		for (var ti = 0; ti < tokens.length; ti++) {
			var token = tokens[ti].toLowerCase();
			if (token === "skip") break;
			if (token === "all" || token === "a") {
				result = items.map(function (item) { return item.value; });
				break;
			}
			var index = parseInt(token, 10);
			if (Number.isFinite(index) && index >= 1 && index <= items.length && !seen[index]) {
				seen[index] = true;
				result.push(items[index - 1].value);
			}
		}
		callback(result);
	});
}

function renderSelectionScreen(title, items, state, options) {
	var C = {
		reset: "\x1b[0m",
		bold: "\x1b[1m",
		dim: "\x1b[2m",
		green: "\x1b[32m",
		cyan: "\x1b[36m",
		yellow: "\x1b[33m",
		blue: "\x1b[34m",
		white: "\x1b[37m"
	};
	var lines = [];
	var contextLabel = options && options.contextLabel ? options.contextLabel : "Source";
	var contextValue = options && options.contextValue ? options.contextValue : "emb-support";
	var skipLabel = options && options.skipLabel ? options.skipLabel : "Skip";
	var itemNoun = options && options.itemNoun ? options.itemNoun : "entry";
	var itemPlural = options && options.itemPlural ? options.itemPlural : "entries";
	lines.push(C.cyan + C.bold + "emb-agent installer" + C.reset);
	lines.push(C.dim + "  Embedded workflow bootstrap for Codex, Claude Code, Cursor, Pi, OMP, Windsurf" + C.reset);
	lines.push("");
	lines.push(C.blue + "▶ " + title + C.reset);
	lines.push(C.dim + "  " + contextLabel + ": " + contextValue + C.reset);
	lines.push(C.dim + "  Use ↑/↓ to move and Space to toggle the highlighted " + itemNoun + "." + C.reset);
	lines.push(C.dim + "  Press Enter to confirm; press `a` to toggle all; Esc/Ctrl+C cancels." + C.reset);
	lines.push(C.dim + "  Press Enter with no selected " + itemPlural + " to skip." + C.reset);
	lines.push("");
	var skipActive = state.cursorIndex === 0;
	lines.push("  " + (skipActive ? C.cyan + "›" + C.reset : " ") + " " + C.cyan + "skip" + C.reset + " " + (skipActive ? C.bold + C.white : C.white) + skipLabel + C.reset);
	for (var i = 0; i < items.length; i++) {
		var entryIndex = i + 1;
		var active = state.cursorIndex === entryIndex;
		var selected = state.selected[entryIndex] === true;
		var marker = selected ? C.green + "●" + C.reset : C.dim + "○" + C.reset;
		var detail = summarizeListText(items[i].desc, 120);
		var name = active ? C.bold + C.white + items[i].label + C.reset : C.white + items[i].label + C.reset;
		lines.push("  " + (active ? C.cyan + "›" + C.reset : " ") + " " + marker + " " + name + (detail ? C.dim + " - " + detail + C.reset : ""));
	}
	lines.push("");
	lines.push(C.yellow + "↑/↓=move  Space=toggle  a=all  Enter=confirm" + C.reset);
	return lines.join("\n");
}

function selectList(title, items, callback, options) {
	if (!supportsKeyboardSelection()) {
		selectListFallback(title, items, callback);
		return;
	}

	var stdin = process.stdin;
	var stdout = process.stdout;
	var previousRawMode = Boolean(stdin.isRaw);
	var state = { cursorIndex: items.length > 0 ? 1 : 0, selected: {} };
	var totalChoices = items.length + 1;
	var settled = false;

	function removeDataListener() {
		if (typeof stdin.off === "function") stdin.off("data", handleInput);
		else stdin.removeListener("data", handleInput);
	}

	function cleanup() {
		if (settled) return;
		settled = true;
		try { stdin.setRawMode(previousRawMode); } catch (_) {}
		try { removeDataListener(); } catch (_) {}
		if (typeof stdin.pause === "function") stdin.pause();
		stdout.write("\x1b[?25h\x1b[?1049l");
	}

	function selectedValues() {
		var result = [];
		for (var i = 0; i < items.length; i++) {
			if (state.selected[i + 1]) result.push(items[i].value);
		}
		return result;
	}

	function selectedNames(values) {
		return values.map(function (item) { return item && item.name ? item.name : String(item); });
	}

	function finish(values) {
		cleanup();
		console.log("\x1b[32m  ✔ " + (values.length > 0 ? selectedNames(values).join(", ") : "skip") + "\x1b[0m\n");
		callback(values);
	}

	function cancel() {
		cleanup();
		console.log("\x1b[31mInteractive install cancelled.\x1b[0m");
		process.exit(130);
	}

	function render() {
		stdout.write("\x1b[2J\x1b[H");
		stdout.write(renderSelectionScreen(title, items, state, options || {}) + "\n");
	}

	function toggleCurrent() {
		if (state.cursorIndex === 0) return;
		state.selected[state.cursorIndex] = !state.selected[state.cursorIndex];
	}

	function toggleAll() {
		var selectedCount = 0;
		for (var i = 1; i <= items.length; i++) if (state.selected[i]) selectedCount++;
		var next = selectedCount !== items.length;
		for (var j = 1; j <= items.length; j++) state.selected[j] = next;
	}

	function handleInput(chunk) {
		var input = String(chunk || "");
		if (input === "\u001b[A" || input === "\u001bOA") {
			state.cursorIndex = (state.cursorIndex - 1 + totalChoices) % totalChoices;
			render();
			return;
		}
		if (input === "\u001b[B" || input === "\u001bOB") {
			state.cursorIndex = (state.cursorIndex + 1) % totalChoices;
			render();
			return;
		}
		if (input === " ") { toggleCurrent(); render(); return; }
		if (input === "a" || input === "A") { toggleAll(); render(); return; }
		if (input === "\r" || input === "\n") {
			if (state.cursorIndex === 0) finish([]);
			else finish(selectedValues());
			return;
		}
		if (input === "\u0003" || input === "\u0004" || input === "\u001b" || input === "q" || input === "Q") cancel();
	}

	try {
		stdout.write("\x1b[?1049h\x1b[?25l");
		if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
		stdin.setRawMode(true);
		if (typeof stdin.resume === "function") stdin.resume();
		stdin.on("data", handleInput);
		render();
	} catch (error) {
		cleanup();
		console.log("\x1b[33m  Keyboard selection unavailable: " + error.message + "\x1b[0m");
		selectListFallback(title, items, callback);
	}
}

// ── Install per host ──────────────────────────────────────────────

function installForHost(projectRoot, host) {
	var hostDir = path.join(projectRoot, host.dir);
	var embDir = path.join(hostDir, "emb-agent");

	console.log("\x1b[36m  Installing for " + host.name + " \u2192 " + hostDir + "\x1b[0m");

	ensureDir(path.join(embDir, "bin"));
	ensureDir(path.join(embDir, "commands", "emb"));
	ensureDir(path.join(embDir, "command-docs", "emb"));
	ensureDir(path.join(embDir, "agents"));

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
		var wrapperPath = path.join(RUNTIME_SRC, "bin", "emb-agent.cjs");
		copyIf(wrapperPath, path.join(embDir, "bin", "emb-agent.cjs"));

		copyDir(path.join(RUNTIME_SRC, "profiles"), path.join(embDir, "profiles"));
		copyDir(path.join(RUNTIME_SRC, "scaffolds"), path.join(embDir, "scaffolds"));
		copyDir(path.join(RUNTIME_SRC, "templates"), path.join(embDir, "templates"));
		copyDir(path.join(RUNTIME_SRC, "registry"), path.join(embDir, "registry"));
		copyDir(path.join(RUNTIME_SRC, "specs"), path.join(embDir, "specs"));

		copyIf(path.join(RUNTIME_SRC, "config.json"), path.join(embDir, "config.json"));
		copyDir(COMMANDS_SRC, path.join(embDir, "commands", "emb"));
		copyDir(COMMAND_DOCS_SRC, path.join(embDir, "command-docs", "emb"));
		copyDir(AGENTS_SRC, path.join(embDir, "agents"));

		injectSpecsIntoAgents(embDir);

		var knowledgeDirs = ["compound", "architecture", "reference", "issues", "refactors", "roadmap", "audits"];
		for (var kdi = 0; kdi < knowledgeDirs.length; kdi++) {
			ensureDir(path.join(embDir, knowledgeDirs[kdi]));
		}

		var conventionsSrc = path.join(REFERENCE_SRC, "shared-conventions.md");
		if (fs.existsSync(conventionsSrc)) {
			fs.copyFileSync(conventionsSrc, path.join(embDir, "reference", "shared-conventions.md"));
			console.log("    shared-conventions.md deployed");
		}
		var knowledgeEvolutionSrc = path.join(RUNTIME_SRC, "scaffolds", "protocol-blocks", "knowledge-evolution.md");
		if (fs.existsSync(knowledgeEvolutionSrc)) {
			fs.copyFileSync(knowledgeEvolutionSrc, path.join(embDir, "reference", "knowledge-evolution.md"));
			console.log("    knowledge-evolution.md deployed");
		}

		var attentionTpl = path.join(RUNTIME_SRC, "templates", "attention.md.tpl");
		var attentionDest = path.join(embDir, "attention.md");
		if (fs.existsSync(attentionTpl) && !fs.existsSync(attentionDest)) {
			fs.copyFileSync(attentionTpl, attentionDest);
			console.log("    attention.md deployed");
		}

		var archTpl = path.join(RUNTIME_SRC, "templates", "ARCHITECTURE.md.tpl");
		var archDest = path.join(embDir, "architecture", "ARCHITECTURE.md");
		if (fs.existsSync(archTpl) && !fs.existsSync(archDest)) {
			fs.copyFileSync(archTpl, archDest);
			console.log("    architecture/ARCHITECTURE.md deployed");
		}

		var compoundTpls = ["compound-learn.md.tpl", "compound-decision.md.tpl", "compound-trap.md.tpl", "compound-explore.md.tpl", "compound-trick.md.tpl"];
		for (var cti = 0; cti < compoundTpls.length; cti++) {
			var ctSrc = path.join(RUNTIME_SRC, "templates", compoundTpls[cti]);
			var ctDest = path.join(embDir, "templates", compoundTpls[cti]);
			if (fs.existsSync(ctSrc)) fs.copyFileSync(ctSrc, ctDest);
		}

		fs.writeFileSync(path.join(embDir, "VERSION"), VERSION + "\n");
		fs.writeFileSync(path.join(embDir, "HOST.json"), JSON.stringify({
			name: host.name, label: host.name.charAt(0).toUpperCase() + host.name.slice(1),
			install_profile: host.profile, install_scope: "local", target_dir: hostDir, runtime_dir_name: "emb-agent",
		}, null, 2) + "\n");

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

		var templateVars = { PROJECT_NAME: path.basename(projectRoot), INSTALL_DATE: new Date().toISOString().split("T")[0] };
		if (resolveAndDeploy(
			path.join(RUNTIME_SRC, "scaffolds", "shells", "AGENTS.md"),
			path.join(projectRoot, "AGENTS.md"),
			templateVars
		)) {
			console.log("    AGENTS.md deployed to project root");
		}

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

		var binName = "emb-agent-rs" + (process.platform === "win32" ? ".exe" : "");
		var binPath = path.join(embDir, "bin", binName);
		if (fs.existsSync(binPath)) {
			try {
				var r = childProcess.spawnSync(binPath, ["init"], { cwd: projectRoot, encoding: "utf8", timeout: 15000 });
				if (r.status === 0 && r.stdout) {
					var j = JSON.parse(r.stdout.trim());
					if (j.initialized) console.log("    Project workspace initialized (.emb-agent/)");
				}
			} catch (_) {}
		}
		console.log("\x1b[32mDone. emb-agent is now installed for your AI runtime.\x1b[0m");
		if (process.env._EMB_INSTALL_DONE) process.exit(0);
	}
}

// ── GitHub API helpers ────────────────────────────────────────────

function ghApiList(url, callback) {
	var opts = { hostname: "api.github.com", path: url, method: "GET", headers: { "User-Agent": "emb-agent-installer", "Accept": "application/vnd.github.v3+json" } };
	var req = https.request(opts, function (res) {
		var body = "";
		res.on("data", function (d) { body += d; });
		res.on("end", function () {
			try { callback(JSON.parse(body)); } catch (_) { callback([]); }
		});
	});
	req.on("error", function () { callback([]); });
	req.setTimeout(10000, function () { req.destroy(); callback([]); });
	req.end();
}

function downloadRawFile(url, dest, callback) {
	var file = fs.createWriteStream(dest);
	https.get(url, function (res) {
		if (res.statusCode === 302 && res.headers.location) {
			file.close(function () { downloadRawFile(res.headers.location, dest, callback); });
			return;
		}
		if (res.statusCode !== 200) { file.close(function () { callback(false); }); return; }
		res.pipe(file);
		file.on("finish", function () { callback(true); });
	}).on("error", function () { file.close(function () { callback(false); }); });
}

function fetchSpecListFromGitHub(callback) {
	ghApiList("/repos/Welkon/emb-support/contents/specs", function (files) {
		var specs = [];
		if (Array.isArray(files)) {
			for (var i = 0; i < files.length; i++) {
				if (files[i].name.endsWith(".md") && files[i].name !== "README.md") {
					specs.push({ name: files[i].name.replace(".md", ""), url: files[i].download_url, desc: "Spec from emb-support" });
				}
			}
		}
		// Fetch frontmatter for each spec to get title
		var pending = specs.length;
		if (pending === 0) { callback(specs); return; }
		for (var j = 0; j < specs.length; j++) {
			(function (idx) {
				https.get(specs[idx].url, function (res) {
					var body = "";
					res.on("data", function (d) { body += d; });
					res.on("end", function () {
						var m = body.match(/^---\n([\s\S]*?)\n---/);
						if (m) {
							var lines = m[1].split("\n");
							for (var li = 0; li < lines.length; li++) {
								var kv = lines[li].split(":");
								if (kv.length >= 2 && kv[0].trim() === "title") { specs[idx].title = kv.slice(1).join(":").trim(); }
								if (kv.length >= 2 && kv[0].trim() === "summary") { specs[idx].summary = kv.slice(1).join(":").trim(); }
							}
						}
						specs[idx].desc = specs[idx].title || specs[idx].summary || specs[idx].desc;
						pending--;
						if (pending === 0) callback(specs);
					});
				}).on("error", function () { pending--; if (pending === 0) callback(specs); });
			})(j);
		}
	});
}

function fetchSkillListFromGitHub(callback) {
	ghApiList("/repos/Welkon/emb-support/contents/skills", function (dirs) {
		var skills = [];
		if (Array.isArray(dirs)) {
			var skillDirs = dirs.filter(function (d) { return d.type === "dir"; });
			var pending = skillDirs.length;
			if (pending === 0) { callback(skills); return; }
			for (var i = 0; i < skillDirs.length; i++) {
				(function (idx) {
					ghApiList("/repos/Welkon/emb-support/contents/skills/" + skillDirs[idx].name, function (files) {
						var skillMd = null;
						if (Array.isArray(files)) {
							for (var j = 0; j < files.length; j++) {
								if (files[j].name === "SKILL.md") { skillMd = files[j]; break; }
							}
						}
						if (skillMd) {
							https.get(skillMd.download_url, function (res) {
								var body = "";
								res.on("data", function (d) { body += d; });
								res.on("end", function () {
									var m = body.match(/^---\n([\s\S]*?)\n---/);
									var desc = "";
									if (m) {
										var lines = m[1].split("\n");
										for (var li = 0; li < lines.length; li++) {
											var kv = lines[li].split(":");
											if (kv.length >= 2 && kv[0].trim() === "description") { desc = kv.slice(1).join(":").trim().replace(/^"/,"").replace(/"$/,""); }
										}
									}
									skills.push({ name: skillDirs[idx].name, url: skillMd.download_url, desc: desc });
									pending--;
									if (pending === 0) callback(skills);
								});
							}).on("error", function () { pending--; if (pending === 0) callback(skills); });
						} else { pending--; if (pending === 0) callback(skills); }
					});
				})(i);
			}
		} else { callback(skills); }
	});
}

function downloadSelected(items, destDir, callback) {
	var pending = items.length;
	if (pending === 0) { callback(); return; }
	ensureDir(destDir);
	for (var i = 0; i < items.length; i++) {
		(function (item) {
			var ext = item.url.match(/specs\//) ? ".md" : "";
			var dest = path.join(destDir, item.name + ext);
			downloadRawFile(item.url, dest, function (ok) {
				pending--;
				if (pending === 0) callback();
			});
		})(items[i]);
	}
}

// ── CLI ───────────────────────────────────────────────────────────

function main(argv) {
	var args = parseArgs(argv);

	if (args.help) { usage(); return; }

	var projectRoot = process.cwd();
	console.log("emb-agent v" + VERSION);
	console.log("Platform: " + platformKey());
	console.log("Project: " + projectRoot + "\n");

	var _devDir = path.join(projectRoot, ".emb-agent");
	try { fs.mkdirSync(_devDir, { recursive: true }); } catch (_) {}
	if (args.developer) fs.writeFileSync(path.join(_devDir, ".developer"), args.developer + "\n");
	if (args.lang) fs.writeFileSync(path.join(_devDir, ".language"), args.lang + "\n");
	if (args.registry) fs.writeFileSync(path.join(_devDir, ".registry"), args.registry + "\n");
	if (args.skillSource) fs.writeFileSync(path.join(_devDir, ".skill-source"), args.skillSource + "\n");
	if (args.specs.length > 0) fs.writeFileSync(path.join(_devDir, ".specs"), args.specs.join(",") + "\n");
	if (args.skills.length > 0) fs.writeFileSync(path.join(_devDir, ".skills"), args.skills.join(",") + "\n");

	if (args.target === "all") {
		for (var i = 0; i < SUPPORTED_HOSTS.length; i++) {
			installForHost(projectRoot, SUPPORTED_HOSTS[i]);
		}
	} else if (args.target) {
		var host = SUPPORTED_HOSTS.find(function (h) { return h.name === args.target; });
		if (!host) { console.error("Unknown host: " + args.target); process.exit(1); }
		installForHost(projectRoot, host);
	} else if (process.stdin.isTTY) {
		// Interactive install
		var C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", blue: "\x1b[34m", red: "\x1b[31m" };
		var readline = require("readline");
		var state = { host: null, developer: "developer", lang: "en" };

		// Scan local emb-support or fetch from GitHub
		var supportDir = null;
		var candidates = [path.join(projectRoot, "..", "emb-support"), path.join(os.homedir(), "Projects", "emb-support"), path.join(os.homedir(), "emb-support")];
		for (var ci = 0; ci < candidates.length; ci++) { if (fs.existsSync(candidates[ci])) { supportDir = candidates[ci]; break; } }

		var extSpecs = [], extSkills = [];
		function scanLocal() {
			if (!supportDir) return;
			var sd = path.join(supportDir, "specs");
			if (fs.existsSync(sd)) {
				var sf = fs.readdirSync(sd).filter(function(f) { return f.endsWith(".md") && f !== "README.md"; });
				for (var si = 0; si < sf.length; si++) {
					var raw = fs.readFileSync(path.join(sd, sf[si]), "utf8");
					var m = raw.match(/^---\n([\s\S]*?)\n---/); if (!m) continue;
					var fm = {}, lines = m[1].split("\n");
					for (var li = 0; li < lines.length; li++) { var kv = lines[li].split(":"); if (kv.length >= 2) fm[kv[0].trim()] = kv.slice(1).join(":").trim(); }
					extSpecs.push({ name: fm.name || sf[si].replace(".md",""), desc: fm.title || fm.summary || "", url: path.join(sd, sf[si]) });
				}
			}
			var kd = path.join(supportDir, "skills");
			if (fs.existsSync(kd)) {
				var df = fs.readdirSync(kd, { withFileTypes: true }).filter(function(d) { return d.isDirectory(); });
				for (var di = 0; di < df.length; di++) {
					var sk = path.join(kd, df[di].name, "SKILL.md");
					if (!fs.existsSync(sk)) continue;
					var raw = fs.readFileSync(sk, "utf8");
					var m = raw.match(/^---\n([\s\S]*?)\n---/); if (!m) continue;
					var fm = {}, lines = m[1].split("\n");
					for (var li = 0; li < lines.length; li++) { var kv = lines[li].split(":"); if (kv.length >= 2) fm[kv[0].trim()] = kv.slice(1).join(":").trim(); }
					extSkills.push({ name: df[di].name, desc: (fm.description || "").replace(/^"/,"").replace(/"$/,""), url: sk });
				}
			}
		}

		function externalSourceLabel() {
			return supportDir || "GitHub: Welkon/emb-support";
		}

		function startInstallFlow() {
			var steps = [
				function askHost(next) {
					console.log(C.cyan + C.bold + "  emb-agent installer" + C.reset);
					console.log(C.dim + "  Embedded workflow bootstrap for Codex, Claude Code, Cursor, Pi, OMP, Windsurf" + C.reset);
					console.log("");
					console.log(C.blue + "\u25B6 Select Runtime" + C.reset);
					for (var k = 0; k < SUPPORTED_HOSTS.length; k++) {
						console.log("  " + C.cyan + "[" + (k + 1) + "]" + C.reset + " " + SUPPORTED_HOSTS[k].name);
					}
					console.log("  " + C.cyan + "[" + (SUPPORTED_HOSTS.length + 1) + "]" + C.reset + " all");
					console.log("");
					var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
					rl.question(C.yellow + "Choice [4] > " + C.reset, function(a) { rl.close(); var c = parseInt(a.trim(), 10) || 4; if (c < 1 || c > SUPPORTED_HOSTS.length + 1) c = 4; if (c === SUPPORTED_HOSTS.length + 1) { for (var m = 0; m < SUPPORTED_HOSTS.length; m++) installForHost(projectRoot, SUPPORTED_HOSTS[m]); return; } state.host = SUPPORTED_HOSTS[c - 1]; next(); });
				},
				function askDeveloper(next) {
					console.log(C.blue + "\u25B6 Developer Identity" + C.reset);
					var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
					rl.question(C.yellow + "Developer name > " + C.reset, function(a) { rl.close(); state.developer = a.trim() || "developer"; next(); });
				},
				function askLocation(next) {
					console.log(C.blue + "\u25B6 Install Location" + C.reset);
					console.log("  " + C.cyan + "[1]" + C.reset + " Global  " + C.cyan + "[2]" + C.reset + " Local " + C.green + "(recommended)" + C.reset);
					var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
					rl.question(C.yellow + "Choice [2] > " + C.reset, function(a) { rl.close(); next(); });
				},
				function askLanguage(next) {
					console.log(C.blue + "\u25B6 Reply Language" + C.reset);
					console.log("  " + C.cyan + "[1]" + C.reset + " English  " + C.cyan + "[2]" + C.reset + " \u4e2d\u6587");
					var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
					rl.question(C.yellow + "Choice [1] > " + C.reset, function(a) { rl.close(); state.lang = a.trim() === "2" ? "zh" : "en"; next(); });
				},
				function askSpecs(next) {
					if (extSpecs.length === 0) { console.log(C.dim + "\n  No external specs available.\n" + C.reset); next(); return; }
					console.log("");
					var items = [];
					for (var ei = 0; ei < extSpecs.length; ei++) items.push({ label: extSpecs[ei].name, desc: extSpecs[ei].desc || "", value: extSpecs[ei] });
					selectList("Spec Selection", items, function (selected) {
						var specsToDownload = [];
						for (var si = 0; si < selected.length; si++) {
							state.specs = state.specs || [];
							state.specs.push(selected[si].name);
							if (!supportDir) specsToDownload.push(selected[si]);
						}
						if (specsToDownload.length > 0) {
							console.log(C.dim + "  Downloading selected specs..." + C.reset);
							downloadSelected(specsToDownload, path.join(_devDir, "specs"), function () { next(); });
						} else { next(); }
					}, { contextLabel: "Source", contextValue: externalSourceLabel(), skipLabel: "Skip external spec import", itemNoun: "spec", itemPlural: "specs" });
				},
				function askSkills(next) {
					if (extSkills.length === 0) { console.log(C.dim + "  No external skills available.\n" + C.reset); next(); return; }
					var items = [];
					for (var ei = 0; ei < extSkills.length; ei++) items.push({ label: extSkills[ei].name, desc: extSkills[ei].desc || "", value: extSkills[ei] });
					selectList("Skill Selection", items, function (selected) {
						var skillsToDownload = [];
						for (var si = 0; si < selected.length; si++) {
							state.skills = state.skills || [];
							state.skills.push(selected[si].name);
							if (!supportDir) skillsToDownload.push(selected[si]);
						}
						if (skillsToDownload.length > 0) {
							console.log(C.dim + "  Downloading selected skills..." + C.reset);
							var destDir = path.join(_devDir, "skills");
							ensureDir(destDir);
							var pending = skillsToDownload.length;
							for (var di = 0; di < skillsToDownload.length; di++) {
								(function (item) {
									var d = path.join(destDir, item.name);
									ensureDir(d);
									downloadRawFile(item.url, path.join(d, "SKILL.md"), function () { pending--; if (pending === 0) next(); });
								})(skillsToDownload[di]);
							}
							if (pending === 0) next();
						} else { next(); }
					}, { contextLabel: "Plugin", contextValue: externalSourceLabel(), skipLabel: "Skip initial skill installation", itemNoun: "skill", itemPlural: "skills" });
				},
				function finish() {
					fs.writeFileSync(path.join(_devDir, ".developer"), state.developer + "\n");
					fs.writeFileSync(path.join(_devDir, ".language"), state.lang + "\n");
					if (state.specs && state.specs.length > 0) fs.writeFileSync(path.join(_devDir, ".specs"), state.specs.join(",") + "\n");
					if (state.skills && state.skills.length > 0) fs.writeFileSync(path.join(_devDir, ".skills"), state.skills.join(",") + "\n");
					console.log(C.green + "  \u2714 Installing for " + state.host.name + " as " + state.developer + C.reset + "\n");
					installForHost(projectRoot, state.host);
				}
			];
			var stepIdx = 0;
			function next() { if (stepIdx < steps.length) { var s = steps[stepIdx]; stepIdx++; s(next); } }
			next();
		}

		if (supportDir) {
			scanLocal();
			if (extSpecs.length === 0 && extSkills.length === 0) {
				// Try GitHub as fallback
				console.log(C.dim + "  Local emb-support found but empty. Trying GitHub..." + C.reset);
				fetchSpecListFromGitHub(function (s) { extSpecs = s; fetchSkillListFromGitHub(function (sk) { extSkills = sk; startInstallFlow(); }); });
			} else {
				startInstallFlow();
			}
		} else {
			console.log(C.dim + "  Fetching available specs and skills from GitHub..." + C.reset);
			fetchSpecListFromGitHub(function (s) { extSpecs = s; fetchSkillListFromGitHub(function (sk) { extSkills = sk; startInstallFlow(); }); });
		}
	} else {
		console.log("No --target specified and no TTY. Use --target <host>.");
		console.log("Supported: " + SUPPORTED_HOSTS.map(function (h) { return h.name; }).join(", ") + ", all");
		process.exit(1);
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
