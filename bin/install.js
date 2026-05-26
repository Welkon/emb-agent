#!/usr/bin/env node
// emb-agent installer v0.5.0
// Deploys Rust binary + runtime templates to target AI host directories.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const VERSION = PACKAGE_JSON.version || "0.5.0";

const RUNTIME_SRC = path.join(REPO_ROOT, "runtime");
const RUST_BINARY_SRC = path.join(REPO_ROOT, "bin", "emb-agent-rs");
const COMMANDS_SRC = path.join(REPO_ROOT, "commands", "emb");
const COMMAND_DOCS_SRC = path.join(REPO_ROOT, "command-docs", "emb");
const AGENTS_SRC = path.join(REPO_ROOT, "agents");

const SUPPORTED_HOSTS = [
	{ name: "codex", dir: ".codex", profile: "core" },
	{ name: "cursor", dir: ".cursor", profile: "core" },
	{ name: "claude", dir: ".claude", profile: "core" },
	{ name: "pi", dir: ".pi", profile: "core" },
	{ name: "omp", dir: ".omp", profile: "core" },
	{ name: "windsurf", dir: ".windsurf", profile: "core" },
];

function usage() {
	console.log(
		[
			`emb-agent v${VERSION} installer`,
			"",
			"Usage:",
			"  npx emb-agent                            # Interactive install",
			"  npx emb-agent --target pi                # Install for pi",
			"  npx emb-agent --target omp                # Install for Oh My Pi",
			"  npx emb-agent --target codex             # Install for Codex",
			"  npx emb-agent --target all               # Install for all hosts",
			"  npx emb-agent --help                     # Show this help",
			"",
			"The installer deploys:",
			"  - Rust binary (emb-agent-rs) to .<host>/emb-agent/bin/",
			"  - Thin Node.js wrapper (emb-agent.cjs)",
			"  - Runtime templates (profiles, schemas, scaffolds)",
			"  - Command documentation and agent prompts",
		].join("\n"),
	);
}

function parseArgs(argv) {
	const args = { target: "", help: false, force: false };
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i];
		if (t === "--help" || t === "-h") args.help = true;
		else if (t === "--target") args.target = argv[++i] || "";
		else if (t === "--force") args.force = true;
	}
	return args;
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
	if (!fs.existsSync(src)) return;
	ensureDir(dest);
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(s, d);
		} else {
			fs.copyFileSync(s, d);
		}
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

function installForHost(projectRoot, host) {
	const hostDir = path.join(projectRoot, host.dir);
	const embDir = path.join(hostDir, "emb-agent");

	console.log(`  Installing for ${host.name} → ${hostDir}`);

	// Core directories
	ensureDir(path.join(embDir, "bin"));
	ensureDir(path.join(embDir, "commands", "emb"));
	ensureDir(path.join(embDir, "command-docs", "emb"));
	ensureDir(path.join(embDir, "agents"));

	// Rust binary
	if (fs.existsSync(RUST_BINARY_SRC)) {
		fs.copyFileSync(RUST_BINARY_SRC, path.join(embDir, "bin", "emb-agent-rs"));
		console.log("    Rust binary deployed");
	} else {
		console.log(
			"    ⚠ Rust binary not found (build with: cargo build --release)",
		);
		console.log(
			"    Download from: https://github.com/Welkon/emb-agent/releases",
		);
	}

	// Thin Node.js wrapper
	const wrapperPath = path.join(RUNTIME_SRC, "bin", "emb-agent.cjs");
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
	copyIf(
		path.join(RUNTIME_SRC, "config.json"),
		path.join(embDir, "config.json"),
	);

	// Commands documentation
	copyDir(COMMANDS_SRC, path.join(embDir, "commands", "emb"));
	copyDir(COMMAND_DOCS_SRC, path.join(embDir, "command-docs", "emb"));

	// Agent prompts
	copyDir(AGENTS_SRC, path.join(embDir, "agents"));

	// Host metadata
	fs.writeFileSync(path.join(embDir, "VERSION"), `${VERSION}\n`);
	fs.writeFileSync(
		path.join(embDir, "HOST.json"),
		JSON.stringify(
			{
				name: host.name,
				label: host.name.charAt(0).toUpperCase() + host.name.slice(1),
				install_profile: host.profile,
				install_scope: "local",
				target_dir: hostDir,
				runtime_dir_name: "emb-agent",
			},
			null,
			2,
		) + "\n",
	);

	// Deploy host-specific extension (if scaffold exists)
	const extScaffoldDir = path.join(
		RUNTIME_SRC, "scaffolds", "shells", host.dir, "extensions",
	);
	if (fs.existsSync(extScaffoldDir)) {
		const extDir = path.join(hostDir, "extensions");
		ensureDir(extDir);
		const extSrc = path.join(extScaffoldDir, "emb-agent.ts");
		if (fs.existsSync(extSrc)) {
			fs.copyFileSync(extSrc, path.join(extDir, "emb-agent.ts"));
			console.log(`    Extension deployed to ${host.dir}/extensions/`);
		}
	}

	// Deploy shared skill
	const skillScaffoldDir = path.join(RUNTIME_SRC, "scaffolds", "skills", "emb-agent");
	if (fs.existsSync(skillScaffoldDir)) {
		const skillDir = path.join(hostDir, "skills", "emb-agent");
		ensureDir(skillDir);
		const skillSrc = path.join(skillScaffoldDir, "SKILL.md");
		if (fs.existsSync(skillSrc)) {
			fs.copyFileSync(skillSrc, path.join(skillDir, "SKILL.md"));
			console.log(`    Skill deployed to ${host.dir}/skills/emb-agent/`);
		}
	}

	// Deploy host-specific config files (hooks.json, settings.json)
	const hostShellDir = path.join(RUNTIME_SRC, "scaffolds", "shells", host.dir);
	const configFiles = ["hooks.json", "settings.json"];
	for (const cfg of configFiles) {
		const cfgSrc = path.join(hostShellDir, cfg);
		if (fs.existsSync(cfgSrc)) {
			fs.copyFileSync(cfgSrc, path.join(hostDir, cfg));
			console.log(`    ${cfg} deployed to ${host.dir}/`);
		}
	}

	// Deploy Cursor custom commands (only for cursor host)
	if (host.dir === ".cursor") {
		const cmdScaffoldDir = path.join(hostShellDir, "commands");
		if (fs.existsSync(cmdScaffoldDir)) {
			const cmdDir = path.join(hostDir, "commands");
			ensureDir(cmdDir);
			copyDir(cmdScaffoldDir, cmdDir);
			console.log("    Commands deployed to .cursor/commands/");
		}
	}
}

function main(argv) {
	const args = parseArgs(argv);

	if (args.help) {
		usage();
		return;
	}

	const projectRoot = process.cwd();
	console.log(`emb-agent v${VERSION}`);
	console.log(`Project: ${projectRoot}\n`);

	if (args.target === "all") {
		for (const host of SUPPORTED_HOSTS) {
			installForHost(projectRoot, host);
		}
	} else if (args.target) {
		const host = SUPPORTED_HOSTS.find((h) => h.name === args.target);
		if (!host) {
			console.error(`Unknown host: ${args.target}`);
			console.error(
				`Supported: ${SUPPORTED_HOSTS.map((h) => h.name).join(", ")}, all`,
			);
			process.exit(1);
		}
		installForHost(projectRoot, host);
	} else {
		// Interactive mode - default to pi
		console.log("No --target specified, defaulting to pi\n");
		const host = SUPPORTED_HOSTS.find((h) => h.name === "pi");
		installForHost(projectRoot, host);
	}

	console.log("\nDone. emb-agent is now installed for your AI runtime.");
}

module.exports = { main, installForHost, SUPPORTED_HOSTS };

if (require.main === module) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(`emb-agent install error: ${error.message}`);
		process.exit(1);
	}
}
