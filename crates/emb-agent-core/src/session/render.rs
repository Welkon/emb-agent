use crate::hardware::project::{ProjectSnapshot, TaskSnapshot};
use crate::json::json_quote;
use crate::task::{WorktreePolicy, worktree_policy_json};
use serde_json::{Value, json};
use std::path::Path;

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

1. Invoke `emb-onboard` or run `/emb-onboard` if the host exposes slash commands.
2. emb-onboard must inspect whether this is an empty repo, a partial `.emb-agent/`, or an existing firmware repo with scattered datasheets, schematics, pin maps, build files, and notes.
3. If the user already knows MCU/package/pins, record them through the onboard flow or `declare hardware` after explicit confirmation.
4. If truth lives in docs, use onboard's migration audit first; do not guess hardware facts from filenames or README prose.
5. After onboarding completes, run `/emb-next` and follow its recommendation.
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
    lines.push(format!(
        "PRD: system={}, substantive={}, child_prds={}",
        snapshot.system_prd_exists, snapshot.system_prd_has_content, snapshot.child_prd_count
    ));
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
        "Routing gate — before implementation or broad file exploration:".to_string(),
        "Run the current host's emb-next entry (for example `/emb-next`, `$emb-next`, or the installed runtime command `node .<host>/emb-agent/bin/emb-agent.cjs next --brief`) and follow `agent_protocol.gate` exactly.".to_string(),
        "Do not manually explore files or decide next steps on your own until you have that routing recommendation.".to_string(),
        String::new(),
        "Rules:".to_string(),
        "- Do NOT re-run `start` on subsequent turns.".to_string(),
        "- `/emb:<command>` examples in command docs denote emb-agent runtime intent; use the equivalent host command surface or installed runtime command, not a bare shell literal.".to_string(),
        "- If the user asks to extract/parse/ingest a schematic or board file, route through emb-agent ingest first; do not read/head/xxd binary SchDoc/PcbDoc files manually.".to_string(),
        "- After the routing or ingest command returns, follow its output.".to_string(),
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
        "2. Run `/emb-next` — see the recommended workflow step.".to_string(),
        "3. Ask me \"what should I do next?\" — I will show available tasks and wait for your selection.".to_string(),
        "4. Run `status --brief` through the emb-agent runtime — view project state.".to_string(),
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
    if snapshot.recommended_command == "ingest-docs" {
        return (
            "ingest-docs".to_string(),
            "Ingest the MCU manual/datasheet before firmware work. Run the installed runtime command `ingest doc --file <manual.pdf> --provider mineru --kind datasheet --to hardware`, then verify register/GPIO/ADC/timer/sleep evidence.".to_string(),
        );
    }
    if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Limit reads to task PRD + hw.yaml + req.yaml + scoped source files. Use the task brief's exact waveform/measurement params directly without re-extraction. Trigger `/emb:do`.".to_string(),
        )
    } else if snapshot.recommended_command == "prd-breakdown" {
        (
            "prd-breakdown".to_string(),
            "System PRD exists but no child execution PRDs or open tasks exist. First: read hw.yaml, req.yaml, MCU manual, and vendor examples; analyze constraints (ROM/RAM, real-time, peripherals, power); propose the best program framework with reasoning; wait for agreement. Then: create a program-framework task PRD. Finally: present functional vertical slice candidates; create each only after user confirms.".to_string(),
        )
    } else if snapshot.recommended_command == "choose-work" || snapshot.open_tasks > 0 {
        (
            "choose-work".to_string(),
            "Present existing tasks or child PRD candidates as options, classify the work, fill a durable agent brief, split large work into vertical tracer-bullet slices, and activate/create only after explicit ready-work selection.".to_string(),
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
            "Project truth validation failed. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml, then run the installed emb-agent runtime's health command before continuing. Do not start implementation while truth files are invalid.",
        )
    } else if snapshot.recommended_command == "onboard" {
        (
            "onboard",
            "Project needs onboarding. Invoke emb-onboard or trigger `/emb-onboard`; audit existing hardware docs before declaring hardware or implementing.",
        )
    } else if snapshot.recommended_command == "clarify" {
        (
            "clarify",
            "Run PRD exploration as a doc-grounded grilling loop: challenge ambiguous terms against existing project truth, ask one load-bearing behavior/hardware/power/state-machine question at a time, update docs/prd/system.md and .emb-agent/req.yaml after confirmation, run the installed emb-agent runtime's validate or health command after truth edits, and stop before task creation until the compact state-machine checklist is explicit.",
        )
    } else if snapshot.recommended_command == "ingest-docs" {
        (
            "ingest-docs",
            "MCU/package truth exists, but parsed MCU manual or chip-support evidence is missing. Ingest the MCU manual/datasheet with `ingest doc --provider mineru`, verify register, GPIO bias/wakeup, ADC, timer/PWM, and sleep/reset evidence, then rerun next before firmware implementation or task creation.",
        )
    } else if snapshot.current_task.is_some() {
        (
            "do",
            "Active task exists. Before implementation: 1) Limit initial file reads to the active task PRD, .emb-agent/hw.yaml, .emb-agent/req.yaml, and the source files directly under the task scope — do not scan unrelated project files, migration docs, or other projects. 2) If the task brief contains exact waveform/measurement params, use them directly; do not re-extract or re-measure. Trigger `/emb:do` only after the active task is briefed enough to execute.",
        )
    } else if snapshot.recommended_command == "prd-breakdown" {
        (
            "prd-breakdown",
            "System PRD exists but no child execution PRDs or open tasks exist. Do NOT create any files until user confirms. TOOL USE: read docs/prd/system.md, hw.yaml, req.yaml, graphify-out/GRAPH_REPORT.md. For MCU specs: query graphify for register/peripheral details — NEVER read the full cached manual. If graph_health.turbovec_index is true, semantic-search is available as an experimental bonus. Step 1: analyze constraints (ROM/RAM/real-time/peripheral/power) using graph evidence; propose framework with register-level citations; wait for agreement. Step 2: create P0 framework PRD. Step 3: present P2 slices; create after confirm. Output must cite graph entities and register names — no fabricating.",
        )
    } else if snapshot.recommended_command == "choose-work" || snapshot.open_tasks > 0 {
        (
            "choose-work",
            "Present `task_candidates` as existing-task or child-PRD work options, and classify the desired path as bug, feature, board-bringup, power, timing, or toolchain. Existing or new work must have a durable agent brief and a vertical tracer-bullet slice before activation. Trigger `/emb:task activate <name>` only after explicit task selection and enough acceptance/verification detail; if the candidate is a child PRD without a task manifest, create the task from that PRD first.",
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




fn build_graph_health(snapshot: &ProjectSnapshot) -> Value {
    let graph_path = Path::new(&snapshot.project_root).join("graphify-out/graph.json");
    if !graph_path.is_file() {
        return json!({"status": "missing", "hint": "run `graphify .` to build"});
    }
    let Ok(content) = std::fs::read_to_string(&graph_path) else {
        return json!({"status": "unreadable"});
    };
    let Ok(g) = serde_json::from_str::<Value>(&content) else {
        return json!({"status": "invalid_json"});
    };
    let nodes = g.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()).unwrap_or(0);
    let communities = g.get("graph").and_then(|g| g.as_object()).map(|o| o.len()).unwrap_or(0);
    let mut noise = 0u64;
    if let Some(arr) = g.get("nodes").and_then(|n| n.as_array()) {
        for n in arr {
            let sf = n.get("source_file").and_then(|v| v.as_str()).unwrap_or("");
            if sf.starts_with(".emb-agent/bin")
                || sf.starts_with(".emb-agent/command-docs")
                || sf.starts_with(".emb-agent/agents")
                || sf.starts_with(".codex/")
                || sf.starts_with(".claude/")
                || sf.starts_with(".cursor/")
                || sf.starts_with(".omp/")
            {
                noise += 1;
            }
        }
    }
    let noise_pct = if nodes > 0 { noise * 100 / nodes as u64 } else { 0 };
    let tv_dir = Path::new(&snapshot.project_root).join(".emb-agent/cache/turbovec");
    let has_turbovec = tv_dir.is_dir() && std::fs::read_dir(&tv_dir).map_or(false, |mut d| d.any(|e| e.map_or(false, |e| e.path().extension().map_or(false, |x| x == "tq"))));
    json!({
        "status": if noise_pct > 50 { "noisy" } else if nodes == 0 { "empty" } else { "clean" },
        "nodes": nodes,
        "noise_nodes": noise,
        "noise_pct": noise_pct,
        "communities": communities,
        "turbovec_index": has_turbovec,
        "hint": if noise_pct > 50 { ".graphifyignore may be missing — run `emb init` or create one excluding .emb-agent/ runtime" } else { "" }
    })
}

    let active_task = json_value_or_null(&build_task_json(snapshot));
    let language_instruction = response_language_instruction(&snapshot.language);
    let routed_tasks = if !snapshot.prd_task_candidates.is_empty() && tasks.is_empty() {
        snapshot.prd_task_candidates.as_slice()
    } else {
        tasks
    };
    let task_candidates = json_value_or_null(&build_task_candidates_json(routed_tasks));
    let prd_task_candidates =
        json_value_or_null(&build_task_candidates_json(&snapshot.prd_task_candidates));
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
        "prd_task_candidates": prd_task_candidates,
        "prd": {
            "system_prd": snapshot.system_prd_exists,
            "system_prd_has_content": snapshot.system_prd_has_content,
            "system_prd_path": "docs/prd/system.md",
            "child_prd_count": snapshot.child_prd_count,
            "breakdown_needed": snapshot.prd_breakdown_needed,
            "child_prd_dirs": ["docs/prd/tasks", "docs/prd/features", "docs/prd/modules", "docs/prd/components", "docs/prd/subsystems"]
        },
        "instructions": instructions,
        "agent_protocol": agent_protocol,
        "requirements_unknown_count": snapshot.requirements_unknown_count,
        "hardware_unknown_count": snapshot.hardware_unknown_count,
        "truth_validation_errors": snapshot.truth_validation_errors,
        "truth_validation_summary": truth_errors_summary,
        "firmware_manual_required": snapshot.firmware_manual_required,
        "graph_health": build_graph_health(snapshot),
    });
    if let Some(policy) = worktree_policy {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("worktree_policy".to_string(), worktree_policy_json(policy));
        }
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
                "recommended_command": "/emb-next"
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
                "recommended_command": "/emb-next"
            }
        })
        .to_string();
    }
    if action == "ingest-docs" {
        return json!({
            "gate": {
                "kind": "firmware-manual-required",
                "blocking": true,
                "required_evidence": ["parsed MCU manual or datasheet", "register map", "GPIO bias/wakeup limits", "ADC reference/channel evidence", "timer/PWM evidence", "sleep/reset behavior"],
                "preprocessing": [
                    "1. ensure tools are current and installed: `uv tool upgrade markitdown 2>/dev/null; uv tool list 2>/dev/null | grep -q markitdown || uv tool install 'markitdown[all]'` (global, one-time).",
                    "2. first pass: `markitdown <manual.pdf> -o .emb-agent/cache/docs/<chip>_manual.md` (fast, local, free).",
                    "3. quality check: output <500 lines or garbled table fragments → image-heavy PDF. If MINERU_API_KEY is set, fall back to `ingest doc --provider mineru`. Otherwise warn user.",
                    "4. text-heavy PDFs (500+ clean lines) → cached .md sufficient, proceed directly."
                ],
                "allowed_actions": ["install_markitdown_if_missing", "convert_pdf_with_markitdown", "assess_output_quality", "ingest_doc_with_mineru_as_fallback_if_image_heavy", "read_cached_markdown_or_mineru_result", "record_manual_evidence", "rerun_next_after_evidence"],
                "forbidden_actions": ["create_firmware_task", "start_implementation", "declare_firmware_ready_without_manual", "guess_registers_from_pin_names", "read_raw_pdf_without_conversion", "skip_quality_check_on_markitdown_output"],
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
                "recommended_command": "/emb-onboard"
            }
        })
        .to_string();
    }
    if action == "choose-work"
        && (snapshot.open_tasks > 0 || !snapshot.prd_task_candidates.is_empty())
    {
        return json!({
            "gate": {
                "kind": "work-selection",
                "blocking": true,
                "method": "triage-agent-brief-vertical-slice",
                "categories": ["bug", "feature", "board-bringup", "power", "timing", "toolchain"],
                "triage_states": ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
                "required_brief_fields": ["current_behavior", "desired_behavior", "hardware_facts", "firmware_interfaces", "acceptance_criteria", "out_of_scope", "required_verification"],
                "slice_rule": "Use vertical tracer-bullet slices: each slice must deliver one narrow but complete observable path across firmware, hardware truth, docs, and verification surfaces.",
                "allowed_actions": ["present_existing_task_candidates", "present_child_prd_candidates", "classify_work_category", "offer_new_task_or_bug", "ask_user_to_choose_work_path", "draft_agent_brief", "split_into_vertical_slices", "trigger_task_activate_after_explicit_ready_task_choice", "trigger_task_add_after_scope_clear", "create_task_from_selected_child_prd"],
                "forbidden_actions": ["force_existing_task_activation", "ask_user_to_run_task_list", "ask_user_to_run_task_activate", "invent_task_name", "start_implementation_without_selected_or_created_ready_task", "run_shell_command_for_emb_slash_command", "create_horizontal_layer_tasks", "ignore_child_prd_candidates"],
            }
        })
        .to_string();
    }
    if action == "prd-breakdown" {
        let project_root = Path::new(&snapshot.project_root);
        let graph_path = project_root.join("graphify-out/graph.json");
        let graph_exists = graph_path.is_file();
        let manual_parsed = manual_cached_or_parsed(snapshot);
        let has_code = has_source_files(project_root);
        // Graph is only required if project has source code. Pre-firmware projects (no .c/.h/.rs) skip this check.
        let graph_required = has_code && !graph_exists;
        let manual_required = !manual_parsed;
        if graph_required || manual_required {
            let mut required: Vec<&str> = Vec::new();
            if graph_required {
                required.push("build knowledge graph: `uv tool upgrade graphifyy 2>/dev/null; uv tool list | grep -q graphifyy || uv tool install graphifyy; graphify install --project; /graphify .`");
            }
            if manual_required {
                required.push("parse MCU manual: `uv tool upgrade markitdown 2>/dev/null; uv tool list | grep -q markitdown || uv tool install 'markitdown[all]'; markitdown <manual.pdf> -o .emb-agent/cache/docs/<chip>_manual.md` — if image-heavy, fall back to mineru");
            }
            return json!({
                "gate": {
                    "kind": "preflight-tools",
                    "blocking": true,
                    "method": "ensure-external-tools-ready-before-prd-breakdown",
                    "checks": {
                        "graphify_graph": graph_exists || !has_code,
                        "mcum_manual_parsed": manual_parsed,
                        "has_source_code": has_code
                    },
                    "required_actions": required,
                    "forbidden_actions": ["proceed_to_prd_breakdown_without_tools_ready", "skip_graph_build", "skip_manual_parsing", "read_raw_pdf_without_conversion"],
                    "completion_condition": if has_code { "graphify-out/graph.json and cached MCU manual markdown exist. Then re-run `emb next`." } else { "Cached MCU manual markdown exists. Then re-run `emb next`." },
                }
            })
            .to_string();
        }
        return json!({
            "gate": {
                "kind": "prd-breakdown",
                "blocking": true,
                "method": "analyze-constraints-propose-framework-then-slice",
                "system_prd_path": "docs/prd/system.md",
                "child_prd_dirs": ["docs/prd/tasks", "docs/prd/features", "docs/prd/modules", "docs/prd/components", "docs/prd/subsystems"],
                "preprocessing": [
                    "0a. ensure graphify installed with LLM backend support: `uv tool list | grep -q graphifyy || uv tool install 'graphifyy[openai]'` (openai extra needed for DeepSeek/OpenAI backends). `uv tool upgrade graphifyy 2>/dev/null` to keep current.",
                    "0b. ensure markitdown: `uv tool list | grep -q markitdown || uv tool install 'markitdown[all]'`. `uv tool upgrade markitdown 2>/dev/null`.",
                    "0c. load API keys and build/refresh graph: `cd <project> && set -a && source .env && set +a && graphify . --update` (sources .env so graphify sees GEMINI_API_KEY/DEEPSEEK_API_KEY). If no graph exists: `graphify . ; graphify cluster-only .`.",
                    "0d. if .graphifyignore is missing, one was deployed at init — check `ls .graphifyignore`. If missing, create one excluding .emb-agent/, .codex/, backup/, graphify-out/, build/.",
                    "0e. [optional] headroom MCP: `uv tool list | grep -q headroom-ai || uv tool install 'headroom-ai[all]'; headroom mcp install`. Use `headroom_compress` before feeding large outputs to LLM.",
                ],
                "workflow_steps": [
                    "1. read system PRD, hw.yaml, req.yaml, and cached MCU manual markdown. If turbovec index built, semantic-search it.",
                    "2. query graphify for code architecture. OUTPUT REQUIREMENT: cite at least 3 specific code entities (function names, file paths, module names) that graphify surfaced. Do NOT fabricate — if graphify found nothing useful, state that explicitly.",
                    "3. analyze constraints: ROM/RAM, real-time, peripheral complexity, power/sleep. OUTPUT REQUIREMENT: cite specific register names or bit fields from the manual (step 1) for each constraint.",
                    "4. determine framework. OUTPUT REQUIREMENT: justify choice with concrete evidence from graphify + manual, not general reasoning.",
                    "5. present analysis + recommendation with trade-offs; wait for user agreement.",
                    "6. create P0 framework task PRD under docs/prd/tasks/.",
                    "7. present P2 vertical slice candidates; create only after user confirms."
                ],
                "allowed_actions": ["read_system_prd", "read_hardware_truth", "query_graphify_for_architecture", "analyze_constraints", "propose_framework_with_reasoning", "present_prd_task_candidates", "create_framework_task_prd_after_agreement", "create_functional_child_prds_after_user_confirms_slice_list", "mirror_confirmed_truth_to_req_yaml", "run_validate_or_health_after_prd_edits"],
                "forbidden_actions": ["create_any_files_before_user_agreement", "start_functional_implementation_before_framework", "present_functional_slices_before_framework_agreement", "guess_framework_without_analyzing_constraints", "ask_user_to_choose_framework_without_recommendation", "ask_user_for_blank_task_when_system_prd_has_candidates", "start_implementation", "activate_task", "scan", "plan", "do", "create_horizontal_layer_tasks", "declare_prd_complete_without_validate_or_health"],
            }
        })
        .to_string();
    }
    "{\"gate\":{\"kind\":\"none\",\"blocking\":false}}".to_string()
}

/// Returns true if any MCU manual markdown or mineru parse.md exists in cache/docs/.
fn manual_cached_or_parsed(snapshot: &ProjectSnapshot) -> bool {
    let cache = Path::new(&snapshot.project_root).join(".emb-agent/cache/docs");
    if !cache.is_dir() {
        return false;
    }
    match std::fs::read_dir(&cache) {
        Ok(entries) => entries.filter_map(|e| e.ok()).any(|e| {
            let path = e.path();
            if path.is_dir() {
                path.join("parse.md").is_file()
            } else {
                path.extension().map_or(false, |ext| ext == "md")
            }
        }),
        Err(_) => false,
    }
}

/// Returns true if any source files exist (C, header, Rust, Python, assembly).
fn has_source_files(project_root: &Path) -> bool {
    let extensions = ["c", "h", "rs", "py", "cpp", "hpp", "s", "asm", "S"];
    for ext in &extensions {
        if walkdir_first_file(project_root, ext) {
            return true;
        }
    }
    false
}

fn walkdir_first_file(root: &Path, ext: &str) -> bool {
    use std::fs;
    let Ok(entries) = fs::read_dir(root) else { return false };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            if walkdir_first_file(&path, ext) {
                return true;
            }
        } else if path.extension().map_or(false, |e| e == ext) {
            return true;
        }
    }
    false
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
    json!({
        "status": "ok",
        "language": snapshot.language,
        "language_instruction": response_language_instruction(&snapshot.language),
        "project": {
            "root": snapshot.project_root,
            "initialized": snapshot.initialized,
            "active_variant": snapshot.active_variant,
            "variant_dir": snapshot.variant_dir,
            "mcu": snapshot.mcu_model,
            "package": snapshot.mcu_package,
            "developer": snapshot.developer,
            "branch": snapshot.git_branch,
            "bootstrap": snapshot.bootstrap_status,
            "workflow": snapshot.workflow_state
        },
        "prd": {
            "system_prd": snapshot.system_prd_exists,
            "system_prd_has_content": snapshot.system_prd_has_content,
            "system_prd_path": "docs/prd/system.md",
            "child_prd_count": snapshot.child_prd_count,
            "breakdown_needed": snapshot.prd_breakdown_needed,
            "child_prd_dirs": ["docs/prd/tasks", "docs/prd/features", "docs/prd/modules", "docs/prd/components", "docs/prd/subsystems"]
        },
        "tasks": {
            "open": snapshot.open_tasks,
            "wiki_pages": snapshot.wiki_pages,
            "active": active_task_name
        },
        "next": {
            "command": snapshot.recommended_command,
            "reason": snapshot.recommended_reason,
            "task_intake": snapshot.task_intake_summary
        },
        "truth_validation_errors": snapshot.truth_validation_errors
    })
    .to_string()
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

// ── External protocol ──────────────────────────────────────────

/// Build external protocol envelope for start
pub fn build_external_start_json(snapshot: &ProjectSnapshot) -> String {
    let (next_cmd, next_reason) = build_next_routing(snapshot);
    let runtime_events = json!({
        "status": if snapshot.bootstrap_status == "ready" { "ok" } else { "pending" },
        "total": 1,
        "blocked": 0,
        "pending": if snapshot.bootstrap_status == "ready" { 0 } else { 1 },
        "failed": 0
    });
    json!({
        "protocol": "emb-agent.external/1",
        "entrypoint": "start",
        "runtime_cli": "node .<host>/emb-agent/bin/emb-agent.cjs",
        "status": snapshot.workflow_state,
        "summary": snapshot.recommended_reason,
        "initialized": snapshot.initialized,
        "mcu_model": snapshot.mcu_model,
        "mcu_package": snapshot.mcu_package,
        "open_tasks": snapshot.open_tasks,
        "prd": {
            "system_prd": snapshot.system_prd_exists,
            "system_prd_has_content": snapshot.system_prd_has_content,
            "child_prd_count": snapshot.child_prd_count,
            "breakdown_needed": snapshot.prd_breakdown_needed
        },
        "next": {
            "command": next_cmd,
            "reason": next_reason,
            "cli": format!("node .<host>/emb-agent/bin/emb-agent.cjs {}", next_cmd)
        },
        "runtime_events": runtime_events
    })
    .to_string()
}

/// Build external protocol envelope for next
pub fn build_external_next_json(snapshot: &ProjectSnapshot, tasks: &[TaskSnapshot]) -> String {
    let (next_cmd, next_reason) = build_next_routing(snapshot);
    let action = if snapshot.recommended_command == "onboard" {
        "onboard"
    } else if snapshot.recommended_command == "ingest-docs" {
        "ingest-docs"
    } else if snapshot.recommended_command == "prd-breakdown" {
        "prd-breakdown"
    } else if snapshot.recommended_command == "choose-work" {
        "choose-work"
    } else if snapshot.recommended_command == "clarify" {
        "clarify"
    } else if snapshot.current_task.is_some() {
        "do"
    } else {
        "next"
    };
    let runtime_events = json!({
        "status": if action == "do" { "ok" } else { "pending" },
        "total": 1,
        "blocked": 0,
        "pending": if action == "do" { 0 } else { 1 },
        "failed": 0
    });
    let routed_tasks = if !snapshot.prd_task_candidates.is_empty() && tasks.is_empty() {
        snapshot.prd_task_candidates.as_slice()
    } else {
        tasks
    };
    let task_candidates: Vec<Value> = routed_tasks
        .iter()
        .filter(|t| t.status != "closed" && t.status != "done" && t.status != "resolved")
        .map(|t| {
            json!({
                "name": t.name,
                "title": t.title,
                "status": t.status,
                "priority": t.priority
            })
        })
        .collect();
    json!({
        "protocol": "emb-agent.external/1",
        "entrypoint": "next",
        "runtime_cli": "node .<host>/emb-agent/bin/emb-agent.cjs",
        "status": snapshot.workflow_state,
        "summary": snapshot.recommended_reason,
        "action": action,
        "open_tasks": snapshot.open_tasks,
        "task_candidates": task_candidates,
        "prd": {
            "system_prd": snapshot.system_prd_exists,
            "system_prd_has_content": snapshot.system_prd_has_content,
            "child_prd_count": snapshot.child_prd_count,
            "breakdown_needed": snapshot.prd_breakdown_needed
        },
        "next": {
            "command": next_cmd,
            "reason": next_reason,
            "cli": format!("node .<host>/emb-agent/bin/emb-agent.cjs next")
        },
        "runtime_events": runtime_events
    })
    .to_string()
}

/// Build external protocol envelope for status
pub fn build_external_status_json(snapshot: &ProjectSnapshot) -> String {
    let runtime_events = json!({
        "status": "ok",
        "total": 0,
        "blocked": 0,
        "pending": 0,
        "failed": 0
    });
    let active_task = snapshot.current_task.as_ref().map(|t| {
        json!({
            "name": t.name,
            "title": t.title,
            "status": t.status,
            "priority": t.priority
        })
    });
    json!({
        "protocol": "emb-agent.external/1",
        "entrypoint": "status",
        "prd": {
            "system_prd": snapshot.system_prd_exists,
            "system_prd_has_content": snapshot.system_prd_has_content,
            "child_prd_count": snapshot.child_prd_count,
            "breakdown_needed": snapshot.prd_breakdown_needed
        },
        "runtime_cli": "node .<host>/emb-agent/bin/emb-agent.cjs",
        "status": snapshot.workflow_state,
        "summary": format!("{} open tasks, {} wiki pages", snapshot.open_tasks, snapshot.wiki_pages),
        "project": {
            "initialized": snapshot.initialized,
            "mcu": snapshot.mcu_model,
            "package": snapshot.mcu_package,
            "bootstrap": snapshot.bootstrap_status,
            "workflow": snapshot.workflow_state,
            "active_variant": snapshot.active_variant
        },
        "tasks": {
            "open": snapshot.open_tasks,
            "wiki_pages": snapshot.wiki_pages,
            "active": active_task
        },
        "runtime_events": runtime_events
    })
    .to_string()
}

/// Build external protocol envelope for health
pub fn build_external_health_json(snapshot: &ProjectSnapshot) -> String {
    let has_mcu = !snapshot.mcu_model.is_empty();
    let truth_valid = snapshot.truth_validation_errors.is_empty();
    let all_ok = snapshot.initialized
        && truth_valid
        && has_mcu
        && snapshot.bootstrap_status == "ready"
        && !snapshot.prd_breakdown_needed
        && !snapshot.firmware_manual_required;
    let runtime_events = json!({
        "status": if all_ok { "ok" } else { "blocked" },
        "total": 6,
        "blocked": if all_ok { 0 } else { 1 },
        "pending": 0,
        "failed": 0
    });
    json!({
        "protocol": "emb-agent.external/1",
        "entrypoint": "health",
        "runtime_cli": "node .<host>/emb-agent/bin/emb-agent.cjs",
        "status": if all_ok { "pass" } else { "fail" },
        "summary": format!("Health: {} checks passed", if all_ok { "all" } else { "some" }),
        "checks": {
            "project_initialized": snapshot.initialized,
            "truth_yaml_valid": truth_valid,
            "mcu_declared": has_mcu,
            "bootstrap_ready": snapshot.bootstrap_status == "ready",
            "prd_child_planning": !snapshot.prd_breakdown_needed,
            "firmware_manual_evidence": !snapshot.firmware_manual_required
        },
        "truth_validation_errors": snapshot.truth_validation_errors,
        "runtime_events": runtime_events
    })
    .to_string()
}

/// Build external protocol envelope for dispatch-next
pub fn build_external_dispatch_next_json(
    snapshot: &ProjectSnapshot,
    tasks: &[TaskSnapshot],
) -> String {
    build_external_next_json(snapshot, tasks)
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
        (
            "prd_child_planning",
            !snapshot.prd_breakdown_needed,
            if snapshot.prd_breakdown_needed {
                "System PRD exists but no child execution PRDs or open tasks exist; run PRD breakdown before work selection".to_string()
            } else {
                "PRD child planning gate is clear".to_string()
            },
        ),
        (
            "firmware_manual_evidence",
            !snapshot.firmware_manual_required,
            if snapshot.firmware_manual_required {
                "Parsed MCU manual/register evidence is required before firmware work".to_string()
            } else {
                "Firmware manual gate is clear".to_string()
            },
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
            firmware_manual_required: false,
            requirements_unknown_count: 0,
            hardware_unknown_count: 0,
            truth_validation_errors: Vec::new(),
            system_prd_exists: true,
            system_prd_has_content: true,
            child_prd_count: 1,
            prd_breakdown_needed: false,
            prd_task_candidates: Vec::new(),
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

        assert_eq!(status["prd"]["system_prd"], true);
        assert_eq!(status["prd"]["child_prd_count"], 1);
        let next: serde_json::Value =
            serde_json::from_str(&build_next_json(&sample_snapshot())).unwrap();
        assert_eq!(next["language"], "zh");
        assert_eq!(next["language_instruction"], status["language_instruction"]);

        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("Response language: Respond to the user in Simplified Chinese"));
    }

    #[test]
    fn session_context_uses_host_neutral_routing_not_pi_only_commands() {
        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("current host's emb-next entry"));
        assert!(context.contains("node .<host>/emb-agent/bin/emb-agent.cjs next --brief"));
        assert!(context.contains("not a bare shell literal"));
        assert!(!context.contains("Trigger the Pi slash command"));
        assert!(!context.contains("pi-coding-agent dist/index.js"));
    }
}
