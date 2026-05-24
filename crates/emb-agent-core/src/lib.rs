pub mod actions;
pub mod chip_diff;
pub mod context_monitor;
pub mod hooks;
pub mod json;
pub mod prd_ops;
pub mod project;
pub mod render;
pub mod scan;
pub mod state_paths;
pub mod task_ops;

pub use actions::{
    DebugOutput, PlanOutput, ReviewOutput, VerifyOutput, WorkflowStage,
    build_debug_output, build_debug_output_json, build_plan_output, build_plan_output_json,
    build_review_output, build_review_output_json, build_verify_output,
    build_verify_output_json,
};

pub use chip_diff::{
    ChipDiffReport, ChipPin, ChipProfile, ChipSwapPlan, MigratedSignal, PinDiff,
    PinCompatibility, SignalMigrationStatus, build_chip_diff_json,
    build_chip_swap_confirm_json, build_chip_swap_json, diff_chips,
};
pub use context_monitor::{
    ContextMetrics, build_context_monitor_output, build_context_monitor_output_from_value,
    build_fresh_context_instruction, build_metrics_message, build_session_message,
    parse_context_metrics, should_emit,
};
pub use hooks::{
    HookPlan, build_hook_plan, build_hook_plan_json, build_hooks_diagnostics_json,
    build_node_hook_command, build_rust_hook_command, env_flag, hook_file_name,
    is_rust_hook_supported, is_source_runtime_layout, normalize_hook_name, rust_binary_path,
    shell_quote,
};
pub use json::{json_quote, json_string_field};
pub use project::{
    DeveloperInfo, HardwarePeripheral, HardwareSignal, HardwareTruth, HookConfig, HookEntry,
    ProjectConfig,
    ProjectPackage, ProjectPreferences, ProjectSnapshot, ProjectState, RequirementsTruth, TaskRef,
    TaskSnapshot, build_project_state_json, find_project_root, project_state_from_cwd,
    read_all_tasks, read_project_state, read_task, snapshot_from_cwd,
};
pub use render::{
    build_health_json, build_host_session_start_payload, build_next_json,
    build_session_context, build_start_json, build_status_json, build_statusline,
    build_task_list_json, build_task_show_json,
};
pub use scan::{ScanOutput, ScanWorkflowStage, build_scan_output, build_scan_output_json};
pub use state_paths::{
    ProjectStateFilePaths, ProjectStatePaths, StatePathConfig, build_project_state_file_paths,
    build_project_state_paths_json, canonicalize_project_root, get_fallback_project_state_dir,
    get_project_asset_relative_path, get_project_key, get_project_key_from_canonical_root,
    get_project_state_paths, normalize_case_insensitive_project_root, normalize_path,
    normalize_project_relative_path, resolve_project_data_path, sha1_hex12,
};
