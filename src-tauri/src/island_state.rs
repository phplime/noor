//! State for the Nexa Island side of Noor: prayer engine + widgets database,
//! plus the channel that asks the notification scheduler to re-plan.

use nexa_prayer::PrayerService;
use nexa_widgets::WidgetDb;
use std::sync::mpsc::Sender;
use std::sync::Mutex;

pub struct IslandState {
    pub svc: Mutex<PrayerService>,
    pub wdb: Mutex<WidgetDb>,
    pub scheduler: Mutex<Sender<()>>,
}

impl IslandState {
    /// Ask the notification scheduler to re-plan (debounced on its thread).
    pub fn refresh_scheduler(&self) {
        if let Ok(tx) = self.scheduler.lock() {
            let _ = tx.send(());
        }
    }
}

/// The device's IANA time zone (falls back to UTC).
pub fn local_tz() -> chrono_tz::Tz {
    iana_time_zone::get_timezone()
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(chrono_tz::UTC)
}
