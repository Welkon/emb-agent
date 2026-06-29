use crate::hardware::project::{ProjectSnapshot, TaskSnapshot};
use crate::json::json_quote;
use crate::task::{WorktreePolicy, worktree_policy_json};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    build_statusline_for_host(snapshot, "", "")
}

pub fn build_statusline_for_host(
    snapshot: &ProjectSnapshot,
    host: &str,
    session_payload: &str,
) -> String {
    let color = host.eq_ignore_ascii_case("claude")
        || std::env::var("EMB_AGENT_STATUSLINE_COLOR")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
    build_statusline_inner(snapshot, session_payload, color)
}

fn build_statusline_inner(
    snapshot: &ProjectSnapshot,
    session_payload: &str,
    color: bool,
) -> String {
    if !snapshot.initialized && snapshot.project_root.is_empty() {
        return "emb · onboard".to_string();
    }

    let session = StatuslineSession::from_payload(session_payload);
    let mut parts = vec![session.model_label().unwrap_or_else(|| "emb".to_string())];
    if let Some(ctx) = session.context_label(color) {
        parts.push(ctx);
    }
    if !snapshot.active_variant.is_empty() {
        parts.push(format!("var {}", snapshot.active_variant));
    }

    if is_declared_chip(&snapshot.mcu_model) {
        let chip = if is_declared_chip(&snapshot.mcu_package) {
            format!("{} {}", snapshot.mcu_model, snapshot.mcu_package)
        } else {
            snapshot.mcu_model.clone()
        };
        parts.push(chip);
    } else {
        parts.push("chip undeclared".to_string());
    }
    if !snapshot.git_branch.is_empty() {
        parts.push(paint(color, "35", &snapshot.git_branch));
    }
    if snapshot.git_dirty_count > 0 {
        parts.push(paint(
            color,
            "33",
            &format!("dirty {}", snapshot.git_dirty_count),
        ));
    }
    if let Some(risk) = statusline_embedded_risk(snapshot) {
        parts.push(paint(color, "33", &risk));
    }
    if let Some(duration) = session.duration_label() {
        parts.push(duration);
    }
    if !snapshot.developer.is_empty() {
        parts.push(paint(color, "32", &snapshot.developer));
    }
    parts.push(format!("{} task(s)", snapshot.open_tasks));
    if snapshot.wiki_pages > 0 {
        parts.push(format!("wiki {}", snapshot.wiki_pages));
    }
    if !snapshot.workflow_state.is_empty() {
        parts.push(format!("state {}", snapshot.workflow_state));
    }
    parts.push(format!("next {}", snapshot.recommended_command));

    let mut lines = Vec::new();
    if let Some(task) = &snapshot.current_task {
        let mut task_line = format!(
            "{} {} {}",
            paint(color, "36", &format!("[{}]", task.priority)),
            task.title,
            paint(color, "33", &format!("({})", task.status))
        );
        if !task.package.is_empty() {
            task_line.push_str(&format!(
                " {}",
                paint(color, "90", &format!("[{}]", task.package))
            ));
        }
        lines.push(task_line);
    }

    let info_line = parts.join(&paint(color, "90", " · "));
    let rate_parts = session.rate_limit_labels(color);
    let width = terminal_width();
    if let Some(width) = width
        && !rate_parts.is_empty()
        && visible_len(&info_line)
            + visible_len(&paint(color, "90", " · "))
            + visible_len(&rate_parts.join(" · "))
            > width
    {
        lines.push(info_line);
        lines.push(rate_parts.join(&paint(color, "90", " · ")));
    } else if rate_parts.is_empty() {
        lines.push(info_line);
    } else {
        let mut all = parts;
        all.extend(rate_parts);
        lines.push(all.join(&paint(color, "90", " · ")));
    }

    lines.join("\n")
}

#[derive(Debug, Default)]
struct StatuslineSession {
    model: String,
    context_size: u64,
    context_used_pct: Option<u64>,
    duration_ms: u64,
    rate_limits: Vec<(String, u64, Option<u64>)>,
}

impl StatuslineSession {
    fn from_payload(payload: &str) -> Self {
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            return Self::default();
        };
        let model = value
            .get("model")
            .and_then(|model| {
                model
                    .get("display_name")
                    .or_else(|| model.get("name"))
                    .and_then(Value::as_str)
            })
            .or_else(|| value.get("model").and_then(Value::as_str))
            .unwrap_or("")
            .trim()
            .to_string();
        let context = value.get("context_window").unwrap_or(&Value::Null);
        let context_size = number_field(context, "context_window_size").unwrap_or(0);
        let context_used_pct = number_field(context, "used_percentage");
        let duration_ms = value
            .get("cost")
            .and_then(|cost| number_field(cost, "total_duration_ms"))
            .unwrap_or(0);
        let mut rate_limits = Vec::new();
        if let Some(rate) = value.get("rate_limits") {
            for (label, key) in [("5h", "five_hour"), ("7d", "seven_day")] {
                let Some(window) = rate.get(key) else {
                    continue;
                };
                let Some(pct) = number_field(window, "used_percentage") else {
                    continue;
                };
                let resets_at = number_field(window, "resets_at");
                rate_limits.push((label.to_string(), pct, resets_at));
            }
        }
        Self {
            model,
            context_size,
            context_used_pct,
            duration_ms,
            rate_limits,
        }
    }

    fn model_label(&self) -> Option<String> {
        if self.model.is_empty() {
            return None;
        }
        if self.context_size == 0 || model_mentions_context(&self.model) {
            Some(self.model.clone())
        } else {
            Some(format!(
                "{} ({})",
                self.model,
                format_context_size(self.context_size)
            ))
        }
    }

    fn context_label(&self, color: bool) -> Option<String> {
        let pct = self.context_used_pct?;
        let code = if pct >= 90 {
            "31"
        } else if pct >= 70 {
            "33"
        } else {
            "32"
        };
        Some(format!("ctx {}", paint(color, code, &format!("{pct}%"))))
    }

    fn duration_label(&self) -> Option<String> {
        if self.duration_ms == 0 {
            None
        } else {
            Some(format_duration(self.duration_ms))
        }
    }

    fn rate_limit_labels(&self, color: bool) -> Vec<String> {
        let now = epoch_secs();
        self.rate_limits
            .iter()
            .map(|(label, pct, reset)| {
                let mut item = format!("{label} {pct}%");
                if let Some(reset) = reset
                    && *reset > now
                {
                    item.push_str(&format!(
                        " {}",
                        paint(
                            color,
                            "90",
                            &format!("(reset {})", format_remaining(reset - now))
                        )
                    ));
                }
                item
            })
            .collect()
    }
}

fn number_field(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(number_value)
}

fn number_value(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(n) = value.as_f64()
        && n.is_finite()
        && n >= 0.0
    {
        return Some(n as u64);
    }
    value.as_str()?.parse::<f64>().ok().and_then(|n| {
        if n.is_finite() && n >= 0.0 {
            Some(n as u64)
        } else {
            None
        }
    })
}

fn model_mentions_context(model: &str) -> bool {
    let lower = model.to_ascii_lowercase();
    lower.contains(" context")
        || lower.contains("ctx")
        || lower.split_whitespace().any(|part| {
            let part = part.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            part.len() >= 2
                && matches!(part.chars().last(), Some('k' | 'K' | 'm' | 'M' | 'g' | 'G'))
                && part[..part.len() - 1].chars().all(|c| c.is_ascii_digit())
        })
}

fn format_context_size(size: u64) -> String {
    if size >= 1_000_000 {
        format!("{}M", size / 1_000_000)
    } else if size >= 1_000 {
        format!("{}K", size / 1_000)
    } else {
        size.to_string()
    }
}

fn format_duration(ms: u64) -> String {
    let secs = ms / 1000;
    let hours = secs / 3600;
    let mins = (secs % 3600) / 60;
    if hours > 0 {
        format!("{hours}h{mins}m")
    } else {
        format!("{mins}m")
    }
}

fn format_remaining(secs: u64) -> String {
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    if days > 0 {
        format!("{days}d{hours}h")
    } else if hours > 0 {
        format!("{hours}h{mins}m")
    } else {
        format!("{mins}m")
    }
}

fn epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn terminal_width() -> Option<usize> {
    std::env::var("COLUMNS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|width| *width > 0)
}

fn paint(enabled: bool, code: &str, text: &str) -> String {
    if enabled {
        format!("\x1b[{code}m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}

fn visible_len(text: &str) -> usize {
    let mut count = 0;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' && chars.peek() == Some(&'[') {
            let _ = chars.next();
            for next in chars.by_ref() {
                if next == 'm' {
                    break;
                }
            }
        } else {
            count += 1;
        }
    }
    count
}

fn clarify_instructions(snapshot: &ProjectSnapshot) -> String {
    let mut instructions = "Run PRD exploration as a doc-grounded brainstorm loop: if a question can be answered from code, tests, configs, docs, parsed manuals, schematics, existing PRDs/tasks, or session memory, inspect that evidence before asking the user. If hardware-first docs exist under docs/, first ingest schematics and parse datasheets/manuals with the configured local conversion order before MinerU fallback, record unconfirmed hardware conflicts in PRD/req unknowns, then challenge ambiguous terms against existing project truth. Ask only one load-bearing behavior/hardware/power/state-machine/product-risk question at a time, include your recommended answer and the trade-off if the user chooses differently, update docs/prd/system.md or the task PRD plus .emb-agent/req.yaml after each confirmation, run the installed emb-agent runtime's validate or health command after truth edits, and stop before task creation/activation until the compact state-machine checklist is explicit. For complex implementation work, keep the PRD focused on requirements/acceptance and write task-local design.md and implement.md before activation. If the user asks for a bounded code review, bug audit, design explanation, or one-off verification, handle it as read-only bounded work: use bug-hunter/sys-reviewer or direct narrow inspection, summarize findings, and only create/activate a task before making code changes or starting multi-step implementation.".to_string();
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
    let task_implementation_default = matches!(action, "do" | "choose-work");
    json!({
        "applies_when_host_exposes_subagent_tool": true,
        "required_before_broad_work": required_before_broad_work,
        "main_session_default": if task_implementation_default {
            "dispatch implementation plus independent check subagents when the host exposes a subagent tool"
        } else {
            "use read-only scouts/researchers/reviewers for broad or high-risk work; keep narrow explanations direct"
        },
        "required_before_task_implementation": task_implementation_default,
        "post_implementation_check_required": task_implementation_default,
        "execution_flow": [
            "knowledge_search_or_project_truth_prime",
            "researcher_or_read_only_scout_for_context_gaps",
            "focused_implementation_worker",
            "independent_release_or_system_check",
            "parent_synthesis_and_finish_work"
        ],
        "dispatch_prompt_contract": [
            "include_target_task_or_state_first",
            "state_the_role_and_scope",
            "tell_child_it_is_already_a_subagent",
            "forbid_recursive_subagent_dispatch"
        ],
        "child_self_exemption": "subagents must treat delegation instructions as already satisfied and must not spawn other emb-agent subagents",
        "broad_work_triggers": [
            "system_framework_or_scheduler_design",
            "multiple_peripherals_or_power_domains",
            "sleep_wake_watchdog_lvd_or_config_bit_risk",
            "toolchain_migration_or_sdk_library_integration",
            "external_docs_vendor_api_or_research_heavy_context",
            "implementation_plus_independent_review",
            "large_context_recon_before_editing"
        ],
        "first_step": "list_available_subagents_before_broad_execution",
        "recommended_roles": [
            "hardware/register evidence scout",
            "research/context scout",
            "focused implementation worker",
            "architecture/system reviewer",
            "release/check reviewer"
        ],
        "prd_exploration_scope": "read-only evidence scouts, researchers, and reviewers are allowed during PRD exploration; implementation workers wait until a concrete task is active"
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

#[derive(Debug, Clone)]
struct RecentWorkspaceJournal {
    developer: String,
    session: usize,
    title: String,
    path: String,
    summary: String,
    status: String,
    next_steps: String,
}

fn recent_workspace_journal(snapshot: &ProjectSnapshot) -> Option<RecentWorkspaceJournal> {
    if snapshot.project_root.trim().is_empty() {
        return None;
    }
    let project_root = Path::new(&snapshot.project_root);
    let workspace_dir = project_root.join(".emb-agent").join("workspace");
    if !workspace_dir.is_dir() {
        return None;
    }
    let developer = if snapshot.developer.trim().is_empty() {
        "developer".to_string()
    } else {
        snapshot.developer.trim().to_string()
    };
    let developer_slug = sanitize_workspace_slug(&developer);
    let developer_dir = workspace_dir.join(&developer_slug);
    if developer_dir.is_dir()
        && let Some(entry) = latest_workspace_entry_in_dir(project_root, &developer_dir, &developer)
    {
        return Some(entry);
    }

    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(&workspace_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let fallback_developer = entry.file_name().to_string_lossy().to_string();
            if let Some(journal) =
                latest_workspace_entry_in_dir(project_root, &path, &fallback_developer)
            {
                candidates.push(journal);
            }
        }
    }
    candidates.sort_by(|a, b| a.session.cmp(&b.session).then(a.path.cmp(&b.path)));
    candidates.pop()
}

fn latest_workspace_entry_in_dir(
    project_root: &Path,
    developer_dir: &Path,
    developer: &str,
) -> Option<RecentWorkspaceJournal> {
    let mut files = workspace_journal_files(developer_dir);
    files.sort_by_key(|(number, _)| *number);
    for (_, path) in files.into_iter().rev() {
        let text = fs::read_to_string(&path).ok()?;
        if let Some(entry) = parse_latest_workspace_entry(project_root, developer, &path, &text) {
            return Some(entry);
        }
    }
    None
}

fn workspace_journal_files(developer_dir: &Path) -> Vec<(usize, PathBuf)> {
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

fn parse_latest_workspace_entry(
    project_root: &Path,
    developer: &str,
    path: &Path,
    text: &str,
) -> Option<RecentWorkspaceJournal> {
    let lines = text.lines().collect::<Vec<_>>();
    let (start, header) = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.strip_prefix("## Session ").map(|_| (index, *line)))
        .last()?;
    let rest = header.strip_prefix("## Session ")?;
    let (session, title) = rest.split_once(':')?;
    let session = session.trim().parse::<usize>().ok()?;
    let entry_lines = &lines[start..];
    Some(RecentWorkspaceJournal {
        developer: developer.to_string(),
        session,
        title: title.trim().to_string(),
        path: path
            .strip_prefix(project_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"),
        summary: compact_text(&markdown_section(entry_lines, "### Summary"), 700),
        status: compact_text(&markdown_section(entry_lines, "### Status"), 300),
        next_steps: compact_text(&markdown_section(entry_lines, "### Next Steps"), 700),
    })
}

fn workflow_state_block(snapshot: &ProjectSnapshot) -> Option<String> {
    if snapshot.project_root.trim().is_empty() || snapshot.workflow_state.trim().is_empty() {
        return None;
    }
    let path = Path::new(&snapshot.project_root)
        .join(".emb-agent")
        .join("workflow.md");
    let text = fs::read_to_string(path).ok()?;
    extract_workflow_state_block(&text, &snapshot.workflow_state)
}

fn extract_workflow_state_block(text: &str, state: &str) -> Option<String> {
    let state = state.trim();
    if state.is_empty() {
        return None;
    }
    let start = format!("[workflow-state:{state}]");
    let end = format!("[/workflow-state:{state}]");
    let after_start = text.split_once(&start)?.1;
    let body = after_start.split_once(&end)?.0.trim();
    if body.is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

fn markdown_section(lines: &[&str], heading: &str) -> String {
    let mut in_section = false;
    let mut out = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed == heading {
            in_section = true;
            continue;
        }
        if in_section && trimmed.starts_with("### ") {
            break;
        }
        if in_section {
            out.push(*line);
        }
    }
    out.join("\n").trim().to_string()
}

fn sanitize_workspace_slug(name: &str) -> String {
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

fn compact_text(value: &str, max_chars: usize) -> String {
    let compact = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if compact.chars().count() <= max_chars {
        return compact;
    }
    let mut out = compact
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>();
    out.push_str("...");
    out
}

fn workspace_journal_json(snapshot: &ProjectSnapshot) -> Value {
    match recent_workspace_journal(snapshot) {
        Some(journal) => json!({
            "available": true,
            "developer": journal.developer,
            "session": journal.session,
            "title": journal.title,
            "path": journal.path,
            "summary": journal.summary,
            "status": journal.status,
            "next_steps": journal.next_steps
        }),
        None => json!({"available": false}),
    }
}

fn push_workspace_journal_lines(lines: &mut Vec<String>, snapshot: &ProjectSnapshot) {
    let Some(journal) = recent_workspace_journal(snapshot) else {
        return;
    };
    lines.push(format!(
        "Recent workspace journal: Session {}: {} ({})",
        journal.session, journal.title, journal.path
    ));
    if !journal.summary.is_empty() {
        lines.push(format!("Journal summary: {}", journal.summary));
    }
    if !journal.status.is_empty() {
        lines.push(format!("Journal status: {}", journal.status));
    }
    if !journal.next_steps.is_empty() {
        lines.push(format!("Journal next steps: {}", journal.next_steps));
    }
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

1. Invoke `emb-start` or run `/emb-start` if the host exposes slash commands.
2. If startup returns onboarding, inspect whether this is an empty repo, a partial `.emb-agent/`, or an existing firmware repo with scattered datasheets, schematics, pin maps, build files, and notes.
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
        push_workspace_journal_lines(&mut lines, snapshot);
        if snapshot.power_management_risk {
            lines.push("Embedded power-risk reminder: keep watchdog, sleep/wake, config-bit truth, and idle-current acceptance visible.".to_string());
        }
        push_embedded_risk_lines(&mut lines, snapshot);
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

    if matches!(
        trigger.as_str(),
        "userpromptsubmit" | "user_prompt_submit" | "prompt" | "workflow-state"
    ) {
        let mut lines = vec![
            "<emb-agent-workflow-state>".to_string(),
            "Per-turn emb-agent workflow breadcrumb. Use it as routing context; do not repeat it to the user.".to_string(),
            format!("Workflow state: {}", snapshot.workflow_state),
            format!("Recommended next command: {}", snapshot.recommended_command),
            format!("Reason: {}", snapshot.recommended_reason),
            format!("Open tasks: {}", snapshot.open_tasks),
        ];
        if let Some(task) = &snapshot.current_task {
            lines.push(format!(
                "Active task: [{}] {} ({})",
                task.priority, task.title, task.status
            ));
        }
        if !snapshot.developer.is_empty() {
            lines.push(format!("Developer: {}", snapshot.developer));
        }
        if let Some(git) = git_status_summary(snapshot) {
            lines.push(format!("Git status: {}", git));
        }
        push_embedded_risk_lines(&mut lines, snapshot);
        if let Some(block) = workflow_state_block(snapshot) {
            lines.push("<workflow-md-state>".to_string());
            lines.push(block);
            lines.push("</workflow-md-state>".to_string());
        }
        push_workspace_journal_lines(&mut lines, snapshot);
        lines.extend([
            "Use host-visible commands only for the main flow: emb-start, emb-next, emb-finish-work.".to_string(),
            "After verified task work, the parent AI triggers emb-finish-work; the runtime resolves the active task and archives it without asking the user to run internal task commands.".to_string(),
            "Use internal runtime/tool commands only when the current gate specifically requires evidence, task, knowledge, verification, or lifecycle work.".to_string(),
            "</emb-agent-workflow-state>".to_string(),
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
    if let Some(git) = git_status_summary(snapshot) {
        lines.push(format!("Git status: {}", git));
    }
    if let Some(task) = &snapshot.current_task {
        lines.push(format!("Active task: {} ({})", task.name, task.title));
        lines.push(format!(
            "Task status: {} / Priority: {}",
            task.status, task.priority
        ));
    }
    push_workspace_journal_lines(&mut lines, snapshot);
    if snapshot.power_management_risk {
        lines.push("Embedded power-risk: watchdog, sleep/wake behavior, config-bit truth, and idle-current acceptance must be made explicit early.".to_string());
    }
    push_embedded_risk_lines(&mut lines, snapshot);

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
        "Subagent policy: if the host exposes a subagent/delegation tool, active task implementation defaults to main-session coordination with focused implementation and independent check subagents; the main session synthesizes results, handles closure docs, and runs `/emb-finish-work`. For system framework design, multiple peripherals, power/sleep/watchdog/LVD/config-bit risk, toolchain migration, SDK/library integration, vendor/API research, or implementation plus review, list available subagents first and dispatch read-only scouts, the `researcher`, reviewers, or focused workers instead of doing the whole job inline. Subagents must not recursively spawn more emb-agent subagents. During PRD exploration, read-only evidence scouts and `researcher` are allowed; implementation workers wait for an active concrete task.".to_string(),
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
    let active_task = json_value_or_null(&build_task_json(snapshot));
    json!({
        "status": "ok",
        "runtime": "/emb:agent",
        "summary": {
            "initialized": snapshot.initialized,
            "project_root": snapshot.project_root,
            "active_variant": snapshot.active_variant,
            "variant_dir": snapshot.variant_dir,
            "mcu_model": snapshot.mcu_model,
            "mcu_package": snapshot.mcu_package,
            "open_tasks": snapshot.open_tasks,
            "wiki_pages": snapshot.wiki_pages,
            "active_task": active_task
        },
        "embedded_risk": embedded_risk_json(snapshot),
        "workspace_journal": workspace_journal_json(snapshot),
        "immediate": {
            "command": snapshot.recommended_command,
            "reason": snapshot.recommended_reason
        }
    })
    .to_string()
}

pub fn build_next_routing(snapshot: &ProjectSnapshot) -> (String, String) {
    if snapshot.recommended_command == "onboard" {
        return (
            "onboard".to_string(),
            "Project needs onboarding. Use the host emb-start entry to scaffold .emb-agent/ or migrate existing hardware truth before implementation.".to_string(),
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
    if snapshot.recommended_command == "complete" {
        return (
            "complete".to_string(),
            "All known execution tasks are closed. PRD breakdown is not required unless the user explicitly adds new scope or identifies an uncovered requirement. Offer board-level acceptance, release packaging, or new-scope intake.".to_string(),
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
    let (action, instructions): (String, String) = if snapshot.recommended_command == "onboard" {
        (
            "onboard".to_string(),
            "Project needs onboarding. Trigger `/emb-start` or the installed runtime's `start --brief`; audit existing hardware docs before declaring hardware or implementing.".to_string(),
        )
    } else if has_truth_errors {
        (
            "repair-truth".to_string(),
            "Project truth validation failed. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml, then run the installed emb-agent runtime's health command before continuing. Do not start implementation while truth files are invalid.".to_string(),
        )
    } else if snapshot.recommended_command == "clarify" {
        ("clarify".to_string(), clarify_instructions(snapshot))
    } else if snapshot.recommended_command == "ingest-docs" {
        (
            "ingest-docs".to_string(),
            firmware_manual_instructions(snapshot),
        )
    } else if snapshot.recommended_command == "complete" {
        (
            "complete".to_string(),
            "All known execution tasks are closed. Do not run PRD breakdown unless the user explicitly adds new scope or points to an uncovered requirement. Offer next practical options: board-level acceptance/burn-in, release packaging, documentation/AAR cleanup, or create a new task for new scope.".to_string(),
        )
    } else if snapshot.current_task.is_some() {
        (
            "do".to_string(),
            "Active task exists. Before implementation: 1) Limit initial file reads to the active task PRD, .emb-agent/hw.yaml, .emb-agent/req.yaml, and the source files directly under the task scope — do not scan unrelated project files, migration docs, or other projects. 2) If the user signals confusion about readability or architecture, first explain the in-scope service split, scheduler path, or time-slice call chain before changing code. 3) If the task brief contains exact waveform/measurement params, use them directly; do not re-extract or re-measure. Trigger `/emb:do` only after the active task is briefed enough to execute.".to_string(),
        )
    } else if snapshot.recommended_command == "prd-breakdown" {
        (
            "prd-breakdown".to_string(),
            "System PRD exists but no child execution PRDs or open tasks exist. Do NOT create any files until user confirms. TOOL USE: read docs/prd/system.md, hw.yaml, req.yaml, and .emb-agent/graph/GRAPH_REPORT.md if present. For MCU specs, use targeted evidence only: first use `doc lookup --keyword <register/peripheral>` or `knowledge search --query <term>`; otherwise search cached manual markdown for exact headings/register names and read only narrow line ranges. NEVER read the full cached manual. Step 1: analyze constraints (ROM/RAM/real-time/peripheral/power) using native graph/manual evidence; validate the official `event-step` control contract with register-level citations and name any evidence-backed exception. State whether the backend should stay bare-metal or move onto RTOS, and why. Wait for agreement. Step 2: create a P0 framework PRD around that official mode. Step 3: present P2 slices; create after confirm. Output must cite graph entities and register names — no fabricating.".to_string(),
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
        "workspace_journal": workspace_journal_json(snapshot),
        "agent_protocol": agent_protocol,
        "delegation_policy": subagent_delegation_policy(&action),
        "embedded_risk": embedded_risk_json(snapshot),
        "requirements_unknown_count": snapshot.requirements_unknown_count,
        "hardware_unknown_count": snapshot.hardware_unknown_count,
        "truth_validation_errors": snapshot.truth_validation_errors,
        "truth_validation_summary": truth_errors_summary,
        "firmware_layout": default_firmware_layout(Path::new(&snapshot.project_root)),
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
    if action == "complete" {
        return json!({
            "gate": {
                "kind": "project-complete",
                "blocking": false,
                "method": "acceptance-or-new-scope",
                "allowed_actions": ["summarize_completion", "offer_board_acceptance", "offer_release_packaging", "create_new_task_only_after_explicit_new_scope", "answer_user_question_directly"],
                "forbidden_actions": ["force_prd_breakdown", "invent_uncovered_requirements", "create_files_without_user_request", "start_implementation_without_new_scope"],
                "recommended_next_options": ["board_acceptance", "burn_and_measure", "release_package", "new_scope_intake"]
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
                "method": "brainstorm-with-docs",
                "delegation_policy": subagent_delegation_policy(action),
                "brainstorm_contract": {
                    "mode": "main-session-interactive",
                    "preconditions": ["task_creation_consent_before_durable_task", "no_source_or_build_mutation_during_planning"],
                    "evidence_rule": "If repository evidence can answer a question, inspect evidence before asking the user.",
                    "question_rule": "Ask one product, scope, hardware, power, timing, risk, or acceptance decision at a time; include the recommended answer and trade-off.",
                    "writeback_rule": "After every confirmed answer, update docs/prd/system.md or the task PRD plus .emb-agent/req.yaml before continuing.",
                    "artifact_rules": {
                        "system_prd": "docs/prd/system.md records product behavior and confirmed requirements",
                        "task_prd": "docs/prd/tasks/<task>.md records task-local goal, requirements, acceptance, out-of-scope, open questions, and evidence",
                        "complex_task_design": ".emb-agent/tasks/<task>/design.md when architecture or cross-module decisions need a durable plan",
                        "complex_task_implementation": ".emb-agent/tasks/<task>/implement.md when execution order, validation commands, or rollback points need a durable plan",
                        "research": ".emb-agent/tasks/<task>/research/<topic>.md when a delegated scout/research pass produces reusable evidence"
                    },
                    "research_rule": "During planning, read-only scout/researcher/reviewer subagents may collect evidence; persist reusable findings into task research files instead of leaving them only in chat."
                },
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
                "direct_work_allowed_for": ["bounded_read_only_bug_audit", "design_explanation", "narrow_read_only_analysis", "one_off_verification_run"],
                "suggested_read_only_roles": {
                    "bug_audit": ["bug-hunter", "sys-reviewer"],
                    "hardware_evidence": ["hw-scout"],
                    "general_research": ["researcher"],
                    "toolchain_or_sdk_research": ["researcher"],
                    "architecture_review": ["arch-reviewer", "sys-reviewer"]
                },
                "allowed_actions": ["scan_docs_for_hardware_evidence", "ingest_schematic", "ingest_datasheet_or_manual", "read_cached_schematic_and_manual_artifacts", "delegate_read_only_hardware_evidence_scout", "delegate_read_only_researcher", "delegate_read_only_bug_hunter", "delegate_read_only_system_reviewer", "delegate_read_only_toolchain_or_sdk_feasibility_scout", "delegate_read_only_architecture_reviewer", "persist_planning_research_to_task_file", "perform_read_only_bug_audit", "perform_direct_bounded_analysis_without_task", "run_one_off_verification_without_task", "summarize_findings_without_edits", "record_unconfirmed_hardware_conflicts", "brainstorm_with_user", "ask_one_load_bearing_question", "ask_one_load_bearing_question_with_recommended_answer", "challenge_terms_against_truth", "update_prd_and_req_truth", "record_confirmed_decisions", "run_health_after_truth_edits", "trigger_task_add_after_user_confirms_concrete_deliverable_or_bug", "draft_agent_brief_from_confirmed_scope", "activate_task_after_agent_brief_ready", "extract_and_record_exact_timing_percent_times_from_captures", "verify_watchdog_and_sleep_policy", "verify_config_bit_dependencies", "record_current_measurement_acceptance"],
                "forbidden_actions": ["skip_existing_docs_before_question_when_hardware_first", "create_implementation_task_without_confirmed_scope", "start_implementation", "edit_source_during_read_only_bug_audit", "delegate_implementation_worker_before_confirmed_scope", "select_mcu_without_confirmed_constraints", "force_existing_task_activation", "declare_requirements_complete_without_health_check", "batch_unconfirmed_decisions", "implement_from_guessed_waveform_params", "assume_watchdog_behavior_without_config_truth", "assume_sleep_current_without_shutdown_plan"],
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
                "allowed_actions": ["invoke_start_context", "trigger_emb_start_command", "audit_existing_hardware_docs"],
                "forbidden_actions": ["start_implementation", "guess_hardware_truth", "declare_hardware_without_confirmation"],
                "recommended_agent": "emb-start",
                "recommended_command": "/emb-start"
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
                "allowed_actions": ["present_existing_task_candidates", "present_child_prd_candidates", "classify_work_category", "offer_new_task_or_bug", "ask_user_to_choose_work_path", "draft_agent_brief", "split_into_vertical_slices", "list_available_subagents_before_broad_execution", "delegate_read_only_researcher", "delegate_read_only_recon_or_review", "trigger_task_activate_after_explicit_ready_task_choice", "trigger_task_add_after_scope_clear", "create_task_from_selected_child_prd", "explain_existing_structure_before_refactor", "walk_service_and_time_slice_flow", "perform_direct_bounded_analysis_without_task", "perform_direct_bounded_fix_without_task", "run_one_off_verification_without_task"],
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
                "allowed_actions": ["classify_work_category", "answer_design_or_structure_question_directly", "walk_service_and_time_slice_flow", "list_available_subagents_before_broad_execution", "delegate_read_only_researcher", "delegate_read_only_recon_or_review", "perform_direct_bounded_analysis_without_task", "perform_direct_bounded_fix_without_task", "run_one_off_verification_without_task", "trigger_task_add_after_scope_clear"],
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
                "allowed_actions": ["explain_existing_structure_in_task_scope", "walk_time_slice_or_service_call_graph", "refine_brief_in_scope", "list_available_subagents_before_broad_execution", "delegate_read_only_researcher", "delegate_read_only_recon_or_review", "delegate_focused_implementation_worker", "implement_within_task_scope", "verify_within_task_scope"],
                "preferred_first_step_when_user_signals_confusion": ["explain_existing_structure_in_task_scope", "walk_time_slice_or_service_call_graph", "propose_refactor_only_after_shared_understanding"],
                "forbidden_actions": ["broad_file_scan_outside_task_scope", "invent_new_cross_project_scope_without_updating_task"]
            }
        })
        .to_string();
    }
    if action == "prd-breakdown" {
        let project_root = Path::new(&snapshot.project_root);
        let graph_path = project_root.join(".emb-agent/graph/graph.json");
        let graph_exists = graph_path.is_file();
        let manual_parsed = manual_cached_or_parsed(snapshot);
        let has_code = has_source_files(project_root, None);
        // Graph is only required if project has source code. Pre-firmware projects (no .c/.h/.rs) skip this check.
        let graph_required = has_code && !graph_exists;
        let manual_required = !manual_parsed;
        if graph_required || manual_required {
            let mut required: Vec<&str> = Vec::new();
            if graph_required {
                required.push("build native knowledge graph: `knowledge graph refresh` and optionally `knowledge index --rebuild`");
            }
            if manual_required {
                required.push("parse MCU manual: `ingest doc --provider auto --file <manual.pdf> --kind datasheet --to hardware` — local conversion tries markitdown first, then pdftotext/mutool, then MinerU fallback when configured");
            }
            return json!({
                "gate": {
                    "kind": "preflight-tools",
                    "blocking": true,
                    "method": "ensure-native-knowledge-ready-before-prd-breakdown",
                    "checks": {
                        "native_knowledge_graph": graph_exists || !has_code,
                        "mcum_manual_parsed": manual_parsed,
                        "has_source_code": has_code
                    },
                    "required_actions": required,
                    "forbidden_actions": ["proceed_to_prd_breakdown_without_tools_ready", "skip_graph_build", "skip_manual_parsing", "read_raw_pdf_without_conversion"],
                    "completion_condition": if has_code { ".emb-agent/graph/graph.json and cached MCU manual markdown exist. Then re-run `emb next`." } else { "Cached MCU manual markdown exists. Then re-run `emb next`." },
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
                    "0a. build/refresh emb-agent native knowledge graph: `knowledge graph refresh`; for semantic retrieval also run `knowledge index --rebuild` after configuring embedding env if desired.",
                    "0b. parse the MCU manual with `ingest doc --provider auto --file <manual.pdf> --kind datasheet --to hardware`; emb-agent auto-ensures missing `markitdown` globally on first local-ingest need, then local conversion tries markitdown, then pdftotext/mutool, then MinerU fallback when configured.",
                    "0c. read system PRD, hw.yaml, req.yaml, and .emb-agent/graph/GRAPH_REPORT.md if present.",
                    "0d. for MCU manual/register evidence, use targeted lookup only: `doc lookup --keyword <register/peripheral>` or `knowledge search --query <term>`; if no semantic index is available, search cached manual markdown for exact headings/register names and read only narrow line ranges. NEVER read the full cached manual.",
                ],
                "workflow_steps": [
                    "1. analyze constraints: ROM/RAM, real-time, peripheral complexity, power/sleep. OUTPUT REQUIREMENT: cite specific register names or bit fields from targeted manual evidence for each constraint.",
                    "2. validate the official `event-step` control contract against those constraints. OUTPUT REQUIREMENT: either confirm it fits, or name the exact evidence-backed exception that forces deviation. Also state whether the execution backend should be bare-metal or RTOS while preserving the same control contract. Do not present multiple peer frameworks as equal defaults.",
                    "3. present analysis + recommendation with trade-offs; wait for user agreement.",
                    "4. create P0 framework task PRD under docs/prd/tasks/.",
                    "5. present P2 vertical slice candidates; create only after user confirms."
                ],
                "allowed_actions": ["read_system_prd", "read_hardware_truth", "query_native_knowledge_graph", "delegate_hardware_or_manual_evidence_scout", "delegate_architecture_or_framework_reviewer", "analyze_constraints", "validate_official_framework_with_reasoning", "present_prd_task_candidates", "create_framework_task_prd_after_agreement", "create_functional_child_prds_after_user_confirms_slice_list", "mirror_confirmed_truth_to_req_yaml", "run_validate_or_health_after_prd_edits"],
                "forbidden_actions": ["create_any_files_before_user_agreement", "start_functional_implementation_before_framework", "present_functional_slices_before_framework_agreement", "guess_framework_without_analyzing_constraints", "ask_user_to_choose_framework_without_recommendation", "ask_user_for_blank_task_when_system_prd_has_candidates", "present_multiple_default_frameworks_without_exception_evidence", "start_implementation", "activate_task", "scan", "plan", "do", "create_horizontal_layer_tasks", "declare_prd_complete_without_validate_or_health"],
            }
        })
        .to_string();
    }
    "{\"gate\":{\"kind\":\"none\",\"blocking\":false}}".to_string()
}

fn default_firmware_layout(project_root: &Path) -> Value {
    let mut source_roots = vec!["firmware/src".to_string(), "firmware/include".to_string()];
    let project_json = project_root.join(".emb-agent/project.json");
    if let Ok(raw) = std::fs::read_to_string(project_json)
        && let Ok(value) = serde_json::from_str::<Value>(&raw)
        && let Some(packages) = value.get("packages").and_then(Value::as_array)
    {
        for package in packages {
            let path = package.get("path").and_then(Value::as_str).unwrap_or("");
            let kind = package
                .get("type")
                .or_else(|| package.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !path.is_empty()
                && (kind == "firmware" || path == "firmware" || path.starts_with("firmware/"))
                && !source_roots.iter().any(|root| root == path)
            {
                source_roots.push(path.to_string());
            }
        }
    }
    for optional in ["firmware", "src", "include"] {
        if project_root.join(optional).is_dir() && !source_roots.iter().any(|root| root == optional)
        {
            source_roots.push(optional.to_string());
        }
    }
    let source_files_present = source_roots
        .iter()
        .any(|root| has_source_files(project_root, Some(root)));
    json!({
        "root": "firmware",
        "source_roots": source_roots,
        "default_source_root": "firmware/src",
        "default_include_root": "firmware/include",
        "legacy_source_roots": ["src", "include"],
        "source_files_present": source_files_present,
        "policy": "new emb-agent firmware projects create firmware/src and firmware/include; legacy src/include remains supported but is not the default"
    })
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
fn has_source_files(project_root: &Path, scope: Option<&str>) -> bool {
    let root = scope
        .map(|scope| project_root.join(scope))
        .unwrap_or_else(|| project_root.to_path_buf());
    if !root.is_dir() {
        return false;
    }
    let extensions = ["c", "h", "rs", "py", "cpp", "hpp", "s", "asm", "S"];
    for ext in &extensions {
        if walkdir_first_file(&root, ext) {
            return true;
        }
    }
    false
}

fn build_graph_health(snapshot: &ProjectSnapshot) -> Value {
    let graph_path = Path::new(&snapshot.project_root).join(".emb-agent/graph/graph.json");
    if !graph_path.is_file() {
        return json!({"status": "missing", "hint": "run `knowledge graph refresh` to build native graph"});
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
    let edges = g
        .get("edges")
        .and_then(|n| n.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let knowledge_index = Path::new(&snapshot.project_root)
        .join(".emb-agent/cache/knowledge/index.json")
        .is_file();
    json!({
        "status": if nodes == 0 { "empty" } else { "ready" },
        "nodes": nodes,
        "edges": edges,
        "native_graph": true,
        "knowledge_index": knowledge_index,
        "hint": if knowledge_index { "" } else { "optional: run `knowledge index --rebuild` for semantic retrieval" }
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
            "git": {
                "branch": snapshot.git_branch,
                "dirty": snapshot.git_dirty_count > 0,
                "dirty_paths": snapshot.git_dirty_count,
                "summary": git_status_summary(snapshot).unwrap_or_default()
            },
            "bootstrap": snapshot.bootstrap_status,
            "workflow": snapshot.workflow_state,
            "firmware_layout": default_firmware_layout(Path::new(&snapshot.project_root))
        },
        "embedded_risk": embedded_risk_json(snapshot),
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
            "active": active_task_name,
            "active_source": snapshot.current_task_source
        },
        "next": {
            "command": snapshot.recommended_command,
            "reason": snapshot.recommended_reason,
            "task_intake": snapshot.task_intake_summary
        },
        "workspace_journal": workspace_journal_json(snapshot),
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
        "workspace_journal": workspace_journal_json(snapshot),
        "embedded_risk": embedded_risk_json(snapshot),
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
    } else if snapshot.recommended_command == "complete" {
        "complete"
    } else if snapshot.current_task.is_some() {
        "do"
    } else {
        "next"
    };
    let runtime_events = json!({
        "status": if action == "do" || action == "complete" { "ok" } else { "pending" },
        "total": 1,
        "blocked": 0,
        "pending": if action == "do" || action == "complete" { 0 } else { 1 },
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
        "workspace_journal": workspace_journal_json(snapshot),
        "embedded_risk": embedded_risk_json(snapshot),
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
            "active": active_task,
            "active_source": snapshot.current_task_source
        },
        "workspace_journal": workspace_journal_json(snapshot),
        "embedded_risk": embedded_risk_json(snapshot),
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
        "embedded_risk": embedded_risk_json(snapshot),
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
    let embedded_risk = embedded_risk_json(snapshot);
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
        "{{\"status\":{},\"pass\":{},\"fail\":{},\"warn\":0,\"truth_validation_errors\":{},\"embedded_risk\":{},\"checks\":[{}]}}",
        json_quote(if fail_count == 0 { "pass" } else { "fail" }),
        pass_count,
        fail_count,
        serde_json::to_string(&snapshot.truth_validation_errors)
            .unwrap_or_else(|_| "[]".to_string()),
        embedded_risk,
        checks_json.join(",")
    )
}

fn statusline_embedded_risk(snapshot: &ProjectSnapshot) -> Option<String> {
    let risk = embedded_risk_level(snapshot);
    if risk == "low" {
        return None;
    }
    let mut labels = Vec::new();
    if snapshot.power_management_risk {
        labels.push("power");
    }
    if snapshot.hardware_electrical_unknown_count > 0 {
        labels.push("io");
    }
    if snapshot.hardware_sleep_state_unknown_count > 0 {
        labels.push("sleep");
    }
    if labels.is_empty() {
        labels.push("hw");
    }
    Some(format!("risk {}", labels.join("/")))
}

fn push_embedded_risk_lines(lines: &mut Vec<String>, snapshot: &ProjectSnapshot) {
    let risk = embedded_risk_json(snapshot);
    let level = risk.get("level").and_then(Value::as_str).unwrap_or("low");
    if level == "low" {
        return;
    }
    let mut summary = vec![format!("Embedded risk: {level}")];
    if snapshot.power_management_risk {
        summary.push("power/sleep/watchdog in scope".to_string());
    }
    if snapshot.hardware_electrical_unknown_count > 0 {
        summary.push(format!(
            "{} signal(s) missing active/electrical/pull/safe-state truth",
            snapshot.hardware_electrical_unknown_count
        ));
    }
    if snapshot.hardware_sleep_state_unknown_count > 0 {
        summary.push(format!(
            "{} signal(s) missing sleep-state or wake-source truth",
            snapshot.hardware_sleep_state_unknown_count
        ));
    }
    if snapshot.hardware_unconfirmed_signal_count > 0 {
        summary.push(format!(
            "{} signal(s) not confirmed",
            snapshot.hardware_unconfirmed_signal_count
        ));
    }
    lines.push(summary.join("; "));
}

fn embedded_risk_level(snapshot: &ProjectSnapshot) -> &'static str {
    if snapshot.power_management_risk
        || snapshot.hardware_sleep_state_unknown_count > 0
        || snapshot.hardware_unknown_count > 0
    {
        "high"
    } else if snapshot.hardware_electrical_unknown_count > 0
        || snapshot.hardware_power_domain_unknown_count > 0
        || snapshot.hardware_unconfirmed_signal_count > 0
    {
        "medium"
    } else {
        "low"
    }
}

fn embedded_risk_json(snapshot: &ProjectSnapshot) -> Value {
    json!({
        "level": embedded_risk_level(snapshot),
        "power_management_risk": snapshot.power_management_risk,
        "hardware": {
            "signals": snapshot.hardware_signal_count,
            "pin_mapping_declared": snapshot.hardware_pin_mapping_declared,
            "unknowns": snapshot.hardware_unknown_count,
            "unconfirmed_signals": snapshot.hardware_unconfirmed_signal_count,
            "electrical_unknown_signals": snapshot.hardware_electrical_unknown_count,
            "power_domain_unknown_signals": snapshot.hardware_power_domain_unknown_count,
            "sleep_state_unknown_signals": snapshot.hardware_sleep_state_unknown_count,
            "wake_sources": snapshot.hardware_wake_source_count
        },
        "ai_gate": {
            "before_io_or_power_edits": [
                "confirm active_level, electrical drive type, pull bias, safe_state, and power_domain for touched signals",
                "confirm sleep_state and wake_source for touched signals when low-power or wake behavior is in scope",
                "capture board-measurement evidence internally for PWM, ADC thresholds, current, wake latency, or sleep current changes"
            ],
            "resource_review": [
                "capture a resource summary internally from the current build report or map after nontrivial firmware edits",
                "flag printf/sprintf/float/division/table/ISR growth on low-ROM targets"
            ],
            "release_handoff": [
                "draft release handoff internally and fill image hash, toolchain version, target chip/package, config bits/fuses, flash method, and verification evidence before release"
            ]
        }
    })
}

fn fallback<'a>(value: &'a str, default_value: &'a str) -> &'a str {
    if value.trim().is_empty() {
        default_value
    } else {
        value
    }
}

fn git_status_summary(snapshot: &ProjectSnapshot) -> Option<String> {
    if snapshot.git_branch.is_empty() && snapshot.git_dirty_count == 0 {
        return None;
    }
    let status = if snapshot.git_dirty_count == 0 {
        "clean".to_string()
    } else {
        format!(
            "dirty {} {}",
            snapshot.git_dirty_count,
            if snapshot.git_dirty_count == 1 {
                "path"
            } else {
                "paths"
            }
        )
    };
    if snapshot.git_branch.is_empty() {
        Some(status)
    } else {
        Some(format!("branch {}; {}", snapshot.git_branch, status))
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
            git_dirty_count: 2,
            open_tasks: 1,
            wiki_pages: 1,
            current_task: Some(TaskSnapshot {
                name: "task-1".to_string(),
                title: "Implement ADC".to_string(),
                status: "active".to_string(),
                priority: "P1".to_string(),
                package: "core".to_string(),
            }),
            current_task_source: "global".to_string(),
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
            hardware_signal_count: 2,
            hardware_unconfirmed_signal_count: 0,
            hardware_electrical_unknown_count: 0,
            hardware_power_domain_unknown_count: 0,
            hardware_sleep_state_unknown_count: 0,
            hardware_wake_source_count: 1,
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
        assert!(line.contains("var esp32-c3"));
        assert!(line.contains("beta"));
        assert!(line.contains("dirty 2"));
        assert!(line.contains("[P1] Implement ADC"));
        assert!(line.contains("(active)"));
        assert!(line.contains("next do"));
    }

    #[test]
    fn statusline_treats_unknown_chip_as_undeclared() {
        let mut snapshot = sample_snapshot();
        snapshot.mcu_model = "unknown".to_string();
        snapshot.mcu_package = "unknown".to_string();
        let line = build_statusline(&snapshot);
        assert!(line.contains("chip undeclared"));
        assert!(!line.contains("unknown/unknown"));
        assert!(!line.contains("unknown unknown"));
    }

    #[test]
    fn claude_statusline_reads_session_json() {
        let payload = r#"{
            "model": {"display_name": "GPT-5 Codex"},
            "context_window": {"used_percentage": 42, "context_window_size": 1000000},
            "cost": {"total_duration_ms": 125000}
        }"#;
        let line = build_statusline_for_host(&sample_snapshot(), "claude", payload);
        assert!(line.contains("GPT-5 Codex (1M)"));
        assert!(line.contains("ctx "));
        assert!(line.contains("42%"));
        assert!(line.contains("2m"));
        assert!(line.contains("[P1]"));
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
        assert_eq!(status["project"]["git"]["branch"], "beta");
        assert_eq!(status["project"]["git"]["dirty"], true);
        assert_eq!(status["project"]["git"]["dirty_paths"], 2);
        assert_eq!(
            status["project"]["git"]["summary"],
            "branch beta; dirty 2 paths"
        );
        assert_eq!(status["embedded_risk"]["level"], "low");
        assert_eq!(status["embedded_risk"]["hardware"]["signals"], 2);
        assert_eq!(status["embedded_risk"]["hardware"]["wake_sources"], 1);

        assert_eq!(status["prd"]["system_prd"], true);
        assert_eq!(status["prd"]["child_prd_count"], 1);
        let next: serde_json::Value =
            serde_json::from_str(&build_next_json(&sample_snapshot())).unwrap();
        assert_eq!(next["language"], "zh");
        assert_eq!(next["language_instruction"], status["language_instruction"]);
        assert_eq!(next["firmware_layout"]["root"], "firmware");
        assert_eq!(
            next["firmware_layout"]["default_source_root"],
            "firmware/src"
        );
        assert_eq!(
            status["project"]["firmware_layout"]["default_include_root"],
            "firmware/include"
        );
        assert_eq!(next["embedded_risk"]["level"], "low");
        assert_eq!(
            next["embedded_risk"]["ai_gate"]["resource_review"][0],
            "capture a resource summary internally from the current build report or map after nontrivial firmware edits"
        );

        let context = build_session_context(&sample_snapshot());
        assert!(context.contains("Response language: Respond to the user in Simplified Chinese"));
    }

    #[test]
    fn embedded_risk_surfaces_power_and_hardware_gaps() {
        let mut snapshot = sample_snapshot();
        snapshot.power_management_risk = true;
        snapshot.hardware_electrical_unknown_count = 1;
        snapshot.hardware_sleep_state_unknown_count = 1;
        snapshot.hardware_unconfirmed_signal_count = 1;
        let statusline = build_statusline(&snapshot);
        assert!(statusline.contains("risk power/io/sleep"));

        let status: serde_json::Value =
            serde_json::from_str(&build_status_json(&snapshot)).unwrap();
        assert_eq!(status["embedded_risk"]["level"], "high");
        assert_eq!(
            status["embedded_risk"]["hardware"]["electrical_unknown_signals"],
            1
        );
        let context = build_session_context(&snapshot);
        assert!(context.contains("Embedded risk: high"));
        assert!(context.contains("missing sleep-state or wake-source truth"));
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
        assert!(context.contains("active task implementation defaults"));
        assert!(context.contains("independent check subagents"));
        assert!(context.contains("system framework design"));
        assert!(context.contains("toolchain migration"));
        assert!(context.contains("vendor/API research"));
        assert!(context.contains("`researcher`"));
        assert!(context.contains("must not recursively spawn"));
        assert!(context.contains("read-only evidence scouts and `researcher` are allowed"));
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
        assert_eq!(
            next["delegation_policy"]["required_before_task_implementation"],
            true
        );
        assert_eq!(
            next["delegation_policy"]["post_implementation_check_required"],
            true
        );
        assert_eq!(
            next["delegation_policy"]["child_self_exemption"],
            "subagents must treat delegation instructions as already satisfied and must not spawn other emb-agent subagents"
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
            "read-only evidence scouts, researchers, and reviewers are allowed during PRD exploration; implementation workers wait until a concrete task is active"
        );
        assert_eq!(
            gate["brainstorm_contract"]["evidence_rule"],
            "If repository evidence can answer a question, inspect evidence before asking the user."
        );
        assert_eq!(
            gate["brainstorm_contract"]["artifact_rules"]["task_prd"],
            "docs/prd/tasks/<task>.md records task-local goal, requirements, acceptance, out-of-scope, open questions, and evidence"
        );
        assert!(
            gate["allowed_actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "delegate_read_only_researcher")
        );
        assert!(
            gate["suggested_read_only_roles"]["general_research"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item == "researcher")
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
