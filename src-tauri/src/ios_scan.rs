//! Studio › ID / Passport: Apple's document scanner (`NoorScan.swift`). Blocks until the
//! user finishes or cancels — call it off the main thread.

use serde_json::Value;

/// `{"paths":[…]}`, `{"cancelled":true}` or `{"error":"…"}`.
pub fn scan() -> Value {
    #[cfg(target_os = "ios")]
    {
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2::runtime::AnyClass;
        use objc2_foundation::NSString;
        let Some(cls) = AnyClass::get(c"NoorScan") else {
            return serde_json::json!({ "error": "Scanner not available" });
        };
        let out: Retained<NSString> = unsafe { msg_send![cls, scan] };
        return serde_json::from_str(&out.to_string()).unwrap_or_else(|_| serde_json::json!({ "error": "bad response" }));
    }
    #[cfg(not(target_os = "ios"))]
    serde_json::json!({ "error": "unsupported" })
}

#[tauri::command]
pub async fn scan_document() -> Value {
    tauri::async_runtime::spawn_blocking(scan).await.unwrap_or(Value::Null)
}

/// Apple's Vision rectangle finder (iPhone). Corners TL, TR, BR, BL, 0..1, top-left origin.
pub fn detect(path: &std::path::Path) -> Option<mackit_core::docscan::Quad> {
    #[cfg(target_os = "ios")]
    {
        use mackit_core::docscan::Pt;
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2::runtime::AnyClass;
        use objc2_foundation::NSString;
        let cls = AnyClass::get(c"NoorScan")?;
        let p = NSString::from_str(&path.to_string_lossy());
        let out: Retained<NSString> = unsafe { msg_send![cls, detect: &*p] };
        let v: Vec<[f64; 2]> = serde_json::from_str(&out.to_string()).ok()?;
        if v.len() != 4 {
            return None;
        }
        return Some([0, 1, 2, 3].map(|i| Pt { x: v[i][0], y: v[i][1] }));
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = path;
        None
    }
}
