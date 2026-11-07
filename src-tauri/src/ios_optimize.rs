//! Settings › Optimize on iPhone: device health and Photos cleanup.
//! The Swift class `NoorOptimize` (gen/apple/Sources/noor/NoorOptimize.swift) does the work;
//! we call it by name. Everything here blocks: call it off the main thread.

use serde_json::Value;

/// Battery, Low Power Mode, heat and free storage. `{}` off iPhone.
pub fn device() -> Value {
    #[cfg(target_os = "ios")]
    {
        return imp::device();
    }
    #[cfg(not(target_os = "ios"))]
    Value::Object(Default::default())
}

/// One part of the Photos scan: "screenshots", "videos" or "duplicates". `{"error": "..."}` without access.
pub fn photos_scan(part: &str) -> Value {
    #[cfg(target_os = "ios")]
    {
        return imp::scan(part);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = part;
        serde_json::json!({ "error": "unsupported" })
    }
}

/// Delete the chosen photos/videos (iOS asks for confirmation; they go to Recently Deleted).
/// Returns "ok", "cancelled" or an error message.
pub fn photos_delete(ids: &[String]) -> String {
    #[cfg(target_os = "ios")]
    {
        return imp::delete(ids);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = ids;
        "unsupported".into()
    }
}

#[cfg(target_os = "ios")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;
    use serde_json::Value;

    fn class() -> Option<&'static AnyClass> {
        AnyClass::get(c"NoorOptimize")
    }

    fn parse(text: Retained<NSString>) -> Value {
        serde_json::from_str(&text.to_string()).unwrap_or_else(|_| serde_json::json!({ "error": "bad response" }))
    }

    pub fn device() -> Value {
        let Some(cls) = class() else { return serde_json::json!({}) };
        let text: Retained<NSString> = unsafe { msg_send![cls, deviceJSON] };
        parse(text)
    }

    pub fn scan(part: &str) -> Value {
        let Some(cls) = class() else { return serde_json::json!({ "error": "unavailable" }) };
        let arg = NSString::from_str(part);
        let text: Retained<NSString> = unsafe { msg_send![cls, photosScanJSON: &*arg] };
        parse(text)
    }

    pub fn delete(ids: &[String]) -> String {
        let Some(cls) = class() else { return "unavailable".into() };
        let arg = NSString::from_str(&serde_json::to_string(ids).unwrap_or_else(|_| "[]".into()));
        let out: Retained<NSString> = unsafe { msg_send![cls, photosDelete: &*arg] };
        out.to_string()
    }
}
