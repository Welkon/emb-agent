use crate::hardware::project::ProjectSnapshot;
use crate::json::json_quote;

pub fn build_statusline(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return String::new();
    }

    let mut parts = vec!["emb".to_string()];
    if !snapshot.active_variant.is_empty() {
        parts.push(format!("variant: {}", snapshot.active_variant));
    }
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

pub fn build_session_context(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return "<emb-agent-session-context>\nNo emb-agent project found. Run emb-agent init/bootstrap from the project root.\n</emb-agent-session-context>".to_string();
    }

    let welcome = build_welcome_message(snapshot);
    let welcome_block = if welcome.is_empty() {
        String::new()
    } else {
        format!(
            "<user-welcome>\nThe following welcome was shown to the user at session start. Greet the user briefly using this context, then wait for their first request.\n\n{}\n</user-welcome>\n\n",
            welcome
        )
    };

    let mut lines = vec![
        welcome_block,
        "<emb-agent-session-context>".to_string(),
        "emb-agent startup context is already injected for this session.".to_string(),
        "Do not ask the user to run start just to load bootstrap state.".to_string(),
        "Use the injected state below as the source of truth and continue from the recommended next step.".to_string(),
        "</emb-agent-session-context>".to_string(),
        String::new(),
        "<current-state>".to_string(),
        format!("Project root: {}", snapshot.project_root),
        format!("Active variant: {}", fallback(&snapshot.active_variant, "(none)")),
        format!("Variant state dir: {}", fallback(&snapshot.variant_dir, "(root .emb-agent)")),
        format!("Bootstrap status: {}", snapshot.bootstrap_status),
        format!("Workflow state: {}", snapshot.workflow_state),
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

    if !snapshot.task_intake_summary.is_empty() {
        lines.push(format!("Task intake: {}", snapshot.task_intake_summary));
    }

    lines.extend([
        "</current-state>".to_string(),
        String::new(),
        "<ready>".to_string(),
        "HARD GATE — your first action in this session:".to_string(),
        format!(
            "Run `/emb:{}` NOW and follow its output exactly. Do NOT manually explore files or decide next steps on your own until you have its recommendation.",
            snapshot.recommended_command
        ),
        String::new(),
        "Rules:".to_string(),
        "- Do NOT re-run `start` on subsequent turns.".to_string(),
        "- The Recommended command IS a CLI command — execute it, don't treat it as a conversational hint.".to_string(),
        "- After running the recommended command, follow its output.".to_string(),
        "</ready>".to_string(),
    ]);

    lines.join("\n")
}

pub fn build_welcome_message(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return String::new();
    }

    let mut lines = vec!["# Hi\n".to_string()];

    if !snapshot.active_variant.is_empty() {
        lines.push(format!("**当前变体**: {}\n", snapshot.active_variant));
    }

    if !snapshot.mcu_model.is_empty() {
        let chip = if snapshot.mcu_package.is_empty() {
            snapshot.mcu_model.clone()
        } else {
            format!("{} ({})", snapshot.mcu_model, snapshot.mcu_package)
        };
        lines.push(format!("**当前芯片**: {}\n", chip));
    }

    if snapshot.open_tasks > 0 {
        lines.push(format!("**待处理任务**: {} 个\n", snapshot.open_tasks));
    }

    if let Some(task) = &snapshot.current_task {
        lines.push(format!(
            "**当前任务**: `{}` — {} [{}]\n",
            task.name, task.title, task.priority
        ));
    }

    lines.extend([
        "\n接下来你可以：".to_string(),
        "1. **直接说出需求**（比如「帮我检查原理图」）— 我会自动分配任务".to_string(),
        "2. 输入 `/emb:next` — 查看推荐工作流".to_string(),
        "3. 输入 `/emb:task list` — 浏览任务列表".to_string(),
        "4. 输入 `/emb:status` — 查看项目状态".to_string(),
    ]);

    lines.join("\n")
}

pub fn build_host_session_start_payload(host: &str, message: &str, welcome: &str) -> String {
    let event_name = "SessionStart";
    let welcome_json = if welcome.is_empty() {
        "null".to_string()
    } else {
        json_quote(welcome)
    };
    match host {
        "cursor" => format!("{{\"additional_context\":{}}}", json_quote(message)),
        "codex" => format!(
            "{{\"suppressOutput\":true,\"systemMessage\":{},\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{},\"welcome\":{}}}}}",
            json_quote(&format!(
                "emb-agent rust context injected ({} chars)",
                message.len()
            )),
            json_quote(event_name),
            json_quote(message),
            welcome_json
        ),
        _ => format!(
            "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{},\"welcome\":{}}}}}",
            json_quote(event_name),
            json_quote(message),
            welcome_json
        ),
    }
}

pub fn build_start_json(snapshot: &ProjectSnapshot) -> String {
    let task_json = build_task_json(snapshot);
    format!(
        "{{\"status\":\"ok\",\"runtime\":\"/emb:agent\",\"summary\":{{\"initialized\":{},\"project_root\":{},\"active_variant\":{},\"variant_dir\":{},\"mcu_model\":{},\"mcu_package\":{},\"open_tasks\":{},\"wiki_pages\":{},\"active_task\":{}}},\"immediate\":{{\"command\":{},\"reason\":{}}}}}",
        snapshot.initialized,
        json_quote(&snapshot.project_root),
        json_quote(&snapshot.active_variant),
        json_quote(&snapshot.variant_dir),
        json_quote(&snapshot.mcu_model),
        json_quote(&snapshot.mcu_package),
        snapshot.open_tasks,
        snapshot.wiki_pages,
        task_json,
        json_quote(&snapshot.recommended_command),
        json_quote(&snapshot.recommended_reason)
    )
}

pub fn build_next_routing(snapshot: &ProjectSnapshot) -> (String, String) {
    if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Run `/emb:do` to continue implementation.".to_string(),
        )
    } else if snapshot.open_tasks > 0 {
        ("activate".to_string(), "Tasks exist but none active. Run `/emb:task list` to see tasks, then `/emb:task activate <name>` to start working.".to_string())
    } else if snapshot.bootstrap_status != "ready" {
        (
            "bootstrap".to_string(),
            "Project needs bootstrap. Run `/emb:bootstrap status`.".to_string(),
        )
    } else {
        (
            "task add".to_string(),
            "No tasks exist. Create one with `/emb:task add <summary>`.".to_string(),
        )
    }
}

pub fn build_next_json(snapshot: &ProjectSnapshot) -> String {
    let task_json = build_task_json(snapshot);
    let (action, instructions) = if snapshot.current_task.is_some() {
        (
            "do",
            "Active task exists. Run `/emb:do` to continue implementation.",
        )
    } else if snapshot.open_tasks > 0 {
        (
            "activate",
            "Tasks exist but none active. Run `/emb:task list` to see tasks, then `/emb:task activate <name>` to activate the one you want to work on.",
        )
    } else if snapshot.bootstrap_status != "ready" {
        (
            "bootstrap",
            "Project needs bootstrap. Run `/emb:bootstrap status`.",
        )
    } else {
        (
            snapshot.recommended_command.as_str(),
            snapshot.task_intake_summary.as_str(),
        )
    };
    format!(
        "{{\"status\":\"ok\",\"variant\":{},\"action\":{},\"reason\":{},\"workflow_state\":{},\"bootstrap_status\":{},\"active_task\":{},\"open_tasks\":{},\"instructions\":{}}}",
        json_quote(&snapshot.active_variant),
        json_quote(action),
        json_quote(&snapshot.recommended_reason),
        json_quote(&snapshot.workflow_state),
        json_quote(&snapshot.bootstrap_status),
        task_json,
        snapshot.open_tasks,
        json_quote(instructions)
    )
}

pub fn build_status_json(snapshot: &ProjectSnapshot) -> String {
    let task_json = build_task_json(snapshot);
    format!(
        "{{\"status\":\"ok\",\"project\":{{\"root\":{},\"initialized\":{},\"active_variant\":{},\"variant_dir\":{},\"mcu\":{},\"package\":{},\"developer\":{},\"branch\":{},\"bootstrap\":{},\"workflow\":{}}},\"tasks\":{{\"open\":{},\"wiki_pages\":{},\"active\":{}}},\"next\":{{\"command\":{},\"reason\":{},\"task_intake\":{}}}}}",
        json_quote(&snapshot.project_root),
        snapshot.initialized,
        json_quote(&snapshot.active_variant),
        json_quote(&snapshot.variant_dir),
        json_quote(&snapshot.mcu_model),
        json_quote(&snapshot.mcu_package),
        json_quote(&snapshot.developer),
        json_quote(&snapshot.git_branch),
        json_quote(&snapshot.bootstrap_status),
        json_quote(&snapshot.workflow_state),
        snapshot.open_tasks,
        snapshot.wiki_pages,
        task_json,
        json_quote(&snapshot.recommended_command),
        json_quote(&snapshot.recommended_reason),
        json_quote(&snapshot.task_intake_summary)
    )
}

fn build_task_json(snapshot: &ProjectSnapshot) -> String {
    if let Some(task) = &snapshot.current_task {
        format!(
            "{{\"name\":{},\"title\":{},\"status\":{},\"priority\":{}}}",
            json_quote(&task.name),
            json_quote(&task.title),
            json_quote(&task.status),
            json_quote(&task.priority)
        )
    } else {
        "null".to_string()
    }
}

pub fn build_task_list_json(tasks: &[crate::hardware::project::TaskSnapshot]) -> String {
    let items: Vec<String> = tasks
        .iter()
        .map(|t| {
            format!(
                "{{\"name\":{},\"title\":{},\"status\":{},\"priority\":{}}}",
                json_quote(&t.name),
                json_quote(&t.title),
                json_quote(&t.status),
                json_quote(&t.priority)
            )
        })
        .collect();
    format!(
        "{{\"status\":\"ok\",\"tasks\":[{}],\"count\":{}}}",
        items.join(","),
        tasks.len()
    )
}

pub fn build_task_show_json(task_json: &str) -> String {
    format!("{{\"status\":\"ok\",\"task\":{}}}", task_json)
}

pub fn build_health_json(snapshot: &ProjectSnapshot) -> String {
    let initialized = snapshot.initialized;
    let has_mcu = !snapshot.mcu_model.is_empty();
    let _has_task = snapshot.current_task.is_some();
    let checks = [
        (
            "project_initialized",
            initialized,
            "Project has .emb-agent directory",
        ),
        ("mcu_declared", has_mcu, "MCU model is declared in hw.yaml"),
        (
            "bootstrap_ready",
            snapshot.bootstrap_status == "ready",
            "Bootstrap is complete",
        ),
    ];
    let pass_count = checks.iter().filter(|(_, ok, _)| *ok).count();
    let fail_count = checks.len() - pass_count;
    let checks_json: Vec<String> = checks
        .iter()
        .map(|(name, ok, desc)| {
            format!(
                "{{\"name\":{},\"pass\":{},\"description\":{}}}",
                json_quote(name),
                ok,
                json_quote(desc)
            )
        })
        .collect();
    format!(
        "{{\"status\":{},\"pass\":{},\"fail\":{},\"warn\":0,\"checks\":[{}]}}",
        json_quote(if fail_count == 0 { "pass" } else { "fail" }),
        pass_count,
        fail_count,
        checks_json.join(",")
    )
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
    use crate::hardware::project::{ProjectSnapshot, TaskSnapshot};

    fn sample_snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            initialized: true,
            project_root: "/tmp/demo".to_string(),
            active_variant: "esp32-c3".to_string(),
            variant_dir: "/tmp/demo/.emb-agent/variants/esp32-c3".to_string(),
            developer: "Felix".to_string(),
            mcu_model: "ESP32-C3".to_string(),
            mcu_package: "QFN32".to_string(),
            default_package: "core".to_string(),
            active_package: "core".to_string(),
            git_branch: "beta".to_string(),
            open_tasks: 1,
            wiki_pages: 1,
            current_task: Some(TaskSnapshot {
                name: "task-1".to_string(),
                title: "Implement ADC".to_string(),
                status: "active".to_string(),
                priority: "P1".to_string(),
                package: "core".to_string(),
            }),
            recommended_command: "do".to_string(),
            recommended_reason: "Active task is selected".to_string(),
            bootstrap_status: "ready".to_string(),
            workflow_state: "task_active".to_string(),
            has_hardware_truth: true,
            task_intake_summary: String::new(),
        }
    }

    #[test]
    fn builds_host_payloads() {
        let message = "hello\nworld";
        assert!(build_host_session_start_payload("pi", message, "").contains("hookSpecificOutput"));
        assert!(build_host_session_start_payload("codex", message, "").contains("suppressOutput"));
        assert!(
            build_host_session_start_payload("cursor", message, "").contains("additional_context")
        );
    }

    #[test]
    fn statusline_includes_core_state() {
        let line = build_statusline(&sample_snapshot());
        assert!(line.contains("emb"));
        assert!(line.contains("ESP32-C3 QFN32"));
        assert!(line.contains("1 task(s)"));
        assert!(line.contains("[P1] Implement ADC"));
    }

    #[test]
    fn start_json_includes_active_task() {
        let json = build_start_json(&sample_snapshot());
        assert!(json.contains("\"status\":\"ok\""));
        assert!(json.contains("\"runtime\":\"/emb:agent\""));
        assert!(json.contains("\"active_task\""));
        assert!(json.contains("Implement ADC"));
    }
}
