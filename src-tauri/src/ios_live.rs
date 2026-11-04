//! Lock-screen prayer Live Activity. The work is done by the Swift class
//! `NoorLive` in the Xcode project (gen/apple/Sources/noor/NoorLive.swift);
//! we reach it by name through the Objective-C runtime.

use tauri::AppHandle;

/// Start/update the activity with `payload` (JSON), or end it when `payload` is null.
#[tauri::command]
pub async fn live_activity(app: AppHandle, payload: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        return crate::ios_share::on_main(&app, move || imp::run(payload))?;
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, payload);
        Ok(())
    }
}

/// Whether Live Activities can be shown (iOS 16.2+, allowed in Settings, and built in).
#[tauri::command]
pub async fn live_activity_supported(app: AppHandle) -> bool {
    #[cfg(target_os = "ios")]
    {
        return crate::ios_share::on_main(&app, imp::supported).unwrap_or(false);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        false
    }
}

#[cfg(target_os = "ios")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, Bool};
    use objc2_foundation::NSString;

    fn class() -> Result<&'static AnyClass, String> {
        AnyClass::get(c"NoorLive").ok_or_else(|| "This build doesn't include the lock-screen widget yet — regenerate the Xcode project (xcodegen) and build again.".to_string())
    }

    pub fn supported() -> bool {
        let Ok(cls) = class() else { return false };
        let ok: Bool = unsafe { msg_send![cls, supported] };
        ok.as_bool()
    }

    pub fn run(payload: Option<String>) -> Result<(), String> {
        let cls = class()?;
        match payload {
            Some(json) => {
                let s = NSString::from_str(&json);
                let r: Retained<NSString> = unsafe { msg_send![cls, sync: &*s] };
                let msg = r.to_string();
                if msg.is_empty() {
                    Ok(())
                } else {
                    Err(msg)
                }
            }
            None => {
                let _: () = unsafe { msg_send![cls, end] };
                Ok(())
            }
        }
    }
}
