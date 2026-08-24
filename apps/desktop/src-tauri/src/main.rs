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
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_updater::UpdaterExt;

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
/// Opt-in flag used by the release E2E to exercise the signed updater.
const UPDATER_E2E_ENV: &str = "RIN_UPDATER_E2E";
/// Optional diagnostic sink used by clean-machine E2E jobs.
const HOST_LOG_ENV: &str = "RIN_HOST_LOG_PATH";

fn log_host_event(message: &str, log_path: Option<&Path>) {
    eprintln!("{message}");
    if let Some(path) = log_path {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerConnection {
    url: String,
    auth_token: String,
}

#[tauri::command]
fn get_server_connection() -> ServerConnection {
    ServerConnection {
        url: format!("{DEV_URL}/api"),
        auth_token: String::new(),
    }
}

/// A host spawned through Tauri's shell plugin.
struct HostProcess {
    child: CommandChild,
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

/// Packaged sidecar arguments after the entry.mjs path. The target-platform
/// Node runtime then receives the "web" subcommand and host bind arguments.
fn sidecar_args() -> [&'static str; 5] {
    ["web", "--port", HOST_PORT, "--host", HOST_HOST]
}

/// Resolve the entrypoint shipped in Tauri's resource directory.
///
/// Release sidecars are target-platform Node executables. The executable
/// receives this JavaScript module as argv[1], which preserves native Node's
/// dynamic-import and module-resolution behavior.
fn packaged_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve packaged resource directory: {err}"))?;
    let runtime_dir = resource_dir.join("sidecar-runtime");
    let entry = runtime_dir.join("entry.mjs");
    if !entry.is_file() {
        return Err(format!(
            "packaged sidecar entrypoint is missing: {}",
            entry.display()
        ));
    }
    Ok(runtime_dir)
}

/// Spawn the host and return its handle.
///
/// Development resolves an arbitrary `rin` command; release uses Tauri's
/// authoritative externalBin resolver for the packaged `rin-sidecar`.
fn start_host(app: &AppHandle) -> Result<HostProcess, String> {
    let log_path = std::env::var_os(HOST_LOG_ENV).map(PathBuf::from);
    let (command, args, label) = if tauri::is_dev() {
        let program = std::env::var(HOST_CMD_ENV).unwrap_or_else(|_| "rin".to_string());
        (
            app.shell().command(&program),
            dev_host_args()
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>(),
            program,
        )
    } else {
        let runtime_dir = packaged_runtime(app)?;
        let mut args = sidecar_args()
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        // Keep the Node entrypoint relative to its working directory. In
        // particular, this avoids drive-qualified Windows paths being reduced
        // to the bare drive (for example `D:`) by the sidecar launch boundary.
        args.insert(0, "entry.mjs".to_string());
        (
            app.shell()
                .sidecar("rin-sidecar")
                .map_err(|err| format!("resolve packaged rin-sidecar: {err}"))?
                .current_dir(runtime_dir),
            args,
            "rin-sidecar".to_string(),
        )
    };
    let (mut events, child) = command
        .args(args)
        .env("RIN_PARENT_PID", std::process::id().to_string())
        .spawn()
        .map_err(|err| format!("spawn host {label}: {err}"))?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    log_host_event(
                        &format!("[rin host] {}", String::from_utf8_lossy(&bytes)),
                        log_path.as_deref(),
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    log_host_event(
                        &format!("[rin host stderr] {}", String::from_utf8_lossy(&bytes)),
                        log_path.as_deref(),
                    );
                }
                CommandEvent::Error(error) => {
                    log_host_event(
                        &format!("[rin host] process error: {error}"),
                        log_path.as_deref(),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    log_host_event(
                        &format!("[rin host] terminated: {:?}", payload.code),
                        log_path.as_deref(),
                    );
                }
                _ => {}
            }
        }
    });
    Ok(HostProcess { child })
}

/// Stop and reap the host child, if one is running.
fn stop_host(app: &AppHandle) {
    if let Some(state) = app.try_state::<HostState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(host) = guard.take() {
                let _ = host.child.kill();
            }
        }
    }
}

/// Whether the shell should spawn a host, or connect to a running one.
fn should_spawn_host() -> bool {
    match std::env::var(NO_SPAWN_ENV) {
        Ok(value) => !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => true,
    }
}

fn updater_e2e_enabled() -> bool {
    match std::env::var(UPDATER_E2E_ENV) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

async fn run_updater_e2e(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        eprintln!(
            "[rin updater] installing {} over {}",
            update.version, update.current_version
        );
        update.download_and_install(|_, _| {}, || {}).await?;
        eprintln!("[rin updater] update installed; restarting");
        app.restart();
    } else {
        eprintln!("[rin updater] no newer signed update is available");
    }
    Ok(())
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
        .plugin(tauri_plugin_shell::init())
        // The release overlay supplies the updater public key. Keeping the
        // plugin registered in every build means the same desktop binary can
        // use the official updater APIs once a signed release is published;
        // no private signing material is embedded here.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_server_connection])
        .manage(HostState::default())
        .manage(AppExitState::default())
        .setup(|app| {
            setup_system_tray(app)?;

            if updater_e2e_enabled() {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = run_updater_e2e(app_handle).await {
                        eprintln!("[rin updater] E2E update failed: {err}");
                    }
                });
            }

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
                            let log_path = std::env::var_os(HOST_LOG_ENV).map(PathBuf::from);
                            log_host_event(
                                &format!("[rin gui] failed to start host: {err}"),
                                log_path.as_deref(),
                            );
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

#[cfg(test)]
mod tests {
    use super::{dev_host_args, sidecar_args};

    #[test]
    fn host_entrypoints_use_the_real_web_subcommand() {
        let expected = ["web", "--port", "8320", "--host", "127.0.0.1"];
        assert_eq!(dev_host_args(), expected);
        assert_eq!(sidecar_args(), expected);
    }
}
