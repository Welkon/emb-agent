mod cli;

use std::env;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if let Err(error) = run(&args) {
        eprintln!("emb-agent-rs error: {error}");
        std::process::exit(1);
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let command = args.first().map(String::as_str).unwrap_or("help");
    if matches!(command, "help" | "--help" | "-h")
        || args
            .iter()
            .skip(1)
            .any(|arg| arg == "--help" || arg == "-h")
    {
        print_help();
        return Ok(());
    }

    match command {
        // Session
        "statusline" | "start" | "next" | "status" | "health" | "pause" | "resume" => {
            cli::session::run(args)
        }
        // Actions
        "scan" | "plan" | "do" | "review" | "verify" | "debug" => cli::session::run_actions(args),
        // Chip
        "chip" => cli::chip::run(args),
        // Ingest
        "ingest" => cli::ingest::run(args),
        // Schematic
        "schematic" => cli::schematic::run(args),
        // Docs
        "doc" => cli::doc::run(args),
        // Component
        "component" => cli::component::run(args),
        // Board
        "board" => cli::board_cli::run(args),
        // Knowledge
        "knowledge" => cli::knowledge::run(args),
        // Memory
        "memory" => cli::memory::run(args),
        // Adapter / Support
        "adapter" => cli::adapter::run(args),
        "support" => cli::adapter::run_support(args),
        // Hooks / Diagnostics
        "hook" => cli::hooks_cli::run_hook(args),
        "diagnostics" => cli::hooks_cli::run_diagnostics(args),
        // Task
        "task" => cli::task::run(args),
        // Variant
        "variant" | "workspace" => cli::variant::run(args),
        // Misc small commands
        "config" | "prd" | "session" | "context" | "bootstrap" | "declare" | "resolve" => {
            cli::misc::run(args)
        }
        // Extended operations (stubs)
        "init" | "init-project" | "migrate" | "skills" | "update" | "settings" | "decision"
        | "commands" | "note" | "capability" | "executor" | "dispatch" | "scaffold"
        | "transcript" | "prefs" | "tool" | "snippet" | "workflow" | "orchestrate" | "insight"
        | "trace" => cli::misc::run_ext_ops(args),
        other => Err(format!("unknown command: {other}")),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs\n\nUSAGE:\n  Session:    start, next, status, health, pause [note], resume\n  Tasks:      task list/show/add/activate/resolve, task worktree list/status/show/create/cleanup\n  Chips:      chip diff --from X --to Y, chip swap --from X --to Y [--confirm]\n  Variants:   variant list|status|adopt|create|use|fork|diff (workspace alias)\n  Actions:    scan, plan, do, review, verify, debug [--cwd DIR]\n  Ingest:     ingest schematic --file <path> [--format altium-raw|altium-json|bom-csv|netlist]\n              ingest board --file <path>\n  Schematic:  schematic summary|components|nets|bom|advice|preview|raw [--parsed <path>]\n  Docs:       doc lookup [--chip <name>] [--keyword <text>], doc fetch --path <path>\n  Components: component lookup [--ref <designator>] [--parsed <path>]\n  Board:      board summary|advice [--layout <path>]\n  Adapter:    adapter derive --family <slug> --device <slug>\n  Support:    support status\n  Hooks:      hook session-start|statusline|context-monitor, statusline\n  Diag:       diagnostics hooks|project|state-paths --json\n  Options:    --cwd DIR, --brief, --json\n"
    );
}
