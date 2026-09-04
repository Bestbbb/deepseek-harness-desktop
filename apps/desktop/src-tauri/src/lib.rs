//! Harness Desktop application host for DeepSeek Harness.

mod bridge;
mod diagnostics;
mod navigation;
mod runtime;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bridge::DesktopBridge;
use navigation::RuntimeNavigation;
use rand::RngCore;
use runtime::{RuntimeConfig, RuntimeEvent, RuntimeSupervisor};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewWindowBuilder,
};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

struct DesktopState {
    runtime: Mutex<Option<RuntimeSupervisor>>,
    bridge: Mutex<Option<DesktopBridge>>,
}

#[derive(Clone)]
struct RuntimePaths {
    node: PathBuf,
    entry: PathBuf,
    patch: PathBuf,
    working_directory: PathBuf,
    desktop_native_entry: PathBuf,
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin({
            #[cfg(target_os = "macos")]
            {
                tauri_plugin_autostart::Builder::new()
                    .macos_launcher(MacosLauncher::LaunchAgent)
                    .build()
            }
            #[cfg(not(target_os = "macos"))]
            {
                tauri_plugin_autostart::Builder::new().build()
            }
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(setup);
    let app = builder
        .build(tauri::generate_context!())
        .expect("could not build Harness Desktop");
    let signal_app = app.handle().clone();
    ctrlc::set_handler(move || signal_app.exit(0))
        .expect("could not install desktop termination handler");
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            shutdown(app);
        }
    });
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let bridge_token = random_token();
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or("the desktop configuration must declare the main window")?;
    let navigation = Arc::new(Mutex::new(RuntimeNavigation::default()));
    let page_navigation = navigation.clone();
    let window = WebviewWindowBuilder::from_config(app, window_config)?
        .on_page_load(move |_, payload| {
            if let Ok(mut state) = page_navigation.lock() {
                state.page_load(payload.event(), payload.url());
            }
        })
        .build()?;
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_window.hide();
        }
    });
    install_menu(app.handle())?;
    install_tray(app.handle())?;
    let bridge = DesktopBridge::start(app.handle().clone(), bridge_token.clone())?;
    let paths = runtime_paths(app.handle())?;
    let dsh_home = app.path().app_data_dir()?.join("harness");
    std::fs::create_dir_all(&dsh_home)?;
    let app_handle = app.handle().clone();
    let publish: Arc<dyn Fn(RuntimeEvent) + Send + Sync> = Arc::new(move |event| match event {
        RuntimeEvent::Ready(url) => {
            let should_navigate = navigation
                .lock()
                .map(|mut state| state.runtime_ready(&url))
                .unwrap_or(true);
            if !should_navigate {
                return;
            }
            if let Some(window) = app_handle.get_webview_window("main") {
                if window.navigate(url).is_err() {
                    if let Ok(mut state) = navigation.lock() {
                        state.navigation_failed();
                    }
                    log::error!(target: "dsh_runtime", "Could not navigate to the Harness runtime");
                }
            }
        }
        RuntimeEvent::Error(message) => {
            log::error!(target: "dsh_runtime", "{message}");
            if let Some(window) = app_handle.get_webview_window("main") {
                let detail = serde_json::to_string(&message)
                    .unwrap_or_else(|_| "\"Unknown runtime error\"".to_owned());
                let _ = window.eval(format!(
                    "dispatchEvent(new CustomEvent('dsh-desktop-runtime-error', {{ detail: {detail} }}));",
                ));
            }
        }
        RuntimeEvent::Log(line) => log::info!(target: "dsh_runtime", "{line}"),
    });
    let runtime = RuntimeSupervisor::start(
        RuntimeConfig {
            node: paths.node,
            entry: paths.entry,
            patch: paths.patch,
            working_directory: paths.working_directory,
            desktop_native_entry: paths.desktop_native_entry,
            dsh_home,
            bridge_url: bridge.url.clone(),
            bridge_token,
        },
        publish,
    );
    app.manage(DesktopState {
        runtime: Mutex::new(Some(runtime)),
        bridge: Mutex::new(Some(bridge)),
    });
    Ok(())
}

fn runtime_paths(app: &AppHandle) -> Result<RuntimePaths, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()?;
        return Ok(RuntimePaths {
            node: std::env::var_os("DSH_DESKTOP_NODE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("node")),
            entry: root.join("apps/cli/lib/bin.js"),
            patch: root.join("apps/desktop/runtime/desktop.cordis.yml"),
            working_directory: root.clone(),
            desktop_native_entry: root.join("packages/desktop/desktop-native/lib/index.js"),
        });
    }
    let runtime = app.path().resource_dir()?.join("runtime");
    let node = runtime
        .join("node")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    Ok(RuntimePaths {
        node,
        entry: runtime.join("app/node_modules/@deepseek-ai/dsh/lib/bin.js"),
        patch: runtime.join("desktop.cordis.yml"),
        working_directory: runtime.join("app"),
        desktop_native_entry: runtime
            .join("app/node_modules/@deepseek-ai/dsh-desktop-native/lib/index.js"),
    })
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let new_session = MenuItemBuilder::with_id("new-session", "New Session")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let export_diagnostics_item =
        MenuItemBuilder::with_id("export-diagnostics", "Export Diagnostics…").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Show Harness Desktop").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Harness Desktop")
        .item(&show)
        .separator()
        .item(&settings)
        .item(&export_diagnostics_item)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new_session)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    // macOS menu bars accept only submenus; keep that restriction type-checked.
    let submenus: &[&Submenu<_>] = &[&app_menu, &file, &edit, &window];
    let mut menu = MenuBuilder::new(app);
    for submenu in submenus {
        menu = menu.item(*submenu);
    }
    app.set_menu(menu.build()?)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "show" => {
            let _ = show_main_window(app);
        }
        "new-session" => eval_main(
            app,
            "dispatchEvent(new CustomEvent('dsh-desktop-new-session'))",
        ),
        "settings" => eval_main(
            app,
            "dispatchEvent(new CustomEvent('dsh-desktop-open-settings'))",
        ),
        "export-diagnostics" => export_diagnostics(app),
        _ => {}
    });
    Ok(())
}

fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray-show", "Show Harness Desktop").build(app)?;
    let quit = MenuItemBuilder::with_id("tray-quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                let _ = show_main_window(app);
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

fn eval_main(app: &AppHandle, script: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(script);
    }
}

fn export_diagnostics(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .set_title("Export Harness Desktop Diagnostics")
        .set_file_name("DeepSeek-Harness-diagnostics.txt")
        .add_filter("Text", &["txt"])
        .save_file(move |destination| {
            let Some(destination) = destination else {
                return;
            };
            let result = destination
                .into_path()
                .map_err(|error| error.to_string())
                .and_then(|path| {
                    diagnostics::collect(&handle).and_then(|contents| {
                        std::fs::write(path, contents).map_err(|error| error.to_string())
                    })
                });
            let (title, body) = match result {
                Ok(()) => (
                    "Diagnostics exported",
                    "The redacted diagnostic file is ready.",
                ),
                Err(_) => (
                    "Diagnostics export failed",
                    "Harness Desktop could not write the diagnostic file.",
                ),
            };
            let _ = handle
                .notification()
                .builder()
                .title(title)
                .body(body)
                .show();
        });
}

fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<DesktopState>() {
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.take();
        }
        if let Ok(mut bridge) = state.bridge.lock() {
            bridge.take();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn main_window_preserves_browser_file_drops_and_setup_owned_creation() {
        let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("the shipped Tauri configuration must parse");
        let window = config
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .expect("the main window must be configured");
        assert!(
            !window.drag_drop_enabled,
            "HTML5 file drops need the native handler disabled"
        );
        assert!(!window.create, "setup owns main-window creation");
        assert!(
            window.visible,
            "the loading window must be immediately visible"
        );
    }
}
