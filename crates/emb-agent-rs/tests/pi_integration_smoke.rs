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
        "triggerTurn: true",
        "INGEST_TIMEOUT_MS",
        "INGEST_MAX_BUFFER",
        "EMB-AGENT PROJECT STATE START",
        "subagents:rpc:${name}",
        "\"ping\" | \"spawn\"",
        "spawnAutoSubagent",
        "npm:@tintinweb/pi-subagents",
        "LEGACY_SUBAGENTS_PACKAGE",
        "autoDispatchSubagents",
        "DEFAULT_AUTO_AGENT_MODEL_ROUTES",
        "subagentModelRoutes",
        "yamlScalar",
        "description: ${yamlScalar(desc)}",
        "inherit-model fallback",
        "PARENT_TOOL_BLOCK_AFTER_DISPATCH_MS",
        "EMB_AUTO_DISPATCH_MARKER",
        "pi.on(\"input\"",
        "action: \"transform\"",
        "spawn reply timed out; not retrying",
        "Parent agent must not continue inline file/code exploration now",
        "tool_call",
    ] {
        assert!(ext.contains(expected), "Pi extension missing {expected}");
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
    assert!(packages.iter().any(|p| p == "npm:@tintinweb/pi-subagents"));
    assert!(!packages.iter().any(|p| p == "npm:pi-subagents"));
    assert!(value["embAgent"]["subagentModelRoutes"].is_object());
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["sys-reviewer"]["model"],
        "deepseek/deepseek-v4-pro"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["hw-scout"]["model"],
        "deepseek/deepseek-v4-flash"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["fw-doer"]["model"],
        "custom/gpt-5.5"
    );
    assert!(
        !settings.contains("claude/claude-opus-4-8"),
        "Pi settings must not force unavailable stale Claude aliases"
    );
    assert!(
        value.get("subagents").is_none(),
        "Tintinweb routing should use embAgent.subagentModelRoutes, not legacy subagents.agentOverrides"
    );
}

#[test]
fn pi_docs_match_extension_surface() {
    let docs = read_repo("docs/pi-integration.md");
    assert!(docs.contains(".pi/extensions/emb-agent.ts"));
    assert!(docs.contains("/emb-ingest"));
    assert!(docs.contains("ingest_doc"));
    assert!(docs.contains("ask_user_question"));
    assert!(
        !docs.contains("不需要扩展"),
        "Pi docs must not claim no extension is needed"
    );
}
