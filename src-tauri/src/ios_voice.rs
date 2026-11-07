//! Spoken notifications on iPhone: the Swift class `NoorVoice`
//! (gen/apple/Sources/noor/NoorVoice.swift) renders text to an audio file. Blocking.

/// `(bangla, english)`: whether the iPhone has a voice for each language.
pub fn voices() -> (bool, bool) {
    #[cfg(target_os = "ios")]
    {
        return imp::voices();
    }
    #[cfg(not(target_os = "ios"))]
    (false, false)
}

/// Render `text` ("bn" | "en") to `path`. `false` when no voice is installed or it failed.
pub fn render(text: &str, lang: &str, path: &std::path::Path) -> bool {
    #[cfg(target_os = "ios")]
    {
        return imp::render(text, lang, path);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (text, lang, path);
        false
    }
}

/// Start the black-screen watchdog (`NoorWatchdog.swift`). No-op off iPhone.
pub fn install_watchdog() {
    #[cfg(target_os = "ios")]
    imp::watchdog();
}

#[cfg(target_os = "ios")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    fn class() -> Option<&'static AnyClass> {
        AnyClass::get(c"NoorVoice")
    }

    pub fn watchdog() {
        if let Some(cls) = AnyClass::get(c"NoorWatchdog") {
            let _: () = unsafe { msg_send![cls, install] };
        }
    }

    pub fn voices() -> (bool, bool) {
        let Some(cls) = class() else { return (false, false) };
        let text: Retained<NSString> = unsafe { msg_send![cls, voicesJSON] };
        let v: serde_json::Value = serde_json::from_str(&text.to_string()).unwrap_or_default();
        (v["bn"].as_bool().unwrap_or(false), v["en"].as_bool().unwrap_or(false))
    }

    pub fn render(text: &str, lang: &str, path: &std::path::Path) -> bool {
        let Some(cls) = class() else { return false };
        let t = NSString::from_str(text);
        let l = NSString::from_str(lang);
        let p = NSString::from_str(&path.display().to_string());
        unsafe { msg_send![cls, renderText: &*t, lang: &*l, path: &*p] }
    }
}
