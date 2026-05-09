pub mod db_migration;
pub mod sync_workspace;

use crate::sync_workspace::{execute_sync_pipeline, SyncProfile, SyncRunOutcome};
use crate::db_migration::{
    connect_db_migration_server as connect_db_migration_server_impl,
    filter_user_databases,
    run_db_migration as run_db_migration_impl,
    DbMigrationLoginParams,
    DbMigrationLoginResult,
    DbMigrationOutcome,
    DbMigrationRequest,
};
use chrono::{DateTime, Local, Utc};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use mouse_position::mouse_position::Mouse;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{MySqlPool, Row};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PetHitbox {
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
}

#[derive(Clone)]
struct AppState {
    runtime: Arc<tokio::sync::Mutex<RuntimeState>>,
    cancel_seq: Arc<AtomicU64>,
    panel_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    panel_window_size_sync: Arc<std::sync::RwLock<Option<PanelWindowSize>>>,
    quick_date_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    quick_paste_open_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    quick_paste_output_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    sync_window_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    db_migration_window_hotkey_sync: Arc<std::sync::RwLock<Option<String>>>,
    db_migration_window_size_sync: Arc<std::sync::RwLock<Option<DbMigrationWindowSize>>>,
    db_migration_running_sync: Arc<AtomicBool>,
    panel_resize_seq: Arc<AtomicU64>,
    db_migration_resize_seq: Arc<AtomicU64>,
    pet_hitbox: Arc<std::sync::RwLock<Option<PetHitbox>>>,
    pet_cursor_ignored: Arc<AtomicBool>,
}
impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(tokio::sync::Mutex::new(RuntimeState::default())),
            cancel_seq: Arc::new(AtomicU64::new(0)),
            panel_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            panel_window_size_sync: Arc::new(std::sync::RwLock::new(None)),
            quick_date_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            quick_paste_open_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            quick_paste_output_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            sync_window_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_window_hotkey_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_window_size_sync: Arc::new(std::sync::RwLock::new(None)),
            db_migration_running_sync: Arc::new(AtomicBool::new(false)),
            panel_resize_seq: Arc::new(AtomicU64::new(0)),
            db_migration_resize_seq: Arc::new(AtomicU64::new(0)),
            pet_hitbox: Arc::new(std::sync::RwLock::new(None)),
            pet_cursor_ignored: Arc::new(AtomicBool::new(false)),
        }
    }
}
#[derive(Default)]
struct RuntimeState {
    pool: Option<MySqlPool>,
    fake_db_connected: bool,
    schema_cache: SchemaCache,
    demo_rows: HashMap<String, Vec<HashMap<String, String>>>,
    config: AppConfig,
    panel_open_settings_pending: bool,
    registered_hotkey: Option<String>,
    registered_quick_date_hotkey: Option<String>,
    registered_quick_paste_open_hotkey: Option<String>,
    registered_quick_paste_output_hotkey: Option<String>,
    registered_sync_window_hotkey: Option<String>,
    registered_db_migration_window_hotkey: Option<String>,
    sync_running: bool,
    pet_hidden_this_session: bool,
}

const MAIN_WINDOW_LABEL: &str = "main";
const WELCOME_WINDOW_LABEL: &str = "welcome";
const UPDATE_ANNOUNCEMENT_WINDOW_LABEL: &str = "update_announcement";
const PANEL_WINDOW_LABEL: &str = "panel";
const PET_MENU_WINDOW_LABEL: &str = "pet_menu";
const SYNC_WORKSPACE_WINDOW_LABEL: &str = "sync_workspace";
const DB_MIGRATION_WORKSPACE_WINDOW_LABEL: &str = "db_migration_workspace";
const ART_TEXT_SEARCH_WINDOW_LABEL: &str = "art_text_search";
const QUICK_PASTE_WINDOW_LABEL: &str = "quick_paste";
const WELCOME_WINDOW_WIDTH: f64 = 720.0;
const WELCOME_WINDOW_HEIGHT: f64 = 320.0;
const UPDATE_ANNOUNCEMENT_WINDOW_WIDTH: f64 = 620.0;
const UPDATE_ANNOUNCEMENT_WINDOW_HEIGHT: f64 = 520.0;
const PANEL_WIDTH: f64 = 780.0;
const PANEL_HEIGHT: f64 = 860.0;
const PANEL_MIN_WIDTH: f64 = 680.0;
const PANEL_MIN_HEIGHT: f64 = 720.0;
const PET_MENU_WIDTH: f64 = 252.0;
const PET_MENU_HEIGHT: f64 = 426.0;
const PET_MENU_BUTTON_COUNT: f64 = 7.0;
const PET_MENU_CHILD_COUNT: f64 = 8.0;
const PET_MENU_BUTTON_HEIGHT: f64 = 44.0;
const PET_MENU_ROW_GAP: f64 = 6.0;
const PET_MENU_DIVIDER_BLOCK_HEIGHT: f64 = 5.0;
const PET_MENU_VERTICAL_PADDING: f64 = 20.0;
const SYNC_WORKSPACE_WIDTH: f64 = 1430.0;
const SYNC_WORKSPACE_HEIGHT: f64 = 1014.0;
const DB_MIGRATION_WORKSPACE_WIDTH: f64 = 1120.0;
const DB_MIGRATION_WORKSPACE_HEIGHT: f64 = 760.0;
const DB_MIGRATION_WORKSPACE_MIN_WIDTH: f64 = 980.0;
const DB_MIGRATION_WORKSPACE_MIN_HEIGHT: f64 = 660.0;
const ART_TEXT_SEARCH_WIDTH: f64 = 620.0;
const ART_TEXT_SEARCH_HEIGHT: f64 = 520.0;
const QUICK_PASTE_WINDOW_WIDTH: f64 = 900.0;
const QUICK_PASTE_WINDOW_HEIGHT: f64 = 569.0;
const QUICK_PASTE_WINDOW_MIN_WIDTH: f64 = 900.0;
const QUICK_PASTE_WINDOW_MIN_HEIGHT: f64 = 569.0;
const DEMO_FEATURE_TEST_TABLE: &str = "demo_feature_test";
const DEFAULT_DB_MIGRATION_WINDOW_HOTKEY: &str = "Shift+S";
const DEFAULT_QUICK_PASTE_OPEN_HOTKEY: &str = "F7";
const DEFAULT_QUICK_PASTE_OUTPUT_HOTKEY: &str = "F8";
const APP_DISPLAY_NAME: &str = "鹰捷";
const TRAY_ICON_ID: &str = "main_tray";
const TRAY_MENU_OPEN_PANEL_ID: &str = "tray-open-panel";
const TRAY_MENU_SHOW_PET_ID: &str = "tray-show-pet";
const TRAY_MENU_EXIT_ID: &str = "tray-exit";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayMenuAction {
    OpenPanel,
    ShowPet,
    ExitApp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowCloseAction {
    HideToTray,
    HideWindow,
}

fn tray_click_opens_panel(button: MouseButton, state: MouseButtonState) -> bool {
    button == MouseButton::Left && state == MouseButtonState::Up
}

fn format_app_display_title(version: &str) -> String {
    let normalized_version = version.trim();
    if normalized_version.is_empty() {
        APP_DISPLAY_NAME.to_string()
    } else {
        format!("{APP_DISPLAY_NAME}V{normalized_version}")
    }
}

fn format_window_title(app: &tauri::AppHandle, suffix: Option<&str>) -> String {
    let base_title = format_app_display_title(&app.package_info().version.to_string());
    match suffix.map(str::trim).filter(|suffix| !suffix.is_empty()) {
        Some(suffix) => format!("{base_title} {suffix}"),
        None => base_title,
    }
}

fn resolve_tray_menu_action(id: impl AsRef<str>) -> Option<TrayMenuAction> {
    match id.as_ref() {
        TRAY_MENU_OPEN_PANEL_ID => Some(TrayMenuAction::OpenPanel),
        TRAY_MENU_SHOW_PET_ID => Some(TrayMenuAction::ShowPet),
        TRAY_MENU_EXIT_ID => Some(TrayMenuAction::ExitApp),
        _ => None,
    }
}

fn close_request_action_for_window(label: &str) -> WindowCloseAction {
    match label {
        PANEL_WINDOW_LABEL
        | SYNC_WORKSPACE_WINDOW_LABEL
        | DB_MIGRATION_WORKSPACE_WINDOW_LABEL
        | ART_TEXT_SEARCH_WINDOW_LABEL
        | QUICK_PASTE_WINDOW_LABEL => {
            WindowCloseAction::HideToTray
        }
        _ => WindowCloseAction::HideWindow,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct AppConfig {
    shared: SharedConfig,
    personal: PersonalConfig,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SharedConfig {
    db: DbConfig,
    search: SearchConfig,
    #[serde(default)]
    db_templates: Vec<DbTemplate>,
}
impl Default for SharedConfig {
    fn default() -> Self {
        Self {
            db: DbConfig::default(),
            search: SearchConfig::default(),
            db_templates: Vec::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SearchConfig {
    exclude_tables: Vec<String>,
    per_table_timeout_sec: u64,
    per_table_max_rows: u32,
}
impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            exclude_tables: vec!["^t_log_.*".into(), "^tmp_.*".into()],
            per_table_timeout_sec: 10,
            per_table_max_rows: 50,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct UpdateAnnouncement {
    version: String,
    notes: String,
    pub_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct QuickPasteSnippet {
    id: String,
    title: String,
    content: String,
    image: String,
    category: String,
    favorite: bool,
    is_default: bool,
    created_at: String,
    updated_at: String,
}

impl Default for QuickPasteSnippet {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            content: String::new(),
            image: String::new(),
            category: "text".into(),
            favorite: false,
            is_default: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct QuickPasteConfig {
    enabled: bool,
    open_hotkey: String,
    output_hotkey: String,
    snippets: Vec<QuickPasteSnippet>,
}

impl Default for QuickPasteConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            open_hotkey: DEFAULT_QUICK_PASTE_OPEN_HOTKEY.into(),
            output_hotkey: DEFAULT_QUICK_PASTE_OUTPUT_HOTKEY.into(),
            snippets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct PersonalConfig {
    widget_mode: String,
    hotkey: String,
    quick_date_hotkey: String,
    #[serde(default = "default_sync_window_hotkey")]
    sync_window_hotkey: String,
    #[serde(default = "default_db_migration_window_hotkey")]
    db_migration_window_hotkey: String,
    always_on_top: bool,
    auto_start: bool,
    ui_scale: f32,
    table_default_view: String,
    pet_locked: bool,
    pet_position: Option<WindowPosition>,
    idle_states: Vec<String>,
    export_hotkey: String,
    batch_export_hotkey: String,
    template_prev_hotkey: String,
    template_next_hotkey: String,
    #[serde(default)]
    panel_shortcuts: std::collections::HashMap<String, String>,
    reset_on_open_to_all_tables: bool,
    #[serde(default = "default_always_on_top_hotkey")]
    always_on_top_hotkey: String,
    #[serde(default = "default_pet_skin")]
    pet_skin: String,
    #[serde(default)]
    pet_scale: std::collections::HashMap<String, f64>,
    #[serde(default)]
    custom_font: Option<String>,
    #[serde(default = "default_true")]
    weather_enabled: bool,
    #[serde(default = "default_background_opacity")]
    background_opacity: f32,
    #[serde(default)]
    reduce_transparency_mode: bool,
    #[serde(default = "default_startup_welcome_text")]
    startup_welcome_text: String,
    #[serde(default = "default_startup_welcome_mode")]
    startup_welcome_mode: String,
    #[serde(default)]
    sync_profiles: Vec<SyncProfile>,
    #[serde(default)]
    default_sync_profile_id: Option<String>,
    #[serde(default)]
    last_used_sync_profile_id: Option<String>,
    #[serde(default)]
    panel_window_size: Option<PanelWindowSize>,
    #[serde(default)]
    db_migration_window_size: Option<DbMigrationWindowSize>,
    #[serde(default)]
    db_migration_profiles: Vec<DbMigrationProfile>,
    #[serde(default)]
    last_used_db_migration_profile_id: Option<String>,
    #[serde(default)]
    db_migration_last_connection: Option<DbMigrationRememberedConnection>,
    #[serde(default = "default_true")]
    auto_check_updates: bool,
    #[serde(default)]
    last_update_check_at: Option<String>,
    #[serde(default)]
    pending_update_announcement: Option<UpdateAnnouncement>,
    #[serde(default)]
    last_update_announcement_version: Option<String>,
    #[serde(default)]
    art_text_search_dirs: Vec<String>,
    #[serde(default)]
    quick_paste: QuickPasteConfig,
}
fn default_true() -> bool {
    true
}
fn default_background_opacity() -> f32 {
    1.0
}
fn default_always_on_top_hotkey() -> String {
    "P".into()
}
fn default_sync_window_hotkey() -> String {
    "Shift+D".into()
}
fn default_db_migration_window_hotkey() -> String {
    DEFAULT_DB_MIGRATION_WINDOW_HOTKEY.into()
}
fn default_pet_skin() -> String {
    "eagle".into()
}
fn default_startup_welcome_text() -> String {
    "Louis".into()
}
fn default_startup_welcome_mode() -> String {
    "handwriting".into()
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn sanitize_quick_paste_snippet(mut snippet: QuickPasteSnippet) -> Option<QuickPasteSnippet> {
    snippet.title = snippet.title.trim().to_string();
    snippet.category = snippet.category.trim().to_string();
    if snippet.category.is_empty() {
        snippet.category = "text".into();
    }
    if snippet.title.is_empty() || snippet.content.trim().is_empty() {
        return None;
    }
    if snippet.category != "image" && snippet.category != "rich" {
        snippet.category = "text".into();
    }
    Some(snippet)
}

fn enforce_single_quick_paste_default(snippets: &mut [QuickPasteSnippet]) {
    let mut default_seen = false;
    for snippet in snippets {
        if snippet.is_default && !default_seen {
            default_seen = true;
        } else {
            snippet.is_default = false;
        }
    }
}

fn sanitize_quick_paste_config(mut config: QuickPasteConfig) -> QuickPasteConfig {
    if config.open_hotkey.trim().is_empty() {
        config.open_hotkey = DEFAULT_QUICK_PASTE_OPEN_HOTKEY.into();
    } else {
        config.open_hotkey = config.open_hotkey.trim().to_string();
    }

    if config.output_hotkey.trim().is_empty() {
        config.output_hotkey = DEFAULT_QUICK_PASTE_OUTPUT_HOTKEY.into();
    } else {
        config.output_hotkey = config.output_hotkey.trim().to_string();
    }

    config.snippets = config
        .snippets
        .into_iter()
        .filter_map(sanitize_quick_paste_snippet)
        .collect();
    enforce_single_quick_paste_default(&mut config.snippets);
    config
}

fn validate_quick_paste_hotkeys(personal: &PersonalConfig, next: &QuickPasteConfig) -> Result<(), String> {
    let open = next.open_hotkey.trim();
    let output = next.output_hotkey.trim();
    if open.is_empty() || output.is_empty() {
        return Err("快捷粘贴快捷键不能为空".into());
    }
    if open.eq_ignore_ascii_case(output) {
        return Err("打开快捷粘贴和输出默认文本不能使用同一个快捷键".into());
    }
    let conflicts = [
        (&personal.hotkey, "主面板快捷键"),
        (&personal.quick_date_hotkey, "快速日期快捷键"),
        (&personal.sync_window_hotkey, "同步窗口快捷键"),
        (&personal.db_migration_window_hotkey, "数据库迁移快捷键"),
    ];
    for (existing, label) in conflicts {
        if !existing.trim().is_empty()
            && (open.eq_ignore_ascii_case(existing) || output.eq_ignore_ascii_case(existing))
        {
            return Err(format!("快捷粘贴快捷键与{label}冲突"));
        }
    }
    Ok(())
}

fn sanitize_db_migration_window_size(
    size: Option<DbMigrationWindowSize>,
) -> Option<DbMigrationWindowSize> {
    size.and_then(|value| {
        if !value.width.is_finite() || !value.height.is_finite() {
            return None;
        }
        Some(DbMigrationWindowSize {
            width: value.width.max(DB_MIGRATION_WORKSPACE_MIN_WIDTH).round(),
            height: value.height.max(DB_MIGRATION_WORKSPACE_MIN_HEIGHT).round(),
        })
    })
}

fn sanitize_panel_window_size(size: Option<PanelWindowSize>) -> Option<PanelWindowSize> {
    size.and_then(|value| {
        if !value.width.is_finite() || !value.height.is_finite() {
            return None;
        }
        Some(PanelWindowSize {
            width: value.width.max(PANEL_MIN_WIDTH).round(),
            height: value.height.max(PANEL_MIN_HEIGHT).round(),
        })
    })
}

fn default_panel_window_size() -> PanelWindowSize {
    PanelWindowSize {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
    }
}

fn default_db_migration_window_size() -> DbMigrationWindowSize {
    DbMigrationWindowSize {
        width: DB_MIGRATION_WORKSPACE_WIDTH,
        height: DB_MIGRATION_WORKSPACE_HEIGHT,
    }
}

fn sanitize_db_migration_remembered_connection(
    connection: Option<DbMigrationRememberedConnection>,
) -> Option<DbMigrationRememberedConnection> {
    connection.and_then(|value| {
        let host = value.host.trim().to_string();
        let username = value.username.trim().to_string();
        if host.is_empty() || username.is_empty() {
            return None;
        }
        Some(DbMigrationRememberedConnection {
            host,
            port: if value.port == 0 { 3306 } else { value.port },
            username,
            password: value.password,
            source_database: value.source_database.trim().to_string(),
            target_database: value.target_database.trim().to_string(),
        })
    })
}

fn default_db_migration_profile_id(index: usize) -> String {
    format!("db-migration-profile-{}", index + 1)
}

fn build_db_migration_profile_default_name(profile: &DbMigrationProfile, index: usize) -> String {
    let source_database = profile.source_database.trim();
    let target_database = profile.target_database.trim();
    if !source_database.is_empty() && !target_database.is_empty() {
        return format!("{source_database} -> {target_database}");
    }

    let host = profile.host.trim();
    if !host.is_empty() {
        return format!("{host}:{}", if profile.port == 0 { 3306 } else { profile.port });
    }

    format!("迁移模板 {}", index + 1)
}

fn sanitize_db_migration_profile(profile: DbMigrationProfile, index: usize) -> DbMigrationProfile {
    let mut sanitized = DbMigrationProfile {
        id: profile.id.trim().to_string(),
        name: profile.name.trim().to_string(),
        host: profile.host.trim().to_string(),
        port: if profile.port == 0 { 3306 } else { profile.port },
        username: profile.username.trim().to_string(),
        password: profile.password,
        source_database: profile.source_database.trim().to_string(),
        target_database: profile.target_database.trim().to_string(),
    };

    if sanitized.id.is_empty() {
        sanitized.id = default_db_migration_profile_id(index);
    }
    if sanitized.name.is_empty() {
        sanitized.name = build_db_migration_profile_default_name(&sanitized, index);
    }

    sanitized
}

fn sanitize_db_migration_profiles(profiles: Vec<DbMigrationProfile>) -> Vec<DbMigrationProfile> {
    profiles
        .into_iter()
        .enumerate()
        .map(|(index, profile)| sanitize_db_migration_profile(profile, index))
        .collect()
}

fn db_migration_profile_to_payload(profile: DbMigrationProfile) -> DbMigrationProfilePayload {
    DbMigrationProfilePayload {
        id: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        source_database: profile.source_database,
        target_database: profile.target_database,
    }
}

fn payload_to_db_migration_profile(payload: DbMigrationProfilePayload) -> DbMigrationProfile {
    DbMigrationProfile {
        id: payload.id,
        name: payload.name,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password: payload.password,
        source_database: payload.source_database,
        target_database: payload.target_database,
    }
}

fn db_migration_profile_to_remembered_connection(
    profile: Option<&DbMigrationProfile>,
) -> Option<DbMigrationRememberedConnection> {
    let value = profile?;
    sanitize_db_migration_remembered_connection(Some(DbMigrationRememberedConnection {
        host: value.host.clone(),
        port: value.port,
        username: value.username.clone(),
        password: value.password.clone(),
        source_database: value.source_database.clone(),
        target_database: value.target_database.clone(),
    }))
}

fn legacy_db_migration_connection_to_profile(
    connection: DbMigrationRememberedConnection,
) -> DbMigrationProfile {
    sanitize_db_migration_profile(
        DbMigrationProfile {
            id: String::new(),
            name: String::new(),
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            source_database: connection.source_database,
            target_database: connection.target_database,
        },
        0,
    )
}

fn resolve_last_used_db_migration_profile_id(
    profiles: &[DbMigrationProfile],
    requested: Option<String>,
) -> Option<String> {
    let requested = requested.unwrap_or_default().trim().to_string();
    if !requested.is_empty() && profiles.iter().any(|profile| profile.id == requested) {
        return Some(requested);
    }
    profiles.first().map(|profile| profile.id.clone())
}

fn normalize_db_migration_profile_state(
    profiles: Vec<DbMigrationProfile>,
    last_used_profile_id: Option<String>,
    legacy_connection: Option<DbMigrationRememberedConnection>,
) -> (Vec<DbMigrationProfile>, Option<String>) {
    let mut normalized_profiles = sanitize_db_migration_profiles(profiles);
    if normalized_profiles.is_empty() {
        if let Some(connection) = sanitize_db_migration_remembered_connection(legacy_connection) {
            normalized_profiles.push(legacy_db_migration_connection_to_profile(connection));
        }
    }

    let resolved_last_used_profile_id =
        resolve_last_used_db_migration_profile_id(&normalized_profiles, last_used_profile_id);

    (normalized_profiles, resolved_last_used_profile_id)
}

fn clamp_db_migration_window_size_to_monitor(
    app: &tauri::AppHandle,
    size: DbMigrationWindowSize,
) -> DbMigrationWindowSize {
    let mut next = sanitize_db_migration_window_size(Some(size))
        .unwrap_or_else(default_db_migration_window_size);

    let monitor = if let Some(window) = app
        .get_webview_window(PANEL_WINDOW_LABEL)
        .or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
    {
        window.current_monitor().ok().flatten()
    } else {
        app.primary_monitor().ok().flatten()
    };

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let width_limit = (monitor.size().width as f64 / scale - 40.0).floor();
        let height_limit = (monitor.size().height as f64 / scale - 40.0).floor();

        if width_limit.is_finite() && width_limit > 0.0 {
            next.width = next
                .width
                .min(width_limit.max(DB_MIGRATION_WORKSPACE_MIN_WIDTH));
        }
        if height_limit.is_finite() && height_limit > 0.0 {
            next.height = next
                .height
                .min(height_limit.max(DB_MIGRATION_WORKSPACE_MIN_HEIGHT));
        }
    }

    next
}

fn clamp_panel_window_size_to_monitor(
    app: &tauri::AppHandle,
    size: PanelWindowSize,
) -> PanelWindowSize {
    let mut next = sanitize_panel_window_size(Some(size)).unwrap_or_else(default_panel_window_size);

    let monitor = if let Some(window) = app
        .get_webview_window(PANEL_WINDOW_LABEL)
        .or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
    {
        window.current_monitor().ok().flatten()
    } else {
        app.primary_monitor().ok().flatten()
    };

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let width_limit = (monitor.size().width as f64 / scale - 40.0).floor();
        let height_limit = (monitor.size().height as f64 / scale - 40.0).floor();

        if width_limit.is_finite() && width_limit > 0.0 {
            next.width = next.width.min(width_limit.max(PANEL_MIN_WIDTH));
        }
        if height_limit.is_finite() && height_limit > 0.0 {
            next.height = next.height.min(height_limit.max(PANEL_MIN_HEIGHT));
        }
    }

    next
}

fn resolve_panel_window_size_from_cache(state: &AppState) -> PanelWindowSize {
    sanitize_panel_window_size(state.panel_window_size_sync.read().unwrap().clone())
        .unwrap_or_else(default_panel_window_size)
}

fn resolve_panel_window_size(app: &tauri::AppHandle) -> PanelWindowSize {
    let state = app.state::<AppState>();
    clamp_panel_window_size_to_monitor(app, resolve_panel_window_size_from_cache(&state))
}

fn resolve_db_migration_window_size_from_cache(state: &AppState) -> DbMigrationWindowSize {
    sanitize_db_migration_window_size(state.db_migration_window_size_sync.read().unwrap().clone())
        .unwrap_or_else(default_db_migration_window_size)
}

fn resolve_db_migration_window_size(app: &tauri::AppHandle) -> DbMigrationWindowSize {
    let state = app.state::<AppState>();
    clamp_db_migration_window_size_to_monitor(app, resolve_db_migration_window_size_from_cache(&state))
}
impl Default for PersonalConfig {
    fn default() -> Self {
        Self {
            widget_mode: "tray".into(),
            hotkey: "Ctrl+Shift+F".into(),
            quick_date_hotkey: "F9".into(),
            sync_window_hotkey: "Shift+D".into(),
            db_migration_window_hotkey: default_db_migration_window_hotkey(),
            always_on_top: true,
            auto_start: false,
            ui_scale: 1.0,
            table_default_view: "hits".into(),
            pet_locked: false,
            pet_position: None,
            idle_states: vec![
                "float_breathe".into(),
                "sleep_zzz".into(),
                "look_around".into(),
                "ghost_fade".into(),
                "wave_hello".into(),
                "charge_spell".into(),
                "jump_play".into(),
                "spin_show".into(),
            ],
            export_hotkey: "Ctrl+E".into(),
            batch_export_hotkey: "Ctrl+Shift+E".into(),
            template_prev_hotkey: "Ctrl+Alt+Left".into(),
            template_next_hotkey: "Ctrl+Alt+Right".into(),
            panel_shortcuts: std::collections::HashMap::new(),
            reset_on_open_to_all_tables: true,
            always_on_top_hotkey: "P".into(),
            pet_skin: "eagle".into(),
            pet_scale: std::collections::HashMap::new(),
            custom_font: None,
            weather_enabled: true,
            background_opacity: 1.0,
            reduce_transparency_mode: false,
            startup_welcome_text: default_startup_welcome_text(),
            startup_welcome_mode: default_startup_welcome_mode(),
            sync_profiles: Vec::new(),
            default_sync_profile_id: None,
            last_used_sync_profile_id: None,
            panel_window_size: None,
            db_migration_window_size: None,
            db_migration_profiles: Vec::new(),
            last_used_db_migration_profile_id: None,
            db_migration_last_connection: None,
            auto_check_updates: true,
            last_update_check_at: None,
            pending_update_announcement: None,
            last_update_announcement_version: None,
            art_text_search_dirs: Vec::new(),
            quick_paste: QuickPasteConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsSnapshot {
    current_version: String,
    auto_check_updates: bool,
    last_update_check_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckPlan {
    should_check: bool,
    reason: String,
    checked_at: Option<String>,
    current_version: String,
}

fn normalize_update_announcement_version(version: &str) -> String {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .trim()
        .to_string()
}

fn normalize_update_announcement(
    mut announcement: UpdateAnnouncement,
) -> Option<UpdateAnnouncement> {
    announcement.version = normalize_update_announcement_version(&announcement.version);
    announcement.notes = announcement.notes.trim().to_string();
    announcement.pub_date = announcement.pub_date.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if announcement.version.is_empty() {
        None
    } else {
        Some(announcement)
    }
}

fn should_show_update_announcement(personal: &PersonalConfig, current_version: &str) -> bool {
    let current_version = normalize_update_announcement_version(current_version);
    if current_version.is_empty() {
        return false;
    }

    let Some(pending) = personal.pending_update_announcement.as_ref() else {
        return false;
    };

    if normalize_update_announcement_version(&pending.version) != current_version {
        return false;
    }

    personal
        .last_update_announcement_version
        .as_deref()
        .map(normalize_update_announcement_version)
        .as_deref()
        != Some(current_version.as_str())
}

fn build_update_check_plan(
    auto_check_updates: bool,
    now: DateTime<Utc>,
    manual: bool,
) -> UpdateCheckPlan {
    if manual {
        return UpdateCheckPlan {
            should_check: true,
            reason: "manual".into(),
            checked_at: Some(now.to_rfc3339()),
            current_version: String::new(),
        };
    }

    if !auto_check_updates {
        return UpdateCheckPlan {
            should_check: false,
            reason: "startup-disabled".into(),
            checked_at: None,
            current_version: String::new(),
        };
    }

    UpdateCheckPlan {
        should_check: true,
        reason: "startup-due".into(),
        checked_at: Some(now.to_rfc3339()),
        current_version: String::new(),
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PanelWindowSize {
    width: f64,
    height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbMigrationWindowSize {
    width: f64,
    height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbMigrationRememberedConnection {
    host: String,
    port: u16,
    username: String,
    password: String,
    source_database: String,
    target_database: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct DbMigrationProfile {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    source_database: String,
    target_database: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DbMigrationProfilePayload {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    source_database: String,
    target_database: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbMigrationWorkspaceStatePayload {
    profiles: Vec<DbMigrationProfilePayload>,
    last_used_profile_id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbMigrationWorkspaceState {
    hotkey: String,
    profiles: Vec<DbMigrationProfilePayload>,
    last_used_profile_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbConfig {
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
}
impl Default for DbConfig {
    fn default() -> Self {
        Self {
            host: "".into(),
            port: 3306,
            username: "".into(),
            password: "".into(),
            database: "".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DbTemplate {
    name: String,
    db: DbConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkinAnimationDef {
    file: String,
    #[serde(rename = "frameWidth")]
    frame_width: u32,
    #[serde(rename = "frameHeight")]
    frame_height: u32,
    #[serde(rename = "frameCount")]
    frame_count: u32,
    fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkinManifest {
    name: String,
    animations: HashMap<String, SkinAnimationDef>,
    #[serde(rename = "searchAnim")]
    search_anim: String,
    #[serde(rename = "foundAnim")]
    found_anim: String,
    #[serde(rename = "defaultAnim")]
    default_anim: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SchemaCache {
    tables: Vec<TableMeta>,
    last_refresh: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TableMeta {
    table_name: String,
    table_comment: String,
    columns: Vec<ColumnMeta>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ColumnMeta {
    column_name: String,
    column_type: String,
    column_comment: String,
    is_primary_key: bool,
    is_nullable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SchemaInfo {
    table_count: usize,
    column_count: usize,
    last_refresh: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionStatus {
    connected: bool,
    database: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    keyword: String,
    scope: SearchScope,
    target_table: Option<String>,
    target_tables: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
enum SearchScope {
    All,
    MetaOnly,
    DataOnly,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchResponse {
    meta_results: Vec<MetaSearchResult>,
    data_results: Vec<DataSearchResult>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MetaSearchResult {
    match_type: MatchType,
    table_name: String,
    column_name: Option<String>,
    matched_text: String,
    highlight_range: (usize, usize),
    score: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
enum MatchType {
    TableName,
    ColumnName,
    TableComment,
    ColumnComment,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DataSearchResult {
    table_name: String,
    matched_rows: Vec<HashMap<String, String>>,
    matched_columns: Vec<String>,
    total_matches: u64,
    truncated: bool,
    first_row_index: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableData {
    table_name: String,
    table_comment: String,
    columns: Vec<ColumnMeta>,
    rows: Vec<HashMap<String, String>>,
    total_rows: u64,
    page: u32,
    page_size: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableChangeSet {
    table_name: String,
    primary_keys: Vec<String>,
    updates: Vec<RowUpdate>,
    inserts: Vec<HashMap<String, String>>,
    deletes: Vec<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RowUpdate {
    where_keys: HashMap<String, String>,
    changes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveResult {
    updated: u64,
    inserted: u64,
    deleted: u64,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TableOption {
    table_name: String,
    table_comment: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    total_rows: u64,
    table_count: usize,
}
#[derive(Debug, Clone, Serialize)]
struct SearchProgress {
    current: usize,
    total: usize,
    current_table: String,
    status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct PetMenuOpenedPayload {
    pet_locked: bool,
}

#[derive(Debug, Clone, Serialize)]
struct PetLockChangedPayload {
    locked: bool,
}

const FAKE_DB_HOST: &str = "demo";
const FAKE_DB_NAME: &str = "demo_feature_test";

fn is_fake_db_config(config: &DbConfig) -> bool {
    config.host.trim().eq_ignore_ascii_case(FAKE_DB_HOST)
}

fn runtime_db_connected(rt: &RuntimeState) -> bool {
    rt.pool.is_some() || rt.fake_db_connected
}

fn fake_database_names() -> Vec<String> {
    vec![FAKE_DB_NAME.into(), "demo_shop".into(), "demo_ops".into()]
}

fn is_fake_database_name(database: &str) -> bool {
    fake_database_names()
        .iter()
        .any(|item| item.eq_ignore_ascii_case(database.trim()))
}

fn validate_db_server_config(config: &DbConfig) -> Result<(), String> {
    if config.host.trim().is_empty() {
        return Err("请填写数据库主机".into());
    }
    Ok(())
}

fn build_db_server_connect_options(config: &DbConfig) -> MySqlConnectOptions {
    MySqlConnectOptions::new()
        .host(config.host.trim())
        .port(config.port)
        .username(config.username.trim())
        .password(&config.password)
        .ssl_mode(MySqlSslMode::Disabled)
}

fn build_selected_database_connect_options(
    config: &DbConfig,
    database: &str,
) -> MySqlConnectOptions {
    build_db_server_connect_options(config).database(database.trim())
}

#[tauri::command]
async fn connect_db(
    config: DbConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    validate_db_server_config(&config)?;
    let selected_database = config.database.trim().to_string();
    if is_fake_db_config(&config) {
        let schema = if selected_database.is_empty() {
            SchemaCache::default()
        } else if is_fake_database_name(&selected_database) {
            mock_schema_cache()
        } else {
            return Err(format!("测试数据库不存在: {selected_database}"));
        };
        let mut next_config = config;
        next_config.database = selected_database;
        let mut runtime = state.runtime.lock().await;
        runtime.pool = None;
        runtime.fake_db_connected = true;
        runtime.schema_cache = schema;
        runtime.config.shared.db = next_config;
        save_config_to_disk(&app, &runtime.config)?;
        return Ok(if runtime.config.shared.db.database.is_empty() {
            "测试数据库连接成功，请选择数据库".into()
        } else {
            "测试数据库连接成功".into()
        });
    }
    let opts = if selected_database.is_empty() {
        build_db_server_connect_options(&config)
    } else {
        build_selected_database_connect_options(&config, &selected_database)
    };
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| format!("数据库连接失败: {e}"))?;
    let schema = if selected_database.is_empty() {
        SchemaCache::default()
    } else {
        load_schema_from_database(&pool, &selected_database).await?
    };
    let mut next_config = config;
    next_config.database = selected_database;
    let mut runtime = state.runtime.lock().await;
    runtime.pool = Some(pool);
    runtime.fake_db_connected = false;
    runtime.schema_cache = schema;
    runtime.config.shared.db = next_config;
    save_config_to_disk(&app, &runtime.config)?;
    Ok(if runtime.config.shared.db.database.is_empty() {
        "数据库连接成功，请选择数据库".into()
    } else {
        "数据库连接成功".into()
    })
}
#[tauri::command]
async fn disconnect_db(state: State<'_, AppState>) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    rt.pool = None;
    rt.fake_db_connected = false;
    rt.schema_cache = SchemaCache::default();
    Ok(())
}
#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    let rt = state.runtime.lock().await;
    Ok(ConnectionStatus {
        connected: runtime_db_connected(&rt),
        database: if rt.config.shared.db.database.is_empty() {
            None
        } else {
            Some(rt.config.shared.db.database.clone())
        },
    })
}
#[tauri::command]
async fn list_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let pool = {
        let rt = state.runtime.lock().await;
        if rt.fake_db_connected {
            return Ok(fake_database_names());
        }
        rt.pool
            .clone()
            .ok_or_else(|| "数据库未连接".to_string())?
    };
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("读取数据库列表失败: {e}"))?;
    Ok(filter_user_databases(
        rows.into_iter()
            .filter_map(|row| row.try_get::<String, _>(0).ok())
            .collect(),
    ))
}
#[tauri::command]
async fn select_database(
    database: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SchemaInfo, String> {
    let database = database.trim().to_string();
    if database.is_empty() {
        return Err("请选择数据库".into());
    }
    let config = {
        let rt = state.runtime.lock().await;
        if !runtime_db_connected(&rt) {
            return Err("数据库未连接".into());
        }
        rt.config.shared.db.clone()
    };
    validate_db_server_config(&config)?;
    if is_fake_db_config(&config) {
        if !is_fake_database_name(&database) {
            return Err(format!("测试数据库不存在: {database}"));
        }
        let schema = mock_schema_cache();
        let info = SchemaInfo {
            table_count: schema.tables.len(),
            column_count: schema.tables.iter().map(|t| t.columns.len()).sum(),
            last_refresh: schema.last_refresh,
        };
        let mut next_config = config;
        next_config.database = database;
        let mut rt = state.runtime.lock().await;
        rt.pool = None;
        rt.fake_db_connected = true;
        rt.schema_cache = schema;
        rt.config.shared.db = next_config;
        save_config_to_disk(&app, &rt.config)?;
        return Ok(info);
    }
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(build_selected_database_connect_options(&config, &database))
        .await
        .map_err(|e| format!("切换数据库失败: {e}"))?;
    let schema = load_schema_from_database(&pool, &database).await?;
    let info = SchemaInfo {
        table_count: schema.tables.len(),
        column_count: schema.tables.iter().map(|t| t.columns.len()).sum(),
        last_refresh: schema.last_refresh,
    };
    let mut next_config = config;
    next_config.database = database;
    let mut rt = state.runtime.lock().await;
    rt.pool = Some(pool);
    rt.schema_cache = schema;
    rt.config.shared.db = next_config;
    save_config_to_disk(&app, &rt.config)?;
    Ok(info)
}
#[tauri::command]
async fn refresh_schema(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SchemaInfo, String> {
    let (pool, fake_connected, db) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool.clone(),
            rt.fake_db_connected,
            rt.config.shared.db.database.clone(),
        )
    };
    let schema = if fake_connected {
        if db.trim().is_empty() {
            return Err("请先选择数据库".into());
        }
        mock_schema_cache()
    } else if let Some(pool) = pool {
        if db.trim().is_empty() {
            return Err("请先选择数据库".into());
        }
        load_schema_from_database(&pool, &db).await?
    } else {
        mock_schema_cache()
    };
    let info = SchemaInfo {
        table_count: schema.tables.len(),
        column_count: schema.tables.iter().map(|t| t.columns.len()).sum(),
        last_refresh: schema.last_refresh,
    };
    let mut rt = state.runtime.lock().await;
    rt.schema_cache = schema;
    save_config_to_disk(&app, &rt.config)?;
    Ok(info)
}
#[tauri::command]
async fn search(
    app: tauri::AppHandle,
    params: SearchParams,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let keyword = params.keyword.trim().to_string();
    if keyword.is_empty() {
        return Ok(SearchResponse {
            meta_results: vec![],
            data_results: vec![],
        });
    }
    let token = state.cancel_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let terms = split_terms(&keyword);
    let (pool, schema, cfg, demo_rows) = {
        let rt = state.runtime.lock().await;
        let pool = rt.pool.clone();
        let connected = runtime_db_connected(&rt);
        (
            pool.clone(),
            resolve_runtime_schema(connected, &rt.schema_cache),
            rt.config.clone(),
            rt.demo_rows.clone(),
        )
    };
    let mut targets = params.target_tables.clone().unwrap_or_default();
    if let Some(single) = params.target_table.clone() {
        targets.push(single);
    }
    let target_tables: Vec<String> = targets
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let target_filter: Option<Vec<String>> = if target_tables.is_empty() {
        None
    } else {
        Some(target_tables)
    };

    let mut meta_results = if params.scope != SearchScope::DataOnly {
        meta_search(&schema, &terms)
    } else {
        vec![]
    };
    if let Some(targets) = &target_filter {
        meta_results.retain(|item| targets.iter().any(|target| item.table_name.eq_ignore_ascii_case(target)));
    }
    if params.scope == SearchScope::DataOnly {
        meta_results.clear();
    }
    let mut data_results = vec![];
    if params.scope != SearchScope::MetaOnly {
        let mut tables = schema.tables.clone();
        if let Some(targets) = &target_filter {
            tables.retain(|t| targets.iter().any(|target| t.table_name.eq_ignore_ascii_case(target)));
        }
        let patterns = compile_patterns(&cfg.shared.search.exclude_tables);
        tables.retain(|t| !patterns.iter().any(|p| p.is_match(&t.table_name)));
        let _ = app.emit(
            "search-progress",
            SearchProgress {
                current: 0,
                total: tables.len(),
                current_table: "".into(),
                status: "searching",
            },
        );
        for (i, table) in tables.iter().enumerate() {
            if state.cancel_seq.load(Ordering::SeqCst) != token {
                let _ = app.emit(
                    "search-progress",
                    SearchProgress {
                        current: i,
                        total: tables.len(),
                        current_table: table.table_name.clone(),
                        status: "cancelled",
                    },
                );
                return Ok(SearchResponse {
                    meta_results,
                    data_results,
                });
            }
            let _ = app.emit(
                "search-progress",
                SearchProgress {
                    current: i + 1,
                    total: tables.len(),
                    current_table: table.table_name.clone(),
                    status: "searching",
                },
            );
            let item = if let Some(pool) = &pool {
                search_table_data_in_db(
                    pool,
                    table,
                    &keyword,
                    cfg.shared.search.per_table_max_rows,
                    &terms,
                )
                .await?
            } else {
                search_table_data_in_mock(
                    table,
                    &terms,
                    cfg.shared.search.per_table_max_rows,
                    &demo_rows,
                )
            };
            if let Some(item) = item {
                data_results.push(item);
            }
        }
        let _ = app.emit(
            "search-progress",
            SearchProgress {
                current: tables.len(),
                total: tables.len(),
                current_table: "done".into(),
                status: "completed",
            },
        );
    }
    Ok(SearchResponse {
        meta_results,
        data_results,
    })
}
#[tauri::command]
async fn cancel_search(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_seq.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
async fn get_table_data(
    table_name: String,
    page: u32,
    page_size: u32,
    state: State<'_, AppState>,
) -> Result<TableData, String> {
    let page = page.max(1);
    let page_size = page_size.max(1).min(200);
    let (pool, schema, demo_rows) = {
        let rt = state.runtime.lock().await;
        let pool = rt.pool.clone();
        let connected = runtime_db_connected(&rt);
        (
            pool.clone(),
            resolve_runtime_schema(connected, &rt.schema_cache),
            rt.demo_rows.clone(),
        )
    };
    let table = schema
        .tables
        .iter()
        .find(|t| t.table_name == table_name)
        .cloned()
        .ok_or_else(|| "目标表不存在".to_string())?;
    if let Some(pool) = pool {
        let total_sql = format!(
            "SELECT COUNT(*) as cnt FROM `{}`",
            escape_ident(&table_name)
        );
        let total_row = sqlx::query(&total_sql)
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("统计失败: {e}"))?;
        let total_rows: i64 = total_row.try_get("cnt").unwrap_or(0);
        let offset = (page.saturating_sub(1) * page_size) as i64;
        let select_cols = table
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}` LIMIT {} OFFSET {}",
            select_cols,
            escape_ident(&table_name),
            page_size,
            offset
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取失败: {e}"))?;
        return Ok(TableData {
            table_name,
            table_comment: table.table_comment,
            columns: table.columns.clone(),
            rows: map_rows_to_string_map(rows, &table.columns),
            total_rows: total_rows.max(0) as u64,
            page,
            page_size,
        });
    }
    let data = demo_rows_for_table(&demo_rows, &table_name);
    let total_rows = data.len() as u64;
    let s = (page.saturating_sub(1) * page_size) as usize;
    let e = (s + page_size as usize).min(data.len());
    let rows = if s >= data.len() {
        vec![]
    } else {
        data[s..e].to_vec()
    };
    Ok(TableData {
        table_name,
        table_comment: table.table_comment,
        columns: table.columns,
        rows,
        total_rows,
        page,
        page_size,
    })
}

#[tauri::command]
async fn save_table_changes(
    changeset: TableChangeSet,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let pool = {
        let rt = state.runtime.lock().await;
        rt.pool.clone()
    };
    let Some(pool) = pool else {
        let mut rt = state.runtime.lock().await;
        return save_table_changes_to_demo_rows(&mut rt.demo_rows, &changeset);
    };
    let table = escape_ident(&changeset.table_name);
    let has_pk = !changeset.primary_keys.is_empty();
    let mut warnings: Vec<String> = Vec::new();
    let mut deleted: u64 = 0;
    let mut updated: u64 = 0;
    let mut inserted: u64 = 0;

    let mut tx = pool.begin().await.map_err(|e| format!("开启事务失败: {e}"))?;

    // --- DELETE ---
    for del_row in &changeset.deletes {
        if del_row.is_empty() {
            continue;
        }
        let (where_clause, where_vals) = if has_pk {
            build_where_from_keys(&changeset.primary_keys, del_row)?
        } else {
            build_where_from_all(del_row)?
        };
        let sql = if has_pk {
            format!("DELETE FROM `{}` WHERE {}", table, where_clause)
        } else {
            format!("DELETE FROM `{}` WHERE {} LIMIT 1", table, where_clause)
        };
        let mut q = sqlx::query(&sql);
        for v in &where_vals {
            q = q.bind(v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("删除失败: {e}"))?;
        deleted += result.rows_affected();
        if !has_pk {
            warnings.push(format!("无主键表删除使用全列匹配 LIMIT 1"));
        }
    }

    // --- UPDATE ---
    for upd in &changeset.updates {
        if upd.changes.is_empty() {
            continue;
        }
        let set_cols: Vec<String> = upd
            .changes
            .keys()
            .map(|k| format!("`{}` = ?", escape_ident(k)))
            .collect();
        let set_vals: Vec<&String> = upd.changes.values().collect();

        let (where_clause, where_vals) = if has_pk {
            build_where_from_keys(&changeset.primary_keys, &upd.where_keys)?
        } else {
            build_where_from_all(&upd.where_keys)?
        };

        let sql = if has_pk {
            format!(
                "UPDATE `{}` SET {} WHERE {}",
                table,
                set_cols.join(", "),
                where_clause
            )
        } else {
            format!(
                "UPDATE `{}` SET {} WHERE {} LIMIT 1",
                table,
                set_cols.join(", "),
                where_clause
            )
        };

        let mut q = sqlx::query(&sql);
        for v in &set_vals {
            q = q.bind(*v);
        }
        for v in &where_vals {
            q = q.bind(v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("更新失败: {e}"))?;
        updated += result.rows_affected();
        if !has_pk {
            warnings.push(format!("无主键表更新使用全列匹配 LIMIT 1"));
        }
    }

    // --- INSERT ---
    for ins_row in &changeset.inserts {
        if ins_row.is_empty() {
            continue;
        }
        let cols: Vec<String> = ins_row.keys().map(|k| format!("`{}`", escape_ident(k))).collect();
        let placeholders: Vec<&str> = ins_row.keys().map(|_| "?").collect();
        let vals: Vec<&String> = ins_row.values().collect();
        let sql = format!(
            "INSERT INTO `{}` ({}) VALUES ({})",
            table,
            cols.join(", "),
            placeholders.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for v in &vals {
            q = q.bind(*v);
        }
        let result = q.execute(&mut *tx).await.map_err(|e| format!("插入失败: {e}"))?;
        inserted += result.rows_affected();
    }

    tx.commit().await.map_err(|e| format!("提交事务失败: {e}"))?;

    // Deduplicate warnings
    warnings.sort();
    warnings.dedup();

    Ok(SaveResult {
        updated,
        inserted,
        deleted,
        warnings,
    })
}

fn build_where_from_keys(
    pk_cols: &[String],
    row: &HashMap<String, String>,
) -> Result<(String, Vec<String>), String> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for col in pk_cols {
        let val = row
            .get(col)
            .ok_or_else(|| format!("缺少主键列值: {}", col))?;
        parts.push(format!("`{}` = ?", escape_ident(col)));
        vals.push(val.clone());
    }
    if parts.is_empty() {
        return Err("WHERE 条件为空".to_string());
    }
    Ok((parts.join(" AND "), vals))
}

fn build_where_from_all(
    row: &HashMap<String, String>,
) -> Result<(String, Vec<String>), String> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for (col, val) in row {
        parts.push(format!("`{}` = ?", escape_ident(col)));
        vals.push(val.clone());
    }
    if parts.is_empty() {
        return Err("WHERE 条件为空".to_string());
    }
    Ok((parts.join(" AND "), vals))
}

#[tauri::command]
async fn list_tables(state: State<'_, AppState>) -> Result<Vec<TableOption>, String> {
    let schema = {
        let rt = state.runtime.lock().await;
        resolve_runtime_schema(runtime_db_connected(&rt), &rt.schema_cache)
    };
    let mut out = schema
        .tables
        .iter()
        .map(|item| TableOption {
            table_name: item.table_name.clone(),
            table_comment: item.table_comment.clone(),
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| a.table_name.cmp(&b.table_name));
    Ok(out)
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let families = source
        .all_families()
        .map_err(|e| format!("Failed to list fonts: {}", e))?;
    let mut sorted = families;
    sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    sorted.dedup();
    Ok(sorted)
}

#[tauri::command]
async fn export_tables_xlsx(
    tables: Vec<String>,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let (pool, schema) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool
                .clone()
                .ok_or_else(|| "数据库未连接".to_string())?,
            rt.schema_cache.clone(),
        )
    };

    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();
    let mut total_rows: u64 = 0;
    let table_count = tables.len();

    for table_name in &tables {
        let table_meta = schema
            .tables
            .iter()
            .find(|t| &t.table_name == table_name)
            .ok_or_else(|| format!("表 {} 不存在", table_name))?;

        // Sheet name max 31 chars
        let sheet_name: String = table_name.chars().take(31).collect();
        let worksheet = workbook
            .add_worksheet()
            .set_name(&sheet_name)
            .map_err(|e| format!("创建工作表失败: {e}"))?;

        // Write header row
        for (col_idx, col) in table_meta.columns.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col_idx as u16, &col.column_name, &bold)
                .map_err(|e| format!("写入表头失败: {e}"))?;
        }

        // Query all data
        let select_cols = table_meta
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}`",
            select_cols,
            escape_ident(table_name)
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取表 {} 失败: {e}", table_name))?;

        total_rows += rows.len() as u64;

        for (row_idx, row) in rows.iter().enumerate() {
            for (col_idx, col) in table_meta.columns.iter().enumerate() {
                let val: Option<String> = row.try_get(col.column_name.as_str()).unwrap_or(None);
                if let Some(v) = val {
                    let _ = worksheet.write_string((row_idx + 1) as u32, col_idx as u16, &v);
                }
            }
        }
    }

    workbook
        .save(&file_path)
        .map_err(|e| format!("保存文件失败: {e}"))?;

    Ok(ExportResult {
        total_rows,
        table_count,
    })
}

#[tauri::command]
async fn export_tables_xlsx_batch(
    tables: Vec<String>,
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let (pool, schema) = {
        let rt = state.runtime.lock().await;
        (
            rt.pool
                .clone()
                .ok_or_else(|| "数据库未连接".to_string())?,
            rt.schema_cache.clone(),
        )
    };

    let bold = Format::new().set_bold();
    let mut total_rows: u64 = 0;
    let table_count = tables.len();

    for table_name in &tables {
        let table_meta = schema
            .tables
            .iter()
            .find(|t| &t.table_name == table_name)
            .ok_or_else(|| format!("表 {} 不存在", table_name))?;

        let mut workbook = Workbook::new();
        let sheet_name: String = table_name.chars().take(31).collect();
        let worksheet = workbook
            .add_worksheet()
            .set_name(&sheet_name)
            .map_err(|e| format!("创建工作表失败: {e}"))?;

        for (col_idx, col) in table_meta.columns.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col_idx as u16, &col.column_name, &bold)
                .map_err(|e| format!("写入表头失败: {e}"))?;
        }

        let select_cols = table_meta
            .columns
            .iter()
            .map(|c| {
                format!(
                    "CAST(`{}` AS CHAR) AS `{}`",
                    escape_ident(&c.column_name),
                    escape_ident(&c.column_name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {} FROM `{}`",
            select_cols,
            escape_ident(table_name)
        );
        let rows = sqlx::query(&sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("读取表 {} 失败: {e}", table_name))?;

        total_rows += rows.len() as u64;

        for (row_idx, row) in rows.iter().enumerate() {
            for (col_idx, col) in table_meta.columns.iter().enumerate() {
                let val: Option<String> = row.try_get(col.column_name.as_str()).unwrap_or(None);
                if let Some(v) = val {
                    let _ = worksheet.write_string((row_idx + 1) as u32, col_idx as u16, &v);
                }
            }
        }

        let file_path = format!("{}/{}.xlsx", dir_path.trim_end_matches(['/', '\\']), table_name);
        workbook
            .save(&file_path)
            .map_err(|e| format!("保存文件 {} 失败: {e}", file_path))?;
    }

    Ok(ExportResult {
        total_rows,
        table_count,
    })
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.runtime.lock().await.config.clone())
}

#[tauri::command]
async fn get_quick_paste_config(state: State<'_, AppState>) -> Result<QuickPasteConfig, String> {
    let rt = state.runtime.lock().await;
    Ok(sanitize_quick_paste_config(rt.config.personal.quick_paste.clone()))
}

#[tauri::command]
async fn save_quick_paste_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: QuickPasteConfig,
) -> Result<QuickPasteConfig, String> {
    let next = sanitize_quick_paste_config(config);
    {
        let mut rt = state.runtime.lock().await;
        validate_quick_paste_hotkeys(&rt.config.personal, &next)?;
        rt.config.personal.quick_paste = next.clone();
        save_config_to_disk(&app, &rt.config)?;
    }
    register_quick_paste_hotkeys(&app, state.inner()).await?;
    Ok(next)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut chunk = [0u8; 4];
    let mut len = 0usize;
    for byte in input.bytes().filter(|b| !b"\r\n\t ".contains(b)) {
        if byte == b'=' {
            chunk[len] = 64;
        } else {
            chunk[len] = value(byte).ok_or_else(|| "图片 base64 数据无效".to_string())?;
        }
        len += 1;
        if len == 4 {
            out.push((chunk[0] << 2) | (chunk[1] >> 4));
            if chunk[2] != 64 {
                out.push((chunk[1] << 4) | (chunk[2] >> 2));
            }
            if chunk[3] != 64 {
                out.push((chunk[2] << 6) | chunk[3]);
            }
            len = 0;
        }
    }
    if len != 0 {
        return Err("图片 base64 数据长度无效".into());
    }
    Ok(out)
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn sanitize_quick_paste_image_ext(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "png",
    }
}

#[tauri::command]
async fn save_quick_paste_image(
    app: tauri::AppHandle,
    data_url: String,
    file_name: String,
) -> Result<String, String> {
    let comma = data_url.find(',').ok_or_else(|| "图片数据格式无效".to_string())?;
    let meta = &data_url[..comma];
    let payload = &data_url[comma + 1..];
    if !meta.starts_with("data:image/") || !meta.contains(";base64") {
        return Err("只支持 base64 图片数据".into());
    }

    let mime = meta
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .unwrap_or("image/png");
    let ext = sanitize_quick_paste_image_ext(mime);
    let safe_stem: String = file_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .take(60)
        .collect();
    let stem = safe_stem.trim_matches('.');
    let final_name = if stem.is_empty() {
        format!("quick-paste-{}.{}", Utc::now().timestamp_millis(), ext)
    } else {
        format!("{}-{}.{}", stem, Utc::now().timestamp_millis(), ext)
    };

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?
        .join("quick-paste-images");
    fs::create_dir_all(&dir).map_err(|e| format!("创建图片目录失败: {e}"))?;
    let path = dir.join(final_name);
    let bytes = base64_decode(payload)?;
    fs::write(&path, bytes).map_err(|e| format!("保存图片失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn upsert_quick_paste_snippet(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    snippet: QuickPasteSnippet,
) -> Result<Vec<QuickPasteSnippet>, String> {
    let mut snippet = sanitize_quick_paste_snippet(snippet).ok_or_else(|| "请填写标题和文本内容".to_string())?;
    let now = now_rfc3339();
    let mut rt = state.runtime.lock().await;
    let snippets = &mut rt.config.personal.quick_paste.snippets;

    if snippet.id.trim().is_empty() {
        snippet.id = format!("quick-paste-{}", Utc::now().timestamp_millis());
        snippet.created_at = now.clone();
    }
    snippet.updated_at = now.clone();

    if let Some(existing) = snippets.iter_mut().find(|item| item.id == snippet.id) {
        if snippet.created_at.trim().is_empty() {
            snippet.created_at = existing.created_at.clone();
        }
        *existing = snippet;
    } else {
        if snippet.created_at.trim().is_empty() {
            snippet.created_at = now;
        }
        snippets.push(snippet);
    }

    enforce_single_quick_paste_default(snippets);
    let result = snippets.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(result)
}

fn collect_quick_paste_local_image_paths(snippet: &QuickPasteSnippet) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if snippet.category == "image" && !snippet.content.starts_with("data:") {
        paths.push(PathBuf::from(snippet.content.trim()));
    }
    let img_re = Regex::new(r#"<img\b[^>]*(?:data-path|src)=["']([^"']+)["'][^>]*>"#).unwrap();
    for caps in img_re.captures_iter(&snippet.content) {
        if let Some(src) = caps.get(1).map(|m| m.as_str().trim()) {
            if !src.starts_with("data:") && !src.starts_with("http://") && !src.starts_with("https://") && !src.starts_with("asset:") {
                paths.push(PathBuf::from(src));
            }
        }
    }
    paths
}

fn remove_quick_paste_owned_images(app: &tauri::AppHandle, snippet: &QuickPasteSnippet) {
    let Ok(image_dir) = app.path().app_data_dir().map(|dir| dir.join("quick-paste-images")) else {
        return;
    };
    let Ok(image_dir) = image_dir.canonicalize() else {
        return;
    };
    for path in collect_quick_paste_local_image_paths(snippet) {
        let Ok(path) = path.canonicalize() else {
            continue;
        };
        if path.starts_with(&image_dir) {
            let _ = fs::remove_file(path);
        }
    }
}

#[tauri::command]
async fn delete_quick_paste_snippet(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<QuickPasteSnippet>, String> {
    let mut rt = state.runtime.lock().await;
    let removed: Vec<QuickPasteSnippet> = rt
        .config
        .personal
        .quick_paste
        .snippets
        .iter()
        .filter(|snippet| snippet.id == id)
        .cloned()
        .collect();
    rt.config.personal.quick_paste.snippets.retain(|snippet| snippet.id != id);
    for snippet in &removed {
        remove_quick_paste_owned_images(&app, snippet);
    }
    let result = rt.config.personal.quick_paste.snippets.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(result)
}

#[tauri::command]
async fn set_default_quick_paste_snippet(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<QuickPasteSnippet>, String> {
    let mut rt = state.runtime.lock().await;
    let mut found = false;
    for snippet in &mut rt.config.personal.quick_paste.snippets {
        let is_match = snippet.id == id;
        snippet.is_default = is_match;
        found |= is_match;
    }
    if !found {
        return Err("找不到要设为默认的文本".into());
    }
    let result = rt.config.personal.quick_paste.snippets.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(result)
}
#[tauri::command]
async fn output_quick_paste_snippet(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let (content, category) = {
        let rt = state.runtime.lock().await;
        rt.config
            .personal
            .quick_paste
            .snippets
            .iter()
            .find(|snippet| snippet.id == id)
            .map(|snippet| (snippet.content.clone(), snippet.category.clone()))
            .ok_or_else(|| "找不到要输出的内容".to_string())?
    };

    let (output_content, effective_category) = if category == "rich" {
        (content, "rich".to_string())
    } else {
        (content, category)
    };
    let steps = quick_paste_output_steps(&effective_category, is_quick_paste_window_visible(&app));
    run_quick_paste_output_steps(app, steps, &output_content).await
}

#[tauri::command]
async fn output_default_quick_paste_snippet(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    output_default_quick_paste_text(app, state.inner().clone()).await
}

#[tauri::command]
async fn save_config(
    config: AppConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.lock().await.config = config.clone();
    save_config_to_disk(&app, &config)
}

#[tauri::command]
async fn get_update_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateSettingsSnapshot, String> {
    let config = state.runtime.lock().await.config.clone();
    Ok(UpdateSettingsSnapshot {
        current_version: app.package_info().version.to_string(),
        auto_check_updates: config.personal.auto_check_updates,
        last_update_check_at: config.personal.last_update_check_at,
    })
}

#[tauri::command]
async fn prepare_startup_update_check(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckPlan, String> {
    let current_version = app.package_info().version.to_string();
    let now = Utc::now();
    let mut rt = state.runtime.lock().await;
    let mut plan = build_update_check_plan(
        rt.config.personal.auto_check_updates,
        now,
        false,
    );
    plan.current_version = current_version;

    if let Some(checked_at) = plan.checked_at.clone() {
        rt.config.personal.last_update_check_at = Some(checked_at);
        save_config_to_disk(&app, &rt.config)?;
    }

    Ok(plan)
}

#[tauri::command]
async fn check_for_updates_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckPlan, String> {
    let current_version = app.package_info().version.to_string();
    let now = Utc::now();
    let mut rt = state.runtime.lock().await;
    let mut plan = build_update_check_plan(
        rt.config.personal.auto_check_updates,
        now,
        true,
    );
    plan.current_version = current_version;

    if let Some(checked_at) = plan.checked_at.clone() {
        rt.config.personal.last_update_check_at = Some(checked_at);
        save_config_to_disk(&app, &rt.config)?;
    }

    Ok(plan)
}

#[tauri::command]
async fn remember_pending_update_announcement(
    announcement: UpdateAnnouncement,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let announcement = normalize_update_announcement(announcement)
        .ok_or_else(|| "更新公告缺少版本号".to_string())?;
    let mut rt = state.runtime.lock().await;
    rt.config.personal.pending_update_announcement = Some(announcement);
    save_config_to_disk(&app, &rt.config)
}

#[tauri::command]
async fn acknowledge_update_announcement(
    version: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let normalized_version = normalize_update_announcement_version(&version);
    if normalized_version.is_empty() {
        return Err("更新公告版本号不能为空".into());
    }

    {
        let mut rt = state.runtime.lock().await;
        rt.config.personal.last_update_announcement_version = Some(normalized_version.clone());
        let should_clear_pending = rt
            .config
            .personal
            .pending_update_announcement
            .as_ref()
            .map(|announcement| {
                normalize_update_announcement_version(&announcement.version) == normalized_version
            })
            .unwrap_or(false);
        if should_clear_pending {
            rt.config.personal.pending_update_announcement = None;
        }
        save_config_to_disk(&app, &rt.config)?;
    }

    if let Some(window) = app.get_webview_window(UPDATE_ANNOUNCEMENT_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn register_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, quick_date, sync_window_hotkey, db_migration_window_hotkey, quick_paste_open, quick_paste_output) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
            rt.registered_quick_paste_open_hotkey.clone(),
            rt.registered_quick_paste_output_hotkey.clone(),
        )
    };
    if quick_date.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
        || quick_paste_open.as_deref() == Some(normalized.as_str())
        || quick_paste_output.as_deref() == Some(normalized.as_str())
    {
        return Err("主快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("快捷键注册失败: {e}"))?;

    *state.panel_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_quick_date_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, panel_hotkey, sync_window_hotkey, db_migration_window_hotkey, quick_paste_open, quick_paste_output) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
            rt.registered_quick_paste_open_hotkey.clone(),
            rt.registered_quick_paste_output_hotkey.clone(),
        )
    };
    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
        || quick_paste_open.as_deref() == Some(normalized.as_str())
        || quick_paste_output.as_deref() == Some(normalized.as_str())
    {
        return Err("日期快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("日期快捷键注册失败: {e}"))?;

    *state.quick_date_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_quick_date_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_sync_window_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = normalize_hotkey_for_plugin(&hotkey)?;
    let (previous, panel_hotkey, quick_date_hotkey, db_migration_window_hotkey, quick_paste_open, quick_paste_output) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
            rt.registered_quick_paste_open_hotkey.clone(),
            rt.registered_quick_paste_output_hotkey.clone(),
        )
    };
    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || quick_date_hotkey.as_deref() == Some(normalized.as_str())
        || db_migration_window_hotkey.as_deref() == Some(normalized.as_str())
        || quick_paste_open.as_deref() == Some(normalized.as_str())
        || quick_paste_output.as_deref() == Some(normalized.as_str())
    {
        return Err("同步工作台快捷键不能与其他全局快捷键重复".into());
    }
    let manager = app.global_shortcut();

    if previous.as_deref() == Some(normalized.as_str()) {
        return Ok(normalized);
    }

    // Unregister previous before registering the new one
    if let Some(ref prev) = previous {
        let _ = manager.unregister(prev.as_str());
    }

    manager
        .register(normalized.as_str())
        .map_err(|e| format!("同步窗口快捷键注册失败: {e}"))?;

    *state.sync_window_hotkey_sync.write().unwrap() = Some(normalized.clone());
    state.runtime.lock().await.registered_sync_window_hotkey = Some(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
async fn register_db_migration_window_hotkey(
    hotkey: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized = if hotkey.trim().is_empty() {
        normalize_hotkey_for_plugin(default_db_migration_window_hotkey().as_str())?
    } else {
        normalize_hotkey_for_plugin(&hotkey)?
    };

    let (previous, panel_hotkey, quick_date_hotkey, sync_window_hotkey, quick_paste_open, quick_paste_output) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_db_migration_window_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_quick_paste_open_hotkey.clone(),
            rt.registered_quick_paste_output_hotkey.clone(),
        )
    };

    if panel_hotkey.as_deref() == Some(normalized.as_str())
        || quick_date_hotkey.as_deref() == Some(normalized.as_str())
        || sync_window_hotkey.as_deref() == Some(normalized.as_str())
        || quick_paste_open.as_deref() == Some(normalized.as_str())
        || quick_paste_output.as_deref() == Some(normalized.as_str())
    {
        return Err("数据库迁移工作台快捷键不能与其他全局快捷键重复".into());
    }

    let manager = app.global_shortcut();

    if previous.as_deref() != Some(normalized.as_str()) {
        if let Some(ref prev) = previous {
            let _ = manager.unregister(prev.as_str());
        }

        manager
            .register(normalized.as_str())
            .map_err(|e| format!("数据库迁移工作台快捷键注册失败: {e}"))?;
    }

    *state.db_migration_window_hotkey_sync.write().unwrap() = Some(normalized.clone());

    let mut rt = state.runtime.lock().await;
    rt.registered_db_migration_window_hotkey = Some(normalized.clone());
    rt.config.personal.db_migration_window_hotkey = normalized.clone();
    save_config_to_disk(&app, &rt.config)?;

    Ok(normalized)
}

#[tauri::command]
async fn show_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SYNC_WORKSPACE_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_sync_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn register_quick_paste_hotkeys(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let open = {
        let rt = state.runtime.lock().await;
        normalize_hotkey_for_plugin(&rt.config.personal.quick_paste.open_hotkey)?
    };
    let output = {
        let rt = state.runtime.lock().await;
        normalize_hotkey_for_plugin(&rt.config.personal.quick_paste.output_hotkey)?
    };
    if open == output {
        return Err("打开快捷粘贴和输出默认文本不能使用同一个快捷键".into());
    }

    let (previous_open, previous_output, panel_hotkey, quick_date_hotkey, sync_window_hotkey, db_migration_window_hotkey) = {
        let rt = state.runtime.lock().await;
        (
            rt.registered_quick_paste_open_hotkey.clone(),
            rt.registered_quick_paste_output_hotkey.clone(),
            rt.registered_hotkey.clone(),
            rt.registered_quick_date_hotkey.clone(),
            rt.registered_sync_window_hotkey.clone(),
            rt.registered_db_migration_window_hotkey.clone(),
        )
    };
    let conflicts = [
        panel_hotkey.as_deref(),
        quick_date_hotkey.as_deref(),
        sync_window_hotkey.as_deref(),
        db_migration_window_hotkey.as_deref(),
    ];
    if conflicts.iter().flatten().any(|existing| *existing == open || *existing == output) {
        return Err("快捷粘贴快捷键不能与其他全局快捷键重复".into());
    }

    let manager = app.global_shortcut();
    let registered_open;
    let registered_output;
    let mut errors = Vec::new();

    if previous_open.as_deref() != Some(open.as_str()) {
        if let Some(prev) = previous_open.as_deref() {
            let _ = manager.unregister(prev);
        }
        match manager.register(open.as_str()) {
            Ok(()) => {
                *state.quick_paste_open_hotkey_sync.write().unwrap() = Some(open.clone());
                registered_open = Some(open.clone());
            }
            Err(e) => {
                *state.quick_paste_open_hotkey_sync.write().unwrap() = None;
                registered_open = None;
                errors.push(format!("快捷粘贴打开快捷键注册失败: {e}"));
            }
        }
    } else {
        *state.quick_paste_open_hotkey_sync.write().unwrap() = Some(open.clone());
        registered_open = Some(open.clone());
    }

    if previous_output.as_deref() != Some(output.as_str()) {
        if let Some(prev) = previous_output.as_deref() {
            let _ = manager.unregister(prev);
        }
        match manager.register(output.as_str()) {
            Ok(()) => {
                *state.quick_paste_output_hotkey_sync.write().unwrap() = Some(output.clone());
                registered_output = Some(output.clone());
            }
            Err(e) => {
                *state.quick_paste_output_hotkey_sync.write().unwrap() = None;
                registered_output = None;
                errors.push(format!("默认文本输出快捷键注册失败: {e}"));
            }
        }
    } else {
        *state.quick_paste_output_hotkey_sync.write().unwrap() = Some(output.clone());
        registered_output = Some(output.clone());
    }

    let mut rt = state.runtime.lock().await;
    rt.registered_quick_paste_open_hotkey = registered_open;
    rt.registered_quick_paste_output_hotkey = registered_output;
    drop(rt);

    if errors.is_empty() {
        let _ = app.emit("quick-paste-toast", format!("快捷粘贴快捷键已注册：打开 {open}，输出 {output}"));
        Ok(())
    } else {
        let message = errors.join("；");
        let _ = app.emit("quick-paste-toast", message.clone());
        Err(message)
    }

}

#[tauri::command]
async fn show_quick_paste_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_quick_paste_window(&app)?;
    window.show().map_err(|e| format!("显示快捷粘贴窗口失败: {e}"))?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| format!("聚焦快捷粘贴窗口失败: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn hide_quick_paste_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_PASTE_WINDOW_LABEL) {
        window.hide().map_err(|e| format!("隐藏快捷粘贴窗口失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_quick_paste_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_quick_paste_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| format!("隐藏快捷粘贴窗口失败: {e}"))?;
    } else {
        window.show().map_err(|e| format!("显示快捷粘贴窗口失败: {e}"))?;
        let _ = window.unminimize();
        window.set_focus().map_err(|e| format!("聚焦快捷粘贴窗口失败: {e}"))?;
    }
    Ok(())
}

fn emit_sync_center_mode(app: &tauri::AppHandle, mode: &str) {
    let mode = mode.to_string();
    let _ = app.emit_to(SYNC_WORKSPACE_WINDOW_LABEL, "sync-center-open-mode", mode.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(160)).await;
        let _ = app.emit_to(SYNC_WORKSPACE_WINDOW_LABEL, "sync-center-open-mode", mode);
    });
}

#[tauri::command]
async fn show_db_migration_window(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    emit_sync_center_mode(&app, "database");
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_db_migration_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.db_migration_running_sync.load(Ordering::SeqCst) {
        return Err("数据库迁移进行中，不能隐藏窗口".into());
    }
    if let Some(window) = app.get_webview_window(SYNC_WORKSPACE_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_db_migration_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = ensure_sync_workspace_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    let running = state.db_migration_running_sync.load(Ordering::SeqCst);
    if visible {
        if running {
            emit_sync_center_mode(&app, "database");
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
        window.hide().map_err(|e| e.to_string())?;
        return Ok(());
    }

    emit_sync_center_mode(&app, "database");
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_db_migration_workspace_state(
    state: State<'_, AppState>,
) -> Result<DbMigrationWorkspaceState, String> {
    let rt = state.runtime.lock().await;
    let (profiles, last_used_profile_id) = normalize_db_migration_profile_state(
        rt.config.personal.db_migration_profiles.clone(),
        rt.config.personal.last_used_db_migration_profile_id.clone(),
        rt.config.personal.db_migration_last_connection.clone(),
    );
    Ok(DbMigrationWorkspaceState {
        hotkey: rt.config.personal.db_migration_window_hotkey.clone(),
        profiles: profiles
            .into_iter()
            .map(db_migration_profile_to_payload)
            .collect(),
        last_used_profile_id,
    })
}

#[tauri::command]
async fn save_db_migration_workspace_state(
    workspace_state: DbMigrationWorkspaceStatePayload,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    let (profiles, last_used_profile_id) = normalize_db_migration_profile_state(
        workspace_state
            .profiles
            .into_iter()
            .map(payload_to_db_migration_profile)
            .collect(),
        workspace_state.last_used_profile_id,
        None,
    );
    let remembered_connection = db_migration_profile_to_remembered_connection(
        last_used_profile_id
        .as_ref()
        .and_then(|profile_id| profiles.iter().find(|profile| &profile.id == profile_id))
        .or_else(|| profiles.first()),
    );

    rt.config.personal.db_migration_profiles = profiles;
    rt.config.personal.last_used_db_migration_profile_id = last_used_profile_id;
    rt.config.personal.db_migration_last_connection = remembered_connection;
    save_config_to_disk(&app, &rt.config)?;
    Ok(())
}

#[tauri::command]
async fn connect_db_migration_server(
    params: DbMigrationLoginParams,
) -> Result<DbMigrationLoginResult, String> {
    connect_db_migration_server_impl(params).await
}

#[tauri::command]
async fn run_db_migration(
    request: DbMigrationRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DbMigrationOutcome, String> {
    state
        .db_migration_running_sync
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "当前已有数据库迁移任务在执行中，请稍后再试".to_string())?;

    let result = run_db_migration_impl(&app, request).await;
    state
        .db_migration_running_sync
        .store(false, Ordering::SeqCst);
    result
}

// ── Art Text Search ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ArtTextIndexEntry {
    text: String,
    path: String,
    #[serde(rename = "fileName")]
    file_name: String,
    hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ArtTextIndexError {
    path: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ArtTextIndex {
    version: u32,
    entries: Vec<ArtTextIndexEntry>,
    errors: Vec<ArtTextIndexError>,
    #[serde(rename = "builtAt")]
    built_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ArtTextSearchResult {
    text: String,
    path: String,
    #[serde(rename = "fileName")]
    file_name: String,
}

const OCR_MODEL_DET: &str = "det.onnx";
const OCR_MODEL_REC: &str = "rec.onnx";
const OCR_MODEL_DICT: &str = "ppocr_keys_v1.txt";
const OCR_MODEL_FILES: [&str; 3] = [OCR_MODEL_DET, OCR_MODEL_REC, OCR_MODEL_DICT];
const OCR_MODEL_DOWNLOADS: [(&str, &str, &str); 3] = [
    (
        "pp-ocrv5_mobile_det.onnx",
        OCR_MODEL_DET,
        "https://github.com/GreatV/oar-ocr/releases/download/v0.3.0/pp-ocrv5_mobile_det.onnx",
    ),
    (
        "pp-ocrv5_mobile_rec.onnx",
        OCR_MODEL_REC,
        "https://github.com/GreatV/oar-ocr/releases/download/v0.3.0/pp-ocrv5_mobile_rec.onnx",
    ),
    (
        "ppocrv5_dict.txt",
        OCR_MODEL_DICT,
        "https://github.com/GreatV/oar-ocr/releases/download/v0.3.0/ppocrv5_dict.txt",
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ArtTextOcrModelStatus {
    ready: bool,
    path: String,
    required: Vec<String>,
    missing: Vec<String>,
}

fn inspect_art_text_ocr_model_dir(models_dir: &Path) -> ArtTextOcrModelStatus {
    let missing = OCR_MODEL_FILES
        .iter()
        .filter(|name| !models_dir.join(name).is_file())
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    ArtTextOcrModelStatus {
        ready: missing.is_empty(),
        path: models_dir.to_string_lossy().to_string(),
        required: OCR_MODEL_FILES.iter().map(|name| (*name).to_string()).collect(),
        missing,
    }
}

fn art_text_ocr_models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?
        .join("models"))
}

fn emit_art_text_ocr_install_progress(
    app: &tauri::AppHandle,
    current: u64,
    total: u64,
    current_file: &str,
    phase: &str,
) {
    let _ = app.emit(
        "art-text-ocr-install-progress",
        serde_json::json!({
            "current": current,
            "total": total,
            "currentFile": current_file,
            "phase": phase,
        }),
    );
}

async fn download_ocr_models(app: &tauri::AppHandle, models_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(models_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;

    for (i, (filename, local_name, url)) in OCR_MODEL_DOWNLOADS.iter().enumerate() {
        let dest = models_dir.join(local_name);
        if dest.exists() {
            emit_art_text_ocr_install_progress(
                app,
                (i as u64) + 1,
                OCR_MODEL_DOWNLOADS.len() as u64,
                local_name,
                "skip",
            );
            continue;
        }
        emit_art_text_ocr_install_progress(
            app,
            i as u64,
            OCR_MODEL_DOWNLOADS.len() as u64,
            filename,
            "download",
        );
        let mut response = reqwest::get(*url)
            .await
            .map_err(|e| format!("下载模型 {filename} 失败: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "下载模型 {filename} 失败，HTTP {}，请手动下载: {url}",
                response.status()
            ));
        }
        let temp = models_dir.join(format!("{local_name}.downloading"));
        let mut file = fs::File::create(&temp).map_err(|e| format!("创建临时模型文件失败: {e}"))?;
        let total_bytes = response.content_length().unwrap_or(0).max(1);
        let mut downloaded = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("读取模型 {filename} 数据失败: {e}"))?
        {
            use std::io::Write;
            file.write_all(&chunk)
                .map_err(|e| format!("写入模型文件失败: {e}"))?;
            downloaded += chunk.len() as u64;
            emit_art_text_ocr_install_progress(
                app,
                downloaded.min(total_bytes),
                total_bytes,
                filename,
                "download-bytes",
            );
        }
        drop(file);
        fs::rename(&temp, &dest).map_err(|e| format!("重命名模型文件失败: {e}"))?;
        emit_art_text_ocr_install_progress(
            app,
            (i as u64) + 1,
            OCR_MODEL_DOWNLOADS.len() as u64,
            local_name,
            "install",
        );
    }

    Ok(())
}

fn import_ocr_models_from_dir(source_dir: &Path, models_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(models_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
    let candidates = [
        (OCR_MODEL_DET, ["det.onnx", "pp-ocrv5_mobile_det.onnx"]),
        (OCR_MODEL_REC, ["rec.onnx", "pp-ocrv5_mobile_rec.onnx"]),
        (OCR_MODEL_DICT, ["ppocr_keys_v1.txt", "ppocrv5_dict.txt"]),
    ];

    for (local_name, source_names) in candidates {
        let source = source_names
            .iter()
            .map(|name| source_dir.join(name))
            .find(|path| path.is_file())
            .ok_or_else(|| format!("本地目录缺少模型文件: {local_name}"))?;
        fs::copy(&source, models_dir.join(local_name))
            .map_err(|e| format!("复制模型文件 {} 失败: {e}", source.display()))?;
    }

    Ok(())
}

fn art_text_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("配置目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir.join("art_text_index.json"))
}

fn load_art_text_index(app: &tauri::AppHandle) -> ArtTextIndex {
    let Ok(path) = art_text_index_path(app) else {
        return ArtTextIndex::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return ArtTextIndex::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_art_text_index(app: &tauri::AppHandle, index: &ArtTextIndex) -> Result<(), String> {
    let path = art_text_index_path(app)?;
    fs::write(
        path,
        serde_json::to_string_pretty(index).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("保存索引失败: {e}"))
}

const ART_TEXT_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "bmp", "webp"];

fn is_art_text_image(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ART_TEXT_IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Fast content fingerprint: crc32 of (file_size + first 8KB + last 8KB).
/// Enough to detect moved/renamed/modified files without reading entire images.
fn file_content_hash(path: &std::path::Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let mut buf = Vec::with_capacity(16384 + 8);
    buf.extend_from_slice(&size.to_le_bytes());

    let mut f = fs::File::open(path).ok()?;
    let mut header = [0u8; 8192];
    let n = std::io::Read::read(&mut f, &mut header).unwrap_or(0);
    buf.extend_from_slice(&header[..n]);

    if size > 8192 {
        let _ = std::io::Seek::seek(&mut f, std::io::SeekFrom::End(-8192));
        let mut tail = [0u8; 8192];
        let n2 = std::io::Read::read(&mut f, &mut tail).unwrap_or(0);
        buf.extend_from_slice(&tail[..n2]);
    }

    Some(format!("{:08x}", crc32(&buf)))
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn collect_images_recursive(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    collect_images_recursive_with_progress(dir, out, &mut |_| {});
}

fn collect_images_recursive_with_progress<F>(
    dir: &std::path::Path,
    out: &mut Vec<PathBuf>,
    on_dir: &mut F,
) where
    F: FnMut(&std::path::Path),
{
    on_dir(dir);
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_images_recursive_with_progress(&path, out, on_dir);
            } else if path.is_file() && is_art_text_image(&path) {
                out.push(path);
            }
        }
    }
}

/// Check if a directory name looks like an art-text folder (contains "美术字").
fn is_art_text_dir_name(name: &str) -> bool {
    name.contains("美术字")
}

/// Quickly discover directories that contain art-text images.
/// Strategy: walk up to 3 levels deep. If a directory name contains "美术字",
/// collect images directly from it. Otherwise recurse only into non-asset dirs.
fn discover_art_text_dirs(root: &std::path::Path, depth: u8, out: &mut Vec<PathBuf>) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if is_art_text_dir_name(name) {
            out.push(path);
        } else {
            discover_art_text_dirs(&path, depth + 1, out);
        }
    }
}

/// Count images in a directory (non-recursive, immediate children only).
fn count_images_in_dir(dir: &std::path::Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().is_file() && is_art_text_image(&e.path()))
                .count()
        })
        .unwrap_or(0)
}

/// Count images recursively in a directory (up to max_depth).
fn count_images_recursive(dir: &std::path::Path, max_depth: u8) -> usize {
    if max_depth == 0 {
        return 0;
    }
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_art_text_image(&path) {
                count += 1;
            } else if path.is_dir() {
                count += count_images_recursive(&path, max_depth - 1);
            }
        }
    }
    count
}

#[derive(Serialize)]
struct SubDirInfo {
    path: String,
    name: String,
    #[serde(rename = "imageCount")]
    image_count: usize,
}

/// Scan immediate subdirectories of a path, counting images recursively (up to 3 levels).
#[tauri::command]
async fn scan_art_text_sub_dirs(dir: String) -> Result<Vec<SubDirInfo>, String> {
    let root = PathBuf::from(dir.trim());
    if !root.exists() || !root.is_dir() {
        return Err("目录不存在".into());
    }

    let mut result: Vec<SubDirInfo> = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(result);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let image_count = count_images_recursive(&path, 3);
        if image_count > 0 {
            result.push(SubDirInfo {
                path: path.to_string_lossy().to_string(),
                name,
                image_count,
            });
        }
    }

    result.sort_by(|a, b| b.image_count.cmp(&a.image_count));
    Ok(result)
}

/// Summary returned after building/updating the index.
#[derive(Debug, Clone, Serialize)]
struct BuildResult {
    index: ArtTextIndex,
    #[serde(rename = "newCount")]
    new_count: usize,
    #[serde(rename = "movedCount")]
    moved_count: usize,
    #[serde(rename = "removedCount")]
    removed_count: usize,
    #[serde(rename = "errorCount")]
    error_count: usize,
}

#[tauri::command]
async fn get_art_text_search_dirs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let rt = state.runtime.lock().await;
    Ok(rt.config.personal.art_text_search_dirs.clone())
}

#[tauri::command]
async fn save_art_text_search_dirs(
    dirs: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    rt.config.personal.art_text_search_dirs = dirs;
    save_config_to_disk(&app, &rt.config)
}

#[tauri::command]
async fn build_art_text_index(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BuildResult, String> {
    let dirs = {
        let rt = state.runtime.lock().await;
        rt.config.personal.art_text_search_dirs.clone()
    };
    if dirs.is_empty() {
        return Err("请先添加扫描目录".into());
    }

    let existing = load_art_text_index(&app);

    // Build lookup structures from existing index:
    //   hash -> entry   (for detecting moves)
    //   path -> entry   (for detecting unchanged files)
    let mut hash_to_old: HashMap<String, ArtTextIndexEntry> = HashMap::new();
    let mut path_to_old: HashMap<String, ArtTextIndexEntry> = HashMap::new();
    for e in existing.entries {
        hash_to_old.entry(e.hash.clone()).or_insert(e.clone());
        path_to_old.insert(e.path.clone(), e);
    }

    // Collect images from all configured directories
    let _ = app.emit(
        "art-text-index-progress",
        serde_json::json!({ "current": 0u64, "total": 0u64, "currentFile": "正在扫描目录...", "phase": "collect" }),
    );
    tokio::task::yield_now().await;

    let app_for_collect = app.clone();
    let dirs_for_collect = dirs.clone();
    let all_files = tokio::task::spawn_blocking(move || {
        let mut all_files: Vec<PathBuf> = Vec::new();
        let mut visited_dirs: u64 = 0;
        for dir_str in &dirs_for_collect {
            let dir = PathBuf::from(dir_str);
            if dir.exists() && dir.is_dir() {
                collect_images_recursive_with_progress(&dir, &mut all_files, &mut |current_dir| {
                    visited_dirs += 1;
                    if visited_dirs == 1 || visited_dirs % 10 == 0 {
                        let _ = app_for_collect.emit(
                            "art-text-index-progress",
                            serde_json::json!({
                                "current": visited_dirs,
                                "total": 0u64,
                                "currentFile": format!("正在扫描目录: {}", current_dir.display()),
                                "phase": "collect"
                            }),
                        );
                    }
                });
            }
        }
        all_files
    })
    .await
    .map_err(|e| format!("扫描图片目录失败: {e}"))?;

    let total = all_files.len() as u64;
    let _ = app.emit(
        "art-text-index-progress",
        serde_json::json!({ "current": 0u64, "total": total, "currentFile": format!("共 {} 张图片，开始计算哈希...", total), "phase": "hash" }),
    );

    // Yield so the initial progress event reaches the frontend
    tokio::task::yield_now().await;

    // Phase 1: compute hashes for all files, detect new / moved / unchanged
    let mut kept_entries: Vec<ArtTextIndexEntry> = Vec::new();
    let mut files_to_ocr: Vec<(PathBuf, String, String)> = Vec::new(); // (path, hash, filename)
    let mut moved_count: usize = 0;
    let mut cached_count: usize = 0;
    let mut current_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (i, file_path) in all_files.iter().enumerate() {
        let path_str = file_path.to_string_lossy().to_string();
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        current_paths.insert(path_str.clone());

        // Yield every 32 files so progress events are delivered
        if i % 32 == 0 {
            let _ = app.emit(
                "art-text-index-progress",
                serde_json::json!({ "current": i as u64, "total": total, "currentFile": format!("扫描 {}/{} (缓存命中 {})", i, total, cached_count), "phase": "hash" }),
            );
            tokio::task::yield_now().await;
        }

        let hash = match file_content_hash(file_path) {
            Some(h) => h,
            None => {
                files_to_ocr.push((file_path.clone(), String::new(), file_name));
                continue;
            }
        };

        // Same path, same hash → unchanged, keep as-is
        if let Some(old) = path_to_old.get(&path_str) {
            if old.hash == hash {
                kept_entries.push(old.clone());
                cached_count += 1;
                continue;
            }
        }

        // Different path but same hash → file moved/renamed
        if let Some(mut old) = hash_to_old.get(&hash).cloned() {
            if old.path != path_str {
                old.path = path_str;
                old.file_name = file_name;
                kept_entries.push(old);
                moved_count += 1;
                continue;
            }
        }

        // New or modified file → needs OCR
        files_to_ocr.push((file_path.clone(), hash, file_name));
    }

    // Count removed files
    let removed_count = path_to_old.len() + hash_to_old.len()
        - kept_entries.len()
        - files_to_ocr.iter().filter(|(p, _, _)| path_to_old.contains_key(&p.to_string_lossy().to_string())).count();

    // Phase 2: OCR only new/changed files
    let ocr_total = files_to_ocr.len() as u64;
    let _ = app.emit(
        "art-text-index-progress",
        serde_json::json!({ "current": 0u64, "total": ocr_total, "currentFile": format!("需识别 {} 张新/变动图片", ocr_total), "phase": "ocr" }),
    );
    tokio::task::yield_now().await;

    #[cfg(feature = "ocr")]
    let mut new_count: usize = 0;
    #[cfg(not(feature = "ocr"))]
    let new_count: usize = 0;
    #[cfg(feature = "ocr")]
    let mut errors: Vec<ArtTextIndexError> = Vec::new();
    #[cfg(not(feature = "ocr"))]
    let errors: Vec<ArtTextIndexError> = Vec::new();

    if !files_to_ocr.is_empty() {
        #[cfg(not(feature = "ocr"))]
        return Err("OCR 功能未启用。开发启动请继续使用 npm run tauri dev；如需美术字 OCR，请先解决 ONNX Runtime 下载问题后执行 cargo build --features ocr。".into());

        #[cfg(feature = "ocr")]
        {
            // Initialize OCR engine
            let models_dir = art_text_ocr_models_dir(&app)?;
            let status = inspect_art_text_ocr_model_dir(&models_dir);
            if !status.ready {
                return Err(format!(
                    "OCR 模型未安装，请先点击“检测 OCR”并完成安装。缺少: {}",
                    status.missing.join(", ")
                ));
            }
            let det_path = models_dir.join(OCR_MODEL_DET);
            let rec_path = models_dir.join(OCR_MODEL_REC);
            let dict_path = models_dir.join(OCR_MODEL_DICT);

            let engine = oar_ocr::prelude::OAROCRBuilder::new(
                det_path.to_str().unwrap_or(""),
                rec_path.to_str().unwrap_or(""),
                dict_path.to_str().unwrap_or(""),
            )
            .build()
            .map_err(|e| format!("初始化OCR引擎失败: {e}"))?;

            for (i, (file_path, hash, file_name)) in files_to_ocr.iter().enumerate() {
                let path_str = file_path.to_string_lossy().to_string();

                let _ = app.emit(
                    "art-text-index-progress",
                    serde_json::json!({ "current": (i as u64) + 1, "total": ocr_total, "currentFile": file_name, "phase": "ocr" }),
                );

                // Yield every file so OCR progress is visible
                tokio::task::yield_now().await;

                match oar_ocr::prelude::load_image(file_path) {
                    Ok(image) => match engine.predict(vec![image]) {
                        Ok(results) => {
                            let text = results
                                .first()
                                .map(|r| r.concatenated_text(" "))
                                .unwrap_or_default();
                            if !text.is_empty() {
                                kept_entries.push(ArtTextIndexEntry {
                                    text,
                                    path: path_str,
                                    file_name: file_name.clone(),
                                    hash: hash.clone(),
                                });
                                new_count += 1;
                            }
                        }
                        Err(e) => {
                            errors.push(ArtTextIndexError {
                                path: path_str,
                                reason: format!("OCR识别失败: {e}"),
                            });
                        }
                    },
                    Err(e) => {
                        errors.push(ArtTextIndexError {
                            path: path_str,
                            reason: format!("加载图片失败: {e}"),
                        });
                    }
                }
            }
        }
    }

    let error_count = errors.len();
    let index = ArtTextIndex {
        version: 1,
        entries: kept_entries,
        errors,
        built_at: Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
    };
    save_art_text_index(&app, &index)?;

    Ok(BuildResult {
        index,
        new_count,
        moved_count,
        removed_count,
        error_count,
    })
}

#[derive(Serialize)]
struct ArtTextIndexInfo {
    #[serde(rename = "builtAt")]
    built_at: Option<String>,
    #[serde(rename = "entryCount")]
    entry_count: usize,
}

#[tauri::command]
async fn get_art_text_index_info(app: tauri::AppHandle) -> Result<ArtTextIndexInfo, String> {
    let index = load_art_text_index(&app);
    Ok(ArtTextIndexInfo {
        built_at: index.built_at,
        entry_count: index.entries.len(),
    })
}

#[tauri::command]
async fn get_art_text_ocr_status(app: tauri::AppHandle) -> Result<ArtTextOcrModelStatus, String> {
    let models_dir = art_text_ocr_models_dir(&app)?;
    Ok(inspect_art_text_ocr_model_dir(&models_dir))
}

#[tauri::command]
async fn install_art_text_ocr_models(
    app: tauri::AppHandle,
) -> Result<ArtTextOcrModelStatus, String> {
    let models_dir = art_text_ocr_models_dir(&app)?;
    download_ocr_models(&app, &models_dir).await?;
    let status = inspect_art_text_ocr_model_dir(&models_dir);
    if !status.ready {
        return Err(format!("OCR 模型安装不完整，缺少: {}", status.missing.join(", ")));
    }
    Ok(status)
}

#[tauri::command]
async fn import_art_text_ocr_models(
    app: tauri::AppHandle,
    source_dir: String,
) -> Result<ArtTextOcrModelStatus, String> {
    let models_dir = art_text_ocr_models_dir(&app)?;
    import_ocr_models_from_dir(Path::new(&source_dir), &models_dir)?;
    Ok(inspect_art_text_ocr_model_dir(&models_dir))
}

#[tauri::command]
async fn search_art_text(
    text: String,
    app: tauri::AppHandle,
) -> Result<Vec<ArtTextSearchResult>, String> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let index = load_art_text_index(&app);
    let query = text.to_lowercase();
    let mut results: Vec<ArtTextSearchResult> = index
        .entries
        .iter()
        .filter(|e| e.text.to_lowercase().contains(&query))
        .map(|e| ArtTextSearchResult {
            text: e.text.clone(),
            path: e.path.clone(),
            file_name: e.file_name.clone(),
        })
        .collect();
    results.sort_by(|a, b| a.text.len().cmp(&b.text.len()));
    results.truncate(50);
    Ok(results)
}

#[tauri::command]
async fn open_file_in_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("目标路径不能为空".into());
    }
    if !path.exists() {
        return Err(format!("目标文件不存在: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let select_arg = format!("/select,{}", path.display());
        std::process::Command::new("explorer")
            .arg(&select_arg)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("当前系统暂不支持打开文件管理器".into());
    }

    Ok(())
}

#[tauri::command]
async fn show_art_text_search_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = ensure_art_text_search_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn hide_art_text_search_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(ART_TEXT_SEARCH_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_art_text_search_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(ART_TEXT_SEARCH_WINDOW_LABEL) {
        let visible = window.is_visible().map_err(|e| e.to_string())?;
        if visible {
            window.hide().map_err(|e| e.to_string())?;
            return Ok(());
        }
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    show_art_text_search_window(app).await
}

#[tauri::command]
async fn open_directory_in_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("目标目录不能为空".into());
    }
    if !path.exists() {
        return Err(format!("目标目录不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("目标路径不是目录: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开目录失败: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn open_gitee_release_page(app: tauri::AppHandle) -> Result<(), String> {
    let url = "https://gitee.com/shelbylouis/dbsearch-release/releases";
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("无法打开浏览器: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn run_sync_profile(
    profile_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncRunOutcome, String> {
    let profile = {
        let mut rt = state.runtime.lock().await;
        if rt.sync_running {
            return Err("当前已有同步任务在进行中，请等待完成后再试".into());
        }
        let profile = rt
            .config
            .personal
            .sync_profiles
            .iter()
            .find(|item| item.id == profile_id)
            .cloned()
            .ok_or_else(|| format!("未找到同步配置: {profile_id}"))?;
        rt.sync_running = true;
        profile
    };

    let app_handle = app.clone();
    let profile_for_run = profile.clone();
    let outcome_result = tauri::async_runtime::spawn_blocking(move || {
        execute_sync_pipeline(&app_handle, &profile_for_run)
    })
    .await
    .map_err(|e| format!("同步任务线程失败: {e}"))?;

    let finished_at = Utc::now().to_rfc3339();
    let mut rt = state.runtime.lock().await;
    rt.sync_running = false;
    rt.config.personal.last_used_sync_profile_id = Some(profile_id.clone());

    match outcome_result {
        Ok(outcome) => {
            if let Some(item) = rt
                .config
                .personal
                .sync_profiles
                .iter_mut()
                .find(|item| item.id == profile_id)
            {
                item.last_run_status = "success".into();
                item.last_run_at = Some(finished_at);
                item.last_run_summary = outcome.summary.clone();
            }
            save_config_to_disk(&app, &rt.config)?;
            Ok(outcome)
        }
        Err(error) => {
            if let Some(item) = rt
                .config
                .personal
                .sync_profiles
                .iter_mut()
                .find(|item| item.id == profile_id)
            {
                item.last_run_status = "error".into();
                item.last_run_at = Some(finished_at);
                item.last_run_summary = summarize_sync_error(&error);
            }
            save_config_to_disk(&app, &rt.config)?;
            Err(error)
        }
    }
}

#[tauri::command]
async fn show_panel_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    open_settings: Option<bool>,
) -> Result<(), String> {
    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
    let panel = activate_panel_window(&app, always_on_top)?;
    if open_settings.unwrap_or(false) {
        state.runtime.lock().await.panel_open_settings_pending = true;
        let _ = panel.emit("panel-open-settings", ());
    }
    Ok(())
}

#[tauri::command]
async fn hide_panel_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        schedule_panel_window_size_save(app.clone());
        panel.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_welcome_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WELCOME_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_panel_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    open_settings: Option<bool>,
) -> Result<(), String> {
    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
    let panel = ensure_panel_window(&app, always_on_top)?;
    let visible = panel.is_visible().map_err(|e| e.to_string())?;

    if visible {
        schedule_panel_window_size_save(app.clone());
        panel.hide().map_err(|e| e.to_string())?;
    } else {
        panel.show().map_err(|e| e.to_string())?;
        let _ = panel.unminimize();
        panel.set_focus().map_err(|e| e.to_string())?;
        if open_settings.unwrap_or(false) {
            state.runtime.lock().await.panel_open_settings_pending = true;
            let _ = panel.emit("panel-open-settings", ());
        }
    }
    Ok(())
}

#[tauri::command]
async fn consume_panel_open_settings(state: State<'_, AppState>) -> Result<bool, String> {
    let mut rt = state.runtime.lock().await;
    let pending = rt.panel_open_settings_pending;
    rt.panel_open_settings_pending = false;
    Ok(pending)
}

#[tauri::command]
async fn set_panel_always_on_top(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    always_on_top: bool,
) -> Result<(), String> {
    {
        let mut rt = state.runtime.lock().await;
        rt.config.personal.always_on_top = always_on_top;
        save_config_to_disk(&app, &rt.config)?;
    }

    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        let _ = panel.set_always_on_top(always_on_top);
    }
    Ok(())
}

#[tauri::command]
async fn show_pet_menu(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let pet_locked = {
        let rt = state.runtime.lock().await;
        if rt.pet_hidden_this_session {
            return Ok(());
        }
        rt.config.personal.pet_locked
    };
    let menu = ensure_pet_menu_window(&app)?;

    let mut menu_x = x + 6.0;
    let mut menu_y = y + 6.0;
    if let Ok(Some(monitor)) = menu.current_monitor() {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let min_x = monitor_pos.x as f64 + 6.0;
        let min_y = monitor_pos.y as f64 + 6.0;
        let max_x = monitor_pos.x as f64 + monitor_size.width as f64 - PET_MENU_WIDTH - 6.0;
        let max_y = monitor_pos.y as f64 + monitor_size.height as f64 - PET_MENU_HEIGHT - 6.0;
        menu_x = menu_x.clamp(min_x, max_x.max(min_x));
        menu_y = menu_y.clamp(min_y, max_y.max(min_y));
    }

    menu.set_size(Size::Logical(LogicalSize::new(
        PET_MENU_WIDTH,
        PET_MENU_HEIGHT,
    )))
    .map_err(|e| e.to_string())?;
    menu.set_position(Position::Logical(LogicalPosition::new(menu_x, menu_y)))
        .map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())?;
    menu.set_focus().map_err(|e| e.to_string())?;
    let _ = menu.emit("pet-menu-opened", PetMenuOpenedPayload { pet_locked });
    Ok(())
}

#[tauri::command]
async fn hide_pet_menu(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        menu.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_pet_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.runtime.lock().await.pet_hidden_this_session = true;
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        let _ = menu.hide();
    }
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_pet_lock(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let locked = {
        let mut rt = state.runtime.lock().await;
        rt.config.personal.pet_locked = !rt.config.personal.pet_locked;
        let locked = rt.config.personal.pet_locked;
        save_config_to_disk(&app, &rt.config)?;
        locked
    };

    let _ = app.emit("pet-lock-changed", PetLockChangedPayload { locked });
    Ok(locked)
}

#[tauri::command]
async fn save_pet_position(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    rt.config.personal.pet_position = Some(WindowPosition { x, y });
    save_config_to_disk(&app, &rt.config)
}

#[tauri::command]
async fn resize_pet_window(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn update_pet_hitbox(
    state: State<'_, AppState>,
    hitbox: PetHitbox,
) -> Result<(), String> {
    *state.pet_hitbox.write().unwrap() = Some(hitbox);
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn activate_panel_window(
    app: &tauri::AppHandle,
    always_on_top: bool,
) -> Result<WebviewWindow, String> {
    let panel = ensure_panel_window(app, always_on_top)?;
    panel.show().map_err(|e| e.to_string())?;
    let _ = panel.unminimize();
    panel.set_focus().map_err(|e| e.to_string())?;
    Ok(panel)
}

fn ensure_welcome_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(WELCOME_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        WELCOME_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("Welcome")))
    .inner_size(WELCOME_WINDOW_WIDTH, WELCOME_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .center()
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create welcome window: {e}"))?;

    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

fn ensure_update_announcement_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(UPDATE_ANNOUNCEMENT_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        UPDATE_ANNOUNCEMENT_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("更新公告")))
    .inner_size(
        UPDATE_ANNOUNCEMENT_WINDOW_WIDTH,
        UPDATE_ANNOUNCEMENT_WINDOW_HEIGHT,
    )
    .resizable(false)
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(false)
    .visible(true)
    .center()
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create update announcement window: {e}"))?;

    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

fn ensure_panel_window(
    app: &tauri::AppHandle,
    always_on_top: bool,
) -> Result<WebviewWindow, String> {
    if let Some(panel) = app.get_webview_window(PANEL_WINDOW_LABEL) {
        let _ = panel.set_always_on_top(always_on_top);
        return Ok(panel);
    }

    let remembered_size = resolve_panel_window_size(app);

    let panel = WebviewWindowBuilder::new(
        app,
        PANEL_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, None))
    .inner_size(remembered_size.width, remembered_size.height)
    .min_inner_size(PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(always_on_top)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create panel window: {e}"))?;

    let panel_for_events = panel.clone();
    let app_handle = app.clone();
    panel.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            schedule_panel_window_size_save(app_handle.clone());
            match close_request_action_for_window(PANEL_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = panel_for_events.hide();
                }
            }
        }
        WindowEvent::Resized(_) => {
            schedule_panel_window_size_save(app_handle.clone());
        }
        _ => {}
    });

    Ok(panel)
}

fn ensure_sync_workspace_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SYNC_WORKSPACE_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SYNC_WORKSPACE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("同步工作台")))
    .inner_size(SYNC_WORKSPACE_WIDTH, SYNC_WORKSPACE_HEIGHT)
    .min_inner_size(1180.0, 780.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create sync workspace window: {e}"))?;

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            match close_request_action_for_window(SYNC_WORKSPACE_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = window_for_events.hide();
                }
            }
        }
    });

    Ok(window)
}

fn ensure_quick_paste_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(QUICK_PASTE_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        QUICK_PASTE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("快捷粘贴")))
    .inner_size(QUICK_PASTE_WINDOW_WIDTH, QUICK_PASTE_WINDOW_HEIGHT)
    .min_inner_size(QUICK_PASTE_WINDOW_MIN_WIDTH, QUICK_PASTE_WINDOW_MIN_HEIGHT)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create quick paste window: {e}"))?;

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            match close_request_action_for_window(QUICK_PASTE_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = window_for_events.hide();
                }
            }
        }
    });

    Ok(window)
}

async fn persist_db_migration_window_size(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL) else {
        return Ok(());
    };

    if window.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }

    let physical_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let logical_size = DbMigrationWindowSize {
        width: physical_size.width as f64 / scale_factor,
        height: physical_size.height as f64 / scale_factor,
    };

    let mut rt = state.runtime.lock().await;
    rt.config.personal.db_migration_window_size =
        sanitize_db_migration_window_size(Some(logical_size));
    *state.db_migration_window_size_sync.write().unwrap() =
        rt.config.personal.db_migration_window_size.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(())
}

async fn persist_panel_window_size(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PANEL_WINDOW_LABEL) else {
        return Ok(());
    };

    if window.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }

    let physical_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let logical_size = PanelWindowSize {
        width: physical_size.width as f64 / scale_factor,
        height: physical_size.height as f64 / scale_factor,
    };

    let mut rt = state.runtime.lock().await;
    rt.config.personal.panel_window_size = sanitize_panel_window_size(Some(logical_size));
    *state.panel_window_size_sync.write().unwrap() = rt.config.personal.panel_window_size.clone();
    save_config_to_disk(&app, &rt.config)?;
    Ok(())
}

fn schedule_panel_window_size_save(app: tauri::AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let seq = state.panel_resize_seq.fetch_add(1, Ordering::SeqCst) + 1;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        if state.panel_resize_seq.load(Ordering::SeqCst) != seq {
            return;
        }
        if let Err(e) = persist_panel_window_size(app.clone(), state.clone()).await {
            eprintln!("failed to persist panel window size: {e}");
        }
    });
}

fn schedule_db_migration_window_size_save(app: tauri::AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let seq = state
        .db_migration_resize_seq
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        if state.db_migration_resize_seq.load(Ordering::SeqCst) != seq {
            return;
        }
        if let Err(e) = persist_db_migration_window_size(app.clone(), state.clone()).await {
            eprintln!("failed to persist db migration workspace size: {e}");
        }
    });
}

fn ensure_db_migration_workspace_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL) {
        return Ok(window);
    }

    let remembered_size = resolve_db_migration_window_size(app);

    let window = WebviewWindowBuilder::new(
        app,
        DB_MIGRATION_WORKSPACE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("数据库迁移")))
    .inner_size(remembered_size.width, remembered_size.height)
    .min_inner_size(
        DB_MIGRATION_WORKSPACE_MIN_WIDTH,
        DB_MIGRATION_WORKSPACE_MIN_HEIGHT,
    )
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .drag_and_drop(false)
    .build()
    .map_err(|e| format!("failed to create db migration workspace window: {e}"))?;

    let window_for_events = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let running = app_handle
                .state::<AppState>()
                .db_migration_running_sync
                .load(Ordering::SeqCst);
            if running {
                let _ = window_for_events.show();
                let _ = window_for_events.set_focus();
                return;
            }
            let _ = window_for_events.hide();
        }
        WindowEvent::Resized(_) => {
            schedule_db_migration_window_size_save(app_handle.clone());
        }
        _ => {}
    });

    Ok(window)
}

fn ensure_art_text_search_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(ART_TEXT_SEARCH_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        ART_TEXT_SEARCH_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("美术字搜索")))
    .inner_size(ART_TEXT_SEARCH_WIDTH, ART_TEXT_SEARCH_HEIGHT)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(false)
    .skip_taskbar(false)
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create art text search window: {e}"))?;

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            match close_request_action_for_window(ART_TEXT_SEARCH_WINDOW_LABEL) {
                WindowCloseAction::HideToTray | WindowCloseAction::HideWindow => {
                    let _ = window_for_events.hide();
                }
            }
        }
    });

    Ok(window)
}

fn ensure_pet_menu_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        return Ok(menu);
    }

    let menu = WebviewWindowBuilder::new(
        app,
        PET_MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(format_window_title(app, Some("宠物菜单")))
    .inner_size(PET_MENU_WIDTH, PET_MENU_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("failed to create pet menu window: {e}"))?;

    let menu_for_events = menu.clone();
    menu.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            let _ = menu_for_events.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = menu_for_events.hide();
        }
        _ => {}
    });

    Ok(menu)
}

fn normalize_hotkey_for_plugin(raw: &str) -> Result<String, String> {
    let tokens = raw
        .split('+')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err("快捷键不能为空".into());
    }

    let mut ctrl = false;
    let mut shift = false;
    let mut alt = false;
    let mut meta = false;
    let mut key: Option<String> = None;

    for token in tokens {
        match token.as_str() {
            "ctrl" | "control" => ctrl = true,
            "shift" => shift = true,
            "alt" | "option" => alt = true,
            "meta" | "super" | "win" | "command" | "cmd" => meta = true,
            _ => {
                let normalized_key = normalize_shortcut_main_key(&token)
                    .ok_or_else(|| format!("不支持的快捷键按键: {token}"))?;
                key = Some(normalized_key);
            }
        }
    }

    let key = key.ok_or_else(|| "快捷键需要包含至少一个非修饰键，例如 Ctrl+Shift+F".to_string())?;
    let mut parts = Vec::with_capacity(5);
    if ctrl {
        parts.push("ctrl".to_string());
    }
    if shift {
        parts.push("shift".to_string());
    }
    if alt {
        parts.push("alt".to_string());
    }
    if meta {
        parts.push("super".to_string());
    }
    parts.push(key);
    Ok(parts.join("+"))
}

fn normalize_shortcut_main_key(token: &str) -> Option<String> {
    if token.len() == 1 {
        let c = token.chars().next()?;
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_lowercase().to_string());
        }
        return match c {
            '/' | '?' => Some("slash".into()),
            '\\' | '|' => Some("backslash".into()),
            ';' | ':' => Some("semicolon".into()),
            '\'' | '"' => Some("quote".into()),
            ',' | '<' => Some("comma".into()),
            '.' | '>' => Some("period".into()),
            '[' | '{' => Some("bracketleft".into()),
            ']' | '}' => Some("bracketright".into()),
            '-' | '_' => Some("minus".into()),
            '=' | '+' => Some("equal".into()),
            '`' | '~' => Some("backquote".into()),
            _ => None,
        };
    }

    // Handle global_hotkey Code Display format: "keya"→"a", "keyf"→"f"
    if token.starts_with("key") && token.len() == 4 {
        let c = token.chars().nth(3)?;
        if c.is_ascii_alphabetic() {
            return Some(c.to_ascii_lowercase().to_string());
        }
    }

    // Handle global_hotkey Code Display format: "digit0"→"0", "digit1"→"1"
    if token.starts_with("digit") && token.len() == 6 {
        let c = token.chars().nth(5)?;
        if c.is_ascii_digit() {
            return Some(c.to_string());
        }
    }

    if token.starts_with('f') && token[1..].chars().all(|ch| ch.is_ascii_digit()) {
        return Some(token.to_string());
    }

    match token {
        "space" => Some("space".into()),
        "enter" | "return" => Some("enter".into()),
        "tab" => Some("tab".into()),
        "esc" | "escape" => Some("escape".into()),
        "backspace" => Some("backspace".into()),
        "delete" | "del" => Some("delete".into()),
        "insert" | "ins" => Some("insert".into()),
        "home" => Some("home".into()),
        "end" => Some("end".into()),
        "pageup" | "page_up" => Some("pageup".into()),
        "pagedown" | "page_down" => Some("pagedown".into()),
        "up" | "arrowup" => Some("up".into()),
        "down" | "arrowdown" => Some("down".into()),
        "left" | "arrowleft" => Some("left".into()),
        "right" | "arrowright" => Some("right".into()),
        "slash" | "question" => Some("slash".into()),
        "backslash" | "pipe" => Some("backslash".into()),
        "semicolon" | "colon" => Some("semicolon".into()),
        "quote" | "apostrophe" => Some("quote".into()),
        "comma" | "lessthan" => Some("comma".into()),
        "period" | "dot" | "greaterthan" => Some("period".into()),
        "bracketleft" | "leftbracket" | "braceleft" => Some("bracketleft".into()),
        "bracketright" | "rightbracket" | "braceright" => Some("bracketright".into()),
        "minus" | "underscore" | "dash" | "hyphen" => Some("minus".into()),
        "equal" | "equals" | "plus" => Some("equal".into()),
        "backquote" | "grave" => Some("backquote".into()),
        _ => None,
    }
}

fn open_panel_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>().inner().clone();
        let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
        if let Ok(panel) = ensure_panel_window(&app, always_on_top) {
            let visible = panel.is_visible().unwrap_or(false);
            if visible {
                let _ = panel.hide();
            } else {
                let _ = activate_panel_window(&app, always_on_top);
            }
        }
    });
}

async fn show_pet_window_from_tray(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    {
        let mut runtime = state.runtime.lock().await;
        runtime.pet_hidden_this_session = false;
    }

    if let Some(menu) = app.get_webview_window(PET_MENU_WINDOW_LABEL) {
        let _ = menu.hide();
    }
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window.show().map_err(|e| e.to_string())?;
        let _ = main_window.unminimize();
        let _ = main_window.set_ignore_cursor_events(false);
        state
            .pet_cursor_ignored
            .store(false, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

fn create_system_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let open_panel = MenuItemBuilder::with_id(TRAY_MENU_OPEN_PANEL_ID, "打开主面板")
        .build(app)
        .map_err(|e| e.to_string())?;
    let show_pet = MenuItemBuilder::with_id(TRAY_MENU_SHOW_PET_ID, "显示宠物")
        .build(app)
        .map_err(|e| e.to_string())?;
    let exit_app = MenuItemBuilder::with_id(TRAY_MENU_EXIT_ID, "退出")
        .build(app)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&open_panel, &show_pet, &exit_app])
        .map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "failed to load tray icon".to_string())?;

    let _ = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(icon)
        .tooltip("DB Scout")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match resolve_tray_menu_action(event.id()) {
            Some(TrayMenuAction::OpenPanel) => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>().inner().clone();
                    let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                    let _ = activate_panel_window(&app_handle, always_on_top);
                });
            }
            Some(TrayMenuAction::ShowPet) => {
                let app_handle = app.clone();
                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_pet_window_from_tray(app_handle, state).await;
                });
            }
            Some(TrayMenuAction::ExitApp) => app.exit(0),
            None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if tray_click_opens_panel(button, button_state) {
                    let app_handle = tray.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<AppState>().inner().clone();
                        let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                        let _ = activate_panel_window(&app_handle, always_on_top);
                    });
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn toggle_sync_workspace_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = ensure_sync_workspace_window(&app) {
            let visible = window.is_visible().unwrap_or(false);
            if visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
}

fn toggle_db_migration_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = ensure_sync_workspace_window(&app) {
            let running = app
                .state::<AppState>()
                .db_migration_running_sync
                .load(Ordering::SeqCst);
            let visible = window.is_visible().unwrap_or(false);

            if visible {
                if running {
                    emit_sync_center_mode(&app, "database");
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                } else {
                    let _ = window.hide();
                }
                return;
            }

            emit_sync_center_mode(&app, "database");
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

fn toggle_quick_paste_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(window) = ensure_quick_paste_window(&app) {
            let visible = window.is_visible().unwrap_or(false);
            if visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
}

fn output_default_quick_paste_from_global_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>().inner().clone();
        if let Err(e) = output_default_quick_paste_text(app.clone(), state).await {
            eprintln!("[F8] failed to output quick paste default: {e}");
            let _ = app.emit("quick-paste-toast", format!("F8 输出失败: {e}"));
        }
    });
}

fn summarize_sync_error(error: &str) -> String {
    error
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .unwrap_or_else(|| "同步失败".to_string())
}

async fn pause_before_global_text_input() {
    tokio::time::sleep(Duration::from_millis(180)).await;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuickPasteOutputStep {
    CopyImageToClipboard,
    CopyHtmlToClipboard,
    CopyTextToClipboard,
    HideQuickPasteWindow,
    PauseBeforeGlobalInput,
    PasteClipboard,
    InputTextGlobally,
}

fn quick_paste_output_steps(
    category: &str,
    quick_paste_window_visible: bool,
) -> Vec<QuickPasteOutputStep> {
    let mut steps = Vec::new();
    if category == "rich" {
        steps.push(QuickPasteOutputStep::CopyHtmlToClipboard);
        if quick_paste_window_visible {
            steps.push(QuickPasteOutputStep::HideQuickPasteWindow);
        }
        steps.push(QuickPasteOutputStep::PauseBeforeGlobalInput);
        steps.push(QuickPasteOutputStep::PasteClipboard);
        return steps;
    }

    if category == "image" {
        steps.push(QuickPasteOutputStep::CopyImageToClipboard);
        if quick_paste_window_visible {
            steps.push(QuickPasteOutputStep::HideQuickPasteWindow);
        }
        steps.push(QuickPasteOutputStep::PauseBeforeGlobalInput);
        steps.push(QuickPasteOutputStep::PasteClipboard);
        return steps;
    }

    if category == "plain_clipboard" {
        steps.push(QuickPasteOutputStep::CopyTextToClipboard);
        if quick_paste_window_visible {
            steps.push(QuickPasteOutputStep::HideQuickPasteWindow);
        }
        steps.push(QuickPasteOutputStep::PauseBeforeGlobalInput);
        steps.push(QuickPasteOutputStep::PasteClipboard);
        return steps;
    }

    if quick_paste_window_visible {
        steps.push(QuickPasteOutputStep::HideQuickPasteWindow);
        steps.push(QuickPasteOutputStep::PauseBeforeGlobalInput);
    }
    steps.push(QuickPasteOutputStep::InputTextGlobally);
    steps
}

fn is_quick_paste_window_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(QUICK_PASTE_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn input_text_globally(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("failed to init input driver: {e}"))?;
    enigo
        .text(text)
        .map_err(|e| format!("failed to input text: {e}"))
}

fn paste_clipboard_globally() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("failed to init input driver: {e}"))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("failed to press paste shortcut: {e}"))?;
    let paste_result = enigo.key(Key::Unicode('v'), Direction::Click);
    let release_result = enigo.key(Key::Control, Direction::Release);
    paste_result.map_err(|e| format!("failed to paste clipboard: {e}"))?;
    release_result.map_err(|e| format!("failed to release paste shortcut: {e}"))?;
    Ok(())
}

fn html_to_plain_text(html: &str) -> String {
    let mut text = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n");
    let tag_re = Regex::new(r"(?s)<[^>]*>").unwrap();
    text = tag_re.replace_all(&text, "").to_string();
    text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

fn copy_text_to_clipboard(content: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("访问剪贴板失败: {e}"))?;
    clipboard
        .set_text(content.to_string())
        .map_err(|e| format!("复制文本到剪贴板失败: {e}"))?;
    Ok(())
}

fn quick_paste_image_mime_from_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

fn inline_quick_paste_html_images(content: &str) -> Result<String, String> {
    let img_re = Regex::new(r#"<img\b([^>]*?)(?:data-path|src)=["']([^"']+)["']([^>]*)>"#).unwrap();
    let mut output = String::with_capacity(content.len());
    let mut last = 0;
    for caps in img_re.captures_iter(content) {
        let mat = caps.get(0).unwrap();
        output.push_str(&content[last..mat.start()]);
        let src = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let data_src = if src.starts_with("data:image/") {
            src.to_string()
        } else if src.starts_with("http://") || src.starts_with("https://") || src.starts_with("asset:") {
            src.to_string()
        } else {
            let bytes = fs::read(src).map_err(|e| format!("读取富文本图片失败: {e}"))?;
            let encoded = base64_encode(&bytes);
            format!("data:{};base64,{}", quick_paste_image_mime_from_path(src), encoded)
        };
        output.push_str("<img src=\"");
        output.push_str(&data_src);
        output.push_str("\">");
        last = mat.end();
    }
    output.push_str(&content[last..]);
    Ok(output)
}

fn prepare_quick_paste_clipboard_html(content: &str) -> Result<String, String> {
    let content = inline_quick_paste_html_images(content)?;
    Ok(format!("<meta charset=\"utf-8\">{content}"))
}

fn copy_html_to_clipboard(content: &str) -> Result<(), String> {
    let content = prepare_quick_paste_clipboard_html(content)?;
    let alt_text = html_to_plain_text(&content);
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("访问剪贴板失败: {e}"))?;
    clipboard
        .set_html(content, Some(alt_text))
        .map_err(|e| format!("复制笔记内容到剪贴板失败: {e}"))?;
    Ok(())
}

async fn run_quick_paste_output_steps(
    app: tauri::AppHandle,
    steps: Vec<QuickPasteOutputStep>,
    content: &str,
) -> Result<(), String> {
    for step in steps {
        match step {
            QuickPasteOutputStep::CopyImageToClipboard => copy_image_to_clipboard(content)?,
            QuickPasteOutputStep::CopyHtmlToClipboard => copy_html_to_clipboard(content)?,
            QuickPasteOutputStep::CopyTextToClipboard => copy_text_to_clipboard(content)?,
            QuickPasteOutputStep::HideQuickPasteWindow => hide_quick_paste_window(app.clone()).await?,
            QuickPasteOutputStep::PauseBeforeGlobalInput => pause_before_global_text_input().await,
            QuickPasteOutputStep::PasteClipboard => paste_clipboard_globally()?,
            QuickPasteOutputStep::InputTextGlobally => input_text_globally(content)?,
        }
    }
    Ok(())
}

fn copy_image_to_clipboard(content: &str) -> Result<(), String> {
    let img_data: Vec<u8> = if content.starts_with("data:image/") {
        let comma = content.find(',').ok_or_else(|| "图片数据格式无效".to_string())?;
        let meta = &content[..comma];
        let payload = &content[comma + 1..];
        if !meta.contains(";base64") {
            return Err("只支持 base64 图片数据".into());
        }
        base64_decode(payload)?
    } else {
        let file_path = PathBuf::from(content);
        if !file_path.exists() {
            return Err(format!("图片文件不存在: {}", file_path.display()));
        }
        fs::read(&file_path).map_err(|e| format!("读取图片失败: {e}"))?
    };

    let img = image::ImageReader::new(std::io::Cursor::new(&img_data))
        .with_guessed_format()
        .map_err(|e| format!("识别图片格式失败: {e}"))?
        .decode()
        .map_err(|e| format!("解码图片失败: {e}"))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    eprintln!("[F8] image decoded: {w}x{h}");
    let rgba = img.into_raw();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("访问剪贴板失败: {e}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: rgba.into(),
        })
        .map_err(|e| format!("复制图片到剪贴板失败: {e}"))?;
    Ok(())
}

async fn output_default_quick_paste_text(
    app: tauri::AppHandle,
    state: AppState,
) -> Result<(), String> {
    let (content, category) = {
        let rt = state.runtime.lock().await;
        let snippets = &rt.config.personal.quick_paste.snippets;
        match snippets
            .iter()
            .find(|snippet| snippet.is_default)
            .or_else(|| snippets.first())
        {
            Some(snippet) => (snippet.content.clone(), snippet.category.clone()),
            None => return Err("请先新建一条快捷内容".into()),
        }
    };

    let (output_content, effective_category) = if category == "rich" {
        (content, "rich".to_string())
    } else {
        (content, category)
    };

    eprintln!("[F8] category={effective_category}, content_len={}", output_content.len());

    let steps = quick_paste_output_steps(&effective_category, is_quick_paste_window_visible(&app));
    run_quick_paste_output_steps(app, steps, &output_content).await
}

fn input_today_date_globally() -> Result<(), String> {
    let text = Local::now().format("%Y%m%d").to_string();
    input_text_globally(&text)
}

async fn search_table_data_in_db(
    pool: &MySqlPool,
    table: &TableMeta,
    keyword: &str,
    max_rows: u32,
    terms: &[String],
) -> Result<Option<DataSearchResult>, String> {
    if table.columns.is_empty() {
        return Ok(None);
    }
    let pattern = format!("%{}%", keyword);
    let select_cols = table
        .columns
        .iter()
        .map(|c| {
            format!(
                "CAST(`{}` AS CHAR) AS `{}`",
                escape_ident(&c.column_name),
                escape_ident(&c.column_name)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let where_clause = table
        .columns
        .iter()
        .map(|c| format!("CAST(`{}` AS CHAR) LIKE ?", escape_ident(&c.column_name)))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT {} FROM `{}` WHERE {} LIMIT {}",
        select_cols,
        escape_ident(&table.table_name),
        where_clause,
        max_rows
    );
    let mut q = sqlx::query(&sql);
    for _ in &table.columns {
        q = q.bind(&pattern);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询失败: {e}"))?;
    let mapped = map_rows_to_string_map(rows, &table.columns);
    if mapped.is_empty() {
        return Ok(None);
    }
    let mut cols = vec![];
    for c in &table.columns {
        if mapped.iter().any(|r| {
            r.get(&c.column_name)
                .map(|v| contains_all_terms(v, terms))
                .unwrap_or(false)
        }) {
            cols.push(c.column_name.clone());
        }
    }
    Ok(Some(DataSearchResult {
        table_name: table.table_name.clone(),
        matched_rows: mapped.clone(),
        matched_columns: cols,
        total_matches: mapped.len() as u64,
        truncated: false,
        first_row_index: None,
    }))
}
fn search_table_data_in_mock(
    table: &TableMeta,
    terms: &[String],
    max_rows: u32,
    demo_rows: &HashMap<String, Vec<HashMap<String, String>>>,
) -> Option<DataSearchResult> {
    let source = demo_rows_for_table(demo_rows, &table.table_name);
    let mut rows = vec![];
    let mut cols: Vec<String> = vec![];
    let mut first = None;
    for (idx, row) in source.iter().enumerate() {
        let mut hit = false;
        for (k, v) in row {
            if contains_all_terms(v, terms) {
                hit = true;
                if !cols.contains(k) {
                    cols.push(k.clone());
                }
            }
        }
        if hit {
            if first.is_none() {
                first = Some(idx as u64);
            }
            rows.push(row.clone());
            if rows.len() >= max_rows as usize {
                break;
            }
        }
    }
    if rows.is_empty() {
        return None;
    }
    Some(DataSearchResult {
        table_name: table.table_name.clone(),
        matched_rows: rows.clone(),
        matched_columns: cols,
        total_matches: rows.len() as u64,
        truncated: false,
        first_row_index: first,
    })
}

fn resolve_runtime_schema(connected: bool, schema_cache: &SchemaCache) -> SchemaCache {
    if connected {
        schema_cache.clone()
    } else {
        mock_schema_cache()
    }
}
fn meta_search(schema: &SchemaCache, terms: &[String]) -> Vec<MetaSearchResult> {
    let mut out = vec![];
    for t in &schema.tables {
        push_meta(
            &mut out,
            MatchType::TableName,
            &t.table_name,
            &t.table_name,
            None,
            terms,
        );
        push_meta(
            &mut out,
            MatchType::TableComment,
            &t.table_name,
            &t.table_comment,
            None,
            terms,
        );
        for c in &t.columns {
            push_meta(
                &mut out,
                MatchType::ColumnName,
                &t.table_name,
                &c.column_name,
                Some(c.column_name.clone()),
                terms,
            );
            push_meta(
                &mut out,
                MatchType::ColumnComment,
                &t.table_name,
                &c.column_comment,
                Some(c.column_name.clone()),
                terms,
            );
        }
    }
    out.sort_by(|a, b| b.score.cmp(&a.score));
    out
}
fn push_meta(
    out: &mut Vec<MetaSearchResult>,
    mt: MatchType,
    table: &str,
    text: &str,
    col: Option<String>,
    terms: &[String],
) {
    if text.is_empty() {
        return;
    }
    if let Some((score, range)) = match_score(text, terms) {
        out.push(MetaSearchResult {
            match_type: mt,
            table_name: table.to_string(),
            column_name: col,
            matched_text: text.to_string(),
            highlight_range: range,
            score,
        });
    }
}
fn match_score(text: &str, terms: &[String]) -> Option<(i32, (usize, usize))> {
    let lower = text.to_lowercase();
    let mut score = 0;
    let mut range = (0, 0);
    for (i, t) in terms.iter().enumerate() {
        if lower == *t {
            score += 300;
            if i == 0 {
                range = (0, t.len());
            }
        } else if lower.starts_with(t) {
            score += 200;
            if i == 0 {
                range = (0, t.len());
            }
        } else if let Some(p) = lower.find(t) {
            score += 100;
            if i == 0 {
                range = (p, p + t.len());
            }
        } else {
            return None;
        }
    }
    Some((score, range))
}
fn split_terms(keyword: &str) -> Vec<String> {
    keyword
        .split_whitespace()
        .map(|v| v.to_lowercase())
        .filter(|v| !v.is_empty())
        .collect()
}
fn contains_all_terms(value: &str, terms: &[String]) -> bool {
    let l = value.to_lowercase();
    terms.iter().all(|t| l.contains(t))
}
fn compile_patterns(items: &[String]) -> Vec<Regex> {
    items.iter().filter_map(|i| Regex::new(i).ok()).collect()
}
fn map_rows_to_string_map(
    rows: Vec<sqlx::mysql::MySqlRow>,
    cols: &[ColumnMeta],
) -> Vec<HashMap<String, String>> {
    rows.into_iter()
        .map(|row| {
            let mut m = HashMap::new();
            for c in cols {
                let v: Option<String> = row.try_get(c.column_name.as_str()).unwrap_or(None);
                m.insert(c.column_name.clone(), v.unwrap_or_default());
            }
            m
        })
        .collect()
}
async fn load_schema_from_database(
    pool: &MySqlPool,
    database: &str,
) -> Result<SchemaCache, String> {
    let tables = sqlx::query("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME").bind(database).fetch_all(pool).await.map_err(|e| format!("读取表失败: {e}"))?;
    let columns = sqlx::query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT, COLUMN_KEY, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION").bind(database).fetch_all(pool).await.map_err(|e| format!("读取字段失败: {e}"))?;
    let mut map: HashMap<String, TableMeta> = HashMap::new();
    for r in tables {
        let name: String = r.try_get("TABLE_NAME").unwrap_or_default();
        let comment: Option<String> = r.try_get("TABLE_COMMENT").unwrap_or(None);
        map.insert(
            name.clone(),
            TableMeta {
                table_name: name,
                table_comment: comment.unwrap_or_default(),
                columns: vec![],
            },
        );
    }
    for r in columns {
        let table: String = r.try_get("TABLE_NAME").unwrap_or_default();
        let c = ColumnMeta {
            column_name: r.try_get("COLUMN_NAME").unwrap_or_default(),
            column_type: r
                .try_get::<Option<String>, _>("COLUMN_TYPE")
                .unwrap_or(None)
                .unwrap_or_default(),
            column_comment: r
                .try_get::<Option<String>, _>("COLUMN_COMMENT")
                .unwrap_or(None)
                .unwrap_or_default(),
            is_primary_key: r
                .try_get::<Option<String>, _>("COLUMN_KEY")
                .unwrap_or(None)
                .unwrap_or_default()
                .eq_ignore_ascii_case("PRI"),
            is_nullable: r
                .try_get::<Option<String>, _>("IS_NULLABLE")
                .unwrap_or(None)
                .unwrap_or_else(|| "YES".into())
                .eq_ignore_ascii_case("YES"),
        };
        if let Some(t) = map.get_mut(&table) {
            t.columns.push(c);
        }
    }
    let mut list: Vec<TableMeta> = map.into_values().collect();
    list.sort_by(|a, b| a.table_name.cmp(&b.table_name));
    Ok(SchemaCache {
        tables: list,
        last_refresh: Some(Utc::now()),
    })
}
fn mock_schema_cache() -> SchemaCache {
    SchemaCache {
        last_refresh: Some(Utc::now()),
        tables: vec![
            demo_feature_test_table_meta(),
            demo_customer_profiles_table_meta(),
            demo_orders_table_meta(),
            demo_support_tickets_table_meta(),
            demo_audit_logs_table_meta(),
        ],
    }
}

fn demo_column(name: &str, column_type: &str, comment: &str, primary: bool, nullable: bool) -> ColumnMeta {
    ColumnMeta {
        column_name: name.into(),
        column_type: column_type.into(),
        column_comment: comment.into(),
        is_primary_key: primary,
        is_nullable: nullable,
    }
}

fn demo_feature_test_table_meta() -> TableMeta {
    TableMeta {
        table_name: DEMO_FEATURE_TEST_TABLE.into(),
        table_comment: "离线功能测试演示表：覆盖搜索、备注、分页、单击编辑、插入、删除和 JSON 长文本查看".into(),
        columns: vec![
            ColumnMeta {
                column_name: "id".into(),
                column_type: "int(11)".into(),
                column_comment: "主键ID，用于稳定保存和删除演示行".into(),
                is_primary_key: true,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "feature_name".into(),
                column_type: "varchar(80)".into(),
                column_comment: "功能名称，可直接单击编辑".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "owner".into(),
                column_type: "varchar(40)".into(),
                column_comment: "负责人或测试角色".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "priority".into(),
                column_type: "int(11)".into(),
                column_comment: "优先级数字，验证数字列编辑".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "enabled".into(),
                column_type: "tinyint(1)".into(),
                column_comment: "是否启用，1 表示启用，0 表示停用".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "due_date".into(),
                column_type: "date".into(),
                column_comment: "计划验证日期，覆盖日期格式展示".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "updated_at".into(),
                column_type: "datetime".into(),
                column_comment: "最后更新时间，覆盖时间列展示".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "remark".into(),
                column_type: "text".into(),
                column_comment: "详细备注，包含较长文本用于测试列宽和搜索".into(),
                is_primary_key: false,
                is_nullable: false,
            },
            ColumnMeta {
                column_name: "payload_json".into(),
                column_type: "json".into(),
                column_comment: "JSON 配置片段，用于测试大文本查看器和高亮".into(),
                is_primary_key: false,
                is_nullable: false,
            },
        ],
    }
}

fn demo_customer_profiles_table_meta() -> TableMeta {
    TableMeta {
        table_name: "demo_customer_profiles".into(),
        table_comment: "测试客户档案表：姓名、城市、会员等级、余额和标签，适合测试中文备注与客户关键字搜索".into(),
        columns: vec![
            demo_column("customer_id", "bigint", "客户ID，主键", true, false),
            demo_column("customer_name", "varchar(80)", "客户姓名，可搜索中文姓名", false, false),
            demo_column("city", "varchar(40)", "所在城市", false, false),
            demo_column("tier", "varchar(20)", "会员等级，例如 gold、silver、trial", false, false),
            demo_column("balance", "decimal(10,2)", "账户余额", false, false),
            demo_column("tags", "varchar(200)", "客户标签，逗号分隔", false, true),
            demo_column("created_at", "datetime", "开户注册时间", false, false),
        ],
    }
}

fn demo_orders_table_meta() -> TableMeta {
    TableMeta {
        table_name: "demo_orders".into(),
        table_comment: "测试订单表：订单状态、金额、渠道、收货城市，适合测试 order、paid、refund 等关键词".into(),
        columns: vec![
            demo_column("order_id", "bigint", "订单ID，主键", true, false),
            demo_column("customer_id", "bigint", "关联客户ID", false, false),
            demo_column("order_no", "varchar(40)", "订单编号", false, false),
            demo_column("status", "varchar(20)", "订单状态：paid、pending、refunded", false, false),
            demo_column("amount", "decimal(10,2)", "订单金额", false, false),
            demo_column("channel", "varchar(30)", "下单渠道", false, false),
            demo_column("shipping_city", "varchar(40)", "收货城市", false, true),
        ],
    }
}

fn demo_support_tickets_table_meta() -> TableMeta {
    TableMeta {
        table_name: "demo_support_tickets".into(),
        table_comment: "测试工单表：问题类型、优先级、处理人和摘要，适合测试客服、bug、退款等数据搜索".into(),
        columns: vec![
            demo_column("ticket_id", "bigint", "工单ID，主键", true, false),
            demo_column("customer_id", "bigint", "关联客户ID", false, false),
            demo_column("category", "varchar(40)", "问题分类", false, false),
            demo_column("priority", "varchar(20)", "优先级", false, false),
            demo_column("assignee", "varchar(40)", "处理人", false, true),
            demo_column("summary", "text", "工单摘要", false, false),
            demo_column("resolved", "tinyint(1)", "是否已解决", false, false),
        ],
    }
}

fn demo_audit_logs_table_meta() -> TableMeta {
    TableMeta {
        table_name: "demo_audit_logs".into(),
        table_comment: "测试审计日志表：操作人、动作、IP、JSON 明细，适合测试日志和 JSON 内容检索".into(),
        columns: vec![
            demo_column("log_id", "bigint", "日志ID，主键", true, false),
            demo_column("actor", "varchar(60)", "操作人", false, false),
            demo_column("action", "varchar(60)", "操作动作", false, false),
            demo_column("ip_address", "varchar(45)", "来源 IP", false, true),
            demo_column("detail_json", "json", "操作明细 JSON", false, true),
            demo_column("created_at", "datetime", "发生时间", false, false),
        ],
    }
}

fn default_demo_rows() -> HashMap<String, Vec<HashMap<String, String>>> {
    let mut out = HashMap::new();
    out.insert(
        DEMO_FEATURE_TEST_TABLE.into(),
        vec![
            map_row(&[
                ("id", "1"),
                ("feature_name", "单击编辑体验"),
                ("owner", "产品测试"),
                ("priority", "1"),
                ("enabled", "1"),
                ("due_date", "2026-05-01"),
                ("updated_at", "2026-04-29 09:15:00"),
                ("remark", "用于验证进入编辑模式后单击单元格立即聚焦，Enter 保存并移动到下一行。"),
                ("payload_json", r#"{"module":"table-edit","shortcut":"Ctrl+Enter","status":"ready"}"#),
            ]),
            map_row(&[
                ("id", "2"),
                ("feature_name", "大文本查看器"),
                ("owner", "前端联调"),
                ("priority", "2"),
                ("enabled", "1"),
                ("due_date", "2026-05-03"),
                ("updated_at", "2026-04-29 10:30:00"),
                ("remark", "双击在非编辑模式打开详情；编辑模式使用 Ctrl+Enter 打开完整内容。"),
                ("payload_json", r#"{"viewer":"cell","language":"json","note":"支持长文本预览"}"#),
            ]),
            map_row(&[
                ("id", "3"),
                ("feature_name", "数据值搜索"),
                ("owner", "搜索验证"),
                ("priority", "2"),
                ("enabled", "1"),
                ("due_date", "2026-05-06"),
                ("updated_at", "2026-04-29 11:45:00"),
                ("remark", "搜索关键词 JSON、备注、负责人或日期，都应该能在离线演示表中命中。"),
                ("payload_json", r#"{"search":["JSON","备注","日期"],"scope":"offline-demo"}"#),
            ]),
            map_row(&[
                ("id", "4"),
                ("feature_name", "新增行保存"),
                ("owner", "回归测试"),
                ("priority", "3"),
                ("enabled", "1"),
                ("due_date", "2026-05-10"),
                ("updated_at", "2026-04-29 13:00:00"),
                ("remark", "用于测试添加行后保存到内存，刷新当前页仍能看到新增内容。"),
                ("payload_json", r#"{"operation":"insert","persistence":"memory-only","restart":"reset"}"#),
            ]),
            map_row(&[
                ("id", "5"),
                ("feature_name", "删除行演练"),
                ("owner", "安全验证"),
                ("priority", "4"),
                ("enabled", "0"),
                ("due_date", "2026-05-12"),
                ("updated_at", "2026-04-29 14:20:00"),
                ("remark", "用于验证勾选行、删除选中、保存后从当前会话移除。"),
                ("payload_json", r#"{"operation":"delete","guard":"primary-key","demo":true}"#),
            ]),
            map_row(&[
                ("id", "6"),
                ("feature_name", "列备注完整性"),
                ("owner", "Schema 检查"),
                ("priority", "5"),
                ("enabled", "1"),
                ("due_date", "2026-05-15"),
                ("updated_at", "2026-04-29 15:40:00"),
                ("remark", "打开 Schema 区域时，每个字段都应有备注，不再出现空内容测试尴尬。"),
                ("payload_json", r#"{"schema":"complete","columns":9,"comments":"all-present"}"#),
            ]),
        ],
    );
    out.insert(
        "demo_customer_profiles".into(),
        vec![
            map_row(&[("customer_id", "1001"), ("customer_name", "林晚晴"), ("city", "上海"), ("tier", "gold"), ("balance", "1288.50"), ("tags", "高价值,企业微信,复购"), ("created_at", "2026-01-12 09:20:00")]),
            map_row(&[("customer_id", "1002"), ("customer_name", "周明"), ("city", "杭州"), ("tier", "silver"), ("balance", "236.00"), ("tags", "退款关注,移动端"), ("created_at", "2026-02-03 14:05:00")]),
            map_row(&[("customer_id", "1003"), ("customer_name", "Ava Chen"), ("city", "深圳"), ("tier", "trial"), ("balance", "0.00"), ("tags", "英文资料,潜在客户"), ("created_at", "2026-03-18 11:45:00")]),
            map_row(&[("customer_id", "1004"), ("customer_name", "王一诺"), ("city", "北京"), ("tier", "gold"), ("balance", "5020.90"), ("tags", "VIP,发票,合同"), ("created_at", "2026-04-22 16:30:00")]),
        ],
    );
    out.insert(
        "demo_orders".into(),
        vec![
            map_row(&[("order_id", "90001"), ("customer_id", "1001"), ("order_no", "ORD-202605-0001"), ("status", "paid"), ("amount", "399.00"), ("channel", "web"), ("shipping_city", "上海")]),
            map_row(&[("order_id", "90002"), ("customer_id", "1002"), ("order_no", "ORD-202605-0002"), ("status", "refunded"), ("amount", "128.00"), ("channel", "miniapp"), ("shipping_city", "杭州")]),
            map_row(&[("order_id", "90003"), ("customer_id", "1004"), ("order_no", "ORD-202605-0003"), ("status", "pending"), ("amount", "2599.00"), ("channel", "sales"), ("shipping_city", "北京")]),
            map_row(&[("order_id", "90004"), ("customer_id", "1003"), ("order_no", "ORD-202605-0004"), ("status", "paid"), ("amount", "59.90"), ("channel", "web"), ("shipping_city", "深圳")]),
        ],
    );
    out.insert(
        "demo_support_tickets".into(),
        vec![
            map_row(&[("ticket_id", "7001"), ("customer_id", "1002"), ("category", "退款"), ("priority", "high"), ("assignee", "客服-小夏"), ("summary", "客户反馈订单 ORD-202605-0002 重复扣款，需要退款核对。"), ("resolved", "1")]),
            map_row(&[("ticket_id", "7002"), ("customer_id", "1001"), ("category", "bug"), ("priority", "medium"), ("assignee", "前端-阿杰"), ("summary", "客户在搜索表名时发现高亮位置偶发不准确。"), ("resolved", "0")]),
            map_row(&[("ticket_id", "7003"), ("customer_id", "1004"), ("category", "发票"), ("priority", "low"), ("assignee", "财务-宁宁"), ("summary", "VIP 客户申请补开发票和合同抬头变更。"), ("resolved", "0")]),
        ],
    );
    out.insert(
        "demo_audit_logs".into(),
        vec![
            map_row(&[("log_id", "50001"), ("actor", "admin"), ("action", "login"), ("ip_address", "10.0.0.8"), ("detail_json", r#"{"result":"success","device":"desktop"}"#), ("created_at", "2026-05-09 09:00:00")]),
            map_row(&[("log_id", "50002"), ("actor", "operator.li"), ("action", "export"), ("ip_address", "10.0.0.12"), ("detail_json", r#"{"table":"demo_orders","rows":4,"format":"xlsx"}"#), ("created_at", "2026-05-09 09:25:00")]),
            map_row(&[("log_id", "50003"), ("actor", "system"), ("action", "sync_failed"), ("ip_address", "127.0.0.1"), ("detail_json", r#"{"reason":"mock timeout","retry":true}"#), ("created_at", "2026-05-09 10:10:00")]),
        ],
    );
    out
}

fn mock_rows_for_table(table: &str) -> Vec<HashMap<String, String>> {
    demo_rows_for_table(&default_demo_rows(), table)
}

fn demo_rows_for_table(
    demo_rows: &HashMap<String, Vec<HashMap<String, String>>>,
    table: &str,
) -> Vec<HashMap<String, String>> {
    demo_rows
        .get(table)
        .cloned()
        .unwrap_or_else(|| default_demo_rows().remove(table).unwrap_or_default())
}

fn ensure_demo_rows(
    demo_rows: &mut HashMap<String, Vec<HashMap<String, String>>>,
) -> &mut Vec<HashMap<String, String>> {
    demo_rows
        .entry(DEMO_FEATURE_TEST_TABLE.into())
        .or_insert_with(|| mock_rows_for_table(DEMO_FEATURE_TEST_TABLE))
}

fn row_matches_keys(row: &HashMap<String, String>, keys: &HashMap<String, String>) -> bool {
    !keys.is_empty()
        && keys
            .iter()
            .all(|(column, expected)| row.get(column).map(String::as_str) == Some(expected.as_str()))
}

fn next_demo_id(rows: &[HashMap<String, String>]) -> String {
    rows.iter()
        .filter_map(|row| row.get("id")?.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1)
        .to_string()
}

fn normalize_demo_insert_row(
    row: &HashMap<String, String>,
    existing_rows: &[HashMap<String, String>],
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for column in demo_feature_test_table_meta().columns {
        let value = row
            .get(&column.column_name)
            .cloned()
            .unwrap_or_else(|| {
                if column.column_name == "id" {
                    next_demo_id(existing_rows)
                } else {
                    String::new()
                }
            });
        out.insert(column.column_name, value);
    }
    if out.get("id").map(|value| value.trim().is_empty()).unwrap_or(true) {
        out.insert("id".into(), next_demo_id(existing_rows));
    }
    out
}

fn save_table_changes_to_demo_rows(
    demo_rows: &mut HashMap<String, Vec<HashMap<String, String>>>,
    changeset: &TableChangeSet,
) -> Result<SaveResult, String> {
    if changeset.table_name != DEMO_FEATURE_TEST_TABLE {
        return Err("离线演示模式仅支持 demo_feature_test".into());
    }

    let rows = ensure_demo_rows(demo_rows);
    let has_pk = !changeset.primary_keys.is_empty();
    let mut updated = 0;
    let mut inserted = 0;
    let mut deleted = 0;

    for update in &changeset.updates {
        if update.changes.is_empty() {
            continue;
        }
        let keys = if has_pk {
            changeset
                .primary_keys
                .iter()
                .filter_map(|column| update.where_keys.get(column).map(|value| (column.clone(), value.clone())))
                .collect::<HashMap<_, _>>()
        } else {
            update.where_keys.clone()
        };
        if let Some(row) = rows.iter_mut().find(|row| row_matches_keys(row, &keys)) {
            for (column, value) in &update.changes {
                row.insert(column.clone(), value.clone());
            }
            updated += 1;
        }
    }

    for delete in &changeset.deletes {
        let keys = if has_pk {
            changeset
                .primary_keys
                .iter()
                .filter_map(|column| delete.get(column).map(|value| (column.clone(), value.clone())))
                .collect::<HashMap<_, _>>()
        } else {
            delete.clone()
        };
        if let Some(index) = rows.iter().position(|row| row_matches_keys(row, &keys)) {
            rows.remove(index);
            deleted += 1;
        }
    }

    for insert in &changeset.inserts {
        if insert.is_empty() {
            continue;
        }
        let normalized = normalize_demo_insert_row(insert, rows);
        rows.push(normalized);
        inserted += 1;
    }

    Ok(SaveResult {
        updated,
        inserted,
        deleted,
        warnings: vec!["离线演示保存仅保留在当前会话，重启后恢复默认数据".into()],
    })
}
fn map_row(input: &[(&str, &str)]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (k, v) in input {
        m.insert((*k).into(), (*v).into());
    }
    m
}
fn escape_ident(s: &str) -> String {
    s.replace('`', "``")
}
fn config_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("配置目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir.join("config.json"))
}
fn save_config_to_disk(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    fs::write(
        config_file_path(app)?,
        serde_json::to_string_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("保存配置失败: {e}"))
}
fn load_config_from_disk(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let p = config_file_path(app)?;
    if !p.exists() {
        return Ok(AppConfig::default());
    }
    serde_json::from_str(&fs::read_to_string(p).map_err(|e| format!("读取配置失败: {e}"))?)
        .map_err(|e| format!("解析配置失败: {e}"))
}
fn custom_skins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("配置目录失败: {e}"))?
        .join("custom_skins");
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir)
}

#[tauri::command]
async fn detect_sprite_dimensions(file_path: String) -> Result<HashMap<String, u32>, String> {
    let (w, h) = image::image_dimensions(&file_path)
        .map_err(|e| format!("读取图片尺寸失败: {e}"))?;
    let mut map = HashMap::new();
    map.insert("width".into(), w);
    map.insert("height".into(), h);
    Ok(map)
}

#[tauri::command]
async fn import_skin_sprites(
    skin_name: String,
    files: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建皮肤目录失败: {e}"))?;
    let mut result = Vec::new();
    for src_path in &files {
        let src = std::path::Path::new(src_path);
        let file_name = src
            .file_name()
            .ok_or("无效文件名")?
            .to_string_lossy()
            .to_string();
        let dest = dir.join(&file_name);
        fs::copy(src, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
        let (w, h) = image::image_dimensions(&dest)
            .map_err(|e| format!("读取图片尺寸失败: {e}"))?;
        let mut entry = HashMap::new();
        entry.insert("name".into(), serde_json::Value::String(
            file_name.trim_end_matches(".png").trim_end_matches(".PNG").to_string(),
        ));
        entry.insert("file".into(), serde_json::Value::String(file_name));
        entry.insert("width".into(), serde_json::Value::Number(w.into()));
        entry.insert("height".into(), serde_json::Value::Number(h.into()));
        result.push(entry);
    }
    Ok(result)
}

#[tauri::command]
async fn save_skin_manifest(
    skin_name: String,
    manifest: SkinManifest,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建皮肤目录失败: {e}"))?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(dir.join("manifest.json"), json).map_err(|e| format!("保存清单失败: {e}"))
}

#[tauri::command]
async fn list_custom_skins(
    app: tauri::AppHandle,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let dir = custom_skins_dir(&app)?;
    let mut skins = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let content =
            fs::read_to_string(&manifest_path).map_err(|e| format!("读取清单失败: {e}"))?;
        let manifest: SkinManifest =
            serde_json::from_str(&content).map_err(|e| format!("解析清单失败: {e}"))?;
        let id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mut entry_map = HashMap::new();
        entry_map.insert("id".into(), serde_json::Value::String(id));
        entry_map.insert(
            "manifest".into(),
            serde_json::to_value(&manifest).map_err(|e| e.to_string())?,
        );
        skins.push(entry_map);
    }
    Ok(skins)
}

#[tauri::command]
async fn delete_custom_skin(
    skin_name: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除皮肤失败: {e}"))?;
    }
    let mut rt = state.runtime.lock().await;
    let current_skin = &rt.config.personal.pet_skin;
    if current_skin == &format!("custom:{}", skin_name) {
        rt.config.personal.pet_skin = "eagle".into();
        save_config_to_disk(&app, &rt.config)?;
    }
    Ok(())
}

#[tauri::command]
async fn get_skin_base_path(
    skin_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let dir = custom_skins_dir(&app)?.join(&skin_name);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn set_autostart(enable: bool, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enable {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WeatherInfo {
    code: i32,
    text: String,
    temp: i32,
    wind_speed: i32,
    humidity: i32,
    category: String,
    rain_intensity: f32,
    city: String,
}

fn classify_weather_code(code: i32) -> (&'static str, f32) {
    match code {
        100 | 150 => ("sunny", 0.0),
        101..=104 | 151..=153 => ("cloudy", 0.0),
        300 => ("rain", 0.3),
        301 => ("rain", 0.5),
        302..=304 => ("rain", 0.8),
        305..=309 => ("rain", 0.5),
        310..=313 => ("rain", 0.7),
        314..=318 => ("rain", 0.9),
        399 => ("rain", 0.6),
        400..=499 => ("snow", 0.0),
        _ => ("cloudy", 0.0),
    }
}

#[tauri::command]
async fn get_weather() -> Result<WeatherInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    const QW_API_KEY: &str = "11931e18542b476b8bfbc17778db5449";
    const QW_API_HOST: &str = "https://nu4nmu2ctr.re.qweatherapi.com";

    // Hardcoded Xiamen coordinates (removes ip-api.com dependency)
    let location = "118.08,24.48".to_string(); // 厦门市
    let city = "厦门".to_string();

    // Step 2: Get current weather from QWeather
    let weather_url = format!("{}/v7/weather/now?location={}", QW_API_HOST, location);
    let weather_resp: serde_json::Value = client
        .get(&weather_url)
        .header("X-QW-Api-Key", QW_API_KEY)
        .send()
        .await
        .map_err(|e| format!("天气数据请求失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("天气数据解析失败: {}", e))?;

    let resp_code = weather_resp["code"].as_str().unwrap_or("");
    if resp_code != "200" {
        return Err(format!("和风天气API返回错误码: {}", resp_code));
    }

    let now = &weather_resp["now"];
    let code = now["icon"]
        .as_str()
        .unwrap_or("999")
        .parse::<i32>()
        .unwrap_or(999);
    let text = now["text"].as_str().unwrap_or("未知").to_string();
    let temp = now["temp"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);
    let wind_speed = now["windSpeed"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);
    let humidity = now["humidity"]
        .as_str()
        .unwrap_or("0")
        .parse::<i32>()
        .unwrap_or(0);

    let (category, rain_intensity) = classify_weather_code(code);

    Ok(WeatherInfo {
        code,
        text,
        temp,
        wind_speed,
        humidity,
        category: category.to_string(),
        rain_intensity,
        city,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>().inner().clone();
                let always_on_top = state.runtime.lock().await.config.personal.always_on_top;
                if let Err(e) = activate_panel_window(&app_handle, always_on_top) {
                    eprintln!("failed to activate existing panel window: {e}");
                }
            });
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let raw = shortcut.to_string();
                    let triggered = match normalize_hotkey_for_plugin(raw.as_str()) {
                        Ok(value) => value,
                        Err(e) => {
                            eprintln!("hotkey normalize failed: raw={raw:?} err={e}");
                            return;
                        }
                    };
                    let state = app.state::<AppState>().inner().clone();
                    let panel_hotkey = state.panel_hotkey_sync.read().unwrap().clone();
                    let quick_date_hotkey = state.quick_date_hotkey_sync.read().unwrap().clone();
                    let sync_window_hotkey = state.sync_window_hotkey_sync.read().unwrap().clone();
                    let db_migration_window_hotkey =
                        state.db_migration_window_hotkey_sync.read().unwrap().clone();
                    let quick_paste_open_hotkey =
                        state.quick_paste_open_hotkey_sync.read().unwrap().clone();
                    let quick_paste_output_hotkey =
                        state.quick_paste_output_hotkey_sync.read().unwrap().clone();

                    if quick_paste_open_hotkey.as_deref() == Some(triggered.as_str()) {
                        toggle_quick_paste_from_global_shortcut(app.clone());
                        return;
                    }

                    if quick_paste_output_hotkey.as_deref() == Some(triggered.as_str()) {
                        output_default_quick_paste_from_global_shortcut(app.clone());
                        return;
                    }

                    if db_migration_window_hotkey.as_deref() == Some(triggered.as_str()) {
                        toggle_db_migration_from_global_shortcut(app.clone());
                        return;
                    }

                    if quick_date_hotkey.as_deref() == Some(triggered.as_str()) {
                        if let Err(e) = input_today_date_globally() {
                            eprintln!("failed to input quick date: {e}");
                        }
                        return;
                    }

                    if sync_window_hotkey.as_deref() == Some(triggered.as_str()) {
                        toggle_sync_workspace_from_global_shortcut(app.clone());
                        return;
                    }

                    if panel_hotkey.as_deref() == Some(triggered.as_str()) {
                        open_panel_from_global_shortcut(app.clone());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            let st = app.state::<AppState>().clone();
            let _ = app.global_shortcut().unregister_all();
            let mut loaded = load_config_from_disk(&app.handle()).unwrap_or_default();
            if loaded.personal.quick_date_hotkey.trim().is_empty() {
                loaded.personal.quick_date_hotkey = "F9".into();
            }
            if loaded.personal.sync_window_hotkey.trim().is_empty() {
                loaded.personal.sync_window_hotkey = default_sync_window_hotkey();
            }
            if loaded.personal.db_migration_window_hotkey.trim().is_empty() {
                loaded.personal.db_migration_window_hotkey =
                    default_db_migration_window_hotkey();
            }
            if loaded.personal.quick_paste.open_hotkey.trim().is_empty() {
                loaded.personal.quick_paste.open_hotkey = DEFAULT_QUICK_PASTE_OPEN_HOTKEY.into();
            }
            if loaded.personal.quick_paste.output_hotkey.trim().is_empty() {
                loaded.personal.quick_paste.output_hotkey = DEFAULT_QUICK_PASTE_OUTPUT_HOTKEY.into();
            }
            loaded.personal.quick_paste = sanitize_quick_paste_config(loaded.personal.quick_paste.clone());
            loaded.personal.panel_window_size =
                sanitize_panel_window_size(loaded.personal.panel_window_size.take());
            loaded.personal.db_migration_window_size =
                sanitize_db_migration_window_size(loaded.personal.db_migration_window_size.take());
            loaded.personal.db_migration_last_connection = sanitize_db_migration_remembered_connection(
                loaded.personal.db_migration_last_connection.take(),
            );
            let (db_migration_profiles, last_used_db_migration_profile_id) =
                normalize_db_migration_profile_state(
                    std::mem::take(&mut loaded.personal.db_migration_profiles),
                    loaded.personal.last_used_db_migration_profile_id.take(),
                    loaded.personal.db_migration_last_connection.clone(),
                );
            loaded.personal.db_migration_profiles = db_migration_profiles;
            loaded.personal.last_used_db_migration_profile_id =
                last_used_db_migration_profile_id;
            let pet_position = loaded.personal.pet_position.clone();
            let show_update_announcement = should_show_update_announcement(
                &loaded.personal,
                &app.package_info().version.to_string(),
            );
            let registered_hotkey = match normalize_hotkey_for_plugin(&loaded.personal.hotkey) {
                Ok(shortcut) => {
                    match app.global_shortcut().register(shortcut.as_str()) {
                        Ok(()) => Some(shortcut),
                        Err(e) => {
                            eprintln!("failed to register startup hotkey: {e}");
                            None
                        }
                    }
                }
                Err(e) => {
                    eprintln!("invalid startup hotkey config: {e}");
                    None
                }
            };
            let registered_quick_date_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.quick_date_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str()) {
                            eprintln!("quick date hotkey is same as main hotkey, skipped");
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!("failed to register quick date hotkey: {e}");
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid quick date hotkey config: {e}");
                        None
                    }
                };
            let registered_sync_window_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.sync_window_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_quick_date_hotkey.as_deref() == Some(shortcut.as_str())
                        {
                            eprintln!("sync workspace hotkey conflicts with existing hotkeys, skipped");
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!("failed to register sync workspace hotkey: {e}");
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid sync workspace hotkey config: {e}");
                        None
                    }
                };
            let registered_db_migration_window_hotkey =
                match normalize_hotkey_for_plugin(&loaded.personal.db_migration_window_hotkey) {
                    Ok(shortcut) => {
                        if registered_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_quick_date_hotkey.as_deref() == Some(shortcut.as_str())
                            || registered_sync_window_hotkey.as_deref() == Some(shortcut.as_str())
                        {
                            eprintln!(
                                "db migration workspace hotkey conflicts with existing hotkeys, skipped"
                            );
                            None
                        } else {
                            match app.global_shortcut().register(shortcut.as_str()) {
                                Ok(()) => Some(shortcut),
                                Err(e) => {
                                    eprintln!(
                                        "failed to register db migration workspace hotkey: {e}"
                                    );
                                    None
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("invalid db migration workspace hotkey config: {e}");
                        None
                    }
                };
            // Sync-write hotkey values for the global shortcut handler
            *st.panel_hotkey_sync.write().unwrap() = registered_hotkey.clone();
            *st.quick_date_hotkey_sync.write().unwrap() = registered_quick_date_hotkey.clone();
            *st.sync_window_hotkey_sync.write().unwrap() = registered_sync_window_hotkey.clone();
            *st.db_migration_window_hotkey_sync.write().unwrap() =
                registered_db_migration_window_hotkey.clone();
            *st.panel_window_size_sync.write().unwrap() = loaded.personal.panel_window_size.clone();
            *st.db_migration_window_size_sync.write().unwrap() =
                loaded.personal.db_migration_window_size.clone();
            tauri::async_runtime::block_on(async {
                {
                    let mut rt = st.runtime.lock().await;
                    rt.config = loaded;
                    rt.schema_cache = mock_schema_cache();
                    rt.registered_hotkey = registered_hotkey;
                    rt.registered_quick_date_hotkey = registered_quick_date_hotkey;
                    rt.registered_sync_window_hotkey = registered_sync_window_hotkey;
                    rt.registered_db_migration_window_hotkey = registered_db_migration_window_hotkey;
                    rt.registered_quick_paste_open_hotkey = None;
                    rt.registered_quick_paste_output_hotkey = None;
                }
                if let Err(e) = register_quick_paste_hotkeys(&app.handle(), st.inner()).await {
                    eprintln!("failed to register quick paste hotkeys on startup: {e}");
                }
            });

            if let Err(e) = create_system_tray(&app.handle()) {
                eprintln!("failed to create system tray: {e}");
            }

            if let Err(e) = ensure_welcome_window(&app.handle()) {
                eprintln!("failed to create welcome window: {e}");
            }

            if show_update_announcement {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(4400));
                    if let Err(e) = ensure_update_announcement_window(&app_handle) {
                        eprintln!("failed to create update announcement window: {e}");
                    }
                });
            }

            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                if let Some(pos) = pet_position {
                    let _ = main_window.set_position(Position::Logical(LogicalPosition::new(
                        pos.x as f64,
                        pos.y as f64,
                    )));
                }
                let _ = main_window.set_always_on_top(true);
                let _ = main_window.set_skip_taskbar(true);
                let _ = main_window.set_shadow(false);

                // Start mouse hitbox polling for click-through
                let poll_window = main_window.clone();
                let poll_state = app.state::<AppState>().inner().clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(50));

                        let hitbox = poll_state.pet_hitbox.read().unwrap().clone();
                        let hitbox = match hitbox {
                            Some(h) => h,
                            None => continue,
                        };

                        let mouse_pos = match Mouse::get_mouse_position() {
                            Mouse::Position { x, y } => (x as f64, y as f64),
                            Mouse::Error => continue,
                        };

                        let win_pos = match poll_window.outer_position() {
                            Ok(p) => (p.x as f64, p.y as f64),
                            Err(_) => continue,
                        };

                        let scale = poll_window.scale_factor().unwrap_or(1.0);
                        let sprite_left = win_pos.0 + hitbox.offset_x * scale;
                        let sprite_top = win_pos.1 + hitbox.offset_y * scale;
                        let sprite_right = sprite_left + hitbox.width * scale;
                        let sprite_bottom = sprite_top + hitbox.height * scale;

                        let pad = 6.0 * scale;
                        let inside = mouse_pos.0 >= sprite_left - pad
                            && mouse_pos.0 <= sprite_right + pad
                            && mouse_pos.1 >= sprite_top - pad
                            && mouse_pos.1 <= sprite_bottom + pad;

                        let currently_ignored = poll_state
                            .pet_cursor_ignored
                            .load(std::sync::atomic::Ordering::Relaxed);

                        if !inside && !currently_ignored {
                            if poll_window.set_ignore_cursor_events(true).is_ok() {
                                poll_state
                                    .pet_cursor_ignored
                                    .store(true, std::sync::atomic::Ordering::Relaxed);
                            }
                        } else if inside && currently_ignored {
                            if poll_window.set_ignore_cursor_events(false).is_ok() {
                                poll_state
                                    .pet_cursor_ignored
                                    .store(false, std::sync::atomic::Ordering::Relaxed);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_db,
            disconnect_db,
            get_connection_status,
            list_databases,
            select_database,
            refresh_schema,
            search,
            cancel_search,
            get_table_data,
            list_tables,
            get_config,
            get_quick_paste_config,
            save_quick_paste_config,
            save_quick_paste_image,
            upsert_quick_paste_snippet,
            delete_quick_paste_snippet,
            set_default_quick_paste_snippet,
            output_quick_paste_snippet,
            output_default_quick_paste_snippet,
            save_config,
            get_update_settings,
            prepare_startup_update_check,
            check_for_updates_now,
            remember_pending_update_announcement,
            acknowledge_update_announcement,
            register_hotkey,
            register_quick_date_hotkey,
            register_sync_window_hotkey,
            register_db_migration_window_hotkey,
            show_quick_paste_window,
            hide_quick_paste_window,
            toggle_quick_paste_window,
            hide_sync_workspace_window,
            toggle_sync_workspace_window,
            show_db_migration_window,
            hide_db_migration_window,
            toggle_db_migration_window,
            get_db_migration_workspace_state,
            save_db_migration_workspace_state,
            connect_db_migration_server,
            run_db_migration,
            get_art_text_search_dirs,
            save_art_text_search_dirs,
            scan_art_text_sub_dirs,
            build_art_text_index,
            get_art_text_index_info,
            get_art_text_ocr_status,
            install_art_text_ocr_models,
            import_art_text_ocr_models,
            search_art_text,
            open_file_in_explorer,
            show_art_text_search_window,
            hide_art_text_search_window,
            toggle_art_text_search_window,
            open_directory_in_explorer,
            open_gitee_release_page,
            run_sync_profile,
            show_panel_window,
            hide_panel_window,
            close_welcome_window,
            toggle_panel_window,
            consume_panel_open_settings,
            set_panel_always_on_top,
            show_pet_menu,
            hide_pet_menu,
            hide_pet_window,
            toggle_pet_lock,
            save_pet_position,
            quit_app,
            set_autostart,
            save_table_changes,
            export_tables_xlsx,
            export_tables_xlsx_batch,
            list_system_fonts,
            resize_pet_window,
            update_pet_hitbox,
            detect_sprite_dimensions,
            import_skin_sprites,
            save_skin_manifest,
            list_custom_skins,
            delete_custom_skin,
            get_skin_base_path,
            get_weather
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_server_config_allows_empty_selected_database() {
        let config = DbConfig {
            host: "127.0.0.1".into(),
            port: 3306,
            username: "root".into(),
            password: "secret".into(),
            database: "".into(),
        };

        assert!(validate_db_server_config(&config).is_ok());
    }

    #[test]
    fn database_server_config_still_requires_host() {
        let config = DbConfig {
            host: " ".into(),
            port: 3306,
            username: "root".into(),
            password: "secret".into(),
            database: "app".into(),
        };

        assert_eq!(validate_db_server_config(&config), Err("请填写数据库主机".into()));
    }

    #[test]
    fn demo_host_uses_fake_database_connection() {
        let config = DbConfig {
            host: "demo".into(),
            port: 3306,
            username: "".into(),
            password: "".into(),
            database: "".into(),
        };

        assert!(is_fake_db_config(&config));
        assert_eq!(
            fake_database_names(),
            vec![
                "demo_feature_test".to_string(),
                "demo_shop".to_string(),
                "demo_ops".to_string()
            ]
        );
    }

    #[test]
    fn art_text_ocr_model_status_reports_missing_files() {
        let root = std::env::temp_dir().join(format!(
            "dbsearch-ocr-model-missing-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("det.onnx"), b"det").unwrap();

        let status = inspect_art_text_ocr_model_dir(&root);

        assert!(!status.ready);
        assert_eq!(status.missing, vec!["rec.onnx", "ppocr_keys_v1.txt"]);
        assert!(status.path.ends_with("dbsearch-ocr-model-missing-test-")
            || status.path.contains("dbsearch-ocr-model-missing-test-"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn art_text_ocr_model_status_accepts_complete_model_dir() {
        let root = std::env::temp_dir().join(format!(
            "dbsearch-ocr-model-ready-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("det.onnx"), b"det").unwrap();
        fs::write(root.join("rec.onnx"), b"rec").unwrap();
        fs::write(root.join("ppocr_keys_v1.txt"), b"dict").unwrap();

        let status = inspect_art_text_ocr_model_dir(&root);

        assert!(status.ready);
        assert!(status.missing.is_empty());
        assert_eq!(status.required.len(), 3);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn collect_images_recursive_reports_each_directory() {
        let root = std::env::temp_dir().join(format!(
            "dbsearch-art-text-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let nested = root.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("demo.png"), b"png").unwrap();

        let mut files = Vec::new();
        let mut visited = Vec::new();
        collect_images_recursive_with_progress(&root, &mut files, &mut |dir| {
            visited.push(dir.to_path_buf());
        });

        assert_eq!(files.len(), 1);
        assert!(visited.iter().any(|p| p.ends_with("a")));
        assert!(visited.iter().any(|p| p.ends_with("b")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pet_menu_height_fits_all_actions() {
        let min_height = PET_MENU_VERTICAL_PADDING
            + PET_MENU_BUTTON_COUNT * PET_MENU_BUTTON_HEIGHT
            + PET_MENU_DIVIDER_BLOCK_HEIGHT
            + (PET_MENU_CHILD_COUNT - 1.0) * PET_MENU_ROW_GAP;

        assert!(
            PET_MENU_HEIGHT >= min_height,
            "pet menu height {PET_MENU_HEIGHT} is smaller than required minimum {min_height}"
        );
    }

    #[test]
    fn tray_left_click_opens_the_panel() {
        assert!(tray_click_opens_panel(MouseButton::Left, MouseButtonState::Up));
        assert!(!tray_click_opens_panel(MouseButton::Right, MouseButtonState::Up));
        assert!(!tray_click_opens_panel(MouseButton::Left, MouseButtonState::Down));
    }

    #[test]
    fn tray_menu_action_maps_all_supported_commands() {
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_OPEN_PANEL_ID),
            Some(TrayMenuAction::OpenPanel)
        );
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_SHOW_PET_ID),
            Some(TrayMenuAction::ShowPet)
        );
        assert_eq!(
            resolve_tray_menu_action(TRAY_MENU_EXIT_ID),
            Some(TrayMenuAction::ExitApp)
        );
        assert_eq!(resolve_tray_menu_action("unknown"), None);
    }

    #[test]
    fn startup_welcome_text_defaults_to_louis() {
        assert_eq!(PersonalConfig::default().startup_welcome_text, "Louis");
    }

    #[test]
    fn startup_welcome_mode_defaults_to_handwriting() {
        assert_eq!(
            PersonalConfig::default().startup_welcome_mode,
            "handwriting"
        );
    }

    #[test]
    fn primary_windows_close_to_tray_instead_of_exiting() {
        assert_eq!(
            close_request_action_for_window(PANEL_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(SYNC_WORKSPACE_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(DB_MIGRATION_WORKSPACE_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(QUICK_PASTE_WINDOW_LABEL),
            WindowCloseAction::HideToTray
        );
        assert_eq!(
            close_request_action_for_window(PET_MENU_WINDOW_LABEL),
            WindowCloseAction::HideWindow
        );
    }

    #[test]
    fn update_check_plan_runs_on_first_startup() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_still_runs_on_every_startup_for_testing() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_manual_mode_bypasses_auto_setting() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(false, now, true);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "manual");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_ignores_recent_check_on_startup() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
        assert_eq!(plan.checked_at.as_deref(), Some("2026-03-20T08:00:00+00:00"));
    }

    #[test]
    fn update_check_plan_runs_on_startup_after_older_checks() {
        let now = DateTime::parse_from_rfc3339("2026-03-20T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let plan = build_update_check_plan(true, now, false);

        assert!(plan.should_check);
        assert_eq!(plan.reason, "startup-due");
    }

    #[test]
    fn update_announcement_shows_pending_current_version_once() {
        let mut personal = PersonalConfig::default();
        personal.pending_update_announcement = Some(UpdateAnnouncement {
            version: "v5.5.0".into(),
            notes: "1. 新增更新公告".into(),
            pub_date: Some("2026-04-28T08:30:00Z".into()),
        });
        personal.last_update_announcement_version = Some("5.4.0".into());

        assert!(should_show_update_announcement(&personal, "5.5.0"));

        personal.last_update_announcement_version = Some("5.5.0".into());

        assert!(!should_show_update_announcement(&personal, "5.5.0"));
    }

    #[test]
    fn update_announcement_ignores_stale_pending_version() {
        let mut personal = PersonalConfig::default();
        personal.pending_update_announcement = Some(UpdateAnnouncement {
            version: "5.4.9".into(),
            notes: "旧版本说明".into(),
            pub_date: None,
        });

        assert!(!should_show_update_announcement(&personal, "5.5.0"));
    }

    #[test]
    fn sync_hotkey_defaults_to_shift_d() {
        assert_eq!(default_sync_window_hotkey(), "Shift+D");
    }

    #[test]
    fn db_migration_hotkey_defaults_to_shift_s() {
        assert_eq!(default_db_migration_window_hotkey(), "Shift+S");
    }

    #[test]
    fn quick_paste_image_output_plan_pastes_clipboard_image() {
        assert_eq!(
            quick_paste_output_steps("image", false),
            vec![
                QuickPasteOutputStep::CopyImageToClipboard,
                QuickPasteOutputStep::PauseBeforeGlobalInput,
                QuickPasteOutputStep::PasteClipboard,
            ]
        );
    }

    #[test]
    fn quick_paste_text_output_plan_keeps_direct_text_input() {
        assert_eq!(
            quick_paste_output_steps("text", false),
            vec![QuickPasteOutputStep::InputTextGlobally]
        );
    }

    #[test]
    fn quick_paste_plain_clipboard_output_plan_pastes_text_clipboard_content() {
        assert_eq!(
            quick_paste_output_steps("plain_clipboard", false),
            vec![
                QuickPasteOutputStep::CopyTextToClipboard,
                QuickPasteOutputStep::PauseBeforeGlobalInput,
                QuickPasteOutputStep::PasteClipboard,
            ]
        );
    }

    #[test]
    fn quick_paste_rich_output_plan_pastes_html_clipboard_content() {
        assert_eq!(
            quick_paste_output_steps("rich", false),
            vec![
                QuickPasteOutputStep::CopyHtmlToClipboard,
                QuickPasteOutputStep::PauseBeforeGlobalInput,
                QuickPasteOutputStep::PasteClipboard,
            ]
        );
    }

    #[test]
    fn quick_paste_rich_html_inlines_local_images_for_external_targets() {
        let image_path = std::env::temp_dir().join("quick-paste-inline-image-test.png");
        std::fs::write(&image_path, [137, 80, 78, 71]).expect("test image should be writable");
        let html = format!(
            "<p>上方文字</p><img src=\"{}\"><p>下方文字</p>",
            image_path.display()
        );

        let inlined = inline_quick_paste_html_images(&html).expect("image should inline");

        assert!(inlined.contains("<p>上方文字</p>"));
        assert!(inlined.contains("<img src=\"data:image/png;base64,iVBORw==\">"));
        assert!(inlined.contains("<p>下方文字</p>"));
        assert!(!inlined.contains(&image_path.display().to_string()));
        let _ = std::fs::remove_file(image_path);
    }

    #[test]
    fn quick_paste_collects_local_images_from_image_and_rich_snippets() {
        let image_snippet = QuickPasteSnippet {
            id: "image".into(),
            title: "图片".into(),
            content: "C:/tmp/quick-paste-images/a.png".into(),
            image: "".into(),
            category: "image".into(),
            favorite: false,
            is_default: false,
            created_at: "".into(),
            updated_at: "".into(),
        };
        let rich_snippet = QuickPasteSnippet {
            id: "rich".into(),
            title: "图文".into(),
            content: r#"<p><img src="asset://ignored"></p><p><img data-path="C:/tmp/quick-paste-images/b.png"></p>"#.into(),
            image: "".into(),
            category: "rich".into(),
            favorite: false,
            is_default: false,
            created_at: "".into(),
            updated_at: "".into(),
        };

        assert_eq!(collect_quick_paste_local_image_paths(&image_snippet).len(), 1);
        assert_eq!(collect_quick_paste_local_image_paths(&rich_snippet).len(), 1);
    }

    #[test]
    fn quick_paste_rich_html_declares_utf8_for_chinese_text() {
        let html = prepare_quick_paste_clipboard_html("<p>上方文字</p><p>下方文字</p>")
            .expect("html should prepare");

        assert!(html.contains("<meta charset=\"utf-8\">"));
        assert!(html.contains("<p>上方文字</p>"));
        assert!(html.contains("<p>下方文字</p>"));
    }

    #[test]
    fn db_migration_window_size_is_clamped_to_minimum_dimensions() {
        let size = sanitize_db_migration_window_size(Some(DbMigrationWindowSize {
            width: 720.0,
            height: 480.0,
        }))
        .expect("size should stay available");

        assert_eq!(size.width, 980.0);
        assert_eq!(size.height, 660.0);
    }

    #[test]
    fn db_migration_window_size_can_be_resolved_from_sync_cache() {
        let state = AppState::default();
        *state.db_migration_window_size_sync.write().unwrap() = Some(DbMigrationWindowSize {
            width: 1240.0,
            height: 820.0,
        });

        let size = resolve_db_migration_window_size_from_cache(&state);

        assert_eq!(size.width, 1240.0);
        assert_eq!(size.height, 820.0);
    }

    #[test]
    fn offline_demo_schema_has_complete_feature_test_table() {
        let schema = mock_schema_cache();
        let table = schema
            .tables
            .iter()
            .find(|item| item.table_name == "demo_feature_test")
            .expect("demo_feature_test should be available offline");

        assert!(!table.table_comment.trim().is_empty());
        assert!(
            table.columns.len() >= 9,
            "demo table should cover common editable data types"
        );
        assert!(table.columns.iter().any(|column| column.is_primary_key));
        assert!(table
            .columns
            .iter()
            .all(|column| !column.column_comment.trim().is_empty()));

        let rows = mock_rows_for_table("demo_feature_test");
        assert!(rows.len() >= 5, "demo table should have enough rows to test editing");
        for (row_index, row) in rows.iter().enumerate() {
            for column in &table.columns {
                let value = row
                    .get(&column.column_name)
                    .unwrap_or_else(|| panic!("row {row_index} is missing {}", column.column_name));
                assert!(
                    !value.trim().is_empty(),
                    "row {row_index} column {} should not be empty",
                    column.column_name
                );
            }
        }
    }

    #[test]
    fn runtime_schema_uses_demo_only_when_disconnected() {
        let empty_schema = SchemaCache {
            tables: vec![],
            last_refresh: None,
        };

        let connected_schema = resolve_runtime_schema(true, &empty_schema);
        assert!(connected_schema.tables.is_empty());

        let disconnected_schema = resolve_runtime_schema(false, &empty_schema);
        assert!(disconnected_schema
            .tables
            .iter()
            .any(|item| item.table_name == "demo_feature_test"));
    }

    #[test]
    fn offline_demo_save_applies_update_insert_and_delete_in_memory() {
        let mut demo_rows = default_demo_rows();
        let insert_row = map_row(&[
            ("id", "900"),
            ("feature_name", "新增行演练"),
            ("owner", "测试员"),
            ("priority", "4"),
            ("enabled", "1"),
            ("due_date", "2026-05-20"),
            ("updated_at", "2026-04-29 21:30:00"),
            ("remark", "新增行用于验证离线演示保存会写入内存"),
            ("payload_json", r#"{"action":"insert","source":"test"}"#),
        ]);

        let result = save_table_changes_to_demo_rows(
            &mut demo_rows,
            &TableChangeSet {
                table_name: "demo_feature_test".into(),
                primary_keys: vec!["id".into()],
                updates: vec![RowUpdate {
                    where_keys: map_row(&[("id", "1")]),
                    changes: map_row(&[("feature_name", "单击编辑已保存")]),
                }],
                inserts: vec![insert_row.clone()],
                deletes: vec![map_row(&[("id", "2")])],
            },
        )
        .expect("offline demo save should succeed");

        assert_eq!(result.updated, 1);
        assert_eq!(result.inserted, 1);
        assert_eq!(result.deleted, 1);

        let rows = demo_rows
            .remove("demo_feature_test")
            .expect("demo table rows should exist");
        assert!(rows
            .iter()
            .any(|row| row.get("id").map(String::as_str) == Some("1")
                && row.get("feature_name").map(String::as_str) == Some("单击编辑已保存")));
        assert!(!rows
            .iter()
            .any(|row| row.get("id").map(String::as_str) == Some("2")));
        assert!(rows
            .iter()
            .any(|row| row.get("id").map(String::as_str) == Some("900")
                && row.get("payload_json") == insert_row.get("payload_json")));
    }

    #[test]
    fn panel_window_size_is_clamped_to_minimum_dimensions() {
        let size = sanitize_panel_window_size(Some(PanelWindowSize {
            width: 520.0,
            height: 600.0,
        }))
        .expect("size should stay available");

        assert_eq!(size.width, 680.0);
        assert_eq!(size.height, 720.0);
    }

    #[test]
    fn panel_window_size_can_be_resolved_from_sync_cache() {
        let state = AppState::default();
        *state.panel_window_size_sync.write().unwrap() = Some(PanelWindowSize {
            width: 1080.0,
            height: 860.0,
        });

        let size = resolve_panel_window_size_from_cache(&state);

        assert_eq!(size.width, 1080.0);
        assert_eq!(size.height, 860.0);
    }

    #[test]
    fn legacy_db_migration_connection_is_migrated_into_profile_list() {
        let (profiles, last_used_profile_id) = normalize_db_migration_profile_state(
            Vec::new(),
            None,
            Some(DbMigrationRememberedConnection {
                host: "db.local".into(),
                port: 3306,
                username: "root".into(),
                password: "pw".into(),
                source_database: "source_a".into(),
                target_database: "target_b".into(),
            }),
        );

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "db-migration-profile-1");
        assert_eq!(profiles[0].name, "source_a -> target_b");
        assert_eq!(last_used_profile_id.as_deref(), Some("db-migration-profile-1"));
    }

    #[test]
    fn new_db_migration_profiles_take_priority_over_legacy_connection() {
        let (profiles, last_used_profile_id) = normalize_db_migration_profile_state(
            vec![DbMigrationProfile {
                id: "profile-b".into(),
                name: "已保存模板".into(),
                host: "db.remote".into(),
                port: 3307,
                username: "admin".into(),
                password: "pw".into(),
                source_database: "src".into(),
                target_database: "dst".into(),
            }],
            Some("profile-b".into()),
            Some(DbMigrationRememberedConnection {
                host: "legacy.local".into(),
                port: 3306,
                username: "root".into(),
                password: "pw".into(),
                source_database: "old_src".into(),
                target_database: "old_dst".into(),
            }),
        );

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "profile-b");
        assert_eq!(profiles[0].host, "db.remote");
        assert_eq!(last_used_profile_id.as_deref(), Some("profile-b"));
    }

    #[test]
    fn invalid_last_used_db_migration_profile_falls_back_to_first_profile() {
        let (profiles, last_used_profile_id) = normalize_db_migration_profile_state(
            vec![
                DbMigrationProfile {
                    id: "profile-a".into(),
                    name: "模板 A".into(),
                    host: "a.local".into(),
                    port: 3306,
                    username: "root".into(),
                    password: String::new(),
                    source_database: "source_a".into(),
                    target_database: "target_a".into(),
                },
                DbMigrationProfile {
                    id: "profile-b".into(),
                    name: "模板 B".into(),
                    host: "b.local".into(),
                    port: 3307,
                    username: "root".into(),
                    password: String::new(),
                    source_database: "source_b".into(),
                    target_database: "target_b".into(),
                },
            ],
            Some("missing".into()),
            None,
        );

        assert_eq!(profiles.len(), 2);
        assert_eq!(last_used_profile_id.as_deref(), Some("profile-a"));
    }
}
