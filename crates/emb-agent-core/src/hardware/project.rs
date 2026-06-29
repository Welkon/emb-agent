use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub name: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub package: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectSnapshot {
    pub initialized: bool,
    pub project_root: String,
    pub active_variant: String,
    pub variant_dir: String,
    pub developer: String,
    pub language: String,
    pub mcu_model: String,
    pub mcu_package: String,
    pub default_package: String,
    pub active_package: String,
    pub git_branch: String,
    pub git_dirty_count: usize,
    pub open_tasks: usize,
    pub wiki_pages: usize,
    pub current_task: Option<TaskSnapshot>,
    pub current_task_source: String,
    pub recommended_command: String,
    pub recommended_reason: String,
    pub bootstrap_status: String,
    pub workflow_state: String,
    pub has_hardware_truth: bool,
    pub task_intake_summary: String,
    pub firmware_manual_required: bool,
    pub requirements_unknown_count: usize,
    pub hardware_unknown_count: usize,
    pub hardware_pin_mapping_declared: bool,
    pub hardware_evidence_files: Vec<String>,
    pub local_doc_tool_priority: Vec<String>,
    pub truth_validation_errors: Vec<String>,
    pub system_prd_exists: bool,
    pub system_prd_has_content: bool,
    pub child_prd_count: usize,
    pub prd_breakdown_needed: bool,
    pub prd_task_candidates: Vec<TaskSnapshot>,
    pub power_management_risk: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectState {
    pub initialized: bool,
    pub project_root: String,
    pub ext_dir: String,
    pub state_dir: String,
    pub active_variant: String,
    pub config: ProjectConfig,
    pub developer: DeveloperInfo,
    pub hardware: HardwareTruth,
    pub requirements: RequirementsTruth,
    pub current_task: Option<TaskRef>,
    pub current_task_source: String,
    pub open_tasks: usize,
    pub wiki_pages: usize,
    pub git_branch: String,
    pub git_dirty_count: usize,
    pub language: String,
    pub truth_validation_errors: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectConfig {
    pub project_profile: String,
    pub active_specs: Vec<String>,
    pub packages: Vec<ProjectPackage>,
    pub default_package: String,
    pub active_package: String,
    pub flash_flow: String,
    pub developer: DeveloperInfo,
    pub preferences: ProjectPreferences,
    pub firmware_framework: FirmwareFramework,
    pub hooks: HookConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirmwareFramework {
    pub official_mode: String,
    pub control_contract: String,
    pub execution_backend: String,
    pub legacy_project_policy: String,
}

impl Default for FirmwareFramework {
    fn default() -> Self {
        Self {
            official_mode: "event-step".to_string(),
            control_contract: "sample-update-apply".to_string(),
            execution_backend: "project-selects-baremetal-or-rtos".to_string(),
            legacy_project_policy: "grandfather-existing-layouts-do-not-rewrite-by-default"
                .to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectPackage {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub submodule: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectPreferences {
    pub truth_source_mode: String,
    pub plan_mode: String,
    pub review_mode: String,
    pub verification_mode: String,
    pub orchestration_mode: String,
    pub auto_runner: bool,
}

impl Default for ProjectPreferences {
    fn default() -> Self {
        Self {
            truth_source_mode: "hardware_first".to_string(),
            plan_mode: "auto".to_string(),
            review_mode: "auto".to_string(),
            verification_mode: "lean".to_string(),
            orchestration_mode: "auto".to_string(),
            auto_runner: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookEntry {
    pub enabled: bool,
    pub runtime: String,
}

impl Default for HookEntry {
    fn default() -> Self {
        Self {
            enabled: true,
            runtime: "auto".to_string(),
        }
    }
}

impl HookEntry {
    fn from_value(value: &Value) -> Self {
        let enabled = value
            .get("enabled")
            .map(|v| match v {
                Value::Bool(b) => *b,
                Value::String(s) => {
                    matches!(s.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes")
                }
                Value::Number(n) => n.as_i64() == Some(1),
                _ => true,
            })
            .unwrap_or(true);
        let runtime = value_string(value, "runtime");
        Self {
            enabled,
            runtime: first_non_empty(&[runtime, "auto".to_string()]),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HookConfig {
    pub session_start: HookEntry,
    pub statusline: HookEntry,
    pub context_monitor: HookEntry,
    pub tool_guard: HookEntry,
}

impl HookConfig {
    fn from_value(value: &Value) -> Self {
        let session_start = value
            .get("session_start")
            .or_else(|| value.get("sessionStart"))
            .map(HookEntry::from_value)
            .unwrap_or_default();
        let statusline = value
            .get("statusline")
            .map(HookEntry::from_value)
            .unwrap_or_default();
        let context_monitor = value
            .get("context_monitor")
            .or_else(|| value.get("contextMonitor"))
            .map(HookEntry::from_value)
            .unwrap_or_default();
        let tool_guard = value
            .get("tool_guard")
            .or_else(|| value.get("toolGuard"))
            .map(HookEntry::from_value)
            .unwrap_or_default();
        Self {
            session_start,
            statusline,
            context_monitor,
            tool_guard,
        }
    }

    pub fn hook_entry(&self, hook: &str) -> &HookEntry {
        match hook {
            "session-start" | "session_start" => &self.session_start,
            "statusline" => &self.statusline,
            "context-monitor" | "context_monitor" => &self.context_monitor,
            "tool-guard" | "tool_guard" => &self.tool_guard,
            _ => &self.session_start,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeveloperInfo {
    pub name: String,
    pub runtime: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HardwareTruth {
    pub vendor: String,
    pub model: String,
    pub package: String,
    pub board_name: String,
    pub target: String,
    pub signals: Vec<HardwareSignal>,
    pub peripherals: Vec<HardwarePeripheral>,
    pub truths: Vec<String>,
    pub constraints: Vec<String>,
    pub unknowns: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HardwareSignal {
    pub name: String,
    pub pin: String,
    pub direction: String,
    pub default_state: String,
    pub confirmed: Option<bool>,
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HardwarePeripheral {
    pub name: String,
    pub usage: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequirementsTruth {
    pub goals: Vec<String>,
    pub features: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance: Vec<String>,
    pub failure_policy: Vec<String>,
    pub unknowns: Vec<String>,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskRef {
    pub name: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub package: String,
    pub path: String,
}
fn is_declared_hardware_model(model: &str) -> bool {
    let trimmed = model.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("unknown")
}

fn has_declared_package(package: &str) -> bool {
    let trimmed = package.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("unknown")
}

fn has_pin_mapping(signals: &[HardwareSignal]) -> bool {
    signals
        .iter()
        .any(|signal| !signal.name.trim().is_empty() && !signal.pin.trim().is_empty())
}

fn hardware_unknown_count(hardware: &HardwareTruth) -> usize {
    let mut count = hardware
        .unknowns
        .iter()
        .filter(|item| !item.trim().is_empty())
        .count();
    let has_model = is_declared_hardware_model(&hardware.model);
    let has_package = has_declared_package(&hardware.package);
    if !has_model {
        count += 1;
    }
    if !has_package {
        count += 1;
    }
    if has_model && has_package && !has_pin_mapping(&hardware.signals) {
        count += 1;
    }
    count
}

fn is_clarification_task(task: &TaskRef) -> bool {
    let text = format!("{} {}", task.name, task.title).to_lowercase();
    [
        "clarify",
        "confirm",
        "decide",
        "requirement",
        "spec",
        "brainstorm",
        "explore",
        "确认",
        "澄清",
        "需求",
        "规格",
        "硬件规格",
        "交互方式",
        "选型",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn system_prd_path(project_root: &Path) -> PathBuf {
    project_root.join("docs").join("prd").join("system.md")
}

fn child_prd_count(project_root: &Path) -> usize {
    let prd_root = project_root.join("docs").join("prd");
    ["tasks", "features", "modules", "components", "subsystems"]
        .iter()
        .map(|dir| count_markdown_files(&prd_root.join(dir)))
        .sum()
}

fn hardware_evidence_files(project_root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_root_hardware_evidence_files(project_root, &mut files);
    for dir in [
        "docs",
        "datasheet",
        "datasheets",
        "reference",
        "references",
        "hardware",
        "schematic",
        "schematics",
        "board",
    ] {
        collect_hardware_evidence_files(project_root, &project_root.join(dir), &mut files);
    }
    files.sort();
    files.dedup();
    files
}

fn collect_root_hardware_evidence_files(project_root: &Path, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(project_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_root_hardware_evidence_file(&path) {
            push_hardware_evidence_file(project_root, &path, files);
        }
    }
}

fn is_root_hardware_evidence_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "schdoc" | "pcbdoc" | "pdf" | "csv" | "net") {
        return true;
    }
    is_hardware_named_text_or_data_file(path)
}

fn collect_hardware_evidence_files(project_root: &Path, dir: &Path, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if should_skip_hardware_evidence_dir(&path) {
                continue;
            }
            collect_hardware_evidence_files(project_root, &path, files);
            continue;
        }
        if is_hardware_evidence_file(&path) {
            push_hardware_evidence_file(project_root, &path, files);
        }
    }
}

fn should_skip_hardware_evidence_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    matches!(
        name,
        ".git"
            | ".emb-agent"
            | ".pi"
            | ".codex"
            | ".cursor"
            | ".claude"
            | ".omp"
            | ".windsurf"
            | "target"
            | "node_modules"
            | "build"
            | "dist"
            | "out"
    )
}

fn push_hardware_evidence_file(project_root: &Path, path: &Path, files: &mut Vec<String>) {
    let rel = path
        .strip_prefix(project_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    files.push(rel);
}

fn is_hardware_evidence_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        ext.as_str(),
        "schdoc" | "pcbdoc" | "pdf" | "csv" | "net" | "json"
    ) {
        return true;
    }
    matches!(ext.as_str(), "md" | "txt") && is_hardware_named_text_or_data_file(path)
}

fn is_hardware_named_text_or_data_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "md" | "txt" | "json" | "yaml" | "yml") {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    [
        "schematic",
        "sch",
        "datasheet",
        "manual",
        "hardware",
        "pinmap",
        "pin-map",
        "board",
        "芯片",
        "手册",
        "原理图",
    ]
    .iter()
    .any(|needle| name.contains(needle))
}

fn is_child_prd_markdown(path: &Path) -> bool {
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return false;
    }
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !matches!(name, "index.md" | "README.md" | "readme.md" | "log.md")
}

fn count_markdown_files(dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_markdown_files(&path)
            } else if is_child_prd_markdown(&path) {
                1
            } else {
                0
            }
        })
        .sum()
}

fn collect_markdown_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files(&path, files);
        } else if is_child_prd_markdown(&path) {
            files.push(path);
        }
    }
}

fn derive_child_prd_candidates(project_root: &Path) -> Vec<TaskSnapshot> {
    let prd_root = project_root.join("docs").join("prd");
    let mut files = Vec::new();
    for dir in ["tasks", "features", "modules", "components", "subsystems"] {
        collect_markdown_files(&prd_root.join(dir), &mut files);
    }
    files.sort();
    files
        .into_iter()
        .filter_map(|path| {
            let name = path.file_stem()?.to_str()?.trim();
            if name.is_empty() {
                return None;
            }
            let source = fs::read_to_string(&path).unwrap_or_default();
            let title = first_markdown_heading(&source)
                .unwrap_or_else(|| format!("Create task from child PRD {}", name));
            Some(TaskSnapshot {
                name: name.to_string(),
                title,
                status: "prd-ready".to_string(),
                priority: "P2".to_string(),
                package: String::new(),
            })
        })
        .collect()
}

fn first_markdown_heading(source: &str) -> Option<String> {
    source.lines().find_map(|line| {
        let trimmed = line.trim();
        let title = trimmed.strip_prefix("# ")?.trim();
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    })
}

fn system_prd_has_substantive_content(source: &str) -> bool {
    let mut meaningful_lines = 0usize;
    let mut bullet_lines = 0usize;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('>') {
            continue;
        }
        meaningful_lines += 1;
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            bullet_lines += 1;
        }
    }
    bullet_lines > 0 || meaningful_lines >= 3
}

fn text_mentions_any(text: &str, needles: &[&str]) -> bool {
    let haystack = text.to_ascii_lowercase();
    needles.iter().any(|needle| haystack.contains(needle))
}

fn list_mentions_any(items: &[String], needles: &[&str]) -> bool {
    items.iter().any(|item| text_mentions_any(item, needles))
}

fn has_structure_explanation_intent(state: &ProjectState) -> bool {
    let keywords = [
        "service walkthrough",
        "service split",
        "scheduler",
        "time-slice",
        "timeslice",
        "call chain",
        "structure explanation",
        "explain current structure",
        "architecture walkthrough",
    ];
    list_mentions_any(&state.requirements.goals, &keywords)
        || list_mentions_any(&state.requirements.features, &keywords)
        || list_mentions_any(&state.requirements.acceptance, &keywords)
        || state
            .current_task
            .as_ref()
            .map(|task| {
                text_mentions_any(&task.name, &keywords)
                    || text_mentions_any(&task.title, &keywords)
            })
            .unwrap_or(false)
}

fn has_power_management_risk(system_prd_source: &str, state: &ProjectState) -> bool {
    let keywords = [
        "battery",
        "sleep",
        "wake",
        "wakeup",
        "wake-up",
        "stop",
        "standby",
        "low-power",
        "low power",
        "watchdog",
        "wdt",
        "swdten",
        "deep sleep",
        "idle current",
        "quiescent current",
        "key wake",
        "button wake",
        "power-down",
        "power down",
    ];
    text_mentions_any(system_prd_source, &keywords)
        || list_mentions_any(&state.requirements.goals, &keywords)
        || list_mentions_any(&state.requirements.features, &keywords)
        || list_mentions_any(&state.requirements.constraints, &keywords)
        || list_mentions_any(&state.requirements.acceptance, &keywords)
        || list_mentions_any(&state.requirements.failure_policy, &keywords)
        || list_mentions_any(&state.requirements.unknowns, &keywords)
        || list_mentions_any(&state.hardware.unknowns, &keywords)
        || state
            .current_task
            .as_ref()
            .map(|task| {
                text_mentions_any(&task.name, &keywords)
                    || text_mentions_any(&task.title, &keywords)
            })
            .unwrap_or(false)
}

fn derive_prd_task_candidates(project_root: &Path) -> Vec<TaskSnapshot> {
    let path = system_prd_path(project_root);
    let source = fs::read_to_string(path).unwrap_or_default();
    if !system_prd_has_substantive_content(&source) {
        return Vec::new();
    }
    let haystack = source.to_ascii_lowercase();
    let groups: [(&str, &str, &[&str]); 7] = [
        (
            "motor-control",
            "Create motor control / PWM run-cycle task PRD",
            &[
                "motor",
                "pwm",
                "boost",
                "mosfet",
                "soft-start",
                "duty",
                "run_30s",
            ],
        ),
        (
            "safety-interlock",
            "Create safety interlock task PRD",
            &["safety", "interlock", "skey", "key", "press", "release"],
        ),
        (
            "low-voltage-protection",
            "Create low-voltage protection task PRD",
            &["low-voltage", "low voltage", "cutoff", "recovery", "badc"],
        ),
        (
            "current-stall-protection",
            "Create current / stall protection task PRD",
            &["current", "stall", "overload", "cstuck", "fault"],
        ),
        (
            "led-charge-indication",
            "Create LED and charge indication task PRD",
            &["led", "red", "green", "charge", "charging", "chrg", "usb"],
        ),
        (
            "sleep-wake-policy",
            "Create sleep / wake policy task PRD",
            &["sleep", "wake", "stop", "reset", "standby"],
        ),
        (
            "hardware-acceptance",
            "Create hardware acceptance evidence task PRD",
            &["hardware", "resistor", "feedback", "vout", "schematic"],
        ),
    ];
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for (name, title, needles) in groups {
        if needles.iter().any(|needle| haystack.contains(needle)) && seen.insert(name) {
            candidates.push(TaskSnapshot {
                name: name.to_string(),
                title: title.to_string(),
                status: "suggested".to_string(),
                priority: "P2".to_string(),
                package: String::new(),
            });
        }
    }
    if candidates.is_empty() {
        candidates.push(TaskSnapshot {
            name: "system-prd-slice".to_string(),
            title: "Create first child execution PRD from docs/prd/system.md".to_string(),
            status: "suggested".to_string(),
            priority: "P2".to_string(),
            package: String::new(),
        });
    }
    candidates
}

pub fn validate_truth_files(project_root: &Path) -> Vec<String> {
    let ext = project_root.join(".emb-agent");
    let state_dir = crate::variant_ops::active_state_dir(&ext);
    let mut errors = Vec::new();
    validate_truth_yaml_file(
        &state_dir.join("hw.yaml"),
        "hw.yaml",
        &["truths", "constraints", "unknowns"],
        &["signals", "peripherals"],
        &mut errors,
    );
    validate_truth_yaml_file(
        &state_dir.join("req.yaml"),
        "req.yaml",
        &[
            "goals",
            "features",
            "constraints",
            "acceptance",
            "failure_policy",
            "unknowns",
            "sources",
        ],
        &["confirmed_facts"],
        &mut errors,
    );
    errors
}

fn validate_truth_yaml_file(
    path: &Path,
    label: &str,
    list_keys: &[&str],
    object_list_keys: &[&str],
    errors: &mut Vec<String>,
) {
    let Ok(source) = fs::read_to_string(path) else {
        errors.push(format!("{label}: missing or unreadable"));
        return;
    };
    let source = source.trim();
    if source.is_empty() {
        errors.push(format!("{label}: empty truth file"));
        return;
    }
    validate_yaml_structure(source, label, list_keys, object_list_keys, errors);
    validate_duplicate_yaml_keys(source, label, errors);
    if label == "req.yaml" {
        validate_object_list_required_fields(
            source,
            label,
            "confirmed_facts",
            &["source", "fact"],
            errors,
        );
    }
}

fn validate_yaml_structure(
    source: &str,
    label: &str,
    list_keys: &[&str],
    object_list_keys: &[&str],
    errors: &mut Vec<String>,
) {
    let known_keys: Vec<&str> = list_keys
        .iter()
        .chain(object_list_keys.iter())
        .copied()
        .collect();
    let mut current_sequence: Option<(&str, usize)> = None;
    for (line_index, line) in source.lines().enumerate() {
        let line_no = line_index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.chars().take_while(|ch| *ch == ' ').count();
        if indent == 0 {
            if let Some(item) = trimmed.strip_prefix("- ") {
                errors.push(format!(
                    "{label}:{line_no}: top-level list item `{}` is not under a mapping key; keep `.emb-agent/*.yaml` list entries indented two spaces",
                    item.trim()
                ));
                current_sequence = None;
                continue;
            }
            current_sequence = trimmed.strip_suffix(':').and_then(|key| {
                known_keys
                    .iter()
                    .copied()
                    .find(|known| *known == key)
                    .map(|known| (known, line_no))
            });
            continue;
        }
        if let Some((key, start_line)) = current_sequence {
            if list_keys.contains(&key) && trimmed.starts_with("- ") && indent != 2 {
                errors.push(format!(
                    "{label}:{line_no}: `{key}` list item must use exactly two-space indentation from line {start_line}"
                ));
            }
            if object_list_keys.contains(&key) && trimmed.starts_with("- ") && indent != 2 {
                errors.push(format!(
                    "{label}:{line_no}: `{key}` object item must use exactly two-space indentation from line {start_line}"
                ));
            }
        }
    }
}

struct YamlMapFrame {
    indent: usize,
    keys: HashSet<String>,
}

fn validate_duplicate_yaml_keys(source: &str, label: &str, errors: &mut Vec<String>) {
    let mut stack: Vec<YamlMapFrame> = Vec::new();
    for (line_index, line) in source.lines().enumerate() {
        let line_no = line_index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.chars().take_while(|ch| *ch == ' ').count();
        if let Some(item) = trimmed.strip_prefix("- ") {
            let map_indent = indent + 2;
            while stack.last().is_some_and(|frame| frame.indent >= map_indent) {
                stack.pop();
            }
            stack.push(YamlMapFrame {
                indent: map_indent,
                keys: HashSet::new(),
            });
            if let Some(key) = yaml_key_name(item) {
                record_yaml_key(label, line_no, key, stack.last_mut(), errors);
            }
            continue;
        }
        let Some(key) = yaml_key_name(trimmed) else {
            continue;
        };
        while stack.last().is_some_and(|frame| frame.indent > indent) {
            stack.pop();
        }
        if stack
            .last()
            .map(|frame| frame.indent < indent)
            .unwrap_or(true)
        {
            stack.push(YamlMapFrame {
                indent,
                keys: HashSet::new(),
            });
        }
        record_yaml_key(label, line_no, key, stack.last_mut(), errors);
    }
}

fn record_yaml_key(
    label: &str,
    line_no: usize,
    key: &str,
    frame: Option<&mut YamlMapFrame>,
    errors: &mut Vec<String>,
) {
    if let Some(frame) = frame
        && !frame.keys.insert(key.to_string())
    {
        errors.push(format!(
            "{label}:{line_no}: duplicate key `{key}` in the same YAML mapping"
        ));
    }
}

fn yaml_key_name(line: &str) -> Option<&str> {
    let (key, _) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty() || key.contains(' ') || key.starts_with('#') {
        None
    } else {
        Some(key)
    }
}

fn validate_object_list_required_fields(
    source: &str,
    label: &str,
    key: &str,
    required: &[&str],
    errors: &mut Vec<String>,
) {
    if !source
        .lines()
        .any(|line| line.trim() == format!("{key}:").as_str())
    {
        return;
    }
    for (index, entry) in yaml_object_list(source, key).iter().enumerate() {
        for field in required {
            if entry
                .get(*field)
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                errors.push(format!(
                    "{label}: `{key}` item {} is missing required `{field}`",
                    index + 1
                ));
            }
        }
    }
}

fn has_firmware_manual_evidence(state_dir: &Path, model: &str) -> bool {
    let model_key = normalize_identifier(model);
    if model_key.is_empty() {
        return false;
    }
    cache_has_parsed_doc(state_dir)
        || dir_has_named_evidence(&state_dir.join("wiki").join("chips"), &model_key)
        || dir_has_named_evidence(&state_dir.join("chips"), &model_key)
        || dir_has_named_evidence(
            &state_dir.join("extensions").join("chips").join("profiles"),
            &model_key,
        )
}

fn cache_has_parsed_doc(state_dir: &Path) -> bool {
    let cache_dir = state_dir.join("cache").join("docs");
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|entry| entry.path().join("parse.md").is_file())
}

fn dir_has_named_evidence(dir: &Path, model_key: &str) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.is_dir() {
            return dir_has_named_evidence(&path, model_key);
        }
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(normalize_identifier)
            .unwrap_or_default();
        !name.is_empty() && (name.contains(model_key) || model_key.contains(&name))
    })
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn snapshot_from_cwd(cwd: &str) -> ProjectSnapshot {
    let state = project_state_from_cwd(cwd);
    if !state.initialized {
        return ProjectSnapshot {
            initialized: false,
            recommended_command: "onboard".to_string(),
            recommended_reason: "Project not yet initialized. Run emb-start to scaffold .emb-agent/ or migrate existing hardware documents.".to_string(),
            ..ProjectSnapshot::default()
        };
    }

    let project_root = Path::new(&state.project_root);
    let system_prd = system_prd_path(project_root);
    let system_prd_exists = system_prd.is_file();
    let system_prd_source = fs::read_to_string(&system_prd).unwrap_or_default();
    let system_prd_has_content =
        system_prd_exists && system_prd_has_substantive_content(&system_prd_source);
    let child_prd_count = child_prd_count(project_root);
    let power_management_risk = has_power_management_risk(&system_prd_source, &state);

    let has_hardware = is_declared_hardware_model(&state.hardware.model);
    let evidence_files = hardware_evidence_files(project_root);
    let local_doc_tool_priority = crate::lookup::configured_local_tool_order(project_root);
    let hardware_first_docs_pending = state
        .config
        .preferences
        .truth_source_mode
        .trim()
        .eq_ignore_ascii_case("hardware_first")
        && !has_hardware
        && !evidence_files.is_empty();
    let active_is_clarification = state
        .current_task
        .as_ref()
        .map(is_clarification_task)
        .unwrap_or(false);
    let has_truth_errors = !state.truth_validation_errors.is_empty();
    let requirements_have_content = !state.requirements.goals.is_empty()
        || !state.requirements.features.is_empty()
        || !state.requirements.constraints.is_empty()
        || !state.requirements.acceptance.is_empty()
        || !state.requirements.failure_policy.is_empty();
    let needs_prd_exploration = state.current_task.is_none()
        && state.open_tasks == 0
        && !requirements_have_content
        && (!system_prd_exists || !system_prd_has_content);
    let needs_clarification = has_truth_errors
        || !state.requirements.unknowns.is_empty()
        || !state.hardware.unknowns.is_empty()
        || active_is_clarification
        || needs_prd_exploration;
    let bootstrap_status = if !state.config.active_specs.is_empty() {
        "ready"
    } else if has_hardware {
        "bootstrap_ready"
    } else if needs_clarification {
        "concept"
    } else {
        "needs-hardware"
    };
    let workflow_state = if active_is_clarification {
        "clarifying"
    } else if state.current_task.is_some() {
        "task_active"
    } else if has_hardware {
        "ready"
    } else {
        "concept"
    };
    let task_total_count = count_known_execution_tasks(Path::new(&state.state_dir));
    let completed_task_count = count_completed_execution_tasks(Path::new(&state.state_dir));
    let all_known_tasks_closed = task_total_count > 0
        && state.current_task.is_none()
        && state.open_tasks == 0
        && has_hardware
        && child_prd_count == 0
        && system_prd_has_content
        && completed_task_count > 0;
    let explanation_only_path = has_structure_explanation_intent(&state)
        && state.current_task.is_none()
        && state.open_tasks == 0
        && requirements_have_content;
    let prd_breakdown_needed = has_hardware
        && !has_truth_errors
        && !needs_prd_exploration
        && state.current_task.is_none()
        && state.open_tasks == 0
        && !explanation_only_path
        && !all_known_tasks_closed
        && system_prd_has_content
        && child_prd_count == 0;
    let firmware_manual_required = has_hardware
        && !has_firmware_manual_evidence(Path::new(&state.state_dir), &state.hardware.model)
        && !all_known_tasks_closed
        && !explanation_only_path
        && (state.current_task.is_some()
            || (state.open_tasks == 0 && requirements_have_content && child_prd_count == 0));
    let prd_child_selection_needed = has_hardware
        && !has_truth_errors
        && !needs_prd_exploration
        && state.current_task.is_none()
        && state.open_tasks == 0
        && child_prd_count > 0;
    let prd_task_candidates = if prd_breakdown_needed {
        derive_prd_task_candidates(project_root)
    } else if prd_child_selection_needed {
        derive_child_prd_candidates(project_root)
    } else {
        Vec::new()
    };
    let task_intake_summary = if has_truth_errors {
        format!(
            "Project truth validation failed: {}. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml first; run the installed emb-agent runtime's doctor or health command after editing. Do not proceed to implementation while truth files are invalid.",
            state.truth_validation_errors.join("; ")
        )
    } else if active_is_clarification {
        let mut summary = "Continue the active clarification/brainstorming task as a doc-grounded brainstorm loop. Inspect repository evidence before asking, ask one load-bearing question at a time with a recommended answer and trade-off, challenge ambiguous terms against project truth, extract exact timing/percentage/slope values from any waveform or measurement captures before implementing, update docs/prd/system.md or the task PRD plus .emb-agent/req.yaml after confirmation, run the installed emb-agent runtime's validate or health command after truth edits, and do not create another task or start implementation until the state-machine checklist and concrete scope are explicit.".to_string();
        if power_management_risk {
            summary.push_str(" Because sleep/power behavior is in scope, explicitly lock down watchdog policy, sleep entry conditions, wake sources, pre-sleep peripheral shutdown, post-wake restore sequence, config-bit dependencies, and idle-current acceptance evidence before coding.");
        }
        summary
    } else if needs_prd_exploration {
        if hardware_first_docs_pending {
            let mut summary = "System PRD is missing or still scaffold-only, and hardware-first evidence exists under docs/. Before asking behavior questions, list docs hardware inputs, ingest schematics with `ingest schematic`, parse MCU/datasheet PDFs with `ingest doc` using the configured local tool order before MinerU fallback, record schematic/manual conflicts as PRD/req unknowns, then ask one load-bearing behavior/power/reset/acceptance question at a time with a recommended answer and trade-off.".to_string();
            if power_management_risk {
                summary.push_str(" Treat watchdog and sleep policy as first-pass PRD questions, not later implementation cleanup.");
            }
            summary
        } else {
            let mut summary = "System PRD is missing or still scaffold-only. Run the brainstorm contract before task creation: inspect repository evidence first, ask one load-bearing behavior/power/reset/acceptance question at a time with a recommended answer and trade-off, update docs/prd/system.md and .emb-agent/req.yaml after confirmation, run validate or health after truth edits, and stop until explicit agreement.".to_string();
            if power_management_risk {
                summary.push_str(" Front-load watchdog behavior, sleep entry and wake conditions, config-bit dependencies, peripheral shutdown/restore, and measured idle-current acceptance.");
            }
            summary
        }
    } else if firmware_manual_required {
        let mut summary = "MCU/package truth exists but no parsed MCU manual or chip-support evidence is available. Ingest the MCU manual/datasheet with `ingest doc --provider auto`, verify register/GPIO/ADC/timer/sleep evidence, then rerun next before firmware work.".to_string();
        if power_management_risk {
            summary.push_str(" Include watchdog software-control limits, config words, wake sources, and STOP/standby caveats in that evidence pass.");
        }
        summary
    } else if state.current_task.is_some() {
        String::new()
    } else if all_known_tasks_closed {
        "All known execution tasks are closed. Do not force PRD breakdown only because no child PRD files remain. Present the project as code-complete and route the user toward board-level acceptance, release packaging, or explicit new-scope intake if they request more work.".to_string()
    } else if !state.requirements.unknowns.is_empty()
        || !state.hardware.unknowns.is_empty()
        || !has_hardware
    {
        let mut summary = "Continue requirement exploration/brainstorming as a doc-grounded brainstorm loop. Inspect repository evidence before asking; clarify behavior, interaction, power, LED, mechanical, hardware constraints, and the state-machine checklist one question at a time with recommended answers and trade-offs; update docs/prd/system.md and .emb-agent/req.yaml; run the installed emb-agent runtime's validate or health command after truth edits. Do not create an implementation task until the user confirms a concrete deliverable or bug. If the latest user request already confirms a concrete deliverable or bug, record that scope, fill the task PRD and brief from the confirmed facts, and create/activate the implementation task after health passes instead of asking for another confirmation.".to_string();
        if power_management_risk {
            summary.push_str(" For battery or low-power behavior, explicitly close watchdog, sleep/wake, config-bit, and idle-current unknowns early.");
        }
        summary
    } else if explanation_only_path {
        "The current request is understanding-first work about structure, scheduler flow, or service layout. Answer directly with a scoped architecture walkthrough before creating PRDs or tasks. If the discussion later turns into resumable implementation work, then create a durable task or PRD.".to_string()
    } else if prd_breakdown_needed {
        "docs/prd/system.md exists but no child execution PRDs exist under docs/prd/tasks|features|modules|components|subsystems. Read docs/prd/system.md, present prd_task_candidates, create vertical child PRDs, run validate or health after PRD edits, then wait for explicit agreement before task add or activation.".to_string()
    } else if prd_child_selection_needed {
        "Child execution PRDs exist but no task is active. Present prd_task_candidates as ready child-PRD work options. A task is recommended for multi-step or resumable work, but a narrowly scoped explanation, evidence lookup, verification run, or small fix can proceed directly after the scope and verification surface are explicit.".to_string()
    } else {
        "Ask what work the user wants to start. Classify it as bug, feature, board-bringup, power, timing, or toolchain. Use a durable agent brief and vertical tracer-bullet slices for multi-step work, but do not force task creation for a narrow one-off analysis, explanation, verification run, or small scoped fix.".to_string()
    };

    let (recommended_command, recommended_reason) = if has_truth_errors {
        (
            "clarify".to_string(),
            format!(
                "Project truth files are invalid: {}. Repair YAML before continuing.",
                state.truth_validation_errors.join("; ")
            ),
        )
    } else if active_is_clarification {
        (
            "clarify".to_string(),
            "Active work is requirement/hardware clarification. Continue the doc-grounded brainstorm contract and record confirmed decisions before creating implementation tasks.".to_string(),
        )
    } else if needs_prd_exploration {
        (
            "clarify".to_string(),
            "System PRD is missing or scaffold-only. Complete PRD exploration and validation before creating implementation tasks.".to_string(),
        )
    } else if firmware_manual_required {
        (
            "ingest-docs".to_string(),
            "MCU manual/register evidence is required before firmware implementation or task creation. Ingest and verify the MCU manual/datasheet first.".to_string(),
        )
    } else if state.current_task.is_some() {
        ("do".to_string(), "Active task is selected".to_string())
    } else if all_known_tasks_closed {
        (
            "complete".to_string(),
            "All known execution tasks are closed. PRD breakdown is not required unless the user explicitly adds new scope or identifies an uncovered requirement.".to_string(),
        )
    } else if !state.requirements.unknowns.is_empty()
        || !state.hardware.unknowns.is_empty()
        || !has_hardware
    {
        (
            "clarify".to_string(),
            "Project is still in concept/requirements exploration. Clarify the listed blockers, state-machine behavior, and acceptance evidence before implementation; if the user has already confirmed a concrete deliverable or bug, record it and create/activate a scoped task after health passes.".to_string(),
        )
    } else if explanation_only_path {
        (
            "next".to_string(),
            "The current request is structure explanation or scheduler understanding. Route directly to explanation-first work; do not force PRD breakdown or task creation unless the scope expands into implementation.".to_string(),
        )
    } else if prd_breakdown_needed {
        (
            "prd-breakdown".to_string(),
            "System PRD exists but no child execution PRDs or open tasks exist. Break the system PRD into vertical task PRDs before work selection.".to_string(),
        )
    } else if prd_child_selection_needed {
        (
            "choose-work".to_string(),
            "Child execution PRDs exist but no task is active. Choose a child PRD and decide whether the work needs a durable task or can be handled as a bounded one-off change or analysis.".to_string(),
        )
    } else {
        (
            "next".to_string(),
            "Project has hardware context; continue workflow routing".to_string(),
        )
    };

    let hardware_unknown_count = hardware_unknown_count(&state.hardware);

    ProjectSnapshot {
        initialized: state.initialized,
        project_root: state.project_root,
        active_variant: state.active_variant,
        variant_dir: state.state_dir,
        developer: state.developer.name,
        language: state.language,
        mcu_model: state.hardware.model,
        mcu_package: state.hardware.package,
        default_package: state.config.default_package,
        active_package: state.config.active_package,
        git_branch: state.git_branch,
        git_dirty_count: state.git_dirty_count,
        open_tasks: state.open_tasks,
        wiki_pages: state.wiki_pages,
        current_task: state.current_task.map(|task| TaskSnapshot {
            name: task.name,
            title: task.title,
            status: task.status,
            priority: task.priority,
            package: task.package,
        }),
        current_task_source: state.current_task_source,
        recommended_command,
        recommended_reason,
        bootstrap_status: bootstrap_status.to_string(),
        workflow_state: workflow_state.to_string(),
        has_hardware_truth: has_hardware,
        task_intake_summary,
        firmware_manual_required,
        requirements_unknown_count: state.requirements.unknowns.len(),
        hardware_unknown_count,
        hardware_pin_mapping_declared: has_pin_mapping(&state.hardware.signals),
        hardware_evidence_files: evidence_files,
        local_doc_tool_priority,
        truth_validation_errors: state.truth_validation_errors,
        system_prd_exists,
        system_prd_has_content,
        child_prd_count,
        prd_breakdown_needed,
        prd_task_candidates,
        power_management_risk,
    }
}

/// Read all tasks from the .emb-agent/tasks/ directory
pub fn read_all_tasks(ext_dir: &Path) -> Vec<TaskSnapshot> {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let tasks_dir = state_dir.join("tasks");
    let mut tasks = Vec::new();
    if let Ok(entries) = fs::read_dir(&tasks_dir) {
        for entry in entries.flatten() {
            let task_json_path = entry.path().join("task.json");
            if let Some(task) = read_task_ref(&entry.file_name().to_string_lossy(), &task_json_path)
            {
                if is_closed_task(&task.status) {
                    continue;
                }
                tasks.push(TaskSnapshot {
                    name: task.name,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    package: task.package,
                });
            }
        }
    }
    tasks
}

/// Read a single task by name
pub fn read_task(ext_dir: &Path, name: &str) -> Option<Value> {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    let content = fs::read_to_string(&task_path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn project_state_from_cwd(cwd: &str) -> ProjectState {
    let Some(root) = find_project_root(Path::new(cwd)) else {
        return ProjectState::default();
    };
    read_project_state_for_session(&root, Path::new(cwd), "cli")
}

pub fn read_project_state(project_root: &Path) -> ProjectState {
    read_project_state_inner(project_root, None)
}

pub fn read_project_state_for_session(project_root: &Path, cwd: &Path, host: &str) -> ProjectState {
    read_project_state_inner(project_root, Some((cwd, host)))
}

fn read_project_state_inner(project_root: &Path, session: Option<(&Path, &str)>) -> ProjectState {
    let root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let ext = root.join(".emb-agent");
    let active_variant = crate::variant_ops::active_variant_name(&ext).unwrap_or_default();
    let state_dir = crate::variant_ops::active_state_dir(&ext);
    let project_json = read_text(&state_dir.join("project.json"));
    let hw_yaml = read_text(&state_dir.join("hw.yaml"));
    let req_yaml = read_text(&state_dir.join("req.yaml"));
    let developer_json = read_text(&ext.join(".developer"));
    let developer_json = if developer_json.is_empty() {
        read_text(&ext.join(".install").join("developer.json"))
    } else {
        developer_json
    };
    let language = read_text(&ext.join(".language"));
    let language = if language.is_empty() {
        read_text(&ext.join(".install").join("language"))
    } else {
        language
    };
    let (current_task, current_task_source) =
        read_current_task_ref_with_source(&state_dir, &ext, session);
    let truth_validation_errors = validate_truth_files(&root);

    ProjectState {
        initialized: state_dir.join("project.json").exists() || ext.join("project.json").exists(),
        project_root: root.to_string_lossy().to_string(),
        ext_dir: ext.to_string_lossy().to_string(),
        state_dir: state_dir.to_string_lossy().to_string(),
        active_variant,
        config: ProjectConfig::from_json(&project_json),
        developer: DeveloperInfo::from_json(&developer_json),
        language,
        hardware: HardwareTruth::from_yaml(&hw_yaml),
        requirements: RequirementsTruth::from_yaml(&req_yaml),
        current_task,
        current_task_source,
        open_tasks: count_open_tasks(&state_dir),
        wiki_pages: count_wiki_pages(&state_dir),
        git_branch: git_branch(&root),
        git_dirty_count: git_dirty_count(&root),
        truth_validation_errors,
    }
}

impl ProjectConfig {
    pub fn from_json(source: &str) -> Self {
        let value = serde_json::from_str::<Value>(source).unwrap_or(Value::Null);
        let packages = value
            .get("packages")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(ProjectPackage::from_value).collect())
            .unwrap_or_default();

        Self {
            project_profile: value_string(&value, "project_profile"),
            active_specs: value_string_array(&value, "active_specs"),
            packages,
            default_package: value_string(&value, "default_package"),
            active_package: value_string(&value, "active_package"),
            flash_flow: value_string(&value, "flash_flow"),
            developer: DeveloperInfo::from_value(value.get("developer").unwrap_or(&Value::Null)),
            preferences: ProjectPreferences::from_value(
                value.get("preferences").unwrap_or(&Value::Null),
            ),
            firmware_framework: FirmwareFramework::from_value(
                value.get("firmware_framework").unwrap_or(&Value::Null),
            ),
            hooks: HookConfig::from_value(value.get("hooks").unwrap_or(&Value::Null)),
        }
    }
}

impl ProjectPackage {
    fn from_value(value: &Value) -> Self {
        Self {
            name: value_string(value, "name"),
            path: value_string(value, "path"),
            kind: first_non_empty(&[value_string(value, "type"), "unknown".to_string()]),
            submodule: value_bool(value, "submodule").unwrap_or(false),
        }
    }
}

impl ProjectPreferences {
    fn from_value(value: &Value) -> Self {
        let defaults = Self::default();
        Self {
            truth_source_mode: first_non_empty(&[
                value_string(value, "truth_source_mode"),
                defaults.truth_source_mode,
            ]),
            plan_mode: first_non_empty(&[value_string(value, "plan_mode"), defaults.plan_mode]),
            review_mode: first_non_empty(&[
                value_string(value, "review_mode"),
                defaults.review_mode,
            ]),
            verification_mode: first_non_empty(&[
                value_string(value, "verification_mode"),
                defaults.verification_mode,
            ]),
            orchestration_mode: first_non_empty(&[
                value_string(value, "orchestration_mode"),
                defaults.orchestration_mode,
            ]),
            auto_runner: value
                .get("auto_runner")
                .map(|v| match v {
                    Value::Bool(b) => *b,
                    Value::Number(n) => n.as_i64() == Some(1),
                    _ => false,
                })
                .unwrap_or(false),
        }
    }
}

impl FirmwareFramework {
    fn from_value(value: &Value) -> Self {
        let defaults = Self::default();
        let legacy_shape = value_string(value, "scheduler_shape");
        let legacy_backend = if legacy_shape.is_empty() {
            String::new()
        } else {
            "baremetal-superloop-compatible".to_string()
        };
        Self {
            official_mode: first_non_empty(&[
                value_string(value, "official_mode"),
                if legacy_shape.is_empty() {
                    String::new()
                } else {
                    "event-step".to_string()
                },
                defaults.official_mode,
            ]),
            control_contract: first_non_empty(&[
                value_string(value, "control_contract"),
                legacy_shape,
                defaults.control_contract,
            ]),
            execution_backend: first_non_empty(&[
                value_string(value, "execution_backend"),
                legacy_backend,
                defaults.execution_backend,
            ]),
            legacy_project_policy: first_non_empty(&[
                value_string(value, "legacy_project_policy"),
                defaults.legacy_project_policy,
            ]),
        }
    }
}

impl DeveloperInfo {
    fn from_json(source: &str) -> Self {
        let value = serde_json::from_str::<Value>(source).unwrap_or(Value::Null);
        Self::from_value(&value)
    }

    fn from_value(value: &Value) -> Self {
        Self {
            name: value_string(value, "name"),
            runtime: value_string(value, "runtime"),
        }
    }
}

impl HardwareTruth {
    pub fn from_yaml(source: &str) -> Self {
        Self {
            vendor: first_non_empty(&[
                yaml_nested_string(source, "mcu", "vendor"),
                yaml_scalar_by_key(source, "vendor"),
            ]),
            model: first_non_empty(&[
                yaml_nested_string(source, "mcu", "model"),
                yaml_scalar_by_key(source, "model"),
                yaml_scalar_by_key(source, "chip"),
            ]),
            package: first_non_empty(&[
                yaml_nested_string(source, "mcu", "package"),
                yaml_scalar_by_key(source, "package"),
            ]),
            board_name: yaml_nested_string(source, "board", "name"),
            target: yaml_nested_string(source, "board", "target"),
            signals: yaml_object_list(source, "signals")
                .into_iter()
                .map(HardwareSignal::from_map)
                .collect(),
            peripherals: yaml_object_list(source, "peripherals")
                .into_iter()
                .map(HardwarePeripheral::from_map)
                .collect(),
            truths: yaml_string_list(source, "truths"),
            constraints: yaml_string_list(source, "constraints"),
            unknowns: yaml_string_list(source, "unknowns"),
        }
    }
}

impl HardwareSignal {
    fn from_map(value: BTreeMap<String, String>) -> Self {
        Self {
            name: value.get("name").cloned().unwrap_or_default(),
            pin: value.get("pin").cloned().unwrap_or_default(),
            direction: value.get("direction").cloned().unwrap_or_default(),
            default_state: value.get("default_state").cloned().unwrap_or_default(),
            confirmed: value
                .get("confirmed")
                .and_then(|value| parse_yaml_bool(value)),
            note: value.get("note").cloned().unwrap_or_default(),
        }
    }
}

impl HardwarePeripheral {
    fn from_map(value: BTreeMap<String, String>) -> Self {
        Self {
            name: value.get("name").cloned().unwrap_or_default(),
            usage: value.get("usage").cloned().unwrap_or_default(),
        }
    }
}

impl RequirementsTruth {
    pub fn from_yaml(source: &str) -> Self {
        Self {
            goals: yaml_string_list(source, "goals"),
            features: yaml_string_list(source, "features"),
            constraints: yaml_string_list(source, "constraints"),
            acceptance: yaml_string_list(source, "acceptance"),
            failure_policy: yaml_string_list(source, "failure_policy"),
            unknowns: yaml_string_list(source, "unknowns"),
            sources: yaml_string_list(source, "sources"),
        }
    }
}

pub fn build_project_state_json(state: &ProjectState) -> String {
    serde_json::json!({
        "status": "ok",
        "runtime": "emb-agent-rs-spike",
        "initialized": state.initialized,
        "project_root": state.project_root,
        "ext_dir": state.ext_dir,
        "state_dir": state.state_dir,
        "active_variant": state.active_variant,
        "config": {
            "project_profile": state.config.project_profile,
            "active_specs": state.config.active_specs,
            "packages": state.config.packages.iter().map(|package| serde_json::json!({
                "name": package.name,
                "path": package.path,
                "type": package.kind,
                "submodule": package.submodule,
            })).collect::<Vec<_>>(),
            "default_package": state.config.default_package,
            "active_package": state.config.active_package,
            "flash_flow": state.config.flash_flow,
            "developer": {
                "name": state.config.developer.name,
                "runtime": state.config.developer.runtime,
            },
            "preferences": {
                "truth_source_mode": state.config.preferences.truth_source_mode,
                "plan_mode": state.config.preferences.plan_mode,
                "review_mode": state.config.preferences.review_mode,
                "verification_mode": state.config.preferences.verification_mode,
                "orchestration_mode": state.config.preferences.orchestration_mode,
                "auto_runner": state.config.preferences.auto_runner,
            },
            "hooks": {
                "session_start": {
                    "enabled": state.config.hooks.session_start.enabled,
                    "runtime": &state.config.hooks.session_start.runtime,
                },
                "statusline": {
                    "enabled": state.config.hooks.statusline.enabled,
                    "runtime": &state.config.hooks.statusline.runtime,
                },
                "context_monitor": {
                    "enabled": state.config.hooks.context_monitor.enabled,
                    "runtime": &state.config.hooks.context_monitor.runtime,
                },
                "tool_guard": {
                    "enabled": state.config.hooks.tool_guard.enabled,
                    "runtime": &state.config.hooks.tool_guard.runtime,
                },
            },
        },
        "language": state.language,
        "developer": {
            "name": state.developer.name,
            "runtime": state.developer.runtime,
        },
        "hardware": {
            "vendor": state.hardware.vendor,
            "model": state.hardware.model,
            "package": state.hardware.package,
            "board_name": state.hardware.board_name,
            "target": state.hardware.target,
            "signals": state.hardware.signals.iter().map(|signal| serde_json::json!({
                "name": signal.name,
                "pin": signal.pin,
                "direction": signal.direction,
                "default_state": signal.default_state,
                "confirmed": signal.confirmed,
                "note": signal.note,
            })).collect::<Vec<_>>(),
            "peripherals": state.hardware.peripherals.iter().map(|peripheral| serde_json::json!({
                "name": peripheral.name,
                "usage": peripheral.usage,
            })).collect::<Vec<_>>(),
            "truths": state.hardware.truths,
            "constraints": state.hardware.constraints,
            "unknowns": state.hardware.unknowns,
        },
        "requirements": {
            "goals": state.requirements.goals,
            "features": state.requirements.features,
            "constraints": state.requirements.constraints,
            "acceptance": state.requirements.acceptance,
            "failure_policy": state.requirements.failure_policy,
            "unknowns": state.requirements.unknowns,
            "sources": state.requirements.sources,
        },
        "current_task": state.current_task.as_ref().map(|task| serde_json::json!({
            "name": task.name,
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "package": task.package,
            "path": task.path,
        })),
        "current_task_source": state.current_task_source,
        "open_tasks": state.open_tasks,
        "wiki_pages": state.wiki_pages,
        "git_branch": state.git_branch,
        "git_dirty_count": state.git_dirty_count,
        "git_dirty": state.git_dirty_count > 0,
    })
    .to_string()
}

pub fn find_project_root(start: &Path) -> Option<PathBuf> {
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

pub fn read_current_task(ext: &Path) -> Option<TaskSnapshot> {
    read_current_task_ref(ext).map(|task| TaskSnapshot {
        name: task.name,
        title: task.title,
        status: task.status,
        priority: task.priority,
        package: task.package,
    })
}

pub fn read_current_task_ref(ext: &Path) -> Option<TaskRef> {
    let task_name = read_text(&ext.join(".current-task"));
    if task_name.is_empty() {
        return None;
    }

    let task_path = ext.join("tasks").join(&task_name).join("task.json");
    let task = read_task_ref(&task_name, &task_path)?;
    if is_closed_task(&task.status) {
        return None;
    }
    Some(task)
}

pub fn read_current_task_ref_for_session(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
) -> Option<TaskRef> {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    read_current_task_ref_with_source(&state_dir, ext_dir, Some((cwd, host))).0
}

pub fn read_current_task_name_for_session(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
) -> Option<String> {
    read_current_task_ref_for_session(ext_dir, cwd, host).map(|task| task.name)
}

fn read_current_task_ref_with_source(
    state_dir: &Path,
    ext_dir: &Path,
    session: Option<(&Path, &str)>,
) -> (Option<TaskRef>, String) {
    if let Some((cwd, host)) = session {
        let selection = crate::task::worktree_policy::resolve_active_task_name(ext_dir, cwd, host);
        if !selection.task.is_empty() {
            let task_path = state_dir
                .join("tasks")
                .join(&selection.task)
                .join("task.json");
            if let Some(task) = read_task_ref(&selection.task, &task_path)
                && !is_closed_task(&task.status)
            {
                return (Some(task), selection.source);
            }

            if selection.source != "global" {
                let global_task = read_current_task_ref(state_dir);
                let source = if global_task.is_some() {
                    "global".to_string()
                } else {
                    String::new()
                };
                return (global_task, source);
            }
        }
    }

    let global_task = read_current_task_ref(state_dir);
    let source = if global_task.is_some() {
        "global".to_string()
    } else {
        String::new()
    };
    (global_task, source)
}

pub fn read_task_ref(task_name: &str, task_path: &Path) -> Option<TaskRef> {
    let task_json = read_text(task_path);
    if task_json.is_empty() {
        return None;
    }
    let value = serde_json::from_str::<Value>(&task_json).ok()?;
    let status = value_string_field(&value, "status");
    Some(TaskRef {
        name: first_non_empty(&[value_string_field(&value, "name"), task_name.to_string()]),
        title: first_non_empty(&[
            value_string_field(&value, "title"),
            value_string_field(&value, "name"),
            task_name.to_string(),
        ]),
        status,
        priority: first_non_empty(&[value_string_field(&value, "priority"), "P2".to_string()]),
        package: value_string_field(&value, "package"),
        path: task_path.to_string_lossy().to_string(),
    })
}

fn value_string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}
pub fn count_open_tasks(ext: &Path) -> usize {
    task_refs(ext)
        .into_iter()
        .filter(|task| !is_closed_task(&task.status))
        .count()
}

fn count_completed_execution_tasks(ext: &Path) -> usize {
    task_refs(ext)
        .into_iter()
        .filter(|task| !is_bootstrap_task_name(&task.name))
        .filter(|task| is_completed_task(&task.status))
        .count()
}

fn count_known_execution_tasks(ext: &Path) -> usize {
    task_refs(ext)
        .into_iter()
        .filter(|task| !is_bootstrap_task_name(&task.name))
        .count()
}

fn is_bootstrap_task_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    normalized == "00-bootstrap-project" || normalized == "bootstrap-project"
}

fn task_refs(ext: &Path) -> Vec<TaskRef> {
    let tasks_dir = ext.join("tasks");
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false))
        .filter(|entry| entry.file_name().to_string_lossy() != "archive")
        .filter_map(|entry| {
            read_task_ref(
                &entry.file_name().to_string_lossy(),
                &entry.path().join("task.json"),
            )
        })
        .collect()
}

pub fn count_wiki_pages(ext: &Path) -> usize {
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

pub fn is_closed_task(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed"
            | "done"
            | "resolved"
            | "closed"
            | "rejected"
            | "archived"
            | "cancelled"
            | "canceled"
            | "deleted"
    )
}

fn is_completed_task(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "resolved" | "closed" | "done"
    )
}

pub fn git_branch(project_root: &Path) -> String {
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

pub fn git_dirty_count(project_root: &Path) -> usize {
    if !project_root.join(".git").exists() {
        return 0;
    }
    Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
        })
        .unwrap_or(0)
}

pub fn read_text(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub fn yaml_nested_string(source: &str, parent: &str, child: &str) -> String {
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

pub fn yaml_scalar_by_key(source: &str, key: &str) -> String {
    let prefix = format!("{key}:");
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .find_map(|line| line.strip_prefix(&prefix))
        .map(|value| unquote_yaml_scalar(value.trim()).to_string())
        .unwrap_or_default()
}

pub fn yaml_string_list(source: &str, key: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let Some(start) = lines
        .iter()
        .position(|line| line.trim() == format!("{key}:"))
    else {
        return Vec::new();
    };

    let mut values = Vec::new();
    for line in lines.iter().skip(start + 1) {
        if line.trim().is_empty() || line.trim().starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            break;
        }
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("- ") {
            let value = unquote_yaml_scalar(value.trim()).to_string();
            if !value.is_empty() {
                values.push(value);
            }
        }
    }
    values
}

pub fn yaml_object_list(source: &str, key: &str) -> Vec<BTreeMap<String, String>> {
    let lines: Vec<&str> = source.lines().collect();
    let Some(start) = lines
        .iter()
        .position(|line| line.trim() == format!("{key}:"))
    else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    let mut current: Option<BTreeMap<String, String>> = None;
    for line in lines.iter().skip(start + 1) {
        if line.trim().is_empty() || line.trim().starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            break;
        }
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("- ") {
            push_yaml_object_if_non_empty(&mut entries, current.take());
            let mut next = BTreeMap::new();
            if let Some((field, value)) = parse_yaml_key_value(value) {
                next.insert(field, value);
            }
            current = Some(next);
            continue;
        }
        if let Some((field, value)) = parse_yaml_key_value(trimmed)
            && let Some(current) = current.as_mut()
        {
            current.insert(field, value);
        }
    }
    push_yaml_object_if_non_empty(&mut entries, current);
    entries
}

pub fn unquote_yaml_scalar(value: &str) -> &str {
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

pub fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn value_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_yaml_key_value(value: &str) -> Option<(String, String)> {
    let (key, value) = value.split_once(':')?;
    Some((
        key.trim().to_string(),
        unquote_yaml_scalar(value.trim()).to_string(),
    ))
}

fn parse_yaml_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn push_yaml_object_if_non_empty(
    entries: &mut Vec<BTreeMap<String, String>>,
    current: Option<BTreeMap<String, String>>,
) {
    if let Some(current) = current
        && current.values().any(|value| !value.trim().is_empty())
    {
        entries.push(current);
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
        fs::create_dir_all(root.join(".emb-agent/tasks/done-task")).unwrap();
        fs::create_dir_all(root.join(".emb-agent/wiki/chips")).unwrap();
        fs::write(
            root.join(".emb-agent/hw.yaml"),
            [
                "mcu:",
                "  vendor: Espressif",
                "  model: ESP32-C3",
                "  package: QFN32",
                "board:",
                "  name: DemoBoard",
                "  target: vendor-ide-project",
                "signals:",
                "  - name: ADC_IN",
                "    pin: GPIO4",
                "    direction: input",
                "    default_state: floating",
                "    confirmed: true",
                "    note: Routed to divider",
                "peripherals:",
                "  - name: ADC1",
                "    usage: battery sense",
                "truths:",
                "  - ADC is used for battery voltage",
                "constraints:",
                "  - Preserve deep sleep current",
                "unknowns:",
                "  - Exact divider tolerance",
                "",
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/req.yaml"),
            [
                "goals:",
                "  - Stabilize wakeup path",
                "features:",
                "  - Battery telemetry",
                "constraints:",
                "  - Reuse existing board pins",
                "acceptance:",
                "  - ADC reading is stable over ten samples",
                "failure_policy:",
                "  - Fail safe on ADC timeout",
                "unknowns:",
                "  - Production temperature range",
                "sources:",
                "  - docs/prd/system.md",
                "",
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/project.json"),
            serde_json::json!({
                "project_profile": "baremetal-loop",
                "active_specs": ["project-local"],
                "packages": [
                    {
                        "name": "core",
                        "path": "firmware/core",
                        "type": "firmware",
                        "submodule": false
                    }
                ],
                "default_package": "core",
                "active_package": "core",
                "flash_flow": "repo_hex",
                "developer": {
                    "name": "Felix",
                    "runtime": "pi"
                },
                "preferences": {
                    "truth_source_mode": "hardware_first",
                    "verification_mode": "strict"
                }
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/.developer"),
            "{\"name\":\"Felix\",\"runtime\":\"pi\"}",
        )
        .unwrap();
        fs::write(root.join(".emb-agent/.language"), "zh\n").unwrap();
        fs::write(root.join(".emb-agent/.current-task"), "task-1\n").unwrap();
        fs::write(
            root.join(".emb-agent/tasks/task-1/task.json"),
            "{\"name\":\"task-1\",\"title\":\"Implement ADC\",\"status\":\"active\",\"priority\":\"P1\",\"package\":\"core\"}",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/tasks/done-task/task.json"),
            "{\"name\":\"done-task\",\"title\":\"Closed\",\"status\":\"completed\"}",
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
        assert_eq!(snapshot.language, "zh");
        assert_eq!(snapshot.open_tasks, 1);
        assert_eq!(snapshot.wiki_pages, 1);
        assert_eq!(snapshot.recommended_command, "do");
        assert_eq!(snapshot.current_task.unwrap().title, "Implement ADC");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unknown_hardware_and_requirement_unknowns_route_to_clarification() {
        let root = temp_project();
        fs::write(
            root.join(".emb-agent/hw.yaml"),
            "vendor: unknown\nmodel: unknown\npackage: unknown\nunknowns:\n  - MCU not selected\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/req.yaml"),
            "goals:\n  - Dimmable lamp\nunknowns:\n  - Touch or knob interaction\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/.current-task"),
            "确认调光台灯交互方式与硬件规格\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".emb-agent/tasks/确认调光台灯交互方式与硬件规格")).unwrap();
        fs::write(
            root.join(".emb-agent/tasks/确认调光台灯交互方式与硬件规格/task.json"),
            "{\"name\":\"确认调光台灯交互方式与硬件规格\",\"title\":\"确认调光台灯交互方式与硬件规格\",\"status\":\"in_progress\",\"priority\":\"P2\"}",
        )
        .unwrap();

        let snapshot = snapshot_from_cwd(root.to_str().unwrap());
        assert_eq!(snapshot.recommended_command, "clarify");
        assert_eq!(snapshot.workflow_state, "clarifying");
        assert!(!snapshot.has_hardware_truth);
        assert_eq!(snapshot.requirements_unknown_count, 1);
        assert!(
            snapshot
                .task_intake_summary
                .contains("do not create another task")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_typed_project_state_fixture() {
        let root = temp_project();
        let state = project_state_from_cwd(root.to_str().unwrap());
        assert!(state.initialized);
        assert_eq!(
            state.project_root,
            root.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(state.config.project_profile, "baremetal-loop");
        assert_eq!(state.config.active_specs, vec!["project-local"]);
        assert_eq!(state.config.packages[0].name, "core");
        assert_eq!(state.config.packages[0].path, "firmware/core");
        assert_eq!(state.config.default_package, "core");
        assert_eq!(state.config.active_package, "core");
        assert_eq!(state.config.flash_flow, "repo_hex");
        assert_eq!(state.config.developer.runtime, "pi");
        assert_eq!(state.config.preferences.verification_mode, "strict");
        assert_eq!(state.config.preferences.plan_mode, "auto");
        assert_eq!(state.developer.name, "Felix");
        assert_eq!(state.language, "zh");
        assert_eq!(state.hardware.vendor, "Espressif");
        assert_eq!(state.hardware.model, "ESP32-C3");
        assert_eq!(state.hardware.package, "QFN32");
        assert_eq!(state.hardware.board_name, "DemoBoard");
        assert_eq!(state.hardware.target, "vendor-ide-project");
        assert_eq!(state.hardware.signals[0].name, "ADC_IN");
        assert_eq!(state.hardware.signals[0].pin, "GPIO4");
        assert_eq!(state.hardware.signals[0].confirmed, Some(true));
        assert_eq!(state.hardware.peripherals[0].name, "ADC1");
        assert_eq!(state.requirements.goals, vec!["Stabilize wakeup path"]);
        assert_eq!(state.requirements.features, vec!["Battery telemetry"]);
        assert_eq!(
            state.requirements.acceptance[0],
            "ADC reading is stable over ten samples"
        );
        assert_eq!(
            state.requirements.failure_policy[0],
            "Fail safe on ADC timeout"
        );
        assert_eq!(state.current_task.as_ref().unwrap().name, "task-1");
        assert_eq!(state.current_task.as_ref().unwrap().package, "core");
        assert!(
            state
                .current_task
                .as_ref()
                .unwrap()
                .path
                .ends_with("task-1/task.json")
        );
        assert_eq!(state.open_tasks, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn closed_tasks_are_not_active() {
        assert!(is_closed_task("completed"));
        assert!(is_closed_task("CANCELED"));
        assert!(!is_closed_task("active"));
    }

    #[test]
    fn yaml_nested_string_reads_child_scalar() {
        let yaml = "mcu:\n  model: \"ESP32-C3\"\n  package: 'QFN32'\n";
        assert_eq!(yaml_nested_string(yaml, "mcu", "model"), "ESP32-C3");
        assert_eq!(yaml_nested_string(yaml, "mcu", "package"), "QFN32");
    }

    #[test]
    fn yaml_lists_and_object_lists_match_node_shapes() {
        let yaml = [
            "goals:",
            "  - stabilize wakeup",
            "signals:",
            "  - name: WAKE",
            "    pin: GPIO0",
            "    confirmed: false",
            "",
        ]
        .join("\n");
        assert_eq!(yaml_string_list(&yaml, "goals"), vec!["stabilize wakeup"]);
        let signals = yaml_object_list(&yaml, "signals");
        assert_eq!(signals[0].get("name").unwrap(), "WAKE");
        assert_eq!(signals[0].get("pin").unwrap(), "GPIO0");
        assert_eq!(signals[0].get("confirmed").unwrap(), "false");
    }
}
