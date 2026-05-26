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

    let next = run(&project, &["next", "--json"]);
    assert!(next.contains("\"status\""), "next output: {next}");
    assert!(next.contains("task_candidates"), "next output: {next}");
    assert!(next.contains("pwm-led"), "next output: {next}");
    assert!(
        next.contains("Do not ask the user to run a list command"),
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
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf();
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
