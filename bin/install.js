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
var CANONICAL_SHELL_COMMANDS = [
	{
		name: "emb-next",
		file: "emb-next.md",
		args: "next --brief",
		description: "Show task candidates or the recommended next emb-agent action.",
		summary: "Run emb-agent next, then continue from its machine-readable recommendation."
	},
	{
		name: "emb-onboard",
		file: "emb-onboard.md",
		args: "onboard",
		description: "Run the emb-agent onboarding handoff.",
		summary: "Run emb-agent onboarding when project truth is missing, incomplete, or scattered."
	},
];


var SUPPORTED_HOSTS = [
	{ name: "codex", dir: ".codex", profile: "core" },
	{ name: "cursor", dir: ".cursor", profile: "core" },
	{ name: "claude", dir: ".claude", profile: "core" },
	{ name: "pi", dir: ".pi", profile: "core" },
	{ name: "omp", dir: ".omp", profile: "core" },
	{ name: "windsurf", dir: ".windsurf", profile: "core" },
];

var GLOBAL_HOST_DIRS = {
	codex: { env: "CODEX_HOME", parts: [".codex"] },
	cursor: { env: "CURSOR_CONFIG_DIR", parts: [".cursor"] },
	claude: { env: "CLAUDE_CONFIG_DIR", parts: [".claude"] },
	pi: { env: "PI_CODING_AGENT_DIR", parts: [".pi", "agent"] },
	omp: { env: "OMP_CONFIG_DIR", parts: [".omp"] },
	windsurf: { env: "WINDSURF_CONFIG_DIR", parts: [".windsurf"] },
};

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
		logDetail("    Rust binary deployed (" + binaryName() + ")");
		callback();
		return;
	}
	// 2. Try generic fallback names
	var genericNames = ["emb-agent-rs-linux-x86_64", "emb-agent-rs-macos-x86_64", "emb-agent-rs-windows-x86_64.exe"];
	for (var i = 0; i < genericNames.length; i++) {
		var p = path.join(RUST_BIN_DIR, genericNames[i]);
		if (fs.existsSync(p)) {
			fs.copyFileSync(p, dest);
			logDetail("    Rust binary deployed (generic fallback)");
			callback();
			return;
		}
	}
	// 3. Download from GitHub
	downloadBinary(dest, function (ok) {
		if (ok) logDetail("    Rust binary deployed (downloaded)");
		else logDetail("    Warning: binary not found, skipping");
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
		"  --dry-run          Print install plan without writing files",
		"  uninstall          Remove managed host integration files",
		"  repair             Rebuild managed host integration files",
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
	var args = { mode: "install", target: "", developer: "", local: false, global: false, profile: "core", lang: "", specs: [], skills: [], registry: "", skillSource: "", help: false, force: false, dryRun: false };
	for (var i = 0; i < argv.length; i++) {
		var t = argv[i];
		if (t === "uninstall" || t === "repair") { args.mode = t; continue; }
		if (t === "--help" || t === "-h") args.help = true;
		else if (t === "--target") args.target = argv[++i] || "";
		else if (t === "--force") args.force = true;
		else if (t === "--dry-run") args.dryRun = true;
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


function hostInstallScope(host) {
	return host && host.scope ? host.scope : "local";
}

function hostDirFor(projectRoot, host) {
	if (host && host.targetDir) return host.targetDir;
	return path.join(projectRoot, host.dir);
}

function hostForScope(host, scope) {
	var h = Object.assign({}, host);
	h.scope = scope === "global" ? "global" : "local";
	if (h.scope === "global") {
		var def = GLOBAL_HOST_DIRS[h.name] || { parts: [h.dir] };
		var envName = def.env;
		var fromEnv = envName && process.env[envName];
		h.targetDir = fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ...(def.parts || [h.dir]));
	} else {
		delete h.targetDir;
	}
	return h;
}

function copyIf(src, dest) {
	if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

function removePath(target) {
	try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

var ACTIVE_LOG_FILE = "";
var QUIET_INSTALL = false;

function setInstallLogFile(projectRoot) {
	ensureDir(path.join(projectRoot, ".emb-agent"));
	ACTIVE_LOG_FILE = path.join(projectRoot, ".emb-agent", "install.log");
}

function logDetail(message) {
	if (ACTIVE_LOG_FILE) {
		try { fs.appendFileSync(ACTIVE_LOG_FILE, String(message) + "\n"); } catch (_) {}
	}
	if (!QUIET_INSTALL) console.log(message);
}

function cleanupLeanHostRuntime(embDir) {
	var managed = ["profiles", "scaffolds", "templates", "registry", "specs", "architecture", "compound", "reference", "issues", "refactors", "roadmap", "audits", "attention.md"];
	for (var i = 0; i < managed.length; i++) removePath(path.join(embDir, managed[i]));
}

function normalizeLanguage(value) {
	var lang = String(value || "").trim().toLowerCase();
	if (!lang) return "";
	if (lang === "zh" || lang === "zh-cn" || lang === "zh_hans" || lang === "cn" || lang === "chinese" || lang === "中文" || lang === "简体中文") return "zh";
	if (lang === "en" || lang === "english" || lang === "英文") return "en";
	return lang;
}

function languageInstruction(lang) {
	var normalized = normalizeLanguage(lang);
	if (normalized === "zh") return "Respond to the user in Simplified Chinese (中文), unless the user explicitly asks for another language.";
	if (normalized === "en") return "Respond to the user in English, unless the user explicitly asks for another language.";
	return "";
}

function languageBlock(lang) {
	var instruction = languageInstruction(lang);
	return instruction ? "## Response Language\n\n- " + instruction + "\n" : "";
}

function readLanguagePreference(projectRoot) {
	try { return normalizeLanguage(fs.readFileSync(path.join(projectRoot, ".emb-agent", ".language"), "utf8")); }
	catch (_) { return ""; }
}

function writeLanguagePreference(projectRoot, lang) {
	var normalized = normalizeLanguage(lang);
	if (!normalized) return;
	ensureDir(path.join(projectRoot, ".emb-agent"));
	fs.writeFileSync(path.join(projectRoot, ".emb-agent", ".language"), normalized + "\n");
}

function writeDeveloperPreference(projectRoot, name) {
	var trimmed = String(name || "").trim();
	if (!trimmed) return;
	ensureDir(path.join(projectRoot, ".emb-agent"));
	fs.writeFileSync(path.join(projectRoot, ".emb-agent", ".developer"), JSON.stringify({ name: trimmed }) + "\n");
}

function backupManagedFile(projectRoot, filePath) {
	try {
		if (!fs.existsSync(filePath)) return;
		var rel = path.relative(projectRoot, filePath);
		if (!rel || rel.startsWith("..")) return;
		var stamp = new Date().toISOString().replace(/[:.]/g, "-");
		var backupPath = path.join(projectRoot, ".emb-agent", "backups", "install-" + stamp, rel);
		ensureDir(path.dirname(backupPath));
		fs.copyFileSync(filePath, backupPath);
	} catch (_) {}
}

// ── AGENTS.md deployment ──────────────────────────────────────────

function resolveIncludes(content, vars) {
	var values = vars || {};
	var resolved = content.replace(/\{\{INCLUDE:_partials\/([^}]+)\}\}/g, function (_, name) {
		var incPath = path.join(PARTIALS_DIR, name);
		if (fs.existsSync(incPath)) return fs.readFileSync(incPath, "utf8").trim();
		return "<!-- missing: " + name + " -->";
	});
	return resolved.replace(/\{\{LANGUAGE_INSTRUCTION\}\}/g, languageBlock(values.LANGUAGE));
}

function applyTemplate(content, vars) {
	var values = vars || {};
	return content.replace(/\{\{([A-Z_]+)\}\}/g, function (_, key) {
		return values[key] !== undefined ? values[key] : "{{" + key + "}}";
	});
}

function resolveAndDeploy(projectRoot, srcPath, destPath, vars) {
	backupManagedFile(projectRoot, destPath);
	if (!fs.existsSync(srcPath)) return false;
	var raw = fs.readFileSync(srcPath, "utf8");
	var resolved = resolveIncludes(raw, vars);
	var rendered = applyTemplate(resolved, vars);
	return deployAgentsMd(srcPath, destPath, rendered);
}

function deployAgentsMd(templatePath, destPath, templateContent) {
	if (!templateContent) {
		if (!fs.existsSync(templatePath)) return false;
		templateContent = fs.readFileSync(templatePath, "utf8");
		templateContent = resolveIncludes(templateContent);
	}

	ensureDir(path.dirname(destPath));
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
	logDetail("    " + path.basename(destPath) + " overwritten with managed template");
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
	if (injectedCount > 0) logDetail("    Spec rules injected into " + injectedCount + " agents (enforcement-scoped)");
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

function selectListFallback(title, items, callback, options) {
	var config = options || {};
	console.log("\x1b[34m▶ " + title + "\x1b[0m");
	if (config.allowSkip === false || config.requireSelection) {
		console.log("\x1b[31m  Keyboard selection is required for this prompt.\x1b[0m");
		process.exit(1);
	}
	console.log("\x1b[2m  Keyboard selection is unavailable in this terminal; skipping optional selection.\x1b[0m");
	callback([]);
	void items;
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
	var config = options || {};
	var allowSkip = config.allowSkip !== false;
	var contextLabel = config.contextLabel || "Source";
	var contextValue = config.contextValue || "emb-support";
	var skipLabel = config.skipLabel || "Skip";
	var itemNoun = config.itemNoun || "entry";
	var itemPlural = config.itemPlural || "entries";
	var lines = [];
	lines.push(C.cyan + C.bold + "emb-agent installer" + C.reset);
	lines.push(C.dim + "  Embedded workflow bootstrap for Codex, Claude Code, Cursor, Pi, OMP, Windsurf" + C.reset);
	lines.push("");
	lines.push(C.blue + "▶ " + title + C.reset);
	lines.push(C.dim + "  " + contextLabel + ": " + contextValue + C.reset);
	lines.push(C.dim + "  Use ↑/↓ to move and Space to toggle the highlighted " + itemNoun + "." + C.reset);
	lines.push(C.dim + "  Press Enter to confirm selected " + itemPlural + "; press `a` to toggle all; Esc/Ctrl+C cancels." + C.reset);
	if (allowSkip) lines.push(C.dim + "  Highlight `skip` and press Enter, or press Enter with no selected " + itemPlural + ", to skip." + C.reset);
	else lines.push(C.dim + "  Nothing is selected until you press Space." + C.reset);
	lines.push("");
	if (allowSkip) {
		var skipActive = state.cursorIndex === 0;
		lines.push("  " + (skipActive ? C.cyan + "›" + C.reset : " ") + " " + C.cyan + "skip" + C.reset + " " + (skipActive ? C.bold + C.white : C.white) + skipLabel + C.reset);
	}
	for (var i = 0; i < items.length; i++) {
		var entryIndex = allowSkip ? i + 1 : i;
		var active = state.cursorIndex === entryIndex;
		var selected = state.selected[entryIndex] === true;
		var marker = selected ? C.green + "●" + C.reset : C.dim + "○" + C.reset;
		var detail = summarizeListText(items[i].desc, 120);
		var name = active ? C.bold + C.white + items[i].label + C.reset : C.white + items[i].label + C.reset;
		lines.push("  " + (active ? C.cyan + "›" + C.reset : " ") + " " + marker + " " + name + (detail ? C.dim + " - " + detail + C.reset : ""));
	}
	if (state.warning) lines.push(C.yellow + "  " + state.warning + C.reset);
	lines.push("");
	lines.push(C.yellow + "↑/↓=move  Space=toggle  a=all  Enter=confirm" + C.reset);
	return lines.join("\n");
}

function selectList(title, items, callback, options) {
	var config = options || {};
	if (!supportsKeyboardSelection()) {
		selectListFallback(title, items, callback, config);
		return;
	}

	var stdin = process.stdin;
	var stdout = process.stdout;
	var previousRawMode = Boolean(stdin.isRaw);
	var allowSkip = config.allowSkip !== false;
	var state = { cursorIndex: allowSkip ? (items.length > 0 ? 1 : 0) : 0, selected: {}, warning: "" };
	var totalChoices = items.length + (allowSkip ? 1 : 0);
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
			var key = allowSkip ? i + 1 : i;
			if (state.selected[key]) result.push(items[i].value);
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
		stdout.write(renderSelectionScreen(title, items, state, config) + "\n");
	}

	function toggleCurrent() {
		if (allowSkip && state.cursorIndex === 0) return;
		state.selected[state.cursorIndex] = !state.selected[state.cursorIndex];
		state.warning = "";
	}

	function toggleAll() {
		var selectedCount = 0;
		var start = allowSkip ? 1 : 0;
		var end = allowSkip ? items.length : items.length - 1;
		for (var i = start; i <= end; i++) if (state.selected[i]) selectedCount++;
		var next = selectedCount !== items.length;
		for (var j = start; j <= end; j++) state.selected[j] = next;
		state.warning = "";
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
			if (allowSkip && state.cursorIndex === 0) { finish([]); return; }
			var values = selectedValues();
			if (values.length === 0 && config.requireSelection) {
				state.warning = "Press Space to select at least one " + (config.itemNoun || "entry") + " first.";
				render();
				return;
			}
			finish(values);
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
		selectListFallback(title, items, callback, config);
	}
}
function selectOneFallback(title, items, callback, options) {
	console.log("\x1b[34m▶ " + title + "\x1b[0m");
	console.log("\x1b[31m  Keyboard selection is required for interactive install.\x1b[0m");
	process.exit(1);
	callback(null);
	void items;
	void options;
}

function renderSingleSelectionScreen(title, items, state, options) {
	var C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", blue: "\x1b[34m", white: "\x1b[37m" };
	var lines = [];
	lines.push(C.cyan + C.bold + "emb-agent installer" + C.reset);
	lines.push(C.dim + "  Embedded workflow bootstrap for Codex, Claude Code, Cursor, Pi, OMP, Windsurf" + C.reset);
	lines.push("");
	lines.push(C.blue + "▶ " + title + C.reset);
	if (options && options.description) lines.push(C.dim + "  " + options.description + C.reset);
	lines.push(C.dim + "  Use ↑/↓ to move, Space to select, Enter to confirm the selected option." + C.reset);
	lines.push(C.dim + "  Nothing is selected until you press Space. Esc/Ctrl+C cancels." + C.reset);
	lines.push("");
	for (var i = 0; i < items.length; i++) {
		var active = state.cursorIndex === i;
		var selected = state.selectedIndex === i;
		var marker = selected ? C.green + "●" + C.reset : C.dim + "○" + C.reset;
		var detail = summarizeListText(items[i].desc, 100);
		var name = active ? C.bold + C.white + items[i].label + C.reset : C.white + items[i].label + C.reset;
		lines.push("  " + (active ? C.cyan + "›" + C.reset : " ") + " " + marker + " " + name + (detail ? C.dim + " - " + detail + C.reset : ""));
	}
	if (state.warning) lines.push(C.yellow + "  " + state.warning + C.reset);
	lines.push("");
	lines.push(C.yellow + "↑/↓=move  Space=select  Enter=confirm" + C.reset);
	return lines.join("\n");
}

function selectOne(title, items, callback, options) {
	if (!items || items.length === 0) throw new Error("selectOne requires at least one item");
	if (!supportsKeyboardSelection()) {
		selectOneFallback(title, items, callback, options || {});
		return;
	}
	var stdin = process.stdin;
	var stdout = process.stdout;
	var previousRawMode = Boolean(stdin.isRaw);
	var state = { cursorIndex: 0, selectedIndex: -1, warning: "" };
	var settled = false;
	function removeDataListener() { if (typeof stdin.off === "function") stdin.off("data", handleInput); else stdin.removeListener("data", handleInput); }
	function cleanup() { if (settled) return; settled = true; try { stdin.setRawMode(previousRawMode); } catch (_) {} try { removeDataListener(); } catch (_) {} if (typeof stdin.pause === "function") stdin.pause(); stdout.write("\x1b[?25h\x1b[?1049l"); }
	function render() { stdout.write("\x1b[2J\x1b[H"); stdout.write(renderSingleSelectionScreen(title, items, state, options || {}) + "\n"); }
	function finish() { var item = items[state.selectedIndex]; cleanup(); console.log("\x1b[32m  ✔ " + item.label + "\x1b[0m\n"); callback(item.value); }
	function cancel() { cleanup(); console.log("\x1b[31mInteractive install cancelled.\x1b[0m"); process.exit(130); }
	function handleInput(chunk) {
		var input = String(chunk || "");
		if (input === "\u001b[A" || input === "\u001bOA") { state.cursorIndex = (state.cursorIndex - 1 + items.length) % items.length; render(); return; }
		if (input === "\u001b[B" || input === "\u001bOB") { state.cursorIndex = (state.cursorIndex + 1) % items.length; render(); return; }
		if (input === " ") { state.selectedIndex = state.cursorIndex; state.warning = ""; render(); return; }
		if (input === "\r" || input === "\n") { if (state.selectedIndex >= 0) finish(); else { state.warning = "Press Space to select an option first."; render(); } return; }
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
		selectOneFallback(title, items, callback, options || {});
	}
}

function confirmTextPrompt(title, body, callback) {
	console.log("\n\x1b[34m▶ " + title + "\x1b[0m");
	console.log(body + "\n");
	var rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
	rl.question("Press Enter to continue, or type q to cancel > ", function (answer) {
		rl.close();
		if (String(answer || "").trim().toLowerCase() === "q") { console.log("Interactive install cancelled."); process.exit(130); }
		callback();
	});
}

function commandFileNames() {
	return CANONICAL_SHELL_COMMANDS.map(function (command) { return command.file; });
}

function staleCommandFileNames() {
	return commandFileNames().concat(["next.md", "onboard.md", "emb-status.md", "emb-scan.md", "emb-init.md"]);
}

function cleanupManagedHostCommands(projectRoot, host) {
	var stale = staleCommandFileNames();
	var hostDir = hostDirFor(projectRoot, host);
	var dirs = [
		path.join(hostDir, "commands"),
		path.join(hostDir, "workflows"),
		path.join(hostDir, "plugins", "emb-agent", "commands"),
	];
	for (var d = 0; d < dirs.length; d++) {
		for (var i = 0; i < stale.length; i++) removePath(path.join(dirs[d], stale[i]));
	}
	if (host.name === "codex") {
		for (var j = 0; j < CANONICAL_SHELL_COMMANDS.length; j++) {
			removePath(path.join(projectRoot, ".agents", "skills", CANONICAL_SHELL_COMMANDS[j].name));
			removePath(path.join(os.homedir(), ".agents", "skills", CANONICAL_SHELL_COMMANDS[j].name));
		}
	}
}

function commandRuntimePath(projectRoot, host) {
	if (hostInstallScope(host) === "local") return path.join(host.dir, "emb-agent", "bin", "emb-agent.cjs").replace(/\\/g, "/");
	return path.join(hostDirFor(projectRoot, host), "emb-agent", "bin", "emb-agent.cjs");
}

function renderShellCommandShim(projectRoot, host, command) {
	var runtimePath = commandRuntimePath(projectRoot, host);
	var language = languageInstruction(readLanguagePreference(projectRoot));
	var title = host.name === "windsurf" ? "# /" + command.name + " workflow" : "# /" + command.name;
	var lines = [
		"---",
		"name: " + command.name,
		"description: " + command.description,
		"allowed-tools:",
		"  - Bash",
		"  - Read",
		"  - Task",
		"---",
		"",
		title,
		"",
		command.summary,
		"",
		"Run from the project root:",
		"",
		"```sh",
		"node " + JSON.stringify(runtimePath) + " " + command.args,
		"```",
		"",
		"- Treat stdout as AI routing context, not as user-facing transcript.",
		"- Follow `agent_protocol.gate` allowed and forbidden actions exactly.",
		"- Do not ask the user to run emb-agent manually when this command can run it.",
	];
	if (language) lines.push("- " + language);
	return lines.join("\n") + "\n";
}

function renderCodexSkillShim(projectRoot, host, command) {
	var runtimePath = commandRuntimePath(projectRoot, host);
	var language = languageInstruction(readLanguagePreference(projectRoot));
	var lines = [
		"---",
		"name: " + command.name,
		"description: " + command.description,
		"---",
		"",
		"# " + command.name,
		"",
		command.summary,
		"",
		"Run from the project root:",
		"",
		"```sh",
		"node " + JSON.stringify(runtimePath) + " " + command.args,
		"```",
		"",
		"Treat stdout as AI routing context and follow `agent_protocol.gate` exactly.",
	];
	if (language) lines.push(language);
	return lines.join("\n") + "\n";
}

function canonicalSurfaceDir(projectRoot, host) {
	if (host.name === "claude") return path.join(hostDirFor(projectRoot, host), "commands");
	if (host.name === "cursor") return path.join(hostDirFor(projectRoot, host), "commands");
	if (host.name === "windsurf") {
		if (hostInstallScope(host) === "global") return path.join(os.homedir(), ".codeium", "windsurf", "global_workflows");
		return path.join(hostDirFor(projectRoot, host), "workflows");
	}
	return "";
}

function deployCanonicalShellCommands(projectRoot, host) {
	if (host.name === "omp" || host.name === "pi") return;
	if (host.name === "codex") {
		var skillRoot = hostInstallScope(host) === "global" ? path.join(os.homedir(), ".agents", "skills") : path.join(projectRoot, ".agents", "skills");
		for (var c = 0; c < CANONICAL_SHELL_COMMANDS.length; c++) {
			var skillCommand = CANONICAL_SHELL_COMMANDS[c];
			var skillDir = path.join(skillRoot, skillCommand.name);
			ensureDir(skillDir);
			fs.writeFileSync(path.join(skillDir, "SKILL.md"), renderCodexSkillShim(projectRoot, host, skillCommand));
		}
		logDetail("    Codex command skills deployed to " + path.relative(projectRoot, skillRoot).replace(/\\/g, "/"));
		return;
	}
	var commandsDir = canonicalSurfaceDir(projectRoot, host);
	if (!commandsDir) return;
	ensureDir(commandsDir);
	for (var i = 0; i < CANONICAL_SHELL_COMMANDS.length; i++) {
		var command = CANONICAL_SHELL_COMMANDS[i];
		fs.writeFileSync(path.join(commandsDir, command.file), renderShellCommandShim(projectRoot, host, command));
	}
	var label = host.name === "windsurf" ? "workflow shims" : "command shims";
	logDetail("    " + label + " deployed to " + path.relative(projectRoot, commandsDir).replace(/\\/g, "/"));
}


function hostSurfaceSummary(projectRoot, host) {
	if (host.name === "omp" || host.name === "pi") return { kind: "extension", dir: path.join(hostDirFor(projectRoot, host), "extensions"), commands: ["/emb-next", "/emb-onboard"], reload: "Start a new " + host.name + " session after install." };
	if (host.name === "codex") {
		var root = hostInstallScope(host) === "global" ? path.join(os.homedir(), ".agents", "skills") : path.join(projectRoot, ".agents", "skills");
		return { kind: "codex-skills", dir: root, commands: ["$emb-next", "$emb-onboard"], reload: "Restart Codex or run /skills if the new skills are not visible." };
	}
	if (host.name === "windsurf") return { kind: "windsurf-workflows", dir: canonicalSurfaceDir(projectRoot, host), commands: ["/emb-next", "/emb-onboard"], reload: "Refresh Cascade or open a new Windsurf session." };
	return { kind: "command-files", dir: canonicalSurfaceDir(projectRoot, host), commands: ["/emb-next", "/emb-onboard"], reload: host.name === "cursor" ? "Reload Cursor window if commands are not visible." : "Start a new Claude Code session if commands are not visible." };
}

function selectedHostList(args, state) {
	if (state && Array.isArray(state.hosts)) return state.hosts;
	if (args.target === "all") return SUPPORTED_HOSTS.slice();
	if (args.target) {
		var host = SUPPORTED_HOSTS.find(function (h) { return h.name === args.target; });
		return host ? [host] : [];
	}
	return [];
}

function scopedHosts(hosts, scope) {
	return hosts.map(function (host) { return hostForScope(host, scope); });
}

function planEntries(projectRoot, hosts) {
	var entries = [path.join(projectRoot, ".emb-agent"), path.join(projectRoot, "AGENTS.md"), path.join(projectRoot, "docs", "prd")];
	for (var i = 0; i < hosts.length; i++) {
		var host = hosts[i];
		var hostDir = hostDirFor(projectRoot, host);
		entries.push(path.join(hostDir, "emb-agent"));
		entries.push(path.join(hostDir, "skills", "emb-agent"));
		var surface = hostSurfaceSummary(projectRoot, host);
		if (surface.dir) entries.push(surface.dir);
		if (host.name === "codex") entries.push(path.join(hostDir, "instructions.md"));
		if (host.name === "cursor") entries.push(path.join(hostDir, "rules", "emb-agent-workflow.mdc"));
		if (host.name === "windsurf") entries.push(path.join(hostDir, "rules", "emb-agent-workflow.md"));
	}
	var seen = {};
	return entries.filter(function (entry) { if (seen[entry]) return false; seen[entry] = true; return true; });
}

function renderInstallPlan(projectRoot, hosts, options) {
	var lines = [];
	var scope = options.scope || "local";
	var language = normalizeLanguage(options.lang || readLanguagePreference(projectRoot)) || "not set";
	var compact = options.compact === true;
	lines.push("Install plan");
	lines.push("  mode: " + (options.mode || "install"));
	lines.push("  scope: " + scope);
	lines.push("  language: " + language);
	lines.push("  developer: " + (options.developer || "developer"));
	lines.push("  hosts: " + hosts.map(function (h) { return h.name; }).join(", "));
	if (options.specs && options.specs.length) lines.push("  external specs: " + options.specs.join(", "));
	if (options.skills && options.skills.length) lines.push("  external skills: " + options.skills.join(", "));
	lines.push("");
	lines.push("Commands:");
	for (var i = 0; i < hosts.length; i++) {
		var surface = hostSurfaceSummary(projectRoot, hosts[i]);
		lines.push("  - " + hosts[i].name + ": " + surface.commands.join(", ") + " (" + surface.kind + ")");
	}
	if (!compact) {
		lines.push("");
		lines.push("Managed paths:");
		var entries = planEntries(projectRoot, hosts);
		for (var j = 0; j < entries.length; j++) lines.push("  - " + entries[j]);
	}
	return lines.join("\n");
}

function writeInstallHistory(projectRoot, hosts, options) {
	var historyDir = path.join(projectRoot, ".emb-agent");
	ensureDir(historyDir);
	var record = { time: new Date().toISOString(), version: VERSION, mode: options.mode || "install", scope: options.scope || "local", language: normalizeLanguage(options.lang || readLanguagePreference(projectRoot)), hosts: hosts.map(function (h) { return h.name; }), commands: ["emb-next", "emb-onboard"] };
	fs.appendFileSync(path.join(historyDir, "install-history.jsonl"), JSON.stringify(record) + "\n");
}

function writeInstallResult(projectRoot, hosts, options) {
	var lines = ["# emb-agent Install Result", "", "- Version: " + VERSION, "- Date: " + new Date().toISOString(), "- Scope: " + (options.scope || "local"), "- Language: " + (normalizeLanguage(options.lang || readLanguagePreference(projectRoot)) || "not set"), "", "## Commands"];
	for (var i = 0; i < hosts.length; i++) {
		var surface = hostSurfaceSummary(projectRoot, hosts[i]);
		lines.push("", "### " + hosts[i].name, "", "- Surface: " + surface.kind, "- Path: " + surface.dir, "- Entries: " + surface.commands.join(", "), "- Reload: " + surface.reload);
	}
	lines.push("", "## Next", "", "- New or migrated project: run `/emb-onboard` or the host-equivalent entry shown above.", "- Initialized project: run `/emb-next` or the host-equivalent entry shown above.", "- Diagnose runtime state: `node .<host>/emb-agent/bin/emb-agent.cjs doctor --host <host> --brief`.");
	ensureDir(path.join(projectRoot, ".emb-agent"));
	fs.writeFileSync(path.join(projectRoot, ".emb-agent", "INSTALL_RESULT.md"), lines.join("\n") + "\n");
}

function runInstallChecks(projectRoot, hosts) {
	var results = [];
	for (var i = 0; i < hosts.length; i++) {
		var host = hosts[i];
		var embDir = path.join(hostDirFor(projectRoot, host), "emb-agent");
		var wrapper = path.join(embDir, "bin", "emb-agent.cjs");
		var binName = "emb-agent-rs" + (process.platform === "win32" ? ".exe" : "");
		var binPath = path.join(embDir, "bin", binName);
		var surface = hostSurfaceSummary(projectRoot, host);
		var runtimeOk = fs.existsSync(wrapper) && fs.existsSync(binPath);
		var surfaceOk = true;
		if (host.name === "omp" || host.name === "pi") surfaceOk = fs.existsSync(path.join(hostDirFor(projectRoot, host), "extensions", "emb-agent.ts"));
		else if (host.name === "codex") surfaceOk = fs.existsSync(path.join(surface.dir, "emb-next", "SKILL.md")) && fs.existsSync(path.join(surface.dir, "emb-onboard", "SKILL.md"));
		else surfaceOk = fs.existsSync(path.join(surface.dir, "emb-next.md")) && fs.existsSync(path.join(surface.dir, "emb-onboard.md"));
		var doctor = "";
		try {
			var r = childProcess.spawnSync("node", [wrapper, "doctor", "--host", host.name, "--brief"], { cwd: projectRoot, encoding: "utf8", timeout: 10000 });
			if (r.status === 0 && r.stdout) doctor = r.stdout.trim();
		} catch (_) {}
		logDetail("check " + host.name + ": runtime=" + (runtimeOk ? "ok" : "missing") + " surface=" + (surfaceOk ? "ok" : "missing"));
		if (doctor) logDetail("doctor " + host.name + ": " + doctor);
		results.push({ host: host, surface: surface, ok: runtimeOk && surfaceOk });
	}
	return results;
}

function uninstallHost(projectRoot, host) {
	cleanupManagedHostCommands(projectRoot, host);
	var hostDir = hostDirFor(projectRoot, host);
	removePath(path.join(hostDir, "emb-agent"));
	removePath(path.join(hostDir, "skills", "emb-agent"));
	removePath(path.join(hostDir, "extensions", "emb-agent.ts"));
	removePath(path.join(hostDir, "rules", "emb-agent-workflow.mdc"));
	removePath(path.join(hostDir, "rules", "emb-agent-workflow.md"));
	removePath(path.join(hostDir, "instructions.md"));
	if (host.name === "codex") for (var i = 0; i < CANONICAL_SHELL_COMMANDS.length; i++) removePath(path.join(projectRoot, ".agents", "skills", CANONICAL_SHELL_COMMANDS[i].name));
	console.log("  Removed managed " + host.name + " integration from " + hostDir);
}

function completeInstallBatch(projectRoot, hosts, options) {
	writeInstallHistory(projectRoot, hosts, options || {});
	writeInstallResult(projectRoot, hosts, options || {});
	var checks = runInstallChecks(projectRoot, hosts);
	var failed = checks.filter(function (check) { return !check.ok; });
	console.log("\nInstalled emb-agent for " + hosts.map(function (host) { return host.name; }).join(", ") + ".");
	console.log((failed.length === 0 ? "✓" : "!") + " Install check: " + (failed.length === 0 ? "ok" : "needs attention"));
	for (var i = 0; i < checks.length; i++) {
		console.log("  " + checks[i].host.name + ": " + checks[i].surface.commands.join(" or ") + " — " + checks[i].surface.reload);
	}
	console.log("  Details: .emb-agent/INSTALL_RESULT.md");
	console.log("  Log: .emb-agent/install.log");
}



// ── Install per host ──────────────────────────────────────────────

function installForHost(projectRoot, host, callback) {
	var hostDir = hostDirFor(projectRoot, host);
	var embDir = path.join(hostDir, "emb-agent");

	logDetail("  Installing for " + host.name + " → " + hostDir);

	ensureDir(path.join(projectRoot, "docs"));
	ensureDir(path.join(projectRoot, "docs", "prd"));
	ensureDir(path.join(embDir, "bin"));
	ensureDir(path.join(embDir, "agents"));

	cleanupManagedHostCommands(projectRoot, host);
	cleanupLeanHostRuntime(embDir);
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

		copyIf(path.join(RUNTIME_SRC, "config.json"), path.join(embDir, "config.json"));
		copyDir(COMMANDS_SRC, path.join(embDir, "commands", "emb"));
		copyDir(COMMAND_DOCS_SRC, path.join(embDir, "command-docs", "emb"));
		copyDir(AGENTS_SRC, path.join(embDir, "agents"));
		deployCanonicalShellCommands(projectRoot, host);


		fs.writeFileSync(path.join(embDir, "VERSION"), VERSION + "\n");
		fs.writeFileSync(path.join(embDir, "HOST.json"), JSON.stringify({
			name: host.name, label: host.name.charAt(0).toUpperCase() + host.name.slice(1),
			install_profile: host.profile, install_scope: hostInstallScope(host), target_dir: hostDir, runtime_dir_name: "emb-agent",
		}, null, 2) + "\n");

		var extScaffoldDir = path.join(RUNTIME_SRC, "scaffolds", "shells", host.dir, "extensions");
		if (fs.existsSync(extScaffoldDir)) {
			var extDir = path.join(hostDir, "extensions");
			ensureDir(extDir);
			var extSrc = path.join(extScaffoldDir, "emb-agent.ts");
			if (fs.existsSync(extSrc)) {
				fs.copyFileSync(extSrc, path.join(extDir, "emb-agent.ts"));
				logDetail("    Extension deployed to " + host.dir + "/extensions/");
			}
		}

		var skillScaffoldDir = path.join(RUNTIME_SRC, "scaffolds", "skills", "emb-agent");
		if (fs.existsSync(skillScaffoldDir)) {
			var skillDir = path.join(hostDir, "skills", "emb-agent");
			ensureDir(skillDir);
			var skillSrc = path.join(skillScaffoldDir, "SKILL.md");
			if (fs.existsSync(skillSrc)) {
				fs.copyFileSync(skillSrc, path.join(skillDir, "SKILL.md"));
				logDetail("    Skill deployed to " + host.dir + "/skills/emb-agent/");
			}
		}

		var hostShellDir = path.join(RUNTIME_SRC, "scaffolds", "shells", host.dir);
		var configFiles = ["hooks.json", "settings.json"];
		for (var ci = 0; ci < configFiles.length; ci++) {
			var cfg = configFiles[ci];
			var cfgSrc = path.join(hostShellDir, cfg);
			if (fs.existsSync(cfgSrc)) {
				fs.copyFileSync(cfgSrc, path.join(hostDir, cfg));
				logDetail("    " + cfg + " deployed to " + host.dir + "/");
			}
		}

		var templateVars = { PROJECT_NAME: path.basename(projectRoot), INSTALL_DATE: new Date().toISOString().split("T")[0], LANGUAGE: readLanguagePreference(projectRoot) };
		if (resolveAndDeploy(projectRoot,
			path.join(RUNTIME_SRC, "scaffolds", "shells", "AGENTS.md"),
			path.join(projectRoot, "AGENTS.md"),
			templateVars
		)) {
			logDetail("    AGENTS.md deployed to project root");
		}

		var hostRootFiles = { claude: "CLAUDE.md", codex: "CODEX.md" };
		var rootFile = hostRootFiles[host.name];
		if (rootFile) {
			if (resolveAndDeploy(projectRoot,
				path.join(RUNTIME_SRC, "scaffolds", "shells", rootFile),
				path.join(projectRoot, rootFile),
				templateVars
			)) {
				logDetail("    " + rootFile + " deployed to project root");
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
			if (resolveAndDeploy(projectRoot, ruleSrc, ruleDest, templateVars)) {
				logDetail("    " + ruleMapping.dest + " deployed to " + host.dir + "/");
			}
		}

		var binName = "emb-agent-rs" + (process.platform === "win32" ? ".exe" : "");
		var binPath = path.join(embDir, "bin", binName);
		if (fs.existsSync(binPath)) {
			try {
				var r = childProcess.spawnSync(binPath, ["init"], { cwd: projectRoot, encoding: "utf8", timeout: 15000 });
				if (r.status === 0 && r.stdout) {
					var j = JSON.parse(r.stdout.trim());
					if (j.initialized) logDetail("    Project workspace initialized (.emb-agent/)");
				}
			} catch (_) {}
		}
		function finishDone() {
			logDetail("Done. emb-agent is now installed for your AI runtime.");
			if (process.env._EMB_INSTALL_DONE) process.exit(0);
		}
		if (typeof callback === "function") callback(finishDone);
		else finishDone();
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

function copyDirIfExists(src, dest) {
	if (!fs.existsSync(src)) return false;
	var stat = fs.statSync(src);
	if (!stat.isDirectory()) return false;
	copyDir(src, dest);
	return true;
}

function writeJsonFile(filePath, value) {
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function updateProjectActiveSpecs(projectRoot, selectedSpecs) {
	var names = Array.isArray(selectedSpecs) ? selectedSpecs.filter(Boolean) : [];
	if (names.length === 0) return;
	var projectJson = path.join(projectRoot, ".emb-agent", "project.json");
	var project = {};
	try {
		if (fs.existsSync(projectJson)) project = JSON.parse(fs.readFileSync(projectJson, "utf8"));
	} catch (_) { project = {}; }
	var current = Array.isArray(project.active_specs) ? project.active_specs : [];
	var seen = {};
	var active = [];
	for (var i = 0; i < current.length; i++) {
		if (current[i] && !seen[current[i]]) { seen[current[i]] = true; active.push(current[i]); }
	}
	for (var j = 0; j < names.length; j++) {
		if (!seen[names[j]]) { seen[names[j]] = true; active.push(names[j]); }
	}
	project.active_specs = active;
	writeJsonFile(projectJson, project);
}


function parseMarkdownDocument(raw) {
	var doc = { meta: {}, body: String(raw || "") };
	var match = doc.body.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return doc;
	var meta = {};
	var lines = match[1].split("\n");
	for (var i = 0; i < lines.length; i++) {
		var idx = lines[i].indexOf(":");
		if (idx <= 0) continue;
		var key = lines[i].slice(0, idx).trim();
		var value = lines[i].slice(idx + 1).trim().replace(/^"/, "").replace(/"$/, "");
		if (key) meta[key] = value;
	}
	doc.meta = meta;
	doc.body = match[2] || "";
	return doc;
}

function uniqueNames(names) {
	var result = [];
	var seen = {};
	for (var i = 0; i < names.length; i++) {
		var name = String(names[i] || "").trim();
		if (name && !seen[name]) { seen[name] = true; result.push(name); }
	}
	return result;
}

function stateNames(state, key, itemKey) {
	if (Array.isArray(state[key])) return uniqueNames(state[key]);
	var items = Array.isArray(state[itemKey]) ? state[itemKey] : [];
	return uniqueNames(items.map(function (item) { return item.name; }));
}

function readSpecDoc(projectRoot, name) {
	var filePath = path.join(projectRoot, ".emb-agent", "specs", name + ".md");
	if (!fs.existsSync(filePath)) return null;
	var parsed = parseMarkdownDocument(fs.readFileSync(filePath, "utf8"));
	return {
		name: name,
		path: ".emb-agent/specs/" + name + ".md",
		title: parsed.meta.title || parsed.meta.name || name,
		summary: parsed.meta.summary || "",
		body: parsed.body.trim()
	};
}

function readSkillDoc(projectRoot, name) {
	var candidates = [
		path.join(projectRoot, ".agents", "skills", name, "SKILL.md"),
		path.join(projectRoot, ".emb-agent", "plugins", name, "SKILL.md")
	];
	for (var i = 0; i < candidates.length; i++) {
		if (!fs.existsSync(candidates[i])) continue;
		var parsed = parseMarkdownDocument(fs.readFileSync(candidates[i], "utf8"));
		return {
			name: name,
			path: candidates[i].slice(projectRoot.length + 1).replace(/\\/g, "/"),
			description: parsed.meta.description || parsed.meta.summary || ""
		};
	}
	return { name: name, path: ".agents/skills/" + name + "/SKILL.md", description: "" };
}

function buildSelectedSupportBlock(projectRoot, state) {
	var specNames = stateNames(state || {}, "specs", "specItems");
	var skillNames = stateNames(state || {}, "skills", "skillItems");
	var specDocs = specNames.map(function (name) { return readSpecDoc(projectRoot, name); }).filter(Boolean);
	var skillDocs = skillNames.map(function (name) { return readSkillDoc(projectRoot, name); }).filter(Boolean);
	if (specDocs.length === 0 && skillDocs.length === 0) return "";
	var block = "## Active External Specs and Skills\n\n";
	block += "These entries were selected during emb-agent install and are part of this project's AI contract.\n\n";
	if (specDocs.length > 0) {
		block += "### Active External Specs\n\n";
		block += "Follow these specs for all matching firmware work; they are not optional references.\n\n";
		for (var i = 0; i < specDocs.length; i++) {
			var spec = specDocs[i];
			block += "#### " + spec.title + " (`" + spec.name + "`)\n\n";
			if (spec.summary) block += spec.summary + "\n\n";
			block += "Source: `" + spec.path + "`\n\n";
			if (spec.body) block += spec.body + "\n\n";
		}
	}
	if (skillDocs.length > 0) {
		block += "### Installed External Skills\n\n";
		block += "Before doing work that matches one of these skill descriptions, read the named `SKILL.md` and follow it.\n\n";
		for (var j = 0; j < skillDocs.length; j++) {
			var skill = skillDocs[j];
			block += "- `" + skill.name + "`";
			if (skill.description) block += " — " + skill.description;
			block += "\n  - Required read: `" + skill.path + "`\n";
		}
		block += "\n";
	}
	return block.trim();
}

function injectMarkdownBlock(filePath, startMarker, endMarker, block) {
	if (!fs.existsSync(filePath)) return false;
	var content = fs.readFileSync(filePath, "utf8");
	var re = new RegExp("\\n?" + startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n?", "g");
	var managed = block ? "\n" + startMarker + "\n" + block.trim() + "\n" + endMarker + "\n" : "";
	if (re.test(content)) content = content.replace(re, managed ? managed + "\n" : "");
	else if (managed && content.indexOf("<!-- EMB-AGENT:END -->") >= 0) content = content.replace("<!-- EMB-AGENT:END -->", managed + "\n<!-- EMB-AGENT:END -->");
	else if (managed) content = content.replace(/\s*$/, "\n\n" + managed);
	fs.writeFileSync(filePath, content);
	return true;
}

function injectSelectedSupportIntoRoot(projectRoot, state) {
	var block = buildSelectedSupportBlock(projectRoot, state);
	var files = ["AGENTS.md", "CODEX.md", "CLAUDE.md"];
	var count = 0;
	for (var i = 0; i < files.length; i++) {
		if (injectMarkdownBlock(
			path.join(projectRoot, files[i]),
			"<!-- EMB-AGENT:SELECTED-SUPPORT:START -->",
			"<!-- EMB-AGENT:SELECTED-SUPPORT:END -->",
			block
		)) count++;
	}
	if (count > 0 && block) logDetail("    External support injected into root AI instructions");
}

function injectExternalSpecsIntoRuntimeAgents(projectRoot, host, state) {
	var specNames = stateNames(state || {}, "specs", "specItems");
	var specDocs = specNames.map(function (name) { return readSpecDoc(projectRoot, name); }).filter(Boolean);
	if (specDocs.length === 0) return;
	var block = "## Active External Specs\n\n";
	block += "Follow these project-selected external specs for matching firmware work.\n\n";
	for (var i = 0; i < specDocs.length; i++) {
		block += "### " + specDocs[i].title + " (`" + specDocs[i].name + "`)\n\n";
		if (specDocs[i].summary) block += specDocs[i].summary + "\n\n";
		block += "Source: `" + specDocs[i].path + "`\n\n";
		if (specDocs[i].body) block += specDocs[i].body + "\n\n";
	}
	var agentsDir = path.join(hostDirFor(projectRoot, host), "emb-agent", "agents");
	if (!fs.existsSync(agentsDir)) return;
	var files = fs.readdirSync(agentsDir).filter(function (f) { return f.endsWith(".md"); });
	for (var j = 0; j < files.length; j++) {
		injectMarkdownBlock(
			path.join(agentsDir, files[j]),
			"<!-- EMB-AGENT:EXTERNAL-SPECS:START -->",
			"<!-- EMB-AGENT:EXTERNAL-SPECS:END -->",
			block
		);
	}
	if (files.length > 0) logDetail("    External specs injected into " + files.length + " runtime agents");
}

function injectSelectedSupport(projectRoot, host, state) {
	injectSelectedSupportIntoRoot(projectRoot, state || {});
	injectExternalSpecsIntoRuntimeAgents(projectRoot, host, state || {});
}
function materializeSelectedSpec(projectRoot, item, callback) {
	var destDir = path.join(projectRoot, ".emb-agent", "specs");
	ensureDir(destDir);
	var dest = path.join(destDir, item.name + ".md");
	if (fs.existsSync(item.url)) {
		fs.copyFileSync(item.url, dest);
		callback(true);
		return;
	}
	downloadRawFile(item.url, dest, callback);
}

function materializeSelectedSkill(projectRoot, host, item, callback) {
	var projectSkillRoot = path.join(projectRoot, ".emb-agent", "plugins", item.name);
	var hostSkillRoot = path.join(hostDirFor(projectRoot, host), "skills", item.name);
	var sharedSkillRoot = path.join(projectRoot, ".agents", "skills", item.name);
	ensureDir(path.dirname(projectSkillRoot));
	ensureDir(path.dirname(hostSkillRoot));
	ensureDir(path.dirname(sharedSkillRoot));
	if (fs.existsSync(item.url)) {
		var sourceDir = path.dirname(item.url);
		copyDirIfExists(sourceDir, projectSkillRoot);
		copyDirIfExists(sourceDir, hostSkillRoot);
		copyDirIfExists(sourceDir, sharedSkillRoot);
		callback(true);
		return;
	}
	ensureDir(projectSkillRoot);
	ensureDir(hostSkillRoot);
	ensureDir(sharedSkillRoot);
	var pending = 3;
	function done() { pending--; if (pending === 0) callback(true); }
	downloadRawFile(item.url, path.join(projectSkillRoot, "SKILL.md"), done);
	downloadRawFile(item.url, path.join(hostSkillRoot, "SKILL.md"), done);
	downloadRawFile(item.url, path.join(sharedSkillRoot, "SKILL.md"), done);
}

function materializeSelectedSupport(projectRoot, host, state, callback) {
	var specs = Array.isArray(state.specItems) ? state.specItems : [];
	var skills = Array.isArray(state.skillItems) ? state.skillItems : [];
	var pending = specs.length + skills.length;
	if (pending === 0) { callback(); return; }
	function done() { pending--; if (pending === 0) callback(); }
	for (var i = 0; i < specs.length; i++) materializeSelectedSpec(projectRoot, specs[i], done);
	for (var j = 0; j < skills.length; j++) materializeSelectedSkill(projectRoot, host, skills[j], done);
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


// ── CLI ───────────────────────────────────────────────────────────

function main(argv) {
	var args = parseArgs(argv);

	if (args.help) { usage(); return; }

	var projectRoot = process.cwd();
	console.log("emb-agent v" + VERSION);
	console.log("Platform: " + platformKey());
	console.log("Project: " + projectRoot + "\n");
	QUIET_INSTALL = true;
	if (!args.dryRun && args.mode !== "uninstall") setInstallLogFile(projectRoot);

	var _devDir = path.join(projectRoot, ".emb-agent");
	if (!args.dryRun && args.mode !== "uninstall") {
		try { fs.mkdirSync(_devDir, { recursive: true }); } catch (_) {}
		if (args.developer) writeDeveloperPreference(projectRoot, args.developer);
		if (args.lang) writeLanguagePreference(projectRoot, args.lang);
		if (args.registry) fs.writeFileSync(path.join(_devDir, ".registry"), args.registry + "\n");
		if (args.skillSource) fs.writeFileSync(path.join(_devDir, ".skill-source"), args.skillSource + "\n");
		if (args.specs.length > 0) fs.writeFileSync(path.join(_devDir, ".specs"), args.specs.join(",") + "\n");
		if (args.skills.length > 0) fs.writeFileSync(path.join(_devDir, ".skills"), args.skills.join(",") + "\n");
	}

	var cliScope = args.global ? "global" : "local";
	var requestedHosts = selectedHostList(args);
	if (args.mode === "uninstall") {
		if (requestedHosts.length === 0) { console.error("uninstall requires --target <host|all>"); process.exit(1); }
		var uninstallHosts = scopedHosts(requestedHosts, cliScope);
		console.log(renderInstallPlan(projectRoot, uninstallHosts, { mode: "uninstall", scope: cliScope, lang: args.lang, developer: args.developer, specs: args.specs, skills: args.skills, compact: !args.dryRun }));
		if (args.dryRun) return;
		for (var ui = 0; ui < uninstallHosts.length; ui++) uninstallHost(projectRoot, uninstallHosts[ui]);
		writeInstallHistory(projectRoot, uninstallHosts, { mode: "uninstall", scope: cliScope, lang: args.lang, developer: args.developer });
		return;
	}
	if (args.target === "all") {
		var selectedStateAll = { specItems: args.specs.map(function (name) { return { name: name, url: "https://raw.githubusercontent.com/Welkon/emb-support/main/specs/" + name + ".md" }; }), skillItems: args.skills.map(function (name) { return { name: name, url: "https://raw.githubusercontent.com/Welkon/emb-support/main/skills/" + name + "/SKILL.md" }; }), specs: args.specs, skills: args.skills };
		var allHosts = scopedHosts(SUPPORTED_HOSTS, cliScope);
		console.log(renderInstallPlan(projectRoot, allHosts, { mode: args.mode, scope: cliScope, lang: args.lang, developer: args.developer, specs: args.specs, skills: args.skills, compact: !args.dryRun }));
		if (args.dryRun) return;
		var cliIndex = 0;
		function installNextCliHost() {
			if (cliIndex >= allHosts.length) { completeInstallBatch(projectRoot, allHosts, { mode: args.mode, scope: cliScope, lang: args.lang, developer: args.developer, specs: args.specs, skills: args.skills }); return; }
			var nextHost = allHosts[cliIndex++];
			installForHost(projectRoot, nextHost, function (done) {
				materializeSelectedSupport(projectRoot, nextHost, selectedStateAll, function () {
					updateProjectActiveSpecs(projectRoot, args.specs);
					injectSelectedSupport(projectRoot, nextHost, selectedStateAll);
					done();
					installNextCliHost();
				});
			});
		}
		installNextCliHost();
	} else if (args.target) {
		var host = SUPPORTED_HOSTS.find(function (h) { return h.name === args.target; });
		if (!host) { console.error("Unknown host: " + args.target); process.exit(1); }
		host = hostForScope(host, cliScope);
		var oneHosts = [host];
		console.log(renderInstallPlan(projectRoot, oneHosts, { mode: args.mode, scope: cliScope, lang: args.lang, developer: args.developer, specs: args.specs, skills: args.skills, compact: !args.dryRun }));
		if (args.dryRun) return;
		installForHost(projectRoot, host, function (done) {
			var selectedState = { specItems: args.specs.map(function (name) { return { name: name, url: "https://raw.githubusercontent.com/Welkon/emb-support/main/specs/" + name + ".md" }; }), skillItems: args.skills.map(function (name) { return { name: name, url: "https://raw.githubusercontent.com/Welkon/emb-support/main/skills/" + name + "/SKILL.md" }; }), specs: args.specs, skills: args.skills };
			materializeSelectedSupport(projectRoot, host, selectedState, function () {
				updateProjectActiveSpecs(projectRoot, args.specs);
				injectSelectedSupport(projectRoot, host, selectedState);
				done();
				completeInstallBatch(projectRoot, oneHosts, { mode: args.mode, scope: cliScope, lang: args.lang, developer: args.developer, specs: args.specs, skills: args.skills });
			});
		});
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
					var items = SUPPORTED_HOSTS.map(function (host) { return { label: host.name, desc: host.dir, value: host }; });
					selectList("Select Runtime", items, function (selected) { state.hosts = selected; next(); }, { contextLabel: "Runtime", contextValue: "available hosts", allowSkip: false, requireSelection: true, itemNoun: "runtime", itemPlural: "runtimes" });
				},
				function askLocation(next) {
					selectOne("Install Location", [
						{ label: "Global", desc: "Install to the user config directory", value: "global" },
						{ label: "Local", desc: "Install into this project (recommended)", value: "local" }
					], function (selected) { state.location = selected; next(); }, { description: "Project-scoped installs are easier to test and keep isolated." });
				},
				function askSpecs(next) {
					if (extSpecs.length === 0) { console.log(C.dim + "\n  No external specs available.\n" + C.reset); next(); return; }
					var items = [];
					for (var ei = 0; ei < extSpecs.length; ei++) items.push({ label: extSpecs[ei].name, desc: extSpecs[ei].desc || "", value: extSpecs[ei] });
					selectList("Spec Selection", items, function (selected) { state.specItems = selected; state.specs = selected.map(function (item) { return item.name; }); next(); }, { contextLabel: "Source", contextValue: externalSourceLabel(), skipLabel: "Skip external spec import", itemNoun: "spec", itemPlural: "specs" });
				},
				function askSkills(next) {
					if (extSkills.length === 0) { console.log(C.dim + "  No external skills available.\n" + C.reset); next(); return; }
					var items = [];
					for (var ei = 0; ei < extSkills.length; ei++) items.push({ label: extSkills[ei].name, desc: extSkills[ei].desc || "", value: extSkills[ei] });
					selectList("Skill Selection", items, function (selected) { state.skillItems = selected; state.skills = selected.map(function (item) { return item.name; }); next(); }, { contextLabel: "Plugin", contextValue: externalSourceLabel(), skipLabel: "Skip initial skill installation", itemNoun: "skill", itemPlural: "skills" });
				},
				function askLanguage(next) {
					selectOne("Reply Language", [
						{ label: "English", desc: "Use English replies", value: "en" },
						{ label: "中文", desc: "Use Chinese (Simplified) replies", value: "zh" }
					], function (selected) { state.lang = selected; next(); }, { description: "Choose the language AI assistants should use in this project." });
				},
				function askDeveloper(next) {
					console.log(C.blue + "▶ Developer Identity" + C.reset);
					var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
					rl.question(C.yellow + "Developer name > " + C.reset, function(a) { rl.close(); state.developer = a.trim() || "developer"; next(); });
				},
				function confirmAndInstall() {
					writeDeveloperPreference(projectRoot, state.developer);
					writeLanguagePreference(projectRoot, state.lang);
					if (state.specs && state.specs.length > 0) fs.writeFileSync(path.join(_devDir, ".specs"), state.specs.join(",") + "\n");
					if (state.skills && state.skills.length > 0) fs.writeFileSync(path.join(_devDir, ".skills"), state.skills.join(",") + "\n");
					var scoped = scopedHosts(state.hosts || [], state.location);
					confirmTextPrompt("Ready to install", renderInstallPlan(projectRoot, scoped, { mode: "install", scope: state.location, lang: state.lang, developer: state.developer, specs: state.specs || [], skills: state.skills || [], compact: true }), function () {
						var hostNames = scoped.map(function (host) { return host.name; }).join(", ");
						console.log(C.green + "  ✔ Installing for " + hostNames + " as " + state.developer + C.reset + "\n");
						var hostIndex = 0;
						function installNextHost() {
							if (hostIndex >= scoped.length) { completeInstallBatch(projectRoot, scoped, { mode: "install", scope: state.location, lang: state.lang, developer: state.developer, specs: state.specs || [], skills: state.skills || [] }); return; }
							var host = scoped[hostIndex++];
							installForHost(projectRoot, host, function (done) {
								materializeSelectedSupport(projectRoot, host, state, function () {
									updateProjectActiveSpecs(projectRoot, state.specs || []);
									injectSelectedSupport(projectRoot, host, state);
									if (state.specItems && state.specItems.length > 0) logDetail("    External specs installed to .emb-agent/specs/");
									if (state.skillItems && state.skillItems.length > 0) logDetail("    External skills installed to .emb-agent/plugins/, " + host.dir + "/skills/, .agents/skills/");
									done();
									installNextHost();
								});
							});
						}
						installNextHost();
					});
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
