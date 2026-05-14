use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use emb_agent_core::{
    HookPlan, build_hook_plan, build_hook_plan_json, build_hooks_diagnostics_json,
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TaskSnapshot {
    name: String,
    title: String,
    status: String,
    priority: String,
    package: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ProjectSnapshot {
    initialized: bool,
    project_root: String,
    developer: String,
    mcu_model: String,
    mcu_package: String,
    default_package: String,
    active_package: String,
    git_branch: String,
    open_tasks: usize,
    wiki_pages: usize,
    current_task: Option<TaskSnapshot>,
    recommended_command: String,
    recommended_reason: String,
}

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("emb-agent-rs error: {error}");
        std::process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let command = args.first().map(String::as_str).unwrap_or("help");

    match command {
        "statusline" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "hook" => run_hook(&args),
        "diagnostics" => run_diagnostics(&args),
        "start" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            if args.iter().any(|arg| arg == "--json") || args.iter().any(|arg| arg == "--brief") {
                println!("{}", build_start_json(&snapshot));
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn run_diagnostics(args: &[String]) -> Result<(), String> {
    let topic = args.get(1).map(String::as_str).unwrap_or("");
    match topic {
        "hooks" => {
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let runtime_dir =
                option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());
            println!(
                "{}",
                build_hooks_diagnostics_json(&host, Path::new(&runtime_dir))
            );
            Ok(())
        }
        "" => Err("missing diagnostics topic; expected hooks".to_string()),
        other => Err(format!("unknown diagnostics topic: {other}")),
    }
}

fn run_hook(args: &[String]) -> Result<(), String> {
    let hook_name = args.get(1).map(String::as_str).unwrap_or("");
    match hook_name {
        "resolve" => {
            let plan = resolve_hook_plan_from_args(args);
            println!("{}", build_hook_plan_json(&plan));
            Ok(())
        }
        "session-start" => {
            let cwd = hook_cwd(args);
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let snapshot = snapshot_from_cwd(&cwd);
            let context = build_session_context(&snapshot);
            println!("{}", build_host_session_start_payload(&host, &context));
            Ok(())
        }
        "statusline" => {
            let cwd = hook_cwd(args);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "" => Err("missing hook name; expected resolve, session-start, or statusline".to_string()),
        other => Err(format!("unknown hook: {other}")),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs spike\n\nUSAGE:\n  emb-agent-rs start --brief --json [--cwd DIR]\n  emb-agent-rs statusline [--cwd DIR]\n  emb-agent-rs hook resolve --hook session-start --host pi --runtime-dir ./runtime --json\n  emb-agent-rs hook session-start [--cwd DIR] [--host pi|codex|cursor]\n  emb-agent-rs hook statusline [--cwd DIR]\n  emb-agent-rs diagnostics hooks --json [--host pi] [--runtime-dir ./runtime]\n"
    );
}

fn current_dir_string() -> String {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn hook_cwd(args: &[String]) -> String {
    option_value(args, "--cwd")
        .or_else(|| stdin_json_string_field("cwd"))
        .unwrap_or_else(current_dir_string)
}

fn stdin_json_string_field(key: &str) -> Option<String> {
    use std::io::{IsTerminal, Read};
    let mut stdin = std::io::stdin();
    if stdin.is_terminal() {
        return None;
    }
    let mut raw = String::new();
    if stdin.read_to_string(&mut raw).is_err() {
        return None;
    }
    let value = json_string_field(&raw, key);
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_hook_plan_from_args(args: &[String]) -> HookPlan {
    let hook = option_value(args, "--hook").unwrap_or_else(|| "session-start".to_string());
    let host = option_value(args, "--host").unwrap_or_else(|| "external".to_string());
    let runtime_dir = option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());
    build_hook_plan(&host, &hook, Path::new(&runtime_dir))
}

fn snapshot_from_cwd(cwd: &str) -> ProjectSnapshot {
    let Some(root) = find_project_root(Path::new(cwd)) else {
        return ProjectSnapshot {
            initialized: false,
            recommended_command: "init".to_string(),
            recommended_reason: "No .emb-agent directory found".to_string(),
            ..ProjectSnapshot::default()
        };
    };

    let ext = root.join(".emb-agent");
    let project_json = read_text(&ext.join("project.json"));
    let hw_yaml = read_text(&ext.join("hw.yaml"));
    let developer_json = read_text(&ext.join(".developer"));
    let current_task = read_current_task(&ext);
    let open_tasks = count_open_tasks(&ext);
    let wiki_pages = count_wiki_pages(&ext);
    let git_branch = git_branch(&root);
    let mcu_model = yaml_nested_string(&hw_yaml, "mcu", "model");
    let mcu_package = yaml_nested_string(&hw_yaml, "mcu", "package");

    let (recommended_command, recommended_reason) = if current_task.is_some() {
        ("do".to_string(), "Active task is selected".to_string())
    } else if mcu_model.is_empty() {
        (
            "declare hardware".to_string(),
            "MCU model is not declared".to_string(),
        )
    } else {
        (
            "next".to_string(),
            "Project has hardware context; continue workflow routing".to_string(),
        )
    };

    ProjectSnapshot {
        initialized: root.join(".emb-agent").join("project.json").exists(),
        project_root: root.to_string_lossy().to_string(),
        developer: json_string_field(&developer_json, "name"),
        mcu_model,
        mcu_package,
        default_package: json_string_field(&project_json, "default_package"),
        active_package: json_string_field(&project_json, "active_package"),
        git_branch,
        open_tasks,
        wiki_pages,
        current_task,
        recommended_command,
        recommended_reason,
    }
}

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_absolute() {
        start.to_path_buf()
    } else {
        env::current_dir().ok()?.join(start)
    };

    current = current.canonicalize().unwrap_or(current);

    loop {
        if current.join(".emb-agent").is_dir() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn read_current_task(ext: &Path) -> Option<TaskSnapshot> {
    let task_name = read_text(&ext.join(".current-task"));
    if task_name.is_empty() {
        return None;
    }

    let task_json = read_text(&ext.join("tasks").join(&task_name).join("task.json"));
    if task_json.is_empty() {
        return None;
    }

    let status = json_string_field(&task_json, "status");
    if is_closed_task(&status) {
        return None;
    }

    Some(TaskSnapshot {
        name: task_name.clone(),
        title: first_non_empty(&[
            json_string_field(&task_json, "title"),
            json_string_field(&task_json, "name"),
            task_name,
        ]),
        status,
        priority: first_non_empty(&[json_string_field(&task_json, "priority"), "P2".to_string()]),
        package: json_string_field(&task_json, "package"),
    })
}

fn count_open_tasks(ext: &Path) -> usize {
    let tasks_dir = ext.join("tasks");
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false))
        .filter(|entry| entry.file_name().to_string_lossy() != "archive")
        .filter(|entry| {
            let text = read_text(&entry.path().join("task.json"));
            !text.is_empty() && !is_closed_task(&json_string_field(&text, "status"))
        })
        .count()
}

fn count_wiki_pages(ext: &Path) -> usize {
    fn walk(dir: &Path, count: &mut usize) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, count);
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.ends_with(".md") && name != "index.md" && name != "log.md" {
                *count += 1;
            }
        }
    }

    let mut count = 0;
    walk(&ext.join("wiki"), &mut count);
    count
}

fn is_closed_task(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "resolved" | "closed" | "rejected" | "archived" | "cancelled" | "canceled"
    )
}

fn git_branch(project_root: &Path) -> String {
    if !project_root.join(".git").exists() {
        return String::new();
    }
    Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn build_statusline(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return String::new();
    }

    let mut parts = vec!["emb-rs".to_string()];
    if !snapshot.mcu_model.is_empty() {
        let chip = if snapshot.mcu_package.is_empty() {
            snapshot.mcu_model.clone()
        } else {
            format!("{} {}", snapshot.mcu_model, snapshot.mcu_package)
        };
        parts.push(format!("chip: {chip}"));
    } else {
        parts.push("chip: undeclared".to_string());
    }
    parts.push(format!("{} task(s)", snapshot.open_tasks));
    if snapshot.wiki_pages > 0 {
        parts.push(format!("wiki: {}", snapshot.wiki_pages));
    }
    if !snapshot.git_branch.is_empty() {
        parts.push(format!("branch: {}", snapshot.git_branch));
    }
    parts.push(format!("next: {}", snapshot.recommended_command));

    let mut line = parts.join(" · ");
    if let Some(task) = &snapshot.current_task {
        line.push_str(&format!(" | [{}] {}", task.priority, task.title));
    }
    line
}

fn build_session_context(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return "<emb-agent-session-context>\nNo emb-agent project found. Run emb-agent init/bootstrap from the project root.\n</emb-agent-session-context>".to_string();
    }

    let mut lines = vec![
        "<emb-agent-session-context>".to_string(),
        "emb-agent Rust spike context is injected for this session.".to_string(),
        "Use this as lightweight project state; fall back to the Node runtime for full workflow behavior.".to_string(),
        "</emb-agent-session-context>".to_string(),
        String::new(),
        "<current-state>".to_string(),
        format!("Project root: {}", snapshot.project_root),
        format!("Runtime: emb-agent-rs spike"),
        format!("Recommended next command: {}", snapshot.recommended_command),
        format!("Reason: {}", snapshot.recommended_reason),
    ];

    if !snapshot.developer.is_empty() {
        lines.push(format!("Developer: {}", snapshot.developer));
    }
    if !snapshot.mcu_model.is_empty() {
        lines.push(format!("MCU: {}", snapshot.mcu_model));
    }
    if !snapshot.mcu_package.is_empty() {
        lines.push(format!("MCU package: {}", snapshot.mcu_package));
    }
    if !snapshot.default_package.is_empty() || !snapshot.active_package.is_empty() {
        lines.push(format!(
            "Package: default={}, active={}",
            fallback(&snapshot.default_package, "(none)"),
            fallback(&snapshot.active_package, "(none)")
        ));
    }
    lines.push(format!("Open tasks: {}", snapshot.open_tasks));
    lines.push(format!("Wiki pages: {}", snapshot.wiki_pages));
    if !snapshot.git_branch.is_empty() {
        lines.push(format!("Git branch: {}", snapshot.git_branch));
    }
    if let Some(task) = &snapshot.current_task {
        lines.push(format!("Active task: {} ({})", task.name, task.title));
        lines.push(format!(
            "Task status: {} / Priority: {}",
            task.status, task.priority
        ));
    }

    lines.extend([
        "</current-state>".to_string(),
        String::new(),
        "<ready>".to_string(),
        "Rust spike context is intentionally minimal and read-only.".to_string(),
        "Use the Node emb-agent runtime for mutation-heavy commands until parity is reached."
            .to_string(),
        "</ready>".to_string(),
    ]);

    lines.join("\n")
}

fn build_host_session_start_payload(host: &str, message: &str) -> String {
    let event_name = "SessionStart";
    match host {
        "cursor" => format!("{{\"additional_context\":{}}}", json_quote(message)),
        "codex" => format!(
            "{{\"suppressOutput\":true,\"systemMessage\":{},\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
            json_quote(&format!(
                "emb-agent rust context injected ({} chars)",
                message.len()
            )),
            json_quote(event_name),
            json_quote(message)
        ),
        _ => format!(
            "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
            json_quote(event_name),
            json_quote(message)
        ),
    }
}

fn build_start_json(snapshot: &ProjectSnapshot) -> String {
    let task_json = if let Some(task) = &snapshot.current_task {
        format!(
            "{{\"name\":{},\"title\":{},\"status\":{},\"priority\":{}}}",
            json_quote(&task.name),
            json_quote(&task.title),
            json_quote(&task.status),
            json_quote(&task.priority)
        )
    } else {
        "null".to_string()
    };

    format!(
        "{{\"status\":\"ok\",\"runtime\":\"emb-agent-rs-spike\",\"summary\":{{\"initialized\":{},\"project_root\":{},\"mcu_model\":{},\"mcu_package\":{},\"open_tasks\":{},\"wiki_pages\":{},\"active_task\":{}}},\"immediate\":{{\"command\":{},\"reason\":{}}}}}",
        snapshot.initialized,
        json_quote(&snapshot.project_root),
        json_quote(&snapshot.mcu_model),
        json_quote(&snapshot.mcu_package),
        snapshot.open_tasks,
        snapshot.wiki_pages,
        task_json,
        json_quote(&snapshot.recommended_command),
        json_quote(&snapshot.recommended_reason)
    )
}

fn read_text(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn json_string_field(source: &str, key: &str) -> String {
    let pattern = format!("\"{key}\"");
    let Some(start) = source.find(&pattern) else {
        return String::new();
    };
    let rest = &source[start + pattern.len()..];
    let Some(colon) = rest.find(':') else {
        return String::new();
    };
    let mut chars = rest[colon + 1..].chars().skip_while(|c| c.is_whitespace());
    if chars.next() != Some('"') {
        return String::new();
    }

    let mut output = String::new();
    let mut escape = false;
    for ch in chars {
        if escape {
            output.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escape = false;
            continue;
        }
        if ch == '\\' {
            escape = true;
            continue;
        }
        if ch == '"' {
            break;
        }
        output.push(ch);
    }
    output
}

fn yaml_nested_string(source: &str, parent: &str, child: &str) -> String {
    let mut inside_parent = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let is_top_level = !line.starts_with(' ') && !line.starts_with('\t');
        if is_top_level {
            inside_parent = trimmed == format!("{parent}:");
            continue;
        }
        if inside_parent {
            let child_prefix = format!("{child}:");
            if let Some(value) = trimmed.strip_prefix(&child_prefix) {
                return unquote_yaml_scalar(value.trim()).to_string();
            }
        }
    }
    String::new()
}

fn unquote_yaml_scalar(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn json_quote(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            ch if ch.is_control() => output.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => output.push(ch),
        }
    }
    output.push('"');
    output
}

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn fallback<'a>(value: &'a str, default_value: &'a str) -> &'a str {
    if value.trim().is_empty() {
        default_value
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("emb-agent-rs-test-{nonce}"));
        fs::create_dir_all(root.join(".emb-agent/tasks/task-1")).unwrap();
        fs::create_dir_all(root.join(".emb-agent/wiki/chips")).unwrap();
        fs::write(
            root.join(".emb-agent/hw.yaml"),
            "mcu:\n  vendor: Espressif\n  model: ESP32-C3\n  package: QFN32\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/project.json"),
            "{\"default_package\":\"core\",\"active_package\":\"core\"}",
        )
        .unwrap();
        fs::write(root.join(".emb-agent/.developer"), "{\"name\":\"Felix\"}").unwrap();
        fs::write(root.join(".emb-agent/.current-task"), "task-1\n").unwrap();
        fs::write(
            root.join(".emb-agent/tasks/task-1/task.json"),
            "{\"title\":\"Implement ADC\",\"status\":\"active\",\"priority\":\"P1\"}",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/wiki/chips/esp32-c3.md"),
            "# ESP32-C3\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn reads_project_snapshot() {
        let root = temp_project();
        let snapshot = snapshot_from_cwd(root.to_str().unwrap());
        assert!(snapshot.initialized);
        assert_eq!(snapshot.mcu_model, "ESP32-C3");
        assert_eq!(snapshot.mcu_package, "QFN32");
        assert_eq!(snapshot.developer, "Felix");
        assert_eq!(snapshot.open_tasks, 1);
        assert_eq!(snapshot.wiki_pages, 1);
        assert_eq!(snapshot.recommended_command, "do");
        assert_eq!(snapshot.current_task.unwrap().title, "Implement ADC");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn builds_host_payloads() {
        let message = "hello\nworld";
        assert!(build_host_session_start_payload("pi", message).contains("hookSpecificOutput"));
        assert!(build_host_session_start_payload("codex", message).contains("suppressOutput"));
        assert!(build_host_session_start_payload("cursor", message).contains("additional_context"));
    }

    #[test]
    fn json_quote_escapes_control_chars() {
        assert_eq!(json_quote("a\"b\\c\n"), "\"a\\\"b\\\\c\\n\"");
    }

    #[test]
    fn statusline_includes_core_state() {
        let root = temp_project();
        let snapshot = snapshot_from_cwd(root.to_str().unwrap());
        let line = build_statusline(&snapshot);
        assert!(line.contains("emb-rs"));
        assert!(line.contains("ESP32-C3 QFN32"));
        assert!(line.contains("1 task(s)"));
        assert!(line.contains("[P1] Implement ADC"));
        let _ = fs::remove_dir_all(root);
    }
}
