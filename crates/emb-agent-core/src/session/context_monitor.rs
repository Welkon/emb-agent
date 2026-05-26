use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::json::json_quote;

const WARNING_REMAINING_PERCENT: f64 = 35.0;
const CRITICAL_REMAINING_PERCENT: f64 = 25.0;
const DEBOUNCE_CALLS: u64 = 5;
const METRICS_STALE_MS: u128 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContextMetrics {
    pub remaining: f64,
    pub used: f64,
}

pub fn build_context_monitor_output(raw_input: &str) -> String {
    let data: Value = serde_json::from_str(raw_input.trim()).unwrap_or_else(|_| json!({}));
    build_context_monitor_output_from_value(&data)
}

pub fn build_context_monitor_output_from_value(data: &Value) -> String {
    if !is_workspace_trusted(data) {
        return String::new();
    }

    let project_root = project_root_from_payload(data);
    let live_metrics = parse_context_metrics(data);

    // Persist live metrics to bridge so subsequent calls without
    // context-window data can still warn about low remaining %.
    let bridge_metrics = if let Some(metrics) = live_metrics {
        write_bridge(&project_root, metrics);
        Some(metrics)
    } else {
        read_bridge(&project_root)
    };

    let context_hygiene = data
        .get("context_hygiene")
        .or_else(|| data.get("contextHygiene"));
    let metrics_message = bridge_metrics
        .as_ref()
        .map(|metrics| build_metrics_message(metrics, context_hygiene))
        .unwrap_or_default();
    let session_message = build_session_message(context_hygiene);

    let message = if !metrics_message.is_empty() {
        metrics_message.as_str()
    } else if !session_message.is_empty() {
        session_message.as_str()
    } else {
        ""
    };

    if message.is_empty() {
        return String::new();
    }

    let mut level = context_hygiene
        .and_then(|value| string_member(value, "level"))
        .unwrap_or_else(|| "stable".to_string());
    if let Some(metrics) = bridge_metrics {
        if metrics.remaining <= CRITICAL_REMAINING_PERCENT {
            level = "critical".to_string();
        } else if metrics.remaining <= WARNING_REMAINING_PERCENT {
            level = "warning".to_string();
        }
    }

    let signature =
        build_emit_signature(&level, &metrics_message, &session_message, context_hygiene);
    if !should_emit(&project_root, &level, &signature) {
        return String::new();
    }

    let event_name = string_member(data, "hook_event_name")
        .or_else(|| string_member(data, "event"))
        .unwrap_or_else(|| "PostToolUse".to_string());

    format!(
        "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
        json_quote(&event_name),
        json_quote(message)
    )
}

pub fn parse_context_metrics(data: &Value) -> Option<ContextMetrics> {
    let remaining = number_at(data, &["context_window", "remaining_percentage"])
        .or_else(|| number_at(data, &["contextWindow", "remainingPercentage"]))
        .or_else(|| number_at(data, &["remaining_percentage"]))
        .or_else(|| number_at(data, &["remainingPercentage"]))
        .unwrap_or(0.0);

    if remaining.is_finite() && remaining > 0.0 {
        let used = (100.0 - remaining).round().clamp(0.0, 100.0);
        return Some(ContextMetrics { remaining, used });
    }

    let total_tokens = number_at(data, &["info", "total_token_usage", "total_tokens"])
        .or_else(|| number_at(data, &["info", "totalTokenUsage", "totalTokens"]))
        .or_else(|| number_at(data, &["total_token_usage", "total_tokens"]))
        .or_else(|| number_at(data, &["totalTokenUsage", "totalTokens"]))
        .unwrap_or(0.0);
    let context_window = number_at(data, &["model_context_window"])
        .or_else(|| number_at(data, &["modelContextWindow"]))
        .or_else(|| number_at(data, &["context_window", "max_tokens"]))
        .or_else(|| number_at(data, &["contextWindow", "maxTokens"]))
        .unwrap_or(0.0);

    if !total_tokens.is_finite()
        || !context_window.is_finite()
        || total_tokens <= 0.0
        || context_window <= 0.0
    {
        return None;
    }

    let used = ((total_tokens / context_window) * 100.0)
        .round()
        .clamp(0.0, 100.0);
    Some(ContextMetrics {
        remaining: (100.0 - used).max(0.0),
        used,
    })
}

pub fn build_metrics_message(metrics: &ContextMetrics, context_hygiene: Option<&Value>) -> String {
    if !metrics.remaining.is_finite() || metrics.remaining > WARNING_REMAINING_PERCENT {
        return String::new();
    }

    let is_critical = metrics.remaining <= CRITICAL_REMAINING_PERCENT;
    let prefix = if is_critical {
        "EMB CONTEXT CRITICAL:"
    } else {
        "EMB CONTEXT WARNING:"
    };
    let pause_cli = context_hygiene
        .and_then(|value| string_member(value, "pause_cli"))
        .or_else(|| context_hygiene.and_then(|value| string_member(value, "pauseCli")))
        .unwrap_or_else(|| "/emb:pause".to_string());
    let fresh_context_instruction = build_fresh_context_instruction(context_hygiene);
    let reasons = reason_suffix(context_hygiene, " Signals");
    let session_report_cli = context_hygiene
        .and_then(|value| string_member(value, "session_report_cli"))
        .or_else(|| context_hygiene.and_then(|value| string_member(value, "sessionReportCli")))
        .unwrap_or_else(|| "/emb:session".to_string());

    if is_critical {
        return format!(
            "{prefix} Context window remaining={}%. Stop expanding scope. Trigger {pause_cli} then {session_report_cli} to save checkpoint. Next step: {fresh_context_instruction}.{reasons}",
            metrics.remaining.round() as i64
        );
    }

    format!(
        "{prefix} Context window remaining={}%. Prepare to close scope before deeper exploration. Consider {session_report_cli} to save checkpoint. If the task continues in a fresh context: {fresh_context_instruction}.{reasons}",
        metrics.remaining.round() as i64
    )
}

pub fn build_session_message(context_hygiene: Option<&Value>) -> String {
    let Some(context_hygiene) = context_hygiene else {
        return String::new();
    };
    let level = string_member(context_hygiene, "level").unwrap_or_default();
    if level.is_empty() || level == "stable" || level == "consider-clearing" {
        return String::new();
    }

    let recommendation = string_member(context_hygiene, "recommendation").unwrap_or_default();
    if recommendation.trim().is_empty() {
        return String::new();
    }

    let prefix = if level == "suggest-clearing" {
        "EMB CONTEXT WARNING:"
    } else {
        "EMB CONTEXT NOTICE:"
    };
    let reasons = reason_suffix(Some(context_hygiene), " Reasons");

    format!(
        "{prefix} {recommendation}{reasons} Next step: {}.",
        build_fresh_context_instruction(Some(context_hygiene))
    )
}

pub fn build_fresh_context_instruction(context_hygiene: Option<&Value>) -> String {
    let pause_cli = context_hygiene
        .and_then(|value| string_member(value, "pause_cli"))
        .or_else(|| context_hygiene.and_then(|value| string_member(value, "pauseCli")))
        .unwrap_or_else(|| "/emb:pause".to_string());
    let resume_cli = context_hygiene
        .and_then(|value| string_member(value, "resume_cli"))
        .or_else(|| context_hygiene.and_then(|value| string_member(value, "resumeCli")))
        .unwrap_or_else(|| "/emb:resume".to_string());

    if context_hygiene
        .and_then(|value| bool_member(value, "handoff_ready"))
        .or_else(|| context_hygiene.and_then(|value| bool_member(value, "handoffReady")))
        .unwrap_or(false)
    {
        return format!("Use the host clear/new-context control, then trigger {resume_cli}");
    }

    format!(
        "Trigger {pause_cli}, then use the host clear/new-context control and trigger {resume_cli}"
    )
}

pub fn should_emit(project_root: &str, level: &str, signature: &str) -> bool {
    let warn_path = warn_state_path(project_root);
    let mut state = read_warn_state(&warn_path);
    let first_warn = !warn_path.exists();
    state.calls_since_warn = state.calls_since_warn.saturating_add(1);
    let severity_escalated = severity_rank(level) > severity_rank(&state.last_level);

    if !signature.is_empty() {
        let same_signature = state.last_signature == signature;
        if !first_warn && same_signature && !severity_escalated {
            write_warn_state(&warn_path, &state);
            return false;
        }

        state.calls_since_warn = 0;
        state.last_level = level.to_string();
        state.last_signature = signature.to_string();
        write_warn_state(&warn_path, &state);
        return true;
    }

    if !first_warn && state.calls_since_warn < DEBOUNCE_CALLS && !severity_escalated {
        write_warn_state(&warn_path, &state);
        return false;
    }

    state.calls_since_warn = 0;
    state.last_level = level.to_string();
    write_warn_state(&warn_path, &state);
    true
}

fn is_workspace_trusted(data: &Value) -> bool {
    for name in [
        "EMB_AGENT_FORCE_WORKSPACE_TRUST",
        "EMB_AGENT_WORKSPACE_TRUST",
    ] {
        if let Ok(value) = env::var(name)
            && let Some(parsed) = parse_boolean_value(&Value::String(value))
        {
            return parsed;
        }
    }

    for value in [
        data.get("workspace_trusted"),
        data.get("workspaceTrusted"),
        data.get("trusted"),
        data.get("is_trusted"),
        data.get("isTrusted"),
        data.get("trust_established"),
        data.get("trustEstablished"),
        data.pointer("/workspace/trusted"),
        data.pointer("/workspace/is_trusted"),
        data.pointer("/workspace/isTrusted"),
        data.pointer("/security/workspace_trusted"),
        data.pointer("/security/trusted"),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(parsed) = parse_boolean_value(value) {
            return parsed;
        }
    }

    false
}

fn parse_boolean_value(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(value) => {
            if value.as_i64() == Some(1) {
                Some(true)
            } else if value.as_i64() == Some(0) {
                Some(false)
            } else {
                None
            }
        }
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "y" | "on" | "trusted" => Some(true),
            "0" | "false" | "no" | "n" | "off" | "untrusted" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn project_root_from_payload(data: &Value) -> String {
    let cwd = string_member(data, "cwd").unwrap_or_else(|| ".".to_string());
    let path = PathBuf::from(&cwd);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    absolute
        .canonicalize()
        .unwrap_or(absolute)
        .to_string_lossy()
        .to_string()
}

fn number_at(data: &Value, path: &[&str]) -> Option<f64> {
    let mut current = data;
    for key in path {
        current = current.get(*key)?;
    }
    match current {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse::<f64>().ok(),
        _ => None,
    }
}

fn string_member(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_member(data: &Value, key: &str) -> Option<bool> {
    data.get(key).and_then(parse_boolean_value)
}

fn string_array_member(data: &Value, key: &str) -> Vec<String> {
    data.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn reason_suffix(context_hygiene: Option<&Value>, label: &str) -> String {
    let reasons = context_hygiene
        .map(|value| string_array_member(value, "reasons"))
        .unwrap_or_default();
    if reasons.is_empty() {
        String::new()
    } else {
        format!("{label}: {}.", reasons.join("; "))
    }
}

fn build_emit_signature(
    level: &str,
    metrics_message: &str,
    session_message: &str,
    context_hygiene: Option<&Value>,
) -> String {
    let kind = if !metrics_message.is_empty() {
        "metrics"
    } else if !session_message.is_empty() {
        "session"
    } else {
        "other"
    };
    let reasons = context_hygiene
        .map(|value| string_array_member(value, "reasons").join("|"))
        .unwrap_or_default();
    let handoff = if context_hygiene
        .and_then(|value| bool_member(value, "handoff_ready"))
        .or_else(|| context_hygiene.and_then(|value| bool_member(value, "handoffReady")))
        .unwrap_or(false)
    {
        "handoff"
    } else {
        "no-handoff"
    };
    stable_hash_hex(&[kind, level, &reasons, handoff].join("\n"))
}

fn severity_rank(level: &str) -> u8 {
    match level {
        "stable" => 0,
        "consider-clearing" => 1,
        "suggest-clearing" => 2,
        "warning" => 3,
        "critical" => 4,
        _ => 0,
    }
}

#[derive(Debug, Clone)]
struct WarnState {
    calls_since_warn: u64,
    last_level: String,
    last_signature: String,
}

fn warn_state_path(project_root: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "emb-agent-rs-ctx-{}.json",
        stable_hash_hex(project_root)
    ))
}

fn read_warn_state(path: &PathBuf) -> WarnState {
    let default = WarnState {
        calls_since_warn: 0,
        last_level: "stable".to_string(),
        last_signature: String::new(),
    };
    let Ok(text) = fs::read_to_string(path) else {
        return default;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return default;
    };
    WarnState {
        calls_since_warn: value
            .get("callsSinceWarn")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        last_level: value
            .get("lastLevel")
            .and_then(Value::as_str)
            .unwrap_or("stable")
            .to_string(),
        last_signature: value
            .get("lastSignature")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

fn write_warn_state(path: &PathBuf, state: &WarnState) {
    let payload = json!({
        "callsSinceWarn": state.calls_since_warn,
        "lastLevel": state.last_level,
        "lastSignature": state.last_signature,
        "timestamp": now_ms(),
    });
    let _ = fs::write(path, payload.to_string());
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn bridge_path(project_root: &str) -> PathBuf {
    env::temp_dir().join(format!(
        "emb-agent-rs-ctx-{}.bridge.json",
        stable_hash_hex(project_root)
    ))
}

fn read_bridge(project_root: &str) -> Option<ContextMetrics> {
    let path = bridge_path(project_root);
    let Ok(text) = fs::read_to_string(&path) else {
        return None;
    };
    let value: Value = serde_json::from_str(&text).ok()?;
    let timestamp = value.get("timestamp").and_then(Value::as_u64).unwrap_or(0) as u128;
    if now_ms().saturating_sub(timestamp) > METRICS_STALE_MS {
        return None;
    }
    let remaining = value
        .get("remaining")
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite() && *f > 0.0)?;
    let used = value
        .get("used")
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite())?;
    Some(ContextMetrics { remaining, used })
}

fn write_bridge(project_root: &str, metrics: ContextMetrics) {
    let path = bridge_path(project_root);
    let payload = json!({
        "remaining": metrics.remaining,
        "used": metrics.used,
        "timestamp": now_ms(),
    });
    let _ = fs::write(&path, payload.to_string());
}

fn stable_hash_hex(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_remaining_percentage_metrics() {
        let metrics = parse_context_metrics(&json!({
            "context_window": { "remaining_percentage": 18 }
        }))
        .unwrap();
        assert_eq!(metrics.remaining, 18.0);
        assert_eq!(metrics.used, 82.0);
    }

    #[test]
    fn parses_token_usage_metrics() {
        let metrics = parse_context_metrics(&json!({
            "info": { "total_token_usage": { "total_tokens": 750 } },
            "model_context_window": 1000
        }))
        .unwrap();
        assert_eq!(metrics.remaining, 25.0);
        assert_eq!(metrics.used, 75.0);
    }

    #[test]
    fn context_monitor_emits_critical_metrics_payload() {
        let root = env::temp_dir().join(unique_test_name("emb-agent-rs-context-test"));
        let payload = json!({
            "cwd": root,
            "event": "PostToolUse",
            "workspace_trusted": true,
            "context_window": { "remaining_percentage": 18 }
        });
        let output = build_context_monitor_output_from_value(&payload);
        assert!(output.contains("hookSpecificOutput"));
        assert!(output.contains("PostToolUse"));
        assert!(output.contains("EMB CONTEXT CRITICAL"));
        assert!(output.contains("host clear/new-context control"));
    }

    #[test]
    fn context_monitor_requires_trust() {
        let payload = json!({
            "workspace": { "trusted": false },
            "context_window": { "remaining_percentage": 18 }
        });
        assert_eq!(build_context_monitor_output_from_value(&payload), "");
    }

    #[test]
    fn context_monitor_suppresses_duplicate_signature() {
        let project_root = env::temp_dir()
            .join(unique_test_name("emb-agent-rs-context-dupe"))
            .to_string_lossy()
            .to_string();
        assert!(should_emit(&project_root, "warning", "same-warning"));
        assert!(!should_emit(&project_root, "warning", "same-warning"));
        assert!(should_emit(&project_root, "critical", "same-warning"));
    }

    fn unique_test_name(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        format!("{prefix}-{}-{nanos}", std::process::id())
    }
}
