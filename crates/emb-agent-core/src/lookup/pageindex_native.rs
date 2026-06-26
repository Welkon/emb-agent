//! Native PageIndex tree builder — no Python sidecar.
//!
//! This is a faithful Rust port of the PageIndex orchestration
//! (https://github.com/VectifyAI/PageIndex, MIT) that talks directly to an
//! OpenAI-compatible `/chat/completions` endpoint via `ureq`, reuses
//! emb-agent's already-supported `pdftotext`/`mutool` for PDF text extraction,
//! and approximates token counts locally. It removes the litellm / PyPDF2 /
//! pymupdf / python-dotenv dependency chain entirely.
//!
//! Provider configuration (OpenAI-compatible — covers OpenAI, Azure OpenAI,
//! Anthropic's OpenAI shim, Gemini's OpenAI shim, vLLM, Ollama, DeepSeek,
//! Moonshot, Together, Groq, …):
//! - `EMB_AGENT_LLM_MODEL` / `EMB_AGENT_LLM_API_BASE` / `EMB_AGENT_LLM_API_KEY`
//!   are the shared defaults for chat LLM features.
//! - `EMB_AGENT_PAGEINDEX_MODEL` / `EMB_AGENT_PAGEINDEX_API_BASE` /
//!   `EMB_AGENT_PAGEINDEX_API_KEY` override the shared defaults when PageIndex
//!   needs a different model/endpoint/key.
//! - `OPENAI_API_KEY` / `CHATGPT_API_KEY` remain key fallbacks.
//!
//! All prompts below are ported verbatim from `pageindex/page_index.py` and
//! `pageindex/page_index_md.py`; they are the core of the PageIndex method.

use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const MAX_TOKENS_PER_NODE: usize = 20_000;
const MAX_PAGES_PER_NODE: usize = 10;
const TOC_CHECK_PAGE_NUM: usize = 20;
const LLM_MAX_RETRIES: usize = 6;

/// OpenAI-compatible chat completions client.
pub(crate) struct LlmClient {
    api_base: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FinishReason {
    Finished,
    Length,
}

impl LlmClient {
    fn new(api_base: String, api_key: String, model: String) -> Self {
        Self {
            api_base,
            api_key,
            model,
        }
    }

    /// Single-turn completion. Retries on transport/HTTP errors.
    fn complete(&self, prompt: &str) -> Result<String, String> {
        Ok(self.complete_with_history(prompt, &[])?.0)
    }

    /// Multi-turn completion that also reports whether the model finished or
    /// hit the output length limit. Used by the TOC-transformer continuation
    /// loop, mirroring PageIndex's `return_finish_reason` path.
    fn complete_with_history(
        &self,
        prompt: &str,
        history: &[Message],
    ) -> Result<(String, FinishReason), String> {
        let mut messages: Vec<Value> = history.iter().map(|m| m.to_json()).collect();
        messages.push(json!({"role": "user", "content": prompt}));
        let body = json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0,
        });
        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));

        let mut last_err = String::new();
        for attempt in 0..LLM_MAX_RETRIES {
            let response = ureq::post(&url)
                .set("Authorization", &format!("Bearer {}", self.api_key))
                .set("Content-Type", "application/json")
                .timeout(Duration::from_secs(120))
                .send_json(body.clone());
            let response = match response {
                Ok(r) => r,
                Err(ureq::Error::Status(code, resp)) => {
                    let body = resp.into_string().unwrap_or_default();
                    last_err = format!(
                        "HTTP {code}: {}",
                        body.chars().take(300).collect::<String>()
                    );
                    if code == 401 || code == 403 {
                        return Err(format!(
                            "LLM auth failed ({code}); check EMB_AGENT_PAGEINDEX_API_KEY: {last_err}"
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(800 * (attempt as u64 + 1)));
                    continue;
                }
                Err(e) => {
                    last_err = e.to_string();
                    std::thread::sleep(Duration::from_millis(800 * (attempt as u64 + 1)));
                    continue;
                }
            };
            let parsed: Value = response
                .into_json()
                .map_err(|e| format!("LLM response was not JSON: {e}"))?;
            let choice = parsed
                .pointer("/choices/0")
                .ok_or_else(|| format!("LLM response missing choices: {parsed}"))?;
            let content = choice
                .pointer("/message/content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let finish = choice
                .get("finish_reason")
                .and_then(Value::as_str)
                .unwrap_or("stop");
            let reason = match finish {
                "length" => FinishReason::Length,
                "stop" | "end_turn" | "STOP" => FinishReason::Finished,
                _ => FinishReason::Finished,
            };
            return Ok((content, reason));
        }
        Err(format!(
            "LLM call failed after {LLM_MAX_RETRIES} retries: {last_err}"
        ))
    }
}

struct Message {
    role: &'static str,
    content: String,
}

impl Message {
    fn to_json(&self) -> Value {
        json!({"role": self.role, "content": self.content})
    }
}

/// Extract a JSON value from an LLM response, tolerating ```json fences,
/// Python `None`, stray whitespace, and trailing commas. Ported from
/// `pageindex/utils.py::extract_json`.
fn extract_json(content: &str) -> Value {
    let candidate = extract_json_text(content);
    match serde_json::from_str::<Value>(&candidate) {
        Ok(v) => v,
        Err(_) => {
            let cleaned = candidate.replace(",]", "]").replace(",}", "}");
            serde_json::from_str::<Value>(&cleaned).unwrap_or(Value::Null)
        }
    }
}

fn extract_json_text(content: &str) -> String {
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
    let s = s.replace("None", "null").replace(['\n', '\r'], " ");
    let mut buf = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                buf.push(' ');
                prev_space = true;
            }
        } else {
            buf.push(ch);
            prev_space = false;
        }
    }
    if buf.is_empty() {
        buf.push_str("null");
    }
    buf
}

/// Approximate token count. PageIndex uses tiktoken via litellm; for the only
/// purpose here (grouping pages into ≤20k-token chunks) a chars/4 estimate is
/// accurate enough and avoids a native tiktoken dependency.
fn count_tokens(text: &str) -> usize {
    (text.chars().count() / 4).max(1)
}

// === PDF / text page extraction ============================================

/// Read a document into a list of `(page_text, token_count)` pairs.
///
/// For PDFs, runs `pdftotext` (fallback `mutool`) and splits on the form-feed
/// (`\f`) separator that both emit between pages. For markdown/text, the whole
/// file is a single "page" (the markdown tree path uses header line numbers
/// instead, so page splitting is irrelevant there).
pub(crate) fn read_pages(file_path: &Path) -> Result<Vec<(String, usize)>, String> {
    let lower = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if lower == "pdf" {
        return read_pdf_pages(file_path);
    }
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read {}: {e}", file_path.display()))?;
    let tokens = count_tokens(&content);
    Ok(vec![(content, tokens)])
}

fn read_pdf_pages(file_path: &Path) -> Result<Vec<(String, usize)>, String> {
    let path_str = file_path.to_string_lossy();
    // pdftotext separates pages with \f.
    if command_available("pdftotext") {
        let output = Command::new("pdftotext")
            .args([path_str.as_ref(), "-"])
            .output()
            .map_err(|e| format!("pdftotext spawn failed: {e}"))?;
        if output.status.success() && !output.stdout.is_empty() {
            return Ok(split_form_feeds(&output.stdout));
        }
    }
    if command_available("mutool") {
        let output = Command::new("mutool")
            .args(["draw", "-F", "txt", "-o", "-", path_str.as_ref()])
            .output()
            .map_err(|e| format!("mutool spawn failed: {e}"))?;
        if output.status.success() && !output.stdout.is_empty() {
            return Ok(split_form_feeds(&output.stdout));
        }
    }
    Err("PDF text extraction needs `pdftotext` (poppler-utils) or `mutool` (mupdf-tools) on PATH for the `pageindex` provider".to_string())
}

fn split_form_feeds(bytes: &[u8]) -> Vec<(String, usize)> {
    let text = String::from_utf8_lossy(bytes).to_string();
    let mut pages = Vec::new();
    for page_text in text.split('\u{000C}') {
        let trimmed = page_text.trim_end();
        if !pages.is_empty() || !trimmed.is_empty() {
            pages.push((page_text.to_string(), count_tokens(page_text)));
        }
    }
    if pages.is_empty() {
        pages.push((String::new(), 0));
    }
    pages
}

fn command_available(command: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{command}.exe"), command.to_string()]
    } else {
        vec![command.to_string()]
    };
    std::env::split_paths(&paths).any(|dir| names.iter().any(|name| dir.join(name).is_file()))
}

// === page grouping =========================================================

/// Ported from `page_list_to_group_text`. Merges pages into ≤`max_tokens`
/// chunks with `overlap_page` overlap, for LLM context windows.
fn page_list_to_group_text(
    page_contents: &[String],
    token_lengths: &[usize],
    max_tokens: usize,
    overlap_page: usize,
) -> Vec<String> {
    let num_tokens: usize = token_lengths.iter().sum();
    if num_tokens <= max_tokens {
        return vec![page_contents.concat()];
    }
    let mut subsets = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut current_tokens = 0usize;
    let expected_parts = ((num_tokens as f64) / (max_tokens as f64)).ceil() as usize;
    let average =
        (((num_tokens / expected_parts.max(1)) + max_tokens) as f64 / 2.0).ceil() as usize;

    for (i, (content, tokens)) in page_contents.iter().zip(token_lengths.iter()).enumerate() {
        if current_tokens + tokens > average {
            subsets.push(current.concat());
            let overlap_start = i.saturating_sub(overlap_page);
            current = page_contents[overlap_start..i].to_vec();
            current_tokens = token_lengths[overlap_start..i].iter().sum();
        }
        current.push(content.clone());
        current_tokens += tokens;
    }
    if !current.is_empty() {
        subsets.push(current.concat());
    }
    subsets
}

// === physical_index helpers ===============================================

fn with_page_tag(page_index: usize, page_text: &str) -> String {
    format!("<physical_index_{page_index}>\n{page_text}\n<physical_index_{page_index}>\n\n")
}

fn convert_physical_index_to_int(value: &Value) -> Option<usize> {
    let s = value.as_str()?;
    let s = s.trim();
    let inner = s
        .strip_prefix("<physical_index_")
        .or_else(|| s.strip_prefix("physical_index_"))?;
    let inner = inner.trim_end_matches('>').trim();
    inner.parse::<usize>().ok()
}

// === structure tree helpers ===============================================

#[derive(Debug, Clone)]
struct FlatItem {
    structure: Option<String>,
    title: String,
    physical_index: Option<usize>,
    appear_start: Option<String>,
}

/// Simpler, correct tree builder: items are already in document order with
/// dotted structure ids; nest by popping the stack at each level.
fn build_nested_tree(items: &[FlatItem], end_physical_index: usize) -> Vec<Value> {
    // First, compute end_index for each flat item (mirrors post_processing).
    let mut with_ends: Vec<(FlatItem, Option<usize>)> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let end = if i + 1 < items.len() {
            let next = &items[i + 1];
            match next.physical_index {
                Some(np) if next.appear_start.as_deref() == Some("yes") => {
                    Some(np.saturating_sub(1))
                }
                Some(np) => Some(np),
                None => None,
            }
        } else {
            Some(end_physical_index)
        };
        with_ends.push((item.clone(), end));
    }

    // Build nested tree using a stack of (depth, path) where path is the index
    // trail from a root. Attaching via mutable path walk into `roots` avoids the
    // clone-disconnect bug where stack-held clones diverge from roots.
    let mut roots: Vec<Value> = Vec::new();
    // stack holds (depth, path): path is vec of child indices from the root.
    let mut stack: Vec<(usize, Vec<usize>)> = Vec::new();
    for (item, end) in with_ends {
        let depth = item
            .structure
            .as_ref()
            .map(|s| s.split('.').count())
            .unwrap_or(1);
        let node = json!({
            "title": item.title,
            "start_index": item.physical_index,
            "end_index": end,
            "nodes": [],
        });
        while let Some((top_depth, _)) = stack.last() {
            if *top_depth >= depth {
                stack.pop();
            } else {
                break;
            }
        }
        let child_index = if let Some((_, parent_path)) = stack.last() {
            node_count_at(
                roots.get(parent_path[0]).unwrap_or(&Value::Null),
                &parent_path[1..],
            )
        } else {
            roots.len()
        };
        if let Some((_, parent_path)) = stack.last() {
            let parent_path = parent_path.clone();
            push_child_at(&mut roots, &parent_path, node.clone());
        } else {
            roots.push(node.clone());
        }
        let mut my_path = stack.last().map(|(_, p)| p.clone()).unwrap_or_default();
        my_path.push(child_index);
        stack.push((depth, my_path));
    }

    // Clean empty nodes arrays.
    fn clean(node: &mut Value) {
        if let Some(arr) = node.get_mut("nodes").and_then(Value::as_array_mut) {
            for kid in arr.iter_mut() {
                clean(kid);
            }
            if arr.is_empty()
                && let Some(obj) = node.as_object_mut()
            {
                obj.remove("nodes");
            }
        }
    }
    for root in roots.iter_mut() {
        clean(root);
    }
    roots
}

fn node_count_at(root: &Value, path: &[usize]) -> usize {
    let mut current = root;
    for &idx in path {
        let arr = current.get("nodes").and_then(Value::as_array);
        let Some(arr) = arr else { return 0 };
        let Some(child) = arr.get(idx) else { return 0 };
        current = child;
    }
    current
        .get("nodes")
        .and_then(Value::as_array)
        .map(|a| a.len())
        .unwrap_or(0)
}

fn push_child_at(roots: &mut [Value], path: &[usize], child: Value) {
    if path.is_empty() {
        return;
    }
    let root = &mut roots[path[0]];
    let mut current = root;
    for &idx in &path[1..] {
        let arr = current.get_mut("nodes").and_then(Value::as_array_mut);
        let Some(arr) = arr else { return };
        current = &mut arr[idx];
    }
    current
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .expect("nodes array")
        .push(child);
}

fn add_preface_if_needed(items: &mut Vec<FlatItem>) {
    if let Some(first) = items.first()
        && first.physical_index.map(|p| p > 1).unwrap_or(false)
    {
        items.insert(
            0,
            FlatItem {
                structure: Some("0".to_string()),
                title: "Preface".to_string(),
                physical_index: Some(1),
                appear_start: None,
            },
        );
    }
}

fn write_node_id(nodes: &mut [Value], counter: &mut usize) {
    for node in nodes.iter_mut() {
        *counter += 1;
        let id = format!("{:04}", counter);
        if let Some(obj) = node.as_object_mut() {
            obj.insert("node_id".to_string(), json!(id));
        }
        if let Some(kids) = node.get_mut("nodes").and_then(Value::as_array_mut) {
            write_node_id(kids, counter);
        }
    }
}

fn add_node_text(nodes: &mut [Value], pages: &[(String, usize)]) {
    for node in nodes.iter_mut() {
        let start = node
            .get("start_index")
            .and_then(Value::as_u64)
            .map(|n| n as usize);
        let end = node
            .get("end_index")
            .and_then(Value::as_u64)
            .map(|n| n as usize);
        if let (Some(s), Some(e)) = (start, end) {
            let s = s.max(1);
            let e = e.min(pages.len());
            let text: String = pages[s - 1..e]
                .iter()
                .map(|(t, _)| t.as_str())
                .collect::<Vec<_>>()
                .join("");
            if let Some(obj) = node.as_object_mut() {
                obj.insert("text".to_string(), json!(text));
            }
        }
        if let Some(kids) = node.get_mut("nodes").and_then(Value::as_array_mut) {
            add_node_text(kids, pages);
        }
    }
}

fn flatten_nodes(nodes: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for node in nodes {
        out.push(node.clone());
        if let Some(kids) = node.get("nodes").and_then(Value::as_array) {
            out.extend(flatten_nodes(kids));
        }
    }
    out
}

// === prompts (ported verbatim) ============================================

fn prompt_check_title_appearance(title: &str, page_text: &str) -> String {
    format!(
        "\n    Your job is to check if the given section appears or starts in the given page_text.\n\n    Note: do fuzzy matching, ignore any space inconsistency in the page_text.\n\n    The given section title is {title}.\n    The given page_text is {page_text}.\n    \n    Reply format:\n    {{\n        \n        \"thinking\": <why do you think the section appears or starts in the page_text>\n        \"answer\": \"yes or no\" (yes if the section appears or starts in the page_text, no otherwise)\n    }}\n    Directly return the final JSON structure. Do not output anything else."
    )
}

fn prompt_check_title_in_start(title: &str, page_text: &str) -> String {
    format!(
        "\n    You will be given the current section title and the current page_text.\n    Your job is to check if the current section starts in the beginning of the given page_text.\n    If there are other contents before the current section title, then the current section does not start in the beginning of the given page_text.\n    If the current section title is the first content in the given page_text, then the current section starts in the beginning of the given page_text.\n\n    Note: do fuzzy matching, ignore any space inconsistency in the page_text.\n\n    The given section title is {title}.\n    The given page_text is {page_text}.\n    \n    reply format:\n    {{\n        \"thinking\": <why do you think the section appears or starts in the page_text>\n        \"start_begin\": \"yes or no\" (yes if the section starts in the beginning of the page_text, no otherwise)\n    }}\n    Directly return the final JSON structure. Do not output anything else."
    )
}

fn prompt_toc_detector(content: &str) -> String {
    format!(
        "\n    Your job is to detect if there is a table of content provided in the given text.\n\n    Given text: {content}\n\n    return the following JSON format:\n    {{\n        \"thinking\": <why do you think there is a table of content in the given text>\n        \"toc_detected\": \"<yes or no>\",\n    }}\n\n    Directly return the final JSON structure. Do not output anything else.\n    Please note: abstract,summary, notation list, figure list, table list, etc. are not table of contents."
    )
}

fn prompt_detect_page_index(toc_content: &str) -> String {
    format!(
        "\n    You will be given a table of contents.\n\n    Your job is to detect if there are page numbers/indices given within the table of contents.\n\n    Given text: {toc_content}\n\n    Reply format:\n    {{\n        \"thinking\": <why do you think there are page numbers/indices given within the table of contents>\n        \"page_index_given_in_toc\": \"<yes or no>\"\n    }}\n    Directly return the final JSON structure. Do not output anything else."
    )
}

fn prompt_toc_index_extractor(toc: &str, content: &str) -> String {
    format!(
        "\n    You are given a table of contents in a json format and several pages of a document, your job is to add the physical_index to the table of contents in the json format.\n\n    The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.\n\n    The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.\n\n    The response should be in the following JSON format: \n    [\n        {{\n            \"structure\": <structure index, \"x.x.x\" or None> (string),\n            \"title\": <title of the section>,\n            \"physical_index\": \"<physical_index_X>\" (keep the format)\n        }},\n        ...\n    ]\n\n    Only add the physical_index to the sections that are in the provided pages.\n    If the section is not in the provided pages, do not add the physical_index to it.\n    Directly return the final JSON structure. Do not output anything else.\n\nTable of contents:\n{toc}\nDocument pages:\n{content}"
    )
}

fn prompt_toc_transformer(toc_content: &str) -> String {
    format!(
        "\n    You are given a table of contents, You job is to transform the whole table of content into a JSON format included table_of_contents.\n\n    structure is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.\n\n    The response should be in the following JSON format: \n    {{\n    table_of_contents: [\n        {{\n            \"structure\": <structure index, \"x.x.x\" or None> (string),\n            \"title\": <title of the section>,\n            \"page\": <page number or None>,\n        }},\n        ...\n        ],\n    }}\n    You should transform the full table of contents in one go.\n    Directly return the final JSON structure, do not output anything else. \n\n Given table of contents\n:{toc_content}"
    )
}

fn prompt_toc_transformer_continue(toc_content: &str, incomplete: &str) -> String {
    format!(
        "\n        Your task is to continue the table of contents json structure, directly output the remaining part of the json structure.\n        The response should be in the following JSON format: \n\n        The raw table of contents json structure is:\n        {toc_content}\n\n        The incomplete transformed table of contents json structure is:\n        {incomplete}\n\n        Please continue the json structure, directly output the remaining part of the json structure."
    )
}

fn prompt_add_page_number_to_toc(part: &str, structure: &str) -> String {
    format!(
        "\n    You are given an JSON structure of a document and a partial part of the document. Your task is to check if the title that is described in the structure is started in the partial given document.\n\n    The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X. \n\n    If the full target section starts in the partial given document, insert the given JSON structure with the \"start\": \"yes\", and \"start_index\": \"<physical_index_X>\".\n\n    If the full target section does not start in the partial given document, insert \"start\": \"no\",  \"start_index\": None.\n\n    The response should be in the following format. \n        [\n            {{\n                \"structure\": <structure index, \"x.x.x\" or None> (string),\n                \"title\": <title of the section>,\n                \"start\": \"<yes or no>\",\n                \"physical_index\": \"<physical_index_X> (keep the format)\" or None\n            }},\n            ...\n        ]    \n    The given structure contains the result of the previous part, you need to fill the result of the current part, do not change the previous result.\n    Directly return the final JSON structure. Do not output anything else.\n\n\nCurrent Partial Document:\n{part}\n\nGiven Structure\n{structure}\n"
    )
}

fn prompt_generate_toc_init(part: &str) -> String {
    format!(
        "\n    You are an expert in extracting hierarchical tree structure, your task is to generate the tree structure of the document.\n\n    The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.\n\n    For the title, you need to extract the original title from the text, only fix the space inconsistency.\n\n    The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the start and end of page X. \n\n    For the physical_index, you need to extract the physical index of the start of the section from the text. Keep the <physical_index_X> format.\n\n    The response should be in the following format. \n        [\n            {{\n                \"structure\": <structure index, \"x.x.x\"> (string),\n                \"title\": <title of the section, keep the original title>,\n                \"physical_index\": \"<physical_index_X> (keep the format)\"\n            }},\n            ...\n        ]    \n\n    Directly return the final JSON structure. Do not output anything else.\n\n\nGiven text\n:{part}"
    )
}

fn prompt_generate_toc_continue(part: &str, prev: &str) -> String {
    format!(
        "\n    You are an expert in extracting hierarchical tree structure.\n    You are given a tree structure of the previous part and the text of the current part.\n    Your task is to continue the tree structure from the previous part to include the current part.\n\n    The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.\n\n    For the title, you need to extract the original title from the text, only fix the space inconsistency.\n\n    The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the start and end of page X. \n    \n    For the physical_index, you need to extract the physical index of the start of the section from the text. Keep the <physical_index_X> format.\n\n    The response should be in the following format. \n        [\n            {{\n                \"structure\": <structure index, \"x.x.x\"> (string),\n                \"title\": <title of the section, keep the original title>,\n                \"physical_index\": \"<physical_index_X> (keep the format)\"\n            }},\n            ...\n        ]    \n\n    Directly return the additional part of the final JSON structure. Do not output anything else.\n\n\nGiven text\n:{part}\nPrevious tree structure\n:{prev}"
    )
}

fn prompt_single_toc_item_index_fixer(title: &str, content: &str) -> String {
    format!(
        "\n    You are given a section title and several pages of a document, your job is to find the physical index of the start page of the section in the partial document.\n\n    The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.\n\n    Reply in a JSON format:\n    {{\n        \"thinking\": <explain which page, started and closed by <physical_index_X>, contains the start of this section>,\n        \"physical_index\": \"<physical_index_X>\" (keep the format)\n    }}\n    Directly return the final JSON structure. Do not output anything else.\n\n\nSection Title:\n{title}\nDocument pages:\n{content}"
    )
}

fn prompt_node_summary(text: &str) -> String {
    format!(
        "\n    You are given a part of a document, your task is to generate a description of the partial document about what are main points covered in the partial document.\n\n    Partial Document Text: {text}\n    \n    Directly return the description, do not include any other text.\n    "
    )
}

fn prompt_doc_description(structure: &str) -> String {
    format!(
        "\n    Your are an expert in generating descriptions for a document.\n    You are given a structure of a document. Your task is to generate a one-sentence description for the document, which makes it easy to distinguish the document from other documents.\n        \n    Document Structure: {structure}\n    \n    Directly return the description, do not include any other text.\n    "
    )
}

// === orchestration ========================================================

/// Resolve LLM config from per-call overrides > env > defaults.
pub(crate) fn resolve_llm_config(
    model_override: Option<&str>,
    api_base_override: Option<&str>,
    api_key_override: Option<&str>,
) -> Result<(String, String, String), String> {
    let model = model_override
        .map(str::to_string)
        .or_else(|| std::env::var("EMB_AGENT_PAGEINDEX_MODEL").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| std::env::var("EMB_AGENT_LLM_MODEL").ok().filter(|s| !s.trim().is_empty()))
        .ok_or_else(|| {
            "PageIndex needs EMB_AGENT_PAGEINDEX_MODEL or EMB_AGENT_LLM_MODEL (e.g. gpt-4o-2024-11-20 or an OpenAI-compatible model id)".to_string()
        })?;
    let api_base = api_base_override
        .map(str::to_string)
        .or_else(|| {
            std::env::var("EMB_AGENT_PAGEINDEX_API_BASE")
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| {
            std::env::var("EMB_AGENT_LLM_API_BASE")
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let api_key = api_key_override
        .map(str::to_string)
        .or_else(|| std::env::var("EMB_AGENT_PAGEINDEX_API_KEY").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| std::env::var("EMB_AGENT_LLM_API_KEY").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| std::env::var("OPENAI_API_KEY").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| std::env::var("CHATGPT_API_KEY").ok().filter(|s| !s.trim().is_empty()))
        .ok_or_else(|| {
            "PageIndex needs an LLM key: EMB_AGENT_PAGEINDEX_API_KEY, EMB_AGENT_LLM_API_KEY, or OPENAI_API_KEY".to_string()
        })?;
    Ok((api_base, api_key, model))
}

/// Build the tree and write `structure.json` + `pages.json`. Mirrors
/// `page_index_main` / `tree_parser`.
pub(crate) fn build_native(
    file_path: &Path,
    structure_out: &Path,
    pages_out: &Path,
    api_base: &str,
    api_key: &str,
    model: &str,
) -> Result<(String, String, usize, usize, bool), String> {
    let llm = LlmClient::new(api_base.to_string(), api_key.to_string(), model.to_string());
    let lower = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_md = matches!(lower.as_str(), "md" | "markdown");

    let pages = read_pages(file_path)?;
    let total_pages = pages.len();

    if is_md {
        let md_text = &pages[0].0;
        let structure = build_md_tree(md_text, &llm)?;
        let structure_json = json!({
            "doc_name": file_stem(file_path),
            "doc_description": structure.1,
            "line_count": md_text.lines().count().max(1),
            "structure": structure.0,
        });
        write_artifacts(&structure_json, &pages, structure_out, pages_out)?;
        let sections = count_sections(&structure.0);
        return Ok((
            file_stem(file_path),
            structure.1,
            sections,
            total_pages,
            true,
        ));
    }

    let toc = check_toc(&pages, &llm);
    let mode = if toc
        .toc_content
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
        && toc.page_index_given
    {
        "process_toc_with_page_numbers"
    } else if toc.toc_content.is_some() {
        "process_toc_no_page_numbers"
    } else {
        "process_no_toc"
    };

    let flat = meta_processor(&pages, mode, &toc, &llm)?;
    let mut items: Vec<FlatItem> = flat
        .into_iter()
        .filter(|i| i.physical_index.is_some())
        .collect();
    add_preface_if_needed(&mut items);
    check_title_appearance_in_start(&mut items, &pages, &llm);
    let mut tree = build_nested_tree(&items, total_pages);
    process_large_nodes(&mut tree, &pages, &llm)?;
    write_node_id(&mut tree, &mut 0);
    add_node_text(&mut tree, &pages);
    generate_summaries(&mut tree, &llm);
    // Keep node `text` in the cached structure so `doc lookup` section scoring
    // and the knowledge graph's per-section register/concept extraction have
    // evidence. `doc tree` strips text on read via `strip_text_fields`.
    let doc_description = generate_doc_description(&tree, &llm);
    let structure_json = json!({
        "doc_name": file_stem(file_path),
        "doc_description": doc_description,
        "structure": tree,
    });
    write_artifacts(&structure_json, &pages, structure_out, pages_out)?;
    let sections = count_sections(&tree);
    Ok((
        file_stem(file_path),
        doc_description,
        sections,
        total_pages,
        false,
    ))
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document")
        .to_string()
}

fn write_artifacts(
    structure: &Value,
    pages: &[(String, usize)],
    structure_out: &Path,
    pages_out: &Path,
) -> Result<(), String> {
    if let Some(parent) = structure_out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    fs::write(
        structure_out,
        serde_json::to_string_pretty(structure).unwrap_or_default(),
    )
    .map_err(|e| format!("write structure.json: {e}"))?;
    let pages_json: Vec<Value> = pages
        .iter()
        .enumerate()
        .map(|(i, (text, _))| json!({"page": i + 1, "content": text}))
        .collect();
    fs::write(
        pages_out,
        serde_json::to_string(&Value::Array(pages_json)).unwrap_or_default(),
    )
    .map_err(|e| format!("write pages.json: {e}"))?;
    Ok(())
}

fn count_sections(nodes: &[Value]) -> usize {
    nodes
        .iter()
        .map(|n| {
            1 + count_sections(
                n.get("nodes")
                    .and_then(Value::as_array)
                    .unwrap_or(&Vec::new()),
            )
        })
        .sum()
}

struct TocResult {
    toc_content: Option<String>,
    page_index_given: bool,
}

/// Ported from `check_toc` / `find_toc_pages` / `toc_extractor`.
fn check_toc(pages: &[(String, usize)], llm: &LlmClient) -> TocResult {
    // Scan up to TOC_CHECK_PAGE_NUM pages for a TOC.
    let mut toc_page_list = Vec::new();
    let mut last_is_yes = false;
    let limit = TOC_CHECK_PAGE_NUM.min(pages.len());
    let mut i = 0;
    while i < limit {
        let detected = llm
            .complete(&prompt_toc_detector(&pages[i].0))
            .unwrap_or_default();
        let yes = extract_json(&detected)
            .get("toc_detected")
            .and_then(Value::as_str)
            .map(|s| s == "yes")
            .unwrap_or(false);
        if yes {
            toc_page_list.push(i);
            last_is_yes = true;
        } else if last_is_yes {
            break;
        }
        i += 1;
    }
    if toc_page_list.is_empty() {
        return TocResult {
            toc_content: None,
            page_index_given: false,
        };
    }
    let toc_text: String = toc_page_list
        .iter()
        .map(|&p| pages[p].0.as_str())
        .collect::<Vec<_>>()
        .join("");
    let toc_text = transform_dots_to_colon(&toc_text);
    let page_index_given = extract_json(
        &llm.complete(&prompt_detect_page_index(&toc_text))
            .unwrap_or_default(),
    )
    .get("page_index_given_in_toc")
    .and_then(Value::as_str)
    .map(|s| s == "yes")
    .unwrap_or(false);
    TocResult {
        toc_content: Some(toc_text),
        page_index_given,
    }
}

fn transform_dots_to_colon(text: &str) -> String {
    let text = regex_like_replace_dots(text);
    regex_like_replace_dot_spaces(&text)
}

fn regex_like_replace_dots(text: &str) -> String {
    // \.{5,} -> ": "
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' {
            let mut j = i;
            while j < bytes.len() && bytes[j] == b'.' {
                j += 1;
            }
            if j - i >= 5 {
                out.push_str(": ");
            } else {
                for _ in i..j {
                    out.push('.');
                }
            }
            i = j;
        } else {
            let ch = text[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn regex_like_replace_dot_spaces(text: &str) -> String {
    // (?:\. ){5,}\.? -> ": "  (dots followed by spaces, at least 5)
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '.' {
            // count ". " repetitions
            let mut j = i;
            let mut reps = 0;
            while j + 1 < chars.len() && chars[j] == '.' && chars[j + 1] == ' ' {
                reps += 1;
                j += 2;
            }
            if reps >= 5 {
                // optional trailing dot
                if j < chars.len() && chars[j] == '.' {
                    j += 1;
                }
                out.push_str(": ");
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}
/// Ported from `meta_processor`. Runs the appropriate build path, verifies,
/// fixes, and falls back to simpler paths on low accuracy.
fn meta_processor(
    pages: &[(String, usize)],
    mode: &str,
    toc: &TocResult,
    llm: &LlmClient,
) -> Result<Vec<FlatItem>, String> {
    let mut items = match mode {
        "process_toc_with_page_numbers" => {
            process_toc_with_page_numbers(toc.toc_content.as_deref().unwrap_or(""), pages, llm)?
        }
        "process_toc_no_page_numbers" => {
            process_toc_no_page_numbers(toc.toc_content.as_deref().unwrap_or(""), pages, llm)?
        }
        _ => process_no_toc(pages, llm)?,
    };

    // Filter None physical_index (validate_and_truncate).
    items.retain(|i| i.physical_index.is_some());
    for item in items.iter_mut() {
        if let Some(p) = item.physical_index
            && p > pages.len()
        {
            item.physical_index = None;
        }
    }
    items.retain(|i| i.physical_index.is_some());

    let (accuracy, incorrect) = verify_toc(pages, &items, llm);
    eprintln!("pageindex: verify accuracy = {:.2}%", accuracy * 100.0);
    if accuracy >= 1.0 || incorrect.is_empty() {
        return Ok(items);
    }
    if accuracy > 0.6 {
        let (fixed, _remaining) = fix_incorrect_toc_with_retries(pages, &items, &incorrect, llm);
        return Ok(fixed);
    }
    // Fallback to simpler paths.
    match mode {
        "process_toc_with_page_numbers" => {
            meta_processor(pages, "process_toc_no_page_numbers", toc, llm)
        }
        "process_toc_no_page_numbers" => meta_processor(pages, "process_no_toc", toc, llm),
        _ => Err("PageIndex processing failed: low verification accuracy".to_string()),
    }
}

fn parse_flat_items(value: &Value) -> Vec<FlatItem> {
    value
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|item| FlatItem {
            structure: item
                .get("structure")
                .and_then(Value::as_str)
                .map(str::to_string),
            title: item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            physical_index: item.get("physical_index").and_then(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .or_else(|| convert_physical_index_to_int(v))
            }),
            appear_start: None,
        })
        .collect()
}

fn process_no_toc(pages: &[(String, usize)], llm: &LlmClient) -> Result<Vec<FlatItem>, String> {
    let page_contents: Vec<String> = pages
        .iter()
        .enumerate()
        .map(|(i, (text, _))| with_page_tag(i + 1, text))
        .collect();
    let token_lengths: Vec<usize> = page_contents.iter().map(|s| count_tokens(s)).collect();
    let groups = page_list_to_group_text(&page_contents, &token_lengths, MAX_TOKENS_PER_NODE, 1);
    let mut items = parse_flat_items(&extract_json(
        &llm.complete(&prompt_generate_toc_init(&groups[0]))
            .unwrap_or_default(),
    ));
    for group in groups.iter().skip(1) {
        let prev_json = serde_json::to_string(
            &items
                .iter()
                .map(|i| {
                    json!({
                        "structure": i.structure,
                        "title": i.title,
                        "physical_index": i.physical_index.map(|p| format!("<physical_index_{p}>")),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap_or_default();
        let more = parse_flat_items(&extract_json(
            &llm.complete(&prompt_generate_toc_continue(group, &prev_json))
                .unwrap_or_default(),
        ));
        items.extend(more);
    }
    Ok(items)
}

fn process_toc_no_page_numbers(
    toc_content: &str,
    pages: &[(String, usize)],
    llm: &LlmClient,
) -> Result<Vec<FlatItem>, String> {
    let toc_items = toc_transformer(toc_content, llm)?;
    let page_contents: Vec<String> = pages
        .iter()
        .enumerate()
        .map(|(i, (text, _))| with_page_tag(i + 1, text))
        .collect();
    let token_lengths: Vec<usize> = page_contents.iter().map(|s| count_tokens(s)).collect();
    let groups = page_list_to_group_text(&page_contents, &token_lengths, MAX_TOKENS_PER_NODE, 1);
    let mut current: Vec<Value> = toc_items
        .into_iter()
        .map(|i| {
            json!({
                "structure": i.structure,
                "title": i.title,
                "physical_index": i.physical_index.map(|p| format!("<physical_index_{p}>")),
            })
        })
        .collect();
    for group in groups {
        let structure_json = serde_json::to_string(&current).unwrap_or_default();
        let updated = llm
            .complete(&prompt_add_page_number_to_toc(&group, &structure_json))
            .unwrap_or_default();
        let parsed = extract_json(&updated);
        if let Some(arr) = parsed.as_array() {
            current = arr
                .iter()
                .map(|item| {
                    json!({
                        "structure": item.get("structure").cloned().unwrap_or(Value::Null),
                        "title": item.get("title").cloned().unwrap_or(Value::Null),
                        "physical_index": item.get("physical_index").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect();
        }
    }
    Ok(parse_flat_items(&Value::Array(current)))
}

fn process_toc_with_page_numbers(
    toc_content: &str,
    pages: &[(String, usize)],
    llm: &LlmClient,
) -> Result<Vec<FlatItem>, String> {
    let toc_items = toc_transformer(toc_content, llm)?;
    // toc_items carry `page` (logical page number from the TOC). Compute offset
    // between logical and physical page by matching a few sections in the body.
    let mut with_page: Vec<FlatItem> = toc_items
        .iter()
        .map(|i| FlatItem {
            structure: i.structure.clone(),
            title: i.title.clone(),
            physical_index: i.physical_index,
            appear_start: None,
        })
        .collect();

    // Estimate offset: extract physical index for the first few sections from
    // the body, compare with their logical page numbers.
    let body_start = 1usize; // physical pages after toc
    let body_end = (body_start + TOC_CHECK_PAGE_NUM).min(pages.len());
    let body: String = (body_start..body_end)
        .map(|i| with_page_tag(i + 1, &pages[i].0))
        .collect();
    let toc_json: String = serde_json::to_string(
        &toc_items
            .iter()
            .map(|i| {
                json!({
                    "structure": i.structure,
                    "title": i.title,
                    "physical_index": i.physical_index.map(|p| format!("<physical_index_{p}>")),
                })
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default();
    let matched = parse_flat_items(&extract_json(
        &llm.complete(&prompt_toc_index_extractor(&toc_json, &body))
            .unwrap_or_default(),
    ));
    // pairs (logical page, physical page)
    let mut diffs = Vec::new();
    for m in &matched {
        if let (Some(phys), Some(logical)) =
            (m.physical_index, logical_page_for(&toc_items, &m.title))
            && phys >= body_start
        {
            diffs.push(phys as i64 - logical as i64);
        }
    }
    let offset = most_common(&diffs).unwrap_or(0);
    for item in with_page.iter_mut() {
        if let Some(logical) = logical_page_for(&toc_items, &item.title) {
            let physical = (logical as i64 + offset).max(1) as usize;
            item.physical_index = Some(physical);
        }
    }
    // Fill any items still missing via the no-page-numbers path.
    process_none_page_numbers(&mut with_page, pages, llm);
    Ok(with_page)
}

fn logical_page_for(toc_items: &[TocTransformItem], title: &str) -> Option<usize> {
    toc_items
        .iter()
        .find(|t| t.title.trim() == title.trim())
        .and_then(|t| t.page)
}

fn most_common(diffs: &[i64]) -> Option<i64> {
    use std::collections::HashMap;
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for d in diffs {
        *counts.entry(*d).or_default() += 1;
    }
    counts.into_iter().max_by_key(|(_, c)| *c).map(|(d, _)| d)
}

struct TocTransformItem {
    structure: Option<String>,
    title: String,
    page: Option<usize>,
    physical_index: Option<usize>,
}

/// Ported from `toc_transformer` (with the continuation/finish-reason loop).
fn toc_transformer(toc_content: &str, llm: &LlmClient) -> Result<Vec<TocTransformItem>, String> {
    let (response, finish) =
        llm.complete_with_history(&prompt_toc_transformer(toc_content), &[])?;
    let mut accumulated = response;
    let mut current_finish = finish;
    let mut attempts = 0;
    while current_finish == FinishReason::Length && attempts < 5 {
        let incomplete = extract_json_text(&accumulated);
        let (more, finish) = llm.complete_with_history(
            &prompt_toc_transformer_continue(toc_content, &incomplete),
            &[],
        )?;
        accumulated.push_str(&more);
        current_finish = finish;
        attempts += 1;
    }
    let parsed = extract_json(&accumulated);
    let arr = parsed
        .get("table_of_contents")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .iter()
        .map(|item| TocTransformItem {
            structure: item
                .get("structure")
                .and_then(Value::as_str)
                .map(str::to_string),
            title: item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            page: item.get("page").and_then(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .or_else(|| convert_physical_index_to_int(v))
            }),
            physical_index: None,
        })
        .collect())
}

fn process_none_page_numbers(items: &mut [FlatItem], pages: &[(String, usize)], llm: &LlmClient) {
    for i in 0..items.len() {
        if items[i].physical_index.is_some() {
            continue;
        }
        let prev = (0..i)
            .rev()
            .find_map(|j| items[j].physical_index)
            .unwrap_or(1);
        let next = (i + 1..items.len())
            .find_map(|j| items[j].physical_index)
            .unwrap_or(pages.len());
        let content: String = (prev..=next)
            .filter_map(|p| {
                if p >= 1 && p <= pages.len() {
                    Some(with_page_tag(p, &pages[p - 1].0))
                } else {
                    None
                }
            })
            .collect();
        let item_json = json!({
            "structure": items[i].structure,
            "title": items[i].title,
        });
        let result = extract_json(
            &llm.complete(&prompt_add_page_number_to_toc(
                &content,
                &item_json.to_string(),
            ))
            .unwrap_or_default(),
        );
        if let Some(arr) = result.as_array()
            && let Some(first) = arr.first()
            && let Some(idx) = first
                .get("physical_index")
                .and_then(convert_physical_index_to_int)
        {
            items[i].physical_index = Some(idx);
        }
    }
}

/// Ported from `verify_toc` / `check_title_appearance`. Returns (accuracy,
/// incorrect items with their list index).
fn verify_toc(
    pages: &[(String, usize)],
    items: &[FlatItem],
    llm: &LlmClient,
) -> (f64, Vec<(usize, FlatItem)>) {
    // Sample all items (PageIndex default N=None checks all).
    let to_check: Vec<(usize, &FlatItem)> = items
        .iter()
        .enumerate()
        .filter(|(_, i)| i.physical_index.is_some())
        .collect();
    if to_check.is_empty() {
        return (0.0, Vec::new());
    }
    let results: Vec<(usize, bool)> = std::thread::scope(|scope| {
        let handles: Vec<_> = to_check
            .iter()
            .map(|(idx, item)| {
                let page = item.physical_index.unwrap();
                let page_text = if page >= 1 && page <= pages.len() {
                    pages[page - 1].0.as_str()
                } else {
                    ""
                };
                let title = item.title.clone();
                scope.spawn(move || {
                    let resp = llm
                        .complete(&prompt_check_title_appearance(&title, page_text))
                        .unwrap_or_default();
                    let yes = extract_json(&resp)
                        .get("answer")
                        .and_then(Value::as_str)
                        .map(|s| s == "yes")
                        .unwrap_or(false);
                    (*idx, yes)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or((0, false)))
            .collect()
    });
    let correct = results.iter().filter(|(_, y)| *y).count();
    let incorrect: Vec<(usize, FlatItem)> = results
        .iter()
        .filter(|(_, y)| !*y)
        .filter_map(|(idx, _)| items.get(*idx).map(|i| (*idx, i.clone())))
        .collect();
    let accuracy = correct as f64 / results.len() as f64;
    (accuracy, incorrect)
}

fn check_title_appearance_in_start(
    items: &mut [FlatItem],
    pages: &[(String, usize)],
    llm: &LlmClient,
) {
    // Mark items whose physical_index page starts with the section title.
    let updates: Vec<(usize, bool)> = std::thread::scope(|scope| {
        let handles: Vec<_> = items
            .iter()
            .enumerate()
            .filter(|(_, i)| i.physical_index.is_some())
            .map(|(idx, item)| {
                let page = item.physical_index.unwrap();
                let page_text = if page >= 1 && page <= pages.len() {
                    pages[page - 1].0.as_str()
                } else {
                    ""
                };
                let title = item.title.clone();
                scope.spawn(move || {
                    if page_text.is_empty() {
                        return (idx, false);
                    }
                    let resp = llm
                        .complete(&prompt_check_title_in_start(&title, page_text))
                        .unwrap_or_default();
                    let yes = extract_json(&resp)
                        .get("start_begin")
                        .and_then(Value::as_str)
                        .map(|s| s == "yes")
                        .unwrap_or(false);
                    (idx, yes)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or((0, false)))
            .collect()
    });
    for (idx, yes) in updates {
        if yes {
            items[idx].appear_start = Some("yes".to_string());
        }
    }
}

fn fix_incorrect_toc_with_retries(
    pages: &[(String, usize)],
    items: &[FlatItem],
    incorrect: &[(usize, FlatItem)],
    llm: &LlmClient,
) -> (Vec<FlatItem>, Vec<(usize, FlatItem)>) {
    let mut current: Vec<FlatItem> = items.to_vec();
    let mut current_incorrect: Vec<(usize, FlatItem)> = incorrect.to_vec();
    for _ in 0..3 {
        if current_incorrect.is_empty() {
            break;
        }
        let (fixed, remaining) = fix_incorrect_toc(pages, &current, &current_incorrect, llm);
        current = fixed;
        current_incorrect = remaining;
    }
    (current, current_incorrect)
}

fn fix_incorrect_toc(
    pages: &[(String, usize)],
    items: &[FlatItem],
    incorrect: &[(usize, FlatItem)],
    llm: &LlmClient,
) -> (Vec<FlatItem>, Vec<(usize, FlatItem)>) {
    let incorrect_set: std::collections::HashSet<usize> =
        incorrect.iter().map(|(i, _)| *i).collect();
    let end = pages.len();

    let fixes: Vec<(usize, Option<usize>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = incorrect
            .iter()
            .map(|(idx, item)| {
                let prev = (0..*idx)
                    .rev()
                    .find(|j| !incorrect_set.contains(j))
                    .and_then(|j| items[j].physical_index)
                    .unwrap_or(1);
                let next = (*idx + 1..items.len())
                    .find(|j| !incorrect_set.contains(j))
                    .and_then(|j| items[j].physical_index)
                    .unwrap_or(end);
                let title = item.title.clone();
                let content: String = (prev..=next)
                    .filter_map(|p| {
                        if p >= 1 && p <= pages.len() {
                            Some(with_page_tag(p, &pages[p - 1].0))
                        } else {
                            None
                        }
                    })
                    .collect();
                let idx = *idx;
                scope.spawn(move || {
                    let resp = llm
                        .complete(&prompt_single_toc_item_index_fixer(&title, &content))
                        .unwrap_or_default();
                    let new_idx = extract_json(&resp)
                        .get("physical_index")
                        .and_then(convert_physical_index_to_int);
                    (idx, new_idx)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or((0, None)))
            .collect()
    });

    let mut out = items.to_vec();
    let mut still_incorrect = Vec::new();
    for (idx, new_idx) in fixes {
        if let Some(p) = new_idx {
            out[idx].physical_index = Some(p);
        } else {
            still_incorrect.push((idx, out[idx].clone()));
        }
    }
    (out, still_incorrect)
}

/// Ported from `process_large_node_recursively`: split nodes whose page/token
/// span exceeds the thresholds by re-running the no-TOC builder on the slice.
fn process_large_nodes(
    tree: &mut [Value],
    pages: &[(String, usize)],
    llm: &LlmClient,
) -> Result<(), String> {
    for node in tree.iter_mut() {
        process_large_node_recursive(node, pages, llm)?;
    }
    Ok(())
}

fn process_large_node_recursive(
    node: &mut Value,
    pages: &[(String, usize)],
    llm: &LlmClient,
) -> Result<(), String> {
    let start = node
        .get("start_index")
        .and_then(Value::as_u64)
        .map(|n| n as usize);
    let end = node
        .get("end_index")
        .and_then(Value::as_u64)
        .map(|n| n as usize);
    if let (Some(s), Some(e)) = (start, end) {
        let node_pages = if s >= 1 && e <= pages.len() {
            &pages[s - 1..e]
        } else {
            &[][..]
        };
        let token_num: usize = node_pages.iter().map(|(_, t)| *t).sum();
        let page_span = e.saturating_sub(s);
        if page_span > MAX_PAGES_PER_NODE
            && token_num >= MAX_TOKENS_PER_NODE
            && !node_pages.is_empty()
        {
            // Re-run no-TOC builder on the slice.
            let sub = process_no_toc(node_pages, llm)?;
            let sub_items: Vec<FlatItem> = sub
                .into_iter()
                .filter(|i| i.physical_index.is_some())
                .collect();
            let mut sub_items = sub_items;
            check_title_appearance_in_start(&mut sub_items, pages, llm);
            let abs_start = s;
            // Adjust physical indices from slice-relative to absolute.
            for it in sub_items.iter_mut() {
                if let Some(p) = it.physical_index {
                    it.physical_index = Some(abs_start + p - 1);
                }
            }
            // If the first sub-item title equals this node's title, drop it (it
            // is the node itself) and use the rest as children.
            let node_title = node
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let (children_items, new_end) = if let Some(first) = sub_items.first() {
                if first.title.trim() == node_title {
                    (
                        sub_items[1..].to_vec(),
                        sub_items.get(1).and_then(|i| i.physical_index).unwrap_or(e),
                    )
                } else {
                    (
                        sub_items.clone(),
                        sub_items
                            .first()
                            .and_then(|i| i.physical_index)
                            .unwrap_or(e),
                    )
                }
            } else {
                (Vec::new(), e)
            };
            let children = build_nested_tree(&children_items, e);
            if let Some(obj) = node.as_object_mut() {
                obj.insert("nodes".to_string(), json!(children));
                obj.insert("end_index".to_string(), json!(new_end));
            }
        }
    }
    if let Some(kids) = node.get_mut("nodes").and_then(Value::as_array_mut) {
        for kid in kids.iter_mut() {
            process_large_node_recursive(kid, pages, llm)?;
        }
    }
    Ok(())
}

fn generate_summaries(tree: &mut [Value], llm: &LlmClient) {
    let nodes = flatten_nodes(tree);
    let summaries: Vec<Option<String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = nodes
            .iter()
            .map(|node| {
                let text = node
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                scope.spawn(move || {
                    if text.trim().is_empty() {
                        return None;
                    }
                    Some(
                        llm.complete(&prompt_node_summary(&text))
                            .unwrap_or_default(),
                    )
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().ok().flatten())
            .collect()
    });
    // Write summaries back by walking in the same flattened order.
    let mut idx = 0;
    write_summaries(tree, &summaries, &mut idx);
}

fn write_summaries(nodes: &mut [Value], summaries: &[Option<String>], idx: &mut usize) {
    for node in nodes.iter_mut() {
        if let Some(Some(s)) = summaries.get(*idx)
            && let Some(obj) = node.as_object_mut()
        {
            obj.insert("summary".to_string(), json!(s));
        }
        *idx += 1;
        if let Some(kids) = node.get_mut("nodes").and_then(Value::as_array_mut) {
            write_summaries(kids, summaries, idx);
        }
    }
}

fn generate_doc_description(tree: &[Value], llm: &LlmClient) -> String {
    // Build a clean structure (title + node_id + summary + nodes) for the prompt.
    fn clean(nodes: &[Value]) -> Value {
        Value::Array(
            nodes
                .iter()
                .map(|n| {
                    let mut obj = serde_json::Map::new();
                    if let Some(t) = n.get("title") {
                        obj.insert("title".to_string(), t.clone());
                    }
                    if let Some(id) = n.get("node_id") {
                        obj.insert("node_id".to_string(), id.clone());
                    }
                    if let Some(s) = n.get("summary") {
                        obj.insert("summary".to_string(), s.clone());
                    }
                    if let Some(kids) = n.get("nodes").and_then(Value::as_array)
                        && !kids.is_empty()
                    {
                        obj.insert("nodes".to_string(), clean(kids));
                    }
                    Value::Object(obj)
                })
                .collect(),
        )
    }
    let structure = clean(tree);
    llm.complete(&prompt_doc_description(&structure.to_string()))
        .unwrap_or_default()
        .trim()
        .to_string()
}

// === markdown tree (ported from page_index_md.py) =========================

fn build_md_tree(md_text: &str, llm: &LlmClient) -> Result<(Vec<Value>, String), String> {
    let nodes = extract_md_nodes(md_text);
    let mut tree = build_md_tree_from_nodes(&nodes);
    write_node_id(&mut tree, &mut 0);
    add_md_node_text(&mut tree, &nodes, md_text);
    generate_summaries(&mut tree, llm);
    // Keep node `text` (see PDF path comment).
    let desc = generate_doc_description(&tree, llm);
    Ok((tree, desc))
}

struct MdNode {
    level: usize,
    title: String,
    line_num: usize,
}

fn extract_md_nodes(md_text: &str) -> Vec<MdNode> {
    let mut nodes = Vec::new();
    let mut in_code = false;
    for (i, line) in md_text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('#') {
            let level = rest.chars().take_while(|c| *c == '#').count() + 1;
            let title = rest[level - 1..].trim().to_string();
            if !title.is_empty() {
                nodes.push(MdNode {
                    level,
                    title,
                    line_num: i + 1,
                });
            }
        }
    }
    nodes
}

fn build_md_tree_from_nodes(nodes: &[MdNode]) -> Vec<Value> {
    let mut roots: Vec<Value> = Vec::new();
    let mut stack: Vec<(usize, Value)> = Vec::new();
    let mut counter = 0usize;
    for node in nodes {
        counter += 1;
        let tree_node = json!({
            "title": node.title,
            "node_id": format!("{:04}", counter),
            "text": "",
            "line_num": node.line_num,
            "nodes": [],
        });
        while let Some((top_level, _)) = stack.last() {
            if *top_level >= node.level {
                stack.pop();
            } else {
                break;
            }
        }
        if let Some((_, parent)) = stack.last_mut() {
            parent["nodes"]
                .as_array_mut()
                .unwrap()
                .push(tree_node.clone());
        } else {
            roots.push(tree_node.clone());
        }
        stack.push((node.level, tree_node));
    }
    // clean empty nodes
    fn clean(nodes: &mut [Value]) {
        for n in nodes.iter_mut() {
            if let Some(arr) = n.get_mut("nodes").and_then(Value::as_array_mut) {
                clean(arr);
                if arr.is_empty()
                    && let Some(obj) = n.as_object_mut()
                {
                    obj.remove("nodes");
                }
            }
        }
    }
    clean(&mut roots);
    roots
}

fn add_md_node_text(nodes: &mut [Value], md_nodes: &[MdNode], md_text: &str) {
    let lines: Vec<&str> = md_text.lines().collect();
    let line_count = lines.len();
    let flat: Vec<(usize, usize)> = md_nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let end = if i + 1 < md_nodes.len() {
                md_nodes[i + 1].line_num - 1
            } else {
                line_count
            };
            (n.line_num, end)
        })
        .collect();
    let mut idx = 0;
    fill_md_text(nodes, &flat, &lines, &mut idx);
}

fn fill_md_text(nodes: &mut [Value], spans: &[(usize, usize)], lines: &[&str], idx: &mut usize) {
    for node in nodes.iter_mut() {
        if let Some(&(start, end)) = spans.get(*idx) {
            let s = start.saturating_sub(1).min(lines.len());
            let e = end.min(lines.len());
            let text: String = lines[s..e].join("\n");
            if let Some(obj) = node.as_object_mut() {
                obj.insert("text".to_string(), json!(text));
            }
        }
        *idx += 1;
        if let Some(kids) = node.get_mut("nodes").and_then(Value::as_array_mut) {
            fill_md_text(kids, spans, lines, idx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_handles_fences_and_none() {
        let v = extract_json("```json\n{\"a\": None, \"b\": 1}\n```");
        assert_eq!(v["a"], Value::Null);
        assert_eq!(v["b"], json!(1));
    }

    #[test]
    fn extract_json_handles_trailing_commas() {
        let v = extract_json("{\"a\": 1, \"b\": 2,}");
        assert_eq!(v["a"], json!(1));
        assert_eq!(v["b"], json!(2));
    }

    #[test]
    fn split_form_feeds_separates_pages() {
        let bytes = "page one\u{000C}page two\u{000C}page three".as_bytes();
        let pages = split_form_feeds(bytes);
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].0, "page one");
        assert_eq!(pages[1].0, "page two");
    }

    #[test]
    fn transform_dots_to_colon_replaces_long_runs() {
        assert_eq!(transform_dots_to_colon("Title.....5"), "Title: 5");
        let dotted = "Title. . . . . . end";
        assert_eq!(transform_dots_to_colon(dotted), "Title: end");
        assert_eq!(transform_dots_to_colon("no dots here"), "no dots here");
    }

    #[test]
    fn page_list_to_group_text_merges_small() {
        let contents = vec!["a".to_string(), "b".to_string()];
        let tokens = vec![10, 20];
        let groups = page_list_to_group_text(&contents, &tokens, 100, 1);
        assert_eq!(groups, vec!["ab".to_string()]);
    }

    #[test]
    fn page_list_to_group_text_splits_large() {
        let contents = vec!["aaaa".to_string(), "bbbb".to_string(), "cccc".to_string()];
        let tokens = vec![100, 100, 100];
        let groups = page_list_to_group_text(&contents, &tokens, 150, 1);
        assert!(groups.len() >= 2);
    }

    #[test]
    fn build_nested_tree_builds_hierarchy() {
        let items = vec![
            FlatItem {
                structure: Some("1".into()),
                title: "A".into(),
                physical_index: Some(1),
                appear_start: None,
            },
            FlatItem {
                structure: Some("1.1".into()),
                title: "A1".into(),
                physical_index: Some(2),
                appear_start: Some("yes".into()),
            },
            FlatItem {
                structure: Some("2".into()),
                title: "B".into(),
                physical_index: Some(3),
                appear_start: Some("yes".into()),
            },
        ];
        let tree = build_nested_tree(&items, 3);
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0]["title"], json!("A"));
        assert_eq!(tree[0]["nodes"][0]["title"], json!("A1"));
        assert_eq!(tree[0]["end_index"], json!(1));
        assert_eq!(tree[1]["end_index"], json!(3));
    }

    #[test]
    fn add_preface_inserts_when_first_page_not_one() {
        let mut items = vec![FlatItem {
            structure: Some("1".into()),
            title: "A".into(),
            physical_index: Some(3),
            appear_start: None,
        }];
        add_preface_if_needed(&mut items);
        assert_eq!(items[0].title, "Preface");
        assert_eq!(items[0].physical_index, Some(1));
    }

    #[test]
    fn extract_md_nodes_skips_code_blocks() {
        let md = "# Title\n\n```\n# not a header\n```\n\n## Real\n";
        let nodes = extract_md_nodes(md);
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].title, "Title");
        assert_eq!(nodes[1].title, "Real");
        assert_eq!(nodes[1].level, 2);
    }

    #[test]
    fn resolve_llm_config_requires_model_and_key() {
        unsafe {
            std::env::remove_var("EMB_AGENT_PAGEINDEX_MODEL");
            std::env::remove_var("EMB_AGENT_PAGEINDEX_API_KEY");
            std::env::remove_var("OPENAI_API_KEY");
            std::env::remove_var("CHATGPT_API_KEY");
        }
        assert!(resolve_llm_config(None, None, None).is_err());
        let (base, _key, model) =
            resolve_llm_config(Some("gpt-4o"), Some("http://x/v1"), Some("sk-x")).unwrap();
        assert_eq!(base, "http://x/v1");
        assert_eq!(model, "gpt-4o");
    }

    #[test]
    fn convert_physical_index_parses_tagged() {
        assert_eq!(
            convert_physical_index_to_int(&json!("<physical_index_5>")),
            Some(5)
        );
        assert_eq!(
            convert_physical_index_to_int(&json!("physical_index_7")),
            Some(7)
        );
        assert_eq!(convert_physical_index_to_int(&json!("nope")), None);
    }
}
