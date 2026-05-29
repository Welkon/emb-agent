use std::collections::BTreeMap;
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
    pub open_tasks: usize,
    pub wiki_pages: usize,
    pub current_task: Option<TaskSnapshot>,
    pub recommended_command: String,
    pub recommended_reason: String,
    pub bootstrap_status: String,
    pub workflow_state: String,
    pub has_hardware_truth: bool,
    pub task_intake_summary: String,
    pub requirements_unknown_count: usize,
    pub hardware_unknown_count: usize,
    pub truth_validation_errors: Vec<String>,
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
    pub open_tasks: usize,
    pub wiki_pages: usize,
    pub git_branch: String,
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
    pub hooks: HookConfig,
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
        Self {
            session_start,
            statusline,
            context_monitor,
        }
    }

    pub fn hook_entry(&self, hook: &str) -> &HookEntry {
        match hook {
            "session-start" | "session_start" => &self.session_start,
            "statusline" => &self.statusline,
            "context-monitor" | "context_monitor" => &self.context_monitor,
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
        &[],
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

pub fn snapshot_from_cwd(cwd: &str) -> ProjectSnapshot {
    let state = project_state_from_cwd(cwd);
    if !state.initialized && state.project_root.is_empty() {
        return ProjectSnapshot {
            initialized: false,
            recommended_command: "onboard".to_string(),
            recommended_reason: "Project not yet initialized. Run emb-onboard to scaffold .emb-agent/ or migrate existing hardware documents.".to_string(),
            ..ProjectSnapshot::default()
        };
    }

    let has_hardware = is_declared_hardware_model(&state.hardware.model);
    let active_is_clarification = state
        .current_task
        .as_ref()
        .map(is_clarification_task)
        .unwrap_or(false);
    let has_truth_errors = !state.truth_validation_errors.is_empty();
    let needs_clarification = has_truth_errors
        || !state.requirements.unknowns.is_empty()
        || (!has_hardware && !state.hardware.unknowns.is_empty())
        || active_is_clarification;
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
    let task_intake_summary = if has_truth_errors {
        format!(
            "Project truth validation failed: {}. Repair .emb-agent/hw.yaml and .emb-agent/req.yaml first; run `emb-agent doctor --host all --brief` or `emb-agent health` after editing. Do not proceed to implementation while truth files are invalid.",
            state.truth_validation_errors.join("; ")
        )
    } else if active_is_clarification {
        "Continue the active clarification/brainstorming task as a doc-grounded grilling loop. Ask one load-bearing question at a time, challenge ambiguous terms against project truth, extract exact timing/percentage/slope values from any waveform or measurement captures before implementing, update docs/prd/system.md and .emb-agent/req.yaml after confirmation, run emb-agent health after truth edits, and do not create another task or start implementation until the state-machine checklist and concrete scope are explicit.".to_string()
    } else if state.current_task.is_some() {
        String::new()
    } else if needs_clarification || !has_hardware {
        "Continue requirement exploration/brainstorming as a doc-grounded grilling loop. Clarify behavior, interaction, power, LED, mechanical, hardware constraints, and the state-machine checklist; update docs/prd/system.md and .emb-agent/req.yaml; run emb-agent health after truth edits. Do not create an implementation task until the user confirms a concrete deliverable or bug.".to_string()
    } else {
        "Ask what work the user wants to start. Classify it as bug, feature, board-bringup, power, timing, or toolchain; draft a durable agent brief and split large work into vertical tracer-bullet slices before activation.".to_string()
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
            "Active work is requirement/hardware clarification. Continue the doc-grounded grilling loop and record confirmed decisions before creating implementation tasks.".to_string(),
        )
    } else if state.current_task.is_some() {
        ("do".to_string(), "Active task is selected".to_string())
    } else if needs_clarification || !has_hardware {
        (
            "clarify".to_string(),
            "Project is still in concept/requirements exploration. Clarify the listed blockers, state-machine behavior, and acceptance evidence before task creation or implementation.".to_string(),
        )
    } else {
        (
            "next".to_string(),
            "Project has hardware context; continue workflow routing".to_string(),
        )
    };

    let hardware_unknown_count = if has_hardware {
        0
    } else {
        state.hardware.unknowns.len()
    };

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
        open_tasks: state.open_tasks,
        wiki_pages: state.wiki_pages,
        current_task: state.current_task.map(|task| TaskSnapshot {
            name: task.name,
            title: task.title,
            status: task.status,
            priority: task.priority,
            package: task.package,
        }),
        recommended_command,
        recommended_reason,
        bootstrap_status: bootstrap_status.to_string(),
        workflow_state: workflow_state.to_string(),
        has_hardware_truth: has_hardware,
        task_intake_summary,
        requirements_unknown_count: state.requirements.unknowns.len(),
        hardware_unknown_count,
        truth_validation_errors: state.truth_validation_errors,
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
    read_project_state(&root)
}

pub fn read_project_state(project_root: &Path) -> ProjectState {
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
    let language = read_text(&ext.join(".language"));
    let current_task = read_current_task_ref(&state_dir);
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
        open_tasks: count_open_tasks(&state_dir),
        wiki_pages: count_wiki_pages(&state_dir),
        git_branch: git_branch(&root),
        current_task,
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
        "open_tasks": state.open_tasks,
        "wiki_pages": state.wiki_pages,
        "git_branch": state.git_branch,
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
    let tasks_dir = ext.join("tasks");
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false))
        .filter(|entry| entry.file_name().to_string_lossy() != "archive")
        .filter(|entry| {
            read_task_ref(
                &entry.file_name().to_string_lossy(),
                &entry.path().join("task.json"),
            )
            .map(|task| !is_closed_task(&task.status))
            .unwrap_or(false)
        })
        .count()
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
            | "resolved"
            | "closed"
            | "rejected"
            | "archived"
            | "cancelled"
            | "canceled"
            | "deleted"
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
