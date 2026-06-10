use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct RuntimeProcess {
    child: Mutex<Option<CommandChild>>,
    last_error: Mutex<Option<String>>,
    restart_count: Mutex<u32>,
}

const MAX_RESTART_ATTEMPTS: u32 = 3;
const RESTART_DELAY_MS: u64 = 2000;

impl Default for RuntimeProcess {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            last_error: Mutex::new(None),
            restart_count: Mutex::new(0),
        }
    }
}

fn spawn_sidecar(handle: &tauri::AppHandle) {
    let command = match handle.shell().sidecar("ai-interpretation-runtime") {
        Ok(command) => command.env("ONLINE_RUNTIME_RELOAD", "0"),
        Err(error) => {
            let msg = format!("sidecar binary not found: {error}");
            eprintln!("Runtime {msg}");
            let state = handle.state::<RuntimeProcess>();
            *state.last_error.lock().unwrap() = Some(msg);
            return;
        }
    };

    let (mut rx, child) = match command.spawn() {
        Ok(process) => process,
        Err(error) => {
            let msg = format!("failed to spawn sidecar: {error}");
            eprintln!("Runtime {msg}");
            let state = handle.state::<RuntimeProcess>();
            *state.last_error.lock().unwrap() = Some(msg);
            return;
        }
    };

    {
        let state = handle.state::<RuntimeProcess>();
        *state.child.lock().unwrap() = Some(child);
        *state.last_error.lock().unwrap() = None;
        *state.restart_count.lock().unwrap() = 0;  // Reset restart count on successful spawn
    }

    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    eprintln!("runtime stdout: {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("runtime stderr: {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(error) => {
                    eprintln!("runtime process error: {error}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("runtime process terminated: {:?}", payload.code);
                    let state = handle.state::<RuntimeProcess>();
                    *state.child.lock().unwrap() = None;

                    // Auto-restart logic
                    let mut restart_count = state.restart_count.lock().unwrap();
                    if *restart_count < MAX_RESTART_ATTEMPTS {
                        *restart_count += 1;
                        eprintln!(
                            "Attempting to restart runtime (attempt {}/{})",
                            *restart_count, MAX_RESTART_ATTEMPTS
                        );
                        drop(restart_count);

                        // Wait before restarting to avoid rapid restart loops
                        std::thread::sleep(Duration::from_millis(RESTART_DELAY_MS));

                        // Spawn a new sidecar
                        spawn_sidecar(&handle);
                    } else {
                        eprintln!(
                            "Max restart attempts ({}) reached. Runtime will not be restarted.",
                            MAX_RESTART_ATTEMPTS
                        );
                        *state.last_error.lock().unwrap() = Some(
                            "Runtime failed to start after multiple attempts".to_string(),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}

fn start_runtime_sidecar(app: &tauri::App) {
    spawn_sidecar(app.handle());
}

fn stop_runtime_sidecar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<RuntimeProcess>();
    let child = state.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
}

#[tauri::command]
fn runtime_status(state: tauri::State<'_, RuntimeProcess>) -> serde_json::Value {
    let alive = state.child.lock().unwrap().is_some();
    let error = state.last_error.lock().unwrap().clone();
    serde_json::json!({ "alive": alive, "error": error })
}

#[tauri::command]
fn restart_runtime(handle: tauri::AppHandle) -> Result<(), String> {
    {
        let state = handle.state::<RuntimeProcess>();
        let child = state.child.lock().unwrap().take();
        if let Some(child) = child {
            let _ = child.kill();
        }
        *state.last_error.lock().unwrap() = None;
    }
    spawn_sidecar(&handle);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(RuntimeProcess::default());
            start_runtime_sidecar(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_status, restart_runtime])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_runtime_sidecar(app);
            }
        });
}
