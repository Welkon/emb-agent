use crate::hardware::project::{ProjectSnapshot, TaskSnapshot};
use crate::json::json_quote;
use crate::task::{WorktreePolicy, worktree_policy_json};
use serde_json::{Value, json};

fn response_language_instruction(language: &str) -> &'static str {
    match language.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh_cn" | "zh-hans" | "zh_hans" | "cn" | "chinese" | "中文"
        | "简体中文" => {
            "Respond to the user in Simplified Chinese (中文), unless the user explicitly asks for another language."
        }
        "en" | "english" | "英文" => {
            "Respond to the user in English, unless the user explicitly asks for another language."
        }
        _ => "",
    }
}

fn is_declared_chip(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("unknown")
}

pub fn build_statusline(snapshot: &ProjectSnapshot) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return "emb · onboard".to_string();
    }

    let mut parts = vec!["emb".to_string()];
    if !snapshot.active_variant.is_empty() {
        parts.push(format!("var: {}", snapshot.active_variant));
    }

    if is_declared_chip(&snapshot.mcu_model) {
        let chip = if is_declared_chip(&snapshot.mcu_package) {
            format!("{} {}", snapshot.mcu_model, snapshot.mcu_package)
        } else {
            snapshot.mcu_model.clone()
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
        return "\
<emb-agent-session-context>
emb-agent workspace not yet initialized for this project.

You are the user's embedded development assistant. Start with onboarding, not implementation:

1. Invoke `emb-onboard` or run `/emb:onboard` if the host exposes slash commands.
2. emb-onboard must inspect whether this is an empty repo, a partial `.emb-agent/`, or an existing firmware repo with scattered datasheets, schematics, pin maps, build files, and notes.
3. If the user already knows MCU/package/pins, record them through the onboard flow or `declare hardware` after explicit confirmation.
4. If truth lives in docs, use onboard's migration audit first; do not guess hardware facts from filenames or README prose.
5. After onboarding completes, run `/emb:next --brief` and follow its recommendation.
6. Match your response language to the user's language.
</emb-agent-session-context>".to_string();
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
    let language_instruction = response_language_instruction(&snapshot.language);
    if !language_instruction.is_empty() {
        lines.push(format!("Response language: {}", language_instruction));
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
            "Trigger the Pi slash command `/emb:{}` NOW and follow its output exactly. Do NOT run this through bash, Node, pi dist/index.js, or emb-agent-rs directly. Do NOT manually explore files or decide next steps on your own until you have its recommendation.",
            snapshot.recommended_command
        ),
        String::new(),
        "Rules:".to_string(),
        "- Do NOT re-run `start` on subsequent turns.".to_string(),
        "- `/emb:*` is a Pi slash command handled by the extension UI, not a shell command.".to_string(),
        "- Never execute `/emb:*` via bash or by invoking pi-coding-agent dist/index.js.".to_string(),
        "- If the user asks to extract/parse/ingest a schematic or board file, trigger `/emb:ingest schematic --file <path>` or `/emb:ingest board --file <path>` first; do not read/head/xxd binary SchDoc/PcbDoc files manually.".to_string(),
        "- After the slash command returns, follow its output.".to_string(),
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
        lines.push(format!("**Active variant**: {}\n", snapshot.active_variant));
    }

    if is_declared_chip(&snapshot.mcu_model) {
        let chip = if is_declared_chip(&snapshot.mcu_package) {
            format!("{} ({})", snapshot.mcu_model, snapshot.mcu_package)
        } else {
            snapshot.mcu_model.clone()
        };
        lines.push(format!("**Current chip**: {}\n", chip));
    }

    if snapshot.open_tasks > 0 {
        lines.push(format!("**Open tasks**: {}\n", snapshot.open_tasks));
    }

    if let Some(task) = &snapshot.current_task {
        lines.push(format!(
            "**Active task**: `{}` — {} [{}]\n",
            task.name, task.title, task.priority
        ));
    }

    lines.extend([
        "\nWhat you can do next:".to_string(),
        "1. **Describe your goal** (e.g., \"review the schematic\") — I will route it to the right task.".to_string(),
        "2. Run `/emb:next` — see the recommended workflow step.".to_string(),
        "3. Ask me \"what should I do next?\" — I will show available tasks and wait for your selection.".to_string(),
        "4. Run `/emb:status` — view project state.".to_string(),
    ]);

    lines.join("\n")
}

pub fn build_host_session_start_payload(host: &str, message: &str, welcome: &str) -> String {
    let event_name = "SessionStart";
    match host {
        "cursor" => format!("{{\"additional_context\":{}}}", json_quote(message)),
        "codex" => {
            let mut context = message.to_string();
            if !welcome.is_empty() {
                context.push_str("\n\n");
                context.push_str(welcome);
            }
            format!(
                "{{\"suppressOutput\":true,\"systemMessage\":{},\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
                json_quote(&format!(
                    "emb-agent rust context injected ({} chars)",
                    context.len()
                )),
                json_quote(event_name),
                json_quote(&context)
            )
        }
        _ => {
            let welcome_json = if welcome.is_empty() {
                "null".to_string()
            } else {
                json_quote(welcome)
            };
            format!(
                "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{},\"welcome\":{}}}}}",
                json_quote(event_name),
                json_quote(message),
                welcome_json
            )
        }
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
    if snapshot.recommended_command == "onboard" {
        return (
            "onboard".to_string(),
            "Project needs onboarding. Invoke emb-onboard to scaffold .emb-agent/ or migrate existing hardware truth before implementation.".to_string(),
        );
    }
    if snapshot.recommended_command == "clarify" {
        return (
            "clarify".to_string(),
            "Run PRD exploration as a doc-grounded grilling loop: ask one load-bearing question at a time, update PRD/req truth after confirmation, run health after truth edits, and stop before task creation until the state-machine checklist is explicit.".to_string(),
        );
    }
    if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Limit reads to task PRD + hw.yaml + req.yaml + scoped source files. Use the task brief's exact waveform/measurement params directly without re-extraction. Trigger `/emb:do`.".to_string(),
        )
    } else if snapshot.open_tasks > 0 {
        (
            "choose-work".to_string(),
            "Open tasks exist but none is active. Present candidates as options, classify the work, fill a durable agent brief, split large work into vertical tracer-bullet slices, and activate only after explicit ready-task selection.".to_string(),
        )
    } else if snapshot.bootstrap_status != "ready" && snapshot.bootstrap_status != "concept" {
        (
            "bootstrap".to_string(),
            "Project needs bootstrap. Trigger `/emb:bootstrap status`.".to_string(),
        )
    } else {
        (
            "task add".to_string(),
            "No tasks exist. Ask what work to start, classify it, then trigger `/emb:task add <summary>` only after the scope is clear enough to draft an agent brief and verification surface.".to_string(),
        )
    }
}

pub fn build_next_json(snapshot: &ProjectSnapshot) -> String {
    build_next_json_with_tasks(snapshot, &[])
}

pub fn build_next_json_with_tasks(snapshot: &ProjectSnapshot, tasks: &[TaskSnapshot]) -> String {
    build_next_json_with_tasks_and_policy(snapshot, tasks, None)
}

pub fn build_next_json_with_tasks_and_policy(
    snapshot: &ProjectSnapshot,
    tasks: &[TaskSnapshot],
    worktree_policy: Option<&WorktreePolicy>,
) -> String {
    let has_truth_errors = !snapshot.truth_validation_errors.is_empty();
    let truth_errors_summary = snapshot.truth_validation_errors.join("; ");
    let (action, instructions) = if has_truth_errors {
        (
            "repair-truth",
            "Project truth validation failed. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml, then run `emb-agent health` before continuing. Do not start implementation while truth files are invalid.",
        )
    } else if snapshot.recommended_command == "onboard" {
        (
            "onboard",
            "Project needs onboarding. Invoke emb-onboard or trigger `/emb:onboard`; audit existing hardware docs before declaring hardware or implementing.",
        )
    } else if snapshot.recommended_command == "clarify" {
        (
            "clarify",
            "Run PRD exploration as a doc-grounded grilling loop: challenge ambiguous terms against existing project truth, ask one load-bearing behavior/hardware/power/state-machine question at a time, update docs/prd/system.md and .emb-agent/req.yaml after confirmation, run emb-agent validate or health after truth edits, and stop before task creation until the compact state-machine checklist is explicit.",
        )
    } else if snapshot.current_task.is_some() {
        (
            "do",
            "Active task exists. Before implementation: 1) Limit initial file reads to the active task PRD, .emb-agent/hw.yaml, .emb-agent/req.yaml, and the source files directly under the task scope — do not scan unrelated project files, migration docs, or other projects. 2) If the task brief contains exact waveform/measurement params, use them directly; do not re-extract or re-measure. Trigger `/emb:do` only after the active task is briefed enough to execute.",
        )
    } else if snapshot.open_tasks > 0 {
        (
            "choose-work",
            "Open tasks exist but none is active. Present `task_candidates` as existing-work options, and classify the desired path as bug, feature, board-bringup, power, timing, or toolchain. Existing or new work must have a durable agent brief and a vertical tracer-bullet slice before activation. Trigger `/emb:task activate <name>` only after explicit task selection and enough acceptance/verification detail.",
        )
    } else if snapshot.bootstrap_status != "ready" && snapshot.bootstrap_status != "concept" {
        (
            "bootstrap",
            "Project needs bootstrap. Trigger `/emb:bootstrap status`.",
        )
    } else {
        (
            snapshot.recommended_command.as_str(),
            snapshot.task_intake_summary.as_str(),
        )
    };

    let active_task = json_value_or_null(&build_task_json(snapshot));
    let language_instruction = response_language_instruction(&snapshot.language);
    let task_candidates = json_value_or_null(&build_task_candidates_json(tasks));
    let agent_protocol = json_value_or_null(&build_next_agent_protocol_with_policy(
        snapshot,
        action,
        worktree_policy,
    ));
    let mut payload = json!({
        "status": "ok",
        "variant": snapshot.active_variant,
        "language": snapshot.language,
        "language_instruction": language_instruction,
        "action": action,
        "reason": snapshot.recommended_reason,
        "workflow_state": snapshot.workflow_state,
        "bootstrap_status": snapshot.bootstrap_status,
        "active_task": active_task,
        "open_tasks": snapshot.open_tasks,
        "task_candidates": task_candidates,
        "instructions": instructions,
        "agent_protocol": agent_protocol,
        "requirements_unknown_count": snapshot.requirements_unknown_count,
        "hardware_unknown_count": snapshot.hardware_unknown_count,
        "truth_validation_errors": snapshot.truth_validation_errors,
        "truth_validation_summary": truth_errors_summary
    });
    if let Some(policy) = worktree_policy
        && let Some(obj) = payload.as_object_mut()
    {
        obj.insert("worktree_policy".to_string(), worktree_policy_json(policy));
    }
    serde_json::to_string(&payload).unwrap_or_default()
}

fn build_task_candidates_json(tasks: &[TaskSnapshot]) -> String {
    let items: Vec<String> = tasks
        .iter()
        .filter(|task| {
            task.status != "closed" && task.status != "done" && task.status != "resolved"
        })
        .map(|task| {
            format!(
                "{{\"name\":{},\"title\":{},\"status\":{},\"priority\":{},\"package\":{}}}",
                json_quote(&task.name),
                json_quote(&task.title),
                json_quote(&task.status),
                json_quote(&task.priority),
                json_quote(&task.package)
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn build_next_agent_protocol_with_policy(
    snapshot: &ProjectSnapshot,
    action: &str,
    worktree_policy: Option<&WorktreePolicy>,
) -> String {
    if let Some(policy) = worktree_policy
        && policy.decision == "required"
        && !policy.target_task.is_empty()
    {
        return json!({
            "gate": {
                "kind": "worktree-required",
                "blocking": true,
                "reason": policy.reason,
                "allowed_actions": ["present_worktree_reason", "trigger_task_activate_with_worktree"],
                "forbidden_actions": ["continue_in_main_workspace", "ask_user_to_run_task_activate", "run_shell_command_for_emb_slash_command"],
                "recommended_command": policy.recommended_command
            }
        })
        .to_string();
    }
    if action == "repair-truth" {
        return json!({
            "gate": {
                "kind": "truth-validation",
                "blocking": true,
                "allowed_actions": ["repair_truth_yaml", "run_health_after_repair", "explain_validation_errors"],
                "forbidden_actions": ["start_implementation", "create_task", "activate_task", "ignore_truth_validation_errors"],
                "recommended_command": "/emb:next"
            }
        })
        .to_string();
    }
    if action == "clarify" {
        return json!({
            "gate": {
                "kind": "prd-exploration",
                "blocking": true,
                "method": "grill-with-docs",
                "state_machine_checklist": ["boot_state", "first_input", "press_vs_release_trigger", "mode_cycle_including_off", "long_press_valid_states", "memory_semantics", "stop_entry", "wake_source", "low_voltage_behavior", "acceptance_evidence", "extract_exact_waveform_or_measurement_params_from_captures"],
                "allowed_actions": ["brainstorm_with_user", "ask_one_load_bearing_question", "challenge_terms_against_truth", "update_prd_and_req_truth", "record_confirmed_decisions", "run_health_after_truth_edits", "extract_and_record_exact_timing_percent_times_from_captures"],
                "forbidden_actions": ["create_implementation_task_without_confirmed_scope", "start_implementation", "select_mcu_without_confirmed_constraints", "force_existing_task_activation", "declare_requirements_complete_without_health_check", "batch_unconfirmed_decisions", "implement_from_guessed_waveform_params"],
                "recommended_command": "/emb:next"
            }
        })
        .to_string();
    }

    if action == "onboard" {
        return json!({
            "gate": {
                "kind": "onboarding",
                "blocking": true,
                "allowed_actions": ["invoke_emb_onboard_agent", "trigger_emb_onboard_command", "audit_existing_hardware_docs"],
                "forbidden_actions": ["start_implementation", "guess_hardware_truth", "declare_hardware_without_confirmation"],
                "recommended_agent": "emb-onboard",
                "recommended_command": "/emb:onboard"
            }
        })
        .to_string();
    }
    if action == "choose-work" && snapshot.open_tasks > 0 {
        return json!({
            "gate": {
                "kind": "work-selection",
                "blocking": true,
                "method": "triage-agent-brief-vertical-slice",
                "categories": ["bug", "feature", "board-bringup", "power", "timing", "toolchain"],
                "triage_states": ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
                "required_brief_fields": ["current_behavior", "desired_behavior", "hardware_facts", "firmware_interfaces", "acceptance_criteria", "out_of_scope", "required_verification"],
                "slice_rule": "Use vertical tracer-bullet slices: each slice must deliver one narrow but complete observable path across firmware, hardware truth, docs, and verification surfaces.",
                "allowed_actions": ["present_existing_task_candidates", "classify_work_category", "offer_new_task_or_bug", "ask_user_to_choose_work_path", "draft_agent_brief", "split_into_vertical_slices", "trigger_task_activate_after_explicit_ready_task_choice", "trigger_task_add_after_scope_clear"],
                "forbidden_actions": ["force_existing_task_activation", "ask_user_to_run_task_list", "ask_user_to_run_task_activate", "invent_task_name", "start_implementation_without_selected_or_created_ready_task", "run_shell_command_for_emb_slash_command", "create_horizontal_layer_tasks"],
                "recommended_command": "/emb:next"
            }
        }).to_string();
    }
    "{\"gate\":{\"kind\":\"none\",\"blocking\":false}}".to_string()
}

fn json_value_or_null(source: &str) -> Value {
    serde_json::from_str(source).unwrap_or(Value::Null)
}

pub fn build_status_json(snapshot: &ProjectSnapshot) -> String {
    let active_task_name = snapshot
        .current_task
        .as_ref()
        .map(|task| task.name.as_str())
        .unwrap_or("");
    format!(
        "{{\"status\":\"ok\",\"language\":{},\"language_instruction\":{},\"project\":{{\"root\":{},\"initialized\":{},\"active_variant\":{},\"variant_dir\":{},\"mcu\":{},\"package\":{},\"developer\":{},\"branch\":{},\"bootstrap\":{},\"workflow\":{}}},\"tasks\":{{\"open\":{},\"wiki_pages\":{},\"active\":{}}},\"next\":{{\"command\":{},\"reason\":{},\"task_intake\":{}}},\"truth_validation_errors\":{}}}",
        json_quote(&snapshot.language),
        json_quote(&response_language_instruction(&snapshot.language)),
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
        json_quote(active_task_name),
        json_quote(&snapshot.recommended_command),
        json_quote(&snapshot.recommended_reason),
        json_quote(&snapshot.task_intake_summary),
        serde_json::to_string(&snapshot.truth_validation_errors)
            .unwrap_or_else(|_| "[]".to_string())
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
    let truth_valid = snapshot.truth_validation_errors.is_empty();
    let checks = [
        (
            "project_initialized",
            initialized,
            "Project has .emb-agent directory".to_string(),
        ),
        (
            "truth_yaml_valid",
            truth_valid,
            if truth_valid {
                "hw.yaml and req.yaml passed structural validation".to_string()
            } else {
                format!(
                    "Truth validation errors: {}",
                    snapshot.truth_validation_errors.join("; ")
                )
            },
        ),
        (
            "mcu_declared",
            has_mcu,
            "MCU model is declared in hw.yaml".to_string(),
        ),
        (
            "bootstrap_ready",
            snapshot.bootstrap_status == "ready",
            "Bootstrap is complete".to_string(),
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
        "{{\"status\":{},\"pass\":{},\"fail\":{},\"warn\":0,\"truth_validation_errors\":{},\"checks\":[{}]}}",
        json_quote(if fail_count == 0 { "pass" } else { "fail" }),
        pass_count,
        fail_count,
        serde_json::to_string(&snapshot.truth_validation_errors)
            .unwrap_or_else(|_| "[]".to_string()),
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
            language: "zh".to_string(),
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
            requirements_unknown_count: 0,
            hardware_unknown_count: 0,
            truth_validation_errors: Vec::new(),
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
        assert!(line.contains("var: esp32-c3"));
        assert!(line.contains("[P1] Implement ADC"));
    }

    #[test]
    fn statusline_treats_unknown_chip_as_undeclared() {
        let mut snapshot = sample_snapshot();
        snapshot.mcu_model = "unknown".to_string();
        snapshot.mcu_package = "unknown".to_string();
        let line = build_statusline(&snapshot);
        assert!(line.contains("chip: undeclared"));
        assert!(!line.contains("unknown/unknown"));
        assert!(!line.contains("unknown unknown"));
    }

    #[test]
    fn start_json_includes_active_task() {
        let json = build_start_json(&sample_snapshot());
        assert!(json.contains("\"status\":\"ok\""));
        assert!(json.contains("\"runtime\":\"/emb:agent\""));
        assert!(json.contains("\"active_task\""));
        assert!(json.contains("Implement ADC"));
    }

    #[test]
    fn json_and_context_include_response_language_instruction() {
        let status: serde_json::Value =
            serde_json::from_str(&build_status_json(&sample_snapshot())).unwrap();
        assert_eq!(status["language"], "zh");
        assert_eq!(
            status["language_instruction"],
            "Respond to the user in Simplified Chinese (中文), unless the user explicitly asks for another language."
        );
        assert_eq!(status["tasks"]["active"], "task-1");

        let next: serde_json::Value =
            serde_json::from_str(&build_next_json(&sample_snapshot())).unwrap();
        assert_eq!(next["language"], "zh");
        assert_eq!(next["language_instruction"], status["language_instruction"]);

        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("Response language: Respond to the user in Simplified Chinese"));
    }

    #[test]
    fn session_context_treats_emb_as_slash_command_not_shell_cli() {
        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("Trigger the Pi slash command `/emb:do` NOW"));
        assert!(context.contains("not a shell command"));
        assert!(context.contains("Never execute `/emb:*` via bash"));
        assert!(!context.contains("Recommended command IS a CLI command"));
    }
}
