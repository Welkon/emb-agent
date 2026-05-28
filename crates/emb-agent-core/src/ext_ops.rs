use crate::hardware::project::validate_truth_files;
use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Initialize a new emb-agent project
pub fn init_project(cwd: &Path) -> String {
    let ext_dir = cwd.join(".emb-agent");
    let project_json = ext_dir.join("project.json");
    if project_json.exists() {
        return r#"{"status":"ok","initialized":false,"reason":"already initialized"}"#.to_string();
    }

    let _ = fs::create_dir_all(&ext_dir);
    let _ = fs::create_dir_all(ext_dir.join("tasks"));
    let _ = fs::create_dir_all(ext_dir.join("specs"));
    let _ = fs::create_dir_all(ext_dir.join("cache").join("docs"));
    let _ = fs::create_dir_all(ext_dir.join("graph"));
    let _ = fs::create_dir_all(ext_dir.join("wiki"));
    let _ = fs::create_dir_all(ext_dir.join("memory"));
    let _ = fs::create_dir_all(ext_dir.join("state"));
    let _ = fs::create_dir_all(ext_dir.join("sessions"));
    let _ = fs::create_dir_all(ext_dir.join("compound"));
    let _ = fs::create_dir_all(ext_dir.join("architecture"));
    let _ = fs::create_dir_all(ext_dir.join("reference"));
    let _ = fs::create_dir_all(ext_dir.join("chips"));
    let _ = fs::create_dir_all(ext_dir.join("issues"));
    let _ = fs::create_dir_all(ext_dir.join("refactors"));
    let _ = fs::create_dir_all(ext_dir.join("roadmap"));
    let _ = fs::create_dir_all(ext_dir.join("audits"));
    let _ = fs::create_dir_all(ext_dir.join("extensions").join("chips").join("profiles"));

    // Write minimal project.json
    let project = serde_json::json!({
        "project_profile": "",
        "active_specs": ["embedded-space"],
        "packages": [],
        "default_package": "",
        "active_package": "",
        "flash_flow": "",
        "developer": {"name": "", "email": ""},
        "preferences": {"truth_source_mode": "hardware_first"},
        "hooks": {}
    });
    let _ = fs::write(
        &project_json,
        serde_json::to_string_pretty(&project).unwrap_or_default(),
    );

    // Write empty hw.yaml and req.yaml
    let _ = fs::write(
        ext_dir.join("hw.yaml"),
        "# Hardware truth\nmodel: \"\"\npackage: \"\"\n",
    );
    let _ = fs::write(ext_dir.join("req.yaml"), "# Requirements\n");

    // Write attention.md skeleton
    let attention_md = "\
# Project Attention

> emb-agent agents read this file at session start. Add entries with `emb note --text \"...\" [--section X]`.

## Hardware Traps & Quirks

## Build & Compile

## Test & Verify

## Paths & Directories

## Environment & Credentials

## Current Priorities

## Known Traps
";
    let _ = fs::write(ext_dir.join("attention.md"), attention_md);

    // Write ARCHITECTURE.md skeleton
    let arch_md = "\
# Architecture

> System architecture map — current state, not future plans. Update after feature acceptance.

## Module Map
| Module | Responsibility | Owns (Peripherals) | Depends On |
|--------|---------------|---------------------|------------|

## Data Flow

## Interrupt Routing
| ISR | Vector | Priority | Handler Module | Shared State |
|-----|--------|----------|----------------|--------------|

## Peripheral Ownership
| Peripheral | Instance | Owner Module | Rationale |
|------------|----------|-------------|-----------|

## Key Architecture Decisions
| Decision | Date | Rationale | Alternatives Considered |
|----------|------|-----------|------------------------|
";
    let _ = fs::write(
        ext_dir.join("architecture").join("ARCHITECTURE.md"),
        arch_md,
    );

    let shared_conventions = "\
# emb-agent Shared Conventions

## Truth Placement Map

| Information | Primary location |
|---|---|
| Boot-time traps, active priorities, environment blockers | `.emb-agent/attention.md` |
| MCU/package/pins/peripherals/clock/board facts | `.emb-agent/hw.yaml` |
| Product behavior, constraints, acceptance, unknowns | `.emb-agent/req.yaml` and `docs/prd/` |
| Reusable traps/tricks/decisions/learnings/explorations | `.emb-agent/compound/` |
| Current module map, data flow, ISR routing, peripheral ownership | `.emb-agent/architecture/` |
| Long-form source synthesis and human-readable notes | `.emb-agent/wiki/` |
| Machine query index | `.emb-agent/graph/` |
| Session-local continuity | `.emb-agent/memory/` and `.emb-agent/sessions/` |

## Stage Gates

- Onboard → Work: user confirms empty/partial/migration path and any migrated facts.
- Issue Report → Analyze: user confirms report accuracy.
- Issue Analyze → Fix: user confirms root cause and fix approach.
- Issue Fix → Close: user confirms fix verification.
- Knowledge capture: user confirms compound entries before writing.

## Terminology Discipline

Before introducing a new term, check code, `.emb-agent/architecture/`, and `.emb-agent/compound/` for conflicts.
";
    let _ = fs::write(
        ext_dir.join("reference").join("shared-conventions.md"),
        shared_conventions,
    );
    let knowledge_evolution = "\
# Knowledge Evolution

Promote a lesson only if it is repeatable AND (expensive OR not-visible-in-code).

Record to:
- `.emb-agent/compound/` for learn/trick/decision/trap/explore entries.
- `.emb-agent/attention.md` only for boot-time blockers and traps.
- `.emb-agent/architecture/` for current module/peripheral/ISR ownership.

Do not record generic programming knowledge or facts obvious from code and datasheets.
";
    let _ = fs::write(
        ext_dir.join("reference").join("knowledge-evolution.md"),
        knowledge_evolution,
    );
    ensure_gitignore_entry(cwd, ".emb-agent/sessions/");

    // Create and auto-complete bootstrap task
    let bootstrap_dir = ext_dir.join("tasks").join("00-bootstrap-project");
    let _ = fs::create_dir_all(&bootstrap_dir);
    let now = crate::task::task_ops::chrono_now();
    let bootstrap_task = serde_json::json!({
        "id": format!("{}-00-bootstrap-project", now.split('T').next().unwrap_or("init")),
        "name": "00-bootstrap-project",
        "title": "Bootstrap project notes",
        "description": "Review project truth files and set up project infrastructure",
        "status": "completed",
        "dev_type": "embedded",
        "scope": "init",
        "package": "",
        "priority": "P1",
        "creator": "",
        "assignee": "",
        "createdAt": &now,
        "completedAt": &now,
        "deletedAt": null,
        "branch": "",
        "base_branch": "",
        "worktree_path": null,
        "current_phase": 0,
        "next_action": [],
        "commit": "",
        "pr_url": "",
        "pr": {"status": ""},
        "artifacts": {
            "prd": "docs/prd/system.md"
        },
        "context": {
            "implement": [],
            "check": [],
            "debug": []
        },
        "injected_specs": []
    });
    let _ = fs::write(
        bootstrap_dir.join("task.json"),
        serde_json::to_string_pretty(&bootstrap_task).unwrap_or_default(),
    );

    r#"{"status":"ok","initialized":true}"#.to_string()
}

fn ensure_gitignore_entry(project_root: &Path, entry: &str) {
    let path = project_root.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == entry) {
        return;
    }
    let mut updated = existing.trim_end().to_string();
    if !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str(entry);
    updated.push('\n');
    let _ = fs::write(path, updated);
}
fn read_project_runtime_version(cwd: &Path) -> String {
    let path = cwd.join(".emb-agent").join("runtime-version.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return String::new();
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| {
            value
                .get("version")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn read_host_runtime_version(runtime_dir: &Path) -> String {
    fs::read_to_string(runtime_dir.join("VERSION"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn manual_update_command() -> &'static str {
    "npx emb-agent@latest update --target all --local"
}

pub fn install_doctor(cwd: &Path, host: &str) -> String {
    let host = host.trim();
    let hosts: Vec<&str> = if host.is_empty() || host == "all" {
        vec!["codex", "cursor", "claude", "pi", "omp", "windsurf"]
    } else {
        vec![host]
    };
    let expected_runtime_version = read_project_runtime_version(cwd);

    let truth_validation_errors = validate_truth_files(cwd);

    let mut checks = Vec::new();
    let language = fs::read_to_string(cwd.join(".emb-agent").join(".language"))
        .unwrap_or_default()
        .trim()
        .to_string();
    for item in hosts {
        let dir = match item {
            "codex" => ".codex",
            "cursor" => ".cursor",
            "claude" => ".claude",
            "pi" => ".pi",
            "omp" => ".omp",
            "windsurf" => ".windsurf",
            other => other,
        };
        let host_dir = cwd.join(dir);
        let runtime_dir = host_dir.join("emb-agent");
        let bin_name = if cfg!(windows) {
            "emb-agent-rs.exe"
        } else {
            "emb-agent-rs"
        };
        let runtime_ok = runtime_dir.join("bin").join("emb-agent.cjs").exists()
            && runtime_dir.join("bin").join(bin_name).exists();
        let (surface, commands_ok) = match item {
            "omp" | "pi" => (
                "extension",
                host_dir.join("extensions").join("emb-agent.ts").exists(),
            ),
            "codex" => (
                "codex-skills",
                cwd.join(".agents")
                    .join("skills")
                    .join("emb-next")
                    .join("SKILL.md")
                    .exists()
                    && cwd
                        .join(".agents")
                        .join("skills")
                        .join("emb-onboard")
                        .join("SKILL.md")
                        .exists(),
            ),
            "windsurf" => (
                "windsurf-workflows",
                host_dir.join("workflows").join("emb-next.md").exists()
                    && host_dir.join("workflows").join("emb-onboard.md").exists(),
            ),
            _ => (
                "command-files",
                host_dir.join("commands").join("emb-next.md").exists()
                    && host_dir.join("commands").join("emb-onboard.md").exists(),
            ),
        };
        let stale_candidates = [
            host_dir.join("commands").join("next.md"),
            host_dir.join("commands").join("onboard.md"),
            host_dir.join("commands").join("emb-status.md"),
            host_dir.join("commands").join("emb-scan.md"),
            host_dir.join("commands").join("emb-init.md"),
        ];
        let stale: Vec<String> = stale_candidates
            .iter()
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        let installed_version = read_host_runtime_version(&runtime_dir);
        let version_status = if expected_runtime_version.is_empty() || installed_version.is_empty()
        {
            "unknown"
        } else if installed_version == expected_runtime_version {
            "ok"
        } else {
            "stale"
        };
        let ok = runtime_ok && commands_ok && stale.is_empty() && version_status != "stale";
        checks.push(serde_json::json!({
            "host": item,
            "status": if ok { "ok" } else { "warn" },
            "runtime_dir": runtime_dir.to_string_lossy(),
            "runtime_ok": runtime_ok,
            "installed_version": installed_version,
            "expected_version": if expected_runtime_version.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(expected_runtime_version.clone()) },
            "version_status": version_status,
            "surface": surface,
            "commands": ["emb-next", "emb-onboard"],
            "commands_ok": commands_ok,
            "stale_files": stale,
            "manual_update_command": manual_update_command()
        }));
    }
    let truth_ok = truth_validation_errors.is_empty();
    let ok = checks.iter().all(|check| check["status"] == "ok") && truth_ok;
    serde_json::to_string_pretty(&serde_json::json!({
        "status": if ok { "ok" } else { "warn" },
        "version": if expected_runtime_version.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(expected_runtime_version) },
        "project_root": cwd.to_string_lossy(),
        "language": language,
        "manual_update_command": manual_update_command(),
        "truth_validation": {
            "status": if truth_ok { "ok" } else { "error" },
            "errors": truth_validation_errors
        },
        "hosts": checks,
        "next": "Use emb-next for initialized projects or emb-onboard for new/migrated projects. Run the manual update command when any host reports version_status=stale."
    }))
    .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
}

/// Migration status. The current Rust runtime does not require a separate project migration step.
pub fn migrate_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","migration_required":false,"runtime":"rust"}"#.to_string()
}

/// Onboard handoff. The runtime keeps this intentionally small: emb-onboard owns
/// repo audit, user confirmation, and fact extraction.
pub fn onboard_status(cwd: &Path) -> String {
    let ext_dir = cwd.join(".emb-agent");
    let initialized = ext_dir.join("project.json").exists();
    let has_hw = ext_dir.join("hw.yaml").exists();
    let has_req = ext_dir.join("req.yaml").exists();
    let has_attention = ext_dir.join("attention.md").exists();
    let path = if !initialized {
        "empty-or-migration"
    } else if !has_hw || !has_req || !has_attention {
        "partial"
    } else {
        "review-existing"
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "status": "ok",
        "action": "onboard",
        "recommended_agent": "emb-onboard",
        "path": path,
        "initialized": initialized,
        "has_hw": has_hw,
        "has_req": has_req,
        "has_attention": has_attention,
        "questions": [
            "Is this an empty project, an existing firmware project, or a migration from scattered notes?",
            "Is the MCU/package already confirmed? If not, keep it unknown and record constraints first.",
            "Where are schematics, datasheets, pin maps, build files, and product requirements located?",
            "May emb-agent write .emb-agent/hw.yaml, .emb-agent/req.yaml, and docs/prd/system.md after confirmation?"
        ],
        "instructions": "Invoke emb-onboard. Audit existing hardware/product evidence, choose empty/partial/migration path, ask the listed questions, never move user files without confirmation, then stop and route back to next --brief.",
        "next": { "command": "next --brief" }
    }))
    .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
}

/// Skills status. Legacy skill scaffolding is host-owned; runtime skills are command docs and agents.
pub fn skills_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","skills_runtime":"host","note":"Skills are provided by installed host command docs and agents"}"#.to_string()
}

/// Local update status. The host wrapper performs remote npm checks when invoked through node.
pub fn update_check(ext_dir: &Path) -> String {
    let project_root = ext_dir.parent().unwrap_or(Path::new("."));
    let expected = read_project_runtime_version(project_root);
    let hosts = ["codex", "cursor", "claude", "pi", "omp", "windsurf"];
    let mut host_versions = Vec::new();
    for host in hosts {
        let dir = match host {
            "codex" => ".codex",
            "cursor" => ".cursor",
            "claude" => ".claude",
            "pi" => ".pi",
            "omp" => ".omp",
            "windsurf" => ".windsurf",
            _ => host,
        };
        let runtime_dir = project_root.join(dir).join("emb-agent");
        let installed = read_host_runtime_version(&runtime_dir);
        let stale = !expected.is_empty() && !installed.is_empty() && installed != expected;
        host_versions.push(serde_json::json!({
            "host": host,
            "installed_version": if installed.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(installed.clone()) },
            "expected_version": if expected.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(expected.clone()) },
            "version_status": if stale { "stale" } else if installed.is_empty() { "missing" } else if expected.is_empty() { "unknown" } else { "ok" }
        }));
    }
    let update_available = host_versions
        .iter()
        .any(|host| host["version_status"] == "stale");
    serde_json::to_string_pretty(&serde_json::json!({
        "status": "ok",
        "installed_version": if expected.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(expected) },
        "update_available": update_available,
        "latest_version": serde_json::Value::Null,
        "latest_status": "not-checked-by-rust-runtime",
        "hosts": host_versions,
        "manual_update_command": manual_update_command(),
        "note": "Run the manual update command from the project root to refresh managed host runtimes. The node wrapper checks npm for the latest package version."
    })).unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
}

/// Settings show
pub fn settings_show(ext_dir: &Path) -> String {
    let project_path = ext_dir.join("project.json");
    if !project_path.exists() {
        return r#"{"status":"error","error":{"code":"not-initialized","message":"Project not initialized"}}"#.to_string();
    }
    let content = fs::read_to_string(&project_path).unwrap_or_default();
    format!("{{\"status\":\"ok\",\"settings\":{}}}", content.trim())
}

/// Decision status
pub fn decision_status(ext_dir: &Path) -> String {
    let decisions_dir = ext_dir.join("wiki").join("decisions");
    let count = if decisions_dir.exists() {
        fs::read_dir(&decisions_dir)
            .map(|d| d.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };
    format!("{{\"status\":\"ok\",\"decisions\":{}}}", count)
}

/// List available commands
pub fn commands_list(show_all: bool) -> String {
    let commands: &[&str] = if show_all {
        &[
            "start next status health pause resume onboard",
            "task list show add activate resolve aar scan/record/status bug add/list/resolve",
            "variant list status adopt create use fork diff",
            "workspace list status create use fork diff (alias)",
            "chip diff swap",
            "scan plan do review verify debug",
            "prd status doc list knowledge status session show context show",
            "bootstrap status declare hardware",
            "init update check settings show decision status commands list",
            "note add show memory remember list",
            "capability run executor run",
            "hook session-start statusline context-monitor statusline",
            "diagnostics hooks project state-paths",
        ]
    } else {
        &[
            "start: onboard, next --brief, start --brief, health",
            "work: task, scan, plan, do, debug, review, verify, decision",
            "evidence: ingest, schematic, knowledge, support",
            "advanced: init/init-project, bootstrap, board, commands list --all",
        ]
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "status": "ok",
        "commands": commands,
        "note": if show_all { "Full implementation/debugging inventory." } else { "Guided summary only; installed host runtime command docs remain available under .<host>/emb-agent/commands/emb/. Use `commands list --all` for implementation/debugging inventory." }
    }))
    .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
}

/// Note add
pub fn note_add(ext_dir: &Path, text: &str) -> String {
    let notes_dir = ext_dir.join("state").join("notes");
    let _ = fs::create_dir_all(&notes_dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("note-{}.md", ts);
    let _ = fs::write(notes_dir.join(&filename), text);
    format!(
        "{{\"status\":\"ok\",\"note\":{},\"saved\":true}}",
        json_quote(&filename)
    )
}

/// Note show (latest)
pub fn note_show(ext_dir: &Path) -> String {
    let notes_dir = ext_dir.join("state").join("notes");
    if !notes_dir.exists() {
        return r#"{"status":"ok","notes":[],"count":0}"#.to_string();
    }
    let mut notes: Vec<String> = fs::read_dir(&notes_dir)
        .map(|d| {
            d.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|ext| ext == "md").unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    notes.sort();
    notes.reverse();
    let count = notes.len();
    let listed: Vec<String> = notes.iter().map(|n| format!("\"{}\"", n)).collect();
    format!(
        "{{\"status\":\"ok\",\"notes\":[{}],\"count\":{}}}",
        listed.join(","),
        count
    )
}

/// Memory remember
pub fn memory_remember(ext_dir: &Path, summary: &str) -> String {
    let mem_dir = ext_dir.join("state").join("memory");
    let _ = fs::create_dir_all(&mem_dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let entry = serde_json::json!({
        "timestamp": ts,
        "summary": summary,
        "type": "user"
    });
    let filename = format!("mem-{}.json", ts);
    let _ = fs::write(
        mem_dir.join(&filename),
        serde_json::to_string_pretty(&entry).unwrap_or_default(),
    );
    format!(
        "{{\"status\":\"ok\",\"remembered\":true,\"entry\":{}}}",
        json_quote(&filename)
    )
}

/// Memory list
pub fn memory_list(ext_dir: &Path) -> String {
    let mem_dir = ext_dir.join("state").join("memory");
    if !mem_dir.exists() {
        return r#"{"status":"ok","entries":[],"count":0}"#.to_string();
    }
    let mut entries: Vec<String> = fs::read_dir(&mem_dir)
        .map(|d| {
            d.filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "json")
                        .unwrap_or(false)
                })
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    let count = entries.len();
    let listed: Vec<String> = entries.iter().map(|n| format!("\"{}\"", n)).collect();
    format!(
        "{{\"status\":\"ok\",\"entries\":[{}],\"count\":{}}}",
        listed.join(","),
        count
    )
}

/// Settings set (simple key-value)
pub fn settings_set(ext_dir: &Path, key: &str, value: &str) -> String {
    let project_path = ext_dir.join("project.json");
    if !project_path.exists() {
        return r#"{"status":"error","error":{"code":"not-initialized"}}"#.to_string();
    }
    let content = fs::read_to_string(&project_path).unwrap_or_default();
    let mut proj: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    if let Some(obj) = proj.as_object_mut() {
        obj.insert(
            key.to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    let _ = fs::write(
        &project_path,
        serde_json::to_string_pretty(&proj).unwrap_or_default(),
    );
    format!(
        "{{\"status\":\"ok\",\"set\":true,\"key\":{},\"value\":{}}}",
        json_quote(key),
        json_quote(value)
    )
}

/// Capability run (delegates to action commands)
pub fn capability_run(_ext_dir: &Path, name: &str) -> String {
    let valid = ["scan", "plan", "do", "review", "verify", "debug"];
    if valid.contains(&name) {
        format!(
            "{{\"status\":\"ok\",\"capability\":{},\"next\":{},\"next_instructions\":\"Trigger the slash command for this capability; do not run emb-agent-rs through bash.\"}}",
            json_quote(name),
            json_quote(&format!("/emb:{name}"))
        )
    } else {
        format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"unknown-capability\",\"message\":\"Unknown capability: {}\"}}}}",
            name
        )
    }
}

/// Executor run
pub fn executor_run(_ext_dir: &Path, name: &str) -> String {
    format!(
        "{{\"status\":\"ok\",\"executor\":{},\"note\":\"Executor framework not yet migrated to Rust\"}}",
        json_quote(name)
    )
}

/// Ingest doc (registers PDF in cache index)
pub fn ingest_doc(ext_dir: &Path, file: &str, kind: &str) -> String {
    let cache_dir = ext_dir.join("cache").join("docs");
    let _ = fs::create_dir_all(&cache_dir);
    let index_path = cache_dir.join("index.json");

    let mut index: serde_json::Value = if index_path.exists() {
        let content = fs::read_to_string(&index_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        serde_json::json!({"documents": []})
    };

    // Generate doc ID from file path hash
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    file.hash(&mut hasher);
    let doc_id = format!("{:016x}", hasher.finish());

    let doc_dir = cache_dir.join(&doc_id);
    let _ = fs::create_dir_all(&doc_dir);

    let entry = serde_json::json!({
        "doc_id": doc_id,
        "title": std::path::Path::new(file).file_name().unwrap_or_default().to_string_lossy(),
        "source": file,
        "kind": kind,
        "parsed": false
    });

    if let Some(docs) = index.get_mut("documents").and_then(|d| d.as_array_mut()) {
        docs.push(entry);
    }
    let _ = fs::write(
        &index_path,
        serde_json::to_string_pretty(&index).unwrap_or_default(),
    );

    format!(
        "{{\"status\":\"ok\",\"ingested\":true,\"doc_id\":{},\"note\":\"MinerU parsing not yet in Rust. Use Node runtime for full ingestion.\"}}",
        json_quote(&doc_id)
    )
}

/// Support/adapter status
pub fn support_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","sources":[],"note":"Chip support source management not yet in Rust"}"#
        .to_string()
}

/// Dispatch orchestrate
pub fn dispatch_orchestrate(_ext_dir: &Path, _job: &str) -> String {
    r#"{"status":"ok","note":"Dispatch orchestration not yet in Rust"}"#.to_string()
}

/// Scaffold generate
pub fn scaffold_generate(_ext_dir: &Path, _name: &str) -> String {
    r#"{"status":"ok","note":"Scaffolding not yet in Rust"}"#.to_string()
}

/// Transcript show
pub fn transcript_show(_ext_dir: &Path) -> String {
    r#"{"status":"ok","note":"Transcript generation not yet in Rust"}"#.to_string()
}

/// Prefs show/set
pub fn prefs_show(ext_dir: &Path) -> String {
    let project_path = ext_dir.join("project.json");
    if !project_path.exists() {
        return r#"{"status":"ok","prefs":{"truth_source_mode":"hardware_first"}}"#.to_string();
    }
    let content = fs::read_to_string(&project_path).unwrap_or_default();
    let proj: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    let prefs = proj
        .get("preferences")
        .cloned()
        .unwrap_or(serde_json::json!({"truth_source_mode":"hardware_first"}));
    format!(
        "{{\"status\":\"ok\",\"prefs\":{}}}",
        serde_json::to_string(&prefs).unwrap_or_default()
    )
}

/// Tool run
pub fn tool_run(_ext_dir: &Path, _name: &str) -> String {
    r#"{"status":"ok","note":"Tool execution not yet in Rust"}"#.to_string()
}

/// Snippet draft
pub fn snippet_draft(_ext_dir: &Path, _title: &str) -> String {
    r#"{"status":"ok","note":"Snippet management not yet in Rust"}"#.to_string()
}

/// Workflow status
pub fn workflow_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","workflow":"active","note":"Workflow management not yet in Rust"}"#
        .to_string()
}

/// Orchestrate status
pub fn orchestrate_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","note":"Orchestration not yet in Rust"}"#.to_string()
}

/// Insight show
pub fn insight_show(_ext_dir: &Path) -> String {
    r#"{"status":"ok","note":"Insights not yet in Rust"}"#.to_string()
}

/// Trace show
pub fn trace_show(_ext_dir: &Path) -> String {
    r#"{"status":"ok","note":"Tracing not yet in Rust"}"#.to_string()
}
