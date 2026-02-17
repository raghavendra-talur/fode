mod commands;
mod parser;

use commands::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_agent_control::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            repo_info: Mutex::new(None),
            entity_graph: Mutex::new(None),
            repo_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repo,
            commands::get_repo_info,
            commands::search_entities,
            commands::get_entity_focus,
            commands::get_all_entities,
            commands::get_entity_source,
            commands::get_graph_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
