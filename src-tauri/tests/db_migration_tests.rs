use tauri_app_lib::db_migration::{
    build_backup_folder_name, filter_user_databases, format_backup_file_name,
};

#[test]
fn filter_user_databases_hides_system_schemas_and_sorts_unique_names() {
    let filtered = filter_user_databases(vec![
        "mysql".to_string(),
        "analytics".to_string(),
        "sys".to_string(),
        "app_main".to_string(),
        "information_schema".to_string(),
        "analytics".to_string(),
        "performance_schema".to_string(),
        "zebra".to_string(),
    ]);

    assert_eq!(
        filtered,
        vec![
            "analytics".to_string(),
            "app_main".to_string(),
            "zebra".to_string()
        ]
    );
}

#[test]
fn build_backup_folder_name_includes_timestamp_and_database_names() {
    let folder = build_backup_folder_name(
        "20260326-231501",
        "source_db",
        "target_db",
    );

    assert_eq!(folder, "20260326-231501-source_db-to-target_db");
}

#[test]
fn format_backup_file_name_uses_kind_and_database_name() {
    assert_eq!(
        format_backup_file_name("source", "app_main"),
        "source-app_main.sql"
    );
    assert_eq!(
        format_backup_file_name("target", "analytics"),
        "target-analytics.sql"
    );
}
