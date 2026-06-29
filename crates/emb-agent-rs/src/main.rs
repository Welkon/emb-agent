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
        "statusline" | "start" | "next" | "status" | "health" | "pause" | "resume" | "session"
        | "finish" | "finish-work" => cli::session::run(args),
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
        // Firmware evidence / handoff internals
        "firmware" => cli::firmware::run(args),
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
        "config" | "prd" | "context" | "bootstrap" | "declare" | "resolve" => cli::misc::run(args),
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
        r#"emb-agent-rs

	emb-agent default user flow:
	  1. Install or repair host integration.
	  2. Restart/reload the host; in Codex run /hooks and trust project hooks.
	  3. Start or refresh context: /emb-start
	  4. Continue work: /emb-next
	  5. Close completed work: /emb-finish-work
	  6. If startup context is missing: diagnostics hooks --host <host>

	USAGE:
  Session:    onboard, start, next, status [--query "question"], health, pause [note], resume
              session show|journal|history
              session record --title "..." --summary "..." [--detail "..."] [--commit HASH] [--test CMD] [--next "..."]
              finish-work [--summary "..."] [--test CMD] [--no-resolve] [--no-archive]
  Tasks:      task list/show/add/activate/finish-work/resolve/archive/delete, task worktree list/status/show/create/cleanup
  Impl:       impl mark --decision <slug> --status <planned|implemented|verified> [--file <path>]
              impl list [--brief], impl verify --decision <slug>
  Lint:       lint (readability) — flag forwarding wrappers, deep nesting >4, misleading names
  Chips:      chip diff --from X --to Y, chip swap --from X --to Y [--confirm]
  Variants:   variant list|status|adopt|create|use|fork|diff (workspace alias)
  Actions:    scan, plan, do, review, verify, debug [--cwd DIR]
  Compound:   compound add --type learn|decide|trap|explore|trick --slug X --summary "..." [--chip X]
              compound search [--type X] [--query "..."] [--chip X], compound list
  Attention:  attention show, attention note --text "..." [--section X]
  Note:       note --text "..." [--section X]     (shortcut for attention note)
  Arch:       arch status, arch check
  Ingest:     ingest doc --file <path> [--provider auto|local|mineru] [--kind datasheet] [--to hardware]
              ingest schematic --file <path> [--file <path> ...] [--format altium-raw|altium-json|bom-csv|netlist]
              ingest board --file <path>
  Schematic:  schematic summary|components|nets|bom|advice|preview|raw [--file <path>|--parsed <path>]
  Docs:       doc lookup [--chip <name>] [--keyword <text>], doc fetch --path <path>
  Knowledge:  knowledge index/search/ask/diagnose/lint/show, knowledge graph refresh/query/path/lint
              knowledge save-query|ingest|formula draft [--confirm]
  Mem:        mem list|projects|search|context|extract|show|timeline|related|reindex|stats|open|explain|export|diff|writeback|promote
  Hooks:      hook session-start|session-end|statusline|context-monitor|tool-guard|event, statusline
  Components: component lookup [--file <path>] [--ref <designator>] [--parsed <path>]
  Board:      board summary|advice [--layout <path>]
  Adapter:    adapter derive --family <slug> --device <slug>
  Support:    support status
  Diag:       diagnostics hooks|project|state-paths --json
  Options:    --cwd DIR, --brief, --json

NOTE:
  status --query "question" — Quick state query ("is watchdog enabled?", "what's the charging logic?")
                               Returns answer from impl_status + recent compound decisions without task activation
  lint / readability         — Detect over-abstraction: forwarding wrappers, deep nesting, misleading names
"#
    );
}
