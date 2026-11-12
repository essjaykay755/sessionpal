use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tempfile::TempDir;

use crate::agents::{claude, codex, cursor, opencode};
use crate::backup;
use crate::models::AgentId;
use crate::paths;

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = fs::File::create(path).unwrap();
    file.write_all(contents.as_bytes()).unwrap();
}

#[test]
fn parses_claude_jsonl_sessions() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("projects").join("demo");
    let file = root.join("session-1.jsonl");
    write(
        &file,
        concat!(
            r#"{"type":"summary","summary":"Fix the flux capacitor","sessionId":"sess-1","timestamp":"2026-11-05T10:00:00.000Z"}"#,
            "\n",
            r#"{"type":"user","uuid":"u1","sessionId":"sess-1","timestamp":"2026-11-05T10:00:01.000Z","cwd":"/tmp/roadster-lab","gitBranch":"main","message":{"role":"user","content":"Let's fix the thruster"}}"#,
            "\n",
            r#"{"type":"assistant","uuid":"a1","sessionId":"sess-1","timestamp":"2026-11-05T10:00:05.000Z","message":{"role":"assistant","model":"claude-sonnet-4-5","content":[{"type":"text","text":"On it."},{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"a.ts"}}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}"#,
            "\n",
            r#"{"type":"user","uuid":"u2","sessionId":"sess-1","timestamp":"2026-11-05T10:00:06.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-1","content":"file contents"}]}}"#,
            "\n",
        ),
    );

    let sessions = claude::scan(&[root]);
    assert_eq!(sessions.len(), 1);
    let summary = &sessions[0];
    assert_eq!(summary.id, "sess-1");
    assert_eq!(summary.title, "Fix the flux capacitor");
    assert_eq!(summary.agent, AgentId::Claude);
    assert_eq!(summary.branch.as_deref(), Some("main"));
    assert_eq!(summary.message_count, 4);
    let usage = summary.usage.as_ref().expect("usage");
    assert_eq!(usage.input, 100);
    assert_eq!(usage.output, 50);
    assert_eq!(usage.cache_read, 1000);
    assert_eq!(usage.cache_write, 200);
    assert_eq!(usage.cost, Some(0.0021));
    assert_eq!(summary.tokens, 1350);
    assert_eq!(summary.usage_days.len(), 1);
    assert_eq!(summary.usage_days[0].input, 100);
    assert!(summary.deletable);

    let detail = claude::detail(&file).unwrap();
    assert_eq!(detail.messages.len(), 4);
    assert_eq!(detail.messages[0].role, "user");
    assert_eq!(detail.messages[1].role, "assistant");
    assert!(detail
        .messages
        .iter()
        .any(|message| { message.role == "tool" && message.tool_name.as_deref() == Some("Read") }));
}

#[test]
fn parses_codex_rollouts_with_token_totals() {
    let temp = TempDir::new().unwrap();
    let root = temp
        .path()
        .join("sessions")
        .join("2026")
        .join("11")
        .join("05");
    let file = root.join("rollout-2026-11-05-demo.jsonl");
    write(
        &file,
        concat!(
            r#"{"timestamp":"2026-11-05T09:00:00.000Z","type":"session_meta","payload":{"id":"codex-1","timestamp":"2026-11-05T09:00:00.000Z","cwd":"/tmp/api-core","git":{"branch":"release"}}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:01.000Z","type":"turn_context","payload":{"cwd":"/tmp/api-core","model":"gpt-5.1-codex"}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Migrate the cache layer"}]}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I'll start with the adapter."}]}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:06.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":\"cargo test\"}","call_id":"call-1"}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:09.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call-1","output":"ok"}}"#,
            "\n",
            r#"{"timestamp":"2026-11-05T09:00:10.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100,"reasoning_output_tokens":20,"total_tokens":1120}}}}"#,
            "\n",
        ),
    );

    let sessions = codex::scan(&[temp.path().join("sessions")]);
    assert_eq!(sessions.len(), 1);
    let summary = &sessions[0];
    assert_eq!(summary.id, "codex-1");
    assert_eq!(summary.title, "Migrate the cache layer");
    assert_eq!(summary.branch.as_deref(), Some("release"));
    assert_eq!(summary.model.as_deref(), Some("gpt-5.1-codex"));
    let usage = summary.usage.as_ref().expect("usage");
    assert_eq!(usage.input, 600);
    assert_eq!(usage.cache_read, 400);
    assert_eq!(usage.output, 100);
    assert_eq!(usage.cost, Some(0.0018));

    let detail = codex::detail(&file).unwrap();
    assert_eq!(detail.messages.len(), 4);
    assert!(detail
        .messages
        .iter()
        .any(|message| message.role == "tool" && message.tool_name.as_deref() == Some("shell")));
}

#[test]
fn parses_opencode_storage() {
    let temp = TempDir::new().unwrap();
    let storage = temp.path().join("storage");
    write(
        &storage.join("project").join("proj-1.json"),
        r#"{"id":"proj-1","worktree":"/tmp/orbit-mobile"}"#,
    );
    let session_path = storage.join("session").join("proj-1").join("ses_123.json");
    write(
        &session_path,
        r#"{"id":"ses_123","projectID":"proj-1","title":"Theme the onboarding","time":{"created":1760000000000,"updated":1760000600000}}"#,
    );
    write(
        &storage.join("message").join("ses_123").join("msg_1.json"),
        r#"{"id":"msg_1","sessionID":"ses_123","role":"assistant","time":{"created":1760000005000},"modelID":"claude-sonnet-4-5","tokens":{"input":200,"output":100,"cache":{"read":0,"write":0}}}"#,
    );
    write(
        &storage.join("part").join("msg_1").join("prt_1.json"),
        r#"{"id":"prt_1","messageID":"msg_1","type":"text","text":"The onboarding palette is ready."}"#,
    );

    let sessions = opencode::scan(&[storage.clone()]);
    assert_eq!(sessions.len(), 1);
    let summary = &sessions[0];
    assert_eq!(summary.id, "ses_123");
    assert_eq!(summary.title, "Theme the onboarding");
    assert_eq!(summary.project, "orbit-mobile");
    assert_eq!(summary.message_count, 1);
    let usage = summary.usage.as_ref().expect("usage");
    assert_eq!(usage.input, 200);
    assert_eq!(usage.cost, Some(0.0021));
    assert!(summary.size_bytes > 0);

    let detail = opencode::detail(&session_path).unwrap();
    assert_eq!(detail.messages.len(), 1);
    assert_eq!(
        detail.messages[0].content,
        "The onboarding palette is ready."
    );

    let related = opencode::related_files(&session_path).unwrap();
    assert!(related.len() >= 3);
}

#[test]
fn opencode_free_model_uses_paid_equivalent_in_both_storage_formats() {
    let dir = TempDir::new().unwrap();
    let storage = dir.path().join("storage");
    write(&storage.join("session/p1/free.json"), r#"{"id":"free","projectID":"p1","title":"Free"}"#);
    write(&storage.join("message/free/m1.json"), r#"{"id":"m1","role":"assistant","modelID":"deepseek-v4.1-flash-free","tokens":{"input":100,"output":50}}"#);
    let sessions = opencode::scan(&[storage]);
    assert_eq!(sessions[0].usage.as_ref().unwrap().cost, Some(0.0001));

    let db = opencode_fixture(dir.path());
    let connection = Connection::open(&db).unwrap();
    connection.execute("UPDATE session_v2 SET model = ?1, cost = 0 WHERE id = 'ses_new'", [r#"{"id":"deepseek-v4.1-flash-free","providerID":"opencode"}"#]).unwrap();
    drop(connection);
    let sessions = opencode::scan(&[db]);
    let session = sessions.iter().find(|session| session.id == "ses_new").unwrap();
    assert_eq!(session.usage.as_ref().unwrap().cost, Some(0.0008));
}

#[test]
fn reads_cursor_database_without_writing() {
    let temp = TempDir::new().unwrap();
    let db = temp.path().join("state.vscdb");
    let connection = Connection::open(&db).unwrap();
    connection
        .execute(
            "CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
            [],
        )
        .unwrap();
    let composer = serde_json::json!({
        "composerId": "composer-1",
        "name": "Cursor composer test",
        "createdAt": 1_760_000_000_000i64,
        "lastUpdatedAt": 1_760_000_300_000i64,
        "workspaceIdentifier": { "uri": "file:///tmp/meridian" }
    });
    let bubble_one = serde_json::json!({
        "bubbleId": "bubble-1",
        "type": 1,
        "text": "Build the spacing scale",
        "createdAt": 1_760_000_010_000i64
    });
    let bubble_two = serde_json::json!({
        "bubbleId": "bubble-2",
        "type": 2,
        "text": "The scale is in the tokens file.",
        "createdAt": 1_760_000_020_000i64,
        "modelInfo": { "modelName": "claude-4.5-sonnet" },
        "tokenCount": { "inputTokens": 300, "outputTokens": 50 }
    });
    connection
        .execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
            ["composerData:composer-1".to_string(), composer.to_string()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
            [
                "bubbleId:composer-1:bubble-1".to_string(),
                bubble_one.to_string(),
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
            [
                "bubbleId:composer-1:bubble-2".to_string(),
                bubble_two.to_string(),
            ],
        )
        .unwrap();
    drop(connection);

    let sessions = cursor::scan(&[db.clone()]);
    assert_eq!(sessions.len(), 1);
    let summary = &sessions[0];
    assert_eq!(summary.id, "composer-1");
    assert_eq!(summary.title, "Cursor composer test");
    assert_eq!(summary.project, "meridian");
    assert_eq!(summary.message_count, 2);
    assert!(!summary.deletable);
    let usage = summary.usage.as_ref().expect("usage");
    assert_eq!(usage.input, 300);
    assert_eq!(usage.output, 50);
    assert_eq!(usage.cost, Some(0.0017));

    let detail = cursor::detail(&db, "composer-1").unwrap();
    assert_eq!(detail.messages.len(), 2);
    assert_eq!(detail.messages[0].role, "user");
    assert_eq!(detail.messages[1].role, "assistant");
}

#[test]
fn rejects_restore_paths_outside_agent_roots() {
    let roots = paths::candidate_roots();
    let outside = PathBuf::from("/tmp/sessionpal-escape.jsonl");
    let result = paths::validate_restore_target(AgentId::Claude, "session", &outside, &roots);
    assert!(result.is_err());

    let traversal = PathBuf::from("/tmp/../etc/sessionpal.jsonl");
    let result = paths::validate_restore_target(AgentId::Claude, "session", &traversal, &roots);
    assert!(result.is_err());
}

/// Local smoke test. Run with:
/// `cargo test discovers_local_agent_storage -- --ignored --nocapture`
/// Prints counts only, never conversation content.
#[test]
#[ignore = "reads the current machine's local agent storage"]
fn discovers_local_agent_storage() {
    let detections = crate::agents::discover();
    for detection in &detections {
        println!(
            "{}: available={} sessions={} roots={}",
            detection.name,
            detection.available,
            detection.session_count,
            detection.roots.len()
        );
    }
    let sessions = crate::agents::list_sessions(None, &crate::models::ProjectAccess::default());
    println!("listed sessions: {}", sessions.len());
    let expected: u64 = detections
        .iter()
        .map(|detection| detection.session_count)
        .sum();
    println!("discovered session files: {expected}");
    if detections.iter().any(|detection| detection.available) {
        assert!(
            !sessions.is_empty(),
            "agent storage was found but no sessions could be listed"
        );
    }
    for session in sessions.iter().take(3) {
        println!(
            "sample: agent={} format={} size={}",
            session.agent.name(),
            session.format,
            session.size_bytes
        );
    }
}

#[test]
fn preserves_model_identity_without_guessing_prices() {
    use crate::pricing::{canonical_model, estimate};
    assert_eq!(canonical_model("claude-opus-5-5"), "claude-opus-5-5");
    assert_eq!(canonical_model("claude-sonnet-5-5"), "claude-sonnet-5-5");
    assert_eq!(canonical_model("gpt-5.4-codex"), "gpt-5.4-codex");
    assert_eq!(estimate("claude-opus-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000), Some(29.2));
    assert_eq!(estimate("gpt-6.1-sol", 1_000_000, 1_000_000, 1_000_000, 1_000_000), Some(14.6));
    assert_eq!(estimate("gpt-6.1-terra", 1_000_000, 1_000_000, 1_000_000, 1_000_000), Some(7.3));
    assert_eq!(estimate("claude-opus-4-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000), Some(36.75));
    assert_eq!(estimate("claude-opus-5-6", 1000, 1000, 0, 0), None);
    assert!(estimate("claude-sonnet-4-5", 1000, 1000, 0, 0).is_some());
    assert!(estimate("claude-opus-5-5", 1, 0, 0, 0).unwrap() > 0.0);
}

#[test]
fn project_display_name_overrides_folder_label_without_changing_slug() {
    let temp = TempDir::new().unwrap();
    let workspace = temp.path().join("old-folder-name");
    write(&workspace.join("package.json"), r#"{"name":"project","displayName":"Project Name"}"#);
    let (slug, label, _, _) = crate::util::project_info(workspace.to_str().unwrap(), "Unknown");
    assert_eq!(slug, "old-folder-name");
    // Parsing alone never reads the folder.
    assert_eq!(label, "Old Folder Name");

    let mut sessions = vec![project_session(workspace.to_str().unwrap(), &slug, &label)];
    crate::projects::assign_project_roots(&mut sessions, &crate::models::ProjectAccess::default());
    assert_eq!(sessions[0].project_label, "Old Folder Name", "no access, no read");
    crate::projects::assign_project_roots(&mut sessions, &crate::models::ProjectAccess::unrestricted());
    assert_eq!(sessions[0].project_label, "Project Name");
    assert_eq!(sessions[0].project_root_label, "Project Name");
    assert_eq!(sessions[0].project, "old-folder-name");

    let (_, fallback, _, _) = crate::util::project_info("/nonexistent/my-project", "Unknown");
    assert_eq!(fallback, "My Project");
}

#[test]
fn codex_titles_follow_session_index_and_fall_back_when_missing() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("sessions");
    let path = root.join("2026/11/05/rollout.jsonl");
    write(&path, concat!(
        r#"{"timestamp":"2026-11-05T09:00:00Z","type":"session_meta","payload":{"id":"thread-1","cwd":"/tmp/demo"}}"#, "\n",
        r#"{"timestamp":"2026-11-05T09:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Original prompt"}]}}"#, "\n",
    ));
    assert_eq!(codex::scan(&[root.clone()])[0].title, "Original prompt");
    write(&temp.path().join("session_index.jsonl"), concat!(
        r#"{"id":"thread-1","thread_name":"Original title"}"#, "\n",
        "invalid json\n",
        r#"{"id":"thread-1","thread_name":"Renamed conversation"}"#, "\n",
        r#"{"id":"other","thread_name":"Unrelated"}"#, "\n",
    ));
    assert_eq!(codex::scan(&[root])[0].title, "Renamed conversation");
    assert_eq!(codex::detail(&path).unwrap().summary.title, "Renamed conversation");
}

fn claude_line(session_id: &str, uuid: &str, text: &str) -> String {
    format!(
        r#"{{"type":"user","uuid":"{uuid}","sessionId":"{session_id}","timestamp":"2026-11-05T10:00:01.000Z","cwd":"/tmp/roadster-lab","message":{{"role":"user","content":"{text}"}}}}"#
    )
}

/// A Cursor database with one chat plus data that must never leave the machine.
fn cursor_fixture(db: &Path) {
    let connection = Connection::open(db).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
             CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
        )
        .unwrap();
    let composer = serde_json::json!({
        "composerId": "composer-1",
        "name": "Cursor composer test",
        "createdAt": 1_760_000_000_000i64,
        "lastUpdatedAt": 1_760_000_300_000i64,
    });
    let bubble = serde_json::json!({
        "bubbleId": "bubble-1",
        "type": 1,
        "text": "Build the spacing scale",
        "createdAt": 1_760_000_010_000i64
    });
    for (table, key, value) in [
        ("ItemTable", "cursorAuth/accessToken", "secret-token".to_string()),
        ("cursorDiskKV", "composerData:composer-1", composer.to_string()),
        ("cursorDiskKV", "bubbleId:composer-1:bubble-1", bubble.to_string()),
        ("cursorDiskKV", "checkpointId:composer-1:x", "{}".to_string()),
    ] {
        connection
            .execute(
                &format!("INSERT INTO {table} (key, value) VALUES (?1, ?2)"),
                [key.to_string(), value],
            )
            .unwrap();
    }
}

#[test]
fn cursor_backups_hold_only_chat_rows() {
    let temp = TempDir::new().unwrap();
    let db = temp.path().join("state.vscdb");
    cursor_fixture(&db);
    let snapshot = temp.path().join("snapshot.vscdb");
    backup::snapshot_cursor_chats(&db, &snapshot).unwrap();

    let connection = Connection::open(&snapshot).unwrap();
    let item_table: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'ItemTable'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(item_table, 0, "settings and tokens must not be archived");
    let mut keys: Vec<String> = connection
        .prepare("SELECT key FROM cursorDiskKV ORDER BY key")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        vec!["bubbleId:composer-1:bubble-1", "composerData:composer-1"]
    );
    // The snapshot is still readable as a Cursor chat library.
    assert_eq!(cursor::scan(&[snapshot]).len(), 1);
}

#[test]
fn restore_adds_missing_files_and_never_overwrites() {
    let temp = TempDir::new().unwrap();
    let claude_root = temp.path().join("claude").join("projects");
    let session = claude_root.join("-tmp-roadster").join("sess-1.jsonl");
    let original = format!("{}\n", claude_line("sess-1", "u1", "Fix the thruster"));
    write(&session, &original);
    let cursor_db = temp.path().join("cursor").join("state.vscdb");
    fs::create_dir_all(cursor_db.parent().unwrap()).unwrap();
    cursor_fixture(&cursor_db);
    let cursor_before = fs::read(&cursor_db).unwrap();

    let roots = paths::AgentRoots {
        claude: vec![claude_root.clone()],
        cursor: vec![cursor_db.clone()],
        ..Default::default()
    };
    let mut sessions = claude::scan(&roots.claude);
    sessions.extend(cursor::scan(&roots.cursor));
    assert_eq!(sessions.len(), 2);

    let backups = temp.path().join("backups");
    fs::create_dir_all(&backups).unwrap();
    let record = backup::create_backup_in(
        &backups,
        "test".to_string(),
        vec![AgentId::Claude, AgentId::Cursor],
        sessions,
        &roots,
    )
    .unwrap();
    let archive = PathBuf::from(&record.path);
    // Claude's file comes back on restore; Cursor's chat rows are archive-only.
    assert_eq!(record.archive_only_agents, vec![AgentId::Cursor]);
    assert_eq!(record.restorable_files, 1);
    let manifest = backup::read_manifest(&archive).unwrap();

    // A deleted session comes back.
    fs::remove_file(&session).unwrap();
    let result = backup::restore_archive(&backups, &archive, &manifest, &roots).unwrap();
    assert_eq!(result.restored, 1);
    assert_eq!(result.skipped_read_only, 1);
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    assert_eq!(fs::read_to_string(&session).unwrap(), original);

    // Restoring again over an identical file is a no-op.
    let result = backup::restore_archive(&backups, &archive, &manifest, &roots).unwrap();
    assert_eq!(result.unchanged, 1);
    assert_eq!(result.restored, 0);

    // A session that continued after the backup is kept, not rolled back.
    let continued = format!("{original}{}\n", claude_line("sess-1", "u2", "And the gimbal"));
    write(&session, &continued);
    let result = backup::restore_archive(&backups, &archive, &manifest, &roots).unwrap();
    assert_eq!(result.kept_local, 1);
    assert_eq!(result.restored, 0);
    assert_eq!(fs::read_to_string(&session).unwrap(), continued);

    // Cursor's live database is never written to.
    assert_eq!(fs::read(&cursor_db).unwrap(), cursor_before);
}

#[cfg(unix)]
#[test]
fn restore_refuses_paths_through_symlinked_folders() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("projects");
    let outside = temp.path().join("outside");
    fs::create_dir_all(root.join("real")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
    std::os::unix::fs::symlink(temp.path().join("missing"), root.join("dangling")).unwrap();
    let roots = paths::AgentRoots {
        claude: vec![root.clone()],
        ..Default::default()
    };

    let inside = root.join("real").join("new-folder").join("a.jsonl");
    assert!(paths::validate_restore_target(AgentId::Claude, "session", &inside, &roots).is_ok());
    let escaped = root.join("escape").join("a.jsonl");
    assert!(paths::validate_restore_target(AgentId::Claude, "session", &escaped, &roots).is_err());
    let dangling = root.join("dangling").join("a.jsonl");
    assert!(paths::validate_restore_target(AgentId::Claude, "session", &dangling, &roots).is_err());
}

#[test]
fn opencode_delete_only_touches_its_own_session() {
    let temp = TempDir::new().unwrap();
    let storage = temp.path().join("storage");
    for id in ["ses_a", "ses_b"] {
        write(
            &storage.join("session").join("proj").join(format!("{id}.json")),
            &format!(r#"{{"id":"{id}","title":"{id}"}}"#),
        );
        write(
            &storage.join("message").join(id).join(format!("msg_{id}.json")),
            &format!(r#"{{"id":"msg_{id}","sessionID":"{id}","role":"user"}}"#),
        );
        write(
            &storage.join("part").join(format!("msg_{id}")).join("prt_1.json"),
            r#"{"type":"text","text":"hi"}"#,
        );
    }

    opencode::remove_session(&storage.join("session").join("proj").join("ses_a.json")).unwrap();

    assert!(!storage.join("message").join("ses_a").exists());
    assert!(!storage.join("part").join("msg_ses_a").exists());
    assert!(storage.join("session").join("proj").join("ses_b.json").exists());
    assert!(storage.join("message").join("ses_b").exists());
    assert!(storage.join("part").join("msg_ses_b").exists());
}

#[test]
fn colliding_session_ids_become_unique_and_stable() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("projects").join("demo");
    write(&root.join("one.jsonl"), &claude_line("sess-dup", "u1", "first"));
    write(&root.join("two.jsonl"), &claude_line("sess-dup", "u2", "second"));
    write(&root.join("three.jsonl"), &claude_line("sess-solo", "u3", "third"));

    let ids = || {
        let mut sessions = claude::scan(&[root.clone()]);
        crate::agents::make_ids_unique(&mut sessions);
        let mut ids: Vec<(String, String)> = sessions
            .into_iter()
            .map(|session| (session.path, session.id))
            .collect();
        ids.sort();
        ids
    };
    let first = ids();
    let unique: std::collections::HashSet<&String> = first.iter().map(|(_, id)| id).collect();
    assert_eq!(unique.len(), 3);
    assert!(first.iter().any(|(_, id)| id == "sess-solo"));
    for (_, id) in first.iter().filter(|(_, id)| id.starts_with("sess-dup")) {
        assert_eq!(crate::agents::source_id(id), "sess-dup");
    }
    assert_eq!(first, ids(), "IDs must not change between scans");
}

#[test]
fn rescans_pick_up_changed_transcripts() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("projects").join("cache");
    let file = root.join("sess-cache.jsonl");
    write(&file, &format!("{}\n", claude_line("sess-cache", "u1", "first")));
    assert_eq!(claude::scan(&[root.clone()])[0].message_count, 1);
    // Unchanged file: served from the cache with the same result.
    assert_eq!(claude::scan(&[root.clone()])[0].message_count, 1);

    write(
        &file,
        &format!(
            "{}\n{}\n",
            claude_line("sess-cache", "u1", "first"),
            claude_line("sess-cache", "u2", "second")
        ),
    );
    assert_eq!(claude::scan(&[root.clone()])[0].message_count, 2);

    fs::remove_file(&file).unwrap();
    assert!(claude::scan(&[root]).is_empty());
}

/// Builds a backup of one Claude session stored under `home/.claude/projects`.
fn claude_backup(home: &Path, backups: &Path) -> (PathBuf, crate::models::BackupManifest, String) {
    let root = home.join(".claude").join("projects");
    let content = format!("{}\n", claude_line("sess-port", "u1", "portable"));
    write(&root.join("-tmp-roadster").join("sess-port.jsonl"), &content);
    let roots = paths::AgentRoots {
        claude: vec![root.clone()],
        ..Default::default()
    };
    fs::create_dir_all(backups).unwrap();
    let record = backup::create_backup_in(
        backups,
        "portable".to_string(),
        vec![AgentId::Claude],
        claude::scan(&roots.claude),
        &roots,
    )
    .unwrap();
    let archive = PathBuf::from(record.path);
    let manifest = backup::read_manifest(&archive).unwrap();
    (archive, manifest, content)
}

#[test]
fn backups_restore_on_another_machine() {
    let temp = TempDir::new().unwrap();
    let backups = temp.path().join("backups");
    let (archive, mut manifest, content) = claude_backup(&temp.path().join("alice"), &backups);
    assert_eq!(
        manifest.files[0].relative_path.as_deref(),
        Some("-tmp-roadster/sess-port.jsonl")
    );

    // Another user's home: the recorded absolute path is outside every root here.
    let bob_root = temp.path().join("bob").join(".claude").join("projects");
    fs::create_dir_all(&bob_root).unwrap();
    let bob = paths::AgentRoots {
        claude: vec![bob_root.clone()],
        ..Default::default()
    };
    let result = backup::restore_archive(&backups, &archive, &manifest, &bob).unwrap();
    assert_eq!(result.restored, 1, "{:?}", result.errors);
    let restored = bob_root.join("-tmp-roadster").join("sess-port.jsonl");
    assert_eq!(fs::read_to_string(&restored).unwrap(), content);

    // Archives made before relative paths were recorded still relocate.
    fs::remove_file(&restored).unwrap();
    manifest.files[0].relative_path = None;
    let result = backup::restore_archive(&backups, &archive, &manifest, &bob).unwrap();
    assert_eq!(result.restored, 1, "{:?}", result.errors);
    assert!(restored.exists());
}

#[test]
fn imports_backups_once() {
    let temp = TempDir::new().unwrap();
    let (archive, manifest, _) =
        claude_backup(&temp.path().join("alice"), &temp.path().join("exported"));
    let library = temp.path().join("library");
    fs::create_dir_all(&library).unwrap();

    let record = backup::import_backup_into(&library, &archive).unwrap();
    assert_eq!(record.id, manifest.id);
    assert!(Path::new(&record.path).starts_with(&library));
    assert!(backup::import_backup_into(&library, &archive).is_err());

    let not_a_backup = temp.path().join("random.zip");
    write(&not_a_backup, "not a zip");
    assert!(backup::import_backup_into(&library, &not_a_backup).is_err());
}

#[test]
fn migrates_backups_from_the_old_app_folder() {
    let temp = TempDir::new().unwrap();
    let legacy = temp.path().join("com.sessionden.desktop").join("backups");
    let current = temp.path().join("com.sessionpal.desktop").join("backups");
    write(&legacy.join("old.zip"), "a");
    write(&legacy.join("same.zip"), "legacy");
    write(&legacy.join("notes.txt"), "skip");
    write(&current.join("same.zip"), "current");

    assert_eq!(backup::migrate_backups_between(&legacy, &current), 1);
    assert!(current.join("old.zip").exists());
    assert_eq!(fs::read_to_string(current.join("same.zip")).unwrap(), "current");
    assert!(!current.join("notes.txt").exists());
}

#[test]
fn agent_injected_messages_are_recognised() {
    use crate::util::is_injected_context;
    for text in [
        "# AGENTS.md instructions for /Users/me/project\n\n<INSTRUCTIONS>",
        "<environment_context>\n  <cwd>/tmp</cwd>",
        "<turn_aborted> The user interrupted the previous turn",
        "<task-notification>\n<task-id>abc</task-id>",
        "<command-name>/compact</command-name>",
        "  <system-reminder>hello</system-reminder>",
        "<INSTRUCTIONS>\nfollow these</INSTRUCTIONS>",
    ] {
        assert!(is_injected_context(text), "{text:?} should be context");
    }
    for text in [
        "Audit the public pages",
        "<div> is rendering twice, why?",
        "<permissionsless> is not a tag we know",
        "# Plan for today",
        "[Request interrupted by user]",
    ] {
        assert!(!is_injected_context(text), "{text:?} should stay visible");
    }
}

fn opencode_fixture(dir: &Path) -> PathBuf {
    let db = dir.join("opencode.db");
    let connection = Connection::open(&db).unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
                directory TEXT, title TEXT, version TEXT, model TEXT, cost REAL DEFAULT 0,
                tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
                tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0,
                tokens_cache_write INTEGER DEFAULT 0, time_created INTEGER, time_updated INTEGER);
            CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
                time_created INTEGER, time_updated INTEGER, data TEXT);
            CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
                directory TEXT, title TEXT, version TEXT, model TEXT, cost REAL DEFAULT 0,
                tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
                tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0,
                tokens_cache_write INTEGER DEFAULT 0, time_created INTEGER, time_updated INTEGER);
            CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
                time_updated INTEGER, data TEXT);
            CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
                time_created INTEGER, time_updated INTEGER, data TEXT);
            CREATE TABLE credential (id TEXT, secret TEXT);
            INSERT INTO credential VALUES ('openai', 'sk-test-secret');

            INSERT INTO session_v2 VALUES ('ses_new', 'p1', NULL, 'a', '/tmp/geekx', 'Audit pages', '2',
                '{"id":"gpt-5","providerID":"openai"}', 0.5, 1200, 300, 50, 4000, 0,
                1793823026067, 1793852726378);
            INSERT INTO session_message VALUES ('m1', 'ses_new', 'user', 1, 1793823026067, 1793823026067,
                '{"text":"Check the public pages","time":{"created":1793823026067}}');
            INSERT INTO session_message VALUES ('m2', 'ses_new', 'assistant', 2, 1793823027000, 1793823027000,
                '{"model":{"id":"gpt-5"},"content":[{"type":"reasoning","text":"thinking"},
                  {"type":"tool","id":"t1","name":"bash","state":{"status":"completed","input":{"command":"ls"},
                   "content":[{"type":"text","text":"index.html"}]}},
                  {"type":"text","text":"The pages look fine."}]}');

            -- Also in the new table, so the legacy copy must be skipped.
            INSERT INTO session VALUES ('ses_new', 'p1', NULL, 'a', '/tmp/geekx', 'Audit pages', '1',
                NULL, 0, 0, 0, 0, 0, 0, 1793823026067, 1793852726378);
            INSERT INTO session VALUES ('ses_old', 'p1', NULL, 'b', '/tmp/old', 'Old chat', '1',
                NULL, 0, 10, 5, 0, 0, 0, 1787296678912, 1787296679912);
            INSERT INTO message VALUES ('om1', 'ses_old', 1787296678912, 1787296678912,
                '{"role":"user","time":{"created":1787296678912}}');
            INSERT INTO part VALUES ('op1', 'om1', 'ses_old', 1787296678912, 1787296678912,
                '{"type":"text","text":"Hello from the old schema"}');
            "#,
        )
        .unwrap();
    db
}

#[test]
fn reads_opencode_sessions_from_its_database() {
    use crate::agents::opencode_db;
    let dir = TempDir::new().unwrap();
    let db = opencode_fixture(dir.path());

    let mut sessions = opencode::scan(&[db.clone()]);
    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    let ids: Vec<&str> = sessions.iter().map(|session| session.id.as_str()).collect();
    assert_eq!(ids, ["ses_new", "ses_old"]);
    assert_eq!(opencode::count_sessions(&[db.clone()]), 2);

    let current = &sessions[0];
    assert_eq!(current.title, "Audit pages");
    assert_eq!(current.message_count, 2);
    assert_eq!(current.excerpt, "The pages look fine.");
    assert!(!current.deletable, "database sessions are read-only");
    let usage = current.usage.as_ref().unwrap();
    assert_eq!((usage.input, usage.output, usage.cache_read), (1200, 350, 4000));

    let detail = opencode_db::detail(&db, "ses_new").unwrap();
    let roles: Vec<&str> = detail.messages.iter().map(|m| m.role.as_str()).collect();
    assert_eq!(roles, ["user", "tool", "tool", "assistant"]);
    assert_eq!(detail.messages[2].content, "index.html");

    let old = opencode_db::detail(&db, "ses_old").unwrap();
    assert_eq!(old.messages[0].content, "Hello from the old schema");

    let snapshot = dir.path().join("snapshot.db");
    opencode_db::snapshot_chats(&db, &snapshot).unwrap();
    let copy = Connection::open(&snapshot).unwrap();
    let credentials: i64 = copy
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'credential'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(credentials, 0, "credentials must never be copied");
    let copied: i64 = copy
        .query_row("SELECT COUNT(*) FROM session_message", [], |row| row.get(0))
        .unwrap();
    assert_eq!(copied, 2);
}


/// Protobuf wire encoding for the Antigravity fixture.
fn pb_varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn pb_number(field: u64, value: u64, out: &mut Vec<u8>) {
    pb_varint(field << 3, out);
    pb_varint(value, out);
}

fn pb_bytes(field: u64, value: &[u8], out: &mut Vec<u8>) {
    pb_varint((field << 3) | 2, out);
    pb_varint(value.len() as u64, out);
    out.extend_from_slice(value);
}

fn antigravity_generation(model: &str, input: u64, output: u64, cached: u64) -> Vec<u8> {
    let mut usage = Vec::new();
    pb_number(1, 1402, &mut usage);
    pb_number(2, input, &mut usage);
    pb_number(3, output, &mut usage);
    pb_number(5, cached, &mut usage);
    let mut generation = Vec::new();
    pb_bytes(4, &usage, &mut generation);
    pb_bytes(19, model.as_bytes(), &mut generation);
    let mut outer = Vec::new();
    pb_bytes(1, &generation, &mut outer);
    outer
}

fn antigravity_fixture(dir: &Path) -> PathBuf {
    let index = dir.join("conversation_summaries.db");
    let connection = Connection::open(&index).unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT,
                step_count INTEGER, last_modified_time DATETIME, workspace_uris TEXT,
                parent_conversation_id TEXT, nesting_depth INTEGER);
            CREATE TABLE conversations_fts_content (id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6,
                c7, c8, c9, c10, c11, c12, c13, c14);
            INSERT INTO conversation_summaries VALUES ('conv-1', 'Fix Login Flow', 'Fix Login Flow', 6,
                '2026-10-28 06:00:19.308342+00:00', '["file:///tmp/My%20App"]', '', 0);
            INSERT INTO conversation_summaries VALUES ('conv-sub', '', '<original_task>', 2,
                '2026-10-28 05:00:00+00:00', '["file:///tmp/My%20App"]', 'conv-1', 1);
            INSERT INTO conversations_fts_content (c0, c1, c8, c9, c13, c14) VALUES
                ('conv-1', -1, NULL, NULL, '', '');
            "#,
        )
        .unwrap();
    // Offsets are byte positions; each step's text ends with a newline.
    let user = "Fix the login page ✨\nAlso add tests";
    let agent = "\nLooking at the form.\nDone, tests pass.";
    let user_offsets = format!("[[0,0],[4,{}]]", "Fix the login page ✨\n".len());
    let agent_offsets = "[[1,0],[2,1],[3,22]]";
    connection
        .execute(
            "INSERT INTO conversations_fts_content (c0, c1, c8, c9, c13, c14) VALUES ('conv-1', 0, ?1, ?2, ?3, ?4)",
            rusqlite::params![user_offsets.as_bytes(), agent_offsets.as_bytes(), user, agent],
        )
        .unwrap();
    drop(connection);

    let conversations = dir.join("conversations");
    fs::create_dir_all(&conversations).unwrap();
    for (id, model, input) in [("conv-1", "claude-opus-5-5-high", 1000), ("conv-sub", "gemini-3.8-flash", 500)] {
        let db = Connection::open(conversations.join(format!("{id}.db"))).unwrap();
        db.execute_batch("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);")
            .unwrap();
        db.execute(
            "INSERT INTO gen_metadata (idx, data, size) VALUES (0, ?1, 0)",
            [antigravity_generation(model, input, 200, 5000)],
        )
        .unwrap();
    }
    fs::write(conversations.join("conv-old.pb"), [0x26, 0x0f, 0x82]).unwrap();
    index
}

#[test]
fn reads_antigravity_conversations() {
    use crate::agents::antigravity;
    let dir = TempDir::new().unwrap();
    let index = antigravity_fixture(dir.path());

    let sessions = antigravity::scan(&[index.clone()]);
    assert_eq!(sessions.len(), 1, "sub-agent runs fold into their parent");
    assert_eq!(antigravity::count_sessions(&[index.clone()]), 1);
    let session = &sessions[0];
    assert_eq!(session.title, "Fix Login Flow");
    assert_eq!(session.cwd, "/tmp/My App");
    assert_eq!(session.updated_at, "2026-10-28T06:00:19.308Z");
    assert!(!session.deletable);
    assert_eq!(session.models, ["claude-opus-5-5", "gemini-3.8-flash"]);
    let usage = session.usage.as_ref().unwrap();
    assert_eq!((usage.input, usage.output, usage.cache_read), (1500, 400, 10_000));
    assert!(usage.cost.is_some(), "Claude generations are priced");

    let detail = antigravity::detail(&index, "conv-1").unwrap();
    let transcript: Vec<(&str, &str)> = detail
        .messages
        .iter()
        .map(|message| (message.role.as_str(), message.content.as_str()))
        .collect();
    assert_eq!(
        transcript,
        [
            ("user", "Fix the login page ✨"),
            ("assistant", "Looking at the form.\n\nDone, tests pass."),
            ("user", "Also add tests"),
        ]
    );

    let related = antigravity::related_files(&index, "conv-1");
    let kinds: Vec<&str> = related.iter().map(|file| file.kind.as_str()).collect();
    assert_eq!(kinds, ["antigravity-index", "antigravity-conversation", "antigravity-conversation"]);

    let snapshot = dir.path().join("snapshot.db");
    antigravity::snapshot("antigravity-index", &index, &snapshot).unwrap();
    let copy = Connection::open(&snapshot).unwrap();
    let rows: i64 = copy
        .query_row("SELECT COUNT(*) FROM conversation_summaries", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 2);
}

#[cfg(unix)]
#[test]
fn opens_a_closed_wal_database_without_writing() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let folder = dir.path().join("store");
    fs::create_dir_all(&folder).unwrap();
    let db = folder.join("app.db");
    {
        let connection = Connection::open(&db).unwrap();
        connection
            .execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept');")
            .unwrap();
    }
    // The app has quit: no -shm file, and nothing may be created beside the database.
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o555)).unwrap();
    let result = crate::agents::sqlite::open_read_only(&db, "test").and_then(|connection| {
        connection
            .query_row("SELECT v FROM t", [], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())
    });
    let leftovers: Vec<_> = fs::read_dir(&folder).unwrap().flatten().map(|entry| entry.file_name()).collect();
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(result.unwrap(), "kept");
    assert_eq!(leftovers.len(), 1, "no sidecar files were created");
}

#[test]
fn codex_usage_is_split_by_the_day_it_happened() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("sessions").join("2026").join("11").join("02");
    let file = root.join("rollout-2026-11-02-days.jsonl");
    write(
        &file,
        concat!(
            r#"{"timestamp":"2026-11-02T12:00:00.000Z","type":"session_meta","payload":{"id":"codex-days","cwd":"/tmp/api-core"}}"#,
            "\n",
            r#"{"timestamp":"2026-11-02T12:00:01.000Z","type":"turn_context","payload":{"model":"gpt-5.1-codex"}}"#,
            "\n",
            r#"{"timestamp":"2026-11-02T12:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Day one"}]}}"#,
            "\n",
            r#"{"timestamp":"2026-11-02T12:00:10.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":100}}}}"#,
            "\n",
            r#"{"timestamp":"2026-11-04T12:00:10.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":500,"output_tokens":300}}}}"#,
            "\n",
        ),
    );

    let sessions = codex::scan(&[temp.path().join("sessions")]);
    let summary = &sessions[0];
    let days = &summary.usage_days;
    assert_eq!(days.len(), 2);
    assert_eq!((days[0].input, days[0].cache_read, days[0].output), (600, 400, 100));
    assert_eq!((days[1].input, days[1].cache_read, days[1].output), (400, 100, 200));
    let usage = summary.usage.as_ref().unwrap();
    assert_eq!(days.iter().map(|day| day.input).sum::<u64>(), usage.input);
    assert_eq!(summary.tokens, 1800);
}

#[test]
fn pricing_catalog_is_shared_and_complete() {
    assert_eq!(crate::pricing::catalog_len(), 19);
    // Dated snapshots resolve to their base model; unknown models stay unpriced.
    assert_eq!(
        crate::pricing::estimate("claude-sonnet-4-5-20250929", 1_000_000, 0, 0, 0),
        Some(3.0)
    );
    assert_eq!(crate::pricing::estimate("some-unknown-model", 1, 1, 1, 1), None);
    assert_eq!(crate::pricing::estimate("claude-haiku-5-5", 1_000_000, 0, 0, 0), Some(0.1));
    assert_eq!(crate::pricing::estimate_opencode("deepseek-v4.1-flash-free", 1_000_000, 0, 0, 0), Some(0.3));
    assert_eq!(crate::pricing::estimate_opencode("deepseek-v4.1-flash", 100, 100, 100, 100), None);
    assert_eq!(crate::pricing::estimate("future-model-free", 100, 100, 100, 100), None);
}

fn project_session(cwd: &str, project: &str, label: &str) -> crate::models::SessionSummary {
    crate::models::SessionSummary {
        timing: None,
        id: format!("{cwd}-{project}"),
        agent: AgentId::Claude,
        title: String::new(),
        excerpt: String::new(),
        project: project.to_string(),
        project_label: label.to_string(),
        project_root: String::new(),
        project_root_label: String::new(),
        cwd: cwd.to_string(),
        branch: None,
        created_at: String::new(),
        updated_at: String::new(),
        message_count: 0,
        tokens: 0,
        size_bytes: 0,
        model: None,
        models: Vec::new(),
        usage: None,
        usage_days: Vec::new(),
        format: "jsonl".to_string(),
        path: String::new(),
        deletable: true,
        tint: "sage".to_string(),
        icon: "Folder".to_string(),
    }
}

#[test]
fn project_roots_follow_repositories_and_worktrees() {
    let temp = TempDir::new().unwrap();
    let base = fs::canonicalize(temp.path()).unwrap();
    let repo = base.join("work").join("roadster");
    fs::create_dir_all(repo.join(".git").join("worktrees").join("feature")).unwrap();
    fs::create_dir_all(repo.join("packages").join("web")).unwrap();
    // A linked worktree outside the repository.
    let linked = base.join("trees").join("roadster-feature");
    write(
        &linked.join(".git"),
        &format!("gitdir: {}\n", repo.join(".git/worktrees/feature").display()),
    );
    write(&repo.join(".git/worktrees/feature/commondir"), "../..\n");
    // A submodule is a project of its own.
    let sub = repo.join("vendor").join("engine");
    fs::create_dir_all(repo.join(".git/modules/engine")).unwrap();
    write(&sub.join(".git"), &format!("gitdir: {}\n", repo.join(".git/modules/engine").display()));
    // An unversioned folder.
    let loose = base.join("scratch");
    fs::create_dir_all(&loose).unwrap();

    let home = Some(base.as_path());
    let root = |path: &Path| crate::projects::git_root(path, home);
    assert_eq!(root(&repo), Some(repo.clone()));
    assert_eq!(root(&repo.join("packages/web")), Some(repo.clone()));
    assert_eq!(root(&linked), Some(repo.clone()));
    // A deleted worktree nested in the repo still resolves through its ancestors.
    assert_eq!(root(&repo.join(".claude/worktrees/gone")), Some(repo.clone()));
    assert_eq!(root(&sub), Some(sub.clone()));
    assert_eq!(root(&loose), None);

    // A repo in the home folder does not claim folders below it.
    fs::create_dir_all(base.join(".git")).unwrap();
    assert_eq!(root(&loose), None);
    assert_eq!(root(&base), Some(base.clone()));
}

#[test]
fn project_root_labels_are_disambiguated_and_grouped() {
    let temp = TempDir::new().unwrap();
    let base = fs::canonicalize(temp.path()).unwrap();
    let work = base.join("work").join("api");
    let personal = base.join("personal").join("api");
    fs::create_dir_all(work.join(".git")).unwrap();
    fs::create_dir_all(personal.join("src")).unwrap();
    fs::create_dir_all(work.join("server")).unwrap();

    let mut sessions = vec![
        project_session(work.to_str().unwrap(), "api", "Api"),
        project_session(work.join("server").to_str().unwrap(), "server", "Server"),
        project_session(personal.to_str().unwrap(), "api", "Api"),
        project_session("", "codex", "Codex"),
    ];
    crate::projects::assign_project_roots(&mut sessions, &crate::models::ProjectAccess::unrestricted());

    assert_eq!(sessions[0].project_root, sessions[1].project_root);
    assert_eq!(sessions[1].project_root_label, "Api · work");
    assert_eq!(sessions[2].project_root_label, "Api · personal");
    assert_ne!(sessions[0].project_root, sessions[2].project_root);
    // Folder slugs are untouched so existing filters keep working.
    assert_eq!(sessions[1].project, "server");
    assert_eq!(sessions[3].project_root, "");
    assert_eq!(sessions[3].project_root_label, "Codex");
}

#[test]
fn protected_folders_are_detected_and_never_read_without_consent() {
    use crate::models::ProjectAccess;
    use crate::projects::protected_folder;
    let home = Path::new("/Users/someone");
    let docs = Path::new("/Users/someone/Documents/code/app");
    assert_eq!(
        protected_folder(docs, Some(home), true).map(|(name, _)| name),
        Some("Documents".to_string())
    );
    assert_eq!(
        protected_folder(Path::new("/Volumes/Work/repo"), Some(home), true),
        Some(("Work".to_string(), PathBuf::from("/Volumes/Work")))
    );
    assert_eq!(
        protected_folder(Path::new("/Users/someone/Library/Mobile Documents/x"), Some(home), true)
            .map(|(name, _)| name),
        Some("iCloud Drive".to_string())
    );
    assert!(protected_folder(Path::new("/Users/someone/code/app"), Some(home), true).is_none());
    assert!(protected_folder(docs, Some(home), false).is_none(), "only macOS protects folders");

    // A repository inside a folder the user has not allowed stays unread:
    // its working folder is the root even though a .git exists above it.
    let temp = TempDir::new().unwrap();
    let base = fs::canonicalize(temp.path()).unwrap();
    let repo = base.join("repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::create_dir_all(repo.join("web")).unwrap();
    let cwd = repo.join("web");
    let mut sessions = vec![project_session(cwd.to_str().unwrap(), "web", "Web")];
    crate::projects::assign_project_roots(&mut sessions, &ProjectAccess { inspect: false, allowed_folders: vec![] });
    assert_eq!(PathBuf::from(&sessions[0].project_root), cwd);
    crate::projects::assign_project_roots(&mut sessions, &ProjectAccess { inspect: true, allowed_folders: vec![] });
    assert_eq!(PathBuf::from(&sessions[0].project_root), repo, "unprotected folders need only inspect");
}

#[test]
fn folder_access_groups_cwds_without_reading_unless_asked() {
    let home = dirs::home_dir().unwrap();
    let cwds = vec![
        home.join("Documents/a").to_string_lossy().to_string(),
        "~/Documents/b".to_string(),
        home.join("Desktop/c").to_string_lossy().to_string(),
        "/tmp/elsewhere".to_string(),
        String::new(),
    ];
    let folders = crate::projects::folder_access(&cwds, false);
    if cfg!(target_os = "macos") {
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].name, "Documents");
        assert_eq!(folders[0].sessions, 2);
        assert_eq!(folders[0].path, "~/Documents");
        assert!(folders.iter().all(|folder| folder.status == "unknown"));
    } else {
        assert!(folders.is_empty());
    }
}

#[test]
fn summary_cache_rescans_only_when_a_watched_file_changes() {
    use std::cell::Cell;
    use crate::scan_cache::{sqlite_files, SummaryCache};

    let temp = TempDir::new().unwrap();
    let db = temp.path().join("state.db");
    write(&db, "one");
    let cache = SummaryCache::new("test");
    let runs = Cell::new(0);
    let scan = || {
        runs.set(runs.get() + 1);
        vec![project_session("/tmp/a", "a", "a")]
    };

    assert_eq!(cache.get_or_scan(&db, &sqlite_files(&db), scan).len(), 1);
    assert_eq!(cache.get_or_scan(&db, &sqlite_files(&db), scan).len(), 1);
    assert_eq!(runs.get(), 1, "an unchanged source is served from the cache");

    // A new write-ahead log means new rows, even though the database is untouched.
    write(&temp.path().join("state.db-wal"), "pending");
    cache.get_or_scan(&db, &sqlite_files(&db), scan);
    assert_eq!(runs.get(), 2);

    write(&db, "one plus more");
    cache.get_or_scan(&db, &sqlite_files(&db), scan);
    assert_eq!(runs.get(), 3);
}

/// Times a full scan of this machine's real agent storage using the on-disk
/// cache in `SESSIONPAL_CACHE_DIR`. Run twice to see a relaunch:
/// `SESSIONPAL_CACHE_DIR=/tmp/sp cargo test --release timed_real_scan -- --ignored --nocapture`
#[test]
#[ignore]
fn timed_real_scan() {
    let dir = std::env::var("SESSIONPAL_CACHE_DIR").expect("set SESSIONPAL_CACHE_DIR");
    crate::scan_cache::init(PathBuf::from(dir));
    for agent in AgentId::ALL {
        let started = std::time::Instant::now();
        let count = crate::agents::list_sessions(Some(&[agent]), &crate::models::ProjectAccess::default()).len();
        println!("  {agent:?}: {count} in {:?}", started.elapsed());
    }
    let started = std::time::Instant::now();
    let sessions = crate::agents::list_sessions(None, &crate::models::ProjectAccess::default());
    println!("scanned {} sessions in {:?}", sessions.len(), started.elapsed());
    let started = std::time::Instant::now();
    crate::agents::discover();
    println!("discovered agents in {:?}", started.elapsed());
}

fn text_message(id: &str, role: &str, content: &str) -> crate::models::Message {
    crate::models::Message {
        id: id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        timestamp: String::new(),
        model: None,
        tool_name: None,
        tool_detail: None,
        tool_status: None,
        tokens: None,
    }
}

#[test]
fn searches_conversation_text_and_keeps_the_index_current() {
    use crate::search;
    use std::cell::Cell;

    let index = search::memory_index();
    let mut first = project_session("/tmp/a", "alpha", "Alpha");
    first.id = "s1".into();
    first.updated_at = "2026-11-01T10:00:00Z".into();
    let mut second = project_session("/tmp/b", "beta", "Beta");
    second.id = "s2".into();
    second.agent = AgentId::Codex;
    second.updated_at = "2026-11-02T10:00:00Z".into();

    let loads = Cell::new(0);
    let load = |session: &crate::models::SessionSummary| {
        loads.set(loads.get() + 1);
        Ok(match session.id.as_str() {
            "s1" => vec![
                text_message("m1", "user", "Why does the WebSocket reconnect loop forever?"),
                text_message("m2", "assistant", "The backoff resets on every failed handshake."),
                text_message("m3", "tool", "websocket.ts: 120 lines"),
                text_message("m4", "user", "<environment_context>websocket cwd</environment_context>"),
            ],
            _ => vec![text_message("m1", "assistant", "Café menu rendering is fixed.")],
        })
    };

    search::sync_with(&index, &[first.clone(), second.clone()], &load);
    assert_eq!(loads.get(), 2);

    let hits = search::search_in(&index, "websocket", Some(10)).unwrap();
    assert_eq!(hits.len(), 1, "tool output and injected context are not indexed");
    assert_eq!(hits[0].id, "s1");
    assert_eq!(hits[0].message_id, "m1");
    assert_eq!(hits[0].matches, 1);
    assert!(hits[0].snippet.contains("\u{1}WebSocket\u{2}"));

    // Prefixes and accents match; every word must be in the same message.
    assert_eq!(search::search_in(&index, "handsh backoff", Some(10)).unwrap()[0].message_id, "m2");
    assert_eq!(search::search_in(&index, "cafe", Some(10)).unwrap()[0].agent, AgentId::Codex);
    assert!(search::search_in(&index, "websocket backoff", Some(10)).unwrap().is_empty());
    assert!(search::search_in(&index, "  \"* ", Some(10)).unwrap().is_empty());
    // A single character matches only that word, not every word it starts.
    assert_eq!(search::fts_query("i backo").as_deref(), Some("\"i\" AND \"backo\"*"));
    assert!(search::search_in(&index, "w", Some(10)).unwrap().is_empty());

    // Unchanged conversations are not read again; removed ones leave the index.
    search::sync_with(&index, &[first.clone()], &load);
    assert_eq!(loads.get(), 2);
    assert!(search::search_in(&index, "cafe", Some(10)).unwrap().is_empty());

    // A changed conversation is re-read and its old text replaced.
    first.updated_at = "2026-11-03T10:00:00Z".into();
    let reload = |_: &crate::models::SessionSummary| Ok(vec![text_message("m9", "user", "Totally new topic")]);
    search::sync_with(&index, &[first], &reload);
    assert!(search::search_in(&index, "websocket", Some(10)).unwrap().is_empty());
    assert_eq!(search::search_in(&index, "topic", Some(10)).unwrap()[0].message_id, "m9");
}


#[test]
fn search_keeps_indexed_text_when_a_conversation_cannot_be_read() {
    use crate::search;
    use std::cell::Cell;

    let index = search::memory_index();
    let mut session = project_session("/tmp/a", "alpha", "Alpha");
    session.id = "s1".into();
    session.updated_at = "2026-11-01T10:00:00Z".into();
    let ok = |_: &crate::models::SessionSummary| Ok(vec![text_message("m1", "user", "Original gimbal notes")]);
    search::sync_with(&index, &[session.clone()], &ok);

    // The conversation changes but cannot be read right now: the old text stays.
    session.updated_at = "2026-11-02T10:00:00Z".into();
    let failures = Cell::new(0);
    let failing = |_: &crate::models::SessionSummary| {
        failures.set(failures.get() + 1);
        Err::<Vec<crate::models::Message>, String>("busy".into())
    };
    search::sync_with(&index, &[session.clone()], &failing);
    assert_eq!(search::search_in(&index, "gimbal", None).unwrap()[0].message_id, "m1");

    // It is tried again on the next scan, even though its summary is the same.
    search::sync_with(&index, &[session.clone()], &failing);
    assert_eq!(failures.get(), 2);
    let fixed = |_: &crate::models::SessionSummary| Ok(vec![text_message("m2", "user", "Rewritten thruster notes")]);
    search::sync_with(&index, &[session.clone()], &fixed);
    assert!(search::search_in(&index, "gimbal", None).unwrap().is_empty());
    assert_eq!(search::search_in(&index, "thruster", None).unwrap()[0].message_id, "m2");

    // A new conversation that cannot be read is retried too.
    let mut fresh = project_session("/tmp/b", "beta", "Beta");
    fresh.id = "s2".into();
    search::sync_with(&index, &[session.clone(), fresh.clone()], &failing);
    let later = |summary: &crate::models::SessionSummary| {
        Ok(vec![text_message("m1", "user", if summary.id == "s2" { "Late reactor log" } else { "Rewritten thruster notes" })])
    };
    search::sync_with(&index, &[session, fresh], &later);
    assert_eq!(search::search_in(&index, "reactor", None).unwrap()[0].id, "s2");
}

#[test]
fn search_returns_every_matching_conversation() {
    use crate::search;

    let index = search::memory_index();
    let mut sessions = Vec::new();
    for number in 0..300 {
        let mut session = project_session("/tmp/a", "alpha", "Alpha");
        session.id = format!("s{number}");
        sessions.push(session);
    }
    // One very chatty conversation must not crowd out the rest.
    let load = |session: &crate::models::SessionSummary| {
        let count = if session.id == "s0" { 5000 } else { 1 };
        Ok((0..count)
            .map(|index| text_message(&format!("m{index}"), "user", "common deploy step"))
            .collect())
    };
    search::sync_with(&index, &sessions, &load);

    let hits = search::search_in(&index, "deploy", None).unwrap();
    assert_eq!(hits.len(), 300);
    assert_eq!(hits.iter().find(|hit| hit.id == "s0").unwrap().matches, 5000);
    assert!(hits.iter().all(|hit| hit.snippet.contains("\u{1}deploy\u{2}")));
    assert_eq!(search::search_in(&index, "deploy", Some(5)).unwrap().len(), 5);
}

#[test]
fn codex_timing_summary_and_detail_agree_without_counting_admin_events() {
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("sessions/timing.jsonl");
    let lines = [
        serde_json::json!({"type":"session_meta","timestamp":"2026-11-01T00:00:00Z","payload":{"id":"timing","cwd":"/tmp/timing"}}),
        serde_json::json!({"type":"event_msg","timestamp":"2026-11-05T09:00:00Z","payload":{"type":"task_started","turn_id":"t"}}),
        serde_json::json!({"type":"event_msg","timestamp":"2026-11-05T09:00:05Z","payload":{"type":"task_complete","turn_id":"t","duration_ms":5000,"time_to_first_token_ms":250}}),
    ];
    write(&file, &lines.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n"));
    let scanned = codex::scan(&[temp.path().join("sessions")]);
    let detail = codex::detail(&file).unwrap();
    let timing = scanned[0].timing.as_ref().unwrap();
    assert_eq!(timing.elapsed_ms, Some(5000));
    assert_eq!(timing.entries.len(), 1);
    assert_eq!(serde_json::to_value(&detail.summary.timing).unwrap(), serde_json::to_value(&scanned[0].timing).unwrap());
}

#[test]
fn opencode_file_timing_is_explicit_and_reparsed_after_source_changes() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("storage");
    let session = root.join("session/p/s.json");
    let message = root.join("message/s/m.json");
    write(&session, r#"{"id":"s","projectID":"p","time":{"created":1793823026000,"updated":1793823036000}}"#);
    write(&message, r#"{"id":"m","role":"assistant","time":{"created":1793823026000}}"#);
    let initial = opencode::scan(&[root.clone()]);
    assert!(initial[0].timing.as_ref().unwrap().entries.is_empty());
    write(&message, r#"{"id":"m","role":"assistant","time":{"created":1793823026000,"completed":1793823036000}}"#);
    let rescanned = opencode::scan(&[root]);
    let timing = rescanned[0].timing.as_ref().unwrap();
    assert_eq!(timing.entries[0].kind, "response");
    assert_eq!(timing.entries[0].duration_ms, 10000);
    assert_eq!(serde_json::to_value(&opencode::detail(&session).unwrap().summary.timing).unwrap(), serde_json::to_value(timing).unwrap());
}

#[test]
fn opencode_both_database_schemas_preserve_response_timing() {
    use crate::agents::opencode_db;
    let temp = TempDir::new().unwrap();
    let db = opencode_fixture(temp.path());
    let connection = Connection::open(&db).unwrap();
    connection.execute("UPDATE session_message SET data = json_set(data, '$.time.created', 1793823027000, '$.time.completed', 1793823032000) WHERE id = 'm2'", []).unwrap();
    connection.execute("INSERT INTO message VALUES ('om2', 'ses_old', 1787296680000, 1787296685000, ?1)", [r#"{"role":"assistant","time":{"created":1787296680000,"completed":1787296685000}}"#]).unwrap();
    connection.execute("INSERT INTO part VALUES ('op2', 'om2', 'ses_old', 1787296680000, 1787296685000, ?1)", [r#"{"type":"text","text":"Done"}"#]).unwrap();
    for session in opencode_db::scan(&db) {
        let timing = session.timing.as_ref().unwrap();
        assert_eq!(timing.entries.len(), 1);
        assert_eq!(timing.entries[0].duration_ms, 5000);
        assert_eq!(timing.entries[0].kind, "response");
        assert_eq!(serde_json::to_value(&opencode_db::detail(&db, &session.id).unwrap().summary.timing).unwrap(), serde_json::to_value(timing).unwrap());
    }
}

#[test]
fn cursor_timing_never_uses_composer_fallback_or_synthetic_bubbles() {
    let temp = TempDir::new().unwrap();
    let db = temp.path().join("state.vscdb");
    cursor_fixture(&db);
    let connection = Connection::open(&db).unwrap();
    connection.execute("UPDATE cursorDiskKV SET value = json_remove(value, '$.createdAt') WHERE key LIKE 'bubbleId:%'", []).unwrap();
    assert!(cursor::scan(&[db.clone()])[0].timing.is_none());
    connection.execute("UPDATE cursorDiskKV SET value = json_set(value, '$.createdAt', 1760000010000, '$.synthetic', json('true')) WHERE key LIKE 'bubbleId:%'", []).unwrap();
    assert!(cursor::scan(&[db.clone()])[0].timing.is_none());
    connection.execute("UPDATE cursorDiskKV SET value = json_remove(value, '$.synthetic') WHERE key LIKE 'bubbleId:%'", []).unwrap();
    let sessions = cursor::scan(&[db]);
    assert_eq!(sessions[0].timing.as_ref().unwrap().event_count, 1);
    assert_eq!(sessions[0].timing.as_ref().unwrap().elapsed_ms, None);
}

#[test]
fn claude_undated_and_injected_messages_do_not_use_file_times() {
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("undated.jsonl");
    write(&file, concat!(
        r#"{"type":"user","uuid":"u","message":{"content":"hello"}}"#, "\n",
        r#"{"type":"user","uuid":"ctx","timestamp":"2026-11-05T09:00:00Z","message":{"content":"<environment_context>injected</environment_context>"}}"#,
    ));
    assert!(claude::detail(&file).unwrap().summary.timing.is_none());
}
