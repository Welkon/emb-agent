use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn emb_agent_bin() -> PathBuf {
    std::env::var_os("CARGO_BIN_EXE_emb-agent-rs")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let mut exe = std::env::current_exe().expect("current exe");
            exe.pop();
            if exe.ends_with("deps") {
                exe.pop();
            }
            exe.push(format!("emb-agent-rs{}", std::env::consts::EXE_SUFFIX));
            exe
        })
}

fn write_install_runtime_version(root: &Path, raw: impl AsRef<[u8]>) {
    let install_dir = root.join(".emb-agent").join(".install");
    fs::create_dir_all(&install_dir).expect("create install state dir");
    fs::write(install_dir.join("runtime-version.json"), raw).expect("write runtime version");
}

struct TestProject {
    root: PathBuf,
}

impl TestProject {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("emb-agent-{name}-{nonce}"));
        fs::create_dir_all(&root).expect("create test root");
        let project = Self { root };
        project.init();
        project.write_task_fixtures();
        project.write_schematic_fixture();
        project
    }

    fn path(&self) -> &Path {
        &self.root
    }

    fn init(&self) {
        assert_success(
            Command::new(emb_agent_bin())
                .arg("init")
                .arg("--cwd")
                .arg(&self.root)
                .output()
                .expect("run init"),
        );
    }

    fn write_task_fixtures(&self) {
        for (name, title, priority) in [
            ("pwm-led", "Implement PWM dimming", "P1"),
            ("schematic-review", "Review schematic risks", "P2"),
        ] {
            let dir = self.root.join(".emb-agent").join("tasks").join(name);
            fs::create_dir_all(&dir).expect("create task fixture");
            fs::write(
                dir.join("task.json"),
                format!(
                    r#"{{"name":"{name}","title":"{title}","status":"pending","priority":"{priority}","package":""}}"#
                ),
            )
            .expect("write task fixture");
        }
    }

    fn init_git_repo(&self) {
        for args in [
            vec!["init"],
            vec!["config", "user.email", "emb-agent@example.invalid"],
            vec!["config", "user.name", "emb-agent test"],
            vec!["add", "."],
            vec!["commit", "-m", "initial"],
        ] {
            let output = Command::new("git")
                .args(args)
                .current_dir(&self.root)
                .output()
                .expect("run git");
            assert_success(output);
        }
    }

    fn write_session_heartbeat(&self, session_id: &str, task: &str) {
        let sessions = self.root.join(".emb-agent").join("sessions");
        fs::create_dir_all(&sessions).expect("create sessions dir");
        let updated_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        fs::write(
            sessions.join(format!("{session_id}.json")),
            format!(
                r#"{{"session_id":"{session_id}","host":"pi","cwd":"{cwd}","repo_root":"{cwd}","workspace_kind":"main","branch":"master","task":"{task}","pid":999999,"updated_at_ms":{updated_at_ms}}}"#,
                cwd = self.root.to_string_lossy()
            ),
        )
        .expect("write session heartbeat");
    }

    fn write_schematic_fixture(&self) {
        let cache = self
            .root
            .join(".emb-agent")
            .join("cache")
            .join("schematics")
            .join("fixture");
        fs::create_dir_all(&cache).expect("create schematic cache");
        fs::write(
            cache.join("parsed.json"),
            r#"{
              "parser_mode": "fixture",
              "components": [
                {
                  "designator": "U1",
                  "value": "MCU",
                  "comment": "main controller",
                  "libref": "MCU",
                  "pins": [{"number":"1","name":"PWM","net":"PWM_OUT"}]
                },
                {
                  "designator": "R1",
                  "value": "1k",
                  "comment": "series resistor",
                  "libref": "RES",
                  "pins": [{"number":"1","name":"A","net":"PWM_OUT"}]
                }
              ],
              "nets": [
                {"name":"PWM_OUT","members":["U1.1","R1.1"],"confidence":"fixture","evidence":[]}
              ],
              "bom": [
                {"designators":["U1"],"quantity":1,"value":"MCU","comment":"main controller","libref":"MCU"}
              ],
              "objects": [{"RECORD":"fixture"}],
              "raw_summary": {"fixture": true}
            }"#,
        )
        .expect("write parsed fixture");
        fs::write(
            cache.join("source.json"),
            r#"{"source_path":"docs/fixture.SchDoc","parser_mode":"fixture"}"#,
        )
        .expect("write schematic source fixture");
    }
}

impl Drop for TestProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn init_records_bootstrap_validation_and_aar() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-init-aar-{nonce}"));
    fs::create_dir_all(&root).expect("create init root");

    let output = Command::new(emb_agent_bin())
        .arg("init")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run init");
    let stdout = assert_success(output);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("init json");
    assert_eq!(
        value["truth_validation"]["status"], "ok",
        "init output: {stdout}"
    );

    let task_json = fs::read_to_string(
        root.join(".emb-agent")
            .join("tasks")
            .join("00-bootstrap-project")
            .join("task.json"),
    )
    .expect("read bootstrap task");
    let task: serde_json::Value = serde_json::from_str(&task_json).expect("bootstrap task json");
    assert_eq!(task["status"], "completed", "bootstrap task: {task_json}");
    assert_eq!(
        task["aar"]["scan_completed"], true,
        "bootstrap task: {task_json}"
    );
    assert_eq!(
        task["aar"]["record_completed"], true,
        "bootstrap task: {task_json}"
    );
    assert_eq!(
        task["context"]["check"][0]["command"], "validate",
        "bootstrap task: {task_json}"
    );
    assert!(
        root.join(".emb-agent")
            .join("tasks")
            .join("00-bootstrap-project")
            .join("aar.md")
            .exists(),
        "bootstrap AAR missing"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn init_uses_backend_neutral_event_step_framework_defaults() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-init-framework-{nonce}"));
    fs::create_dir_all(&root).expect("create init root");

    let output = Command::new(emb_agent_bin())
        .arg("init")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run init");
    let stdout = assert_success(output);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("init json");
    assert_eq!(value["status"], "ok", "init output: {stdout}");

    let project_json_path = root.join(".emb-agent/project.json");
    let raw = fs::read_to_string(&project_json_path).expect("read project json");
    let project_json: serde_json::Value = serde_json::from_str(&raw).expect("project json");
    let framework = &project_json["firmware_framework"];
    assert_eq!(
        framework["official_mode"], "event-step",
        "project json: {raw}"
    );
    assert_eq!(
        framework["control_contract"], "sample-update-apply",
        "project json: {raw}"
    );
    assert_eq!(
        framework["execution_backend"], "project-selects-baremetal-or-rtos",
        "project json: {raw}"
    );
    assert!(
        framework.get("tick_base_hz").is_none(),
        "project json must not emit legacy tick_base_hz: {raw}"
    );
    assert!(
        framework.get("scheduler_shape").is_none(),
        "project json must not emit legacy scheduler_shape: {raw}"
    );

    assert_eq!(project_json["default_package"], "firmware");
    assert_eq!(project_json["active_package"], "firmware");
    assert_eq!(project_json["packages"][0]["path"], "firmware");
    assert_eq!(project_json["packages"][0]["type"], "firmware");
    assert!(root.join("firmware/src").is_dir());
    assert!(root.join("firmware/include").is_dir());

    let system_prd = fs::read_to_string(root.join("docs/prd/system.md")).expect("read system prd");
    assert!(
        system_prd.contains("Official framework: event-step"),
        "system PRD: {system_prd}"
    );
    assert!(
        system_prd.contains("bare-metal base tick or an RTOS task/timer"),
        "system PRD: {system_prd}"
    );

    let _ = fs::remove_dir_all(root);
}

fn assert_success(output: Output) -> String {
    if !output.status.success() {
        panic!(
            "command failed\nstatus: {:?}\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8(output.stdout).expect("stdout utf8")
}

fn run(project: &TestProject, args: &[&str]) -> String {
    let output = Command::new(emb_agent_bin())
        .args(args)
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run emb-agent-rs");
    assert_success(output)
}

fn run_with_env(project: &TestProject, args: &[&str], envs: &[(&str, &str)]) -> String {
    let mut command = Command::new(emb_agent_bin());
    command.args(args).arg("--cwd").arg(project.path());
    for key in [
        "EMB_AGENT_SESSION_ID",
        "PI_SESSION_ID",
        "CODEX_SESSION_ID",
        "CLAUDE_SESSION_ID",
    ] {
        command.env_remove(key);
    }
    for (key, value) in envs {
        command.env(key, value);
    }
    let output = command.output().expect("run emb-agent-rs with env");
    assert_success(output)
}

fn run_with_stdin(args: &[&str], stdin: &str) -> String {
    let mut child = Command::new(emb_agent_bin())
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn emb-agent-rs");
    child
        .stdin
        .as_mut()
        .expect("child stdin")
        .write_all(stdin.as_bytes())
        .expect("write hook stdin");
    let output = child.wait_with_output().expect("wait emb-agent-rs");
    assert_success(output)
}

#[test]
fn firmware_resource_evidence_and_release_handoff_smoke() {
    let project = TestProject::new("firmware-evidence");
    let report_path = project.path().join("build-summary.txt");
    fs::write(
        &report_path,
        "Program Memory Usage : 1630 bytes / 2048 bytes\nData Memory Usage : 88 / 128 bytes\nwarning: stack depth unknown\n",
    )
    .expect("write resource report");

    let resource = run(
        &project,
        &[
            "firmware",
            "resource",
            "analyze",
            "--file",
            "build-summary.txt",
        ],
    );
    let resource_json: serde_json::Value = serde_json::from_str(&resource).expect("resource json");
    assert_eq!(resource_json["status"], "ok");
    assert_eq!(
        resource_json["resource_summary"]["program_rom"]["used_bytes"],
        1630
    );
    assert_eq!(
        resource_json["resource_summary"]["data_ram"]["total_bytes"],
        128
    );
    assert!(
        project
            .path()
            .join(".emb-agent/reports/firmware/resource-summary.json")
            .is_file()
    );

    let evidence = run(
        &project,
        &[
            "firmware",
            "evidence",
            "add",
            "--kind",
            "pwm",
            "--result",
            "ok",
            "--expected",
            "16kHz",
            "--measured",
            "15.98kHz",
            "--path",
            "captures/pwm.csv",
            "--notes",
            "scope capture",
        ],
    );
    let evidence_json: serde_json::Value = serde_json::from_str(&evidence).expect("evidence json");
    assert_eq!(evidence_json["status"], "ok");
    assert_eq!(evidence_json["evidence"]["result"], "PASS");
    assert!(
        project
            .path()
            .join(".emb-agent/reports/firmware/board-evidence.jsonl")
            .is_file()
    );

    let release = run(
        &project,
        &["firmware", "release", "draft", "--version", "v1.2.3"],
    );
    let release_json: serde_json::Value = serde_json::from_str(&release).expect("release json");
    assert_eq!(release_json["status"], "ok");
    assert_eq!(release_json["release_handoff"]["board_evidence_count"], 1);
    let handoff = fs::read_to_string(
        project
            .path()
            .join(".emb-agent/reports/firmware/release-handoff.md"),
    )
    .expect("read handoff");
    assert!(handoff.contains("Firmware Release Handoff"));
    assert!(handoff.contains("Board evidence entries: 1"));
}

#[test]
fn hook_session_start_reads_multiline_stdin_cwd() {
    let project = TestProject::new("hook-session-stdin");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"SessionStart\",\n  \"cwd\": \"{}\",\n  \"source\": \"startup\"\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "session-start", "--host", "codex"], &payload);
    assert!(
        output.contains("hookSpecificOutput"),
        "hook output: {output}"
    );
    assert!(
        output.contains(&project.path().to_string_lossy().to_string()),
        "hook must use cwd from full JSON stdin: {output}"
    );
}

#[test]
fn cursor_session_start_reads_multiline_stdin_and_uses_cursor_shape() {
    let project = TestProject::new("hook-session-cursor-stdin");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"sessionStart\",\n  \"cwd\": \"{}\",\n  \"source\": \"startup\"\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "session-start", "--host", "cursor"], &payload);
    assert!(
        output.contains("additional_context"),
        "hook output: {output}"
    );
    assert!(
        !output.contains("hookSpecificOutput"),
        "hook output: {output}"
    );
    assert!(
        output.contains(&project.path().to_string_lossy().to_string()),
        "hook must use cwd from full JSON stdin: {output}"
    );
}

#[test]
fn compact_session_start_uses_delta_context_without_welcome_duplication() {
    let project = TestProject::new("compact-session-start");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"SessionStart\",\n  \"cwd\": \"{}\",\n  \"source\": \"compact\"\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "session-start", "--host", "codex"], &payload);
    assert!(
        output.contains("re-entry context refreshed after compact"),
        "hook output: {output}"
    );
    assert!(
        !output.contains("What you can do next"),
        "hook output: {output}"
    );
}

#[test]
fn context_monitor_reads_multiline_stdin_and_uses_cursor_shape() {
    let project = TestProject::new("hook-context-stdin");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"postToolUse\",\n  \"cwd\": \"{}\",\n  \"context_window\": {{ \"remaining_percentage\": 18 }}\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "context-monitor", "--host", "cursor"], &payload);
    assert!(
        output.contains("additional_context"),
        "hook output: {output}"
    );
    assert!(
        !output.contains("hookSpecificOutput"),
        "hook output: {output}"
    );
    assert!(
        output.contains("EMB CONTEXT CRITICAL"),
        "hook output: {output}"
    );
}

#[test]
fn codex_tool_guard_blocks_source_read_before_knowledge_search() {
    let project = TestProject::new("codex-tool-guard-source");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Read\",\n  \"tool_input\": {{ \"path\": \"firmware/src/main.c\" }}\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "tool-guard", "--host", "codex"], &payload);
    assert!(
        output.contains("\"decision\":\"block\""),
        "hook output: {output}"
    );
    assert!(output.contains("knowledge search"), "hook output: {output}");
}

#[test]
fn codex_tool_guard_records_knowledge_search_attempt_and_allows_source_read() {
    let project = TestProject::new("codex-tool-guard-knowledge");
    let knowledge_payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Bash\",\n  \"tool_input\": {{ \"command\": \"node .codex/emb-agent/bin/emb-agent.cjs knowledge search --query timer --rerank\" }}\n}}\n",
        project.path().to_string_lossy()
    );
    let output = run_with_stdin(
        &["hook", "tool-guard", "--host", "codex"],
        &knowledge_payload,
    );
    assert_eq!(output, "");

    let state = fs::read_to_string(
        project
            .path()
            .join(".emb-agent")
            .join("sessions")
            .join("tool-guard-state.json"),
    )
    .expect("read tool guard state");
    assert!(state.contains("knowledge_primed_at_ms"), "state: {state}");
    assert!(state.contains("timer"), "state: {state}");

    let read_payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Read\",\n  \"tool_input\": {{ \"path\": \"firmware/src/main.c\" }}\n}}\n",
        project.path().to_string_lossy()
    );
    let output = run_with_stdin(&["hook", "tool-guard", "--host", "codex"], &read_payload);
    assert_eq!(output, "");
}

#[test]
fn codex_tool_guard_blocks_raw_schematic_shell_reads() {
    let project = TestProject::new("codex-tool-guard-schematic");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Bash\",\n  \"tool_input\": {{ \"command\": \"strings docs/board.SchDoc\" }}\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "tool-guard", "--host", "codex"], &payload);
    assert!(
        output.contains("\"decision\":\"block\""),
        "hook output: {output}"
    );
    assert!(output.contains("schematic"), "hook output: {output}");
}

#[test]
fn codex_tool_guard_blocks_unbounded_root_search() {
    let project = TestProject::new("codex-tool-guard-root");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Bash\",\n  \"tool_input\": {{ \"command\": \"find / -name '*.c'\" }}\n}}\n",
        project.path().to_string_lossy()
    );

    let output = run_with_stdin(&["hook", "tool-guard", "--host", "codex"], &payload);
    assert!(
        output.contains("\"decision\":\"block\""),
        "hook output: {output}"
    );
    assert!(output.contains("filesystem root"), "hook output: {output}");
}

#[test]
fn runtime_wrapper_forwards_hook_stdin_without_hanging() {
    let project = TestProject::new("runtime-wrapper-hook-stdin");
    let payload = format!(
        "{{\n  \"hook_event_name\": \"PreToolUse\",\n  \"cwd\": \"{}\",\n  \"tool_name\": \"Read\",\n  \"tool_input\": {{ \"path\": \"firmware/src/main.c\" }}\n}}\n",
        project.path().to_string_lossy()
    );
    let mut child = Command::new("node")
        .arg(
            repo_root()
                .join("runtime")
                .join("bin")
                .join("emb-agent.cjs"),
        )
        .arg("hook")
        .arg("tool-guard")
        .arg("--host")
        .arg("codex")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn runtime wrapper hook");
    child
        .stdin
        .as_mut()
        .expect("child stdin")
        .write_all(payload.as_bytes())
        .expect("write runtime wrapper hook stdin");
    let output = child.wait_with_output().expect("wait runtime wrapper hook");
    let stdout = assert_success(output);
    assert!(
        stdout.contains("\"decision\":\"block\""),
        "wrapper hook output: {stdout}"
    );
    assert!(
        stdout.contains("knowledge search"),
        "wrapper hook output: {stdout}"
    );
}

#[test]
fn help_shows_default_user_flow() {
    let output = Command::new(emb_agent_bin())
        .arg("help")
        .output()
        .expect("run help");
    let stdout = assert_success(output);

    assert!(
        stdout.contains("emb-agent default user flow"),
        "help output: {stdout}"
    );
    assert!(stdout.contains("/emb-start"), "help output: {stdout}");
    assert!(stdout.contains("/emb-next"), "help output: {stdout}");
    assert!(stdout.contains("/emb-finish-work"), "help output: {stdout}");
    assert!(stdout.contains("/hooks"), "help output: {stdout}");
    assert!(
        stdout.contains("diagnostics hooks"),
        "help output: {stdout}"
    );
    assert!(
        !stdout.contains("firmware resource analyze"),
        "help should not expose internal firmware evidence commands: {stdout}"
    );
    assert!(
        !stdout.contains("firmware evidence add"),
        "help should not expose internal firmware evidence commands: {stdout}"
    );
}

#[test]
fn common_user_paths_smoke() {
    let project = TestProject::new("common");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "ESP32-C3",
            "--package",
            "QFN32",
        ],
    );

    let next = run(&project, &["next", "--json"]);
    assert!(next.contains("\"status\""), "next output: {next}");
    assert!(next.contains("task_candidates"), "next output: {next}");
    assert!(next.contains("pwm-led"), "next output: {next}");
    assert!(
        next.contains("durable agent brief") && next.contains("task_candidates"),
        "next output: {next}"
    );
    assert!(!next.contains("/emb:task list"), "next output: {next}");
    let tasks = run(&project, &["task", "list"]);
    assert!(tasks.contains("tasks"), "task list output: {tasks}");

    let schematic = run(&project, &["schematic", "summary"]);
    assert!(
        schematic.contains("schematic summary") && schematic.contains("components"),
        "schematic output: {schematic}"
    );

    let memory = run(&project, &["memory", "list"]);
    assert!(memory.contains("memories"), "memory output: {memory}");

    let diagnostics = run(&project, &["diagnostics", "project", "--json"]);
    assert!(
        diagnostics.contains("initialized"),
        "diagnostics output: {diagnostics}"
    );
}

#[test]
fn doc_ingest_creates_env_example_and_blocks_until_mineru_key_exists() {
    let project = TestProject::new("doc-env");
    assert!(
        !project.path().join(".env").exists(),
        "init should not create real .env"
    );
    assert!(
        project.path().join(".env.example").exists(),
        "init should create .env.example"
    );
    let docs = project.path().join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::write(docs.join("manual.pdf"), b"%PDF-1.4\nfixture\n").expect("write pdf fixture");

    let output = Command::new(emb_agent_bin())
        .args([
            "ingest",
            "doc",
            "--file",
            "docs/manual.pdf",
            "--provider",
            "mineru",
            "--kind",
            "datasheet",
            "--to",
            "hardware",
        ])
        .arg("--cwd")
        .arg(project.path())
        .env_remove("MINERU_API_KEY")
        .output()
        .expect("run ingest doc");
    let ingest = assert_success(output);
    let value: serde_json::Value = serde_json::from_str(&ingest).expect("ingest json");
    assert_eq!(
        value["status"], "needs_credentials",
        "ingest output: {ingest}"
    );
    assert_eq!(
        value["env"]["required_key"], "MINERU_API_KEY",
        "ingest output: {ingest}"
    );
    assert_eq!(
        value["local_pdf_tool_priority"][0], "markitdown",
        "ingest output: {ingest}"
    );
    assert!(
        fs::read_to_string(project.path().join(".gitignore"))
            .expect("read gitignore")
            .lines()
            .any(|line| line.trim() == ".env"),
        ".env must be gitignored"
    );

    let fetch = Command::new(emb_agent_bin())
        .args(["doc", "fetch", "--path", "docs/manual.pdf"])
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run doc fetch");
    assert!(
        !fetch.status.success(),
        "fetching an unparsed PDF must not pretend UTF-8 text"
    );
    let stderr = String::from_utf8_lossy(&fetch.stderr);
    assert!(
        stderr.contains("binary") && stderr.contains("ingest doc"),
        "doc fetch stderr: {stderr}"
    );

    let schematic_fetch = Command::new(emb_agent_bin())
        .args(["doc", "fetch", "--path", "docs/fixture.SchDoc"])
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run schematic doc fetch");
    let schematic_fetch = assert_success(schematic_fetch);
    assert!(
        schematic_fetch.contains("parser_mode") && schematic_fetch.contains("fixture"),
        "schematic fetch output: {schematic_fetch}"
    );
}

#[test]
fn doc_ingest_auto_uses_local_provider_for_text_inputs() {
    let project = TestProject::new("doc-auto-local");
    let docs = project.path().join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::write(docs.join("manual.md"), "# Manual\n\nGPIO table\n").expect("write manual");

    let ingest = run(
        &project,
        &[
            "ingest",
            "doc",
            "--file",
            "docs/manual.md",
            "--kind",
            "datasheet",
            "--to",
            "hardware",
        ],
    );
    let value: serde_json::Value = serde_json::from_str(&ingest).expect("ingest json");
    assert_eq!(value["status"], "ok", "ingest output: {ingest}");
    assert_eq!(value["provider"], "local", "ingest output: {ingest}");
    assert_eq!(
        value["local_pdf_tool_priority"][0], "markitdown",
        "ingest output: {ingest}"
    );
}

#[test]
fn doc_ingest_local_tool_priority_is_project_configurable() {
    let project = TestProject::new("doc-tool-config");
    let project_json_path = project.path().join(".emb-agent/project.json");
    let raw = fs::read_to_string(&project_json_path).expect("read project json");
    let mut value: serde_json::Value = serde_json::from_str(&raw).expect("project json");
    value["integrations"]["doc_ingest"]["local_tool_priority"] =
        serde_json::json!(["custom-doc-tool", "markitdown"]);
    fs::write(
        &project_json_path,
        serde_json::to_string_pretty(&value).expect("project json serialize"),
    )
    .expect("write project json");

    let docs = project.path().join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::write(docs.join("manual.md"), "# Manual\n\nGPIO table\n").expect("write manual");

    let ingest = run(
        &project,
        &[
            "ingest",
            "doc",
            "--file",
            "docs/manual.md",
            "--kind",
            "datasheet",
            "--to",
            "hardware",
        ],
    );
    let value: serde_json::Value = serde_json::from_str(&ingest).expect("ingest json");
    assert_eq!(
        value["local_pdf_tool_priority"][0], "custom-doc-tool",
        "ingest output: {ingest}"
    );
}

#[test]
fn init_writes_config_and_task_lifecycle_hooks_run() {
    let project = TestProject::new("config-hooks");
    let config = fs::read_to_string(project.path().join(".emb-agent/config.yaml"))
        .expect("read emb-agent config");
    assert!(config.contains("session_auto_commit"), "config: {config}");
    assert!(config.contains("session_start"), "config: {config}");
    assert!(config.contains("before_tool"), "config: {config}");
    assert!(config.contains("after_create"), "config: {config}");
    assert!(config.contains("worker_guard"), "config: {config}");
    assert!(config.contains("dispatch_mode: inline"), "config: {config}");

    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"hooks:
  after_create:
    - "printf '%s' \"$TASK_JSON_PATH\" > .emb-agent/hook-created.txt"
"#,
    )
    .expect("write hook config");

    assert_success(
        Command::new(emb_agent_bin())
            .arg("task")
            .arg("add")
            .arg("Hook lifecycle task")
            .arg("--cwd")
            .arg(project.path())
            .output()
            .expect("run task add"),
    );
    let hook_output = fs::read_to_string(project.path().join(".emb-agent/hook-created.txt"))
        .expect("read hook output");
    assert!(
        hook_output.contains("task.json"),
        "hook should receive TASK_JSON_PATH, got {hook_output}"
    );

    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"codex:
  dispatch_mode: sub-agent
"#,
    )
    .expect("write dispatch config");
    let dispatch = run(&project, &["dispatch", "implement pwm"]);
    let dispatch_value: serde_json::Value = serde_json::from_str(&dispatch).expect("dispatch json");
    assert_eq!(dispatch_value["codex"]["dispatch_mode"], "sub-agent");
    assert_eq!(dispatch_value["dispatch"]["subagent_allowed"], true);
    assert_eq!(dispatch_value["dispatch"]["subagent_required"], true);

    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"codex:
  dispatch_mode: auto
"#,
    )
    .expect("write auto dispatch config");
    let auto_dispatch = run(&project, &["dispatch", "implement pwm framework"]);
    let auto_value: serde_json::Value =
        serde_json::from_str(&auto_dispatch).expect("auto dispatch json");
    assert_eq!(auto_value["codex"]["dispatch_mode"], "auto");
    assert_eq!(auto_value["dispatch"]["inline_allowed"], true);
    assert_eq!(auto_value["dispatch"]["subagent_allowed"], true);
    assert_eq!(auto_value["dispatch"]["subagent_required"], false);
    assert_eq!(auto_value["dispatch"]["subagent_recommended"], true);
    assert_eq!(
        auto_value["dispatch"]["subagent_prompt"]["agent"],
        "fw-doer"
    );
    assert_eq!(auto_value["dispatch"]["post_check_required"], true);
    assert_eq!(
        auto_value["dispatch"]["subagent_sequence"],
        serde_json::json!(["fw-doer", "release-checker"])
    );
    assert_eq!(
        auto_value["dispatch"]["subagent_prompt"]["agents"],
        serde_json::json!(["fw-doer", "release-checker"])
    );
    assert!(
        auto_value["dispatch"]["available_agents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|agent| agent == "researcher"),
        "auto dispatch should expose researcher: {auto_dispatch}"
    );

    let research_dispatch = run(&project, &["dispatch", "research vendor SDK API examples"]);
    let research_value: serde_json::Value =
        serde_json::from_str(&research_dispatch).expect("research dispatch json");
    assert_eq!(
        research_value["dispatch"]["subagent_prompt"]["agent"],
        "researcher"
    );
    assert_eq!(
        research_value["dispatch"]["subagent_sequence"],
        serde_json::json!(["researcher"])
    );
    assert_eq!(
        research_value["dispatch"]["auto_reason"],
        "research_heavy_or_external_context_work"
    );

    let sdk_impl_dispatch = run(&project, &["dispatch", "implement SDK library integration"]);
    let sdk_impl_value: serde_json::Value =
        serde_json::from_str(&sdk_impl_dispatch).expect("sdk impl dispatch json");
    assert_eq!(
        sdk_impl_value["dispatch"]["subagent_prompt"]["agent"],
        "fw-doer"
    );
    assert_eq!(
        sdk_impl_value["dispatch"]["subagent_sequence"],
        serde_json::json!(["researcher", "fw-doer", "release-checker"])
    );
    let auto_dispatch_run = Command::new(emb_agent_bin())
        .arg("dispatch")
        .arg("run")
        .arg("implement pwm framework")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run auto dispatch contract");
    let auto_dispatch_run = assert_success(auto_dispatch_run);
    let auto_run_value: serde_json::Value =
        serde_json::from_str(&auto_dispatch_run).expect("auto dispatch run json");
    assert_eq!(auto_run_value["status"], "delegation-contract");
    assert_eq!(auto_run_value["mode"], "auto");
    assert_eq!(
        auto_run_value["contract"]["dispatch"]["subagent_recommended"],
        true
    );

    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"max_journal_lines: 1
hooks:
  session_start:
    - "printf '%s' \"$EMB_AGENT_SESSION_EVENT\" > .emb-agent/session-hook.txt"
"#,
    )
    .expect("write session hook config");
    let session_start = Command::new(emb_agent_bin())
        .arg("hook")
        .arg("session-start")
        .arg("--host")
        .arg("codex")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run session-start hook");
    assert_success(session_start);
    let session_hook = fs::read_to_string(project.path().join(".emb-agent/session-hook.txt"))
        .expect("read session hook output");
    assert!(
        session_hook.contains("startup"),
        "session hook output: {session_hook}"
    );
    let journal = fs::read_to_string(project.path().join(".emb-agent/sessions/journal.jsonl"))
        .expect("read session journal");
    assert_eq!(
        journal.lines().count(),
        1,
        "journal should obey max_journal_lines"
    );

    let custom_event = Command::new(emb_agent_bin())
        .arg("hook")
        .arg("event")
        .arg("before_tool")
        .arg("--host")
        .arg("codex")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run custom hook event");
    let custom_event = assert_success(custom_event);
    assert!(
        custom_event.contains("before_tool"),
        "custom event: {custom_event}"
    );

    let session_end = Command::new(emb_agent_bin())
        .arg("hook")
        .arg("session-end")
        .arg("--host")
        .arg("codex")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run session-end hook");
    let session_end = assert_success(session_end);
    assert!(
        session_end.contains("session_end"),
        "session end: {session_end}"
    );

    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"codex:
  dispatch_mode: sub-agent
"#,
    )
    .expect("write dispatch config again");
    let dispatch_run = Command::new(emb_agent_bin())
        .arg("dispatch")
        .arg("run")
        .arg("verify")
        .arg("--inline")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run dispatch inline fallback");
    let dispatch_run = assert_success(dispatch_run);
    assert!(
        dispatch_run.contains("sub-agent"),
        "dispatch run: {dispatch_run}"
    );
}

#[test]
fn doctor_reports_codex_auto_dispatch_mode() {
    let project = TestProject::new("codex-auto-dispatch-doctor");
    let version = env!("CARGO_PKG_VERSION");
    fs::write(
        project.path().join(".emb-agent/config.yaml"),
        r#"codex:
  dispatch_mode: auto
"#,
    )
    .expect("write auto config");
    write_install_runtime_version(
        project.path(),
        format!(r#"{{"version":"{version}","hosts":[{{"name":"codex","version":"{version}"}}]}}"#),
    );
    let codex_runtime = project.path().join(".codex/emb-agent");
    fs::create_dir_all(codex_runtime.join("bin")).expect("create codex runtime bin");
    fs::create_dir_all(project.path().join(".agents/skills/emb-start"))
        .expect("create codex start skill dir");
    fs::create_dir_all(project.path().join(".agents/skills/emb-next"))
        .expect("create codex next skill dir");
    fs::create_dir_all(project.path().join(".agents/skills/emb-finish-work"))
        .expect("create codex finish-work skill dir");
    fs::create_dir_all(project.path().join(".codex/skills/emb-agent"))
        .expect("create codex emb-agent skill dir");
    fs::write(codex_runtime.join("VERSION"), format!("{version}\n")).expect("write version");
    fs::write(codex_runtime.join("bin/emb-agent.cjs"), "// wrapper\n").expect("write wrapper");
    fs::write(codex_runtime.join("bin/emb-agent-rs"), "").expect("write rust bin marker");
    fs::write(
        project.path().join(".agents/skills/emb-start/SKILL.md"),
        "start",
    )
    .expect("write codex start skill");
    fs::write(
        project.path().join(".agents/skills/emb-next/SKILL.md"),
        "next",
    )
    .expect("write codex next skill");
    fs::write(
        project
            .path()
            .join(".agents/skills/emb-finish-work/SKILL.md"),
        "finish",
    )
    .expect("write codex finish-work skill");
    fs::write(
        project.path().join(".codex/skills/emb-agent/SKILL.md"),
        "skill",
    )
    .expect("write codex emb-agent skill");
    fs::write(
        project.path().join(".codex/hooks.json"),
        r#"{"hooks":["hook session-start --host codex","UserPromptSubmit","hook context-monitor --host codex","hook tool-guard --host codex","ApplyPatch"]}"#,
    )
    .expect("write codex hooks");

    let output = run(&project, &["doctor", "--host", "codex", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("doctor json");
    assert_eq!(value["hosts"][0]["codex_dispatch"]["mode"], "auto");
    assert_eq!(
        value["hosts"][0]["codex_dispatch"]["auto_dispatch_enabled"], true,
        "doctor output: {output}"
    );
    assert_eq!(
        value["hosts"][0]["codex_dispatch"]["inline_fallback_allowed"], true,
        "doctor output: {output}"
    );
    assert!(
        value["hosts"][0]["codex_dispatch"]["available_agents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|agent| agent == "researcher"),
        "doctor output should include researcher: {output}"
    );
}

#[test]
fn mem_cli_searches_and_extracts_local_sessions() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-mem-{nonce}"));
    let project = root.join("firmware-demo");
    let pi_sessions = root
        .join(".pi")
        .join("agent")
        .join("sessions")
        .join("--firmware-demo--");
    fs::create_dir_all(&pi_sessions).expect("create pi sessions");
    let session = pi_sessions.join("2026-06-24T00-00-00Z_demo.jsonl");
    fs::write(
        &session,
        [
            r#"{"message":{"role":"user","content":"task.py create --slug pwm-led brainstorm watchdog sleep"}}"#,
            r#"{"message":{"role":"assistant","content":"Brainstorm: watchdog must stay enabled during low-power exploration."}}"#,
            r#"{"message":{"role":"user","content":"task.py start pwm-led implementation"}}"#,
            r#"{"message":{"role":"assistant","content":"Implement: configure timer PWM and verify sleep wake path."}}"#,
        ]
        .join("\n"),
    )
    .expect("write session");

    let list = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("list")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem list");
    let list = assert_success(list);
    assert!(list.contains("firmware-demo"), "list output: {list}");

    let search = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("search")
        .arg("--query")
        .arg("看门狗 低功耗")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem search");
    let search = assert_success(search);
    assert!(search.contains("watchdog"), "search output: {search}");
    assert!(search.contains("semantic_score"), "search output: {search}");

    let extract = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("extract")
        .arg("demo")
        .arg("--phase")
        .arg("brainstorm")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem extract");
    let extract = assert_success(extract);
    assert!(extract.contains("Brainstorm"), "extract output: {extract}");
    assert!(
        !extract.contains("Implement:"),
        "brainstorm slice leaked implementation: {extract}"
    );

    let reindex = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("reindex")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem reindex");
    let reindex = assert_success(reindex);
    assert!(reindex.contains("index_path"), "reindex output: {reindex}");
    assert!(
        project.join(".emb-agent/cache/mem/index.json").exists(),
        "mem reindex should create local index"
    );

    let show = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("show")
        .arg("demo")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem show");
    let show = assert_success(show);
    assert!(show.contains("keywords"), "show output: {show}");
    assert!(show.contains("phases"), "show output: {show}");

    let stats = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("stats")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem stats");
    let stats = assert_success(stats);
    assert!(stats.contains("by_platform"), "stats output: {stats}");
    assert!(
        stats.contains("local-hash"),
        "stats should show local embedding fallback: {stats}"
    );

    let doctor = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("doctor")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .env("EMB_AGENT_EMBEDDING_PROVIDER", "openai-compatible")
        .output()
        .expect("run mem doctor");
    let doctor = assert_success(doctor);
    assert!(
        doctor.contains("api_key_present"),
        "doctor output: {doctor}"
    );

    let explain = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("explain")
        .arg("--query")
        .arg("watchdog")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem explain");
    let explain = assert_success(explain);
    assert!(explain.contains("explanation"), "explain output: {explain}");
    assert!(
        explain.contains("semantic_score"),
        "explain output: {explain}"
    );

    let promote = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("promote")
        .arg("--query")
        .arg("看门狗")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem promote");
    let promote = assert_success(promote);
    assert!(promote.contains("dry-run"), "promote output: {promote}");
    assert!(promote.contains("candidates"), "promote output: {promote}");

    let export = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("export")
        .arg("--format")
        .arg("markdown")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run mem export");
    let export = assert_success(export);
    assert!(export.contains("Keywords:"), "export output: {export}");

    let writeback = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("writeback")
        .arg("--target")
        .arg("memory")
        .arg("--summary")
        .arg("watchdog session insight")
        .arg("--cwd")
        .arg(&project)
        .env("HOME", &root)
        .output()
        .expect("run mem writeback");
    let writeback = assert_success(writeback);
    assert!(
        writeback.contains("session-insight"),
        "writeback output: {writeback}"
    );

    let auto_writeback = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("writeback")
        .arg("--summary")
        .arg("trap watchdog reset quirk")
        .arg("--cwd")
        .arg(&project)
        .env("HOME", &root)
        .output()
        .expect("run mem auto writeback");
    let auto_writeback = assert_success(auto_writeback);
    assert!(
        auto_writeback.contains("trap"),
        "auto writeback output: {auto_writeback}"
    );

    fs::write(
        project.join(".env"),
        "EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible\nEMB_AGENT_EMBEDDING_API_KEY=fake-test-key\nEMB_AGENT_EMBEDDING_API_BASE=<openai-compatible-base-url>\nEMB_AGENT_EMBEDDING_MODEL=text-embedding-3-large\n",
    )
    .expect("write dotenv embedding config");
    let dotenv_doctor = Command::new(emb_agent_bin())
        .arg("mem")
        .arg("doctor")
        .arg("--cwd")
        .arg(&project)
        .arg("--platform")
        .arg("pi")
        .env("HOME", &root)
        .output()
        .expect("run dotenv mem doctor");
    let dotenv_doctor = assert_success(dotenv_doctor);
    assert!(
        dotenv_doctor.contains("text-embedding-3-large"),
        "dotenv doctor output: {dotenv_doctor}"
    );
    assert!(
        dotenv_doctor.contains("api_key_present"),
        "dotenv doctor output: {dotenv_doctor}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn installer_bin_dispatches_runtime_validate_command() {
    let project = TestProject::new("installer-dispatch");
    let output = Command::new("node")
        .arg(repo_root().join("bin").join("install.js"))
        .arg("validate")
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run installer validate dispatch");
    let stdout = assert_success(output);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("validate json");
    assert_eq!(value["status"], "ok", "validate dispatch output: {stdout}");
}

#[test]
fn runtime_wrapper_allows_long_doc_ingest() {
    let wrapper = fs::read_to_string(repo_root().join("runtime/bin/emb-agent.cjs"))
        .expect("read runtime wrapper");
    assert!(
        wrapper.contains("function rustTimeoutMs"),
        "runtime wrapper must compute command-specific timeouts"
    );
    assert!(
        wrapper.contains("args[0] !== \"ingest\" || args[1] !== \"doc\""),
        "runtime wrapper must special-case ingest doc"
    );
    assert!(
        wrapper.contains("timeout: rustTimeoutMs(args)"),
        "runtime wrapper must not keep a fixed 120s spawn timeout for MinerU parsing"
    );
    assert!(
        wrapper.contains("function runRustHook"),
        "runtime wrapper must use a hook-specific spawn path"
    );
    assert!(
        wrapper.contains("child.stdin.end(input || Buffer.alloc(0))"),
        "runtime wrapper must explicitly close hook stdin"
    );
    assert!(
        wrapper.contains("fs.writeSync(1, result.stdout)"),
        "runtime wrapper must flush large doc fetch output before process.exit"
    );
    let installer = fs::read_to_string(repo_root().join("bin/install.js")).expect("read installer");
    assert!(
        installer.contains("fs.writeSync(1, result.stdout)"),
        "installer runtime dispatch must flush large outputs before process.exit"
    );
}

#[test]
fn installer_interactive_defaults_are_fast_and_local_first() {
    let installer = fs::read_to_string(repo_root().join("bin/install.js")).expect("read installer");
    assert!(
        installer.contains("Enter confirms the highlighted option"),
        "single-select installer prompts should allow Enter to accept the highlighted default"
    );
    assert!(
        installer.contains("if (state.selectedIndex < 0) state.selectedIndex = state.cursorIndex;"),
        "single-select installer prompts should not require pressing Space before Enter"
    );
    let local = installer
        .find("{ label: \"Local\", desc: \"Install into this project (recommended)\", value: \"local\" }")
        .expect("local install option");
    let global = installer
        .find("{ label: \"Global\", desc: \"Install to the user config directory\", value: \"global\" }")
        .expect("global install option");
    assert!(
        local < global,
        "interactive install should default to local before global"
    );
    assert!(
        installer.contains("Fetching available specs and skills from GitHub: Welkon/emb-support"),
        "interactive install should default to the GitHub support repository when local emb-support is absent"
    );
    assert!(
        installer.contains("Local emb-support found but empty. Trying GitHub: Welkon/emb-support"),
        "interactive install should fall back to the GitHub support repository when local emb-support is empty"
    );
}

#[test]
fn doc_lookup_preserves_first_yaml_character() {
    let project = TestProject::new("doc-lookup-yaml");
    fs::write(
        project.path().join(".emb-agent/hw.yaml"),
        "model: \"SC8F072\"\npackage: \"SOP-14\"\n",
    )
    .expect("write hw truth");
    fs::write(project.path().join("docs/SC8F072-user-manual.pdf"), b"pdf")
        .expect("write doc candidate");
    let lookup = run(&project, &["doc", "lookup", "--keyword", "manual"]);
    let value: serde_json::Value = serde_json::from_str(&lookup).expect("lookup json");
    assert_eq!(value["scope"]["chip"], "SC8F072", "lookup output: {lookup}");
    assert_eq!(
        value["scope"]["package"], "SOP-14",
        "lookup output: {lookup}"
    );
}

#[test]
fn doc_lookup_matches_cached_source_metadata_and_parse_text() {
    let project = TestProject::new("doc-lookup-cache-source");
    fs::write(
        project.path().join(".emb-agent/hw.yaml"),
        "model: \"SC8F072AD614SP\"\npackage: \"SOP-14\"\n",
    )
    .expect("write hw truth");
    let doc_dir = project
        .path()
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join("sc8f072-manual");
    fs::create_dir_all(&doc_dir).expect("create doc cache");
    fs::write(
        doc_dir.join("source.json"),
        r#"{"doc_id":"sc8f072-manual","source":"docs/SC8F072用户手册_V1.0.2.pdf","title":"SC8F072用户手册_V1.0.2.pdf","provider":"local","kind":"datasheet"}"#,
    )
    .expect("write source metadata");
    fs::write(
        doc_dir.join("parse.md"),
        "6.2.6 PORTA电平变化中断\nRAIF/RAIE 可通过 IOCA 口线变化从休眠唤醒。清除 RAIF 前需要读或写 PORTA。\n",
    )
    .expect("write parsed manual");

    let lookup = run(
        &project,
        &["doc", "lookup", "--keyword", "IOC 电平变化中断 唤醒 RAIF"],
    );
    let value: serde_json::Value = serde_json::from_str(&lookup).expect("lookup json");
    let docs = value["documents"].as_array().expect("documents array");
    assert!(!docs.is_empty(), "lookup output: {lookup}");
    assert!(
        docs[0]["path"]
            .as_str()
            .unwrap_or_default()
            .contains(".emb-agent/cache/docs/sc8f072-manual"),
        "lookup output: {lookup}"
    );
    assert!(
        docs[0]["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("keyword token"),
        "lookup output: {lookup}"
    );
}

#[test]
fn knowledge_search_prioritizes_truth_for_board_facts() {
    let project = TestProject::new("knowledge-truth-priority");
    fs::write(
        project.path().join(".emb-agent/hw.yaml"),
        "model: \"SC8F072AD614SP\"\npackage: \"SOP-14\"\nled_output: \"LED- (half-hole-pad, Q1(S8050)-RA3 driven via R1=1K)\"\n",
    )
    .expect("write hw truth");
    let doc_dir = project
        .path()
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join("noisy-manual");
    fs::create_dir_all(&doc_dir).expect("create doc cache");
    fs::write(
        doc_dir.join("source.json"),
        r#"{"doc_id":"noisy-manual","source":"docs/SC8P062B用户手册_V1.0.1.pdf","title":"SC8P062B用户手册_V1.0.1.pdf","provider":"auto","kind":"datasheet"}"#,
    )
    .expect("write noisy metadata");
    fs::write(
        doc_dir.join("parse.md"),
        "PWM 控制输出 三极管 output state control register PORTB PWMCON0\n",
    )
    .expect("write noisy parse");

    let search = run(
        &project,
        &[
            "knowledge",
            "search",
            "--query",
            "控制输出 三极管 control transistor output state",
            "--limit",
            "5",
            "--rerank",
            "--refresh",
        ],
    );
    let value: serde_json::Value = serde_json::from_str(&search).expect("search json");
    let hits = value["hits"].as_array().expect("hits array");
    assert!(!hits.is_empty(), "search output: {search}");
    assert_eq!(hits[0]["source_type"], "truth", "search output: {search}");
    assert_eq!(hits[0]["path"], "hw.yaml", "search output: {search}");
}

#[test]
fn validate_catches_duplicate_yaml_keys() {
    let project = TestProject::new("validate-duplicates");
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "confirmed_facts:\n  - source: schematic\n    fact: first\n    fact: duplicate\n",
    )
    .expect("write duplicate req truth");
    let validate = run(&project, &["validate"]);
    let value: serde_json::Value = serde_json::from_str(&validate).expect("validate json");
    assert_eq!(value["status"], "error", "validate output: {validate}");
    assert!(
        value["truth_validation_errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|err| err.as_str().unwrap_or("").contains("duplicate key `fact`")),
        "validate output: {validate}"
    );
}

#[test]
fn schematic_and_component_file_arguments_select_matching_cache() {
    let project = TestProject::new("schematic-file-args");
    let cache = project
        .path()
        .join(".emb-agent")
        .join("cache")
        .join("schematics")
        .join("other");
    fs::create_dir_all(&cache).expect("create second schematic cache");
    fs::write(
        cache.join("parsed.json"),
        r#"{
          "parser_mode": "other-fixture",
          "components": [{"designator":"U2","value":"ALT_MCU","libref":"MCU"}],
          "nets": [{"name":"ALT","members":["U2.1"],"confidence":"fixture","evidence":[]}],
          "bom": [],
          "objects": [{"RECORD":"other"}],
          "raw_summary": {"fixture": "other"}
        }"#,
    )
    .expect("write second parsed fixture");
    fs::write(
        cache.join("source.json"),
        r#"{"source_path":"docs/other.SchDoc","parser_mode":"fixture"}"#,
    )
    .expect("write second source fixture");

    let ambiguous = Command::new(emb_agent_bin())
        .args(["schematic", "summary"])
        .arg("--cwd")
        .arg(project.path())
        .output()
        .expect("run ambiguous schematic summary");
    assert!(
        !ambiguous.status.success(),
        "schematic summary without --file must fail when multiple caches exist"
    );
    let ambiguous_stderr = String::from_utf8_lossy(&ambiguous.stderr);
    assert!(
        ambiguous_stderr.contains("Multiple schematic caches found"),
        "ambiguous stderr: {ambiguous_stderr}"
    );

    let summary = run(&project, &["schematic", "summary", "docs/other.SchDoc"]);
    let summary_json: serde_json::Value = serde_json::from_str(&summary).expect("summary json");
    assert_eq!(
        summary_json["summary"]["components"], 1,
        "summary output: {summary}"
    );
    assert_eq!(
        summary_json["scope"]["source_schematic"], "docs/other.SchDoc",
        "summary output: {summary}"
    );

    let net = run(
        &project,
        &["schematic", "net", "ALT", "--file", "docs/other.SchDoc"],
    );
    let net_json: serde_json::Value = serde_json::from_str(&net).expect("net json");
    assert_eq!(net_json["name"], "ALT", "net output: {net}");
    assert_eq!(net_json["net"]["members"][0], "U2.1", "net output: {net}");

    let component = run(
        &project,
        &[
            "component",
            "lookup",
            "--file",
            "docs/other.SchDoc",
            "--ref",
            "U2",
        ],
    );
    let component_json: serde_json::Value =
        serde_json::from_str(&component).expect("component json");
    assert_eq!(
        component_json["scope"]["from_schematic"], "docs/other.SchDoc",
        "component output: {component}"
    );
    assert_eq!(
        component_json["components"][0]["designator"], "U2",
        "component output: {component}"
    );
}

#[test]
fn ingest_schematic_accepts_repeated_file_options() {
    let project = TestProject::new("schematic-multi-file");
    let docs = project.path().join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::write(docs.join("sheet1.net"), "U1 MCU\n").expect("write sheet1");
    fs::write(docs.join("sheet2.net"), "R1 1K\n").expect("write sheet2");

    let ingest = run(
        &project,
        &[
            "ingest",
            "schematic",
            "--file",
            "docs/sheet1.net",
            "--file",
            "docs/sheet2.net",
            "--format",
            "netlist",
        ],
    );
    let ingest_json: serde_json::Value = serde_json::from_str(&ingest).expect("ingest json");
    assert_eq!(ingest_json["sheet_count"], 2, "ingest output: {ingest}");
    assert_eq!(
        ingest_json["components_found"], 2,
        "ingest output: {ingest}"
    );

    let summary = run(&project, &["schematic", "summary", "docs/sheet2.net"]);
    let summary_json: serde_json::Value = serde_json::from_str(&summary).expect("summary json");
    assert_eq!(
        summary_json["summary"]["components"], 2,
        "summary output: {summary}"
    );
}

#[test]
fn ingest_schematic_identifies_generic_sop8_controller_candidate() {
    let project = TestProject::new("schematic-generic-controller-candidate");
    let docs = project.path().join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::write(
        docs.join("bom.csv"),
        "designator,value,footprint\nU2,ZX1234 SOP-8,SOP-8\nR1,10K,0603\n",
    )
    .expect("write bom");

    let ingest = run(
        &project,
        &[
            "ingest",
            "schematic",
            "--file",
            "docs/bom.csv",
            "--format",
            "bom-csv",
        ],
    );
    let value: serde_json::Value = serde_json::from_str(&ingest).expect("ingest json");
    let candidates = value["mcu_candidates"].as_array().expect("mcu candidates");
    assert!(
        candidates.iter().any(|candidate| {
            candidate["designator"] == "U2"
                && candidate["value"].as_str().unwrap_or("").contains("ZX1234")
        }),
        "ingest output: {ingest}"
    );
}

#[test]
fn next_requires_manual_evidence_before_new_firmware_work() {
    let project = TestProject::new("manual-gate");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/pwm-led")).expect("remove task");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/schematic-review"))
        .expect("remove task");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "SC8F072",
            "--package",
            "SOP-14",
        ],
    );
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - run motor\n",
    )
    .expect("write req truth");

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "ingest-docs", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["kind"], "firmware-manual-required",
        "next output: {next}"
    );

    let health = run(&project, &["health"]);
    let health_json: serde_json::Value = serde_json::from_str(&health).expect("health json");
    assert_eq!(health_json["status"], "fail", "health output: {health}");
    assert!(
        health_json["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| { check["name"] == "firmware_manual_evidence" && check["pass"] == false }),
        "health output: {health}"
    );
}

#[test]
fn debug_capability_requires_feedback_loop_protocol() {
    let project = TestProject::new("debug-protocol");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );

    let output = run(&project, &["debug"]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("debug json");
    assert_eq!(
        value["chosen_agent"], "emb-bug-hunter",
        "debug output: {output}"
    );
    assert!(
        value["feedback_loop"]
            .as_array()
            .map(|items| items
                .iter()
                .any(|item| item.as_str().unwrap_or("").contains("logic analyzer")))
            .unwrap_or(false),
        "debug output: {output}"
    );
    assert!(
        value["diagnosis_phases"]
            .as_array()
            .map(|items| items
                .iter()
                .any(|item| item.as_str().unwrap_or("").contains("Build feedback loop")))
            .unwrap_or(false),
        "debug output: {output}"
    );
}

#[test]
fn task_add_creates_triage_brief_and_vertical_slice_metadata() {
    let project = TestProject::new("task-intake-protocol");
    let output = run(
        &project,
        &[
            "task",
            "add",
            "Fix PWM timing fault on bench",
            "--category",
            "bug",
            "--priority",
            "P0",
        ],
    );
    let created: serde_json::Value = serde_json::from_str(&output).expect("task add json");
    assert_eq!(
        created["task"]["category"], "bug",
        "task add output: {output}"
    );
    assert_eq!(
        created["task"]["triage_state"], "needs-triage",
        "task add output: {output}"
    );
    assert_eq!(
        created["next"], "brainstorm contract",
        "task add output: {output}"
    );
    assert_eq!(created["task_optional"], true, "task add output: {output}");
    assert!(
        created["direct_work_allowed_for"]
            .as_array()
            .map(|items| items.iter().any(|item| item == "design_explanation"))
            .unwrap_or(false),
        "task add output: {output}"
    );

    let task_name = created["task"]["name"].as_str().expect("task name");
    let prd_path = created["task"]["prd"].as_str().expect("created task prd");
    assert_eq!(
        prd_path,
        format!("docs/prd/tasks/{task_name}.md"),
        "task add output: {output}"
    );
    let task_prd = fs::read_to_string(project.path().join(prd_path)).expect("read task prd");
    assert!(
        task_prd.contains("## Confirmed Facts")
            && task_prd.contains("## Acceptance Criteria")
            && task_prd.contains("## Open Questions")
            && task_prd.contains("## Evidence And Research"),
        "task PRD missing brainstorm sections: {task_prd}"
    );
    let shown = run(&project, &["task", "show", task_name]);
    let task: serde_json::Value = serde_json::from_str(&shown).expect("task show json");
    assert_eq!(
        task["artifacts"]["prd"], prd_path,
        "task show output: {shown}"
    );
    assert_eq!(
        task["agent_brief"]["current_behavior"], "",
        "task show output: {shown}"
    );
    assert_eq!(
        task["slice"]["strategy"], "vertical-tracer-bullet",
        "task show output: {shown}"
    );
    assert_eq!(
        task["readiness"]["human_gate"], true,
        "task show output: {shown}"
    );
}

#[test]
fn work_selection_gate_exposes_triage_and_slicing_protocol() {
    let project = TestProject::new("work-selection-protocol");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "choose-work", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["method"], "triage-brief-slice-or-direct-bounded-work",
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["required_brief_fields"]
            .as_array()
            .map(|items| items.iter().any(|item| item == "acceptance_criteria"))
            .unwrap_or(false),
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["direct_work_allowed_for"]
            .as_array()
            .map(|items| items.iter().any(|item| item == "small_scoped_fix"))
            .unwrap_or(false),
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["allowed_actions"]
            .as_array()
            .map(|items| items
                .iter()
                .any(|item| item == "walk_service_and_time_slice_flow"))
            .unwrap_or(false),
        "next output: {next}"
    );
}

#[test]
fn next_without_existing_tasks_routes_to_task_or_direct_intake() {
    let project = TestProject::new("task-or-direct");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/pwm-led")).expect("remove pwm task");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/schematic-review"))
        .expect("remove schematic task");
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - explain current scheduler structure\nfeatures:\n  - service walkthrough\nacceptance:\n  - identify direct explanation path without forcing task activation\n",
    )
    .expect("write req truth");
    fs::create_dir_all(project.path().join(".emb-agent/cache/docs/mock"))
        .expect("create doc cache");
    fs::write(
        project.path().join(".emb-agent/cache/docs/mock/parse.md"),
        "# Mock MCU Manual",
    )
    .expect("write manual stub");

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "task-or-direct", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["kind"], "task-or-direct-intake",
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["direct_work_allowed_for"]
            .as_array()
            .map(|items| items.iter().any(|item| item == "design_explanation"))
            .unwrap_or(false),
        "next output: {next}"
    );
}

#[test]
fn task_resolve_auto_records_minimal_aar_when_none_exists() {
    let project = TestProject::new("resolve-auto-aar");

    let created = run(
        &project,
        &[
            "task",
            "add",
            "Explain service scheduler flow",
            "--category",
            "feature",
        ],
    );
    let created_value: serde_json::Value = serde_json::from_str(&created).expect("task add json");
    let task_name = created_value["task"]["name"].as_str().expect("task name");

    let resolved = run(&project, &["task", "resolve", task_name]);
    let resolved_value: serde_json::Value =
        serde_json::from_str(&resolved).expect("task resolve json");
    assert_eq!(resolved_value["status"], "ok", "resolve output: {resolved}");
    assert_eq!(
        resolved_value["resolved"], true,
        "resolve output: {resolved}"
    );
    assert_eq!(
        resolved_value["aar"]["auto_recorded_no_lessons"], true,
        "resolve output: {resolved}"
    );

    let shown = run(&project, &["task", "show", task_name]);
    let task: serde_json::Value = serde_json::from_str(&shown).expect("task show json");
    assert_eq!(task["status"], "completed", "task show output: {shown}");
    assert_eq!(
        task["aar"]["scan_completed"], true,
        "task show output: {shown}"
    );
    assert_eq!(
        task["aar"]["record_completed"], true,
        "task show output: {shown}"
    );

    let aar_md = fs::read_to_string(
        project
            .path()
            .join(".emb-agent")
            .join("tasks")
            .join(task_name)
            .join("aar.md"),
    )
    .expect("read aar");
    assert!(
        aar_md.contains("auto-recorded a minimal no-lessons AAR"),
        "aar md: {aar_md}"
    );
}

#[test]
fn active_task_defaults_cover_aar_and_resolve_commands() {
    let project = TestProject::new("active-task-defaults");
    let created = run(&project, &["task", "add", "Implement timed key run"]);
    let created_value: serde_json::Value = serde_json::from_str(&created).expect("task add json");
    let task_name = created_value["task"]["name"].as_str().expect("task name");
    let task_dir = project.path().join(".emb-agent/tasks").join(task_name);
    for manifest in ["implement.jsonl", "check.jsonl", "debug.jsonl"] {
        let manifest_text =
            fs::read_to_string(task_dir.join(manifest)).expect("read task context manifest");
        assert!(
            manifest_text.contains("\"_example\"")
                && manifest_text.contains("One JSON object per line")
                && manifest_text.contains(&format!("docs/prd/tasks/{task_name}.md")),
            "{manifest} should include a useful seed row: {manifest_text}"
        );
    }
    let activated = run(&project, &["task", "activate", task_name]);
    let activated_value: serde_json::Value =
        serde_json::from_str(&activated).expect("task activate json");
    assert_eq!(
        activated_value["activated"], true,
        "activate output: {activated}"
    );

    let aar = run(&project, &["task", "aar", "scan", "--no-lessons"]);
    let aar_value: serde_json::Value = serde_json::from_str(&aar).expect("task aar json");
    assert_eq!(aar_value["status"], "ok", "aar output: {aar}");
    assert_eq!(aar_value["task"]["name"], task_name, "aar output: {aar}");

    let resolved = run(&project, &["task", "resolve"]);
    let resolved_value: serde_json::Value =
        serde_json::from_str(&resolved).expect("task resolve json");
    assert_eq!(
        resolved_value["resolved"], true,
        "resolve output: {resolved}"
    );
    assert_eq!(
        resolved_value["task"]["name"], task_name,
        "resolve output: {resolved}"
    );
}

#[test]
fn capability_run_executes_action_directly() {
    let project = TestProject::new("capability-run-direct");
    let output = run(&project, &["capability", "run", "scan"]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("capability scan json");
    assert!(value["key_facts"].is_array(), "capability output: {output}");
    assert!(
        value["workflow_stage"]["stage"] == "scan",
        "capability output: {output}"
    );
    assert!(
        !output.contains("Run `node .<host>/emb-agent/bin/emb-agent.cjs scan`"),
        "capability run should not return a second command hop: {output}"
    );
}

#[test]
fn system_prd_without_child_prds_routes_to_prd_breakdown() {
    let project = TestProject::new("prd-breakdown");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/pwm-led")).expect("remove pwm task");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/schematic-review"))
        .expect("remove schematic task");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - run motor safely\nfeatures:\n  - PWM motor cycle\nacceptance:\n  - SKEY plus KEY starts motor\n",
    )
    .expect("write req truth");
    fs::write(
        project.path().join("docs/prd/system.md"),
        "# System PRD\n\n## Behaviors\n\n- Firmware controls the motor with PWM soft-start.\n- SKEY is a continuous safety interlock.\n- Low-voltage cutoff stops the motor and flashes red.\n\n## Acceptance Evidence\n\n- Verify boot, run, stop, and fault states.\n",
    )
    .expect("write system prd");
    // Hard constraint: preflight-tools gate checks for native graph and parsed MCU manual.
    fs::create_dir_all(project.path().join(".emb-agent/graph")).expect("create native graph dir");
    fs::write(
        project.path().join(".emb-agent/graph/graph.json"),
        r#"{"nodes":[],"edges":[]}"#,
    )
    .expect("write graph stub");
    fs::create_dir_all(project.path().join(".emb-agent/cache/docs/mock"))
        .expect("create doc cache");
    fs::write(
        project.path().join(".emb-agent/cache/docs/mock/parse.md"),
        "# Mock MCU Manual",
    )
    .expect("write manual stub");
    fs::write(
        project.path().join(".emb-agent/cache/docs/index.json"),
        r#"{"documents":[{"doc_id":"mock","provider":"local","kind":"datasheet","title":"SC8F072 user manual","intended_to":"hardware","parsed":true,"status":"ok","paths":{"markdown":".emb-agent/cache/docs/mock/parse.md","source":"docs/SC8F072-user-manual.pdf"}}]}"#,
    )
    .expect("write doc index");

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "prd-breakdown", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["kind"], "prd-breakdown",
        "next output: {next}"
    );
    assert_eq!(
        value["prd"]["breakdown_needed"], true,
        "next output: {next}"
    );
    let candidates = value["task_candidates"]
        .as_array()
        .expect("task candidates");
    assert!(
        candidates
            .iter()
            .any(|task| task["name"] == "motor-control"),
        "motor-control suggestion missing: {next}"
    );
    assert!(
        value["instructions"]
            .as_str()
            .unwrap_or("")
            .contains("docs/prd/system.md"),
        "next output: {next}"
    );

    let health = run(&project, &["health"]);
    let health_json: serde_json::Value = serde_json::from_str(&health).expect("health json");
    assert_eq!(health_json["status"], "fail", "health output: {health}");
    assert!(
        health_json["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| { check["name"] == "prd_child_planning" && check["pass"] == false }),
        "health output: {health}"
    );
}

#[test]
fn completed_task_history_does_not_force_prd_breakdown() {
    let project = TestProject::new("complete-no-prd-breakdown");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - deliver timer firmware\nfeatures:\n  - display countdown\nacceptance:\n  - firmware builds and board acceptance can proceed\n",
    )
    .expect("write req truth");
    fs::write(
        project.path().join("docs/prd/system.md"),
        "# System PRD\n\n## Behaviors\n\n- Display countdown.\n- Key controls timer.\n- Sleep after idle.\n\n## Acceptance Evidence\n\n- Build passes.\n- Board burn-in can proceed.\n",
    )
    .expect("write system prd");
    for task in ["pwm-led", "schematic-review"] {
        fs::write(
            project
                .path()
                .join(".emb-agent")
                .join("tasks")
                .join(task)
                .join("task.json"),
            format!(
                r#"{{"name":"{task}","title":"{task}","status":"completed","priority":"P2","package":"firmware"}}"#
            ),
        )
        .expect("write completed task");
    }

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "complete", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["kind"], "project-complete",
        "next output: {next}"
    );
    assert_eq!(
        value["prd"]["breakdown_needed"], false,
        "next output: {next}"
    );
    assert!(
        value["instructions"]
            .as_str()
            .unwrap_or("")
            .contains("Do not run PRD breakdown"),
        "next output: {next}"
    );
}

#[test]
fn child_prds_without_tasks_route_to_work_selection() {
    let project = TestProject::new("child-prd-selection");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/pwm-led")).expect("remove pwm task");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/schematic-review"))
        .expect("remove schematic task");
    let _ = run(
        &project,
        &[
            "declare",
            "hardware",
            "--mcu",
            "CA51M550",
            "--package",
            "SOP8",
        ],
    );
    fs::write(
        project.path().join("docs/prd/system.md"),
        "# System PRD\n\n## Behaviors\n\n- Firmware controls the motor with PWM soft-start.\n",
    )
    .expect("write system prd");
    let child_dir = project.path().join("docs/prd/tasks");
    fs::create_dir_all(&child_dir).expect("create child prd dir");
    fs::write(
        child_dir.join("motor-control.md"),
        "# Motor Control Slice\n\nImplement one verified motor-control path.\n",
    )
    .expect("write child prd");

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "choose-work", "next output: {next}");
    assert_eq!(
        value["agent_protocol"]["gate"]["kind"], "work-selection",
        "next output: {next}"
    );
    assert_eq!(value["open_tasks"], 0, "next output: {next}");
    assert_eq!(value["prd"]["child_prd_count"], 1, "next output: {next}");
    let candidates = value["task_candidates"]
        .as_array()
        .expect("task candidates");
    assert!(
        candidates
            .iter()
            .any(|task| { task["name"] == "motor-control" && task["status"] == "prd-ready" }),
        "child PRD candidate missing: {next}"
    );
}

#[test]
fn doctor_reports_stale_host_runtime_versions() {
    let project = TestProject::new("stale-runtime");
    write_install_runtime_version(
        project.path(),
        r#"{"version":"0.5.0","hosts":[{"name":"cursor","version":"0.5.0"}]}"#,
    );
    let cursor_runtime = project.path().join(".cursor/emb-agent");
    fs::create_dir_all(cursor_runtime.join("bin")).expect("create cursor runtime bin");
    fs::create_dir_all(project.path().join(".cursor/commands")).expect("create cursor commands");
    fs::create_dir_all(project.path().join(".cursor/rules")).expect("create cursor rules");
    fs::create_dir_all(project.path().join(".cursor/skills/emb-agent"))
        .expect("create cursor skill dir");
    fs::write(cursor_runtime.join("VERSION"), "0.4.0\n").expect("write old version");
    fs::write(cursor_runtime.join("bin/emb-agent.cjs"), "// wrapper\n").expect("write wrapper");
    fs::write(cursor_runtime.join("bin/emb-agent-rs"), "").expect("write rust bin marker");
    fs::write(project.path().join(".cursor/commands/emb-next.md"), "next")
        .expect("write cursor next command");
    fs::write(
        project.path().join(".cursor/commands/emb-start.md"),
        "start",
    )
    .expect("write cursor start command");
    fs::write(
        project.path().join(".cursor/commands/emb-finish-work.md"),
        "finish",
    )
    .expect("write cursor finish-work command");
    fs::write(project.path().join(".cursor/hooks.json"), "{}").expect("write cursor hooks");
    fs::write(
        project.path().join(".cursor/rules/emb-agent-workflow.mdc"),
        "rules",
    )
    .expect("write cursor rule");
    fs::write(
        project.path().join(".cursor/skills/emb-agent/SKILL.md"),
        "skill",
    )
    .expect("write cursor skill");

    let output = run(&project, &["doctor", "--host", "cursor", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("doctor json");
    assert_eq!(value["status"], "warn", "doctor output: {output}");
    assert_eq!(
        value["hosts"][0]["version_status"], "stale",
        "doctor output: {output}"
    );
    assert_eq!(
        value["hosts"][0]["manual_update_command"],
        "npx emb-agent@latest update --target all --local",
        "doctor output: {output}"
    );
}

#[test]
fn doctor_reports_stale_codex_hook_config() {
    let project = TestProject::new("stale-codex-hooks");
    let version = env!("CARGO_PKG_VERSION");
    write_install_runtime_version(
        project.path(),
        format!(r#"{{"version":"{version}","hosts":[{{"name":"codex","version":"{version}"}}]}}"#),
    );
    let codex_runtime = project.path().join(".codex/emb-agent");
    fs::create_dir_all(codex_runtime.join("bin")).expect("create codex runtime bin");
    fs::create_dir_all(project.path().join(".agents/skills/emb-start"))
        .expect("create codex start skill dir");
    fs::create_dir_all(project.path().join(".agents/skills/emb-next"))
        .expect("create codex next skill dir");
    fs::create_dir_all(project.path().join(".agents/skills/emb-finish-work"))
        .expect("create codex finish-work skill dir");
    fs::create_dir_all(project.path().join(".codex/skills/emb-agent"))
        .expect("create codex emb-agent skill dir");
    fs::write(codex_runtime.join("VERSION"), format!("{version}\n")).expect("write version");
    fs::write(codex_runtime.join("bin/emb-agent.cjs"), "// wrapper\n").expect("write wrapper");
    fs::write(codex_runtime.join("bin/emb-agent-rs"), "").expect("write rust bin marker");
    fs::write(
        project.path().join(".agents/skills/emb-start/SKILL.md"),
        "start",
    )
    .expect("write codex start skill");
    fs::write(
        project.path().join(".agents/skills/emb-next/SKILL.md"),
        "next",
    )
    .expect("write codex next skill");
    fs::write(
        project
            .path()
            .join(".agents/skills/emb-finish-work/SKILL.md"),
        "finish",
    )
    .expect("write codex finish-work skill");
    fs::write(
        project.path().join(".codex/skills/emb-agent/SKILL.md"),
        "skill",
    )
    .expect("write codex emb-agent skill");
    fs::write(project.path().join(".codex/hooks.json"), "{}").expect("write stale codex hooks");

    let output = run(&project, &["doctor", "--host", "codex", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("doctor json");
    assert_eq!(value["status"], "warn", "doctor output: {output}");
    assert_eq!(
        value["hosts"][0]["host_config_ok"], false,
        "doctor output: {output}"
    );
    assert_eq!(
        value["hosts"][0]["hook_readiness"]["status"], "warn",
        "doctor output: {output}"
    );
    assert!(
        value["hosts"][0]["hook_readiness"]["next_steps"][0]
            .as_str()
            .unwrap_or("")
            .contains("repair"),
        "doctor output: {output}"
    );
}

#[test]
fn concept_stage_unknowns_route_to_clarification_not_task_creation() {
    let project = TestProject::new("concept-clarify");
    fs::write(
        project.path().join(".emb-agent/hw.yaml"),
        "vendor: unknown\nmodel: unknown\npackage: unknown\nunknowns:\n  - MCU not selected\n",
    )
    .expect("write hw unknowns");
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - Dimmable lamp\nunknowns:\n  - Touch or knob interaction\n  - Power source\n",
    )
    .expect("write req unknowns");
    let task_name = "确认调光台灯交互方式与硬件规格";
    fs::write(
        project.path().join(".emb-agent/.current-task"),
        format!("{task_name}\n"),
    )
    .expect("write current task");
    let task_dir = project.path().join(".emb-agent/tasks").join(task_name);
    fs::create_dir_all(&task_dir).expect("create clarification task");
    fs::write(
        task_dir.join("task.json"),
        format!(
            r#"{{"name":"{task_name}","title":"{task_name}","status":"in_progress","priority":"P2"}}"#
        ),
    )
    .expect("write clarification task");

    let next = run(&project, &["next", "--brief"]);
    let next_value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(next_value["action"], "clarify", "next output: {next}");
    assert_eq!(
        next_value["agent_protocol"]["gate"]["kind"], "prd-exploration",
        "next output: {next}"
    );
    assert!(
        next_value["agent_protocol"]["gate"]["method"] == "brainstorm-with-docs"
            && next_value["instructions"]
                .as_str()
                .unwrap_or("")
                .contains("doc-grounded brainstorm loop")
            && next_value["instructions"]
                .as_str()
                .unwrap_or("")
                .contains("recommended answer"),
        "next output: {next}"
    );
    assert_eq!(
        next_value["agent_protocol"]["gate"]["brainstorm_contract"]["mode"],
        "main-session-interactive",
        "next output: {next}"
    );
    assert_eq!(
        next_value["agent_protocol"]["gate"]["brainstorm_contract"]["artifact_rules"]["task_prd"],
        "docs/prd/tasks/<task>.md records task-local goal, requirements, acceptance, out-of-scope, open questions, and evidence",
        "next output: {next}"
    );
    assert!(
        next_value["agent_protocol"]["gate"]["allowed_actions"]
            .as_array()
            .map(|items| items.iter().any(|item| {
                item == "trigger_task_add_after_user_confirms_concrete_deliverable_or_bug"
            }))
            .unwrap_or(false),
        "next output: {next}"
    );
    assert!(
        next_value["agent_protocol"]["gate"]["allowed_actions"]
            .as_array()
            .map(|items| items
                .iter()
                .any(|item| item == "delegate_read_only_bug_hunter"))
            .unwrap_or(false),
        "next output: {next}"
    );
    assert!(
        next_value["agent_protocol"]["gate"]["direct_work_allowed_for"]
            .as_array()
            .map(|items| items
                .iter()
                .any(|item| item == "bounded_read_only_bug_audit"))
            .unwrap_or(false),
        "next output: {next}"
    );
    assert_eq!(
        next_value["agent_protocol"]["gate"]["suggested_read_only_roles"]["bug_audit"][0],
        "bug-hunter",
        "next output: {next}"
    );
}

#[test]
fn power_risk_clarify_gate_includes_watchdog_and_sleep_checklist() {
    let project = TestProject::new("power-risk-clarify");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/pwm-led")).expect("remove pwm task");
    fs::remove_dir_all(project.path().join(".emb-agent/tasks/schematic-review"))
        .expect("remove schematic task");
    fs::write(
        project.path().join(".emb-agent/req.yaml"),
        "goals:\n  - Preserve deep sleep current\nunknowns:\n  - Wake source and watchdog policy\n",
    )
    .expect("write req truth");

    let next = run(&project, &["next", "--brief"]);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    let checklist = value["agent_protocol"]["gate"]["state_machine_checklist"]
        .as_array()
        .expect("checklist array");
    assert!(
        checklist
            .iter()
            .any(|item| item == "watchdog_policy_awake_vs_sleep"),
        "next output: {next}"
    );
    assert!(
        checklist
            .iter()
            .any(|item| item == "config_bit_dependencies"),
        "next output: {next}"
    );
}

#[test]
fn task_list_uses_top_level_manifest_fields_only() {
    let project = TestProject::new("nested-task-fields");
    let task_dir = project
        .path()
        .join(".emb-agent")
        .join("tasks")
        .join("real-task");
    fs::create_dir_all(&task_dir).expect("create real task");
    fs::write(
        task_dir.join("task.json"),
        r#"{
  "bindings": {"identity": {"name": "ghost-task", "title": "Ghost title", "status": ""}},
  "name": "real-task",
  "title": "Real task title",
  "status": "pending",
  "priority": "P1",
  "package": ""
}"#,
    )
    .expect("write nested manifest");

    let list = run(&project, &["task", "list"]);
    let value: serde_json::Value = serde_json::from_str(&list).expect("task list json");
    let tasks = value["tasks"].as_array().expect("tasks array");
    let real = tasks
        .iter()
        .find(|task| task["name"] == "real-task")
        .expect("real task listed");
    assert_eq!(real["title"], "Real task title", "task list output: {list}");
    assert!(
        !tasks.iter().any(|task| task["name"] == "ghost-task"),
        "nested name must not become a task candidate: {list}"
    );

    let next = run(&project, &["next", "--brief"]);
    let next_value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    let candidates = next_value["task_candidates"]
        .as_array()
        .expect("candidate array");
    assert!(
        candidates.iter().any(|task| task["name"] == "real-task"),
        "real task candidate missing: {next}"
    );
    assert!(
        !candidates.iter().any(|task| task["name"] == "ghost-task"),
        "ghost task candidate leaked: {next}"
    );
}

#[test]
fn deleted_tasks_do_not_route_as_candidates() {
    let project = TestProject::new("deleted-routing");

    let delete_output = run(&project, &["task", "delete", "pwm-led"]);
    assert!(
        delete_output.contains("\"deleted\":true"),
        "delete output: {delete_output}"
    );

    let list = run(&project, &["task", "list"]);
    assert!(!list.contains("pwm-led"), "deleted task listed: {list}");

    let next = run(&project, &["next", "--brief"]);
    let next_value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    let candidates = next_value["task_candidates"]
        .as_array()
        .expect("candidate array");
    assert!(
        !candidates.iter().any(|task| task["name"] == "pwm-led"),
        "deleted task routed: {next}"
    );
}

#[test]
fn task_add_handles_unicode_and_current_timestamps() {
    let project = TestProject::new("unicode-task");

    let expected_name = "测".repeat(31);
    let summary = "测".repeat(31);
    let output = run(&project, &["task", "add", &summary]);
    let value: serde_json::Value = serde_json::from_str(&output).expect("task add json");
    assert_eq!(value["status"], "ok", "task add output: {output}");
    assert_eq!(value["task"]["name"], expected_name);

    let task_json = fs::read_to_string(
        project
            .path()
            .join(".emb-agent")
            .join("tasks")
            .join(&expected_name)
            .join("task.json"),
    )
    .expect("read unicode task");
    let task: serde_json::Value = serde_json::from_str(&task_json).expect("task json");
    let created_at = task["createdAt"].as_str().expect("createdAt string");
    assert_timestamp_year_is_current(created_at);
}

#[test]
fn task_and_bug_add_reject_empty_slugs() {
    let project = TestProject::new("bad-slug");

    let task_output = run(&project, &["task", "add", "!!!"]);
    let task_value: serde_json::Value =
        serde_json::from_str(&task_output).expect("task error json");
    assert_eq!(task_value["status"], "error", "task output: {task_output}");
    assert_eq!(task_value["error"]["code"], "bad-name");

    let bug_output = run(&project, &["task", "bug", "add", "pwm-led", "!!!"]);
    let bug_value: serde_json::Value = serde_json::from_str(&bug_output).expect("bug error json");
    assert_eq!(bug_value["status"], "error", "bug output: {bug_output}");
    assert_eq!(bug_value["error"]["code"], "bad-name");
}

#[test]
fn host_scaffolds_have_no_unresolved_fill_markers() {
    let root = repo_root();
    let scaffold_root = root.join("runtime").join("scaffolds").join("shells");
    let mut offenders = Vec::new();
    collect_files_with(&scaffold_root, "<!-- FILL:", &mut offenders);
    assert!(
        offenders.is_empty(),
        "unresolved scaffold markers: {offenders:?}"
    );
}

#[test]
fn pi_extension_uses_pi_runtime_and_valid_cli_commands() {
    let root = repo_root();
    let pi_extension = fs::read_to_string(
        root.join("runtime")
            .join("scaffolds")
            .join("shells")
            .join(".pi")
            .join("extensions")
            .join("emb-agent.ts"),
    )
    .expect("read pi extension");

    assert!(
        pi_extension.contains("join(cwd, \".pi\", \"emb-agent\", \"bin\", \"emb-agent.cjs\")"),
        "Pi extension must resolve the .pi runtime directory"
    );
    assert!(
        !pi_extension.contains("[\"external\", \"status\"]"),
        "Pi extension must not reference the removed external status command"
    );
    assert!(
        pi_extension.contains("[\"status\", \"--brief\"]"),
        "Pi status command must route through status --brief"
    );
    assert!(
        pi_extension.contains("--target pi") || pi_extension.contains("emb-agent@latest"),
        "Pi init guidance must reference the pi target"
    );
    assert!(
        pi_extension.contains("active_variant")
            && pi_extension.contains("var:${r.project.active_variant}"),
        "Pi widget status must show the active variant"
    );
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn assert_no_markdown_files(dir: PathBuf) {
    if !dir.exists() {
        return;
    }
    for entry in fs::read_dir(&dir).expect("read command dir") {
        let entry = entry.expect("command entry");
        let name = entry.file_name();
        let name = name.to_string_lossy();
        assert!(
            !name.ends_with(".md"),
            "unexpected command file {name} in {dir:?}"
        );
    }
}

fn assert_three_command_files(dir: PathBuf, host: &str) {
    let start = dir.join("emb-start.md");
    let next = dir.join("emb-next.md");
    let finish = dir.join("emb-finish-work.md");
    assert!(start.exists(), "missing {start:?}");
    assert!(next.exists(), "missing {next:?}");
    assert!(finish.exists(), "missing {finish:?}");
    assert!(
        !dir.join("next.md").exists(),
        "legacy next command leaked for {host}"
    );
    assert!(
        !dir.join("onboard.md").exists(),
        "legacy onboard command leaked for {host}"
    );
    assert!(
        !dir.join("emb-onboard.md").exists(),
        "legacy emb-onboard command leaked for {host}"
    );

    let mut exposed = 0;
    for entry in fs::read_dir(&dir).expect("read command shims") {
        let entry = entry.expect("command shim entry");
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("emb-") && name.ends_with(".md") {
            exposed += 1;
        }
    }
    assert_eq!(exposed, 3, "unexpected command shim count for {host}");

    let start_body = fs::read_to_string(start).expect("read start shim");
    assert!(
        start_body.contains("start --brief"),
        "start shim body: {start_body}"
    );
    let next_body = fs::read_to_string(next).expect("read next shim");
    assert!(
        next_body.contains("next --brief"),
        "next shim body: {next_body}"
    );
    let finish_body = fs::read_to_string(finish).expect("read finish-work shim");
    assert!(
        finish_body.contains("finish-work"),
        "finish-work shim body: {finish_body}"
    );
    assert!(
        next_body.contains("Simplified Chinese"),
        "next shim body: {next_body}"
    );
}
fn collect_files_with(dir: &Path, needle: &str, offenders: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read scaffold dir") {
        let entry = entry.expect("scaffold entry");
        let path = entry.path();
        if path.is_dir() {
            collect_files_with(&path, needle, offenders);
        } else if fs::read_to_string(&path)
            .map(|content| content.contains(needle))
            .unwrap_or(false)
        {
            offenders.push(path);
        }
    }
}

fn assert_timestamp_year_is_current(timestamp: &str) {
    let observed_year: i64 = timestamp
        .get(0..4)
        .expect("timestamp year slice")
        .parse()
        .expect("timestamp year");
    assert_eq!(observed_year, current_utc_year(), "timestamp: {timestamp}");
}

fn current_utc_year() -> i64 {
    let mut remaining = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_secs()
        / 86_400;
    let mut year = 1970;
    loop {
        let days = if is_leap_year(year) { 366 } else { 365 };
        if remaining < days {
            return year;
        }
        remaining -= days;
        year += 1;
    }
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[test]
fn knowledge_query_and_explain_accept_named_options_after_cwd() {
    let project = TestProject::new("knowledge");

    fs::create_dir_all(project.path().join(".emb-agent/cache/docs/manual"))
        .expect("create doc cache");
    fs::write(
        project.path().join(".emb-agent/cache/docs/manual/parse.md"),
        "# Native Parsed Manual\n\nU1 watchdog register evidence and low-power notes from parsed PDF.\n",
    )
    .expect("write parsed doc cache");
    fs::write(
        project.path().join(".emb-agent/cache/docs/index.json"),
        r#"{"documents":[{"doc_id":"manual","provider":"mineru","kind":"datasheet","title":"Native Parsed Manual","intended_to":"hardware","parsed":true,"status":"ok","paths":{"markdown":".emb-agent/cache/docs/manual/parse.md","source":"docs/manual.pdf"}}]}"#,
    )
    .expect("write doc index");

    let refresh = run(&project, &["knowledge", "graph", "refresh"]);
    assert!(refresh.contains("native"), "refresh output: {refresh}");
    let index = run(&project, &["knowledge", "index", "--rebuild"]);
    assert!(index.contains("chunks"), "index output: {index}");
    assert!(
        project
            .path()
            .join(".emb-agent/cache/knowledge/embeddings.json")
            .exists(),
        "knowledge embedding cache missing"
    );
    assert!(
        project
            .path()
            .join(".emb-agent/cache/knowledge/manifest.json")
            .exists(),
        "knowledge manifest missing"
    );
    let search = run(
        &project,
        &["knowledge", "search", "--query", "U1", "--rerank"],
    );
    assert!(search.contains("hits"), "search output: {search}");
    assert!(
        search.contains("rerank_provider"),
        "search output: {search}"
    );
    let doc_search = run(
        &project,
        &[
            "knowledge",
            "search",
            "--query",
            "watchdog low-power parsed PDF",
            "--limit",
            "1",
        ],
    );
    assert!(
        doc_search.contains("Native Parsed Manual") && doc_search.contains("doc-parse"),
        "doc cache search output: {doc_search}"
    );
    assert!(
        doc_search.contains("page_start"),
        "doc cache search output: {doc_search}"
    );
    let diagnose = run(&project, &["knowledge", "diagnose"]);
    assert!(
        diagnose.contains("embedding_cache_vectors"),
        "diagnose output: {diagnose}"
    );
    let promote = run(
        &project,
        &[
            "knowledge",
            "promote",
            "--query",
            "watchdog low-power parsed PDF",
        ],
    );
    assert!(promote.contains("dry-run"), "promote output: {promote}");
    assert!(refresh.contains("\"nodes\""), "refresh output: {refresh}");

    let query = run(&project, &["knowledge", "graph", "query", "--q", "U1"]);
    assert!(query.contains("component:U1"), "query output: {query}");

    let explain = run(
        &project,
        &["knowledge", "graph", "explain", "--id", "component:U1"],
    );
    assert!(
        explain.contains("component:U1") && explain.contains("MCU"),
        "explain output: {explain}"
    );
}

#[test]
fn knowledge_documented_commands_are_routable_and_write_expected_artifacts() {
    let project = TestProject::new("knowledge-docs");

    let init = run(&project, &["knowledge", "init"]);
    assert!(init.contains("\"status\": \"ok\""), "init output: {init}");
    assert!(
        project.path().join(".emb-agent/wiki/index.md").exists(),
        "wiki index missing"
    );

    let save = run(
        &project,
        &[
            "knowledge",
            "save-query",
            "--confirm",
            "Watchdog answer",
            "--summary",
            "WDT evidence summary",
            "--body",
            "Use project evidence before changing watchdog code.",
        ],
    );
    assert!(
        save.contains("\"status\": \"applied\""),
        "save output: {save}"
    );
    assert!(
        project
            .path()
            .join(".emb-agent/wiki/queries/watchdog-answer.md")
            .exists(),
        "saved query missing"
    );

    let show = run(&project, &["knowledge", "show", "queries/watchdog-answer"]);
    assert!(
        show.contains("WDT evidence summary") && show.contains("\"content\""),
        "show output: {show}"
    );

    let source = run(
        &project,
        &[
            "knowledge",
            "ingest",
            "--confirm",
            "Manual source",
            "--summary",
            "Parsed manual notes",
            "--link",
            "docs/manual.pdf",
        ],
    );
    assert!(
        source.contains("\"kind\": \"source\"") && source.contains("\"status\": \"applied\""),
        "source output: {source}"
    );

    let tool_output = project.path().join("tool-output.txt");
    fs::write(
        &tool_output,
        "Write PR2 and T2CON.\nPWM_FREQ = FOSC / (4 * (PR2 + 1))\n",
    )
    .expect("write tool output");
    let formula = run(
        &project,
        &[
            "knowledge",
            "formula",
            "draft",
            "--from-tool-output",
            "tool-output.txt",
            "--chip",
            "TESTMCU",
            "--confirm",
        ],
    );
    assert!(
        formula.contains("\"formula_count\": 1") && formula.contains("\"status\": \"applied\""),
        "formula output: {formula}"
    );

    let refresh = run(&project, &["knowledge", "graph", "update"]);
    assert!(
        refresh.contains("\"native\": true"),
        "refresh output: {refresh}"
    );

    let path = run(
        &project,
        &["knowledge", "graph", "path", "component:U1", "net:PWM_OUT"],
    );
    assert!(
        path.contains("\"status\": \"found\"") && path.contains("connected_to"),
        "path output: {path}"
    );

    let graph_lint = run(&project, &["knowledge", "graph", "lint"]);
    assert!(
        graph_lint.contains("\"nodes\"") && graph_lint.contains("\"issue_count\""),
        "graph lint output: {graph_lint}"
    );

    let lint = run(&project, &["knowledge", "lint"]);
    assert!(lint.contains("\"issue_count\""), "lint output: {lint}");
}

#[test]
fn command_docs_are_help_routable() {
    let repo_root = repo_root();
    let commands_dir = repo_root.join("commands").join("emb");

    let bin = emb_agent_bin();
    for entry in fs::read_dir(commands_dir).expect("read command docs") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let command = path.file_stem().and_then(|s| s.to_str()).expect("stem");
        let output = Command::new(&bin)
            .arg(command)
            .arg("--help")
            .output()
            .expect("run command help");
        assert_success(output);
    }
}

#[test]
fn commands_list_guides_without_hiding_full_inventory() {
    let project = TestProject::new("commands-list");

    let guided = run(&project, &["commands", "list"]);
    let guided_value: serde_json::Value = serde_json::from_str(&guided).expect("commands json");
    let guided_commands = guided_value["commands"].as_array().expect("commands array");
    assert!(
        guided_commands
            .iter()
            .any(|entry| entry.as_str().unwrap_or("").contains("start: onboard")),
        "guided output: {guided}"
    );
    assert!(
        !guided_commands
            .iter()
            .any(|entry| entry.as_str().unwrap_or("").contains("variant list")),
        "guided output should keep implementation inventory behind --all: {guided}"
    );

    let full = run(&project, &["commands", "list", "--all"]);
    let full_value: serde_json::Value = serde_json::from_str(&full).expect("commands all json");
    let full_commands = full_value["commands"]
        .as_array()
        .expect("commands all array");
    assert!(
        full_commands
            .iter()
            .any(|entry| entry.as_str().unwrap_or("").contains("variant list")),
        "full output: {full}"
    );
}

#[test]
fn installer_exposes_same_three_shell_commands_per_host() {
    let repo_root = repo_root();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-shell-commands-{nonce}"));
    fs::create_dir_all(&root).expect("create install root");

    for host in [".codex", ".cursor", ".claude", ".windsurf", ".pi", ".omp"] {
        let commands_dir = root.join(host).join("commands");
        fs::create_dir_all(&commands_dir).expect("create stale command dir");
        for stale in [
            "next.md",
            "onboard.md",
            "start.md",
            "finish-work.md",
            "emb-start.md",
            "emb-next.md",
            "emb-onboard.md",
            "emb-ingest.md",
            "emb-finish-work.md",
            "emb-status.md",
            "emb-scan.md",
            "emb-init.md",
        ] {
            fs::write(commands_dir.join(stale), "stale").expect("write stale command");
        }
    }
    let windsurf_workflows = root.join(".windsurf").join("workflows");
    fs::create_dir_all(&windsurf_workflows).expect("create stale workflow dir");
    for stale in [
        "next.md",
        "onboard.md",
        "start.md",
        "finish-work.md",
        "emb-next.md",
        "emb-onboard.md",
        "emb-ingest.md",
    ] {
        fs::write(windsurf_workflows.join(stale), "stale").expect("write stale workflow");
    }
    for skill in ["emb-start", "emb-next", "emb-finish-work", "emb-onboard"] {
        let skill_dir = root.join(".agents").join("skills").join(skill);
        fs::create_dir_all(&skill_dir).expect("create stale codex skill");
        fs::write(skill_dir.join("SKILL.md"), "stale").expect("write stale codex skill");
    }
    fs::create_dir_all(root.join(".emb-agent")).expect("create stale emb-agent dir");
    fs::write(
        root.join(".emb-agent/workflow.md"),
        "# emb-agent Workflow\n\n[workflow-state:concept]\nold concept\n[/workflow-state:concept]\n\n[workflow-state:clarifying]\nold clarify\n[/workflow-state:clarifying]\n\n[workflow-state:ready]\nold ready\n[/workflow-state:ready]\n\n[workflow-state:task_active]\nold active task flow without researcher\n[/workflow-state:task_active]\n\n## Shared Conventions\n\n- Keep hardware truth in `hw.yaml`, product behavior in `req.yaml` plus `docs/prd/`.\n",
    )
    .expect("write stale workflow");
    for base in [
        root.join(".pi/skills/xc8-build"),
        root.join(".agents/skills/xc8-build"),
    ] {
        fs::create_dir_all(base.join("scripts")).expect("create duplicate skill dir");
        fs::write(
            base.join("SKILL.md"),
            "---\nname: xc8-build\ndescription: Build firmware\n---\n",
        )
        .expect("write duplicate skill");
        fs::write(base.join("scripts/build_xc8.py"), "print('ok')\n")
            .expect("write duplicate skill script");
    }
    let stale_graph_key = format!("{}{}_API_KEY", "GRA", "PHIFY");
    fs::write(
        root.join(".env.example"),
        format!(
            "GEMINI_API_KEY=\nDEEPSEEK_API_KEY=\nOLLAMA_BASE_URL=\nHEADROOM_PORT=\nTURBOVEC_ENABLED=\nCODEX_ONLY_TEST=\n{stale_graph_key}=\n"
        ),
    )
    .expect("write stale env example");

    let output = Command::new("node")
        .arg(repo_root.join("bin").join("install.js"))
        .arg("--target")
        .arg("all")
        .arg("--local")
        .arg("--developer")
        .arg("tester")
        .arg("--lang")
        .arg("zh")
        .current_dir(&root)
        .output()
        .expect("run installer");
    assert_success(output);

    let env_example =
        fs::read_to_string(root.join(".env.example")).expect("read installer env example");
    for expected in [
        "MINERU_API_KEY=",
        "EMB_AGENT_EMBEDDING_PROVIDER",
        "EMB_AGENT_EMBEDDING_API_BASE",
        "EMB_AGENT_EMBEDDING_MODEL",
        "EMB_AGENT_RERANK_PROVIDER",
        "EMB_AGENT_RERANK_MODEL",
    ] {
        assert!(
            env_example.contains(expected),
            "installer .env.example missing {expected}: {env_example}"
        );
    }
    assert!(
        !env_example.contains("GEMINI_API_KEY")
            && !env_example.contains("DEEPSEEK_API_KEY")
            && !env_example.contains("OLLAMA_BASE_URL")
            && !env_example.contains("HEADROOM_PORT")
            && !env_example.contains("TURBOVEC_ENABLED")
            && !env_example.contains("CODEX_ONLY")
            && !env_example
                .to_ascii_lowercase()
                .contains(&format!("{}{}", "gra", "phify")),
        "installer .env.example should not include unused legacy env keys: {env_example}"
    );
    assert!(
        !env_example.contains("router.tumuer") && !env_example.contains("api.openai.com"),
        "installer .env.example should not include real embedding URLs: {env_example}"
    );
    assert!(
        !root.join(".env").exists(),
        "installer should create .env.example only, not .env"
    );

    for skill in ["emb-start", "emb-next", "emb-finish-work"] {
        let skill_path = root
            .join(".agents")
            .join("skills")
            .join(skill)
            .join("SKILL.md");
        assert!(skill_path.exists(), "missing Codex skill {skill_path:?}");
    }
    assert!(
        !root.join(".agents/skills/emb-onboard/SKILL.md").exists(),
        "legacy Codex emb-onboard skill should be removed"
    );
    assert!(
        root.join(".pi/skills/xc8-build/SKILL.md").exists(),
        "Pi skill copy should be preserved"
    );
    assert!(
        !root.join(".agents/skills/xc8-build/SKILL.md").exists(),
        "installer should remove identical shared skill duplicate that collides with .pi/skills"
    );
    let codex_next = fs::read_to_string(root.join(".agents/skills/emb-next/SKILL.md"))
        .expect("read Codex next skill");
    assert!(
        codex_next.contains("next --brief"),
        "Codex next skill body: {codex_next}"
    );
    assert!(
        codex_next.contains("Simplified Chinese"),
        "Codex next skill body: {codex_next}"
    );
    assert_no_markdown_files(root.join(".codex").join("commands"));

    let codex_hooks = fs::read_to_string(root.join(".codex").join("hooks.json"))
        .expect("read Codex hooks config");
    assert!(
        codex_hooks.contains("hook session-start --host codex")
            && codex_hooks.contains("PreToolUse")
            && codex_hooks.contains("UserPromptSubmit")
            && codex_hooks.contains("hook tool-guard --host codex")
            && codex_hooks.contains("hook context-monitor --host codex")
            && codex_hooks.contains("ApplyPatch")
            && codex_hooks.contains("apply_patch")
            && codex_hooks.contains("Bash"),
        "Codex hooks config: {codex_hooks}"
    );
    assert!(
        !codex_hooks.contains("{{"),
        "Codex hooks config must not contain unresolved template placeholders: {codex_hooks}"
    );

    for host in [".cursor", ".claude"] {
        assert_three_command_files(root.join(host).join("commands"), host);
    }

    let cursor_hooks = fs::read_to_string(root.join(".cursor").join("hooks.json"))
        .expect("read Cursor hooks config");
    assert!(
        cursor_hooks.contains("sessionStart")
            && cursor_hooks.contains("postToolUse")
            && cursor_hooks.contains("context-monitor --host cursor")
            && cursor_hooks.contains("ApplyPatch")
            && cursor_hooks.contains("MultiEdit")
            && cursor_hooks.contains("ReadFile")
            && cursor_hooks.contains("Glob"),
        "Cursor hooks config: {cursor_hooks}"
    );
    assert!(
        !cursor_hooks.contains("{{"),
        "Cursor hooks config must not contain unresolved template placeholders: {cursor_hooks}"
    );
    assert!(
        root.join(".cursor")
            .join("rules")
            .join("emb-agent-workflow.mdc")
            .exists(),
        "missing installed Cursor workflow rule"
    );
    assert!(
        root.join(".cursor")
            .join("skills")
            .join("emb-agent")
            .join("SKILL.md")
            .exists(),
        "missing installed Cursor emb-agent skill"
    );

    let cursor_doctor = Command::new(emb_agent_bin())
        .arg("doctor")
        .arg("--host")
        .arg("cursor")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run cursor install doctor");
    let cursor_doctor = assert_success(cursor_doctor);
    assert!(
        cursor_doctor.contains("\"host_config_ok\": true"),
        "Cursor doctor output: {cursor_doctor}"
    );

    let codex_doctor = Command::new(emb_agent_bin())
        .arg("doctor")
        .arg("--host")
        .arg("codex")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run codex install doctor");
    let codex_doctor = assert_success(codex_doctor);
    assert!(
        codex_doctor.contains("\"host_config_ok\": true"),
        "Codex doctor output: {codex_doctor}"
    );

    let codex_hook_diag = Command::new("node")
        .arg(root.join(".codex/emb-agent/bin/emb-agent.cjs"))
        .arg("diagnostics")
        .arg("hooks")
        .arg("--host")
        .arg("codex")
        .current_dir(&root)
        .output()
        .expect("run installed codex hook diagnostics");
    let codex_hook_diag = assert_success(codex_hook_diag);
    assert!(
        codex_hook_diag.contains("\"rust_binary_exists\":true"),
        "Codex hook diagnostics output: {codex_hook_diag}"
    );
    assert!(
        codex_hook_diag.contains("\"readiness\""),
        "Codex hook diagnostics output: {codex_hook_diag}"
    );
    assert!(
        codex_hook_diag.contains("/hooks"),
        "Codex hook diagnostics output: {codex_hook_diag}"
    );
    assert!(
        codex_hook_diag.contains(".codex/emb-agent"),
        "Codex hook diagnostics output: {codex_hook_diag}"
    );
    assert!(
        root.join(".codex/emb-agent/agents/researcher.md").exists(),
        "installed Codex runtime must include researcher subagent"
    );
    assert!(
        root.join(".claude/emb-agent/agents/researcher.md").exists(),
        "installed Claude runtime must include researcher subagent"
    );

    let runtime_commands = root
        .join(".codex")
        .join("emb-agent")
        .join("commands")
        .join("emb");
    assert!(
        runtime_commands.join("next.md").exists(),
        "installed command docs must include next"
    );
    assert!(
        runtime_commands.join("onboard.md").exists(),
        "installed command docs must include onboard"
    );
    assert!(
        runtime_commands.join("init-project.md").exists(),
        "installed runtime must keep init-project available"
    );
    assert!(
        runtime_commands.join("bootstrap.md").exists(),
        "installed runtime must keep bootstrap available"
    );
    assert!(
        runtime_commands.join("board.md").exists(),
        "installed runtime must keep board available"
    );

    assert!(
        root.join(".pi").join("emb-agent").exists(),
        "Pi host should receive runtime when enabled"
    );
    assert!(
        root.join(".pi")
            .join("extensions")
            .join("emb-agent.ts")
            .exists(),
        "Pi host should receive extension"
    );
    let pi_settings = fs::read_to_string(root.join(".pi/settings.json")).expect("read pi settings");
    let pi_value: serde_json::Value = serde_json::from_str(&pi_settings).expect("pi settings json");
    assert_eq!(pi_value["embAgent"]["subagents"]["runner"], "native-pi");
    assert_eq!(pi_value["embAgent"]["subagents"]["dispatchMode"], "auto");
    assert!(
        !pi_settings.contains("pi-subagents"),
        "Pi settings should not require third-party subagent packages: {pi_settings}"
    );
    let installed_config = fs::read_to_string(root.join(".emb-agent/config.yaml"))
        .expect("read installed emb-agent config");
    assert!(
        installed_config.contains("dispatch_mode: inline")
            && installed_config.contains("session_start")
            && installed_config.contains("after_create")
            && installed_config.contains("worker_guard"),
        "installed config: {installed_config}"
    );
    let repaired_workflow =
        fs::read_to_string(root.join(".emb-agent/workflow.md")).expect("read workflow");
    assert!(
        repaired_workflow.contains("dispatch `researcher` first")
            && repaired_workflow.contains("tasks/<task>/research/")
            && !repaired_workflow.contains("old active task flow"),
        "repair should refresh managed workflow state blocks: {repaired_workflow}"
    );
    let install_result = fs::read_to_string(root.join(".emb-agent/.install/INSTALL_RESULT.md"))
        .expect("read install result");
    assert!(
        install_result.contains("/emb-start")
            && install_result.contains("/emb-next")
            && install_result.contains("/emb-finish-work")
            && !install_result.contains("/emb-ingest")
            && !install_result.contains("/emb-onboard"),
        "install result: {install_result}"
    );

    for disabled_host in [".windsurf", ".omp"] {
        assert!(
            !root.join(disabled_host).join("emb-agent").exists(),
            "disabled host must not receive a runtime: {disabled_host}"
        );
    }
    assert!(
        !root
            .join(".omp")
            .join("extensions")
            .join("emb-agent.ts")
            .exists(),
        "OMP extension must not be installed when OMP is disabled"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn installer_pi_skill_install_does_not_create_shared_duplicate() {
    let repo_root = repo_root();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-pi-skill-install-{nonce}"));
    let support = root.join("emb-support");
    let skill_dir = support.join("skills/xc8-build");
    fs::create_dir_all(skill_dir.join("scripts")).expect("create local support skill");
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: xc8-build\ndescription: Build firmware\n---\n\n# XC8\n",
    )
    .expect("write local support skill");
    fs::write(skill_dir.join("scripts/build_xc8.py"), "print('ok')\n")
        .expect("write local support skill script");

    let output = Command::new("node")
        .arg(repo_root.join("bin").join("install.js"))
        .arg("--target")
        .arg("pi")
        .arg("--local")
        .arg("--developer")
        .arg("tester")
        .arg("--lang")
        .arg("zh")
        .arg("--skill")
        .arg("xc8-build")
        .env("EMB_SUPPORT_DIR", &support)
        .current_dir(&root)
        .output()
        .expect("run pi installer with skill");
    assert_success(output);

    assert!(
        root.join(".pi/skills/xc8-build/SKILL.md").exists(),
        "Pi host skill should be installed"
    );
    assert!(
        root.join(".emb-agent/plugins/xc8-build/SKILL.md").exists(),
        "runtime plugin copy should be installed"
    );
    assert!(
        !root.join(".agents/skills/xc8-build/SKILL.md").exists(),
        "Pi-only skill install must not create a duplicate shared .agents skill"
    );
}

#[test]
fn installer_pi_settings_merge_preserves_user_config() {
    let repo_root = repo_root();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-pi-settings-{nonce}"));
    fs::create_dir_all(root.join(".pi")).expect("create pi dir");
    fs::write(
        root.join(".pi/settings.json"),
        r#"{
  "packages": ["npm:existing-package", "npm:pi-subagents", "npm:@tintinweb/pi-subagents"],
  "customSetting": { "keep": true },
  "embAgent": {
    "subagents": { "dispatchMode": "off" },
    "subagentModelRoutes": { "hw-scout": { "model": "user/model", "thinking": "low" } }
  },
  "subagents": { "agentOverrides": { "legacy": { "model": "legacy/model" } } }
}
"#,
    )
    .expect("write existing settings");

    let output = Command::new("node")
        .arg(repo_root.join("bin").join("install.js"))
        .arg("--target")
        .arg("pi")
        .arg("--local")
        .current_dir(&root)
        .output()
        .expect("run pi installer");
    assert_success(output);

    let raw = fs::read_to_string(root.join(".pi/settings.json")).expect("read pi settings");
    let value: serde_json::Value = serde_json::from_str(&raw).expect("settings json");
    let packages = value["packages"].as_array().expect("packages array");
    assert!(
        packages.iter().any(|p| p == "npm:existing-package"),
        "settings: {raw}"
    );
    assert!(
        !packages.iter().any(|p| p == "npm:pi-subagents"),
        "settings should remove legacy package: {raw}"
    );
    assert!(
        !packages.iter().any(|p| p == "npm:@tintinweb/pi-subagents"),
        "settings should remove old third-party subagent package: {raw}"
    );
    assert_eq!(value["customSetting"]["keep"], true, "settings: {raw}");
    assert_eq!(
        value["embAgent"]["subagents"]["runner"], "native-pi",
        "settings should keep native runner default: {raw}"
    );
    assert_eq!(
        value["embAgent"]["subagents"]["dispatchMode"], "off",
        "settings should preserve user dispatch mode override: {raw}"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["hw-scout"]["model"], "user/model",
        "settings: {raw}"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["hw-scout"]["thinking"], "low",
        "settings: {raw}"
    );
    assert_eq!(
        value["embAgent"]["subagentModelRoutes"]["sys-reviewer"]["model"], "inherit",
        "settings should merge default inherit routes with user overrides: {raw}"
    );
    assert!(
        value.get("subagents").is_none(),
        "legacy subagent settings should be removed after switching to native emb-agent dispatch: {raw}"
    );
    let install_result = fs::read_to_string(root.join(".emb-agent/.install/INSTALL_RESULT.md"))
        .expect("read install result");
    assert!(
        install_result.contains("/emb-start")
            && install_result.contains("/emb-next")
            && install_result.contains("/emb-finish-work")
            && !install_result.contains("/emb-ingest")
            && !install_result.contains("/emb-onboard"),
        "install result: {install_result}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn task_worktree_lifecycle_smoke() {
    let project = TestProject::new("worktree");
    project.init_git_repo();

    let create = run(&project, &["task", "worktree", "create", "pwm-led"]);
    assert!(
        create.contains("\"created\":true"),
        "create output: {create}"
    );
    assert!(create.contains("pwm-led"), "create output: {create}");

    let status = run(&project, &["task", "worktree", "status", "pwm-led"]);
    assert!(
        status.contains("\"status\": \"ok\"") || status.contains("\"status\":\"ok\""),
        "status output: {status}"
    );
    assert!(status.contains("task/pwm-led"), "status output: {status}");

    let activate = run(&project, &["task", "activate", "pwm-led", "--worktree"]);
    assert!(
        activate.contains("\"worktree\""),
        "activate output: {activate}"
    );

    let cleanup = run(&project, &["task", "worktree", "cleanup", "pwm-led"]);
    assert!(
        cleanup.contains("\"removed\":true"),
        "cleanup output: {cleanup}"
    );
}

#[test]
fn task_delete_tombstones_preserve_data() {
    let project = TestProject::new("tombstone");

    let delete_output = run(&project, &["task", "delete", "schematic-review"]);
    assert!(
        delete_output.contains("\"deleted\":true"),
        "delete output: {delete_output}"
    );
    assert!(
        delete_output.contains("\"tombstone\":true"),
        "delete output: {delete_output}"
    );

    // deleted task hidden from list
    let list = run(&project, &["task", "list"]);
    assert!(
        !list.contains("schematic-review"),
        "should not list deleted: {list}"
    );
    assert!(list.contains("pwm-led"), "pwm-led still present: {list}");

    // cannot activate deleted task
    let activate_deleted = run(&project, &["task", "activate", "schematic-review"]);
    assert!(
        activate_deleted.contains("deleted-tombstone"),
        "activate deleted: {activate_deleted}"
    );
}

#[test]
fn task_blocked_by_shows_dependencies() {
    let project = TestProject::new("depgraph");

    // Create dependent-task depending on pwm-led
    let add_b = run(
        &project,
        &["task", "add", "dependent-task", "--blocked-by", "pwm-led"],
    );
    assert!(add_b.contains("\"created\":true"), "add dependent: {add_b}");

    // Check task show includes dependency info
    let show = run(&project, &["task", "show", "dependent-task"]);
    assert!(show.contains("\"depends_on\""), "show deps: {show}");
    assert!(show.contains("pwm-led"), "show deps: {show}");

    // Check pwm-led now has "blocks" reference
    let show_pwm = run(&project, &["task", "show", "pwm-led"]);
    assert!(show_pwm.contains("\"blocks\""), "show blocks: {show_pwm}");
    assert!(
        show_pwm.contains("dependent-task"),
        "show blocks: {show_pwm}"
    );
}

#[test]
fn task_activate_requires_worktree_when_other_main_session_active() {
    let project = TestProject::new("worktree-policy");
    project.init_git_repo();
    project.write_session_heartbeat("other-session", "schematic-review");

    let status = run(&project, &["task", "worktree", "status", "pwm-led"]);
    assert!(
        status.contains("worktree_policy"),
        "status output: {status}"
    );
    assert!(
        status.contains("another active AI session"),
        "status output: {status}"
    );

    let blocked = run(&project, &["task", "activate", "pwm-led"]);
    assert!(
        blocked.contains("\"status\":\"blocked\""),
        "activate output: {blocked}"
    );
    assert!(
        blocked.contains("worktree-required"),
        "activate output: {blocked}"
    );
    assert!(
        blocked.contains("/emb:task activate pwm-led --worktree"),
        "activate output: {blocked}"
    );

    let activate = run(&project, &["task", "activate", "pwm-led", "--worktree"]);
    assert!(
        activate.contains("\"activated\":true"),
        "activate output: {activate}"
    );
    let _ = run(&project, &["task", "worktree", "cleanup", "pwm-led"]);
}

#[test]
fn status_prefers_session_active_task_over_global_current_task() {
    let project = TestProject::new("session-active-task");
    fs::write(project.path().join(".emb-agent/.current-task"), "pwm-led\n")
        .expect("write global current task");
    project.write_session_heartbeat("s1", "schematic-review");

    let status = run_with_env(
        &project,
        &["status", "--brief"],
        &[("EMB_AGENT_SESSION_ID", "s1")],
    );
    let value: serde_json::Value = serde_json::from_str(&status).expect("status json");
    assert_eq!(value["tasks"]["active"], "schematic-review");
    assert_eq!(value["tasks"]["active_source"], "session:s1");
}

#[test]
fn status_does_not_guess_session_task_when_multiple_sessions_have_no_identity() {
    let project = TestProject::new("session-active-task-multiple");
    fs::write(project.path().join(".emb-agent/.current-task"), "pwm-led\n")
        .expect("write global current task");
    project.write_session_heartbeat("s1", "schematic-review");
    project.write_session_heartbeat("s2", "schematic-review");

    let status = run_with_env(&project, &["status", "--brief"], &[]);
    let value: serde_json::Value = serde_json::from_str(&status).expect("status json");
    assert_eq!(value["tasks"]["active"], "pwm-led");
    assert_eq!(value["tasks"]["active_source"], "global");
}

#[test]
fn hook_statusline_preserves_existing_session_task() {
    let project = TestProject::new("session-heartbeat-preserve");
    fs::write(project.path().join(".emb-agent/.current-task"), "pwm-led\n")
        .expect("write global current task");
    project.write_session_heartbeat("s1", "schematic-review");

    let _ = run_with_env(
        &project,
        &["hook", "statusline", "--host", "codex"],
        &[("EMB_AGENT_SESSION_ID", "s1")],
    );
    let raw = fs::read_to_string(project.path().join(".emb-agent/sessions/s1.json"))
        .expect("read session heartbeat");
    let value: serde_json::Value = serde_json::from_str(&raw).expect("session json");
    assert_eq!(value["task"], "schematic-review");
}

#[test]
fn task_resolve_without_name_uses_session_active_task() {
    let project = TestProject::new("session-active-task-resolve");
    fs::write(project.path().join(".emb-agent/.current-task"), "pwm-led\n")
        .expect("write global current task");
    project.write_session_heartbeat("s1", "schematic-review");

    let output = run_with_env(
        &project,
        &["task", "resolve"],
        &[("EMB_AGENT_SESSION_ID", "s1")],
    );
    let value: serde_json::Value = serde_json::from_str(&output).expect("resolve json");
    assert_eq!(value["task"]["name"], "schematic-review");
    assert_eq!(value["task"]["status"], "completed");

    let pwm_led =
        fs::read_to_string(project.path().join(".emb-agent/tasks/pwm-led/task.json")).unwrap();
    assert!(
        pwm_led.contains("\"status\":\"pending\""),
        "global task should not be resolved: {pwm_led}"
    );
}

#[test]
fn task_archive_moves_task_to_month_archive() {
    let project = TestProject::new("task-archive");

    let output = run(
        &project,
        &["task", "archive", "schematic-review", "--no-commit"],
    );
    let value: serde_json::Value = serde_json::from_str(&output).expect("archive json");
    assert_eq!(value["status"], "ok", "archive output: {output}");
    assert_eq!(value["archived"], true, "archive output: {output}");
    assert!(
        !project
            .path()
            .join(".emb-agent/tasks/schematic-review")
            .exists(),
        "active task directory should be moved"
    );
    let archived_task_json = value["archive"]["task_json"]
        .as_str()
        .expect("archive task_json path");
    let archived = fs::read_to_string(archived_task_json).expect("read archived task");
    let archived_value: serde_json::Value =
        serde_json::from_str(&archived).expect("archived task json");
    assert_eq!(archived_value["status"], "completed");
    assert!(
        archived_value["archivedAt"]
            .as_str()
            .unwrap_or("")
            .contains('T')
    );

    let list = run(&project, &["task", "list"]);
    assert!(
        list.contains("pwm-led") && !list.contains("schematic-review"),
        "task list should hide archived tasks: {list}"
    );
}

#[test]
fn legacy_doc_commands_are_dispatchable() {
    let project = TestProject::new("legacy");

    for command in ["migrate", "skills", "init-project"] {
        let output = run(&project, &[command]);
        assert!(output.contains("\"status\""), "{command} output: {output}");
    }
}

#[test]
fn doc_tree_and_pages_read_cached_pageindex_structure() {
    let project = TestProject::new("doctree");
    let doc_id = "treefix";
    let cache = project
        .path()
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join(doc_id);
    fs::create_dir_all(&cache).expect("create doc cache");

    let structure = r#"{
      "doc_name": "SC8F072 manual",
      "doc_description": "MCU reference manual",
      "structure": [
        {
          "title": "Watchdog Timer (WDT)",
          "node_id": "0001",
          "start_index": 12,
          "end_index": 14,
          "summary": "WDT timeout and reset control",
          "text": "WDT control register WDTCON.",
          "nodes": [
            {
              "title": "WDTCON register",
              "node_id": "0002",
              "start_index": 13,
              "end_index": 14,
              "summary": "",
              "text": "WDTCON bits: PS2:0, ENWDT.",
              "nodes": []
            }
          ]
        }
      ]
    }"#;
    fs::write(cache.join("structure.json"), structure).expect("write structure");
    fs::write(cache.join("pages.json"), r#"[{"page":12,"content":"p12"},{"page":13,"content":"WDTCON bits: PS2:0, ENWDT."},{"page":14,"content":"p14"}]"#)
        .expect("write pages");
    let index = serde_json::json!({
        "documents": [{
            "doc_id": doc_id,
            "provider": "pageindex",
            "kind": "datasheet",
            "title": "SC8F072 manual",
            "intended_to": "hardware",
            "parsed": true,
            "status": "ok",
            "retrieval": "tree",
            "paths": {
                "source": "docs/sc8f072.pdf",
                "markdown": format!(".emb-agent/cache/docs/{doc_id}/parse.md"),
                "structure": format!(".emb-agent/cache/docs/{doc_id}/structure.json"),
                "pages": format!(".emb-agent/cache/docs/{doc_id}/pages.json")
            }
        }]
    });
    fs::write(
        project
            .path()
            .join(".emb-agent")
            .join("cache")
            .join("docs")
            .join("index.json"),
        serde_json::to_string(&index).unwrap(),
    )
    .expect("write index");

    let tree = run(&project, &["doc", "tree", "--doc-id", doc_id]);
    assert!(tree.contains("Watchdog Timer (WDT)"), "tree output: {tree}");
    assert!(tree.contains("\"type\": \"pdf\""), "tree output: {tree}");
    // text fields must be stripped from the tree view
    assert!(!tree.contains("WDTCON bits"), "tree leaked text: {tree}");

    let pages = run(
        &project,
        &["doc", "pages", "--doc-id", doc_id, "--pages", "13-14"],
    );
    assert!(pages.contains("WDTCON bits"), "pages output: {pages}");
    assert!(pages.contains("\"page\": 13"), "pages output: {pages}");

    // doc lookup should surface a tree-section match with page evidence.
    let lookup = run(&project, &["doc", "lookup", "--keyword", "watchdog"]);
    assert!(
        lookup.contains("\"retrieval\": \"tree\""),
        "lookup output: {lookup}"
    );
    assert!(
        lookup.contains("Watchdog Timer"),
        "lookup sections: {lookup}"
    );
    assert!(
        lookup.contains("\"page_start\": 12"),
        "lookup page span: {lookup}"
    );
}

#[test]
fn uninitialized_project_routes_to_onboard() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-uninit-{nonce}"));
    fs::create_dir_all(&root).expect("create uninitialized root");

    let run_raw = |args: &[&str]| -> String {
        let output = Command::new(emb_agent_bin())
            .args(args)
            .arg("--cwd")
            .arg(&root)
            .output()
            .expect("run emb-agent-rs");
        assert_success(output)
    };

    let next = run_raw(&["next", "--brief"]);
    let next_value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(next_value["action"], "onboard", "next output: {next}");
    assert_eq!(
        next_value["agent_protocol"]["gate"]["kind"], "onboarding",
        "next output: {next}"
    );

    let start = run_raw(&["start"]);
    assert!(
        start.contains("Start with onboarding"),
        "start output: {start}"
    );
    assert!(start.contains("emb-start"), "start output: {start}");

    let statusline = run_raw(&["statusline"]);
    assert_eq!(statusline.trim(), "emb · onboard");

    let onboard = run_raw(&["onboard"]);
    let onboard_value: serde_json::Value = serde_json::from_str(&onboard).expect("onboard json");
    assert_eq!(
        onboard_value["action"], "onboard",
        "onboard output: {onboard}"
    );
    assert_eq!(
        onboard_value["path"], "empty-or-migration",
        "onboard output: {onboard}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn initialized_project_without_hardware_still_routes_to_onboard() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-init-no-hw-{nonce}"));
    fs::create_dir_all(&root).expect("create root");

    let output = Command::new(emb_agent_bin())
        .arg("init")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run init");
    assert_success(output);

    let output = Command::new(emb_agent_bin())
        .args(["next", "--brief"])
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run next");
    let next = assert_success(output);
    let next_value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(next_value["action"], "clarify", "next output: {next}");
    assert_eq!(
        next_value["agent_protocol"]["gate"]["kind"], "prd-exploration",
        "next output: {next}"
    );
    assert!(
        next_value["agent_protocol"]["gate"]["method"] == "brainstorm-with-docs"
            && next_value["instructions"]
                .as_str()
                .unwrap_or("")
                .contains("doc-grounded brainstorm loop"),
        "next output: {next}"
    );

    assert!(
        root.join(".emb-agent/ARCHITECTURE.md").exists(),
        "architecture guide missing"
    );
    assert!(
        root.join(".emb-agent/workflow.md").exists(),
        "workflow contract missing"
    );
    assert!(
        root.join(".emb-agent/.developer").exists(),
        "developer marker missing"
    );
    assert!(
        root.join(".emb-agent/.language").exists(),
        "language marker missing"
    );
    assert!(
        root.join(".emb-agent/.template-hashes").exists(),
        "template hashes missing"
    );
    assert!(
        root.join(".emb-agent/.version").exists(),
        "version marker missing"
    );
    let workflow =
        fs::read_to_string(root.join(".emb-agent/workflow.md")).expect("read workflow contract");
    assert!(
        workflow.contains("Shared Conventions") && workflow.contains("Knowledge Evolution"),
        "workflow should include conventions and knowledge guidance: {workflow}"
    );
    assert!(
        workflow.contains("Main-session default")
            && workflow.contains("focused implementation")
            && workflow.contains("independent release/system checker"),
        "workflow should document active task subagent flow: {workflow}"
    );
    for generated_dir in [
        "architecture",
        "reference",
        "cache",
        "graph",
        "wiki",
        "memory",
        "sessions",
        "workspace",
        "compound",
        "chips",
        "issues",
        "refactors",
        "roadmap",
        "audits",
        "extensions",
    ] {
        assert!(
            !root.join(".emb-agent").join(generated_dir).exists(),
            "fresh init should not pre-create empty generated directory: {generated_dir}"
        );
    }

    let _ = fs::remove_dir_all(root);
}

#[test]
fn session_record_creates_workspace_journal_lazily() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-session-record-{nonce}"));
    fs::create_dir_all(&root).expect("create root");

    assert_success(
        Command::new(emb_agent_bin())
            .arg("init")
            .arg("--cwd")
            .arg(&root)
            .output()
            .expect("run init"),
    );
    assert!(
        !root.join(".emb-agent/workspace").exists(),
        "workspace journal should be lazy-created"
    );
    fs::write(root.join(".emb-agent/.developer"), "{\"name\":\"Felix\"}\n")
        .expect("write developer");

    let output = Command::new(emb_agent_bin())
        .args([
            "session",
            "record",
            "--title",
            "Bring up PWM",
            "--summary",
            "Configured PWM timer bring-up notes",
            "--detail",
            "Changed timer init and captured scope evidence",
            "--commit",
            "abc1234",
            "--test",
            "cargo test pwm",
            "--next",
            "Verify duty-cycle limits on hardware",
            "--cwd",
        ])
        .arg(&root)
        .output()
        .expect("run session record");
    let record = assert_success(output);
    let record_value: serde_json::Value =
        serde_json::from_str(&record).expect("session record json");
    assert_eq!(record_value["status"], "ok", "record output: {record}");
    assert_eq!(
        record_value["journal"], ".emb-agent/workspace/felix/journal-1.md",
        "record output: {record}"
    );

    let journal = fs::read_to_string(root.join(".emb-agent/workspace/felix/journal-1.md"))
        .expect("read workspace journal");
    assert!(
        journal.contains("## Session 1: Bring up PWM")
            && journal.contains("Configured PWM timer bring-up notes")
            && journal.contains("Changed timer init")
            && journal.contains("abc1234")
            && journal.contains("cargo test pwm"),
        "journal: {journal}"
    );
    let developer_index = fs::read_to_string(root.join(".emb-agent/workspace/felix/index.md"))
        .expect("read developer workspace index");
    assert!(
        developer_index.contains("Felix Workspace Journal")
            && developer_index.contains("Session 1: Bring up PWM"),
        "developer index: {developer_index}"
    );
    let workspace_index = fs::read_to_string(root.join(".emb-agent/workspace/index.md"))
        .expect("read workspace index");
    assert!(
        workspace_index.contains("[Felix](felix/index.md)") && workspace_index.contains("1"),
        "workspace index: {workspace_index}"
    );

    let history = Command::new(emb_agent_bin())
        .args(["session", "history", "--cwd"])
        .arg(&root)
        .output()
        .expect("run session history");
    let history = assert_success(history);
    assert!(
        history.contains("Workspace Journal") && history.contains("Bring up PWM"),
        "history output: {history}"
    );

    let start_json = Command::new(emb_agent_bin())
        .args(["start", "--json", "--cwd"])
        .arg(&root)
        .output()
        .expect("run start json");
    let start_json = assert_success(start_json);
    let start_value: serde_json::Value = serde_json::from_str(&start_json).expect("start json");
    assert_eq!(start_value["workspace_journal"]["available"], true);
    assert_eq!(
        start_value["workspace_journal"]["title"], "Bring up PWM",
        "start json: {start_json}"
    );
    assert!(
        start_value["workspace_journal"]["next_steps"]
            .as_str()
            .unwrap_or("")
            .contains("Verify duty-cycle limits"),
        "start json: {start_json}"
    );

    let start_context = Command::new(emb_agent_bin())
        .args(["start", "--cwd"])
        .arg(&root)
        .output()
        .expect("run start context");
    let start_context = assert_success(start_context);
    assert!(
        start_context.contains("Recent workspace journal")
            && start_context.contains("Verify duty-cycle limits"),
        "start context: {start_context}"
    );

    let next_json = Command::new(emb_agent_bin())
        .args(["next", "--brief", "--cwd"])
        .arg(&root)
        .output()
        .expect("run next json");
    let next_json = assert_success(next_json);
    let next_value: serde_json::Value = serde_json::from_str(&next_json).expect("next json");
    assert_eq!(next_value["workspace_journal"]["available"], true);
    assert_eq!(
        next_value["workspace_journal"]["title"], "Bring up PWM",
        "next json: {next_json}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn finish_work_records_workspace_journal_and_resolves_active_task() {
    let project = TestProject::new("finish-work");
    let activated = run(&project, &["task", "activate", "pwm-led"]);
    assert!(
        activated.contains("\"status\":\"ok\"") || activated.contains("\"status\": \"ok\""),
        "activate output: {activated}"
    );

    let output = run(
        &project,
        &[
            "finish-work",
            "--summary",
            "PWM dimming implementation is complete",
            "--test",
            "cargo test pwm",
            "--next",
            "Run board acceptance on the LED output",
        ],
    );
    let value: serde_json::Value = serde_json::from_str(&output).expect("finish-work json");
    assert_eq!(value["status"], "ok", "finish-work output: {output}");
    assert_eq!(
        value["journal"]["journal"], ".emb-agent/workspace/developer/journal-1.md",
        "finish-work output: {output}"
    );
    assert_eq!(
        value["task"]["resolve"]["task"]["status"], "completed",
        "finish-work output: {output}"
    );
    assert_eq!(value["task"]["archive_attempted"], true);
    assert_eq!(value["task"]["archive"]["archived"], true);
    assert_eq!(value["follow_ups"][0]["name"], "resource_evidence");
    assert_eq!(value["follow_ups"][0]["status"], "as-needed");
    assert_eq!(value["follow_ups"][0]["handled_by"], "agent-internal");
    assert_eq!(value["follow_ups"][0]["user_action"], "none");
    assert_eq!(value["follow_ups"][1]["name"], "board_evidence");
    assert_eq!(value["follow_ups"][1]["status"], "as-needed");
    assert_eq!(value["follow_ups"][1]["user_action"], "none");
    assert!(
        value["follow_ups"]
            .as_array()
            .expect("follow_ups array")
            .iter()
            .all(|item| item.get("command").is_none()),
        "finish-work follow-ups should not hand users extra commands: {output}"
    );

    let journal = fs::read_to_string(
        project
            .path()
            .join(".emb-agent/workspace/developer/journal-1.md"),
    )
    .expect("read finish-work journal");
    assert!(
        journal.contains("PWM dimming implementation is complete")
            && journal.contains("cargo test pwm")
            && journal.contains("Run board acceptance"),
        "journal: {journal}"
    );

    assert!(
        !project.path().join(".emb-agent/tasks/pwm-led").exists(),
        "finish-work should archive active task"
    );
    let archived_task_json = value["task"]["archive"]["archive"]["task_json"]
        .as_str()
        .expect("archive task_json path");
    let archived_task = fs::read_to_string(archived_task_json).expect("read archived task");
    let archived_value: serde_json::Value =
        serde_json::from_str(&archived_task).expect("archived task json");
    assert_eq!(archived_value["status"], "completed");
    assert!(
        archived_value["archivedAt"]
            .as_str()
            .unwrap_or("")
            .contains('T')
    );

    let start = run(&project, &["start", "--json"]);
    let start_value: serde_json::Value = serde_json::from_str(&start).expect("start json");
    assert_eq!(start_value["workspace_journal"]["available"], true);
    assert!(
        start_value["workspace_journal"]["summary"]
            .as_str()
            .unwrap_or("")
            .contains("PWM dimming implementation is complete"),
        "start json: {start}"
    );
}

#[test]
fn hardware_first_prd_exploration_surfaces_doc_ingest_before_questions() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("emb-agent-hw-first-docs-{nonce}"));
    fs::create_dir_all(&root).expect("create root");

    let output = Command::new(emb_agent_bin())
        .arg("init")
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run init");
    assert_success(output);

    let project_json_path = root.join(".emb-agent/project.json");
    let raw = fs::read_to_string(&project_json_path).expect("read project json");
    let mut project_json: serde_json::Value = serde_json::from_str(&raw).expect("project json");
    project_json["integrations"]["doc_ingest"]["local_tool_priority"] =
        serde_json::json!(["custom-doc-tool", "markitdown"]);
    fs::write(
        &project_json_path,
        serde_json::to_string_pretty(&project_json).expect("project json serialize"),
    )
    .expect("write project json");

    let docs = root.join("docs");
    fs::create_dir_all(&docs).expect("create docs");
    fs::create_dir_all(root.join("datasheets")).expect("create datasheets");
    fs::create_dir_all(root.join("reference")).expect("create reference");
    fs::write(docs.join("board.SchDoc"), b"fixture").expect("write schdoc");
    fs::write(
        docs.join("controller-user-manual.pdf"),
        b"%PDF-1.4\nfixture\n",
    )
    .expect("write pdf");
    fs::write(root.join("SC8F072-datasheet.pdf"), b"%PDF root\n").expect("write root pdf");
    fs::write(root.join("datasheets/vendor-manual.pdf"), b"%PDF ds\n")
        .expect("write datasheet pdf");
    fs::write(root.join("reference/registers.pdf"), b"%PDF ref\n").expect("write reference pdf");

    let output = Command::new(emb_agent_bin())
        .args(["next", "--brief"])
        .arg("--cwd")
        .arg(&root)
        .output()
        .expect("run next");
    let next = assert_success(output);
    let value: serde_json::Value = serde_json::from_str(&next).expect("next json");
    assert_eq!(value["action"], "clarify", "next output: {next}");
    assert!(
        value["hardware_unknown_count"].as_u64().unwrap_or(0) >= 2,
        "next output: {next}"
    );
    let evidence = value["hardware_evidence_files"].as_array().unwrap();
    for expected in [
        "docs/board.SchDoc",
        "SC8F072-datasheet.pdf",
        "datasheets/vendor-manual.pdf",
        "reference/registers.pdf",
    ] {
        assert!(
            evidence.iter().any(|item| item == expected),
            "missing evidence {expected}: {next}"
        );
    }
    assert_eq!(
        value["agent_protocol"]["gate"]["document_evidence_policy"]["hardware_first"], true,
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["document_evidence_policy"]["before_first_question"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "ingest_schematic"),
        "next output: {next}"
    );
    assert_eq!(
        value["agent_protocol"]["gate"]["document_evidence_policy"]["local_pdf_tool_priority"][0],
        "custom-doc-tool",
        "next output: {next}"
    );

    let _ = fs::remove_dir_all(root);
}
