use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::json::json_quote;

/// Create a new task
pub fn task_add(ext_dir: &Path, summary: &str, _task_type: &str, priority: &str) -> String {
    task_add_with_deps(ext_dir, summary, _task_type, priority, &[])
}

/// Create a new task with optional dependency list
pub fn task_add_with_deps(
    ext_dir: &Path,
    summary: &str,
    task_type: &str,
    priority: &str,
    blocked_by: &[String],
) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let tasks_dir = state_dir.join("tasks");
    let _ = fs::create_dir_all(&tasks_dir);

    // Validate dependencies before creating the task
    if !blocked_by.is_empty() {
        let (_, error) = crate::task::dep_graph::validate_blocked_by(&tasks_dir, "", blocked_by);
        if let Some(err) = error {
            return format!(
                "{{\"status\":\"error\",\"error\":{{\"code\":\"blocked-by\",\"message\":{}}}}}",
                json_quote(&err)
            );
        }
    }

    // Generate a unique task name from summary
    let name = slugify_task_name(summary);
    if name.is_empty() {
        return "{\"status\":\"error\",\"error\":{\"code\":\"bad-name\",\"message\":\"Task summary must contain at least one alphanumeric character\"}}".to_string();
    }

    let task_dir = tasks_dir.join(&name);
    if task_dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"task-exists\",\"message\":\"Task already exists: {}\"}}}}",
            name
        );
    }
    let _ = fs::create_dir_all(&task_dir);

    let now = chrono_now();
    let task_id_suffix = truncate_chars(&name, 8);
    let task_id = format!(
        "{}-{}",
        now.split('T').next().unwrap_or("task"),
        task_id_suffix
    );

    let category = normalize_task_category(task_type, summary);
    let human_gated = task_needs_human_gate(&category, summary);
    let prd_path = format!("docs/prd/tasks/{}.md", name);
    let task = json!({
        "id": task_id,
        "name": name,
        "title": summary,
        "description": summary,
        "status": "pending",
        "triage_state": "needs-triage",
        "category": category.as_str(),
        "readiness": {
            "agent": "needs-agent-brief",
            "human_gate": human_gated,
            "reason": if human_gated { "Bench access, hardware judgment, part choice, schematic/layout acceptance, or external evidence may be required before AFK execution." } else { "Needs a durable agent brief with behavior, scope, acceptance, and verification before activation." }
        },
        "agent_brief": {
            "summary": summary,
            "current_behavior": "",
            "desired_behavior": "",
            "hardware_facts": [],
            "firmware_interfaces": [],
            "acceptance_criteria": [],
            "out_of_scope": [],
            "required_verification": [],
            "notes": "Fill this with behavioral contracts, not line-number instructions. Avoid stale file paths unless they are durable project artifacts such as hw.yaml, req.yaml, or a PRD."
        },
        "slice": {
            "strategy": "vertical-tracer-bullet",
            "rule": "Each task or child slice should produce one narrow but complete observable path across firmware, hardware truth, docs, and verification surfaces.",
            "blocked_by": blocked_by.to_vec(),
            "classification": if human_gated { "HITL" } else { "AFK-candidate" }
        },
        "dev_type": "embedded",
        "scope": format!("task-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()),
        "package": "",
        "priority": priority,
        "creator": "",
        "assignee": "",
        "createdAt": now,
        "completedAt": null,
        "deletedAt": null,
        "blockedBy": blocked_by.to_vec(),
        "branch": format!("task/{}", name),
        "base_branch": "",
        "worktree_path": null,
        "current_phase": 1,
        "next_action": [
            {"phase": 1, "action": "triage-brief"},
            {"phase": 2, "action": "implement"},
            {"phase": 3, "action": "check"},
            {"phase": 4, "action": "finish"},
            {"phase": 5, "action": "create-pr"}
        ],
        "commit": "",
        "pr_url": "",
        "pr": {"status": ""},
        "artifacts": {
            "prd": prd_path.clone(),
            "implement": [],
            "check": [],
            "debug": [],
            "aar": format!(".emb-agent/tasks/{}/aar.md", name)
        },
        "context": {
            "implement": [],
            "check": [],
            "debug": []
        },
        "injected_specs": []
    });

    let _ = fs::write(
        task_dir.join("task.json"),
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    let project_root = project_root_from_ext_dir(ext_dir);
    let prd_abs = project_root.join(&prd_path);
    if let Some(parent) = prd_abs.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if !prd_abs.exists() {
        let _ = fs::write(&prd_abs, task_prd_template(&name, summary, &category));
    }
    write_task_context_manifests(&task_dir, &name, &prd_path);

    format!(
        "{{\"status\":\"ok\",\"created\":true,\"task\":{{\"name\":{},\"title\":{},\"status\":\"pending\",\"priority\":{},\"category\":{},\"triage_state\":\"needs-triage\",\"human_gate\":{},\"prd\":{}}},\"task_optional\":true,\"direct_work_allowed_for\":[\"design_explanation\",\"narrow_read_only_analysis\",\"one_off_verification_run\",\"small_scoped_fix\"],\"next\":\"brainstorm contract\",\"next_instructions\":\"Task created as a durable container with a PRD artifact. Before activation, inspect project evidence, update the PRD with confirmed facts and acceptance criteria, ask one load-bearing product or risk decision at a time with a recommended answer, and keep complex design/implementation notes in task-local design.md and implement.md when needed. If the request is only a narrow explanation, one-off verification, or small scoped fix, this task can stay pending while the work proceeds directly.\",\"activation_command\":\"/emb:task activate {}\"}}",
        json_quote(&name),
        json_quote(summary),
        json_quote(priority),
        json_quote(&category),
        human_gated,
        json_quote(&prd_path),
        name
    )
}

fn write_task_context_manifests(task_dir: &Path, name: &str, prd_path: &str) {
    let examples = [
        (
            "implement.jsonl",
            "implementation",
            "Add source, SDK, design, or local research files the fw-doer must read before editing.",
        ),
        (
            "check.jsonl",
            "check",
            "Add review specs, acceptance notes, generated reports, or changed-file context for release-checker/sys-reviewer.",
        ),
        (
            "debug.jsonl",
            "debug",
            "Add reproduction logs, traces, register dumps, or failing test fixtures for bug-hunter.",
        ),
    ];
    for (file, role, guidance) in examples {
        let seed = json!({
            "_example": {
                "role": role,
                "file": prd_path,
                "reason": format!("Task PRD for {name}")
            },
            "guidance": guidance,
            "format": "One JSON object per line. Use {\"file\":\"path/to/file.md\",\"reason\":\"why\"} or {\"file\":\"path/to/dir/\",\"type\":\"directory\",\"reason\":\"why\"}. Paths are project-relative."
        });
        let path = task_dir.join(file);
        if !path.exists()
            || fs::read_to_string(&path)
                .unwrap_or_default()
                .trim()
                .is_empty()
        {
            let _ = fs::write(path, format!("{seed}\n"));
        }
    }
}

fn task_prd_template(name: &str, summary: &str, category: &str) -> String {
    format!(
        "# {}\n\n\
## Goal\n\n\
- {}\n\n\
## Confirmed Facts\n\n\
- Task: `{}`\n\
- Category: `{}`\n\n\
## Requirements\n\n\
- TODO: Capture behavior, hardware constraints, and user-visible outcome.\n\n\
## Acceptance Criteria\n\n\
- TODO: Define the observable pass/fail checks before activation.\n\n\
## Out Of Scope\n\n\
- TODO: Record boundaries that should not be implemented in this task.\n\n\
## Open Questions\n\n\
- TODO: Ask one load-bearing product, hardware, power, timing, risk, or acceptance decision at a time.\n\n\
## Evidence And Research\n\n\
- TODO: Cite project files, parsed docs, schematic evidence, session notes, or task-local research files used during planning.\n",
        summary, summary, name, category
    )
}

/// Activate a task (set as current)
pub fn task_activate(ext_dir: &Path, name: &str) -> String {
    task_activate_with_options(ext_dir, name, false)
}

/// Activate a task, optionally binding it to an isolated git worktree first.
pub fn task_activate_with_options(ext_dir: &Path, name: &str, use_worktree: bool) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let project_root = project_root_from_ext_dir(ext_dir);
    let policy =
        crate::task::worktree_policy::evaluate_worktree_policy(ext_dir, &project_root, Some(name));
    if !use_worktree && policy.decision == "required" {
        return json!({
            "status": "blocked",
            "activated": false,
            "gate": {
                "kind": "worktree-required",
                "blocking": true,
                "reason": policy.reason,
                "allowed_actions": ["trigger_task_activate_with_worktree"],
                "forbidden_actions": ["continue_in_main_workspace", "ask_user_to_run_task_activate", "run_shell_command_for_emb_slash_command"],
                "recommended_command": policy.recommended_command
            },
            "worktree_policy": crate::task::worktree_policy::worktree_policy_json(&policy),
            "next_instructions": format!("Worktree isolation is required. Trigger `/emb:task activate {} --worktree`; do not ask the user to run the command.", name)
        })
        .to_string();
    }

    let worktree_result: Option<Result<TaskWorktree, String>> = if use_worktree {
        Some(ensure_task_worktree(ext_dir, name, None, None))
    } else {
        None
    };
    if let Some(Err(err)) = &worktree_result {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"worktree-error\",\"message\":{}}}}}",
            json_quote(err)
        );
    }

    // Read task, update status
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let current_status = task
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if current_status == "deleted" {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"deleted-tombstone\",\"message\":\"Task {} is deleted and cannot be activated\"}}}}",
            name
        );
    }
    if current_status == "in_progress" {
        let current_task_file = state_dir.join(".current-task");
        let _ = fs::write(&current_task_file, name);
        let _ = crate::task::worktree_policy::set_session_active_task(
            ext_dir,
            &project_root,
            "cli",
            name,
        );
        return format!(
            "{{\"status\":\"ok\",\"activated\":false,\"already_active\":true,\"task\":{{\"name\":{},\"status\":\"in_progress\"}},\"next\":\"do\",\"next_instructions\":\"Task is already active. Use `/emb:do` for structured execution when ready, but scoped explanation or design review can still happen first.\"}}",
            json_quote(name)
        );
    }

    if let Some(obj) = task.as_object_mut() {
        let previous_status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("pending")
            .to_string();
        obj.insert("status".to_string(), json!("in_progress"));
        if previous_status == "completed" {
            obj.insert("reactivatedAt".to_string(), json!(chrono_now()));
            obj.insert("resolution_note".to_string(), Value::Null);
        }
        if let Some(Ok(worktree)) = &worktree_result {
            obj.insert("branch".to_string(), json!(worktree.branch));
            obj.insert("base_branch".to_string(), json!(worktree.base_branch));
            obj.insert("worktree_path".to_string(), json!(worktree.path));
            obj.insert(
                "worktree".to_string(),
                json!({
                    "enabled": true,
                    "path": worktree.path,
                    "branch": worktree.branch,
                    "base_branch": worktree.base_branch,
                    "status": worktree.status,
                    "dirty": worktree.dirty,
                    "reason": "local-isolation"
                }),
            );
        }
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Write current task file
    let current_task_file = state_dir.join(".current-task");
    let _ = fs::write(&current_task_file, name);
    let _ =
        crate::task::worktree_policy::set_session_active_task(ext_dir, &project_root, "cli", name);

    let worktree_json = worktree_result
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .map(worktree_to_json)
        .unwrap_or_else(|| "null".to_string());

    format!(
        "{{\"status\":\"ok\",\"activated\":true,\"task\":{{\"name\":{},\"status\":\"in_progress\"}},\"worktree\":{},\"next\":\"do\",\"next_instructions\":\"Task activated. Use `/emb:do` when you are ready for structured implementation or verification; brief refinement, explanation, or design review can still happen first.\"}}",
        json_quote(name),
        worktree_json
    )
}

/// Delete (tombstone) a task without removing its directory.
/// Sets status to "deleted" and clears .current-task if active.
pub fn task_delete(ext_dir: &Path, name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let current_status = task
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if current_status == "deleted" {
        return format!(
            "{{\"status\":\"ok\",\"deleted\":false,\"already_deleted\":true,\"task\":{{\"name\":{},\"status\":\"deleted\"}}}}",
            json_quote(name)
        );
    }

    if let Some(obj) = task.as_object_mut() {
        obj.insert("status".to_string(), json!("deleted"));
        obj.insert("deletedAt".to_string(), json!(chrono_now()));
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Clear current task if this was active
    let current_task_file = state_dir.join(".current-task");
    if fs::read_to_string(&current_task_file)
        .unwrap_or_default()
        .trim()
        == name
    {
        let _ = fs::write(&current_task_file, "");
    }
    let project_root = project_root_from_ext_dir(ext_dir);
    let _ = crate::task::worktree_policy::clear_session_active_task(ext_dir, &project_root, name);

    format!(
        "{{\"status\":\"ok\",\"deleted\":true,\"task\":{{\"name\":{},\"status\":\"deleted\"}},\"tombstone\":true,\"next\":\"next\",\"next_instructions\":\"Task tombstoned. Directory and AAR preserved. Trigger `/emb-next` for routing.\"}}",
        json_quote(name)
    )
}

/// Archive a task directory under tasks/archive/YYYY-MM/ after marking it completed.
pub fn task_archive(ext_dir: &Path, name: &str, no_commit: bool) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let tasks_dir = state_dir.join("tasks");
    let task_dir = tasks_dir.join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        if let Some(archived_path) = find_archived_task_path(&tasks_dir, name) {
            return json!({
                "status": "ok",
                "archived": false,
                "already_archived": true,
                "task": {"name": name},
                "archive": {
                    "path": archived_path.to_string_lossy(),
                    "task_json": archived_path.join("task.json").to_string_lossy()
                },
                "next": "next",
                "next_instructions": "Task is already archived. Trigger `/emb-next` for routing."
            })
            .to_string();
        }
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let current_status = task
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if current_status == "deleted" {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"deleted-tombstone\",\"message\":\"Task {} is deleted and cannot be archived\"}}}}",
            name
        );
    }

    let now = chrono_now();
    if let Some(obj) = task.as_object_mut() {
        if !matches!(
            current_status.as_ref(),
            "completed" | "done" | "resolved" | "closed"
        ) {
            obj.insert("status".to_string(), json!("completed"));
        }
        if obj
            .get("completedAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            obj.insert("completedAt".to_string(), json!(now.clone()));
        }
        obj.insert("archivedAt".to_string(), json!(now));
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    let archive_month = chrono::Local::now().format("%Y-%m").to_string();
    let archive_dir = tasks_dir.join("archive").join(&archive_month);
    if let Err(err) = fs::create_dir_all(&archive_dir) {
        return json!({
            "status": "error",
            "error": {"code": "archive-mkdir", "message": err.to_string()}
        })
        .to_string();
    }
    let archive_dest = archive_dir.join(name);
    if archive_dest.exists() {
        return json!({
            "status": "error",
            "error": {"code": "archive-exists", "message": format!("Archived task already exists: {}", archive_dest.to_string_lossy())}
        })
        .to_string();
    }
    if let Err(err) = fs::rename(&task_dir, &archive_dest) {
        return json!({
            "status": "error",
            "error": {"code": "archive-move", "message": err.to_string()}
        })
        .to_string();
    }

    let current_task_file = state_dir.join(".current-task");
    if fs::read_to_string(&current_task_file)
        .unwrap_or_default()
        .trim()
        == name
    {
        let _ = fs::write(&current_task_file, "");
    }
    let project_root = project_root_from_ext_dir(ext_dir);
    let _ = crate::task::worktree_policy::clear_session_active_task(ext_dir, &project_root, name);

    let auto_commit =
        archive_auto_commit(ext_dir, &project_root, &task_dir, &archive_dest, no_commit);
    json!({
        "status": "ok",
        "archived": true,
        "task": {"name": name, "status": "completed"},
        "archive": {
            "month": archive_month,
            "path": archive_dest.to_string_lossy(),
            "task_json": archive_dest.join("task.json").to_string_lossy()
        },
        "auto_commit": auto_commit,
        "next": "next",
        "next_instructions": "Task archived. Trigger `/emb-next` for routing."
    })
    .to_string()
}

/// Resolve (complete) a task
pub fn task_resolve(ext_dir: &Path, name: &str, note: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_dir = state_dir.join("tasks").join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let current_status = task.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if current_status == "deleted" {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"deleted-tombstone\",\"message\":\"Task {} is deleted and cannot be resolved\"}}}}",
            name
        );
    }
    if matches!(current_status, "completed" | "done" | "resolved" | "closed") {
        return format!(
            "{{\"status\":\"ok\",\"resolved\":false,\"already_completed\":true,\"task\":{{\"name\":{},\"status\":{}}},\"next\":\"next\",\"next_instructions\":\"Task is already completed. Trigger `/emb-next` for the next action.\"}}",
            json_quote(name),
            json_quote(current_status)
        );
    }

    let gate = aar_gate(&task);
    let auto_recorded_no_lessons = !gate.scan_completed;
    if gate.record_required && !gate.record_completed {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"aar-required\",\"message\":{}}},\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":{},\"record_required\":{},\"record_completed\":{}}},\"next\":{},\"next_instructions\":{}}}",
            json_quote(&gate.message),
            json_quote(name),
            gate.scan_completed,
            gate.record_required,
            gate.record_completed,
            json_quote(&gate.next),
            json_quote(&gate.instructions)
        );
    }

    if let Some(obj) = task.as_object_mut() {
        if auto_recorded_no_lessons {
            obj.insert(
                "aar".to_string(),
                json!(minimal_aar_state("resolve-auto-no-lessons")),
            );
            let _ = write_aar_markdown(
                &task_dir,
                format!(
                    "# AAR: {}\n\nResolve auto-recorded a minimal no-lessons AAR. Add a lesson later only if the task revealed a durable hardware, firmware, debugging, or workflow insight.\n",
                    name
                ),
            );
        }
        obj.insert("status".to_string(), json!("completed"));
        obj.insert("completedAt".to_string(), json!(chrono_now()));
        if !note.is_empty() {
            obj.insert("resolution_note".to_string(), json!(note));
        }
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Clear current task if this was active
    let current_task_file = state_dir.join(".current-task");
    if fs::read_to_string(&current_task_file)
        .unwrap_or_default()
        .trim()
        == name
    {
        let _ = fs::write(&current_task_file, "");
    }
    let project_root = project_root_from_ext_dir(ext_dir);
    let _ = crate::task::worktree_policy::clear_session_active_task(ext_dir, &project_root, name);

    format!(
        "{{\"status\":\"ok\",\"resolved\":true,\"task\":{{\"name\":{},\"status\":\"completed\"}},\"aar\":{{\"auto_recorded_no_lessons\":{}}},\"next\":\"next\",\"next_instructions\":{}}}",
        json_quote(name),
        auto_recorded_no_lessons,
        json_quote(if auto_recorded_no_lessons {
            "Task completed. emb-agent auto-recorded a minimal no-lessons AAR so routine work can close without extra ceremony. Trigger `/emb-next` to find the next task or action."
        } else {
            "Task completed. Trigger `/emb-next` to find the next task or action."
        })
    )
}

pub fn task_aar_status(ext_dir: &Path, name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let gate = aar_gate(&task);
    format!(
        "{{\"status\":\"ok\",\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":{},\"record_required\":{},\"record_completed\":{},\"allowed\":{},\"message\":{}}}}}",
        json_quote(name),
        gate.scan_completed,
        gate.record_required,
        gate.record_completed,
        gate.allowed,
        json_quote(&gate.message)
    )
}

pub fn task_aar_scan(ext_dir: &Path, name: &str, lessons: Option<bool>) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_dir = state_dir.join("tasks").join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    if lessons.is_none() {
        return format!(
            "{{\"status\":\"needs-answer\",\"task\":{{\"name\":{}}},\"questions\":[\"Did this task produce any durable lesson worth keeping, such as a hardware invariant, reusable firmware pattern, debugging pitfall, or project-local workflow rule?\"],\"next\":\"task aar scan\",\"next_instructions\":\"If no durable lesson emerged, you can skip explicit AAR capture and resolve directly; resolve will auto-record a minimal no-lessons AAR. If a durable lesson did emerge, trigger `/emb:task aar scan {} --lessons`; otherwise use `--no-lessons`. Do not ask the user to run the command.\"}}",
            json_quote(name),
            name
        );
    }

    let record_required = lessons.unwrap_or(false);
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert(
            "aar".to_string(),
            json!({
                "scan_completed": true,
                "record_required": record_required,
                "record_completed": !record_required,
                "updated_at": chrono_now()
            }),
        );
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );
    let body = if record_required {
        format!(
            "# AAR: {}\n\nScan completed. Lessons are present and must be recorded before resolve.\n",
            name
        )
    } else {
        format!(
            "# AAR: {}\n\nScan completed. No durable lessons were found.\n",
            name
        )
    };
    let _ = write_aar_markdown(&task_dir, body);
    format!(
        "{{\"status\":\"ok\",\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":true,\"record_required\":{},\"record_completed\":{}}},\"next\":{},\"next_instructions\":{}}}",
        json_quote(name),
        record_required,
        !record_required,
        json_quote(if record_required {
            "task aar record"
        } else {
            "task resolve"
        }),
        json_quote(if record_required {
            "Ask the user for the lesson note, then trigger `/emb:task aar record <task> <note>` before resolve. Do not ask the user to run the command."
        } else {
            "No durable lesson needs recording. Trigger `/emb:task resolve <task>` when the user confirms closure, or just resolve directly next time and let emb-agent auto-record the minimal no-lessons AAR."
        })
    )
}

pub fn task_aar_record(ext_dir: &Path, name: &str, note: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_dir = state_dir.join("tasks").join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert(
            "aar".to_string(),
            json!({
                "scan_completed": true,
                "record_required": true,
                "record_completed": true,
                "updated_at": chrono_now(),
                "note": note
            }),
        );
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );
    let aar_path = task_dir.join("aar.md");
    let existing = fs::read_to_string(&aar_path).unwrap_or_else(|_| format!("# AAR: {}\n", name));
    let updated = format!(
        "{}\n\n## Recorded Lesson ({})\n\n{}\n",
        existing.trim_end(),
        chrono_now(),
        note
    );
    let _ = write_aar_markdown(&task_dir, updated);
    format!(
        "{{\"status\":\"ok\",\"recorded\":true,\"task\":{{\"name\":{}}},\"next\":\"task resolve\",\"next_instructions\":\"AAR recorded. Trigger `/emb:task resolve {}` when the user confirms closure.\"}}",
        json_quote(name),
        name
    )
}

struct AarGate {
    allowed: bool,
    scan_completed: bool,
    record_required: bool,
    record_completed: bool,
    message: String,
    next: String,
    instructions: String,
}

fn aar_gate(task: &Value) -> AarGate {
    let aar = task.get("aar").unwrap_or(&Value::Null);
    let scan_completed = aar
        .get("scan_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let record_required = aar
        .get("record_required")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let record_completed = aar
        .get("record_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if record_required && !record_completed {
        return AarGate {
            allowed: false,
            scan_completed,
            record_required,
            record_completed,
            message: "AAR record is required because scan found lessons".to_string(),
            next: "task aar record".to_string(),
            instructions: "Ask for the lesson note, then trigger `/emb:task aar record <task> <note>` before resolve. Do not ask the user to run the command.".to_string(),
        };
    }
    if !scan_completed {
        return AarGate {
            allowed: true,
            scan_completed,
            record_required,
            record_completed,
            message: "No AAR has been captured yet. Routine tasks can resolve directly and emb-agent will auto-record a minimal no-lessons AAR; use task aar scan only when there is a durable lesson worth keeping.".to_string(),
            next: "task resolve".to_string(),
            instructions: "Resolve directly for routine work, or trigger `task aar scan` first if the task revealed a reusable lesson.".to_string(),
        };
    }
    AarGate {
        allowed: true,
        scan_completed,
        record_required,
        record_completed,
        message: "AAR state is clear".to_string(),
        next: "task resolve".to_string(),
        instructions: "No extra AAR action is required.".to_string(),
    }
}

fn minimal_aar_state(source: &str) -> Value {
    json!({
        "scan_completed": true,
        "record_required": false,
        "record_completed": true,
        "updated_at": chrono_now(),
        "source": source
    })
}

fn write_aar_markdown(task_dir: &Path, body: String) -> std::io::Result<()> {
    fs::write(task_dir.join("aar.md"), body)
}

#[derive(Debug, Clone)]
pub struct TaskWorktree {
    pub task: String,
    pub path: String,
    pub branch: String,
    pub base_branch: String,
    pub status: String,
    pub dirty: bool,
}

pub fn task_worktree_list(ext_dir: &Path) -> String {
    let tasks = crate::hardware::project::read_all_tasks(ext_dir);
    let items: Vec<String> = tasks
        .iter()
        .filter_map(|task| task_worktree_status(ext_dir, &task.name).ok())
        .map(|worktree| worktree_to_json(&worktree))
        .collect();
    format!(
        "{{\"status\":\"ok\",\"worktrees\":[{}],\"count\":{}}}",
        items.join(","),
        items.len()
    )
}

pub fn task_worktree_show(ext_dir: &Path, name: &str) -> String {
    match task_worktree_status(ext_dir, name) {
        Ok(worktree) => format!(
            "{{\"status\":\"ok\",\"worktree\":{}}}",
            worktree_to_json(&worktree)
        ),
        Err(err) => format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"worktree-status\",\"message\":{}}}}}",
            json_quote(&err)
        ),
    }
}

pub fn task_worktree_create(
    ext_dir: &Path,
    name: &str,
    branch_arg: Option<&str>,
    base_arg: Option<&str>,
) -> String {
    match ensure_task_worktree(ext_dir, name, branch_arg, base_arg) {
        Ok(worktree) => format!(
            "{{\"status\":\"ok\",\"created\":true,\"worktree\":{},\"next\":\"task activate\",\"next_instructions\":\"Worktree is ready. Ask whether to activate this task in the isolated directory now.\"}}",
            worktree_to_json(&worktree)
        ),
        Err(err) => format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"worktree-create\",\"message\":{}}}}}",
            json_quote(&err)
        ),
    }
}

pub fn task_worktree_cleanup(ext_dir: &Path, name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    if content.is_empty() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let worktree_path = task
        .get("worktree_path")
        .and_then(Value::as_str)
        .or_else(|| {
            task.get("worktree")
                .and_then(|w| w.get("path"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .to_string();

    if worktree_path.is_empty() {
        return format!(
            "{{\"status\":\"ok\",\"removed\":false,\"task\":{{\"name\":{}}},\"reason\":\"no worktree recorded\"}}",
            json_quote(name)
        );
    }

    let project_root = project_root_from_ext_dir(ext_dir);
    let remove = Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&project_root)
        .output();
    if let Ok(output) = remove
        && !output.status.success()
        && Path::new(&worktree_path).exists()
    {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"git-worktree-remove\",\"message\":{}}}}}",
            json_quote(&String::from_utf8_lossy(&output.stderr))
        );
    }

    if let Some(obj) = task.as_object_mut() {
        obj.insert("worktree_path".to_string(), Value::Null);
        obj.insert("worktree".to_string(), Value::Null);
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    format!(
        "{{\"status\":\"ok\",\"removed\":true,\"task\":{{\"name\":{}}},\"path\":{}}}",
        json_quote(name),
        json_quote(&worktree_path)
    )
}

fn ensure_task_worktree(
    ext_dir: &Path,
    name: &str,
    branch_arg: Option<&str>,
    base_arg: Option<&str>,
) -> Result<TaskWorktree, String> {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    let content = fs::read_to_string(&task_path).map_err(|_| format!("Task not found: {name}"))?;
    let mut task: Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid task.json: {e}"))?;
    let project_root = project_root_from_ext_dir(ext_dir);
    let repo_root = git_repo_root(&project_root)?;

    let branch = first_non_empty(&[
        branch_arg.unwrap_or("").to_string(),
        task.get("branch")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        format!("task/{name}"),
    ]);
    let base_branch = first_non_empty(&[
        base_arg.unwrap_or("").to_string(),
        task.get("base_branch")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        current_branch(&repo_root).unwrap_or_else(|| "HEAD".to_string()),
    ]);
    let worktree_path = task_worktree_path(&repo_root, name);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    if !worktree_path.exists() {
        if let Some(parent) = worktree_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir worktree parent: {e}"))?;
        }
        let output = Command::new("git")
            .args([
                "worktree",
                "add",
                "-B",
                &branch,
                &worktree_path_str,
                &base_branch,
            ])
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("git worktree add failed: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }

    let worktree_ext_dir = worktree_path.join(".emb-agent");
    copy_dir_merge(ext_dir, &worktree_ext_dir)
        .map_err(|e| format!("sync .emb-agent into worktree failed: {e}"))?;
    let _ = fs::write(worktree_ext_dir.join(".current-task"), name);

    let dirty = is_worktree_dirty(&worktree_path);
    let worktree = TaskWorktree {
        task: name.to_string(),
        path: worktree_path_str,
        branch: branch.clone(),
        base_branch: base_branch.clone(),
        status: "ready".to_string(),
        dirty,
    };

    if let Some(obj) = task.as_object_mut() {
        obj.insert("branch".to_string(), json!(branch));
        obj.insert("base_branch".to_string(), json!(base_branch));
        obj.insert("worktree_path".to_string(), json!(worktree.path));
        obj.insert(
            "worktree".to_string(),
            json!({
                "enabled": true,
                "path": worktree.path,
                "branch": worktree.branch,
                "base_branch": worktree.base_branch,
                "status": worktree.status,
                "dirty": worktree.dirty,
                "reason": "local-isolation"
            }),
        );
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    Ok(worktree)
}

fn task_worktree_status(ext_dir: &Path, name: &str) -> Result<TaskWorktree, String> {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    let content = fs::read_to_string(&task_path).map_err(|_| format!("Task not found: {name}"))?;
    let task: Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid task.json: {e}"))?;
    let path = task
        .get("worktree_path")
        .and_then(Value::as_str)
        .or_else(|| {
            task.get("worktree")
                .and_then(|w| w.get("path"))
                .and_then(Value::as_str)
        })
        .unwrap_or("");
    if path.is_empty() {
        return Err("No worktree recorded for this task".to_string());
    }
    Ok(TaskWorktree {
        task: name.to_string(),
        path: path.to_string(),
        branch: task
            .get("branch")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        base_branch: task
            .get("base_branch")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        status: if Path::new(path).exists() {
            "ready"
        } else {
            "missing"
        }
        .to_string(),
        dirty: is_worktree_dirty(Path::new(path)),
    })
}

fn task_worktree_path(repo_root: &Path, name: &str) -> PathBuf {
    let repo_name = repo_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo");
    let parent = repo_root.parent().unwrap_or(repo_root);
    parent
        .join(format!("{repo_name}.worktrees"))
        .join(safe_task_name(name))
}

fn project_root_from_ext_dir(ext_dir: &Path) -> PathBuf {
    ext_dir.parent().unwrap_or(ext_dir).to_path_buf()
}

fn find_archived_task_path(tasks_dir: &Path, name: &str) -> Option<PathBuf> {
    let archive_dir = tasks_dir.join("archive");
    let entries = fs::read_dir(archive_dir).ok()?;
    for entry in entries.flatten() {
        let month_dir = entry.path();
        if !month_dir.is_dir() {
            continue;
        }
        let candidate = month_dir.join(name);
        if candidate.join("task.json").exists() {
            return Some(candidate);
        }
    }
    None
}

fn archive_auto_commit(
    ext_dir: &Path,
    project_root: &Path,
    source_task_dir: &Path,
    archive_dest: &Path,
    no_commit: bool,
) -> Value {
    if no_commit {
        return json!({"enabled": false, "status": "skipped", "reason": "no-commit"});
    }
    if !config_bool(ext_dir, "session_auto_commit").unwrap_or(false) {
        return json!({"enabled": false, "status": "skipped", "reason": "session_auto_commit=false"});
    }
    if git_repo_root(project_root).is_err() {
        return json!({"enabled": true, "status": "skipped", "reason": "not-git"});
    }

    let Some(source_rel) = repo_relative(project_root, source_task_dir) else {
        return json!({"enabled": true, "status": "skipped", "reason": "source-outside-repo"});
    };
    let Some(dest_rel) = repo_relative(project_root, archive_dest) else {
        return json!({"enabled": true, "status": "skipped", "reason": "archive-outside-repo"});
    };

    let add = Command::new("git")
        .args(["add", "--", &dest_rel])
        .current_dir(project_root)
        .output();
    if let Ok(output) = add {
        if !output.status.success() {
            return json!({
                "enabled": true,
                "status": "warn",
                "reason": "git-add-failed",
                "stderr": String::from_utf8_lossy(&output.stderr).trim()
            });
        }
    } else {
        return json!({"enabled": true, "status": "warn", "reason": "git-add-spawn-failed"});
    }

    let _ = Command::new("git")
        .args([
            "rm",
            "-r",
            "--cached",
            "--ignore-unmatch",
            "--",
            &source_rel,
        ])
        .current_dir(project_root)
        .output();

    let diff = Command::new("git")
        .args(["diff", "--cached", "--quiet", "--", &source_rel, &dest_rel])
        .current_dir(project_root)
        .output();
    if let Ok(output) = diff
        && output.status.success()
    {
        return json!({"enabled": true, "status": "skipped", "reason": "nothing-staged"});
    }

    let task_name = archive_dest
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("task");
    let commit_message = format!("chore(task): archive {task_name}");
    let commit = Command::new("git")
        .args(["commit", "-m", &commit_message])
        .current_dir(project_root)
        .output();
    match commit {
        Ok(output) if output.status.success() => {
            json!({"enabled": true, "status": "committed", "message": commit_message})
        }
        Ok(output) => json!({
            "enabled": true,
            "status": "warn",
            "reason": "git-commit-failed",
            "message": commit_message,
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        }),
        Err(err) => json!({
            "enabled": true,
            "status": "warn",
            "reason": "git-commit-spawn-failed",
            "message": err.to_string()
        }),
    }
}

fn repo_relative(project_root: &Path, path: &Path) -> Option<String> {
    if let Ok(rel) = path.strip_prefix(project_root) {
        return Some(rel.to_string_lossy().replace('\\', "/"));
    }
    let root = project_root.canonicalize().ok()?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    let canonical = if absolute.exists() {
        absolute.canonicalize().ok()?
    } else if let Some(parent) = absolute.parent().filter(|parent| parent.exists()) {
        parent
            .canonicalize()
            .ok()?
            .join(absolute.file_name().unwrap_or_default())
    } else {
        path.canonicalize().ok()?
    };
    canonical
        .strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn config_bool(ext_dir: &Path, key: &str) -> Option<bool> {
    let text = fs::read_to_string(ext_dir.join("config.yaml")).ok()?;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("");
        let trimmed = line.trim();
        if trimmed.is_empty() || line.starts_with(' ') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once(':')
            && k.trim() == key
        {
            let value = v.trim().trim_matches('"').trim_matches('\'');
            return Some(matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            ));
        }
    }
    None
}

fn git_repo_root(project_root: &Path) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(project_root)
        .output()
        .map_err(|e| format!("git rev-parse failed: {e}"))?;
    if !output.status.success() {
        return Err("not inside a git repository".to_string());
    }
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

fn current_branch(repo_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(repo_root)
        .output()
        .ok()?;
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

fn copy_dir_merge(src: &Path, dest: &Path) -> std::io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy() == "sessions" {
            continue;
        }
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_merge(&src_path, &dest_path)?;
        } else {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

fn is_worktree_dirty(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .any(|line| !line.contains(".emb-agent/sessions/"))
        })
        .unwrap_or(false)
}

fn worktree_to_json(worktree: &TaskWorktree) -> String {
    format!(
        "{{\"task\":{},\"path\":{},\"branch\":{},\"base_branch\":{},\"status\":{},\"dirty\":{}}}",
        json_quote(&worktree.task),
        json_quote(&worktree.path),
        json_quote(&worktree.branch),
        json_quote(&worktree.base_branch),
        json_quote(&worktree.status),
        worktree.dirty
    )
}

fn normalize_task_category(task_type: &str, summary: &str) -> String {
    let combined = format!("{} {}", task_type, summary).to_lowercase();
    if contains_any(
        &combined,
        &[
            "bug",
            "debug",
            "regression",
            "fault",
            "fail",
            "crash",
            "故障",
            "异常",
            "失效",
            "错误",
        ],
    ) {
        "bug".to_string()
    } else if contains_any(
        &combined,
        &[
            "bringup", "bring-up", "board", "smoke", "上电", "板级", "调通",
        ],
    ) {
        "board-bringup".to_string()
    } else if contains_any(
        &combined,
        &[
            "power",
            "sleep",
            "stop",
            "standby",
            "current",
            "battery",
            "lvd",
            "低功耗",
            "电源",
            "电池",
            "功耗",
        ],
    ) {
        "power".to_string()
    } else if contains_any(
        &combined,
        &[
            "timing",
            "pwm",
            "timer",
            "interrupt",
            "isr",
            "clock",
            "时序",
            "中断",
            "定时",
            "调光",
        ],
    ) {
        "timing".to_string()
    } else if contains_any(
        &combined,
        &[
            "toolchain",
            "build",
            "compile",
            "sdcc",
            "link",
            "hex",
            "编译",
            "构建",
            "烧录",
        ],
    ) {
        "toolchain".to_string()
    } else {
        "feature".to_string()
    }
}

fn task_needs_human_gate(category: &str, summary: &str) -> bool {
    let text = summary.to_lowercase();
    category == "board-bringup"
        || contains_any(
            &text,
            &[
                "bench",
                "scope",
                "oscilloscope",
                "logic analyzer",
                "schematic",
                "layout",
                "part",
                "hardware choice",
                "示波器",
                "逻辑分析仪",
                "原理图",
                "pcb",
                "板级",
                "选型",
                "实测",
            ],
        )
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    // Split into lowercase words on non-alphanumeric boundaries for word matching.
    // Multi-word needles (containing spaces or hyphens) still use substring matching.
    let words: Vec<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    needles.iter().any(|needle| {
        if needle.contains(' ') || needle.contains('-') {
            text.contains(needle)
        } else {
            words.contains(needle)
        }
    })
}

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn slugify_task_name(name: &str) -> String {
    let slug = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    truncate_chars(slug.trim_matches('-'), 60)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn safe_task_name(name: &str) -> String {
    let safe = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if safe.is_empty() {
        "task".to_string()
    } else {
        safe
    }
}

pub fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
