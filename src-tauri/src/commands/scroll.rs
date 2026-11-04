#![allow(dead_code)] // MacKit's macOS scrolling commands are kept for the desktop preview but not registered.
use crate::scroll::{ScrollOpResult, ScrollStatus};
use crate::settings::{DeviceDirection, ScrollPrefs};
use crate::state::AppState;
use tauri::State;

fn prefs(state: &AppState) -> ScrollPrefs {
    state.settings.lock().unwrap().scrolling.clone()
}

#[tauri::command]
pub fn scroll_status(state: State<'_, AppState>) -> ScrollStatus {
    state.scroll.status(&prefs(&state))
}

#[tauri::command]
pub fn scroll_set_natural(state: State<'_, AppState>, natural: bool) -> ScrollOpResult {
    state.scroll.set_natural(natural, &prefs(&state))
}

/// Save the per-device preferences and start/stop the event tap accordingly.
#[tauri::command]
pub fn scroll_apply_devices(
    state: State<'_, AppState>,
    mouse: DeviceDirection,
    trackpad: DeviceDirection,
) -> Result<ScrollOpResult, String> {
    let new_prefs = ScrollPrefs { mouse, trackpad };
    {
        let mut s = state.settings.lock().unwrap();
        s.scrolling = new_prefs.clone();
        let saved = state.store.save(&s)?;
        *s = saved;
    }
    Ok(state.scroll.apply_overrides(&new_prefs))
}

#[tauri::command]
pub fn scroll_request_access(state: State<'_, AppState>) -> ScrollOpResult {
    state.scroll.request_accessibility(&prefs(&state))
}

/// Restore macOS defaults: natural scrolling on, no per-device overrides.
#[tauri::command]
pub fn scroll_restore_defaults(state: State<'_, AppState>) -> Result<ScrollOpResult, String> {
    let defaults = ScrollPrefs::default();
    {
        let mut s = state.settings.lock().unwrap();
        s.scrolling = defaults.clone();
        let saved = state.store.save(&s)?;
        *s = saved;
    }
    let off = state.scroll.apply_overrides(&defaults);
    let natural = state.scroll.set_natural(true, &defaults);
    Ok(ScrollOpResult {
        ok: off.ok && natural.ok,
        message: format!("Per-device overrides removed. {}", natural.message),
        status: natural.status,
    })
}

#[tauri::command]
pub fn open_system_settings(state: State<'_, AppState>, pane: String) -> Result<(), String> {
    state.scroll.open_system_settings(&pane)
}
