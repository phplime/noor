//! Mouse & trackpad scrolling direction.
//!
//! Two independent mechanisms, both using public macOS APIs:
//!
//! 1. **System setting** – the `com.apple.swipescrolldirection` key in the global
//!    preferences domain, read and written with `CFPreferences`. This is the same
//!    value System Settings uses. macOS applies it to *both* mouse and trackpad
//!    (there is no separate per-device key), and a change made outside System
//!    Settings is only picked up by the input system after logging out and in.
//!    MacKit verifies the stored value by reading it back and says so honestly.
//!
//! 2. **Per-device direction (optional)** – a `CGEventTap` that reverses scroll
//!    events while MacKit is running. It needs the Accessibility permission. Mouse
//!    and trackpad are told apart by the `kCGScrollWheelEventIsContinuous` field:
//!    trackpads (and the Magic Mouse) send continuous scrolling, classic wheel
//!    mice send line-based scrolling. Takes effect immediately, no logout needed.

use crate::settings::{DeviceDirection, ScrollPrefs};
use serde::Serialize;

#[cfg(any(target_os = "macos", feature = "macos-typecheck"))]
#[allow(dead_code)]
mod macos;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStatus {
    /// True on macOS.
    pub supported: bool,
    pub macos_version: Option<String>,
    /// Natural scrolling as stored in macOS preferences (None = could not be read).
    pub stored_natural: Option<bool>,
    /// The key is explicitly present (absent means the macOS default, natural = on).
    pub explicitly_set: bool,
    /// MacKit changed the stored value in this session; the change applies after logout/login.
    pub pending_relogin: bool,
    /// Best knowledge of the direction currently in effect for the session.
    pub effective_natural: Option<bool>,
    pub accessibility_trusted: bool,
    /// The per-device event tap is running.
    pub override_active: bool,
    pub override_error: Option<String>,
    pub mouse: DeviceDirection,
    pub trackpad: DeviceDirection,
    /// Running as the packaged MacKit.app (false for `npm run app:dev`).
    pub running_from_bundle: bool,
    /// The app macOS checks for the Accessibility permission.
    pub permission_app: String,
    pub stats: ScrollStats,
}

/// Live counters from the event tap, so the UI can show whether scroll events are
/// arriving, how each device is classified and whether they are being reversed.
#[derive(Debug, Clone, Copy, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStats {
    pub mouse_events: u64,
    pub mouse_reversed: u64,
    pub trackpad_events: u64,
    pub trackpad_reversed: u64,
    pub reverse_mouse: bool,
    pub reverse_trackpad: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollOpResult {
    pub ok: bool,
    pub message: String,
    pub status: ScrollStatus,
}

/// Which devices need their events reversed, given the effective system setting.
pub fn reversal_flags(effective_natural: bool, prefs: &ScrollPrefs) -> (bool, bool) {
    let want = |d: DeviceDirection| match d {
        DeviceDirection::System => None,
        DeviceDirection::Natural => Some(true),
        DeviceDirection::Standard => Some(false),
    };
    let rev = |d| want(d).is_some_and(|natural| natural != effective_natural);
    (rev(prefs.mouse), rev(prefs.trackpad))
}

pub fn overrides_requested(prefs: &ScrollPrefs) -> bool {
    prefs.mouse != DeviceDirection::System || prefs.trackpad != DeviceDirection::System
}

#[cfg(target_os = "macos")]
pub use macos::ScrollController;

#[cfg(not(target_os = "macos"))]
pub struct ScrollController;

#[cfg(not(target_os = "macos"))]
impl Default for ScrollController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(target_os = "macos"))]
impl ScrollController {
    pub fn new() -> Self {
        ScrollController
    }
    pub fn status(&self, prefs: &ScrollPrefs) -> ScrollStatus {
        ScrollStatus {
            supported: false,
            macos_version: None,
            stored_natural: None,
            explicitly_set: false,
            pending_relogin: false,
            effective_natural: None,
            accessibility_trusted: false,
            override_active: false,
            override_error: None,
            mouse: prefs.mouse,
            trackpad: prefs.trackpad,
            running_from_bundle: false,
            permission_app: String::new(),
            stats: ScrollStats::default(),
        }
    }
    fn unsupported(&self, prefs: &ScrollPrefs) -> ScrollOpResult {
        ScrollOpResult {
            ok: false,
            message: "Scrolling controls are only available on macOS.".into(),
            status: self.status(prefs),
        }
    }
    pub fn set_natural(&self, _natural: bool, prefs: &ScrollPrefs) -> ScrollOpResult {
        self.unsupported(prefs)
    }
    pub fn apply_overrides(&self, prefs: &ScrollPrefs) -> ScrollOpResult {
        self.unsupported(prefs)
    }
    pub fn request_accessibility(&self, prefs: &ScrollPrefs) -> ScrollOpResult {
        self.unsupported(prefs)
    }
    pub fn open_system_settings(&self, _pane: &str) -> Result<(), String> {
        Err("Only available on macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reversal_logic() {
        let p = |m, t| ScrollPrefs {
            mouse: m,
            trackpad: t,
        };
        use DeviceDirection::*;
        assert_eq!(reversal_flags(true, &p(System, System)), (false, false));
        assert_eq!(reversal_flags(true, &p(Standard, Natural)), (true, false));
        assert_eq!(reversal_flags(false, &p(Standard, Natural)), (false, true));
        assert_eq!(reversal_flags(false, &p(Natural, Natural)), (true, true));
        assert!(!overrides_requested(&p(System, System)));
        assert!(overrides_requested(&p(System, Standard)));
    }
}
