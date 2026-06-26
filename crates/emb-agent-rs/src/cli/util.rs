use std::env;
use std::path::PathBuf;

pub fn current_dir_string() -> String {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

pub fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

pub fn option_values(args: &[String], name: &str) -> Vec<String> {
    args.windows(2)
        .filter(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
        .collect()
}

pub fn positional_after(args: &[String], start: usize) -> Option<String> {
    let mut i = start;
    while i < args.len() {
        let token = &args[i];
        if token.starts_with("--") {
            i += if option_takes_value(token) { 2 } else { 1 };
        } else {
            return Some(token.clone());
        }
    }
    None
}

fn option_takes_value(name: &str) -> bool {
    !matches!(
        name,
        "--json"
            | "--brief"
            | "--confirm"
            | "--force"
            | "--apply"
            | "--answer"
            | "--rerank"
            | "--refresh"
            | "--rebuild"
            | "--enrich"
            | "--with-llm"
            | "--quick"
            | "--ocr"
            | "--is-ocr"
            | "--no-table"
            | "--no-formula"
            | "--help"
            | "-h"
    )
}

pub fn hook_cwd(args: &[String]) -> String {
    option_value(args, "--cwd")
        .or_else(|| stdin_json_string_field("cwd"))
        .unwrap_or_else(current_dir_string)
}

pub fn stdin_json_string_field(key: &str) -> Option<String> {
    let raw = read_stdin_payload()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed.get(key)?.as_str().map(String::from)
}

fn read_stdin_payload() -> Option<String> {
    use std::io::{IsTerminal, Read};

    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        return None;
    }

    let mut raw = String::new();
    stdin.lock().read_to_string(&mut raw).ok()?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn stdin_payload_or_cwd(args: &[String]) -> String {
    read_stdin_payload()
        .or_else(|| {
            option_value(args, "--cwd").map(|cwd| {
                format!(
                    "{{\"cwd\":{}}}",
                    serde_json::to_string(&cwd).unwrap_or_else(|_| "\".\"".to_string())
                )
            })
        })
        .unwrap_or_else(current_dir_string)
}
