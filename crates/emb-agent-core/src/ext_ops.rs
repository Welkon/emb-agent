use crate::hardware::project::validate_truth_files;
use crate::json::json_quote;
use std::fs;
use std::path::Path;

const PROJECT_TEMPLATE_VERSION: &str = env!("CARGO_PKG_VERSION");
const CODEX_AVAILABLE_AGENTS: [&str; 7] = [
    "hw-scout",
    "researcher",
    "fw-doer",
    "bug-hunter",
    "arch-reviewer",
    "sys-reviewer",
    "release-checker",
];

/// Initialize a new emb-agent project
pub fn init_project(cwd: &Path) -> String {
    let ext_dir = cwd.join(".emb-agent");
    let project_json = ext_dir.join("project.json");
    if project_json.exists() {
        let env = crate::lookup::ensure_project_env(cwd);
        ensure_default_config(&ext_dir);
        ensure_project_contract_files(&ext_dir);
        return serde_json::json!({
            "status": "ok",
            "initialized": true,
            "reason": "already initialized",
            "env": {
                "env_path": env.env_path,
                "env_example_path": env.env_example_path,
                "env_created": env.env_created,
                "env_example_created": env.env_example_created,
                "required_key": "MINERU_API_KEY",
                "key_present": env.key_present
            }
        })
        .to_string();
    }
    let _ = crate::lookup::ensure_project_env(cwd);

    let _ = fs::create_dir_all(&ext_dir);
    let _ = fs::create_dir_all(ext_dir.join("tasks"));
    let _ = fs::create_dir_all(cwd.join("firmware").join("src"));
    let _ = fs::create_dir_all(cwd.join("firmware").join("include"));
    ensure_default_config(&ext_dir);
    ensure_project_contract_files(&ext_dir);
    let project = serde_json::json!({
        "project_profile": "",
        "active_specs": ["embedded-space"],
        "packages": [{"name":"firmware","path":"firmware","type":"firmware","submodule":false}],
        "default_package": "firmware",
        "active_package": "firmware",
        "flash_flow": "",
        "developer": {"name": "", "runtime": ""},
        "preferences": {"truth_source_mode": "hardware_first"},
        "firmware_framework": {
            "official_mode": "event-step",
            "control_contract": "sample-update-apply",
            "execution_backend": "project-selects-baremetal-or-rtos",
            "legacy_project_policy": "grandfather-existing-layouts-do-not-rewrite-by-default"
        },
        "hooks": {},
        "integrations": {
            "doc_ingest": {
                "provider": "auto",
                "local_tool_priority": ["markitdown", "pdftotext", "mutool"]
            },
            "mineru": {
                "mode": "api",
                "base_url": "https://mineru.net",
                "api_key": "",
                "api_key_env": "MINERU_API_KEY",
                "model_version": "vlm",
                "language": "ch",
                "enable_table": true,
                "is_ocr": false,
                "enable_formula": true,
                "poll_interval_ms": 3000,
                "timeout_ms": 300000
            }
        }
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
    // Create docs/prd/system.md skeleton and tasks directory
    let prd_dir = cwd.join("docs").join("prd");
    let _ = fs::create_dir_all(&prd_dir);
    let _ = fs::create_dir_all(prd_dir.join("tasks"));
    let system_prd_path = prd_dir.join("system.md");
    if !system_prd_path.exists() {
        let system_prd = "\
# System PRD\n\
\n\
> Fill this during requirement exploration. Unknown items should be explored with the user, not guessed.\n\
\n\
## Product Overview\n\
\n\
## Firmware Shape\n\
\n\
- Official framework: event-step\n\
- Contract: ISR only captures hardware events or fixed scan work; one top-level app step owns a stable sample -> update -> apply order; the execution backend may be a bare-metal base tick or an RTOS task/timer, but the control contract stays the same.\n\
- Power/reset note: watchdog servicing, sleep entry/wake policy, and reset/config-bit dependencies must be named explicitly instead of being implied by the scheduler choice.\n\
- Legacy note: existing projects may keep older layouts until a deliberate migration is approved.\n\
\n\
## Behaviors\n\
\n\
## Constraints\n\
\n\
## Acceptance Evidence\n\
\n\
## Failure / Power / Reset\n\
\n\
## Unknowns\n\
";
        let _ = fs::write(&system_prd_path, system_prd);
    }
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
    let _ = fs::write(ext_dir.join("ARCHITECTURE.md"), arch_md);

    let shared_conventions = "\
## Shared Conventions

### Truth Placement Map

| Information | Primary location |
|---|---|
| Boot-time traps, active priorities, environment blockers | `.emb-agent/attention.md` |
| MCU/package/pins/peripherals/clock/board facts | `.emb-agent/hw.yaml` |
| Product behavior, constraints, acceptance, unknowns | `.emb-agent/req.yaml` and `docs/prd/` |
| Reusable task-specific research | `.emb-agent/tasks/<task>/research/<topic>.md` |
| Reusable traps/tricks/decisions/learnings/explorations | `.emb-agent/compound/` |
| Current module map, data flow, ISR routing, peripheral ownership | `.emb-agent/ARCHITECTURE.md` |
| Long-form source synthesis and human-readable notes | `.emb-agent/wiki/` |
| Machine query index | `.emb-agent/graph/` |
| Session-local continuity | `.emb-agent/memory/` |
| Human-readable session history | `.emb-agent/workspace/` |
| Machine hook event journal | `.emb-agent/sessions/` |
| Install logs, backups, version metadata | `.emb-agent/.install/` |

Most directories are created lazily when their feature first writes data. A fresh
install creates the top-level workspace journal index, while per-developer
journals are created when the first session record or finish-work entry is
written.

### Stage Gates

- Onboard → Work: user confirms empty/partial/migration path and any migrated facts.
- Issue Report → Analyze: user confirms report accuracy.
- Issue Analyze → Fix: user confirms root cause and fix approach.
- Issue Fix → Close: user confirms fix verification.
- Knowledge capture: user confirms compound entries before writing.

### Terminology Discipline

Before introducing a new term, check code, `.emb-agent/ARCHITECTURE.md`, and `.emb-agent/compound/` for conflicts.
";
    let knowledge_evolution = "\
## Knowledge Evolution

Promote a lesson only if it is repeatable AND (expensive OR not-visible-in-code).

Record to:
- `.emb-agent/compound/` for learn/trick/decision/trap/explore entries.
- `.emb-agent/attention.md` only for boot-time blockers and traps.
- `.emb-agent/ARCHITECTURE.md` for current module/peripheral/ISR ownership.

Do not record generic programming knowledge or facts obvious from code and datasheets.
";
    append_workflow_section(&ext_dir, "## Shared Conventions", shared_conventions);
    append_workflow_section(&ext_dir, "## Knowledge Evolution", knowledge_evolution);
    ensure_gitignore_entry(cwd, ".emb-agent/sessions/");

    // Create and auto-complete bootstrap task
    let bootstrap_dir = ext_dir.join("tasks").join("00-bootstrap-project");
    let _ = fs::create_dir_all(&bootstrap_dir);
    let now = crate::task::task_ops::chrono_now();
    let truth_validation_errors = validate_truth_files(cwd);
    let truth_validation_status = if truth_validation_errors.is_empty() {
        "ok"
    } else {
        "error"
    };
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
            "prd": "docs/prd/system.md",
            "validation": {
                "command": "validate",
                "status": truth_validation_status,
                "errors": truth_validation_errors.clone()
            },
            "aar": ".emb-agent/tasks/00-bootstrap-project/aar.md"
        },
        "context": {
            "implement": [],
            "check": [{
                "command": "validate",
                "status": truth_validation_status,
                "errors": truth_validation_errors.clone()
            }],
            "debug": []
        },
        "aar": {
            "scan_completed": true,
            "record_required": false,
            "record_completed": true,
            "updated_at": &now,
            "note": "Bootstrap auto-complete recorded no durable lessons; project truth validation was run during init."
        },
        "injected_specs": []
    });
    let _ = fs::write(
        bootstrap_dir.join("task.json"),
        serde_json::to_string_pretty(&bootstrap_task).unwrap_or_default(),
    );
    let _ = fs::write(
        bootstrap_dir.join("aar.md"),
        format!(
            "# AAR: 00-bootstrap-project\n\nScan completed during bootstrap auto-complete. No durable lessons were recorded. Validation status: {}.\n",
            truth_validation_status
        ),
    );

    serde_json::json!({
        "status": "ok",
        "initialized": true,
        "truth_validation": {
            "status": truth_validation_status,
            "errors": truth_validation_errors
        }
    })
    .to_string()
}

fn ensure_project_contract_files(ext_dir: &Path) {
    let _ = fs::write(
        ext_dir.join(".version"),
        format!("{PROJECT_TEMPLATE_VERSION}\n"),
    );
    if !ext_dir.join(".developer").exists() {
        let _ = fs::write(ext_dir.join(".developer"), "{\"name\":\"\"}\n");
    }
    if !ext_dir.join(".language").exists() {
        let _ = fs::write(ext_dir.join(".language"), "\n");
    }
    let hashes = serde_json::json!({
        "template_version": PROJECT_TEMPLATE_VERSION,
        "templates": {
            "workflow.md": template_hash(default_workflow_md()),
            ".language": "language-preference-v1",
            "ARCHITECTURE.md": "embedded-architecture-v1",
            "attention.md": "project-attention-v1",
            "project.json": "project-config-v1",
            "hw.yaml": "hardware-truth-v1",
            "req.yaml": "requirements-truth-v1",
            "workspace/index.md": "workspace-index-v1"
        }
    });
    let _ = fs::write(
        ext_dir.join(".template-hashes"),
        serde_json::to_string_pretty(&hashes).unwrap_or_default() + "\n",
    );
    let workflow_path = ext_dir.join("workflow.md");
    if !workflow_path.exists() {
        let _ = fs::write(workflow_path, default_workflow_md());
    }
    ensure_workspace_index(ext_dir);
}

fn ensure_workspace_index(ext_dir: &Path) {
    let workspace_dir = ext_dir.join("workspace");
    let index_path = workspace_dir.join("index.md");
    let _ = fs::create_dir_all(&workspace_dir);
    if index_path.exists() {
        return;
    }
    let _ = fs::write(
        index_path,
        "\
# Workspace Index

> Workspace Journal records for AI-assisted embedded firmware work across developers.

---

## Overview

This directory tracks human-readable session records for continuing project work across AI host sessions.
Machine hook events remain in `.emb-agent/sessions/`.

### File Structure

```text
workspace/
|-- index.md              # This file - main index
+-- {developer}/          # Per-developer directory
    |-- index.md          # Personal index with session history
    +-- journal-N.md      # Sequential journal files
```

---

## Active Developers

| Developer | Last Active | Sessions | Active File |
|---|---|---:|---|
| None yet | - | 0 | - |

---

## Getting Started

### For New Developers

Set the developer identity during install or write `.emb-agent/.developer`, then record the first session with:

```bash
node .<host>/emb-agent/bin/emb-agent.cjs session record --title \"...\" --summary \"...\"
```

This creates your developer directory, personal index, and first journal lazily.

### For Returning Developers

Read `.emb-agent/workspace/index.md`, then open your personal index under `.emb-agent/workspace/<developer>/index.md`.

## Guidelines

- Keep journal entries human-readable and focused on what changed, what was verified, and what should happen next.
- Record durable session continuity with `session record` or `finish-work`; raw hook events belong in `.emb-agent/sessions/`.
- Create a new `journal-N.md` automatically when the configured journal line limit is reached.

## Session Template

```markdown
## Session {N}: {Title}

**Date**: YYYY-MM-DD
**Task**: {task-name}
**Package**: `{package}`
**Branch**: `{branch-name}`

### Summary

{One-line summary}

### Main Changes

- {Change 1}
- {Change 2}

### Git Commits

| Hash | Message |
|------|---------|
| `abc1234` | {commit message} |

### Testing

- [OK] {Test result}

### Status

[OK] **Completed** / [~] **In Progress** / [!] **Blocked**

### Next Steps

- {Next step 1}
- {Next step 2}
```
",
    );
}

fn default_workflow_md() -> &'static str {
    "\
# emb-agent Workflow

This directory is project-local state. Keep the top level small:

| Path | Purpose |
|---|---|
| `.developer` | Local developer identity used for agent context |
| `.language` | Preferred response language (`zh`, `en`, or blank for host default) |
| `.template-hashes` | Managed template fingerprints for repair/update |
| `.version` | emb-agent project template/runtime version |
| `config.yaml` | Local emb-agent configuration and hook settings |
| `workflow.md` | Human-readable workflow, layout, and conventions |
| `project.json` | Package/profile metadata |
| `hw.yaml` | Hardware truth: MCU, package, pins, clock, board facts |
| `req.yaml` | Product behavior, constraints, acceptance, unknowns |
| `attention.md` | Current blockers, traps, priorities, environment notes |
| `ARCHITECTURE.md` | Current module/peripheral/ISR ownership map |
| `tasks/` | Active task records plus `archive/YYYY-MM/` completed task history |
| `workspace/` | Human-readable session history: `index.md` plus per-developer journals |
| `.install/` | Installer logs, backups, version state, install result |

Feature directories such as `cache/`, `graph/`, `wiki/`, `compound/`,
`memory/`, `sessions/`, `specs/`, and `plugins/` are created
only when the matching command or installer option needs them.

## Main Flow

Host-visible commands are intentionally small:

1. `/emb-start` loads or refreshes project context and routes onboarding when needed.
2. `/emb-next` continues from the current runtime gate.
3. `/emb-finish-work` records the workspace journal, resolves the active task, and archives it under `tasks/archive/YYYY-MM/`.

Internal runtime commands (`onboard`, `ingest`, `knowledge`, `task`, `scan`,
`plan`, `do`, `review`, `verify`) are tools used when the current gate asks for
that specific work.

[workflow-state:concept]
The project is still in concept/onboarding mode. Do not implement yet. Gather
hardware/product truth, ingest schematics or manuals when they are the source of
truth, update `hw.yaml`/`req.yaml`/`docs/prd/system.md`, then rerun `/emb-next`.
[/workflow-state:concept]

[workflow-state:clarifying]
The system PRD or requirements are not stable enough for execution. Run the
main-session brainstorm contract: inspect repository evidence before asking,
ask one load-bearing behavior, hardware, power, product-risk, or acceptance
question at a time with your recommended answer and trade-off, update the
system PRD or task PRD plus `req.yaml` after each confirmation, and stop before
task activation until the gate changes. Complex tasks should have durable
`design.md`, `implement.md`, and `research/<topic>.md` notes before
implementation when external SDK/toolchain/API evidence is load-bearing.
[/workflow-state:clarifying]

[workflow-state:ready]
The project has enough truth to choose work. Use `/emb-next` to present existing
tasks or PRD-derived candidates. Create or activate a task only when the user
confirms the concrete target and acceptance surface.
[/workflow-state:ready]

[workflow-state:task_active]
An active task exists. Keep reads scoped to the task PRD, hardware/requirement
truth, and directly affected source/build files. Main-session default: when the
host exposes a subagent/delegation tool, dispatch `researcher` first for missing
SDK/toolchain/API evidence, then a focused implementation worker, then an
independent release/system checker; subagents must not spawn more subagents.
The parent session coordinates, synthesizes hidden results, writes closure docs,
and triggers `/emb-finish-work` after verification so the runtime resolves and
archives the active task.
Inline implementation is only the fallback for narrow work or hosts without a
subagent surface.
[/workflow-state:task_active]
"
}

fn append_workflow_section(ext_dir: &Path, marker: &str, section: &str) {
    let path = ext_dir.join("workflow.md");
    let mut content = fs::read_to_string(&path).unwrap_or_default();
    if content.contains(marker) {
        return;
    }
    if !content.ends_with('\n') {
        content.push('\n');
    }
    content.push('\n');
    content.push_str(section.trim());
    content.push('\n');
    let _ = fs::write(path, content);
}

fn template_hash(source: &str) -> String {
    let mut hash: u32 = 2166136261;
    for byte in source.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:08x}")
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

fn install_state_path(cwd: &Path, name: &str) -> std::path::PathBuf {
    cwd.join(".emb-agent").join(".install").join(name)
}

fn read_project_language(cwd: &Path) -> String {
    fs::read_to_string(cwd.join(".emb-agent").join(".language"))
        .or_else(|_| fs::read_to_string(install_state_path(cwd, "language")))
        .unwrap_or_default()
}

fn read_project_runtime_version(cwd: &Path) -> String {
    let path = install_state_path(cwd, "runtime-version.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return fs::read_to_string(cwd.join(".emb-agent").join("runtime-version.json"))
            .ok()
            .and_then(|raw| {
                serde_json::from_str::<serde_json::Value>(&raw)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("version")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                    })
            })
            .unwrap_or_default();
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

fn hooks_config_has_runtime_entries(host_dir: &Path, host: &str) -> bool {
    let hooks = fs::read_to_string(host_dir.join("hooks.json")).unwrap_or_default();
    let codex_guard_ok = host != "codex" || hooks.contains("hook tool-guard --host codex");
    let codex_workflow_ok = host != "codex" || hooks.contains("UserPromptSubmit");
    !hooks.contains("{{")
        && hooks.contains(&format!("hook session-start --host {host}"))
        && hooks.contains(&format!("hook context-monitor --host {host}"))
        && codex_guard_ok
        && codex_workflow_ok
        && hooks.contains("ApplyPatch")
}

fn canonical_host_commands() -> [&'static str; 3] {
    ["emb-start", "emb-next", "emb-finish-work"]
}

fn canonical_command_files_exist(dir: &Path) -> bool {
    canonical_host_commands()
        .iter()
        .all(|name| dir.join(format!("{name}.md")).exists())
}

fn canonical_codex_skills_exist(root: &Path) -> bool {
    canonical_host_commands().iter().all(|name| {
        root.join(".agents")
            .join("skills")
            .join(name)
            .join("SKILL.md")
            .exists()
    })
}

pub fn install_doctor(cwd: &Path, host: &str) -> String {
    let host = host.trim();
    let hosts: Vec<String> = if host.is_empty() || host == "all" {
        // Read installed-host list from runtime-version.json, falling back to all known hosts
        let rv_path = install_state_path(cwd, "runtime-version.json");
        let legacy_rv_path = cwd.join(".emb-agent").join("runtime-version.json");
        let installed_hosts: Vec<String> = fs::read_to_string(&rv_path)
            .or_else(|_| fs::read_to_string(&legacy_rv_path))
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| {
                v.get("hosts").and_then(|h| h.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|entry| {
                            entry.get("name").and_then(|n| n.as_str()).map(String::from)
                        })
                        .collect()
                })
            })
            .unwrap_or_default();
        if installed_hosts.is_empty() {
            // Fall back to checking all known hosts when no install record exists
            vec![
                "codex".into(),
                "cursor".into(),
                "claude".into(),
                "pi".into(),
                "windsurf".into(),
            ]
        } else {
            installed_hosts
        }
    } else {
        vec![host.to_string()]
    };
    let expected_runtime_version = read_project_runtime_version(cwd);

    let truth_validation_errors = validate_truth_files(cwd);

    let mut checks = Vec::new();
    let language = read_project_language(cwd).trim().to_string();
    for item in &hosts {
        let item_str = item.as_str();
        let dir = match item_str {
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
        let (surface, commands_ok, host_config_ok) = match item_str {
            "omp" | "pi" => (
                "extension",
                host_dir.join("extensions").join("emb-agent.ts").exists(),
                true,
            ),
            "codex" => (
                "codex-skills",
                canonical_codex_skills_exist(cwd),
                hooks_config_has_runtime_entries(&host_dir, "codex")
                    && host_dir
                        .join("skills")
                        .join("emb-agent")
                        .join("SKILL.md")
                        .exists(),
            ),
            "cursor" => (
                "cursor-command-files",
                canonical_command_files_exist(&host_dir.join("commands")),
                hooks_config_has_runtime_entries(&host_dir, "cursor")
                    && host_dir
                        .join("rules")
                        .join("emb-agent-workflow.mdc")
                        .exists()
                    && host_dir
                        .join("skills")
                        .join("emb-agent")
                        .join("SKILL.md")
                        .exists(),
            ),
            "windsurf" => (
                "windsurf-workflows",
                canonical_command_files_exist(&host_dir.join("workflows")),
                true,
            ),
            _ => (
                "command-files",
                canonical_command_files_exist(&host_dir.join("commands")),
                true,
            ),
        };
        let stale_candidates = [
            host_dir.join("commands").join("next.md"),
            host_dir.join("commands").join("onboard.md"),
            host_dir.join("commands").join("emb-onboard.md"),
            host_dir.join("commands").join("emb-ingest.md"),
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
        let ok = runtime_ok
            && commands_ok
            && host_config_ok
            && stale.is_empty()
            && version_status != "stale";
        let codex_dispatch = if item_str == "codex" {
            codex_dispatch_doctor(cwd)
        } else {
            serde_json::Value::Null
        };
        let hook_readiness = host_hook_readiness(item_str, &host_dir, &runtime_dir, runtime_ok);
        checks.push(serde_json::json!({
            "host": item_str,
            "status": if ok { "ok" } else { "warn" },
            "runtime_dir": runtime_dir.to_string_lossy(),
            "runtime_ok": runtime_ok,
            "installed_version": installed_version,
            "expected_version": if expected_runtime_version.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(expected_runtime_version.clone()) },
            "version_status": version_status,
            "surface": surface,
            "commands": canonical_host_commands(),
            "commands_ok": commands_ok,
            "host_config_ok": host_config_ok,
            "hook_readiness": hook_readiness,
            "codex_dispatch": codex_dispatch,
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
        "next": "Use emb-start to load or repair context, emb-next to continue, and emb-finish-work after verification so the runtime records the journal, resolves the active task, and archives it. Run the manual update command when any host reports version_status=stale."
    }))
    .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
}

fn host_hook_readiness(
    host: &str,
    host_dir: &Path,
    runtime_dir: &Path,
    runtime_ok: bool,
) -> serde_json::Value {
    let hooks_path = host_dir.join("hooks.json");
    let has_hooks_file = hooks_path.exists();
    let hooks_text = fs::read_to_string(&hooks_path).unwrap_or_default();
    let required: Vec<&str> = match host {
        "codex" => vec![
            "hook session-start --host codex",
            "hook context-monitor --host codex",
            "hook tool-guard --host codex",
            "ApplyPatch",
        ],
        "cursor" => vec![
            "hook session-start --host cursor",
            "hook context-monitor --host cursor",
            "ApplyPatch",
        ],
        _ => Vec::new(),
    };
    let missing: Vec<String> = required
        .iter()
        .filter(|needle| !hooks_text.contains(**needle))
        .map(|needle| needle.to_string())
        .collect();
    let configured = required.is_empty() || (has_hooks_file && missing.is_empty());
    let rust_binary = runtime_dir.join("bin").join(if cfg!(windows) {
        "emb-agent-rs.exe"
    } else {
        "emb-agent-rs"
    });
    let mut next_steps = Vec::new();
    if !runtime_ok {
        next_steps.push("Run emb-agent repair/update for this host; runtime files are missing.");
    }
    if !configured && (host == "codex" || host == "cursor") {
        next_steps.push("Re-run emb-agent repair --target <host> to refresh hooks.json.");
    }
    if host == "codex" {
        next_steps
            .push("In Codex, run /hooks and trust pending project hooks after install or repair.");
        next_steps.push("If hooks never fire, verify hooks are enabled in ~/.codex/config.toml.");
    }
    if host == "cursor" {
        next_steps.push("Reload the Cursor window after hook or command updates.");
    }
    serde_json::json!({
        "status": if runtime_ok && configured { "ok" } else { "warn" },
        "hooks_file": hooks_path.to_string_lossy(),
        "hooks_file_exists": has_hooks_file,
        "runtime_binary_exists": rust_binary.exists(),
        "required_markers": required,
        "missing_markers": missing,
        "diagnostics_command": format!(
            "node {}/bin/emb-agent.cjs diagnostics hooks --host {} --runtime-dir {}",
            runtime_dir.to_string_lossy(),
            host,
            runtime_dir.to_string_lossy()
        ),
        "next_steps": next_steps
    })
}

fn codex_dispatch_doctor(cwd: &Path) -> serde_json::Value {
    let mode = config_scalar(
        &cwd.join(".emb-agent").join("config.yaml"),
        "codex",
        "dispatch_mode",
    )
    .unwrap_or_else(|| "inline".to_string());
    let normalized = match mode.as_str() {
        "auto" => "auto",
        "sub-agent" | "sub_agent" | "subagent" => "sub-agent",
        _ => "inline",
    };
    serde_json::json!({
        "mode": normalized,
        "auto_dispatch_enabled": normalized == "auto",
        "forced_subagent_enabled": normalized == "sub-agent",
        "inline_fallback_allowed": normalized != "sub-agent",
        "host_subagent_surface": "native-codex-explicit-subagent-workflow",
        "available_agents": CODEX_AVAILABLE_AGENTS,
        "change_config": "Set .emb-agent/config.yaml codex.dispatch_mode to inline, auto, or sub-agent."
    })
}

fn ensure_default_config(ext_dir: &Path) {
    let config_path = ext_dir.join("config.yaml");
    if !config_path.exists() {
        let _ = fs::write(&config_path, default_config_yaml());
        return;
    }
    let Ok(text) = fs::read_to_string(&config_path) else {
        return;
    };
    let mut updated = text.clone();
    if updated.lines().any(|line| line.trim() == "hooks:") {
        let mut hook_lines = Vec::new();
        if !updated
            .lines()
            .any(|line| line.trim_start().starts_with("session_start:"))
        {
            hook_lines.push("  session_start: []");
        }
        if !updated
            .lines()
            .any(|line| line.trim_start().starts_with("session_end:"))
        {
            hook_lines.push("  session_end: []");
        }
        for hook in [
            "session_compact",
            "before_agent_turn",
            "after_agent_turn",
            "before_tool",
            "after_tool",
        ] {
            if !updated
                .lines()
                .any(|line| line.trim_start().starts_with(&format!("{hook}:")))
            {
                hook_lines.push(match hook {
                    "session_compact" => "  session_compact: []",
                    "before_agent_turn" => "  before_agent_turn: []",
                    "after_agent_turn" => "  after_agent_turn: []",
                    "before_tool" => "  before_tool: []",
                    _ => "  after_tool: []",
                });
            }
        }
        if !hook_lines.is_empty() {
            updated = updated.replace("hooks:\n", &format!("hooks:\n{}\n", hook_lines.join("\n")));
        }
    }
    if !updated.lines().any(|line| line.trim() == "codex:") {
        updated.push_str("\n\ncodex:\n  dispatch_mode: inline  # inline | auto | sub-agent\n");
    }
    if updated != text {
        let _ = fs::write(&config_path, updated);
    }
}

fn default_config_yaml() -> &'static str {
    "# emb-agent project configuration\n\
# All keys are local-only. Hooks run on this machine and never upload session data.\n\
\n\
session_commit_message: \"chore: record emb-agent session\"\n\
max_journal_lines: 2000\n\
session_auto_commit: false\n\
\n\
hooks:\n\
  session_start: []\n\
  session_end: []\n\
  session_compact: []\n\
  before_agent_turn: []\n\
  after_agent_turn: []\n\
  before_tool: []\n\
  after_tool: []\n\
  after_create: []\n\
  after_start: []\n\
  after_finish: []\n\
  after_archive: []\n\
\n\
channel:\n\
  worker_guard:\n\
    idle_timeout: 5m\n\
    max_live_workers: 6\n\
\n\
codex:\n\
  dispatch_mode: inline  # inline | auto | sub-agent\n"
}

/// Migration status. The current Rust runtime does not require a separate project migration step.
pub fn migrate_status(_ext_dir: &Path) -> String {
    r#"{"status":"ok","migration_required":false,"runtime":"rust"}"#.to_string()
}

/// Onboard handoff. The runtime keeps this intentionally small: the host-facing
/// entry is emb-start; the internal onboard action owns repo audit, user
/// confirmation, and fact extraction.
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
        "recommended_agent": "emb-start",
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
        "instructions": "Continue the onboarding route from emb-start. Audit existing hardware/product evidence, choose empty/partial/migration path, ask the listed questions, never move user files without confirmation, then stop and route back to next --brief.",
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
    let hosts = ["codex", "cursor", "claude", "pi", "windsurf"];
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
            "{{\"status\":\"ok\",\"capability\":{},\"next\":{},\"next_instructions\":\"Run `node .<host>/emb-agent/bin/emb-agent.cjs {}` to execute this capability.\"}}",
            json_quote(name),
            json_quote(name),
            name
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
        "{{\"status\":\"unsupported\",\"error\":{{\"code\":\"not-implemented\",\"message\":\"Executor framework not yet migrated to Rust\"}},\"executor\":{}}}",
        json_quote(name)
    )
}
/// Legacy ext_ops ingest doc entry. Real parsing lives in the top-level `ingest doc` CLI.
pub fn ingest_doc(_ext_dir: &Path, file: &str, kind: &str) -> String {
    format!(
        "{{\"status\":\"error\",\"error\":{{\"code\":\"use-top-level-ingest-doc\",\"message\":\"Use the top-level command: ingest doc --file <path> --provider auto --kind <kind> --to hardware\"}},\"requested\":{{\"file\":{},\"kind\":{}}}}}",
        json_quote(file),
        json_quote(kind)
    )
}
/// Support/adapter status
pub fn support_status(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Chip support source management not yet implemented"},"sources":[]}"#
        .to_string()
}
/// Dispatch orchestrate
pub fn dispatch_orchestrate(ext_dir: &Path, job: &str) -> String {
    let mode = config_scalar(&ext_dir.join("config.yaml"), "codex", "dispatch_mode")
        .unwrap_or_else(|| "inline".to_string());
    let normalized = match mode.as_str() {
        "auto" => "auto",
        "sub-agent" | "sub_agent" | "subagent" => "sub-agent",
        _ => "inline",
    };
    let plan = codex_dispatch_plan(normalized, job);
    serde_json::json!({
        "status": "ok",
        "job": job,
        "codex": {"dispatch_mode": normalized},
        "dispatch": plan
    })
    .to_string()
}

fn codex_dispatch_plan(mode: &str, job: &str) -> serde_json::Value {
    let recommended = match mode {
        "sub-agent" => true,
        "auto" => codex_auto_dispatch_recommended(job),
        _ => false,
    };
    let primary_agent = codex_worker_agent_for_job(job);
    let post_check_required = recommended && codex_post_check_recommended(job);
    let mut subagent_sequence = Vec::new();
    if recommended {
        if let Some(preflight_agent) = codex_research_preflight_agent_for_job(job) {
            if preflight_agent != primary_agent {
                subagent_sequence.push(preflight_agent);
            }
        }
    }
    subagent_sequence.push(primary_agent);
    if post_check_required && !subagent_sequence.contains(&"release-checker") {
        subagent_sequence.push("release-checker");
    }
    let sequence_prompt = subagent_sequence
        .iter()
        .map(|agent| format!("`{agent}`"))
        .collect::<Vec<_>>()
        .join(" -> ");
    let subagent_prompt = if recommended {
        serde_json::json!({
            "agent": primary_agent,
            "agents": subagent_sequence.clone(),
            "task": job,
            "prompt": if mode == "sub-agent" {
                format!(
                    "Spawn emb-agent subagents in this order: {}. Wait for each to finish, then summarize the result with file references. If `researcher` runs, it must persist reusable findings to `.emb-agent/tasks/<task>/research/<topic>.md` when a target task exists or report that no durable research path was provided. Each child is already an emb-agent subagent and must not recursively delegate.\n\nJob: {}",
                    sequence_prompt,
                    job
                )
            } else {
                format!(
                    "For this emb-agent job, prefer native Codex subagents when the current work is broad, high-risk, research-heavy, or implementation plus review. Spawn emb-agent subagents in this order when available: {}. Wait for each to finish, then summarize with file references. If `researcher` runs, it must persist reusable findings to `.emb-agent/tasks/<task>/research/<topic>.md` when a target task exists or report that no durable research path was provided. Inline fallback is allowed only for narrow scoped work or unavailable subagent surfaces. Children must not recursively delegate.\n\nJob: {}",
                    sequence_prompt,
                    job
                )
            }
        })
    } else {
        serde_json::Value::Null
    };
    serde_json::json!({
        "mode": mode,
        "inline_allowed": mode != "sub-agent",
        "subagent_allowed": mode != "inline",
        "subagent_required": mode == "sub-agent",
        "subagent_recommended": recommended,
        "post_check_required": post_check_required,
        "subagent_sequence": subagent_sequence,
        "auto_reason": codex_auto_dispatch_reason(job),
        "trigger_policy": "inline mode keeps the main Codex agent direct; auto mode recommends native subagents for broad/high-risk or research-heavy work with inline fallback; sub-agent mode requires native subagent dispatch when the host exposes it.",
        "available_agents": CODEX_AVAILABLE_AGENTS,
        "subagent_prompt": subagent_prompt
    })
}

fn codex_auto_dispatch_recommended(job: &str) -> bool {
    let lower = job.to_ascii_lowercase();
    [
        "implement",
        "refactor",
        "review",
        "verify",
        "debug",
        "bug",
        "power",
        "sleep",
        "watchdog",
        "lvd",
        "toolchain",
        "sdk",
        "research",
        "investigate",
        "feasibility",
        "vendor",
        "datasheet",
        "manual",
        "documentation",
        "docs",
        "api",
        "library",
        "example",
        "sample",
        "migration",
        "multi",
        "framework",
        "architecture",
        "driver",
        "peripheral",
        "实现",
        "重构",
        "评审",
        "验证",
        "调试",
        "缺陷",
        "低功耗",
        "睡眠",
        "看门狗",
        "架构",
        "驱动",
        "外设",
        "研究",
        "调研",
        "可行性",
        "供应商",
        "文档",
        "接口",
        "库",
        "示例",
        "迁移",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn codex_post_check_recommended(job: &str) -> bool {
    let lower = job.to_ascii_lowercase();
    [
        "implement",
        "refactor",
        "fix",
        "change",
        "write",
        "edit",
        "driver",
        "framework",
        "toolchain",
        "实现",
        "修复",
        "改",
        "写",
        "重构",
        "驱动",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn codex_auto_dispatch_reason(job: &str) -> &'static str {
    if codex_research_terms(job) {
        "research_heavy_or_external_context_work"
    } else if codex_auto_dispatch_recommended(job) {
        "broad_or_high_risk_embedded_work"
    } else {
        "narrow_or_unspecified_work"
    }
}

fn codex_worker_agent_for_job(job: &str) -> &'static str {
    let lower = job.to_ascii_lowercase();
    let implementation_work = codex_implementation_terms(job);
    if lower.contains("verify") || lower.contains("验证") || lower.contains("release") {
        "release-checker"
    } else if lower.contains("review") || lower.contains("architecture") || lower.contains("评审")
    {
        "sys-reviewer"
    } else if lower.contains("bug") || lower.contains("debug") {
        "bug-hunter"
    } else if lower.contains("hardware")
        || lower.contains("schematic")
        || lower.contains("register")
    {
        "hw-scout"
    } else if codex_research_terms(job) && !implementation_work {
        "researcher"
    } else {
        "fw-doer"
    }
}

fn codex_research_preflight_agent_for_job(job: &str) -> Option<&'static str> {
    if codex_research_terms(job) && !codex_hardware_truth_terms(job) {
        Some("researcher")
    } else {
        None
    }
}

fn codex_hardware_truth_terms(job: &str) -> bool {
    let lower = job.to_ascii_lowercase();
    [
        "hardware",
        "schematic",
        "register",
        "pinout",
        "pin map",
        "pcb",
        "datasheet",
        "manual",
        "硬件",
        "原理图",
        "寄存器",
        "引脚",
        "手册",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn codex_implementation_terms(job: &str) -> bool {
    let lower = job.to_ascii_lowercase();
    [
        "implement",
        "refactor",
        "fix",
        "change",
        "write",
        "edit",
        "driver",
        "firmware",
        "实现",
        "修复",
        "改",
        "写",
        "重构",
        "驱动",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn codex_research_terms(job: &str) -> bool {
    let lower = job.to_ascii_lowercase();
    [
        "research",
        "investigate",
        "feasibility",
        "external",
        "vendor",
        "sdk",
        "api",
        "library",
        "example",
        "sample",
        "toolchain",
        "migration",
        "documentation",
        "docs",
        "protocol",
        "compatibility",
        "调研",
        "研究",
        "可行性",
        "外部",
        "供应商",
        "接口",
        "库",
        "示例",
        "工具链",
        "迁移",
        "文档",
        "协议",
        "兼容",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn config_scalar(config_path: &Path, section: &str, key: &str) -> Option<String> {
    let text = fs::read_to_string(config_path).ok()?;
    let mut current = "";
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("");
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && trimmed.ends_with(':') {
            current = trimmed.trim_end_matches(':');
            continue;
        }
        if current == section
            && let Some((k, v)) = trimmed.split_once(':')
            && k.trim() == key
        {
            return Some(v.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}
/// Scaffold generate
pub fn scaffold_generate(_ext_dir: &Path, _name: &str) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Scaffolding not yet implemented"}}"#.to_string()
}
/// Transcript show
pub fn transcript_show(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Transcript generation not yet implemented"}}"#.to_string()
}

/// Prefs show
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
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Tool execution not yet implemented"}}"#.to_string()
}

/// Snippet draft
pub fn snippet_draft(_ext_dir: &Path, _title: &str) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Snippet management not yet implemented"}}"#.to_string()
}

/// Workflow status
pub fn workflow_status(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Workflow management not yet implemented"}}"#
        .to_string()
}

/// Orchestrate status
pub fn orchestrate_status(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Orchestration not yet implemented"}}"#.to_string()
}

/// Insight show
pub fn insight_show(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Insights not yet implemented"}}"#.to_string()
}

/// Trace show
pub fn trace_show(_ext_dir: &Path) -> String {
    r#"{"status":"unsupported","error":{"code":"not-implemented","message":"Tracing not yet implemented"}}"#.to_string()
}
