use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn read_repo(path: impl AsRef<Path>) -> String {
    fs::read_to_string(repo_root().join(path)).expect("read repo file")
}

#[test]
fn pi_extension_exposes_unified_tool_layer() {
    let ext = read_repo("runtime/scaffolds/shells/.pi/extensions/emb-agent.ts");
    for expected in [
        "pi.registerCommand(\"emb-next\"",
        "pi.registerCommand(\"emb-onboard\"",
        "pi.registerCommand(\"emb-ingest\"",
        "name: \"emb_next\"",
        "name: \"emb_onboard\"",
        "name: \"ingest_doc\"",
        "name: \"doc_lookup\"",
        "name: \"doc_fetch\"",
        "name: \"ask_user_question\"",
        "name: \"emb_subagent\"",
        "name: \"emb_session_search\"",
        "name: \"emb_session_extract\"",
        "name: \"knowledge_search\"",
        "name: \"knowledge_diagnose\"",
        "name: \"knowledge_graph_query\"",
        "triggerTurn: true",
        "INGEST_TIMEOUT_MS",
        "INGEST_MAX_BUFFER",
        "ingest\", \"schematic",
        "kind=schematic",
        "do not send schematic files to MinerU",
        "EMB-AGENT PROJECT STATE START",
        "EMB_AGENT_SUBAGENT_CHILD",
        "runEmbSubagentBatch",
        "runPiSubagent",
        "--mode",
        "json",
        "-p",
        "--no-session",
        "DEFAULT_AUTO_AGENT_MODEL_ROUTES",
        "SUPPORTED_AGENT_NAMES",
        "PARENT_TOOL_BLOCK_AFTER_DISPATCH_MS",
        "RAW_SUBAGENT_OUTPUT_GUARD_MS",
        "EMB_AUTO_DISPATCH_MARKER",
        "EMB_HIDDEN_RESULTS_MARKER",
        "pi.on(\"input\"",
        "pendingNativeDispatch",
        "emb-agent:hidden-subagent-results",
        "return { action: \"continue\" }",
        "The following native emb-agent subagent results are hidden",
        "SubagentDispatchPlan",
        "buildDispatchPlan",
        "selectTargetTask",
        "rolePrompt",
        "MUST create or edit",
        "Manual roles preserved with target-task scoped prompts",
        "Dispatch phase:",
        "release-checker",
        "fw-doer",
        "subagentModelRoutes",
        "native-pi",
        "PARENT_MUTATION_TOOLS",
        "stripBenignShellRedirections",
        "formatUsage",
        "aggregateUsage",
        "usageMessageIds",
        "SUBAGENT_MODEL_RETRIES",
        "TUI_HEARTBEAT_MS",
        "SPINNER_FRAMES",
        "shouldRetrySubagentFailure",
        "buildPiSubagentArgs",
        "routeHistory",
        "total ${usageSummary}",
        "tok ${formatTokenCount(total)}",
        "\\/dev\\/null",
        "The parent AI must decide from the user's request",
        "knowledge_search, knowledge_diagnose, and knowledge_graph_query",
        "Use knowledge_search for project knowledge",
        "subagentDispatchEnabled",
        "isWorkSelection",
        "phase: \"waiting\"",
        "phase === \"results-injected\"",
        "Search local Pi/Codex session transcripts",
        "readSessionDialogue",
        "searchSessions",
        "tool_call",
    ] {
        assert!(ext.contains(expected), "Pi extension missing {expected}");
    }
    for forbidden in [
        "npm:@tintinweb/pi-subagents",
        "subagents:rpc",
        "patchTintinwebSubagentNotifications",
        "visibleAgentDispatchInstructions",
        "pendingVisibleDispatch",
        "get_subagent_result",
        "first call the visible Tintinweb Agent tool",
    ] {
        assert!(
            !ext.contains(forbidden),
            "Pi extension still contains legacy {forbidden}"
        );
    }
    assert!(
        ext.contains("\".pi\", \"emb-agent\"")
            && ext.contains("PI_CODING_AGENT_DIR")
            && ext.contains("EXTENSION_DIR"),
        "Pi runtime resolver must support local/global paths"
    );
}

#[test]
fn pi_settings_are_safe_by_default() {
    let settings = read_repo("runtime/scaffolds/shells/.pi/settings.json");
    let value: serde_json::Value = serde_json::from_str(&settings).expect("settings json");
    let packages = value["packages"].as_array().expect("packages array");
    assert!(
        packages.is_empty(),
        "native emb-agent dispatch must not require subagent packages"
    );
    assert!(value["embAgent"]["subagents"].is_object());
    assert_eq!(value["embAgent"]["subagents"]["runner"], "native-pi");
    assert_eq!(value["embAgent"]["subagents"]["dispatchMode"], "auto");
    assert!(value["embAgent"]["subagentModelRoutes"].is_object());
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["sys-reviewer"]["model"],
        "inherit"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["hw-scout"]["model"],
        "inherit"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["fw-doer"]["model"],
        "inherit"
    );
    assert!(
        !settings.contains("claude/claude-opus-4-8"),
        "Pi settings must not force unavailable stale Claude aliases"
    );
    assert!(
        value.get("subagents").is_none(),
        "native routing should use embAgent.subagents and embAgent.subagentModelRoutes"
    );
}

#[test]
fn pi_docs_match_extension_surface() {
    let docs = read_repo("docs/pi-integration.md");
    assert!(docs.contains(".pi/extensions/emb-agent.ts"));
    assert!(docs.contains("/emb-ingest"));
    assert!(docs.contains("ingest_doc"));
    assert!(docs.contains("ask_user_question"));
    assert!(docs.contains("emb_subagent"));
    assert!(docs.contains("emb_session_search"));
    assert!(docs.contains("emb_session_extract"));
    assert!(docs.contains("knowledge_search"));
    assert!(docs.contains("knowledge_diagnose"));
    assert!(docs.contains("knowledge_graph_query"));
    assert!(docs.contains("native-pi"));
    assert!(
        !docs.contains("不需要扩展"),
        "Pi docs must not claim no extension is needed"
    );
    assert!(
        !docs.contains("npm:@tintinweb/pi-subagents"),
        "Pi docs must not require Tintinweb for automatic dispatch"
    );
}
