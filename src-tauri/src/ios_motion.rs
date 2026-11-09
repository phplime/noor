//! Step counts from the iPhone's motion coprocessor (CoreMotion's CMPedometer,
//! the same source the Health app uses). Needs no HealthKit entitlement — only
//! the "Motion & Fitness" permission. The Swift class `NoorMotion`
//! (gen/apple/Sources/noor/NoorMotion.swift) does the work; we call it by name.

/// (date "YYYY-MM-DD", steps) for the last `days` days, today included.
/// Empty when not on iPhone, not allowed, or not built in. Blocks briefly: call off the main thread.
pub fn step_counts(days: u32) -> Vec<(String, u32)> {
    #[cfg(target_os = "ios")]
    {
        return imp::step_counts(days);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = days;
        Vec::new()
    }
}

pub fn available() -> bool {
    #[cfg(target_os = "ios")]
    {
        return imp::available();
    }
    #[cfg(not(target_os = "ios"))]
    false
}

/// Live walk: count steps from `from_epoch` (seconds since 1970) until `live_stop`.
pub fn live_start(from_epoch: f64) {
    #[cfg(target_os = "ios")]
    imp::start_live(from_epoch);
    #[cfg(not(target_os = "ios"))]
    let _ = from_epoch;
}

pub fn live_stop() {
    #[cfg(target_os = "ios")]
    imp::stop_live();
}

/// `{"steps", "distanceM", "speedMps", "cadence", "age"}` or `{}` (nothing yet / not iPhone).
pub fn live() -> serde_json::Value {
    #[cfg(target_os = "ios")]
    {
        return imp::live();
    }
    #[cfg(not(target_os = "ios"))]
    serde_json::Value::Object(Default::default())
}

#[cfg(target_os = "ios")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, Bool};
    use objc2_foundation::NSString;

    fn class() -> Option<&'static AnyClass> {
        AnyClass::get(c"NoorMotion")
    }

    pub fn available() -> bool {
        let Some(cls) = class() else { return false };
        let ok: Bool = unsafe { msg_send![cls, available] };
        ok.as_bool()
    }

    pub fn step_counts(days: u32) -> Vec<(String, u32)> {
        let Some(cls) = class() else { return Vec::new() };
        let json: Retained<NSString> = unsafe { msg_send![cls, stepsJSON: days as isize] };
        let text = json.to_string();
        serde_json::from_str::<Vec<(String, u32)>>(&text).unwrap_or_default()
    }

    pub fn start_live(from_epoch: f64) {
        let Some(cls) = class() else { return };
        unsafe {
            let _: () = msg_send![cls, startLive: from_epoch];
        }
    }

    pub fn stop_live() {
        let Some(cls) = class() else { return };
        unsafe {
            let _: () = msg_send![cls, stopLive];
        }
    }

    pub fn live() -> serde_json::Value {
        let Some(cls) = class() else { return serde_json::Value::Object(Default::default()) };
        let json: Retained<NSString> = unsafe { msg_send![cls, liveJSON] };
        serde_json::from_str(&json.to_string()).unwrap_or_else(|_| serde_json::Value::Object(Default::default()))
    }
}
