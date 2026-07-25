//! Menu-bar residency. Closing the window hides it and drops the Dock icon, so
//! the app keeps running (warm org list, live index) instead of paying the cold
//! start again. On macOS that makes the tray icon the *only* way back and the
//! only Quit — hence the fail-loud rule below.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "main";

/// Transparent, single-shape PNG. `icon_as_template` renders it from the alpha
/// channel only, so the menu bar tints it for light/dark automatically — the
/// colored app icon would come out as a solid black square here.
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-template.png");

/// Bring the window back. Dock first, then show, then focus: reversing this
/// leaves the restored window sitting behind whatever app was frontmost.
pub(crate) fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // The process can have been resident for days — let the frontend re-check
    // for orgs added or logged out from a terminal in the meantime.
    let _ = app.emit("window-shown", ());
}

/// Hide the window into the menu bar. Returns `false` *without hiding anything*
/// when the tray icon is missing: a hidden, dock-less window with no tray icon
/// is an unreachable background process, so the caller closes for real instead.
pub(crate) fn hide_to_tray(app: &AppHandle) -> bool {
    if app.tray_by_id(TRAY_ID).is_none() {
        tracing::warn!("no tray icon — closing for real instead of hiding");
        return false;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return false;
    };
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(false);
    true
}

/// Left click toggles the window; the menu (right click) carries Show and Quit.
/// Quit lives here because a hidden, dock-less app is not frontmost, so ⌘Q never
/// reaches it.
pub(crate) fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Ultraforce", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ultraforce", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Visibility alone decides, deliberately: clicking a status item makes the
/// status bar's own window key, so the main window reports `is_focused() ==
/// false` by the time this runs — gating on focus would turn every click into a
/// "show" and the window could never be dismissed from the tray.
fn toggle(app: &AppHandle) {
    let visible = app
        .get_webview_window(MAIN_WINDOW)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if visible {
        hide_to_tray(app);
    } else {
        show_main(app);
    }
}
