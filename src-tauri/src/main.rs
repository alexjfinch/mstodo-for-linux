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

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid base64 content: {e}"))
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
        Err(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)) => return Ok(None),
        Err(e) => return Err(format!("File picker failed: {e}")),
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

/// Open the native "Save As" dialog via the XDG desktop portal and write `content`
/// to the chosen file. Returns false if the user cancelled. Writing happens here
/// rather than in the frontend so the webview never needs filesystem permissions.
#[tauri::command]
async fn save_text_file(default_name: String, content: String) -> Result<bool, String> {
    save_file_impl("Export tasks", default_name, content.into_bytes()).await
}

/// Save a task attachment (base64-encoded, as returned by the Graph API) via the
/// native "Save As" dialog. Returns false if the user cancelled.
#[tauri::command]
async fn save_attachment(default_name: String, content_bytes: String) -> Result<bool, String> {
    let bytes = base64_decode(&content_bytes)?;
    save_file_impl("Save attachment", default_name, bytes).await
}

#[cfg(target_os = "linux")]
async fn save_file_impl(title: &str, default_name: String, content: Vec<u8>) -> Result<bool, String> {
    use ashpd::desktop::file_chooser::SaveFileRequest;

    let request = SaveFileRequest::default()
        .title(title)
        .current_name(default_name.as_str())
        .send()
        .await
        .map_err(|e| format!("Failed to open save dialog: {e}"))?;

    let files = match request.response() {
        Ok(f) => f,
        Err(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)) => return Ok(false),
        Err(e) => return Err(format!("Save dialog failed: {e}")),
    };

    let Some(uri) = files.uris().first() else {
        return Ok(false);
    };
    let path = uri
        .to_file_path()
        .map_err(|_| "Not a local file URI".to_string())?;

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(true)
}

#[cfg(not(target_os = "linux"))]
async fn save_file_impl(_title: &str, _default_name: String, _content: Vec<u8>) -> Result<bool, String> {
    Err("Native save dialog only supported on Linux".to_string())
}

/// Open a link from task notes or a task's linked resource (e.g. the Outlook email behind
/// a flagged-email task) in the default browser or mail client. These URLs come from Graph
/// data that other people can edit via shared lists, so only web and mailto links are opened.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    open::that_detached(url.as_str()).map_err(|e| format!("Failed to open link: {e}"))
}

fn validate_external_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid link: {e}"))?;
    match parsed.scheme() {
        "https" | "http" | "mailto" => Ok(parsed),
        other => Err(format!("Refusing to open a {other}: link")),
    }
}

#[tauri::command]
async fn refresh_token(refresh_token: String) -> Result<TokenPayload, String> {
    let client = auth::build_oauth_client(MS_CLIENT_ID.to_string(), None);
    let http_client = auth::build_http_client()?;

    let token = client
        .exchange_refresh_token(&oauth2::RefreshToken::new(refresh_token))
        .request_async(&http_client)
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
const MAX_LOG_MESSAGE_LEN: usize = 16 * 1024; // 16 KB per entry

/// Normalise a frontend-supplied log entry: restrict the level to known values,
/// cap the message length, and indent continuation lines (e.g. stack traces) so a
/// message cannot forge what looks like a separate log entry.
fn sanitize_log_entry(level: &str, message: &str) -> (&'static str, String) {
    let level = match level {
        "error" => "error",
        "warn" => "warn",
        "debug" => "debug",
        _ => "info",
    };
    let mut end = message.len().min(MAX_LOG_MESSAGE_LEN);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    let truncated = end < message.len();
    let mut message = message[..end].replace("\r\n", "\n").replace('\r', "\n").replace('\n', "\n    ");
    if truncated {
        message.push_str(" [truncated]");
    }
    (level, message)
}

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
static LOG_DROPPED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[tauri::command]
async fn write_log(level: String, message: String) -> Result<(), String> {
    // Rate-limit: max 100 log writes per second
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let prev_epoch = LOG_EPOCH.load(std::sync::atomic::Ordering::SeqCst);
    if now_secs != prev_epoch {
        // New second — attempt to flip the epoch with a CAS so only one thread handles the reset.
        if LOG_EPOCH.compare_exchange(
            prev_epoch, now_secs,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        ).is_ok() {
            // This thread won the flip — flush the dropped-message summary and reset the counter.
            let dropped = LOG_DROPPED.swap(0, std::sync::atomic::Ordering::SeqCst);
            LOG_COUNT.store(1, std::sync::atomic::Ordering::SeqCst);
            if dropped > 0 {
                let path = get_log_path();
                let _ = std::fs::OpenOptions::new().create(true).append(true).open(&path).map(|mut f| {
                    use std::io::Write;
                    let _ = write!(f, "[WARN] {} log message(s) were dropped due to rate limiting\n", dropped);
                });
            }
        } else {
            // Another thread already flipped the epoch; fall through to the normal count path.
            let count = LOG_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if count >= 100 {
                LOG_DROPPED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                return Ok(());
            }
        }
    } else {
        let count = LOG_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if count >= 100 {
            LOG_DROPPED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            return Ok(());
        }
    }

    tokio::task::spawn_blocking(move || {
        use std::io::Write;

        let path = get_log_path();

        // Rotate if file exceeds max size
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > MAX_LOG_SIZE {
                let prev = path.with_extension("log.old");
                if std::fs::rename(&path, &prev).is_err() {
                    let _ = std::fs::File::create(&path);
                }
            }
        }

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let (level, message) = sanitize_log_entry(&level, &message);
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

fn is_flatpak() -> bool {
    std::path::Path::new("/.flatpak-info").exists()
}

/// Inside the Flatpak, logins are kept in an app-private keyring file encrypted with a key
/// from the Secret portal, so other apps can't read them. If the portal fails (some KDE
/// releases have had bugs here), this returns None and the desktop keyring over D-Bus is
/// used for the rest of the session instead. Outside the Flatpak it always returns None.
async fn sandbox_keyring() -> Option<&'static oo7::Keyring> {
    static KEYRING: tokio::sync::OnceCell<Option<oo7::Keyring>> = tokio::sync::OnceCell::const_new();
    if !is_flatpak() {
        return None;
    }
    KEYRING
        .get_or_init(|| async {
            let keyring = match oo7::Keyring::new().await {
                Ok(keyring) => keyring,
                Err(e) => {
                    eprintln!("Warning: Secret portal unavailable, using the desktop keyring: {e}");
                    return None;
                }
            };
            match keyring.unlock().await {
                Ok(()) => Some(keyring),
                Err(e) => {
                    eprintln!("Warning: could not unlock the app keyring, using the desktop keyring: {e}");
                    None
                }
            }
        })
        .await
        .as_ref()
}

fn sandbox_keyring_attributes(entry_key: &str) -> [(&'static str, &str); 2] {
    [("service", KEYRING_SERVICE), ("username", entry_key)]
}

#[tauri::command]
async fn keyring_set(account: String, key: String, value: String) -> Result<(), String> {
    let entry_key = format!("{}:{}", account, key);
    if let Some(keyring) = sandbox_keyring().await {
        return keyring
            .create_item(&entry_key, &sandbox_keyring_attributes(&entry_key), value, true)
            .await
            .map_err(|e| format!("Keyring set error: {e}"));
    }
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
    if let Some(keyring) = sandbox_keyring().await {
        let items = keyring
            .search_items(&sandbox_keyring_attributes(&entry_key))
            .await
            .map_err(|e| format!("Keyring get error: {e}"))?;
        let Some(item) = items.first() else {
            return Ok(None);
        };
        let secret = item.secret().await.map_err(|e| format!("Keyring get error: {e}"))?;
        return String::from_utf8(secret.as_bytes().to_vec())
            .map(Some)
            .map_err(|e| format!("Keyring get error: {e}"));
    }
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
    if let Some(keyring) = sandbox_keyring().await {
        return keyring
            .delete(&sandbox_keyring_attributes(&entry_key))
            .await
            .map_err(|e| format!("Keyring delete error: {e}"));
    }
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

/// Passed by the autostart entry so the app can tell a login start from a normal launch.
const AUTOSTART_ARG: &str = "--autostart";

const AUTOSTART_DESKTOP_ENTRY: &str = "\
[Desktop Entry]\n\
Type=Application\n\
Name=Microsoft To Do\n\
Exec=mstodo-for-linux --autostart\n\
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

/// Inside the Flatpak, the autostart file written below lands in the sandbox's own config
/// dir, where the desktop never looks, so the Background portal creates the real autostart
/// entry. The portal can't be asked for the current state, so the file is still written as
/// the app's record of the setting.
#[cfg(target_os = "linux")]
async fn request_portal_autostart(enabled: bool) -> Result<(), String> {
    use ashpd::desktop::background::Background;
    let response = Background::request()
        .reason("Start Microsoft To Do when you log in")
        .auto_start(enabled)
        .command(["mstodo-for-linux", AUTOSTART_ARG])
        .dbus_activatable(false)
        .send()
        .await
        .map_err(|e| format!("Failed to request autostart: {e}"))?
        .response()
        .map_err(|e| format!("Autostart was not allowed: {e}"))?;
    if enabled && !response.auto_start() {
        return Err("Autostart was not allowed".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn request_portal_autostart(_enabled: bool) -> Result<(), String> {
    Err("The Background portal is only supported on Linux".to_string())
}

#[tauri::command]
async fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    if is_flatpak() {
        request_portal_autostart(enabled).await?;
    }
    let path = autostart_path().ok_or("Could not determine config directory")?;
    if enabled {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create autostart directory: {e}"))?;
        }
        std::fs::write(&path, AUTOSTART_DESKTOP_ENTRY)
            .map_err(|e| format!("Failed to write autostart file: {e}"))?;
    } else {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Failed to remove autostart file: {e}")),
        }
    }
    Ok(())
}

/// Entries written before 0.1.15 start the app without AUTOSTART_ARG, so it couldn't start
/// minimised at login. Rewrite them (in the Flatpak, this re-requests the portal entry).
async fn upgrade_autostart_entry() {
    let Some(path) = autostart_path() else { return };
    let Ok(entry) = std::fs::read_to_string(&path) else { return };
    if !entry.contains(AUTOSTART_ARG) {
        if let Err(e) = set_autostart_enabled(true).await {
            eprintln!("Warning: could not update the autostart entry: {e}");
        }
    }
}

/// The "Start minimised" setting, which the frontend keeps in settings.json (on by default).
fn start_minimized_setting(app: &tauri::AppHandle) -> bool {
    let settings = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("settings.json")).ok());
    start_minimized_from_settings(settings.as_deref())
}

fn start_minimized_from_settings(settings: Option<&str>) -> bool {
    settings
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.get("startMinimized")?.as_bool())
        .unwrap_or(true)
}

/// Whether a tray host is running to restore a minimised window from. Stock GNOME has none
/// without the AppIndicator extension, and starting hidden there would leave no visible app.
#[cfg(target_os = "linux")]
async fn tray_available() -> bool {
    let Ok(conn) = zbus::Connection::session().await else { return false };
    let Ok(dbus) = zbus::fdo::DBusProxy::new(&conn).await else { return false };
    let Ok(watcher) = zbus::names::BusName::try_from("org.kde.StatusNotifierWatcher") else {
        return false;
    };
    dbus.name_has_owner(watcher).await.unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
async fn tray_available() -> bool {
    true
}

#[tauri::command]
async fn sign_in() -> Result<TokenPayload, String> {
    // start_auth_flow blocks on server.recv() waiting for the OAuth callback,
    // so run it on a blocking thread to avoid stalling the async runtime.
    // The verifier is returned directly alongside the code — no global state needed.
    let (code, verifier, redirect_port) = tokio::task::spawn_blocking(|| {
        auth::start_auth_flow(MS_CLIENT_ID.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map_err(|e| format!("Failed to start auth flow: {e}"))?;

    let client = auth::build_oauth_client(MS_CLIENT_ID.to_string(), Some(redirect_port));
    let http_client = auth::build_http_client()?;

    let token = client
        .exchange_code(code)
        .set_pkce_verifier(verifier)
        .request_async(&http_client)
        .await
        .map_err(|e| format!("Token exchange failed: {e}"))?;

    Ok(TokenPayload {
        access_token: token.access_token().secret().to_string(),
        refresh_token: token.refresh_token().map(|r| r.secret().to_string()),
    })
}

/// Returns the path of the FIFO created, or an empty string if setup failed.
/// Spawns a background thread that blocks on the FIFO and calls open_quick_add
/// whenever any data arrives (used as an IPC channel from DE-registered shortcuts).
/// The thread exits when `shutdown` is set to true.
fn setup_quickadd_fifo(app_handle: tauri::AppHandle, shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>) -> String {
    // Prefer XDG_RUNTIME_DIR (mode 700, user-only) so the FIFO is not world-readable.
    // Fall back to XDG data-local dir, then /tmp only as last resort.
    // When falling back to /tmp (world-readable), mix the PID with sub-second time to
    // produce an unpredictable name — the ownership check below is the primary defence,
    // but an unguessable name also prevents pre-creation denial-of-service attacks.
    let fifo_path = dirs::runtime_dir()
        .or_else(|| dirs::data_local_dir())
        .map(|p| p.join("mstodo-quickadd").to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            let nonce = (std::process::id() as u64)
                .wrapping_mul(0x9e3779b97f4a7c15)
                ^ (nanos as u64);
            format!("/tmp/mstodo-quickadd-{:016x}", nonce)
        });

    // Create the FIFO unless something is already at the path (usually the FIFO left from a
    // previous run). Checking first avoids mkfifo printing "File exists" on every start.
    if std::fs::symlink_metadata(&fifo_path).is_ok() || !make_fifo(&fifo_path) {
        // File already exists — verify it is owned by the current user before using it.
        // This guards against a local attacker pre-creating the path to hijack IPC.
        //
        // Known limitation: there is a TOCTOU window between the ownership check below
        // and the open() call in the reader thread. In XDG_RUNTIME_DIR (mode 700) only
        // the current user can write there, so this is unexploitable. In the /tmp fallback
        // an attacker would need to guess the PID-derived nonce and win the race; even
        // then the only impact is triggering the QuickAdd window — no data access or RCE.
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let file_uid = std::fs::metadata(&fifo_path)
                .map(|m| m.uid())
                .unwrap_or(u32::MAX);
            // Use the home directory as a proxy for the current user's uid —
            // it is always owned by the user and requires no extra crates.
            let home_uid = dirs::home_dir()
                .and_then(|h| std::fs::metadata(h).ok())
                .map(|m| m.uid())
                .unwrap_or(u32::MAX - 1);
            if file_uid != home_uid {
                eprintln!(
                    "Warning: FIFO at {} is not owned by the current user (uid {}, expected {}); \
                     quickadd IPC disabled",
                    fifo_path, file_uid, home_uid
                );
                return String::new();
            }
        }
    }

    let path = fifo_path.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        if path.is_empty() {
            return;
        }
        loop {
            if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            // The shortcut command (`echo q > path`) creates a regular file if pressed
            // while the FIFO is missing (e.g. after a reboot, before the app starts).
            // Reading a regular file never blocks, so this loop would spin forever —
            // replace it with a real FIFO instead of opening it.
            if !is_fifo(&path) {
                let _ = std::fs::remove_file(&path);
                if !make_fifo(&path) {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    continue;
                }
            }
            // open() blocks until a writer opens the other end
            match std::fs::File::open(&path) {
                Ok(mut file) => {
                    // Cap read at 4 KB — the FIFO is only used as a trigger signal.
                    // Reading more would waste memory if a misbehaving writer sends large data.
                    let mut buf = [0u8; 4096];
                    let n = file.read(&mut buf).unwrap_or(0);
                    if n > 0 {
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

fn make_fifo(path: &str) -> bool {
    std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// True if `path` is a FIFO. Uses symlink_metadata so a symlink is never followed.
fn is_fifo(path: &str) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_fifo())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        true
    }
}

/// Wraps `s` in POSIX single-quotes, escaping any embedded single quotes.
/// Output is safe to embed verbatim in a shell command string.
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Parse a GVariant string-array as printed by `gsettings get` into a `Vec<String>`.
/// Handles the empty-array forms `@as []` and `[]` as well as `['a', 'b', ...]`.
fn parse_gvariant_strv(raw: &str) -> Vec<String> {
    let s = raw.trim();
    if s == "@as []" || s == "[]" || s.is_empty() {
        return vec![];
    }
    let inner = s
        .strip_prefix('[').unwrap_or(s)
        .strip_suffix(']').unwrap_or(s);
    inner
        .split(',')
        .map(|item| item.trim().trim_matches('\'').to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// Serialize a slice of strings back to the GVariant string-array format expected by gsettings.
fn format_gvariant_strv(items: &[String]) -> String {
    if items.is_empty() {
        return "@as []".to_string();
    }
    format!(
        "[{}]",
        items.iter().map(|s| format!("'{}'", s)).collect::<Vec<_>>().join(", ")
    )
}

/// The command GNOME runs for the Quick Add shortcut. GNOME splits custom-shortcut commands
/// into arguments without a shell, so the redirect needs an explicit `sh -c`. The script and
/// the FIFO path inside it are both single-quoted so any characters in the path stay literal.
fn quickadd_shortcut_command(fifo_path: &str) -> String {
    let script = format!("echo q > {}", shell_single_quote(fifo_path));
    format!("sh -c {}", shell_single_quote(&script))
}

const QUICK_ADD_SHORTCUT_ID: &str = "quick-add";

/// Registers Super+Shift+T through the GlobalShortcuts portal, the only way to get a
/// system-wide shortcut from inside the Flatpak. The desktop may ask the user to confirm or
/// change the binding the first time. The portal session must stay open for the shortcut to
/// keep working, so this runs for the app's lifetime.
#[cfg(target_os = "linux")]
async fn run_portal_shortcut(app: tauri::AppHandle) -> Result<(), ashpd::Error> {
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    use futures_util::StreamExt;

    let portal = GlobalShortcuts::new().await?;
    let session = portal.create_session().await?;
    let shortcut = NewShortcut::new(QUICK_ADD_SHORTCUT_ID, "Quick Add Task")
        .preferred_trigger("LOGO+SHIFT+t");
    portal
        .bind_shortcuts(&session, &[shortcut], &ashpd::WindowIdentifier::default())
        .await?
        .response()?;

    let mut activated = portal.receive_activated().await?;
    while let Some(event) = activated.next().await {
        if event.shortcut_id() == QUICK_ADD_SHORTCUT_ID {
            open_quick_add(&app);
        }
    }
    Ok(())
}

/// Registers a GNOME custom keybinding (Super+Shift+T) that writes to the IPC FIFO.
/// Detects GNOME via XDG_CURRENT_DESKTOP. Safe to call on non-GNOME DEs (no-op).
fn register_gnome_shortcut(fifo_path: &str) {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    if !desktop.contains("gnome") && !desktop.contains("unity") && !desktop.contains("budgie") {
        return;
    }

    let binding_path = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mstodo/";
    let command = quickadd_shortcut_command(fifo_path);

    // Fetch current custom-keybindings list and append our path if absent.
    let current_raw = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let mut entries = parse_gvariant_strv(&current_raw);
    if !entries.iter().any(|e| e == binding_path) {
        entries.push(binding_path.to_string());
        let new_list = format_gvariant_strv(&entries);
        let list_ok = std::process::Command::new("gsettings")
            .args(["set", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings", &new_list])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !list_ok {
            eprintln!("Warning: gsettings set custom-keybindings failed; skipping shortcut registration");
            return;
        }
    }

    let base = format!(
        "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:{}",
        binding_path
    );
    for (field, val) in [("name", "MS Todo Quick Add"), ("binding", "<Super><Shift>t"), ("command", &command)] {
        if let Ok(status) = std::process::Command::new("gsettings").args(["set", &base, field, val]).status() {
            if !status.success() {
                eprintln!("Warning: gsettings set {} {} failed (exit {})", base, field, status);
            }
        }
    }
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
        .always_on_top(true)
        .center()
        .focused(true)
        .build();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn main() {
    // Shared shutdown flag for background threads (e.g. FIFO listener).
    let fifo_shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let fifo_shutdown_setup = fifo_shutdown.clone();
    // Shared FIFO path so the on_window_event handler can unblock the reader thread on shutdown.
    let fifo_path_cell: std::sync::Arc<std::sync::OnceLock<String>> =
        std::sync::Arc::new(std::sync::OnceLock::new());
    let fifo_path_store = fifo_path_cell.clone();
    let fifo_path_exit = fifo_path_cell.clone();

    // Build Tauri application
    Builder::default()
        // Registered first: launching the app again (e.g. from the menu while it's in the tray)
        // shows the running instance, and the new process exits here before any other plugin
        // or the setup hook (tray, FIFO, shortcut registration) runs.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A login start while the app is already running shouldn't pop the window up.
            if !args.iter().any(|a| a == AUTOSTART_ARG) {
                show_main_window(app);
            }
        }))
        .setup(move |app| {
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
                        "show_hide" => show_main_window(app),
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

            if is_flatpak() {
                // The FIFO + gsettings route can't work inside the sandbox (it has its own
                // runtime dir and dconf), so the shortcut is registered through the portal.
                #[cfg(target_os = "linux")]
                {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = run_portal_shortcut(handle).await {
                            eprintln!("Warning: Quick Add shortcut not registered via the GlobalShortcuts portal: {e}");
                        }
                    });
                }
            } else {
                // Set up IPC FIFO for DE-registered shortcut fallback (Wayland / GNOME etc.)
                let fifo_path = setup_quickadd_fifo(app.handle().clone(), fifo_shutdown_setup.clone());
                // Store path so the on_window_event handler can unblock the reader on shutdown.
                let _ = fifo_path_store.set(fifo_path.clone());
                // Also register via GNOME gsettings so it works on Wayland / GNOME Shell.
                // Only register if FIFO setup succeeded (non-empty path).
                if !fifo_path.is_empty() {
                    register_gnome_shortcut(&fifo_path);
                }
            }

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

            tauri::async_runtime::spawn(upgrade_autostart_entry());

            // The main window starts hidden (tauri.conf.json) so a login start can stay in the tray.
            let started_at_login = std::env::args().any(|a| a == AUTOSTART_ARG);
            if started_at_login && start_minimized_setting(app.handle()) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if !tray_available().await {
                        show_main_window(&handle);
                    }
                });
            } else {
                show_main_window(app.handle());
            }

            Ok(())
        })
        .on_window_event(move |window, event| {
            // Only the main window matters here; closing the Quick Add popup must keep the
            // FIFO listener running so the shortcut works again.
            if window.label() != "main" {
                return;
            }
            match event {
                // The window's close button hides to the tray; the tray's Quit item exits
                // (that path doesn't send a close request, so it isn't blocked here).
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Signal the FIFO thread to stop, and write a zero byte to unblock the reader,
                // which may be blocked inside File::open() waiting for a writer — it won't see
                // the shutdown flag until it returns from the kernel call.
                tauri::WindowEvent::Destroyed => {
                    fifo_shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
                    if let Some(path) = fifo_path_cell.get() {
                        let _ = std::fs::OpenOptions::new()
                            .write(true)
                            .open(path)
                            .and_then(|mut f| { use std::io::Write; f.write_all(b"\0") });
                    }
                }
                _ => {}
            }
        })
        // Global shortcut plugin
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
        .invoke_handler(generate_handler![sign_in, refresh_token, get_system_theme, pick_and_read_file, save_text_file, save_attachment, open_external_url, update_tray_tooltip, update_tray_status, keyring_set, keyring_get, keyring_delete, write_log, get_log_path_cmd, get_autostart_enabled, set_autostart_enabled])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(move |_app, event| {
            // Remove the FIFO on exit. Otherwise pressing the shortcut while the app is closed
            // blocks the shortcut's shell until the app next starts, which then opens Quick Add
            // unprompted. Without the FIFO the shell writes a regular file instead, which the
            // reader thread replaces with a fresh FIFO on the next start.
            if let tauri::RunEvent::Exit = event {
                if let Some(path) = fifo_path_exit.get() {
                    if is_fifo(path) {
                        let _ = std::fs::remove_file(path);
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_entry_cannot_forge_new_lines() {
        let (level, msg) = sanitize_log_entry("error", "boom\n[2026-01-01 00:00:00.000] [info] fake\r\nmore");
        assert_eq!(level, "error");
        assert!(!msg.contains("\n["), "continuation lines must be indented: {msg:?}");
        assert!(!msg.contains('\r'));
    }

    #[test]
    fn log_entry_rejects_unknown_level() {
        assert_eq!(sanitize_log_entry("ERROR] [x", "m").0, "info");
        assert_eq!(sanitize_log_entry("warn", "m").0, "warn");
    }

    #[test]
    fn log_entry_is_truncated_on_char_boundary() {
        let long = "é".repeat(MAX_LOG_MESSAGE_LEN);
        let (_, msg) = sanitize_log_entry("info", &long);
        assert!(msg.ends_with(" [truncated]"));
        assert!(msg.len() <= MAX_LOG_MESSAGE_LEN + " [truncated]".len());
        assert_eq!(sanitize_log_entry("info", "short").1, "short");
    }

    #[test]
    fn external_url_allows_web_and_mailto_links() {
        assert!(validate_external_url("https://outlook.live.com/mail/0/inbox/id/AQMk").is_ok());
        assert!(validate_external_url("http://example.com").is_ok());
        assert!(validate_external_url("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn external_url_refuses_other_schemes() {
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("smb://host/share").is_err());
        assert!(validate_external_url("not a url").is_err());
    }

    #[test]
    fn quickadd_shortcut_command_writes_to_the_fifo_path() {
        // A space and a single quote in the path exercise both levels of quoting.
        let dir = std::env::temp_dir().join(format!("mstodo shortcut 'test' {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("quickadd");
        let command = quickadd_shortcut_command(path.to_str().unwrap());
        assert!(command.starts_with("sh -c "));
        // GNOME splits the command with POSIX shell quoting rules; an outer `sh -c` does the same.
        let status = std::process::Command::new("sh").arg("-c").arg(&command).status().unwrap();
        assert!(status.success());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "q\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn start_minimized_defaults_to_on() {
        assert!(start_minimized_from_settings(None));
        assert!(start_minimized_from_settings(Some(r#"{"theme":"dark"}"#)));
        assert!(start_minimized_from_settings(Some("not json")));
        assert!(start_minimized_from_settings(Some(r#"{"startMinimized":true}"#)));
        assert!(!start_minimized_from_settings(Some(r#"{"startMinimized":false}"#)));
    }

    #[test]
    fn regular_file_is_replaced_with_fifo() {
        let dir = std::env::temp_dir().join(format!("mstodo-fifo-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("quickadd");
        let path = path.to_str().unwrap();
        std::fs::write(path, "q\n").unwrap();
        assert!(!is_fifo(path));
        std::fs::remove_file(path).unwrap();
        assert!(make_fifo(path));
        assert!(is_fifo(path));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
