use super::config::{load_config, maybe_auto_commit_session, run_configured_hooks};
use super::util::{current_dir_string, option_value, option_values};
use chrono::Local;
use emb_agent_core::{
    build_external_dispatch_next_json, build_external_health_json, build_external_next_json,
    build_external_start_json, build_external_status_json, build_health_json,
    build_next_json_with_tasks_and_policy, build_session_context, build_start_json,
    build_status_json, build_statusline, evaluate_worktree_policy, read_all_tasks,
    snapshot_from_cwd,
};
use serde_json::Value;
use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    match args.first().map(String::as_str).unwrap_or("") {
        "finish" | "finish-work" => run_finish_work_command(args, &cwd),
        "session" => run_session_namespace(args, &cwd),
        "statusline" => {
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "start" => {
            if args.iter().any(|a| a == "--json" || a == "--brief") {
                println!("{}", build_start_json(&snapshot));
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "next" => {
            if args.iter().any(|a| a == "--json" || a == "--brief") {
                let ext_dir = Path::new(&cwd).join(".emb-agent");
                let tasks = read_all_tasks(&ext_dir);
                let target_task = snapshot
                    .current_task
                    .as_ref()
                    .map(|task| task.name.as_str());
                let policy = evaluate_worktree_policy(&ext_dir, Path::new(&cwd), target_task);
                let json = build_next_json_with_tasks_and_policy(&snapshot, &tasks, Some(&policy));
                println!("{json}");
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "status" => {
            // Check for --query flag for state query mode
            if let Some(query_pos) = args.iter().position(|a| a == "--query") {
                let query = args.get(query_pos + 1).map(String::as_str).unwrap_or("");

                if query.is_empty() {
                    return Err(
                        "--query requires a question (e.g., --query \"is watchdog enabled?\")"
                            .to_string(),
                    );
                }

                let project_root = Path::new(&cwd);
                let impl_status = emb_agent_core::load_impl_status(project_root);
                let recent_decisions =
                    emb_agent_core::load_recent_compound_decisions(project_root, 7);
                let answer = emb_agent_core::build_state_answer(
                    project_root,
                    query,
                    &impl_status,
                    &recent_decisions,
                );

                println!("{}", answer);
            } else {
                println!("{}", build_status_json(&snapshot));
            }
            Ok(())
        }
        "health" => {
            println!("{}", build_health_json(&snapshot));
            Ok(())
        }
        "pause" => {
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            let note = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::meta_ops::pause_session(&ext_dir, note)
            );
            Ok(())
        }
        "resume" => {
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            println!("{}", emb_agent_core::meta_ops::resume_session(&ext_dir));
            Ok(())
        }
        _ => Err(format!(
            "unknown session command: {}",
            args.first().unwrap_or(&String::new())
        )),
    }
}

fn run_session_namespace(args: &[String], cwd: &str) -> Result<(), String> {
    let (subcommand, subcommand_index) = namespace_subcommand(args, 1);
    match subcommand {
        "" | "show" => {
            let project_root = discover_project_root(cwd);
            let ext_dir = project_root.join(".emb-agent");
            println!("{}", emb_agent_core::meta_ops::session_show(&ext_dir));
            Ok(())
        }
        "record" => record_workspace_session(args, subcommand_index + 1, cwd),
        "finish" | "finish-work" => run_finish_work_command(args, cwd),
        "journal" | "history" => show_workspace_journal(cwd),
        other => Err(format!(
            "unknown session command: {other}. Valid: show, record, finish-work, journal, history"
        )),
    }
}

fn record_workspace_session(args: &[String], value_start: usize, cwd: &str) -> Result<(), String> {
    let project_root = discover_project_root(cwd);
    let ext_dir = project_root.join(".emb-agent");
    if !ext_dir.exists() {
        return Err("session record requires an initialized .emb-agent project".to_string());
    }

    let title = option_value(args, "--title")
        .or_else(|| positional_after_index(args, value_start))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "session record requires --title <text> or a title argument".to_string())?;
    let mut detail = option_values(args, "--detail")
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if detail.is_empty() {
        detail = read_piped_stdin().unwrap_or_default();
    }
    let summary = option_value(args, "--summary")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| title.clone());
    let status = option_value(args, "--status")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "completed".to_string());
    let branch = option_value(args, "--branch")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| git_branch(&project_root));
    let package = option_value(args, "--package")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| active_package(&ext_dir));
    let task = option_value(args, "--task")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| title.clone());
    let mut tests = option_values(args, "--test");
    tests.extend(option_values(args, "--testing"));
    let tests = clean_values(tests);
    let commits = clean_values(option_values(args, "--commit"));
    let next_steps = clean_values(option_values(args, "--next"));

    let result = write_workspace_session(
        &project_root,
        WorkspaceSessionRecord {
            title,
            task,
            package,
            branch,
            summary,
            detail,
            commits,
            tests,
            status,
            next_steps,
        },
    )?;

    println!("{}", pretty_json(&result.to_json()));
    Ok(())
}

#[derive(Debug, Clone)]
struct WorkspaceSessionRecord {
    title: String,
    task: String,
    package: String,
    branch: String,
    summary: String,
    detail: String,
    commits: Vec<String>,
    tests: Vec<String>,
    status: String,
    next_steps: Vec<String>,
}

#[derive(Debug, Clone)]
struct WorkspaceRecordResult {
    developer_name: String,
    developer_slug: String,
    session_number: usize,
    journal_path: String,
    developer_index: String,
    workspace_index: String,
}

impl WorkspaceRecordResult {
    fn to_json(&self) -> Value {
        serde_json::json!({
            "status": "ok",
            "kind": "workspace-journal",
            "developer": self.developer_name,
            "developer_dir": format!(".emb-agent/workspace/{}", self.developer_slug),
            "session": self.session_number,
            "journal": self.journal_path,
            "index": self.developer_index,
            "workspace_index": self.workspace_index
        })
    }
}

fn write_workspace_session(
    project_root: &Path,
    record: WorkspaceSessionRecord,
) -> Result<WorkspaceRecordResult, String> {
    let ext_dir = project_root.join(".emb-agent");
    let developer_name = read_developer_name(&ext_dir);
    let developer_slug = sanitize_developer_slug(&developer_name);
    let workspace_dir = ext_dir.join("workspace");
    let developer_dir = workspace_dir.join(&developer_slug);
    fs::create_dir_all(&developer_dir)
        .map_err(|error| format!("create workspace journal directory failed: {error}"))?;

    let session_number = next_session_number(&developer_dir);
    let date = Local::now().format("%Y-%m-%d").to_string();
    let entry = build_session_entry(SessionEntryInput {
        session_number,
        date: &date,
        title: &record.title,
        task: &record.task,
        package: &record.package,
        branch: &record.branch,
        summary: &record.summary,
        detail: &record.detail,
        commits: &record.commits,
        tests: &record.tests,
        status: &record.status,
        next_steps: &record.next_steps,
    });

    let cfg = load_config(project_root);
    let journal_number = choose_journal_number(&developer_dir, &entry, cfg.max_journal_lines);
    let journal_path = developer_dir.join(format!("journal-{journal_number}.md"));
    append_journal_entry(&journal_path, &developer_name, journal_number, &entry)?;
    rewrite_developer_index(
        &developer_dir,
        &developer_name,
        &developer_slug,
        &date,
        &record.status,
    )?;
    rewrite_workspace_index(&workspace_dir)?;
    if cfg.session_auto_commit {
        maybe_auto_commit_session(project_root, &cfg.session_commit_message);
    }

    Ok(WorkspaceRecordResult {
        developer_name,
        developer_slug: developer_slug.clone(),
        session_number,
        journal_path: relative_to_project(project_root, &journal_path),
        developer_index: format!(".emb-agent/workspace/{developer_slug}/index.md"),
        workspace_index: ".emb-agent/workspace/index.md".to_string(),
    })
}

pub fn run_finish_work_command(args: &[String], cwd: &str) -> Result<(), String> {
    let project_root = discover_project_root(cwd);
    let ext_dir = project_root.join(".emb-agent");
    if !ext_dir.exists() {
        return Err("finish-work requires an initialized .emb-agent project".to_string());
    }

    let task_name = finish_work_task_name(args, &ext_dir, &project_root);
    let task_info = task_name
        .as_deref()
        .and_then(|name| read_task_info(&ext_dir, name));
    let task_title = task_info
        .as_ref()
        .map(|info| info.title.as_str())
        .unwrap_or("");
    let task_package = task_info
        .as_ref()
        .map(|info| info.package.as_str())
        .unwrap_or("");
    let title = option_value(args, "--title")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if !task_title.is_empty() {
                format!("Finish {task_title}")
            } else if let Some(task_name) = &task_name {
                format!("Finish {task_name}")
            } else {
                "Finish work".to_string()
            }
        });
    let mut detail = option_values(args, "--detail")
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if detail.is_empty() {
        detail = read_piped_stdin().unwrap_or_default();
    }
    if detail.is_empty() {
        detail = finish_work_detail(&project_root);
    }
    let summary = option_value(args, "--summary")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| finish_work_summary(task_name.as_deref(), task_title));
    let status = option_value(args, "--status")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "completed".to_string());
    let branch = option_value(args, "--branch")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| git_branch(&project_root));
    let package = option_value(args, "--package")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if task_package.is_empty() {
                active_package(&ext_dir)
            } else {
                task_package.to_string()
            }
        });
    let task = option_value(args, "--task")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| task_name.clone())
        .unwrap_or_else(|| title.clone());
    let mut tests = option_values(args, "--test");
    tests.extend(option_values(args, "--testing"));
    let tests = clean_values(tests);
    let mut commits = clean_values(option_values(args, "--commit"));
    if commits.is_empty()
        && let Some(commit) = git_output(&project_root, &["log", "-1", "--pretty=%h %s"])
    {
        commits.push(commit);
    }
    let mut next_steps = clean_values(option_values(args, "--next"));
    if next_steps.is_empty() {
        next_steps.push("Run `next` to route follow-up work or board acceptance.".to_string());
    }

    let journal = write_workspace_session(
        &project_root,
        WorkspaceSessionRecord {
            title,
            task,
            package,
            branch,
            summary: summary.clone(),
            detail,
            commits,
            tests,
            status,
            next_steps,
        },
    )?;

    let resolve_enabled = !args.iter().any(|arg| arg == "--no-resolve");
    let resolve_result = if resolve_enabled {
        task_name
            .as_deref()
            .map(|name| resolve_finish_work_task(&project_root, &ext_dir, name, &summary))
    } else {
        None
    };
    let archive_enabled = resolve_enabled && !args.iter().any(|arg| arg == "--no-archive");
    let archive_result = if archive_enabled
        && resolve_result
            .as_ref()
            .is_some_and(is_ok_task_lifecycle_result)
    {
        task_name.as_deref().map(|name| {
            archive_finish_work_task(
                &project_root,
                &ext_dir,
                name,
                args.iter().any(|arg| arg == "--no-commit"),
            )
        })
    } else {
        None
    };
    let resolve_failed = resolve_result
        .as_ref()
        .is_some_and(|value| value.get("status").and_then(Value::as_str) != Some("ok"));
    let archive_failed = archive_result
        .as_ref()
        .is_some_and(|value| value.get("status").and_then(Value::as_str) != Some("ok"));
    let finish_status = if resolve_failed || archive_failed {
        "warn"
    } else {
        "ok"
    };
    let task_json = serde_json::json!({
        "name": task_name,
        "resolve_enabled": resolve_enabled,
        "resolve_attempted": resolve_result.is_some(),
        "resolve": resolve_result.unwrap_or(Value::Null),
        "archive_enabled": archive_enabled,
        "archive_attempted": archive_result.is_some(),
        "archive": archive_result.unwrap_or(Value::Null)
    });
    let payload = serde_json::json!({
        "status": finish_status,
        "command": "finish-work",
        "journal": journal.to_json(),
        "task": task_json,
        "follow_ups": finish_work_followups(&project_root),
        "next_command": "next"
    });
    println!("{}", pretty_json(&payload));
    Ok(())
}

#[derive(Debug, Clone)]
struct TaskInfo {
    title: String,
    package: String,
}

fn finish_work_task_name(args: &[String], ext_dir: &Path, cwd: &Path) -> Option<String> {
    option_value(args, "--task")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| task_finish_work_positional(args))
        .or_else(|| active_task_name(ext_dir, cwd))
}

fn task_finish_work_positional(args: &[String]) -> Option<String> {
    if args.first().map(String::as_str) != Some("task") {
        return None;
    }
    let subcommand = args.get(1).map(String::as_str);
    if !matches!(subcommand, Some("finish") | Some("finish-work")) {
        return None;
    }
    args.get(2)
        .filter(|arg| !arg.starts_with("--"))
        .map(|arg| arg.trim().to_string())
        .filter(|arg| !arg.is_empty())
}

fn active_task_name(ext_dir: &Path, cwd: &Path) -> Option<String> {
    emb_agent_core::read_current_task_name_for_session(ext_dir, cwd, "cli")
}

fn read_task_info(ext_dir: &Path, name: &str) -> Option<TaskInfo> {
    let state_dir = emb_agent_core::variant_ops::active_state_dir(ext_dir);
    let raw = fs::read_to_string(state_dir.join("tasks").join(name).join("task.json")).ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    Some(TaskInfo {
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(name)
            .to_string(),
        package: value
            .get("package")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

fn finish_work_summary(task_name: Option<&str>, task_title: &str) -> String {
    if !task_title.trim().is_empty() {
        format!("Finished task {task_title}.")
    } else if let Some(task_name) = task_name {
        format!("Finished task {task_name}.")
    } else {
        "Finished current work.".to_string()
    }
}

fn finish_work_detail(project_root: &Path) -> String {
    let mut sections = Vec::new();
    if let Some(status) = git_output(project_root, &["status", "--short"])
        && !status.trim().is_empty()
    {
        sections.push(format!("Git status:\n\n```text\n{status}\n```"));
    }
    if let Some(diffstat) = git_output(project_root, &["diff", "--stat", "HEAD"])
        && !diffstat.trim().is_empty()
    {
        sections.push(format!("Diff stat:\n\n```text\n{diffstat}\n```"));
    }
    if sections.is_empty() {
        "- No git changes detected or git status unavailable.".to_string()
    } else {
        sections.join("\n\n")
    }
}

fn git_output(project_root: &Path, args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|output| !output.is_empty())
}

fn resolve_finish_work_task(
    project_root: &Path,
    ext_dir: &Path,
    name: &str,
    summary: &str,
) -> Value {
    let raw = emb_agent_core::task::task_ops::task_resolve(ext_dir, name, summary);
    let value = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| {
        serde_json::json!({
            "status": "error",
            "error": {"code": "invalid-resolve-output", "message": raw}
        })
    });
    let resolved = value.get("status").and_then(Value::as_str) == Some("ok")
        && !value
            .get("already_completed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    if resolved {
        let state_dir = emb_agent_core::variant_ops::active_state_dir(ext_dir);
        let task_json = state_dir.join("tasks").join(name).join("task.json");
        run_configured_hooks(
            project_root,
            "after_finish",
            &[("TASK_JSON_PATH", task_json.to_string_lossy().to_string())],
        );
    }
    value
}

fn archive_finish_work_task(
    project_root: &Path,
    ext_dir: &Path,
    name: &str,
    no_commit: bool,
) -> Value {
    let raw = emb_agent_core::task::task_ops::task_archive(ext_dir, name, no_commit);
    let value = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| {
        serde_json::json!({
            "status": "error",
            "error": {"code": "invalid-archive-output", "message": raw}
        })
    });
    if value.get("status").and_then(Value::as_str) == Some("ok")
        && value
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        && let Some(task_json) = value
            .get("archive")
            .and_then(|archive| archive.get("task_json"))
            .and_then(Value::as_str)
    {
        run_configured_hooks(
            project_root,
            "after_archive",
            &[("TASK_JSON_PATH", task_json.to_string())],
        );
    }
    value
}

fn is_ok_task_lifecycle_result(value: &Value) -> bool {
    value.get("status").and_then(Value::as_str) == Some("ok")
}

fn finish_work_followups(project_root: &Path) -> Value {
    let firmware_reports = project_root
        .join(".emb-agent")
        .join("reports")
        .join("firmware");
    let resource_summary = firmware_reports.join("resource-summary.json");
    let board_evidence = firmware_reports.join("board-evidence.jsonl");
    let release_handoff = firmware_reports.join("release-handoff.md");
    serde_json::json!([
        {
            "name": "resource_evidence",
            "status": if resource_summary.is_file() { "ready" } else { "as-needed" },
            "path": ".emb-agent/reports/firmware/resource-summary.json",
            "handled_by": "agent-internal",
            "user_action": "none",
            "reason": if resource_summary.is_file() {
                "build/resource evidence is available for this session"
            } else {
                "agent captures build/resource evidence during verification when a report or map exists"
            }
        },
        {
            "name": "board_evidence",
            "status": if board_evidence.is_file() { "ready" } else { "as-needed" },
            "path": ".emb-agent/reports/firmware/board-evidence.jsonl",
            "handled_by": "agent-internal",
            "user_action": "none",
            "reason": if board_evidence.is_file() {
                "board or measurement evidence has been recorded"
            } else {
                "only required when the task touches hardware-facing behavior or the user provides bench results"
            }
        },
        {
            "name": "release_handoff",
            "status": if release_handoff.is_file() { "ready" } else { "optional" },
            "path": ".emb-agent/reports/firmware/release-handoff.md",
            "handled_by": "agent-internal",
            "user_action": "none",
            "reason": if release_handoff.is_file() {
                "release handoff draft exists"
            } else {
                "create during release/customer handoff, not for every small task"
            }
        },
        {
            "name": "knowledge_graph",
            "status": "as-needed",
            "handled_by": "agent-internal",
            "user_action": "none",
            "reason": "refresh only when durable wiki, compound, or knowledge files changed"
        }
    ])
}

fn show_workspace_journal(cwd: &str) -> Result<(), String> {
    let project_root = discover_project_root(cwd);
    let index = project_root
        .join(".emb-agent")
        .join("workspace")
        .join("index.md");
    match fs::read_to_string(&index) {
        Ok(text) if !text.trim().is_empty() => {
            println!("{}", text.trim_end());
            Ok(())
        }
        _ => {
            println!(
                "No workspace journal recorded yet. Use `session record --title \"...\" --summary \"...\"`."
            );
            Ok(())
        }
    }
}

fn namespace_subcommand(args: &[String], start: usize) -> (&str, usize) {
    let mut index = start;
    while index < args.len() {
        let token = args[index].as_str();
        if !token.starts_with("--") {
            return (token, index);
        }
        index += if index + 1 < args.len() && !args[index + 1].starts_with("--") {
            2
        } else {
            1
        };
    }
    ("show", start)
}

fn positional_after_index(args: &[String], start: usize) -> Option<String> {
    let mut index = start;
    while index < args.len() {
        let token = &args[index];
        if token.starts_with("--") {
            index += if index + 1 < args.len() && !args[index + 1].starts_with("--") {
                2
            } else {
                1
            };
        } else {
            return Some(token.clone());
        }
    }
    None
}

fn read_piped_stdin() -> Option<String> {
    let stdin = io::stdin();
    if stdin.is_terminal() {
        return None;
    }
    let mut raw = String::new();
    stdin.lock().read_to_string(&mut raw).ok()?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn clean_values(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn discover_project_root(cwd: &str) -> PathBuf {
    let mut dir = Path::new(cwd)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(cwd));
    loop {
        if dir.join(".emb-agent").exists() {
            return dir;
        }
        if !dir.pop() {
            return PathBuf::from(cwd);
        }
    }
}

fn read_developer_name(ext_dir: &Path) -> String {
    let raw = fs::read_to_string(ext_dir.join(".developer"))
        .or_else(|_| fs::read_to_string(ext_dir.join(".install").join("developer.json")))
        .unwrap_or_default();
    let name = serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|value| {
            value
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if name.trim().is_empty() {
        "developer".to_string()
    } else {
        name.trim().to_string()
    }
}

fn sanitize_developer_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.trim().to_ascii_lowercase().chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '_' {
            last_dash = false;
            Some(ch)
        } else if ch == '-' {
            if last_dash {
                None
            } else {
                last_dash = true;
                Some('-')
            }
        } else if last_dash {
            None
        } else {
            last_dash = true;
            Some('-')
        };
        if let Some(ch) = next {
            slug.push(ch);
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "developer".to_string()
    } else {
        slug
    }
}

fn git_branch(project_root: &Path) -> String {
    Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn active_package(ext_dir: &Path) -> String {
    let raw = fs::read_to_string(ext_dir.join("project.json")).unwrap_or_default();
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|value| {
            value
                .get("active_package")
                .or_else(|| value.get("default_package"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

struct SessionEntryInput<'a> {
    session_number: usize,
    date: &'a str,
    title: &'a str,
    task: &'a str,
    package: &'a str,
    branch: &'a str,
    summary: &'a str,
    detail: &'a str,
    commits: &'a [String],
    tests: &'a [String],
    status: &'a str,
    next_steps: &'a [String],
}

fn build_session_entry(input: SessionEntryInput<'_>) -> String {
    let package = if input.package.trim().is_empty() {
        "unknown"
    } else {
        input.package.trim()
    };
    let branch = if input.branch.trim().is_empty() {
        "unknown"
    } else {
        input.branch.trim()
    };
    format!(
        "\
## Session {}: {}

**Date**: {}
**Task**: {}
**Package**: `{}`
**Branch**: `{}`

### Summary

{}

### Main Changes

{}

### Git Commits

{}

### Testing

{}

### Status

{}

### Next Steps

{}
",
        input.session_number,
        input.title.trim(),
        input.date,
        input.task.trim(),
        package,
        branch,
        markdown_block_or_fallback(input.summary, "- Not recorded"),
        markdown_block_or_fallback(input.detail, "- Not recorded"),
        markdown_list_or_fallback(input.commits, "- No commits recorded"),
        markdown_list_or_fallback(input.tests, "- Not recorded"),
        markdown_block_or_fallback(input.status, "- Not recorded"),
        markdown_list_or_fallback(input.next_steps, "- None")
    )
}

fn markdown_block_or_fallback(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn markdown_list_or_fallback(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        return fallback.to_string();
    }
    values
        .iter()
        .map(|value| format!("- {}", value.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn next_session_number(developer_dir: &Path) -> usize {
    collect_developer_sessions(developer_dir).len() + 1
}

fn choose_journal_number(developer_dir: &Path, entry: &str, max_journal_lines: usize) -> usize {
    let current = latest_journal_number(developer_dir).unwrap_or(1);
    if max_journal_lines == 0 {
        return current;
    }
    let journal = developer_dir.join(format!("journal-{current}.md"));
    let existing = fs::read_to_string(&journal).unwrap_or_default();
    if existing.trim().is_empty() {
        return current;
    }
    let header_lines = if journal.exists() { 0 } else { 2 };
    let projected = existing.lines().count() + header_lines + entry.lines().count() + 1;
    if projected > max_journal_lines {
        current + 1
    } else {
        current
    }
}

fn append_journal_entry(
    journal_path: &Path,
    developer_name: &str,
    journal_number: usize,
    entry: &str,
) -> Result<(), String> {
    let mut body = fs::read_to_string(journal_path).unwrap_or_default();
    if body.trim().is_empty() {
        body = format!("# {developer_name} Journal {journal_number}\n\n");
    } else {
        while !body.ends_with("\n\n") {
            body.push('\n');
        }
    }
    body.push_str(entry.trim_end());
    body.push('\n');
    fs::write(journal_path, body)
        .map_err(|error| format!("write workspace journal failed: {error}"))
}

#[derive(Debug, Clone)]
struct SessionSummary {
    number: usize,
    title: String,
    file: String,
}

fn collect_developer_sessions(developer_dir: &Path) -> Vec<SessionSummary> {
    let mut files = journal_files(developer_dir);
    files.sort_by_key(|(number, _)| *number);
    let mut sessions = Vec::new();
    for (_, path) in files {
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let text = fs::read_to_string(&path).unwrap_or_default();
        for line in text.lines() {
            let Some(rest) = line.strip_prefix("## Session ") else {
                continue;
            };
            let Some((number, title)) = rest.split_once(':') else {
                continue;
            };
            let number = number.trim().parse::<usize>().unwrap_or(0);
            if number == 0 {
                continue;
            }
            sessions.push(SessionSummary {
                number,
                title: title.trim().to_string(),
                file: file_name.to_string(),
            });
        }
    }
    sessions
}

fn journal_files(developer_dir: &Path) -> Vec<(usize, PathBuf)> {
    let Ok(entries) = fs::read_dir(developer_dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            let number = name
                .strip_prefix("journal-")?
                .strip_suffix(".md")?
                .parse::<usize>()
                .ok()?;
            Some((number, path))
        })
        .collect()
}

fn latest_journal_number(developer_dir: &Path) -> Option<usize> {
    journal_files(developer_dir)
        .into_iter()
        .map(|(number, _)| number)
        .max()
}

fn rewrite_developer_index(
    developer_dir: &Path,
    developer_name: &str,
    developer_slug: &str,
    date: &str,
    status: &str,
) -> Result<(), String> {
    let sessions = collect_developer_sessions(developer_dir);
    let latest = sessions.last();
    let mut body = format!(
        "\
# {developer_name} Workspace Journal

Developer slug: `{developer_slug}`
Last updated: {date}
Current status: {}
",
        status.trim()
    );
    if let Some(latest) = latest {
        body.push_str(&format!(
            "Latest session: [Session {}: {}]({})\n",
            latest.number, latest.title, latest.file
        ));
    }
    body.push_str("\n## Journals\n\n");
    let mut files = journal_files(developer_dir);
    files.sort_by_key(|(number, _)| *number);
    if files.is_empty() {
        body.push_str("- None\n");
    } else {
        for (number, _) in &files {
            body.push_str(&format!("- [journal-{number}.md](journal-{number}.md)\n"));
        }
    }
    body.push_str("\n## Sessions\n\n");
    if sessions.is_empty() {
        body.push_str("- None\n");
    } else {
        for session in sessions.iter().rev().take(50) {
            body.push_str(&format!(
                "- Session {}: [{}]({})\n",
                session.number, session.title, session.file
            ));
        }
    }
    fs::write(developer_dir.join("index.md"), body)
        .map_err(|error| format!("write developer workspace index failed: {error}"))
}

fn rewrite_workspace_index(workspace_dir: &Path) -> Result<(), String> {
    let mut rows = Vec::new();
    let Ok(entries) = fs::read_dir(workspace_dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        let sessions = collect_developer_sessions(&path);
        let latest = sessions.last();
        let display = developer_display_from_index(&path).unwrap_or_else(|| slug.clone());
        rows.push((
            display,
            slug,
            sessions.len(),
            latest
                .map(|session| format!("Session {}: {}", session.number, session.title))
                .unwrap_or_else(|| "None".to_string()),
        ));
    }
    rows.sort_by(|a, b| a.1.cmp(&b.1));
    let mut body = "\
# Workspace Journal

Human-readable session history for continuing work across agent sessions.
Machine hook events remain in `.emb-agent/sessions/`.

| Developer | Sessions | Latest |
|---|---:|---|
"
    .to_string();
    if rows.is_empty() {
        body.push_str("| None | 0 | None |\n");
    } else {
        for (display, slug, count, latest) in rows {
            body.push_str(&format!(
                "| [{display}]({slug}/index.md) | {count} | {latest} |\n"
            ));
        }
    }
    fs::write(workspace_dir.join("index.md"), body)
        .map_err(|error| format!("write workspace index failed: {error}"))
}

fn developer_display_from_index(developer_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(developer_dir.join("index.md")).ok()?;
    text.lines()
        .find_map(|line| line.strip_prefix("# ")?.strip_suffix(" Workspace Journal"))
        .map(str::to_string)
}

fn relative_to_project(project_root: &Path, path: &Path) -> String {
    path.strip_prefix(project_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "{\"status\":\"ok\"}".to_string())
}

pub fn run_external(args: &[String]) -> Result<(), String> {
    let entrypoint = args.get(1).map(String::as_str).unwrap_or("next");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    let tasks = read_all_tasks(&ext_dir);

    match entrypoint {
        "start" => {
            println!("{}", build_external_start_json(&snapshot));
            Ok(())
        }
        "next" => {
            let json = build_external_next_json(&snapshot, &tasks);
            println!("{json}");
            Ok(())
        }
        "status" => {
            println!("{}", build_external_status_json(&snapshot));
            Ok(())
        }
        "health" => {
            println!("{}", build_external_health_json(&snapshot));
            Ok(())
        }
        "dispatch-next" => {
            println!("{}", build_external_dispatch_next_json(&snapshot, &tasks));
            Ok(())
        }
        _ => Err(format!(
            "unknown external entrypoint: {entrypoint}. Valid: start, next, status, health, dispatch-next"
        )),
    }
}

pub fn run_actions(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    match args.first().map(String::as_str).unwrap_or("") {
        "scan" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_scan_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "plan" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_plan_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "do" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_do_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "review" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_review_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "verify" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_verify_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "debug" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_debug_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        _ => Err(format!(
            "unknown action: {}",
            args.first().unwrap_or(&String::new())
        )),
    }
}

fn with_worktree_policy(
    json_text: String,
    snapshot: &emb_agent_core::ProjectSnapshot,
    cwd: &str,
) -> String {
    let Some(task) = &snapshot.current_task else {
        return json_text;
    };
    let ext_dir = Path::new(cwd).join(".emb-agent");
    let policy = evaluate_worktree_policy(&ext_dir, Path::new(cwd), Some(&task.name));
    if policy.decision == "not-needed" {
        return json_text;
    }
    let mut value: serde_json::Value = serde_json::from_str(&json_text).unwrap_or_default();
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "worktree_policy".to_string(),
            emb_agent_core::worktree_policy_json(&policy),
        );
        if policy.decision == "required" {
            obj.insert(
                "agent_protocol".to_string(),
                serde_json::json!({
                    "gate": {
                        "kind": "worktree-required",
                        "blocking": true,
                        "reason": policy.reason,
                        "allowed_actions": ["present_worktree_reason", "trigger_task_activate_with_worktree"],
                        "forbidden_actions": ["continue_in_main_workspace", "ask_user_to_run_task_activate", "run_shell_command_for_emb_slash_command"],
                        "recommended_command": policy.recommended_command
                    }
                }),
            );
            obj.insert(
                "next_instructions".to_string(),
                serde_json::Value::String(format!(
                    "Worktree isolation is required before execution. Trigger `/emb:task activate {} --worktree`; do not ask the user to run the command.",
                    task.name
                )),
            );
        }
    }
    serde_json::to_string_pretty(&value).unwrap_or(json_text)
}
