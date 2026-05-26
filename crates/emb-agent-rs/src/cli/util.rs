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
    !matches!(name, "--json" | "--brief" | "--confirm" | "--help" | "-h")
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
    use std::io::BufRead;
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut buf = Vec::new();
    reader.read_until(b'\n', &mut buf).ok()?;
    let trimmed = String::from_utf8_lossy(&buf).trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn stdin_payload_or_cwd(args: &[String]) -> String {
    option_value(args, "--cwd")
        .unwrap_or_else(|| read_stdin_payload().unwrap_or_else(current_dir_string))
}
