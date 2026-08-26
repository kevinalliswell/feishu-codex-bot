pub mod approval;
pub mod config;
pub mod model;
pub mod secrets;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Feishu Codex");
}
