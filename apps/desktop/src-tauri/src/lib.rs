use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
struct RuntimeProcess(Mutex<Option<CommandChild>>);

fn start_runtime_sidecar(app: &tauri::App) {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let command = match handle
            .shell()
            .sidecar("ai-interpretation-runtime")
        {
            Ok(command) => command.env("ONLINE_RUNTIME_RELOAD", "0"),
            Err(error) => {
                eprintln!("Runtime sidecar is not available: {error}");
                return;
            }
        };

        let (mut rx, child) = match command.spawn() {
            Ok(process) => process,
            Err(error) => {
                eprintln!("Failed to start runtime sidecar: {error}");
                return;
            }
        };

        {
            let state = handle.state::<RuntimeProcess>();
            let mut guard = state.0.lock().expect("runtime process mutex poisoned");
            *guard = Some(child);
        }

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
                    let mut guard = state.0.lock().expect("runtime process mutex poisoned");
                    *guard = None;
                    break;
                }
                _ => {}
            }
        }
    });
}

fn stop_runtime_sidecar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<RuntimeProcess>();
    let child = {
        let mut guard = state.0.lock().expect("runtime process mutex poisoned");
        guard.take()
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_runtime_sidecar(app);
            }
        });
}
