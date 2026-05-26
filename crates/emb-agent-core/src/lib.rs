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

pub mod session;
pub mod task;
pub mod schematic;
pub mod hardware;
pub mod knowledge;
pub mod lookup;

pub mod actions;
pub mod hooks;
pub mod json;
pub mod ext_ops;
pub mod meta_ops;
pub mod prd_ops;
pub mod variant_ops;

// Re-exports for backward compatibility
pub use actions::*;
pub use hooks::*;
pub use json::*;
pub use ext_ops::*;
pub use meta_ops::*;
pub use prd_ops::*;
pub use variant_ops::*;
pub use session::*;
pub use task::*;
pub use schematic::*;
pub use hardware::*;
pub use knowledge::*;
pub use lookup::*;
