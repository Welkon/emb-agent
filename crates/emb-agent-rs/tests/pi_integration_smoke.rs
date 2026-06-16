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
    assert!(settings.contains("npm:pi-subagents"));
    for forbidden in [
        "custom/gpt-5.5",
        "claude/claude-opus-4-8",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-flash",
    ] {
        assert!(
            !settings.contains(forbidden),
            "Pi settings must not force model alias {forbidden}"
        );
    }
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
