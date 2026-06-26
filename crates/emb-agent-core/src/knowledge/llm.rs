//! Shared OpenAI-compatible LLM client for knowledge features (extraction,
//! fusion answer). Reads the same env/.env keys as the pageindex provider and
//! the embedding/rerank integrations, so a single LLM key serves all of them.
//!
//! Provider env (per-call override > env > project.json > defaults):
//! - `EMB_AGENT_LLM_MODEL`     — model id (falls back to `EMB_AGENT_PAGEINDEX_MODEL`)
//! - `EMB_AGENT_LLM_API_BASE`  — OpenAI-compatible base (defaults to OpenAI endpoint)
//! - `EMB_AGENT_LLM_API_KEY`   — bearer key (falls back to
//!   `EMB_AGENT_PAGEINDEX_API_KEY` / `OPENAI_API_KEY` / `CHATGPT_API_KEY`)

use serde_json::{Value, json};
use std::env;
use std::fs;
use std::path::Path;
use std::time::Duration;

const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
const MAX_RETRIES: usize = 4;

pub struct LlmConfig {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

impl LlmConfig {
    pub fn available(&self) -> bool {
        !self.model.is_empty() && !self.api_key.is_empty()
    }
}

/// Resolve LLM config for knowledge features.
pub fn resolve_llm_config(project_root: &Path) -> LlmConfig {
    let api_base = env_first(
        project_root,
        &["EMB_AGENT_LLM_API_BASE", "EMB_AGENT_PAGEINDEX_API_BASE"],
    )
    .unwrap_or_else(|| DEFAULT_API_BASE.to_string());
    let api_key = env_first(
        project_root,
        &[
            "EMB_AGENT_LLM_API_KEY",
            "EMB_AGENT_PAGEINDEX_API_KEY",
            "OPENAI_API_KEY",
            "CHATGPT_API_KEY",
        ],
    )
    .unwrap_or_default();
    let model = env_first(
        project_root,
        &["EMB_AGENT_LLM_MODEL", "EMB_AGENT_PAGEINDEX_MODEL"],
    )
    .unwrap_or_default();
    LlmConfig {
        api_base,
        api_key,
        model,
    }
}

fn env_first(project_root: &Path, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(v) = env::var(key) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    for path in [
        project_root.join(".env"),
        project_root.join(".emb-agent").join(".env"),
    ] {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            let line = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
            let Some((name, value)) = line.split_once('=') else {
                continue;
            };
            let name = name.trim();
            if keys.contains(&name) {
                let value = value.trim().trim_matches(['"', '\'']).to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

/// Single-turn completion with retry. Returns the assistant message content.
pub fn complete(cfg: &LlmConfig, prompt: &str) -> Result<String, String> {
    if !cfg.available() {
        return Err("LLM not configured: set EMB_AGENT_LLM_MODEL + EMB_AGENT_LLM_API_KEY (or OPENAI_API_KEY)".to_string());
    }
    let body = json!({
        "model": cfg.model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    });
    let url = format!("{}/chat/completions", cfg.api_base.trim_end_matches('/'));
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        let resp = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", cfg.api_key))
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(120))
            .send_json(body.clone());
        let resp = match resp {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default();
                last_err = format!(
                    "HTTP {code}: {}",
                    body.chars().take(300).collect::<String>()
                );
                if code == 401 || code == 403 {
                    return Err(format!("LLM auth failed ({code}): {last_err}"));
                }
                std::thread::sleep(Duration::from_millis(600 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => {
                last_err = e.to_string();
                std::thread::sleep(Duration::from_millis(600 * (attempt as u64 + 1)));
                continue;
            }
        };
        let parsed: Value = resp
            .into_json()
            .map_err(|e| format!("LLM response not JSON: {e}"))?;
        let content = parsed
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return Ok(content);
    }
    Err(format!(
        "LLM call failed after {MAX_RETRIES} retries: {last_err}"
    ))
}

/// Tolerant JSON extraction from an LLM response (fences, Python None,
/// trailing commas). Mirrors the pageindex_native extractor.
pub fn extract_json(content: &str) -> Value {
    let mut s = content;
    if let Some(start) = s.find("```json") {
        s = &s[start + 7..];
        if let Some(end) = s.rfind("```") {
            s = &s[..end];
        }
    } else if let Some(start) = s.find("```") {
        s = &s[start + 3..];
        if let Some(end) = s.rfind("```") {
            s = &s[..end];
        }
    }
    let s = s.replace("None", "null");
    match serde_json::from_str::<Value>(&s) {
        Ok(v) => v,
        Err(_) => {
            let cleaned = s.replace(",]", "]").replace(",}", "}");
            serde_json::from_str::<Value>(&cleaned).unwrap_or(Value::Null)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_handles_fences() {
        let v = extract_json("```json\n{\"a\": None, \"b\": 1}\n```");
        assert_eq!(v["a"], Value::Null);
        assert_eq!(v["b"], json!(1));
    }
}
