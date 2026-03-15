use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const SYNC_TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H-%M-%S";
pub const SYNC_PROGRESS_EVENT: &str = "sync-workspace-progress";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SyncProfile {
    pub id: String,
    pub name: String,
    pub script_executable_path: String,
    pub output_root: String,
    pub target_path: String,
    pub last_run_status: String,
    pub last_run_at: Option<String>,
    pub last_run_summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
    pub profile_id: String,
    pub step: String,
    pub status: String,
    pub message: String,
    pub detail: Option<String>,
    pub command: Option<String>,
    pub path: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunOutcome {
    pub profile_id: String,
    pub status: String,
    pub summary: String,
    pub artifact_dir: Option<String>,
    pub synced_directories: Vec<String>,
}

pub fn parse_artifact_timestamp(name: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(name, SYNC_TIMESTAMP_FORMAT).ok()
}

pub fn select_latest_artifact_dir(root: &Path) -> Result<PathBuf, String> {
    let mut latest: Option<(NaiveDateTime, PathBuf)> = None;
    let entries = fs::read_dir(root).map_err(|e| format!("读取脚本输出目录失败: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("遍历脚本输出目录失败: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(timestamp) = parse_artifact_timestamp(name) else {
            continue;
        };
        match &latest {
            Some((current, _)) if timestamp <= *current => {}
            _ => latest = Some((timestamp, path)),
        }
    }

    latest
        .map(|(_, path)| path)
        .ok_or_else(|| "未找到符合时间戳格式的产物目录".to_string())
}

pub fn collect_artifact_subdirs(artifact_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut subdirs = Vec::new();
    let entries = fs::read_dir(artifact_dir).map_err(|e| format!("读取产物目录失败: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("遍历产物目录失败: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        }
    }

    subdirs.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    if subdirs.is_empty() {
        return Err("最新产物目录下未找到可同步的子文件夹".to_string());
    }

    Ok(subdirs)
}

pub fn svn_output_has_conflict(output: &str) -> bool {
    let lower = output.to_lowercase();
    if lower.contains("summary of conflicts") || lower.contains("conflict") {
        return true;
    }

    output.lines().any(|line| {
        let trimmed = line.trim_start();
        trimmed == "C"
            || trimmed.starts_with("C ")
            || trimmed.starts_with("C\t")
            || trimmed.starts_with("C\\")
            || trimmed.starts_with("C/")
    })
}

pub fn copy_child_directories(children: &[PathBuf], target_root: &Path) -> Result<(), String> {
    for child in children {
        if !child.is_dir() {
            return Err(format!("同步源不是目录: {}", child.display()));
        }
        let name = child
            .file_name()
            .ok_or_else(|| format!("无法识别同步目录名称: {}", child.display()))?;
        let destination = target_root.join(name);
        copy_directory_recursive(child, &destination)?;
    }
    Ok(())
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|e| format!("创建同步目录失败 {}: {e}", destination.display()))?;

    for entry in fs::read_dir(source).map_err(|e| format!("读取同步目录失败 {}: {e}", source.display()))? {
        let entry = entry.map_err(|e| format!("遍历同步目录失败 {}: {e}", source.display()))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建文件父目录失败 {}: {e}", parent.display()))?;
        }

        fs::copy(&source_path, &destination_path).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {e}",
                source_path.display(),
                destination_path.display()
            )
        })?;
    }

    Ok(())
}

pub fn execute_sync_pipeline(app: &AppHandle, profile: &SyncProfile) -> Result<SyncRunOutcome, String> {
    let profile_id = profile.id.clone();

    let script_path = required_path(&profile.script_executable_path, "脚本软件路径")?;
    let output_root = required_path(&profile.output_root, "脚本输出目录")?;
    let target_path = required_path(&profile.target_path, "项目目标路径")?;

    emit_progress(
        app,
        &profile_id,
        "validate",
        "running",
        "正在校验路径与 SVN 环境",
        None,
        None,
        Some(target_path.display().to_string()),
    );

    ensure_file_exists(&script_path, "脚本软件路径")?;
    ensure_directory_exists(&output_root, "脚本输出目录")?;
    ensure_directory_exists(&target_path, "项目目标路径")?;
    ensure_svn_available()?;

    emit_progress(
        app,
        &profile_id,
        "validate",
        "success",
        "路径校验通过",
        None,
        None,
        Some(target_path.display().to_string()),
    );

    let script_workdir = script_path
        .parent()
        .ok_or_else(|| "脚本软件路径缺少父目录".to_string())?;

    let launch_command = format!("\"{}\"", script_path.display());
    emit_progress(
        app,
        &profile_id,
        "launch_tool",
        "running",
        "正在执行转表工具",
        None,
        Some(launch_command.clone()),
        Some(script_workdir.display().to_string()),
    );

    let mut tool_command = Command::new(&script_path);
    apply_process_flags(&mut tool_command);
    let tool_output = tool_command
        .current_dir(script_workdir)
        .output()
        .map_err(|e| format!("启动脚本工具失败: {e}"))?;
    let tool_detail = combine_output(&tool_output);
    if !tool_output.status.success() {
        return emit_failure(
            app,
            &profile_id,
            "launch_tool",
            "脚本工具执行失败",
            tool_detail,
            Some(launch_command),
            Some(script_workdir.display().to_string()),
        );
    }

    emit_progress(
        app,
        &profile_id,
        "launch_tool",
        "success",
        "转表工具执行完成",
        detail_or_none(tool_detail),
        Some(format!("\"{}\"", script_path.display())),
        Some(script_workdir.display().to_string()),
    );

    emit_progress(
        app,
        &profile_id,
        "locate_artifact",
        "running",
        "正在定位最新产物目录",
        None,
        None,
        Some(output_root.display().to_string()),
    );

    let artifact_dir = select_latest_artifact_dir(&output_root)?;
    let artifact_subdirs = collect_artifact_subdirs(&artifact_dir)?;
    let artifact_names = artifact_subdirs
        .iter()
        .filter_map(|path| path.file_name().and_then(|value| value.to_str()).map(str::to_string))
        .collect::<Vec<_>>();

    emit_progress(
        app,
        &profile_id,
        "locate_artifact",
        "success",
        &format!("已定位最新产物目录，共 {} 个子文件夹", artifact_subdirs.len()),
        Some(artifact_names.join(", ")),
        None,
        Some(artifact_dir.display().to_string()),
    );

    let svn_command = format!("svn update \"{}\"", target_path.display());
    emit_progress(
        app,
        &profile_id,
        "svn_update",
        "running",
        "正在执行 SVN 更新",
        None,
        Some(svn_command.clone()),
        Some(target_path.display().to_string()),
    );

    let mut svn_update = Command::new("svn");
    apply_process_flags(&mut svn_update);
    let svn_output = svn_update
        .arg("update")
        .current_dir(&target_path)
        .output()
        .map_err(|e| format!("执行 svn update 失败: {e}"))?;
    let svn_detail = combine_output(&svn_output);
    if !svn_output.status.success() || svn_output_has_conflict(&svn_detail) {
        return emit_failure(
            app,
            &profile_id,
            "svn_update",
            "SVN 更新失败",
            svn_detail,
            Some(svn_command),
            Some(target_path.display().to_string()),
        );
    }

    emit_progress(
        app,
        &profile_id,
        "svn_update",
        "success",
        "SVN 更新完成",
        detail_or_none(svn_detail),
        Some(format!("svn update \"{}\"", target_path.display())),
        Some(target_path.display().to_string()),
    );

    emit_progress(
        app,
        &profile_id,
        "copy",
        "running",
        &format!("正在同步 {} 个子文件夹", artifact_subdirs.len()),
        Some(artifact_names.join(", ")),
        None,
        Some(target_path.display().to_string()),
    );

    if let Err(error) = copy_child_directories(&artifact_subdirs, &target_path) {
        return emit_failure(
            app,
            &profile_id,
            "copy",
            "文件同步失败",
            error,
            None,
            Some(target_path.display().to_string()),
        );
    }

    emit_progress(
        app,
        &profile_id,
        "copy",
        "success",
        &format!("文件同步完成，共覆盖 {} 个子文件夹", artifact_subdirs.len()),
        Some(artifact_names.join(", ")),
        None,
        Some(target_path.display().to_string()),
    );

    let summary = format!(
        "已同步 {} 个子文件夹到 {}",
        artifact_names.len(),
        target_path.display()
    );
    emit_progress(
        app,
        &profile_id,
        "finish",
        "success",
        &summary,
        Some(artifact_dir.display().to_string()),
        None,
        Some(target_path.display().to_string()),
    );

    Ok(SyncRunOutcome {
        profile_id,
        status: "success".to_string(),
        summary,
        artifact_dir: Some(artifact_dir.display().to_string()),
        synced_directories: artifact_names,
    })
}

fn required_path(raw: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}未配置"));
    }
    Ok(PathBuf::from(trimmed))
}

fn ensure_file_exists(path: &Path, label: &str) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("{label}不存在或不是文件: {}", path.display()));
    }
    Ok(())
}

fn ensure_directory_exists(path: &Path, label: &str) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{label}不存在或不是目录: {}", path.display()));
    }
    Ok(())
}

fn ensure_svn_available() -> Result<(), String> {
    let mut command = Command::new("svn");
    apply_process_flags(&mut command);
    command.arg("--version").arg("--quiet");
    command
        .output()
        .map_err(|e| format!("未找到 svn 命令，请确认 SVN 已加入 PATH: {e}"))?;
    Ok(())
}

fn combine_output(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout,
        (true, false) => stderr,
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

fn detail_or_none(detail: String) -> Option<String> {
    if detail.is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn emit_failure(
    app: &AppHandle,
    profile_id: &str,
    step: &str,
    message: &str,
    detail: String,
    command: Option<String>,
    path: Option<String>,
) -> Result<SyncRunOutcome, String> {
    emit_progress(
        app,
        profile_id,
        step,
        "error",
        message,
        detail_or_none(detail.clone()),
        command.clone(),
        path.clone(),
    );
    emit_progress(
        app,
        profile_id,
        "finish",
        "error",
        message,
        detail_or_none(detail.clone()),
        command,
        path,
    );
    Err(format!("{message}: {detail}"))
}

fn emit_progress(
    app: &AppHandle,
    profile_id: &str,
    step: &str,
    status: &str,
    message: &str,
    detail: Option<String>,
    command: Option<String>,
    path: Option<String>,
) {
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgressEvent {
            profile_id: profile_id.to_string(),
            step: step.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            detail,
            command,
            path,
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}

fn apply_process_flags(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
}
