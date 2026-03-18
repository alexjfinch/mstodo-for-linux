#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod auth;

use oauth2::TokenResponse;
use tauri::{Builder, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, generate_handler};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

// Modern Tauri SQL plugin
use tauri_plugin_sql::Builder as SqlBuilder;
use tauri_plugin_store::Builder as StoreBuilder;

/// Public client ID for the Microsoft To Do for Linux Azure AD app registration.
/// This is NOT a secret — it is a public client using PKCE, safe to embed in the binary.
const MS_CLIENT_ID: &str = "2a0ee15b-0a96-44d2-b30d-3cf604947669";

#[derive(serde::Serialize)]
struct TokenPayload {
    access_token: String,
    refresh_token: Option<String>,
}

// Linux: read and watch the system color scheme via the freedesktop portal.
// This works cross-DE (GNOME, KDE, XFCE with xdg-desktop-portal, etc.)
// without relying on DE-specific settings like gsettings or kdeglobals.
#[cfg(target_os = "linux")]
mod portal {
    use futures_util::StreamExt;
    use tauri::{AppHandle, Emitter};
    use zbus::{proxy, Connection};
    use zbus::zvariant::OwnedValue;

    #[proxy(
        interface = "org.freedesktop.portal.Settings",
        default_service = "org.freedesktop.portal.Desktop",
        default_path = "/org/freedesktop/portal/desktop",
        gen_blocking = false
    )]
    trait Settings {
        fn read(&self, namespace: &str, key: &str) -> zbus::Result<OwnedValue>;

        #[zbus(signal)]
        fn setting_changed(
            &self,
            namespace: &str,
            key: &str,
            value: OwnedValue,
        ) -> zbus::Result<()>;
    }

    // Portal color-scheme: 0 = no preference, 1 = prefer dark, 2 = prefer light.
    // The value may be wrapped in one or two variant layers depending on the implementation.
    fn scheme_to_theme(value: &OwnedValue) -> &'static str {
        use zbus::zvariant::Value;
        // OwnedValue derefs to Value<'static>; the portal may wrap the u32 in
        // one or two variant layers depending on the implementation.
        let n = match &**value {
            Value::Value(inner) => match inner.as_ref() {
                Value::U32(n) => *n,
                _ => 0,
            },
            Value::U32(n) => *n,
            _ => 0,
        };
        if n == 1 { "dark" } else { "light" }
    }

    pub async fn get() -> String {
        let Ok(conn) = Connection::session().await else {
            return "light".to_string();
        };
        let Ok(proxy) = SettingsProxy::new(&conn).await else {
            return "light".to_string();
        };
        match proxy.read("org.freedesktop.appearance", "color-scheme").await {
            Ok(v) => scheme_to_theme(&v).to_string(),
            Err(_) => "light".to_string(),
        }
    }

    pub async fn watch(app: AppHandle) {
        let Ok(conn) = Connection::session().await else { return };
        let Ok(proxy) = SettingsProxy::new(&conn).await else { return };
        let Ok(mut stream) = proxy.receive_setting_changed().await else { return };

        while let Some(signal) = stream.next().await {
            let Ok(args) = signal.args() else { continue };
            if args.namespace == "org.freedesktop.appearance" && args.key == "color-scheme" {
                let _ = app.emit("theme-changed", scheme_to_theme(&args.value));
            }
        }
    }
}

#[tauri::command]
async fn get_system_theme() -> String {
    #[cfg(target_os = "linux")]
    return portal::get().await;

    #[cfg(not(target_os = "linux"))]
    "light".to_string()
}

/// Minimal base64 encoder — avoids pulling in the `base64` crate.
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(CHARS[b0 >> 2] as char);
        out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 { CHARS[((b1 & 15) << 2) | (b2 >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[b2 & 63] as char } else { '=' });
    }
    out
}

#[derive(serde::Serialize)]
struct PickedFile {
    name: String,
    content_bytes: String,
}

/// Open the native OS file picker via the XDG desktop portal (respects system
/// dark/light theme) and return the chosen file's name + base64-encoded content.
#[tauri::command]
async fn pick_and_read_file() -> Result<Option<PickedFile>, String> {
    pick_and_read_file_impl().await
}

#[cfg(target_os = "linux")]
async fn pick_and_read_file_impl() -> Result<Option<PickedFile>, String> {
    use ashpd::desktop::file_chooser::OpenFileRequest;

    let request = OpenFileRequest::default()
        .title("Select a file to attach (max 3 MB)")
        .send()
        .await
        .map_err(|e| format!("Failed to open file picker: {e}"))?;

    let files: ashpd::desktop::file_chooser::SelectedFiles = match request.response() {
        Ok(f) => f,
        Err(_) => return Ok(None), // user cancelled
    };

    let uris = files.uris();
    if uris.is_empty() {
        return Ok(None);
    }

    let path = uris[0]
        .to_file_path()
        .map_err(|_| "Not a local file URI".to_string())?;

    let name = path
        .file_name()
        .and_then(|n: &std::ffi::OsStr| n.to_str())
        .unwrap_or("attachment")
        .to_string();

    // Check file size BEFORE reading to avoid OOM on large files
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;

    if metadata.len() > 3 * 1024 * 1024 {
        return Err("File exceeds the 3 MB limit".to_string());
    }

    let bytes: Vec<u8> = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;

    // Re-check size after read to mitigate TOCTOU race (file could have grown)
    if bytes.len() > 3 * 1024 * 1024 {
        return Err("File exceeds the 3 MB limit".to_string());
    }

    Ok(Some(PickedFile { name, content_bytes: base64_encode(&bytes) }))
}

#[cfg(not(target_os = "linux"))]
async fn pick_and_read_file_impl() -> Result<Option<PickedFile>, String> {
    Err("Native file picker only supported on Linux".to_string())
}

#[tauri::command]
async fn refresh_token(refresh_token: String) -> Result<TokenPayload, String> {
    let client = auth::build_oauth_client(MS_CLIENT_ID.to_string());

    let token = client
        .exchange_refresh_token(&oauth2::RefreshToken::new(refresh_token))
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| format!("Token refresh failed: {e}"))?;

    Ok(TokenPayload {
        access_token: token.access_token().secret().to_string(),
        refresh_token: token.refresh_token().map(|r| r.secret().to_string()),
    })
}

#[tauri::command]
async fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn update_tray_status(app: tauri::AppHandle, status: String) -> Result<(), String> {
    let png_bytes: &[u8] = match status.as_str() {
        "syncing" => include_bytes!("../icons/tray-syncing.png"),
        "offline" => include_bytes!("../icons/tray-offline.png"),
        _ => include_bytes!("../icons/tray-synced.png"),
    };
    let icon = tauri::image::Image::from_bytes(png_bytes).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Logging ──────────────────────────────────────────────────────────

const MAX_LOG_SIZE: u64 = 2 * 1024 * 1024; // 2 MB

fn get_log_path() -> std::path::PathBuf {
    let base = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .unwrap_or_else(|| std::env::temp_dir());
    let dir = base.join("io.github.alexjfinch.mstodo-for-linux");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("app.log")
}

/// Simple rate limiter: allow at most 100 log writes per second to prevent frontend flooding.
static LOG_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static LOG_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[tauri::command]
async fn write_log(level: String, message: String) -> Result<(), String> {
    // Rate-limit: max 100 log writes per second
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let prev_epoch = LOG_EPOCH.load(std::sync::atomic::Ordering::SeqCst);
    if now_secs != prev_epoch {
        LOG_EPOCH.store(now_secs, std::sync::atomic::Ordering::SeqCst);
        LOG_COUNT.store(1, std::sync::atomic::Ordering::SeqCst);
    } else {
        let count = LOG_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if count >= 100 {
            return Ok(()); // silently drop excess log messages
        }
    }

    tokio::task::spawn_blocking(move || {
        use std::io::Write;

        let path = get_log_path();

        // Rotate if file exceeds max size
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > MAX_LOG_SIZE {
                let prev = path.with_extension("log.old");
                let _ = std::fs::rename(&path, &prev);
            }
        }

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{}] [{}] {}\n", timestamp, level, message);

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("Failed to open log file: {e}"))?;

        file.write_all(line.as_bytes())
            .map_err(|e| format!("Failed to write log: {e}"))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
async fn get_log_path_cmd() -> String {
    get_log_path().to_string_lossy().to_string()
}

// ── Keyring ──────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "io.github.alexjfinch.mstodo-for-linux";

#[tauri::command]
async fn keyring_set(account: String, key: String, value: String) -> Result<(), String> {
    let entry_key = format!("{}:{}", account, key);
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &entry_key)
            .map_err(|e| format!("Keyring entry error: {e}"))?;
        entry.set_password(&value)
            .map_err(|e| format!("Keyring set error: {e}"))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
async fn keyring_get(account: String, key: String) -> Result<Option<String>, String> {
    let entry_key = format!("{}:{}", account, key);
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &entry_key)
            .map_err(|e| format!("Keyring entry error: {e}"))?;
        match entry.get_password() {
            Ok(val) => Ok(Some(val)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Keyring get error: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
async fn keyring_delete(account: String, key: String) -> Result<(), String> {
    let entry_key = format!("{}:{}", account, key);
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &entry_key)
            .map_err(|e| format!("Keyring entry error: {e}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // already gone
            Err(e) => Err(format!("Keyring delete error: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ── Autostart ─────────────────────────────────────────────────────────

const AUTOSTART_DESKTOP_ENTRY: &str = "\
[Desktop Entry]\n\
Type=Application\n\
Name=Microsoft To Do\n\
Exec=mstodo-for-linux\n\
Icon=mstodo-for-linux\n\
Comment=An Unofficial Microsoft To Do Client for Linux\n\
X-GNOME-Autostart-enabled=true\n\
StartupNotify=false\n";

fn autostart_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|c| c.join("autostart").join("mstodo-for-linux.desktop"))
}

#[tauri::command]
async fn get_autostart_enabled() -> Result<bool, String> {
    Ok(autostart_path().map_or(false, |p| p.exists()))
}

#[tauri::command]
async fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let path = autostart_path().ok_or("Could not determine config directory")?;
    if enabled {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create autostart directory: {e}"))?;
        }
        std::fs::write(&path, AUTOSTART_DESKTOP_ENTRY)
            .map_err(|e| format!("Failed to write autostart file: {e}"))?;
    } else if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove autostart file: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn sign_in() -> Result<TokenPayload, String> {
    // start_auth_flow blocks on server.recv() waiting for the OAuth callback,
    // so run it on a blocking thread to avoid stalling the async runtime.
    let code = tokio::task::spawn_blocking(|| {
        auth::start_auth_flow(MS_CLIENT_ID.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map_err(|e| format!("Failed to start auth flow: {e}"))?;

    let verifier = auth::take_pkce_verifier()
        .map_err(|e| format!("Failed to retrieve PKCE verifier: {e}"))?;
    let client = auth::build_oauth_client(MS_CLIENT_ID.to_string());

    let token = client
        .exchange_code(code)
        .set_pkce_verifier(verifier)
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| format!("Token exchange failed: {e}"))?;

    Ok(TokenPayload {
        access_token: token.access_token().secret().to_string(),
        refresh_token: token.refresh_token().map(|r| r.secret().to_string()),
    })
}

/// Returns the path of the FIFO created.
/// Spawns a background thread that blocks on the FIFO and calls open_quick_add
/// whenever any data arrives (used as an IPC channel from DE-registered shortcuts).
fn setup_quickadd_fifo(app_handle: tauri::AppHandle) -> String {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    let fifo_path = format!("{}/mstodo-quickadd", runtime_dir);

    // Create the FIFO (ignore error if it already exists)
    let _ = std::process::Command::new("mkfifo").arg(&fifo_path).status();

    let path = fifo_path.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        loop {
            // open() blocks until a writer opens the other end
            match std::fs::File::open(&path) {
                Ok(mut file) => {
                    let mut buf = Vec::new();
                    let _ = file.read_to_end(&mut buf);
                    if !buf.is_empty() {
                        open_quick_add(&app_handle);
                    }
                }
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        }
    });

    fifo_path
}

/// Registers a GNOME custom keybinding (Super+Shift+T) that writes to the IPC FIFO.
/// Detects GNOME via XDG_CURRENT_DESKTOP. Safe to call on non-GNOME DEs (no-op).
fn register_gnome_shortcut(fifo_path: &str) {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    if !desktop.contains("gnome") && !desktop.contains("unity") && !desktop.contains("budgie") {
        return;
    }

    let binding_path = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mstodo/";
    let command = format!("bash -c 'echo q > {}'", fifo_path);

    // Fetch current custom-keybindings list and append our path if absent
    let current = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if !current.contains(binding_path) {
        let new_list = if current.trim() == "@as []" || current.trim() == "[]" {
            format!("['{}']", binding_path)
        } else if let Some(pos) = current.rfind(']') {
            let prefix = current[..pos].trim_end_matches(',').trim();
            if prefix.trim_end() == "[" {
                format!("['{}']", binding_path)
            } else {
                format!("{}, '{}']", prefix, binding_path)
            }
        } else {
            format!("['{}']", binding_path)
        };
        let _ = std::process::Command::new("gsettings")
            .args(["set", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings", &new_list])
            .status();
    }

    let base = format!(
        "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:{}",
        binding_path
    );
    let _ = std::process::Command::new("gsettings").args(["set", &base, "name", "MS Todo Quick Add"]).status();
    let _ = std::process::Command::new("gsettings").args(["set", &base, "binding", "<Super><Shift>t"]).status();
    let _ = std::process::Command::new("gsettings").args(["set", &base, "command", &command]).status();
}

fn open_quick_add(app: &tauri::AppHandle) {
    // If already open, just focus it
    if let Some(win) = app.get_webview_window("quickadd") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let url = WebviewUrl::App("quickadd.html".into());
    let _ = WebviewWindowBuilder::new(app, "quickadd", url)
        .title("Quick Add Task")
        .inner_size(480.0, 148.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .center()
        .focused(true)
        .build();
}

fn main() {
    // Build Tauri application
    Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(portal::watch(handle));
            }

            // Build system tray context menu
            // Use MenuItemBuilder to work around GNOME AppIndicator text rendering issues
            let show_hide = MenuItemBuilder::with_id("show_hide", "Open Window").enabled(true).build(app)?;
            let add_task = MenuItemBuilder::with_id("add_task", "Quick Add Task").enabled(true).build(app)?;
            let sync_now = MenuItemBuilder::with_id("sync_now", "Sync Now").enabled(true).build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").enabled(true).build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_hide)
                .item(&add_task)
                .item(&sync_now)
                .item(&separator)
                .item(&quit)
                .build()?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-synced.png"),
            ).map_err(|e| format!("Failed to load tray icon: {e}"))?;

            // Set window icon for taskbar / alt-tab switcher
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(win_icon) = tauri::image::Image::from_bytes(
                    include_bytes!("../icons/128x128.png"),
                ) {
                    let _ = win.set_icon(win_icon);
                }
            }

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .tooltip("Microsoft To Do")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show_hide" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                        "add_task" => {
                            open_quick_add(app);
                        }
                        "sync_now" => {
                            let _ = app.emit("tray-sync", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Set up IPC FIFO for DE-registered shortcut fallback (Wayland / GNOME etc.)
            let fifo_path = setup_quickadd_fifo(app.handle().clone());

            // Register global shortcut: Super+Shift+T to open quick-add (works on X11)
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyT);
            let handle = app.handle().clone();
            if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    open_quick_add(&handle);
                }
            }) {
                eprintln!("Warning: failed to register global shortcut (likely Wayland): {e}");
            }

            // Also register via GNOME gsettings so it works on Wayland / GNOME Shell
            register_gnome_shortcut(&fifo_path);

            Ok(())
        })
        // Global shortcut plugin
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Dialog plugin (native file picker)
        .plugin(tauri_plugin_dialog::init())
        // Store plugin
        .plugin(StoreBuilder::default().build())
        // Notification plugin (desktop notifications for due-date reminders)
        .plugin(tauri_plugin_notification::init())
        // SQL plugin: ensures the JS API is injected and DBs defined in tauri.conf.json are ready
        .plugin(
            SqlBuilder::default()
                .build()
        )
        // Register commands
        .invoke_handler(generate_handler![sign_in, refresh_token, get_system_theme, pick_and_read_file, update_tray_tooltip, update_tray_status, keyring_set, keyring_get, keyring_delete, write_log, get_log_path_cmd, get_autostart_enabled, set_autostart_enabled])
        // Run the app
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
