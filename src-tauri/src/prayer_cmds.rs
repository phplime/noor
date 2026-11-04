//! Prayer-time commands (ported from Nexa Island).

use crate::island_state::IslandState as AppState;
use chrono::{Duration, NaiveDate, Utc};
use nexa_prayer::cities::{self, City};
use nexa_prayer::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Tell every window and the scheduler that prayer settings changed.
fn changed(app: &AppHandle, state: &AppState, what: &str) {
    state.refresh_scheduler();
    let _ = app.emit("prayer://changed", what);
}

macro_rules! svc {
    ($state:expr) => {
        $state.svc.lock().map_err(|_| "prayer service unavailable".to_string())?
    };
}

// ----- reading ------------------------------------------------------------

#[tauri::command]
pub fn prayer_snapshot(state: State<'_, AppState>) -> CmdResult<PrayerSnapshot> {
    svc!(state).snapshot(Utc::now()).map_err(err)
}

#[tauri::command]
pub fn prayer_schedule(state: State<'_, AppState>, date: String) -> CmdResult<DailyPrayerSchedule> {
    let date: NaiveDate = date.parse().map_err(|_| format!("invalid date '{date}'"))?;
    svc!(state).schedule_for(date).map_err(err)
}

#[tauri::command]
pub fn prayer_month(state: State<'_, AppState>, year: i32, month: u32) -> CmdResult<Vec<DailyPrayerSchedule>> {
    svc!(state).month(year, month).map_err(err)
}

/// Upcoming reminders (what the scheduler will show), soonest first.
#[tauri::command]
pub fn prayer_upcoming(state: State<'_, AppState>, hours: Option<i64>, limit: Option<usize>) -> CmdResult<Vec<PlannedReminder>> {
    let now = Utc::now();
    let hours = hours.unwrap_or(48).clamp(1, 24 * 14);
    let plan = svc!(state)
        .plan(now, Duration::hours(hours), limit.unwrap_or(100).min(500))
        .map_err(err)?;
    Ok(plan.into_iter().filter(|p| p.fire_at > now).collect())
}

// ----- saving -------------------------------------------------------------

#[tauri::command]
pub fn save_calculation(app: AppHandle, state: State<'_, AppState>, settings: PrayerCalculationSettings) -> CmdResult<PrayerCalculationSettings> {
    let saved = svc!(state).set_calculation(settings).map_err(err)?;
    changed(&app, &state, "calculation");
    Ok(saved)
}

#[tauri::command]
pub fn save_manual(app: AppHandle, state: State<'_, AppState>, manual: ManualTimetable) -> CmdResult<ManualTimetable> {
    let saved = svc!(state).set_manual(manual).map_err(err)?;
    changed(&app, &state, "manual");
    Ok(saved)
}

#[tauri::command]
pub fn save_display(app: AppHandle, state: State<'_, AppState>, display: PrayerDisplaySettings) -> CmdResult<PrayerDisplaySettings> {
    let saved = svc!(state).set_display(display).map_err(err)?;
    changed(&app, &state, "display");
    Ok(saved)
}

#[tauri::command]
pub fn save_notifications(app: AppHandle, state: State<'_, AppState>, notifications: PrayerNotificationSettings) -> CmdResult<PrayerNotificationSettings> {
    let saved = svc!(state).set_notifications(notifications).map_err(err)?;
    changed(&app, &state, "notifications");
    Ok(saved)
}

/// Edit one prayer's time at the active location (offset / fixed time / reset).
#[tauri::command]
pub fn prayer_adjust(app: AppHandle, state: State<'_, AppState>, prayer: Prayer, change: PrayerAdjust) -> CmdResult<LocationAdjustments> {
    let saved = svc!(state).adjust_prayer(prayer, change).map_err(err)?;
    changed(&app, &state, "calculation");
    Ok(saved)
}

#[tauri::command]
pub fn new_reminder(prayer: Prayer, offset_minutes: i32) -> PrayerReminder {
    PrayerReminder::new(prayer, offset_minutes)
}

// ----- locations ----------------------------------------------------------

#[tauri::command]
pub fn location_search(query: String) -> Vec<City> {
    cities::search(&query, 20)
}

#[tauri::command]
pub fn location_save(app: AppHandle, state: State<'_, AppState>, location: PrayerLocation, make_active: bool) -> CmdResult<PrayerLocation> {
    let saved = svc!(state).save_location(location, make_active).map_err(err)?;
    changed(&app, &state, "location");
    Ok(saved)
}

#[tauri::command]
pub fn location_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    svc!(state).delete_location(&id).map_err(err)?;
    changed(&app, &state, "location");
    Ok(())
}

#[tauri::command]
pub fn location_set_active(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    svc!(state).set_active_location(&id).map_err(err)?;
    changed(&app, &state, "location");
    Ok(())
}

/// Coordinates from the device's location services (the webview asks for permission).
#[tauri::command]
pub fn location_set_device(app: AppHandle, state: State<'_, AppState>, latitude: f64, longitude: f64) -> CmdResult<PrayerLocation> {
    let saved = svc!(state).set_device_location(latitude, longitude).map_err(err)?;
    changed(&app, &state, "location");
    Ok(saved)
}

#[tauri::command]
pub fn location_set_mode(app: AppHandle, state: State<'_, AppState>, mode: LocationMode) -> CmdResult<()> {
    svc!(state).set_location_mode(mode).map_err(err)?;
    changed(&app, &state, "location");
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneInfo {
    pub system: String,
    pub all: Vec<&'static str>,
}

#[tauri::command]
pub fn timezones() -> ZoneInfo {
    ZoneInfo {
        system: iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into()),
        all: cities::timezones(),
    }
}

