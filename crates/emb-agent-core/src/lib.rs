// emb-agent-core: Embedded workflow system for AI coding agents
//
// Module structure:
//   session/    - start, next, status, health, render, context_monitor
//   task/       - task_ops, bug_ops, scan
//   schematic/  - query, advisor, ingest, schdoc
//   hardware/   - chip, board, project, state_paths
//   knowledge/  - graph (knowledge graph, wiki, memory)
//   lookup/     - doc lookup, component lookup, fetch, board query
//   (root)      - actions, hooks, json, ext_ops, meta_ops, prd_ops, variant_ops

pub mod compound;
pub mod hardware;
pub mod knowledge;
pub mod lookup;
pub mod schematic;
pub mod session;
pub mod state_query;
pub mod task;

pub mod actions;
pub mod ext_ops;
pub mod hooks;
pub mod json;
pub mod meta_ops;
pub mod prd_ops;
pub mod variant_ops;
pub use compound::*;

// Re-exports for backward compatibility
pub use actions::*;
pub use ext_ops::{
    capability_run, commands_list, decision_status, dispatch_orchestrate, executor_run, ingest_doc,
    init_project, insight_show, install_doctor, migrate_status, note_add, note_show,
    onboard_status, orchestrate_status, prefs_show, scaffold_generate, settings_set, settings_show,
    skills_status, snippet_draft, support_status, tool_run, trace_show, update_check,
    workflow_status,
};
pub use hardware::*;
pub use hooks::*;
pub use json::*;
pub use knowledge::*;
pub use lookup::*;
pub use meta_ops::*;
pub use prd_ops::*;
pub use schematic::*;
pub use session::*;
pub use state_query::*;
pub use task::*;
pub use variant_ops::*;
