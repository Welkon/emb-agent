use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
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
    }
}

impl Drop for TestProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
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
    assert_eq!(created["next"], "task brief", "task add output: {output}");

    let task_name = created["task"]["name"].as_str().expect("task name");
    let shown = run(&project, &["task", "show", task_name]);
    let task: serde_json::Value = serde_json::from_str(&shown).expect("task show json");
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
        value["agent_protocol"]["gate"]["method"], "triage-agent-brief-vertical-slice",
        "next output: {next}"
    );
    assert!(
        value["agent_protocol"]["gate"]["required_brief_fields"]
            .as_array()
            .map(|items| items.iter().any(|item| item == "acceptance_criteria"))
            .unwrap_or(false),
        "next output: {next}"
    );
}

#[test]
fn doctor_reports_stale_host_runtime_versions() {
    let project = TestProject::new("stale-runtime");
    fs::write(
        project.path().join(".emb-agent/runtime-version.json"),
        r#"{"version":"0.5.0","hosts":[{"name":"omp","version":"0.5.0"}]}"#,
    )
    .expect("write runtime version");
    let omp_runtime = project.path().join(".omp/emb-agent");
    fs::create_dir_all(omp_runtime.join("bin")).expect("create omp runtime bin");
    fs::create_dir_all(project.path().join(".omp/extensions")).expect("create omp extension dir");
    fs::write(omp_runtime.join("VERSION"), "0.4.0\n").expect("write old version");
    fs::write(omp_runtime.join("bin/emb-agent.cjs"), "// wrapper\n").expect("write wrapper");
    fs::write(omp_runtime.join("bin/emb-agent-rs"), "").expect("write rust bin marker");
    fs::write(
        project.path().join(".omp/extensions/emb-agent.ts"),
        "// extension\n",
    )
    .expect("write extension");

    let output = run(&project, &["doctor", "--host", "omp", "--brief"]);
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
        next_value["agent_protocol"]["gate"]["method"] == "grill-with-docs"
            && next_value["instructions"]
                .as_str()
                .unwrap_or("")
                .contains("state-machine checklist"),
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
        pi_extension.contains("npx emb-agent --target pi"),
        "Pi init guidance must reference the pi target"
    );
    assert!(
        pi_extension.contains("active_variant")
            && pi_extension.contains("var:${r.project.active_variant}"),
        "Pi widget status must show the active variant"
    );
}

#[test]
fn omp_extension_widget_shows_active_variant() {
    let root = repo_root();
    let omp_extension = fs::read_to_string(
        root.join("runtime")
            .join("scaffolds")
            .join("shells")
            .join(".omp")
            .join("extensions")
            .join("emb-agent.ts"),
    )
    .expect("read omp extension");

    assert!(
        omp_extension.contains("active_variant") && omp_extension.contains("var:"),
        "OMP widget status must show the active variant"
    );
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn occurrences(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
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

fn assert_two_command_files(dir: PathBuf, host: &str) {
    let next = dir.join("emb-next.md");
    let onboard = dir.join("emb-onboard.md");
    assert!(next.exists(), "missing {next:?}");
    assert!(onboard.exists(), "missing {onboard:?}");
    assert!(
        !dir.join("next.md").exists(),
        "legacy next command leaked for {host}"
    );
    assert!(
        !dir.join("onboard.md").exists(),
        "legacy onboard command leaked for {host}"
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
    assert_eq!(exposed, 2, "unexpected command shim count for {host}");

    let next_body = fs::read_to_string(next).expect("read next shim");
    assert!(
        next_body.contains("next --brief"),
        "next shim body: {next_body}"
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

    let refresh = run(&project, &["knowledge", "graph", "refresh"]);
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
fn installer_exposes_same_two_shell_commands_per_host() {
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
            "emb-next.md",
            "emb-onboard.md",
            "emb-status.md",
            "emb-scan.md",
            "emb-init.md",
        ] {
            fs::write(commands_dir.join(stale), "stale").expect("write stale command");
        }
    }
    let windsurf_workflows = root.join(".windsurf").join("workflows");
    fs::create_dir_all(&windsurf_workflows).expect("create stale workflow dir");
    for stale in ["next.md", "onboard.md", "emb-next.md", "emb-onboard.md"] {
        fs::write(windsurf_workflows.join(stale), "stale").expect("write stale workflow");
    }
    for skill in ["emb-next", "emb-onboard"] {
        let skill_dir = root.join(".agents").join("skills").join(skill);
        fs::create_dir_all(&skill_dir).expect("create stale codex skill");
        fs::write(skill_dir.join("SKILL.md"), "stale").expect("write stale codex skill");
    }

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

    for skill in ["emb-next", "emb-onboard"] {
        let skill_path = root
            .join(".agents")
            .join("skills")
            .join(skill)
            .join("SKILL.md");
        assert!(skill_path.exists(), "missing Codex skill {skill_path:?}");
    }
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

    for host in [".cursor", ".claude"] {
        assert_two_command_files(root.join(host).join("commands"), host);
    }

    // windsurf is disabled in shells.json; skip cleanup assertions

    let runtime_commands = root
        .join(".omp")
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

    // pi is disabled in shells.json; only check omp
    for host in [".omp"] {
        let commands_dir = root.join(host).join("commands");
        assert!(
            !commands_dir.join("emb-next.md").exists(),
            "extension host must not duplicate emb-next file for {host}"
        );
        assert!(
            !commands_dir.join("emb-onboard.md").exists(),
            "extension host must not duplicate emb-onboard file for {host}"
        );
        if commands_dir.exists() {
            for entry in fs::read_dir(&commands_dir).expect("read extension command dir") {
                let entry = entry.expect("extension command entry");
                let name = entry.file_name();
                let name = name.to_string_lossy();
                assert!(
                    !name.ends_with(".md"),
                    "extension host must not expose native command file {name} for {host}"
                );
            }
        }

        let extension = fs::read_to_string(root.join(host).join("extensions").join("emb-agent.ts"))
            .expect("read installed extension");
        assert_eq!(
            occurrences(&extension, "registerCommand("),
            2,
            "extension command count for {host}"
        );
        assert!(
            extension.contains("registerCommand(\"emb-next\""),
            "missing emb-next registration for {host}"
        );
        assert!(
            extension.contains("registerCommand(\"emb-onboard\""),
            "missing emb-onboard registration for {host}"
        );
    }

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
fn legacy_doc_commands_are_dispatchable() {
    let project = TestProject::new("legacy");

    for command in ["migrate", "skills", "init-project"] {
        let output = run(&project, &[command]);
        assert!(output.contains("\"status\""), "{command} output: {output}");
    }
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
    assert!(start.contains("emb-onboard"), "start output: {start}");

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
        next_value["agent_protocol"]["gate"]["method"] == "grill-with-docs"
            && next_value["instructions"]
                .as_str()
                .unwrap_or("")
                .contains("doc-grounded grilling loop"),
        "next output: {next}"
    );

    let shared = root.join(".emb-agent/reference/shared-conventions.md");
    let knowledge = root.join(".emb-agent/reference/knowledge-evolution.md");
    assert!(shared.exists(), "shared conventions missing");
    assert!(knowledge.exists(), "knowledge evolution missing");

    let _ = fs::remove_dir_all(root);
}
