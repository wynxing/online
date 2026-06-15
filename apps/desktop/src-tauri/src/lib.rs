pub mod api;
pub mod audio;
mod commands;
pub mod error;
pub mod models;
pub mod pipeline;
mod state;
pub mod storage;

use commands::{
    create_glossary, delete_glossary, get_config, get_segments, health_check, list_devices,
    list_glossary, list_sessions, save_config, start_session, stop_session, test_asr,
    test_translation, update_glossary,
};
use state::AppState;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _log_guard = init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            list_devices,
            get_config,
            save_config,
            start_session,
            stop_session,
            list_sessions,
            get_segments,
            list_glossary,
            create_glossary,
            update_glossary,
            delete_glossary,
            test_asr,
            test_translation
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.pipeline.blocking_stop();
            }
        });
}

fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let data_dir = storage::data_dir();
    let log_dir = data_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return None;
    }

    let file_appender = tracing_appender::rolling::daily(log_dir, "runtime.log");
    let (writer, guard) = tracing_appender::non_blocking(file_appender);
    let subscriber = tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);
    Some(guard)
}
