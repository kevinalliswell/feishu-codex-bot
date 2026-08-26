use tauri::Manager;

pub mod approval;
pub mod commands;
pub mod config;
pub mod legacy;
pub mod model;
pub mod paths;
pub mod secrets;
pub mod sidecar;
pub mod state;
pub mod tray;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = state::AppState::new(app.handle())?;
            app.manage(state);
            tray::install(app.handle())?;
            if std::env::args().any(|argument| argument == "--hidden")
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.hide();
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(commands::start_if_ready(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::save_config,
            commands::set_secret,
            commands::delete_secret,
            commands::test_feishu,
            commands::download_model,
            commands::restart_sidecar,
            commands::set_paused,
            commands::resolve_approval,
            commands::run_diagnostics,
            commands::export_diagnostics,
            commands::open_today_note,
            commands::inspect_legacy,
            commands::import_legacy,
            commands::disable_legacy_service,
            commands::restart_app,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Feishu Codex");
}
