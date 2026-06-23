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

fn clarify_instructions(snapshot: &ProjectSnapshot) -> String {
    let mut instructions = "Run PRD exploration as a doc-grounded grilling loop: if hardware-first docs exist under docs/, first ingest schematics and parse datasheets/manuals with the configured local conversion order before MinerU fallback, record unconfirmed hardware conflicts in PRD/req unknowns, then challenge ambiguous terms against existing project truth, ask one load-bearing behavior/hardware/power/state-machine question at a time, update docs/prd/system.md and .emb-agent/req.yaml after confirmation, run the installed emb-agent runtime's validate or health command after truth edits, and stop before task creation until the compact state-machine checklist is explicit.".to_string();
    if snapshot.power_management_risk {
        instructions.push_str(" Because low-power or wake behavior is in scope, front-load watchdog policy, sleep entry conditions, wake sources, pre-sleep peripheral shutdown, post-wake restore sequence, config-bit dependencies, and idle-current acceptance evidence.");
    }
    instructions
}

fn firmware_manual_instructions(snapshot: &ProjectSnapshot) -> String {
    let mut instructions = "MCU/package truth exists, but parsed MCU manual or chip-support evidence is missing. Ingest the MCU manual/datasheet with `ingest doc --provider auto`, verify register, GPIO bias/wakeup, ADC, timer/PWM, and sleep/reset evidence, then rerun next before firmware implementation or task creation.".to_string();
    if snapshot.power_management_risk {
        instructions.push_str(" Include watchdog software-control limits, config words, wake sources, and STOP/standby caveats in that evidence pass.");
    }
    instructions
}

fn work_selection_instructions() -> &'static str {
    "Present `task_candidates` as existing-task or child-PRD work options, and classify the desired path as bug, feature, board-bringup, power, timing, or toolchain. Use a durable agent brief and a vertical tracer-bullet slice when the work is multi-step, cross-cutting, or likely to need resume/handoff. For a narrow explanation, structure walkthrough, evidence lookup, one-off verification run, or small scoped fix, direct bounded execution is allowed without creating or activating a task once the scope and verification surface are explicit. If the user says they do not understand the current service split or time-slice flow, explain the existing structure and tradeoffs before proposing refactors."
}

fn subagent_delegation_policy(action: &str) -> Value {
    let required_before_broad_work = matches!(
        action,
        "do" | "prd-breakdown" | "choose-work" | "task-or-direct"
    );
    json!({
        "applies_when_host_exposes_subagent_tool": true,
        "required_before_broad_work": required_before_broad_work,
        "broad_work_triggers": [
            "system_framework_or_scheduler_design",
            "multiple_peripherals_or_power_domains",
            "sleep_wake_watchdog_lvd_or_config_bit_risk",
            "toolchain_migration_or_sdk_library_integration",
            "implementation_plus_independent_review",
            "large_context_recon_before_editing"
        ],
        "first_step": "list_available_subagents_before_broad_execution",
        "recommended_roles": [
            "hardware/register evidence scout",
            "context/planning scout",
            "focused implementation worker",
            "architecture/system reviewer"
        ],
        "prd_exploration_scope": "read-only evidence scouts and reviewers are allowed during PRD exploration; implementation workers wait until a concrete task is active"
    })
}

fn clarify_state_machine_checklist(snapshot: &ProjectSnapshot) -> Vec<&'static str> {
    let mut checklist = vec![
        "boot_state",
        "first_input",
        "press_vs_release_trigger",
        "mode_cycle_including_off",
        "long_press_valid_states",
        "memory_semantics",
        "stop_entry",
        "wake_source",
        "low_voltage_behavior",
        "acceptance_evidence",
        "extract_exact_waveform_or_measurement_params_from_captures",
    ];
    if snapshot.power_management_risk {
        checklist.extend([
            "watchdog_policy_awake_vs_sleep",
            "sleep_entry_conditions",
            "sleep_wake_sources",
            "pre_sleep_peripheral_shutdown",
            "post_wake_restore_sequence",
            "config_bit_dependencies",
            "idle_current_acceptance_evidence",
        ]);
    }
    checklist
}

pub fn build_session_context(snapshot: &ProjectSnapshot) -> String {
    build_session_context_for_trigger(snapshot, "startup")
}

pub fn build_session_context_for_trigger(snapshot: &ProjectSnapshot, trigger: &str) -> String {
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

    let trigger = trigger.trim().to_ascii_lowercase();
    if trigger == "compact" || trigger == "clear" {
        let mut lines = vec![
            "<emb-agent-session-context>".to_string(),
            format!("emb-agent re-entry context refreshed after {trigger}."),
            "Treat this as a compact delta, not a full reboot.".to_string(),
            "Do not replay welcome text, onboarding advice, or broad rule files unless the current gate is unclear.".to_string(),
            "</emb-agent-session-context>".to_string(),
            String::new(),
            "<current-state>".to_string(),
            format!("Project root: {}", snapshot.project_root),
            format!("Workflow state: {}", snapshot.workflow_state),
            format!("Recommended next command: {}", snapshot.recommended_command),
            format!("Reason: {}", snapshot.recommended_reason),
            format!("Open tasks: {}", snapshot.open_tasks),
        ];
        if let Some(task) = &snapshot.current_task {
            lines.push(format!("Active task: {} ({})", task.name, task.title));
        }
        if snapshot.power_management_risk {
            lines.push("Embedded power-risk reminder: keep watchdog, sleep/wake, config-bit truth, and idle-current acceptance visible.".to_string());
        }
        lines.extend([
            "</current-state>".to_string(),
            String::new(),
            "<ready>".to_string(),
            "Continue from the current gate and nearby files only; avoid broad file rediscovery.".to_string(),
            "Re-open `.codex/instructions.md` only if host integration behavior or routing is unclear.".to_string(),
            "</ready>".to_string(),
        ]);
        return lines.join("\n");
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
    if snapshot.power_management_risk {
        lines.push("Embedded power-risk: watchdog, sleep/wake behavior, config-bit truth, and idle-current acceptance must be made explicit early.".to_string());
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
        "Subagent policy: if the host exposes a subagent/delegation tool and the work spans system framework design, multiple peripherals, power/sleep/watchdog/LVD/config-bit risk, toolchain migration, SDK/library integration, or implementation plus review, list available subagents first and dispatch read-only scouts/reviewers or focused workers instead of doing the whole job inline. During PRD exploration, read-only evidence scouts are allowed; implementation workers wait for an active concrete task.".to_string(),
        "When the user explicitly asks what a service split, scheduler path, or time-slice call chain means, treat explanation-first as a valid direct route; do not force task creation just to answer that question.".to_string(),
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
        "1. **Describe your goal** (e.g., \"review the schematic\") — I will route it to the right workflow.".to_string(),
        "2. Ask me \"what should I do next?\" — I will show the recommended next step and any ready work options.".to_string(),
        "3. If you do not understand the current structure, scheduler, or time-slice flow, ask for a walkthrough first — this does not need a task.".to_string(),
        "4. For a narrow analysis, verification run, or small scoped fix, ask directly — this often does not need a task first.".to_string(),
        "5. Run `/emb-next` or `status --brief` through the emb-agent runtime if you want the raw routing state.".to_string(),
    ]);

    lines.join("\n")
}

pub fn build_host_session_start_payload(host: &str, message: &str, welcome: &str) -> String {
    build_host_session_start_payload_for_trigger(host, message, welcome, "startup")
}

pub fn build_host_session_start_payload_for_trigger(
    host: &str,
    message: &str,
    welcome: &str,
    trigger: &str,
) -> String {
    let event_name = "SessionStart";
    let emit_welcome = trigger.trim().eq_ignore_ascii_case("startup");
    match host {
        "cursor" => format!("{{\"additional_context\":{}}}", json_quote(message)),
        "codex" => {
            format!(
                "{{\"suppressOutput\":true,\"systemMessage\":{},\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
                json_quote(&format!(
                    "emb-agent rust context injected after {} ({} chars)",
                    trigger,
                    message.len()
                )),
                json_quote(event_name),
                json_quote(message)
            )
        }
        _ => {
            let welcome_json = if !emit_welcome || welcome.is_empty() {
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
        return ("clarify".to_string(), clarify_instructions(snapshot));
    }
    if snapshot.recommended_command == "ingest-docs" {
        return (
            "ingest-docs".to_string(),
            firmware_manual_instructions(snapshot),
        );
    }
    if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Limit reads to task PRD + hw.yaml + req.yaml + scoped source files. If the user is confused about the structure, explain the in-scope service split or time-slice call flow before editing. Use the task brief's exact waveform/measurement params directly without re-extraction. Trigger `/emb:do` only when execution is actually the next step.".to_string(),
        )
    } else if snapshot.recommended_command == "prd-breakdown" {
        (
            "prd-breakdown".to_string(),
            "System PRD exists but no child execution PRDs or open tasks exist. First: read hw.yaml, req.yaml, MCU manual, and vendor examples; analyze constraints (ROM/RAM, real-time, peripherals, power); validate whether the official `event-step` control contract fits without exception and name any evidence-backed deviation. Be explicit about watchdog, sleep/wake, and reset/config-bit implications. Wait for agreement. Then: create a framework task PRD around that official mode. Finally: present functional vertical slice candidates; create each only after user confirms.".to_string(),
        )
    } else if snapshot.recommended_command == "choose-work" || snapshot.open_tasks > 0 {
        (
            "choose-work".to_string(),
            work_selection_instructions().to_string(),
        )
    } else if snapshot.bootstrap_status != "ready" && snapshot.bootstrap_status != "concept" {
        (
            "bootstrap".to_string(),
            "Project needs bootstrap. Trigger `/emb:bootstrap status`.".to_string(),
        )
    } else {
        (
            "task-or-direct".to_string(),
            "No tasks exist yet. Ask what work to start, classify it, then choose between direct bounded execution and `/emb:task add <summary>`. Use a task only when the scope is multi-step, resumable, or needs durable handoff/verification structure. If the user mainly wants to understand the current design, answer directly before suggesting any task.".to_string(),
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
    let (action, instructions): (String, String) = if has_truth_errors {
        (
            "repair-truth".to_string(),
            "Project truth validation failed. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml, then run the installed emb-agent runtime's health command before continuing. Do not start implementation while truth files are invalid.".to_string(),
        )
    } else if snapshot.recommended_command == "onboard" {
        (
            "onboard".to_string(),
            "Project needs onboarding. Invoke emb-onboard or trigger `/emb-onboard`; audit existing hardware docs before declaring hardware or implementing.".to_string(),
        )
    } else if snapshot.recommended_command == "clarify" {
        ("clarify".to_string(), clarify_instructions(snapshot))
    } else if snapshot.recommended_command == "ingest-docs" {
        (
            "ingest-docs".to_string(),
            firmware_manual_instructions(snapshot),
        )
    } else if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Before implementation: 1) Limit initial file reads to the active task PRD, .emb-agent/hw.yaml, .emb-agent/req.yaml, and the source files directly under the task scope — do not scan unrelated project files, migration docs, or other projects. 2) If the user signals confusion about readability or architecture, first explain the in-scope service split, scheduler path, or time-slice call chain before changing code. 3) If the task brief contains exact waveform/measurement params, use them directly; do not re-extract or re-measure. Trigger `/emb:do` only after the active task is briefed enough to execute.".to_string(),
        )
    } else if snapshot.recommended_command == "prd-breakdown" {
        (
            "prd-breakdown".to_string(),
            "System PRD exists but no child execution PRDs or open tasks exist. Do NOT create any files until user confirms. TOOL USE: read docs/prd/system.md, hw.yaml, req.yaml, graphify-out/GRAPH_REPORT.md. For MCU specs, use targeted evidence only: first use `doc lookup --keyword <register/peripheral>` or a semantic/turbovec query when `graph_health.turbovec_index=true`; otherwise search cached manual markdown for exact headings/register names and read only narrow line ranges. NEVER read the full cached manual. Step 1: analyze constraints (ROM/RAM/real-time/peripheral/power) using graph/manual evidence; validate the official `event-step` control contract with register-level citations and name any evidence-backed exception. State whether the backend should stay bare-metal or move onto RTOS, and why. Wait for agreement. Step 2: create a P0 framework PRD around that official mode. Step 3: present P2 slices; create after confirm. Output must cite graph entities and register names — no fabricating.".to_string(),
        )
    } else if snapshot.recommended_command == "choose-work" || snapshot.open_tasks > 0 {
        (
            "choose-work".to_string(),
            work_selection_instructions().to_string(),
        )
    } else if snapshot.bootstrap_status != "ready" && snapshot.bootstrap_status != "concept" {
        (
            "bootstrap".to_string(),
            "Project needs bootstrap. Trigger `/emb:bootstrap status`.".to_string(),
        )
    } else {
        (
            "task-or-direct".to_string(),
            snapshot.task_intake_summary.clone(),
        )
    };

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
        &action,
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
        "delegation_policy": subagent_delegation_policy(&action),
        "requirements_unknown_count": snapshot.requirements_unknown_count,
        "hardware_unknown_count": snapshot.hardware_unknown_count,
        "truth_validation_errors": snapshot.truth_validation_errors,
        "truth_validation_summary": truth_errors_summary,
        "firmware_manual_required": snapshot.firmware_manual_required,
        "hardware_evidence_files": snapshot.hardware_evidence_files,
        "graph_health": build_graph_health(snapshot),
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
                "recommended_command": "/emb-next"
            }
        })
        .to_string();
    }
    if action == "clarify" {
        let hardware_docs_pending =
            !snapshot.has_hardware_truth && !snapshot.hardware_evidence_files.is_empty();
        let checklist = clarify_state_machine_checklist(snapshot);
        return json!({
            "gate": {
                "kind": "prd-exploration",
                "blocking": true,
                "method": "grill-with-docs",
                "delegation_policy": subagent_delegation_policy(action),
                "document_evidence_policy": {
                    "hardware_first": hardware_docs_pending,
                    "evidence_files": snapshot.hardware_evidence_files,
                    "before_first_question": if hardware_docs_pending {
                        json!(["scan_docs_for_hardware_evidence", "ingest_schematic", "ingest_datasheet_or_manual", "record_unconfirmed_hardware_conflicts"])
                    } else {
                        json!([])
                    },
                    "local_pdf_tool_priority": snapshot.local_doc_tool_priority.clone(),
                    "fallback": "Use MinerU only when local conversion is missing, low-quality, image-heavy, or explicitly requested."
                },
                "state_machine_checklist": checklist,
                "allowed_actions": ["scan_docs_for_hardware_evidence", "ingest_schematic", "ingest_datasheet_or_manual", "read_cached_schematic_and_manual_artifacts", "delegate_read_only_hardware_evidence_scout", "delegate_read_only_toolchain_or_sdk_feasibility_scout", "delegate_read_only_architecture_reviewer", "record_unconfirmed_hardware_conflicts", "brainstorm_with_user", "ask_one_load_bearing_question", "challenge_terms_against_truth", "update_prd_and_req_truth", "record_confirmed_decisions", "run_health_after_truth_edits", "trigger_task_add_after_user_confirms_concrete_deliverable_or_bug", "draft_agent_brief_from_confirmed_scope", "activate_task_after_agent_brief_ready", "extract_and_record_exact_timing_percent_times_from_captures", "verify_watchdog_and_sleep_policy", "verify_config_bit_dependencies", "record_current_measurement_acceptance"],
                "forbidden_actions": ["skip_existing_docs_before_question_when_hardware_first", "create_implementation_task_without_confirmed_scope", "start_implementation", "delegate_implementation_worker_before_confirmed_scope", "select_mcu_without_confirmed_constraints", "force_existing_task_activation", "declare_requirements_complete_without_health_check", "batch_unconfirmed_decisions", "implement_from_guessed_waveform_params", "assume_watchdog_behavior_without_config_truth", "assume_sleep_current_without_shutdown_plan"],
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
                "required_evidence": ["parsed MCU manual or datasheet", "register map", "GPIO bias/wakeup limits", "ADC reference/channel evidence", "timer/PWM evidence", "sleep/reset behavior", "watchdog/config-bit behavior when power-state semantics depend on it"],
                "preprocessing": [
                    "1. first pass uses configured local conversion: `ingest doc --provider auto --file <manual.pdf> --kind datasheet --to hardware`.",
                    "2. default local tool order is markitdown, then pdftotext, then mutool; override it with `.emb-agent/project.json` integrations.doc_ingest.local_tool_priority or EMB_AGENT_DOC_LOCAL_TOOLS.",
                    "3. quality check: output <500 lines or garbled table fragments means image-heavy/low-quality; fall back to MinerU when MINERU_API_KEY is set.",
                    "4. text-heavy PDFs (500+ clean lines) are sufficient after cached parse.md is inspected."
                ],
                "allowed_actions": ["convert_pdf_with_local_markitdown_first_tooling", "assess_output_quality", "ingest_doc_with_mineru_as_fallback_if_image_heavy_or_local_unavailable", "read_cached_markdown_or_mineru_result", "record_manual_evidence", "rerun_next_after_evidence"],
                "forbidden_actions": ["create_firmware_task", "start_implementation", "declare_firmware_ready_without_manual", "guess_registers_from_pin_names", "read_raw_pdf_without_conversion", "skip_quality_check_on_pdf_conversion"],
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
                "method": "triage-brief-slice-or-direct-bounded-work",
                "delegation_policy": subagent_delegation_policy(action),
                "categories": ["bug", "feature", "board-bringup", "power", "timing", "toolchain"],
                "triage_states": ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
                "required_brief_fields": ["current_behavior", "desired_behavior", "hardware_facts", "firmware_interfaces", "acceptance_criteria", "out_of_scope", "required_verification"],
                "slice_rule": "Use vertical tracer-bullet slices: each slice must deliver one narrow but complete observable path across firmware, hardware truth, docs, and verification surfaces.",
                "direct_work_allowed_for": ["design_explanation", "explanation_only", "narrow_read_only_analysis", "one_off_verification_run", "small_scoped_fix"],
                "allowed_actions": ["present_existing_task_candidates", "present_child_prd_candidates", "classify_work_category", "offer_new_task_or_bug", "ask_user_to_choose_work_path", "draft_agent_brief", "split_into_vertical_slices", "list_available_subagents_before_broad_execution", "delegate_read_only_recon_or_review", "trigger_task_activate_after_explicit_ready_task_choice", "trigger_task_add_after_scope_clear", "create_task_from_selected_child_prd", "explain_existing_structure_before_refactor", "walk_service_and_time_slice_flow", "perform_direct_bounded_analysis_without_task", "perform_direct_bounded_fix_without_task", "run_one_off_verification_without_task"],
                "forbidden_actions": ["force_existing_task_activation", "ask_user_to_run_task_list", "ask_user_to_run_task_activate", "invent_task_name", "start_broad_or_multi_area_implementation_without_selected_or_created_ready_task", "run_shell_command_for_emb_slash_command", "create_horizontal_layer_tasks", "ignore_child_prd_candidates"],
            }
        })
        .to_string();
    }
    if action == "task-or-direct" {
        return json!({
            "gate": {
                "kind": "task-or-direct-intake",
                "blocking": false,
                "method": "classify-then-direct-or-durable",
                "delegation_policy": subagent_delegation_policy(action),
                "categories": ["bug", "feature", "board-bringup", "power", "timing", "toolchain"],
                "direct_work_allowed_for": ["design_explanation", "explanation_only", "narrow_read_only_analysis", "one_off_verification_run", "small_scoped_fix"],
                "allowed_actions": ["classify_work_category", "answer_design_or_structure_question_directly", "walk_service_and_time_slice_flow", "list_available_subagents_before_broad_execution", "delegate_read_only_recon_or_review", "perform_direct_bounded_analysis_without_task", "perform_direct_bounded_fix_without_task", "run_one_off_verification_without_task", "trigger_task_add_after_scope_clear"],
                "forbidden_actions": ["force_task_creation_for_explanation", "force_task_creation_for_small_fix", "start_broad_multi_area_implementation_without_agreed_scope"],
                "recommended_command": "/emb-next"
            }
        })
        .to_string();
    }
    if action == "do" && snapshot.current_task.is_some() {
        return json!({
            "gate": {
                "kind": "task-execution",
                "blocking": false,
                "delegation_policy": subagent_delegation_policy(action),
                "allowed_actions": ["explain_existing_structure_in_task_scope", "walk_time_slice_or_service_call_graph", "refine_brief_in_scope", "list_available_subagents_before_broad_execution", "delegate_read_only_recon_or_review", "delegate_focused_implementation_worker", "implement_within_task_scope", "verify_within_task_scope"],
                "preferred_first_step_when_user_signals_confusion": ["explain_existing_structure_in_task_scope", "walk_time_slice_or_service_call_graph", "propose_refactor_only_after_shared_understanding"],
                "forbidden_actions": ["broad_file_scan_outside_task_scope", "invent_new_cross_project_scope_without_updating_task"]
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
                required.push("parse MCU manual: `ingest doc --provider auto --file <manual.pdf> --kind datasheet --to hardware` — local conversion tries markitdown first, then pdftotext/mutool, then MinerU fallback when configured");
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
                "delegation_policy": subagent_delegation_policy(action),
                "method": "analyze-constraints-validate-official-framework-then-slice",
                "system_prd_path": "docs/prd/system.md",
                "child_prd_dirs": ["docs/prd/tasks", "docs/prd/features", "docs/prd/modules", "docs/prd/components", "docs/prd/subsystems"],
                "official_framework": {
                    "mode": "event-step",
                    "control_contract": "sample-update-apply",
                    "execution_backend": "project-selects-baremetal-or-rtos",
                    "legacy_project_policy": "grandfather-existing-layouts-do-not-rewrite-by-default"
                },
                "preprocessing": [
                    "0a. ensure graphify installed with LLM backend support: `emb next --brief` will auto-ensure missing `graphify` globally on first need when `uv` is available; manual fallback remains `uv tool install 'graphifyy[openai]'` and `uv tool upgrade graphifyy 2>/dev/null`.",
                    "0b. parse the MCU manual with `ingest doc --provider auto --file <manual.pdf> --kind datasheet --to hardware`; emb-agent auto-ensures missing `markitdown` globally on first local-ingest need, then local conversion tries markitdown, then pdftotext/mutool, then MinerU fallback when configured.",
                    "0c. load API keys and build/refresh graph: `cd <project> && set -a && source .env && set +a && graphify . --update` (sources .env so graphify sees GEMINI_API_KEY/DEEPSEEK_API_KEY). If no graph exists: `graphify . ; graphify cluster-only .`.",
                    "0d. if .graphifyignore is missing, one was deployed at init — check `ls .graphifyignore`. If missing, create one excluding .emb-agent/, .codex/, backup/, graphify-out/, build/.",
                    "0e. [optional] headroom MCP: `uv tool list | grep -q headroom-ai || uv tool install 'headroom-ai[all]'; headroom mcp install`. Use `headroom_compress` before feeding large outputs to LLM.",
                ],
                "workflow_steps": [
                    "1. read system PRD, hw.yaml, req.yaml, and graphify-out/GRAPH_REPORT.md.",
                    "1a. for MCU manual/register evidence, use targeted lookup only: `doc lookup --keyword <register/peripheral>` or semantic/turbovec query when graph_health.turbovec_index=true; if no semantic query tool is available, search cached manual markdown for exact headings/register names and read only narrow line ranges. NEVER read the full cached manual.",
                    "2. query graphify for code architecture. OUTPUT REQUIREMENT: cite at least 3 specific code entities (function names, file paths, module names) that graphify surfaced. Do NOT fabricate — if graphify found nothing useful, state that explicitly.",
                    "3. analyze constraints: ROM/RAM, real-time, peripheral complexity, power/sleep. OUTPUT REQUIREMENT: cite specific register names or bit fields from targeted manual evidence (step 1a) for each constraint.",
                    "4. validate the official `event-step` control contract against those constraints. OUTPUT REQUIREMENT: either confirm it fits, or name the exact evidence-backed exception that forces deviation. Also state whether the execution backend should be bare-metal or RTOS while preserving the same control contract. Do not present multiple peer frameworks as equal defaults.",
                    "5. present analysis + recommendation with trade-offs; wait for user agreement.",
                    "6. create P0 framework task PRD under docs/prd/tasks/.",
                    "7. present P2 vertical slice candidates; create only after user confirms."
                ],
                "allowed_actions": ["read_system_prd", "read_hardware_truth", "query_graphify_for_architecture", "delegate_hardware_or_manual_evidence_scout", "delegate_architecture_or_framework_reviewer", "analyze_constraints", "validate_official_framework_with_reasoning", "present_prd_task_candidates", "create_framework_task_prd_after_agreement", "create_functional_child_prds_after_user_confirms_slice_list", "mirror_confirmed_truth_to_req_yaml", "run_validate_or_health_after_prd_edits"],
                "forbidden_actions": ["create_any_files_before_user_agreement", "start_functional_implementation_before_framework", "present_functional_slices_before_framework_agreement", "guess_framework_without_analyzing_constraints", "ask_user_to_choose_framework_without_recommendation", "ask_user_for_blank_task_when_system_prd_has_candidates", "present_multiple_default_frameworks_without_exception_evidence", "start_implementation", "activate_task", "scan", "plan", "do", "create_horizontal_layer_tasks", "declare_prd_complete_without_validate_or_health"],
            }
        })
        .to_string();
    }
    "{\"gate\":{\"kind\":\"none\",\"blocking\":false}}".to_string()
}

/// Returns true if cached docs contain parsed hardware MCU manual/datasheet evidence.
fn manual_cached_or_parsed(snapshot: &ProjectSnapshot) -> bool {
    let cache = Path::new(&snapshot.project_root).join(".emb-agent/cache/docs");
    if !cache.is_dir() {
        return false;
    }
    let index_path = cache.join("index.json");
    if let Ok(raw) = std::fs::read_to_string(&index_path)
        && let Ok(value) = serde_json::from_str::<Value>(&raw)
        && let Some(docs) = value.get("documents").and_then(Value::as_array)
        && docs
            .iter()
            .any(|doc| is_manual_doc_index_entry(doc, &snapshot.mcu_model))
    {
        return true;
    }

    match std::fs::read_dir(&cache) {
        Ok(entries) => entries.filter_map(|e| e.ok()).any(|e| {
            let path = e.path();
            if !path.is_dir() || !path.join("parse.md").is_file() {
                return false;
            }
            let source = std::fs::read_to_string(path.join("source.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            source
                .as_ref()
                .is_some_and(|value| is_manual_doc_index_entry(value, &snapshot.mcu_model))
        }),
        Err(_) => false,
    }
}

fn is_manual_doc_index_entry(doc: &Value, mcu_model: &str) -> bool {
    let parsed = doc.get("parsed").and_then(Value::as_bool).unwrap_or(true);
    if !parsed {
        return false;
    }
    let status = doc.get("status").and_then(Value::as_str).unwrap_or("ok");
    if !matches!(status, "ok" | "cached" | "") {
        return false;
    }
    let intended_to = doc.get("intended_to").and_then(Value::as_str).unwrap_or("");
    if !intended_to.is_empty() && intended_to != "hardware" {
        return false;
    }
    let kind = doc
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        kind.as_str(),
        "datasheet" | "manual" | "reference-manual" | "mcu-manual"
    ) {
        return true;
    }
    let haystack = format!(
        "{} {} {}",
        doc.get("title").and_then(Value::as_str).unwrap_or(""),
        doc.pointer("/paths/source")
            .and_then(Value::as_str)
            .unwrap_or(""),
        doc.get("source").and_then(Value::as_str).unwrap_or("")
    )
    .to_ascii_lowercase();
    let mcu = mcu_model.trim().to_ascii_lowercase();
    (!mcu.is_empty() && haystack.contains(&mcu))
        || ["manual", "datasheet", "reference", "手册", "规格书"]
            .iter()
            .any(|needle| haystack.contains(needle))
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
    let nodes = g
        .get("nodes")
        .and_then(|n| n.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let communities = g
        .get("graph")
        .and_then(|g| g.as_object())
        .map(|o| o.len())
        .unwrap_or(0);
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
    let noise_pct = if nodes > 0 {
        noise * 100 / nodes as u64
    } else {
        0
    };
    let tv_dir = Path::new(&snapshot.project_root).join(".emb-agent/cache/turbovec");
    let has_turbovec = tv_dir.is_dir()
        && std::fs::read_dir(&tv_dir).is_ok_and(|mut d| {
            d.any(|e| e.is_ok_and(|e| e.path().extension().is_some_and(|x| x == "tq")))
        });
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

fn walkdir_first_file(root: &Path, ext: &str) -> bool {
    use std::fs;
    let Ok(entries) = fs::read_dir(root) else {
        return false;
    };
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
        } else if path.extension().is_some_and(|e| e == ext) {
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
    let has_mcu = is_declared_chip(&snapshot.mcu_model);
    let has_package = is_declared_chip(&snapshot.mcu_package);
    let has_pin_mapping = snapshot.hardware_pin_mapping_declared;
    let truth_valid = snapshot.truth_validation_errors.is_empty();
    let all_ok = snapshot.initialized
        && truth_valid
        && has_mcu
        && has_package
        && has_pin_mapping
        && snapshot.bootstrap_status == "ready"
        && !snapshot.prd_breakdown_needed
        && !snapshot.firmware_manual_required;
    let runtime_events = json!({
        "status": if all_ok { "ok" } else { "blocked" },
        "total": 8,
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
            "mcu_package_declared": has_package,
            "hardware_pin_mapping": has_pin_mapping,
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
    let has_mcu = is_declared_chip(&snapshot.mcu_model);
    let has_package = is_declared_chip(&snapshot.mcu_package);
    let has_pin_mapping = snapshot.hardware_pin_mapping_declared;
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
            "mcu_package_declared",
            has_package,
            "MCU package is declared in hw.yaml".to_string(),
        ),
        (
            "hardware_pin_mapping",
            has_pin_mapping,
            "Hardware pin mapping is declared in hw.yaml signals".to_string(),
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
            mcu_model: "CTRL-123".to_string(),
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
            hardware_pin_mapping_declared: true,
            hardware_evidence_files: Vec::new(),
            local_doc_tool_priority: vec![
                "markitdown".to_string(),
                "pdftotext".to_string(),
                "mutool".to_string(),
            ],
            truth_validation_errors: Vec::new(),
            system_prd_exists: true,
            system_prd_has_content: true,
            child_prd_count: 1,
            prd_breakdown_needed: false,
            prd_task_candidates: Vec::new(),
            power_management_risk: false,
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
        assert!(line.contains("CTRL-123 QFN32"));
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

    #[test]
    fn session_context_prompts_subagent_delegation_for_broad_firmware_work() {
        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("Subagent policy"));
        assert!(context.contains("system framework design"));
        assert!(context.contains("toolchain migration"));
        assert!(context.contains("read-only evidence scouts are allowed"));
    }

    #[test]
    fn next_json_exposes_delegation_policy_for_active_task_execution() {
        let next: serde_json::Value =
            serde_json::from_str(&build_next_json(&sample_snapshot())).unwrap();
        assert_eq!(next["action"], "do");
        assert_eq!(
            next["delegation_policy"]["required_before_broad_work"],
            true
        );
        assert!(
            next["delegation_policy"]["broad_work_triggers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "toolchain_migration_or_sdk_library_integration")
        );
        assert_eq!(
            next["agent_protocol"]["gate"]["delegation_policy"]["first_step"],
            "list_available_subagents_before_broad_execution"
        );
        assert!(
            next["agent_protocol"]["gate"]["allowed_actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "delegate_focused_implementation_worker")
        );
    }

    #[test]
    fn prd_exploration_allows_read_only_delegation_but_forbids_workers() {
        let mut snapshot = sample_snapshot();
        snapshot.recommended_command = "clarify".to_string();
        let next: serde_json::Value = serde_json::from_str(&build_next_json(&snapshot)).unwrap();
        let gate = &next["agent_protocol"]["gate"];
        assert_eq!(gate["kind"], "prd-exploration");
        assert_eq!(
            gate["delegation_policy"]["prd_exploration_scope"],
            "read-only evidence scouts and reviewers are allowed during PRD exploration; implementation workers wait until a concrete task is active"
        );
        assert!(
            gate["allowed_actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "delegate_read_only_toolchain_or_sdk_feasibility_scout")
        );
        assert!(
            gate["forbidden_actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "delegate_implementation_worker_before_confirmed_scope")
        );
    }
}
