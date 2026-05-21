#!/usr/bin/env node

/**
 * Downloads the matching Rust binary for this platform from GitHub Releases.
 *
 * Skip with: EMB_AGENT_SKIP_RUST_DOWNLOAD=1
 * Force repo: EMB_AGENT_REPO=owner/name
 *
 * Failures are non-fatal: the Node fallback remains available.
 * Can be required from installer to cover npx (which skips postinstall).
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const REPO_DEFAULT = "Welkon/emb-agent";

function downloadRustBinary(pkgDir) {
	if (process.env.EMB_AGENT_SKIP_RUST_DOWNLOAD) {
		console.log(
			"[emb-agent] Rust binary download skipped (EMB_AGENT_SKIP_RUST_DOWNLOAD set)",
		);
		return;
	}

	const platform = process.platform;
	const arch = process.arch;
	const exeName = platform === "win32" ? "emb-agent-rs.exe" : "emb-agent-rs";
	const destDir = path.join(pkgDir, "bin");
	const dest = path.join(destDir, exeName);

	// Already downloaded — skip
	if (fs.existsSync(dest)) {
		return;
	}

	const artifact = artifactName(platform, arch);
	if (!artifact) {
		console.log(
			`[emb-agent] No Rust binary for ${platform}/${arch}; Node fallback will be used.`,
		);
		return;
	}

	const pkg = JSON.parse(
		fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
	);
	const version = pkg.version;
	const repo = process.env.EMB_AGENT_REPO || REPO_DEFAULT;
	const url = `https://github.com/${repo}/releases/download/v${version}/${artifact}`;
	const tmpDest = path.join(destDir, artifact);

	console.log(
		`[emb-agent] Downloading Rust binary v${version} for ${platform}/${arch}...`,
	);

	try {
		fs.mkdirSync(destDir, { recursive: true });
	} catch (err) {
		console.warn(`[emb-agent] Could not create bin directory: ${err.message}`);
		return;
	}

	download(url, tmpDest, (err) => {
		if (err) {
			console.warn(`[emb-agent] Rust binary download failed: ${err.message}`);
			console.warn(
				"[emb-agent] Node fallback will be used. Re-run npm install to retry.",
			);
			cleanup(tmpDest);
			return;
		}

		// Rename to canonical name (emb-agent-rs / emb-agent-rs.exe)
		try {
			fs.renameSync(tmpDest, dest);
		} catch (renameErr) {
			console.warn(`[emb-agent] Could not rename binary: ${renameErr.message}`);
			cleanup(tmpDest);
			return;
		}

		// On unix, make it executable
		if (platform !== "win32") {
			try {
				fs.chmodSync(dest, 0o755);
			} catch {
				// non-fatal
			}
		}

		console.log(
			`[emb-agent] Rust binary installed: ${path.relative(pkgDir, dest)}`,
		);
	});
}

function artifactName(platform, arch) {
	const map = {
		"linux-x64": "emb-agent-rs-linux-x64",
		"linux-arm64": "emb-agent-rs-linux-arm64",
		"darwin-x64": "emb-agent-rs-macos-x64",
		"darwin-arm64": "emb-agent-rs-macos-arm64",
		"win32-x64": "emb-agent-rs-windows-x64.exe",
	};
	return map[`${platform}-${arch}`] || null;
}

function download(url, dest, cb) {
	const file = fs.createWriteStream(dest);
	let redirected = false;

	function handleResponse(res) {
		// Follow redirects (one level)
		if (!redirected && (res.statusCode === 301 || res.statusCode === 302)) {
			redirected = true;
			https.get(res.headers.location, handleResponse).on("error", cb);
			return;
		}

		if (res.statusCode !== 200) {
			cb(new Error(`HTTP ${res.statusCode}`));
			return;
		}

		res.pipe(file);
		file.on("finish", () => {
			file.close(cb);
		});
	}

	file.on("error", (err) => {
		fs.unlink(dest, () => cb(err));
	});

	const req = https.get(url, handleResponse);
	req.on("error", (err) => {
		fs.unlink(dest, () => cb(err));
	});
	req.setTimeout(30_000, () => {
		req.destroy(new Error("Download timed out after 30s"));
	});
}

function cleanup(dest) {
	try {
		fs.unlinkSync(dest);
	} catch {
		/* ignore */
	}
}

if (require.main === module) {
  downloadRustBinary(path.resolve(__dirname, ".."));
}

module.exports = { downloadRustBinary };
