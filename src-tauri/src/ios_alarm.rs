//! Reminders that ring like an alarm until stopped: AlarmKit on iOS 26+
//! (`NoorAlarm.swift`). Elsewhere the planner falls back to repeating notifications.

use std::sync::OnceLock;

/// Whether this iPhone can show real alarms (iOS 26+). Cached.
pub fn supported() -> bool {
    static S: OnceLock<bool> = OnceLock::new();
    *S.get_or_init(|| {
        #[cfg(target_os = "ios")]
        {
            return imp::supported();
        }
        #[cfg(not(target_os = "ios"))]
        false
    })
}

/// A stable UUID for one alarm occurrence, so re-planning doesn't reschedule it.
pub fn alarm_uuid(key: &str, at_unix: i64) -> String {
    let mut a: u64 = 0xcbf29ce484222325;
    let mut b: u64 = 0x84222325cbf29ce4;
    for byte in format!("{key}@{at_unix}").bytes() {
        a ^= byte as u64;
        a = a.wrapping_mul(0x100000001b3);
        b = b.rotate_left(5) ^ (byte as u64);
        b = b.wrapping_mul(0x9E3779B97F4A7C15);
    }
    // RFC 4122 shape, version 4 / variant bits set.
    let hi = (a & 0xffff_ffff_ffff_0fff) | 0x0000_0000_0000_4000;
    let lo = (b & 0x3fff_ffff_ffff_ffff) | 0x8000_0000_0000_0000;
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        hi >> 32,
        (hi >> 16) & 0xffff,
        hi & 0xffff,
        lo >> 48,
        lo & 0xffff_ffff_ffff
    )
}

/// Make AlarmKit hold exactly these alarms `(uuid, unix seconds, title)`. Blocking.
/// Returns "ok", "unsupported", "denied" or an error.
pub fn sync(items: &[(String, i64, String)]) -> String {
    #[cfg(target_os = "ios")]
    {
        return imp::sync(items);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = items;
        "unsupported".into()
    }
}

#[cfg(target_os = "ios")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    pub fn supported() -> bool {
        match AnyClass::get(c"NoorAlarm") {
            Some(cls) => unsafe { msg_send![cls, supported] },
            None => false,
        }
    }

    pub fn sync(items: &[(String, i64, String)]) -> String {
        let Some(cls) = AnyClass::get(c"NoorAlarm") else { return "unsupported".into() };
        let list: Vec<_> = items.iter().map(|(id, at, title)| serde_json::json!({ "id": id, "at": at, "title": title })).collect();
        let arg = NSString::from_str(&serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()));
        let out: Retained<NSString> = unsafe { msg_send![cls, sync: &*arg] };
        out.to_string()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn uuid_is_stable_and_well_formed() {
        let a = super::alarm_uuid("reminder:x", 1_800_000_000);
        assert_eq!(a, super::alarm_uuid("reminder:x", 1_800_000_000));
        assert_ne!(a, super::alarm_uuid("reminder:x", 1_800_000_060));
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
    }
}
