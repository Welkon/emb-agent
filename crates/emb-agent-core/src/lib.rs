pub mod context_monitor;
pub mod hooks;
pub mod json;
pub mod project;
pub mod render;

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
pub use project::{ProjectSnapshot, TaskSnapshot, find_project_root, snapshot_from_cwd};
pub use render::{
    build_host_session_start_payload, build_session_context, build_start_json, build_statusline,
};
