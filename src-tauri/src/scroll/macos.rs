//! macOS implementation of the scrolling controls. Public APIs only:
//! CFPreferences (CoreFoundation), CGEventTap (CoreGraphics) and
//! AXIsProcessTrustedWithOptions (ApplicationServices / HIServices).

use super::{overrides_requested, reversal_flags, ScrollOpResult, ScrollStats, ScrollStatus};
use crate::settings::ScrollPrefs;
use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFGetTypeID, CFRelease, CFTypeRef};
use core_foundation_sys::dictionary::CFDictionaryRef;
use core_foundation_sys::mach_port::{
    CFMachPortCreateRunLoopSource, CFMachPortInvalidate, CFMachPortRef,
};
use core_foundation_sys::notification_center::{
    CFNotificationCenterPostNotification, CFNotificationCenterRef,
};
use core_foundation_sys::number::{
    kCFNumberSInt64Type, CFBooleanGetTypeID, CFBooleanGetValue, CFBooleanRef, CFNumberGetTypeID,
    CFNumberGetValue, CFNumberRef,
};
use core_foundation_sys::preferences::{
    kCFPreferencesAnyApplication, kCFPreferencesAnyHost, kCFPreferencesCurrentUser,
    CFPreferencesAppSynchronize, CFPreferencesCopyAppValue, CFPreferencesSetValue,
    CFPreferencesSynchronize,
};
use core_foundation_sys::runloop::{
    kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoopAddSource, CFRunLoopGetCurrent,
    CFRunLoopRunInMode,
};
use core_foundation_sys::string::CFStringRef;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;

const SWIPE_KEY: &str = "com.apple.swipescrolldirection";
const CHANGE_NOTIFICATION: &str = "SwipeScrollDirectionDidChangeNotification";

// ---- CoreGraphics / HIServices FFI -------------------------------------------------

type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type TapCallback = extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
const K_CG_EVENT_SCROLL_WHEEL: u32 = 22;
const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

// CGEventField values (CGEventTypes.h)
const F_DELTA_AXIS_1: u32 = 11;
const F_DELTA_AXIS_2: u32 = 12;
const F_IS_CONTINUOUS: u32 = 88;
/// Gesture phase (began/changed/ended) — only trackpads and the Magic Mouse set it.
const F_SCROLL_PHASE: u32 = 99;
/// Inertial "coasting" phase after a gesture — trackpads and the Magic Mouse only.
const F_MOMENTUM_PHASE: u32 = 123;
const F_FIXED_DELTA_AXIS_1: u32 = 93;
const F_FIXED_DELTA_AXIS_2: u32 = 94;
const F_POINT_DELTA_AXIS_1: u32 = 96;
const F_POINT_DELTA_AXIS_2: u32 = 97;

#[cfg_attr(target_os = "macos", link(name = "CoreGraphics", kind = "framework"))]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventSetIntegerValueField(event: CGEventRef, field: u32, value: i64);
    fn CGEventGetDoubleValueField(event: CGEventRef, field: u32) -> f64;
    fn CGEventSetDoubleValueField(event: CGEventRef, field: u32, value: f64);
}

#[cfg_attr(target_os = "macos", link(name = "CoreFoundation", kind = "framework"))]
extern "C" {
    // macOS-only in core-foundation-sys, so declared here to keep host type-checks working.
    fn CFNotificationCenterGetDistributedCenter() -> CFNotificationCenterRef;
}

#[cfg_attr(
    target_os = "macos",
    link(name = "ApplicationServices", kind = "framework")
)]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

// ---- Event tap ---------------------------------------------------------------------

static REVERSE_MOUSE: AtomicBool = AtomicBool::new(false);
static REVERSE_TRACKPAD: AtomicBool = AtomicBool::new(false);
static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

// Live diagnostics shown on the Mouse Scrolling page.
static MOUSE_EVENTS: AtomicU64 = AtomicU64::new(0);
static MOUSE_REVERSED: AtomicU64 = AtomicU64::new(0);
static TRACKPAD_EVENTS: AtomicU64 = AtomicU64::new(0);
static TRACKPAD_REVERSED: AtomicU64 = AtomicU64::new(0);

/// Is this scroll event from a trackpad (or Magic Mouse) rather than a wheel mouse?
///
/// Trackpads send gesture/momentum phases. Wheel mice never do — including mice
/// with "smooth scrolling" (e.g. Logitech Options+), which send *continuous*
/// events and would be mistaken for a trackpad if only `IsContinuous` were used.
unsafe fn is_trackpad_event(event: CGEventRef) -> bool {
    let phase = CGEventGetIntegerValueField(event, F_SCROLL_PHASE);
    let momentum = CGEventGetIntegerValueField(event, F_MOMENTUM_PHASE);
    phase != 0 || momentum != 0
}

extern "C" fn tap_callback(
    _proxy: CGEventTapProxy,
    etype: u32,
    event: CGEventRef,
    _info: *mut c_void,
) -> CGEventRef {
    unsafe {
        if etype == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || etype == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            // macOS disables slow taps; turn ourselves back on.
            let port = TAP_PORT.load(Ordering::SeqCst);
            if !port.is_null() {
                CGEventTapEnable(port as CFMachPortRef, true);
            }
            return event;
        }
        if etype != K_CG_EVENT_SCROLL_WHEEL || event.is_null() {
            return event;
        }
        let trackpad = is_trackpad_event(event);
        let _continuous = CGEventGetIntegerValueField(event, F_IS_CONTINUOUS) != 0;
        let reverse = if trackpad {
            TRACKPAD_EVENTS.fetch_add(1, Ordering::Relaxed);
            REVERSE_TRACKPAD.load(Ordering::Relaxed)
        } else {
            MOUSE_EVENTS.fetch_add(1, Ordering::Relaxed);
            REVERSE_MOUSE.load(Ordering::Relaxed)
        };
        if reverse {
            if trackpad {
                TRACKPAD_REVERSED.fetch_add(1, Ordering::Relaxed);
            } else {
                MOUSE_REVERSED.fetch_add(1, Ordering::Relaxed);
            }
            for (line, fixed, point) in [
                (F_DELTA_AXIS_1, F_FIXED_DELTA_AXIS_1, F_POINT_DELTA_AXIS_1),
                (F_DELTA_AXIS_2, F_FIXED_DELTA_AXIS_2, F_POINT_DELTA_AXIS_2),
            ] {
                let l = CGEventGetIntegerValueField(event, line);
                let f = CGEventGetDoubleValueField(event, fixed);
                let p = CGEventGetIntegerValueField(event, point);
                CGEventSetIntegerValueField(event, line, -l);
                CGEventSetDoubleValueField(event, fixed, -f);
                CGEventSetIntegerValueField(event, point, -p);
            }
        }
        event
    }
}

struct TapHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl TapHandle {
    fn start() -> Result<TapHandle, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let thread = std::thread::Builder::new()
            .name("mackit-scroll-tap".into())
            .spawn(move || unsafe {
                let mask: u64 = 1u64 << K_CG_EVENT_SCROLL_WHEEL;
                let port = CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_DEFAULT,
                    mask,
                    tap_callback,
                    std::ptr::null_mut(),
                );
                if port.is_null() {
                    let _ = tx.send(Err(
                        "macOS refused to create the scroll event tap. Allow MacKit under System Settings → Privacy & Security → Accessibility, then try again.".into(),
                    ));
                    return;
                }
                TAP_PORT.store(port as *mut c_void, Ordering::SeqCst);
                let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
                CGEventTapEnable(port, true);
                let _ = tx.send(Ok(()));
                while !stop_thread.load(Ordering::SeqCst) {
                    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, 0);
                }
                CGEventTapEnable(port, false);
                TAP_PORT.store(std::ptr::null_mut(), Ordering::SeqCst);
                CFMachPortInvalidate(port);
                CFRelease(source as CFTypeRef);
                CFRelease(port as CFTypeRef);
            })
            .map_err(|e| e.to_string())?;
        match rx.recv() {
            Ok(Ok(())) => Ok(TapHandle {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err("the scroll event tap thread stopped unexpectedly".into()),
        }
    }
}

impl Drop for TapHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        REVERSE_MOUSE.store(false, Ordering::SeqCst);
        REVERSE_TRACKPAD.store(false, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

// ---- Preferences ---------------------------------------------------------------------

/// (value, explicitly set). Absent key = macOS default (natural scrolling on).
fn read_natural() -> (Option<bool>, bool) {
    unsafe {
        CFPreferencesAppSynchronize(kCFPreferencesAnyApplication);
        let key = CFString::new(SWIPE_KEY);
        let v = CFPreferencesCopyAppValue(key.as_concrete_TypeRef(), kCFPreferencesAnyApplication);
        if v.is_null() {
            return (Some(true), false);
        }
        let tid = CFGetTypeID(v);
        let out = if tid == CFBooleanGetTypeID() {
            Some(CFBooleanGetValue(v as CFBooleanRef))
        } else if tid == CFNumberGetTypeID() {
            let mut n: i64 = 0;
            if CFNumberGetValue(
                v as CFNumberRef,
                kCFNumberSInt64Type,
                &mut n as *mut i64 as *mut c_void,
            ) {
                Some(n != 0)
            } else {
                None
            }
        } else {
            None
        };
        CFRelease(v);
        (out, true)
    }
}

fn write_natural(natural: bool) -> bool {
    unsafe {
        let key = CFString::new(SWIPE_KEY);
        let value = if natural {
            CFBoolean::true_value()
        } else {
            CFBoolean::false_value()
        };
        CFPreferencesSetValue(
            key.as_concrete_TypeRef(),
            value.as_CFTypeRef(),
            kCFPreferencesAnyApplication,
            kCFPreferencesCurrentUser,
            kCFPreferencesAnyHost,
        );
        let ok = CFPreferencesSynchronize(
            kCFPreferencesAnyApplication,
            kCFPreferencesCurrentUser,
            kCFPreferencesAnyHost,
        ) != 0;
        // Informational broadcast for apps that observe it. It does not by itself
        // make the input system re-read the preference, so we never rely on it.
        let name = CFString::new(CHANGE_NOTIFICATION);
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDistributedCenter(),
            name.as_concrete_TypeRef(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        );
        ok
    }
}

fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

fn prompt_accessibility() -> bool {
    unsafe {
        let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let dict = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef()) != 0
    }
}

/// macOS grants Accessibility to the *responsible* app. For the packaged MacKit.app
/// that is MacKit itself; for a development build started from a terminal or editor
/// (`npm run app:dev`) it is that terminal/editor, not the `mackit` binary.
fn permission_target() -> (bool, String) {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    if exe.contains(".app/Contents/MacOS/") {
        (true, "MacKit".to_string())
    } else {
        (
            false,
            "the app you started MacKit from (Terminal, iTerm, VS Code, Cursor…) — this is a development build".to_string(),
        )
    }
}

fn stats() -> ScrollStats {
    ScrollStats {
        mouse_events: MOUSE_EVENTS.load(Ordering::Relaxed),
        mouse_reversed: MOUSE_REVERSED.load(Ordering::Relaxed),
        trackpad_events: TRACKPAD_EVENTS.load(Ordering::Relaxed),
        trackpad_reversed: TRACKPAD_REVERSED.load(Ordering::Relaxed),
        reverse_mouse: REVERSE_MOUSE.load(Ordering::Relaxed),
        reverse_trackpad: REVERSE_TRACKPAD.load(Ordering::Relaxed),
    }
}

fn macos_version() -> Option<String> {
    static V: OnceLock<Option<String>> = OnceLock::new();
    V.get_or_init(|| {
        std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
    .clone()
}

// ---- Controller ----------------------------------------------------------------------

struct Inner {
    /// Value at launch: what the input system is using until the next login if
    /// the preference is changed outside System Settings.
    launch_natural: Option<bool>,
    pending_relogin: bool,
    tap: Option<TapHandle>,
    last_error: Option<String>,
}

pub struct ScrollController {
    inner: Mutex<Inner>,
}

impl Default for ScrollController {
    fn default() -> Self {
        Self::new()
    }
}

impl ScrollController {
    pub fn new() -> Self {
        ScrollController {
            inner: Mutex::new(Inner {
                launch_natural: read_natural().0,
                pending_relogin: false,
                tap: None,
                last_error: None,
            }),
        }
    }

    fn effective(inner: &Inner, stored: Option<bool>) -> Option<bool> {
        if inner.pending_relogin {
            inner.launch_natural
        } else {
            stored
        }
    }

    fn status_locked(&self, inner: &Inner, prefs: &ScrollPrefs) -> ScrollStatus {
        let (stored, explicit) = read_natural();
        ScrollStatus {
            supported: true,
            macos_version: macos_version(),
            stored_natural: stored,
            explicitly_set: explicit,
            pending_relogin: inner.pending_relogin,
            effective_natural: Self::effective(inner, stored),
            accessibility_trusted: accessibility_trusted(),
            override_active: inner.tap.is_some(),
            override_error: inner.last_error.clone(),
            mouse: prefs.mouse,
            trackpad: prefs.trackpad,
            running_from_bundle: permission_target().0,
            permission_app: permission_target().1,
            stats: stats(),
        }
    }

    pub fn status(&self, prefs: &ScrollPrefs) -> ScrollStatus {
        let inner = self.inner.lock().unwrap();
        self.status_locked(&inner, prefs)
    }

    fn update_flags(inner: &Inner, prefs: &ScrollPrefs) {
        let effective = Self::effective(inner, read_natural().0).unwrap_or(true);
        let (m, t) = reversal_flags(effective, prefs);
        REVERSE_MOUSE.store(m, Ordering::SeqCst);
        REVERSE_TRACKPAD.store(t, Ordering::SeqCst);
    }

    pub fn set_natural(&self, natural: bool, prefs: &ScrollPrefs) -> ScrollOpResult {
        let mut inner = self.inner.lock().unwrap();
        let synced = write_natural(natural);
        let (read_back, _) = read_natural();
        let verified = read_back == Some(natural);
        if verified {
            // System Settings applies changes live and also writes this key; when MacKit
            // writes it, the HID system only picks it up at the next login.
            inner.pending_relogin = inner.launch_natural != Some(natural);
        }
        if inner.tap.is_some() {
            Self::update_flags(&inner, prefs);
        }
        let ok = synced && verified;
        let message = if !ok {
            "macOS did not accept the change (the value read back differs). Use System Settings → Mouse or Trackpad instead.".to_string()
        } else if inner.pending_relogin {
            format!(
                "Saved and verified: natural scrolling is now {} in your macOS preferences. macOS applies this to mouse and trackpad together, and only after you log out and back in. For an immediate change, use the toggle in System Settings, or MacKit's per-device direction below.",
                if natural { "ON" } else { "OFF" }
            )
        } else {
            format!(
                "Natural scrolling is {} (this matches the setting currently in effect).",
                if natural { "ON" } else { "OFF" }
            )
        };
        ScrollOpResult {
            ok,
            message,
            status: self.status_locked(&inner, prefs),
        }
    }

    pub fn apply_overrides(&self, prefs: &ScrollPrefs) -> ScrollOpResult {
        let mut inner = self.inner.lock().unwrap();
        if !overrides_requested(prefs) {
            inner.tap = None; // Drop stops the tap and clears flags.
            inner.last_error = None;
            return ScrollOpResult {
                ok: true,
                message: "Per-device direction is off. Both devices follow the macOS setting."
                    .into(),
                status: self.status_locked(&inner, prefs),
            };
        }
        if !accessibility_trusted() {
            inner.tap = None;
            let msg = format!(
                "Accessibility permission is needed to reverse scrolling. Turn on {} in System Settings → Privacy & Security → Accessibility, then click Apply again.",
                permission_target().1
            );
            inner.last_error = Some(msg.clone());
            return ScrollOpResult {
                ok: false,
                message: msg,
                status: self.status_locked(&inner, prefs),
            };
        }
        Self::update_flags(&inner, prefs);
        if inner.tap.is_none() {
            match TapHandle::start() {
                Ok(h) => inner.tap = Some(h),
                Err(e) => {
                    inner.last_error = Some(e.clone());
                    return ScrollOpResult {
                        ok: false,
                        message: e,
                        status: self.status_locked(&inner, prefs),
                    };
                }
            }
            // Flags were reset by any previous Drop; set them again now that the tap runs.
            Self::update_flags(&inner, prefs);
        }
        inner.last_error = None;
        ScrollOpResult {
            ok: true,
            message: "Per-device scrolling is active. It applies immediately and stays active while MacKit is running.".into(),
            status: self.status_locked(&inner, prefs),
        }
    }

    pub fn request_accessibility(&self, prefs: &ScrollPrefs) -> ScrollOpResult {
        let trusted = prompt_accessibility();
        let inner = self.inner.lock().unwrap();
        ScrollOpResult {
            ok: trusted,
            message: if trusted {
                "MacKit already has the Accessibility permission.".into()
            } else {
                format!(
                    "Enable {} in System Settings → Privacy & Security → Accessibility, then return here and click Apply.",
                    permission_target().1
                )
            },
            status: self.status_locked(&inner, prefs),
        }
    }

    pub fn open_system_settings(&self, pane: &str) -> Result<(), String> {
        let url = match pane {
            "mouse" => "x-apple.systempreferences:com.apple.preference.mouse",
            "trackpad" => "x-apple.systempreferences:com.apple.preference.trackpad",
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            _ => return Err("unknown settings pane".into()),
        };
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())
            .and_then(|s| {
                if s.success() {
                    Ok(())
                } else {
                    Err("could not open System Settings".into())
                }
            })
    }
}
