use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_app_lib::sync_workspace::{
    collect_artifact_subdirs, copy_child_directories, select_latest_artifact_dir,
    svn_output_has_conflict,
};

fn temp_fixture_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("dbsearch-sync-{label}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp fixture dir");
    dir
}

#[test]
fn select_latest_artifact_dir_uses_timestamp_directory_names() {
    let root = temp_fixture_dir("latest");
    fs::create_dir_all(root.join("2026-03-14 17-38-50")).unwrap();
    fs::create_dir_all(root.join("2026-03-15 08-01-02")).unwrap();
    fs::create_dir_all(root.join("notes")).unwrap();

    let latest = select_latest_artifact_dir(&root).expect("latest artifact directory");

    assert_eq!(
        latest.file_name().and_then(|value| value.to_str()),
        Some("2026-03-15 08-01-02")
    );
}

#[test]
fn collect_artifact_subdirs_ignores_root_level_files() {
    let root = temp_fixture_dir("subdirs");
    let artifact = root.join("2026-03-15 08-01-02");
    fs::create_dir_all(artifact.join("client")).unwrap();
    fs::create_dir_all(artifact.join("server")).unwrap();
    fs::write(artifact.join("version.json"), "{}").unwrap();

    let subdirs = collect_artifact_subdirs(&artifact).expect("artifact subdirs");

    assert_eq!(subdirs.len(), 2);
    assert!(subdirs.iter().all(|path| path.is_dir()));
    assert!(subdirs.iter().any(|path| path.ends_with("client")));
    assert!(subdirs.iter().any(|path| path.ends_with("server")));
}

#[test]
fn svn_output_has_conflict_detects_summary_and_conflict_markers() {
    assert!(svn_output_has_conflict("C project/file.txt"));
    assert!(svn_output_has_conflict("Summary of conflicts:\n  Text conflicts: 1"));
    assert!(svn_output_has_conflict("tree conflict on assets"));
    assert!(!svn_output_has_conflict("Updated to revision 1024."));
}

#[test]
fn copy_child_directories_overwrites_existing_files() {
    let source_root = temp_fixture_dir("copy-source");
    let target_root = temp_fixture_dir("copy-target");
    let client_dir = source_root.join("client");
    fs::create_dir_all(client_dir.join("nested")).unwrap();
    fs::write(client_dir.join("config.json"), "{\"version\":2}").unwrap();
    fs::write(client_dir.join("nested").join("table.txt"), "new").unwrap();

    fs::create_dir_all(target_root.join("client").join("nested")).unwrap();
    fs::write(target_root.join("client").join("config.json"), "{\"version\":1}").unwrap();
    fs::write(target_root.join("client").join("nested").join("table.txt"), "old").unwrap();

    copy_child_directories(&[client_dir], &target_root).expect("copy child directories");

    assert_eq!(
        fs::read_to_string(target_root.join("client").join("config.json")).unwrap(),
        "{\"version\":2}"
    );
    assert_eq!(
        fs::read_to_string(target_root.join("client").join("nested").join("table.txt")).unwrap(),
        "new"
    );
}
