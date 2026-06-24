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
        // External protocol
        "external" => cli::session::run_external(args),
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
        "memory" | "mem" => cli::memory::run(args),
        // Adapter / Support
        "adapter" => cli::adapter::run(args),
        "support" => cli::adapter::run_support(args),
        // Hooks / Diagnostics
        "hook" => cli::hooks_cli::run_hook(args),
        "diagnostics" => cli::hooks_cli::run_diagnostics(args),
        // Task
        "task" => cli::task::run(args),
        // Implementation status
        "impl" => cli::impl_status::run(args),
        // Readability lint
        "lint" | "readability" => cli::readability::run(args),
        // Variant
        "variant" | "workspace" => cli::variant::run(args),
        // Misc small commands
        "config" | "prd" | "session" | "context" | "bootstrap" | "declare" | "resolve" => {
            cli::misc::run(args)
        }
        // Compound knowledge
        "compound" | "attention" | "note" | "arch" => cli::compound::run(args),
        // Extended operations
        "init" | "init-project" | "onboard" | "migrate" | "doctor" | "skills" | "update"
        | "settings" | "decision" | "commands" | "capability" | "executor" | "dispatch"
        | "scaffold" | "transcript" | "prefs" | "tool" | "snippet" | "workflow" | "orchestrate"
        | "insight" | "trace" | "validate" => cli::misc::run_ext_ops(args),
        other => Err(format!("unknown command: {other}")),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs\n\nemb-agent default user flow:\n  /emb onboard\n  /emb ingest\n  /emb next\n\nUSAGE:\n  Session:    onboard, start, next, status [--query \"question\"], health, pause [note], resume\n  Tasks:      task list/show/add/activate/resolve/delete, task worktree list/status/show/create/cleanup\n  Impl:       impl mark --decision <slug> --status <planned|implemented|verified> [--file <path>]\n              impl list [--brief], impl verify --decision <slug>\n  Lint:       lint (readability) — flag forwarding wrappers, deep nesting >4, misleading names\n  Chips:      chip diff --from X --to Y, chip swap --from X --to Y [--confirm]\n  Variants:   variant list|status|adopt|create|use|fork|diff (workspace alias)\n  Actions:    scan, plan, do, review, verify, debug [--cwd DIR]\n  Compound:   compound add --type learn|decide|trap|explore|trick --slug X --summary \"...\" [--chip X]\n              compound search [--type X] [--query \"...\"] [--chip X], compound list\n  Attention:  attention show, attention note --text \"...\" [--section X]\n  Note:       note --text \"...\" [--section X]     (shortcut for attention note)\n  Arch:       arch status, arch check\n  Ingest:     ingest doc --file <path> [--provider auto|local|mineru] [--kind datasheet] [--to hardware]\n              ingest schematic --file <path> [--file <path> ...] [--format altium-raw|altium-json|bom-csv|netlist]\n              ingest board --file <path>\n  Schematic:  schematic summary|components|nets|bom|advice|preview|raw [--file <path>|--parsed <path>]\n  Docs:       doc lookup [--chip <name>] [--keyword <text>], doc fetch --path <path>\n  Mem:        mem list|projects|search|context|extract|show|timeline|related|reindex|stats|open|explain|export|diff|writeback\n  Components: component lookup [--file <path>] [--ref <designator>] [--parsed <path>]\n  Board:      board summary|advice [--layout <path>]\n  Adapter:    adapter derive --family <slug> --device <slug>\n  Support:    support status\n  Hooks:      hook session-start|statusline|context-monitor, statusline\n  Diag:       diagnostics hooks|project|state-paths --json\n  Options:    --cwd DIR, --brief, --json\n\nNOTE:\n  status --query \"question\" — Quick state query (\"is watchdog enabled?\", \"what's the charging logic?\")\n                               Returns answer from impl_status + recent compound decisions without task activation\n  lint / readability         — Detect over-abstraction: forwarding wrappers, deep nesting, misleading names\n"
    );
}
