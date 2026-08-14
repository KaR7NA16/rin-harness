// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! rin desktop GUI shell.
//!
//! A Tauri 2 thin shell with three responsibilities:
//!   1. spawn the rin host (dev: the "rin" launcher; release: the packaged
//!      dsh-runtime sidecar) and reap it on exit;
//!   2. host a single WebView that loads the rin web-ui (devUrl in
//!      development, the bundled frontendDist in release);
//!   3. keep a system tray icon so closing the window hides to tray instead
//!      of quitting, and the tray menu is the only way to quit.

use std::{
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
};

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};

/// Label of the single main window (matches tauri.conf.json's first window).
const MAIN_WINDOW_LABEL: &str = "main";
/// Tray menu item ids.
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_QUIT_ID: &str = "tray_quit";
/// The rin web-server URL the WebView loads in development. Must match
/// build.devUrl in tauri.conf.json and the host port/host below.
const DEV_URL: &str = "http://127.0.0.1:8320";
/// Host Web-server listen port and host handed to the spawned launcher.
const HOST_PORT: &str = "8320";
const HOST_HOST: &str = "127.0.0.1";
/// Environment variable overriding the dev host launcher command (default "rin").
const HOST_CMD_ENV: &str = "RIN_GUI_HOST_CMD";
/// Environment variable that disables host spawning so the shell connects to an
/// already-running host at DEV_URL (direct-connect development).
const NO_SPAWN_ENV: &str = "RIN_GUI_NO_SPAWN";

/// A spawned host process, with its stdin held open.
///
/// The "rin web" launcher treats stdin EOF as "shut down", so the shell keeps
/// the write end of the child's stdin alive for the whole app lifetime and
/// drops it (then kills the child) only on exit.
struct HostProcess {
    child: Child,
    _stdin: Option<ChildStdin>,
}

/// Shared handle to the spawned host (None while it is not running).
#[derive(Default)]
struct HostState(Mutex<Option<HostProcess>>);

/// Whether the app is committing to quit, as opposed to hiding to tray.
#[derive(Default)]
struct AppExitState {
    is_quitting: Mutex<bool>,
}

/// Development launcher arguments: the "rin" CLI's "web" subcommand boots the
/// host on HOST_PORT/HOST_HOST and stays in the foreground, so the shell owns
/// and reaps its lifetime.
fn dev_host_args() -> [&'static str; 5] {
    ["web", "--port", HOST_PORT, "--host", HOST_HOST]
}

/// Packaged sidecar arguments: the sidecar's "serve" subcommand boots the host
/// on HOST_PORT/HOST_HOST (single-entry mode, see scripts/build-sidecar.md).
fn sidecar_args() -> [&'static str; 5] {
    ["serve", "--port", HOST_PORT, "--host", HOST_HOST]
}

/// The platform file name of the packaged host sidecar.
fn host_sidecar_name() -> &'static str {
    if cfg!(windows) {
        "rin-sidecar.exe"
    } else {
        "rin-sidecar"
    }
}

/// Resolve the packaged host sidecar path.
///
/// Tauri's bundle.externalBin places the sidecar next to the app executable on
/// Windows/macOS and under a platform lib dir on Linux. The executable's
/// directory is the first lookup (mirrors the legacy desktop shell's sidecar
/// resolution); the resource directory is the fallback for Linux packaging.
fn resolve_host_sidecar(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("resolve current executable: {err}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "current executable has no parent directory".to_string())?;
    let next_to_exe = exe_dir.join(host_sidecar_name());
    if next_to_exe.is_file() {
        return Ok(next_to_exe);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve resource directory: {err}"))?;
    Ok(resource_dir.join(host_sidecar_name()))
}

/// Resolve the host launch command for the current build mode.
fn host_command(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
    if tauri::is_dev() {
        // Development: spawn the "rin" launcher (override with RIN_GUI_HOST_CMD).
        let program = std::env::var(HOST_CMD_ENV).unwrap_or_else(|_| "rin".to_string());
        let args: Vec<String> = dev_host_args().into_iter().map(str::to_string).collect();
        return Ok((PathBuf::from(program), args));
    }
    // Release: spawn the packaged dsh-runtime sidecar (rin-sidecar serve ...).
    let program = resolve_host_sidecar(app)?;
    let args: Vec<String> = sidecar_args().into_iter().map(str::to_string).collect();
    Ok((program, args))
}

/// Spawn the host and return its handle.
///
/// Both dev and release resolve to a (program, args) pair and go through this
/// single spawn path so exit-time reaping and error reporting are shared.
fn start_host(app: &AppHandle) -> Result<HostProcess, String> {
    let (program, args) = host_command(app)?;
    let mut command = Command::new(&program);
    command
        .args(&args)
        // The packaged sidecar reads RIN_PARENT_PID to self-exit when the shell
        // dies (parent watchdog, see scripts/build-sidecar.md); harmless in dev.
        .env("RIN_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let mut child = command
        .spawn()
        .map_err(|err| format!("spawn host {}: {err}", program.display()))?;
    let stdin = child.stdin.take();
    Ok(HostProcess { child, _stdin: stdin })
}

/// Stop and reap the host child, if one is running.
fn stop_host(app: &AppHandle) {
    if let Some(state) = app.try_state::<HostState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut host) = guard.take() {
                // Drop stdin first so a graceful host can observe EOF; then
                // kill() guarantees termination and wait() reaps the child.
                drop(host._stdin.take());
                let _ = host.child.kill();
                let _ = host.child.wait();
            }
        }
    }
}

/// Whether the shell should spawn a host, or connect to a running one.
fn should_spawn_host() -> bool {
    match std::env::var(NO_SPAWN_ENV) {
        Ok(value) => !matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => true,
    }
}

fn mark_app_quitting(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppExitState>() {
        if let Ok(mut is_quitting) = state.is_quitting.lock() {
            *is_quitting = true;
        }
    }
}

fn is_app_quitting(app: &AppHandle) -> bool {
    app.try_state::<AppExitState>()
        .and_then(|state| state.is_quitting.lock().ok().map(|value| *value))
        .unwrap_or(false)
}

/// Close hides to tray unless the app is already committing to quit.
fn should_hide_to_tray(app: &AppHandle, label: &str) -> bool {
    label == MAIN_WINDOW_LABEL && !is_app_quitting(app)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Build the tray icon with a Show/Quit menu, and show the window on left click.
fn setup_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_ID, "Show rin")
        .separator()
        .text(TRAY_QUIT_ID, "Quit rin")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("rin")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_QUIT_ID => {
                mark_app_quitting(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}

/// Build the application and run the event loop.
pub fn run() {
    let app = tauri::Builder::default()
        // The shell/process plugins are registered for the frontend-driven spawn
        // surface and future sidecar management; the host itself is spawned via
        // std::process::Command in start_host() so its lifetime is owned by one
        // reap path.
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(HostState::default())
        .manage(AppExitState::default())
        .setup(|app| {
            setup_system_tray(app)?;

            if should_spawn_host() {
                let app_handle = app.handle().clone();
                // Host spawn is plain blocking I/O; keep it off the event loop
                // so the window stays responsive while the launcher boots.
                tauri::async_runtime::spawn_blocking(move || {
                    match start_host(&app_handle) {
                        Ok(host) => {
                            if is_app_quitting(&app_handle) {
                                let _ = host.child.kill();
                                return;
                            }
                            if let Some(state) = app_handle.try_state::<HostState>() {
                                if let Ok(mut guard) = state.0.lock() {
                                    *guard = Some(host);
                                }
                            }
                        }
                        Err(err) => {
                            eprintln!("[rin gui] failed to start host: {err}");
                        }
                    }
                });
            } else {
                eprintln!("[rin gui] {NO_SPAWN_ENV} set: connecting to an already-running host at {DEV_URL}");
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if should_hide_to_tray(app_handle, &label) => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            show_main_window(app_handle);
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            mark_app_quitting(app_handle);
            stop_host(app_handle);
        }
        _ => {}
    });
}

fn main() {
    run()
}
