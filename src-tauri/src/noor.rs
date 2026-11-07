//! Noor-only commands: calendar & occasions, Ramadan, special days and the
//! person's profile for the Home screen.

use crate::island_state::{local_tz, IslandState as AppState};
use crate::notify::plan_all;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use nexa_prayer::{Prayer, PrayerService};
use nexa_widgets::calendar::{self, CalendarSettings, DayInfo, Dated};
use nexa_widgets::profile::Profile;
use nexa_widgets::ramadan::{self, DayTimes, RamadanSettings};
use nexa_widgets::specials::{SpecialDay, SpecialInput};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

macro_rules! db {
    ($state:expr) => {
        $state.wdb.lock().map_err(|_| "storage unavailable".to_string())?
    };
}

fn changed(app: &AppHandle, module: &str) {
    let _ = app.emit("widgets://changed", module);
}

fn parse_date(s: &str) -> R<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "invalid date".to_string())
}

pub fn calendar_settings_of(db: &nexa_widgets::WidgetDb) -> CalendarSettings {
    db.get_json::<CalendarSettings>("calendar").ok().flatten().unwrap_or_default().sanitized()
}

pub fn ramadan_settings_of(db: &nexa_widgets::WidgetDb) -> RamadanSettings {
    db.get_json::<RamadanSettings>("ramadan").ok().flatten().unwrap_or_default().sanitized()
}

/// Fajr/Maghrib for `count` days of Ramadan starting at `first` (Ramadan day 1 = `start`).
pub fn ramadan_times(svc: &mut PrayerService, start: NaiveDate, first: NaiveDate, count: u32) -> Vec<DayTimes> {
    let Ok(days) = svc.schedules_range(first, count) else { return vec![] };
    days.into_iter()
        .filter_map(|d| {
            Some(DayTimes {
                date: d.date,
                day_no: ((d.date - start).num_days() + 1).max(0) as u32,
                fajr: d.entry(Prayer::Fajr)?.time,
                maghrib: d.entry(Prayer::Maghrib)?.time,
            })
        })
        .collect()
}

// ----- calendar -------------------------------------------------------------

#[tauri::command]
pub fn calendar_settings(state: State<'_, AppState>) -> R<CalendarSettings> {
    let db = db!(state);
    Ok(calendar_settings_of(&db))
}

#[tauri::command]
pub fn calendar_save_settings(app: AppHandle, state: State<'_, AppState>, settings: CalendarSettings) -> R<CalendarSettings> {
    let s = settings.sanitized();
    db!(state).set_json("calendar", &s).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "calendar");
    Ok(s)
}

#[tauri::command]
pub fn calendar_month(state: State<'_, AppState>, year: i32, month: u32) -> R<Vec<DayInfo>> {
    let db = db!(state);
    let specials = db.special_days().map_err(e)?;
    Ok(calendar::month_days(year, month, &calendar_settings_of(&db), &specials))
}

#[tauri::command]
pub fn calendar_day(state: State<'_, AppState>, date: String) -> R<DayInfo> {
    let date = parse_date(&date)?;
    let db = db!(state);
    let specials = db.special_days().map_err(e)?;
    Ok(calendar::month_days(chrono::Datelike::year(&date), chrono::Datelike::month(&date), &calendar_settings_of(&db), &specials)
        .into_iter()
        .find(|d| d.date == date.format("%Y-%m-%d").to_string())
        .ok_or("date out of range")?)
}

#[tauri::command]
pub fn calendar_upcoming(state: State<'_, AppState>, from: String, days: i64, fasting: Option<bool>) -> R<Vec<Dated>> {
    let from = parse_date(&from)?;
    let db = db!(state);
    let specials = db.special_days().map_err(e)?;
    Ok(calendar::upcoming(from, days.clamp(1, 400), &calendar_settings_of(&db), &specials, fasting.unwrap_or(false)))
}

// ----- special days ---------------------------------------------------------

#[tauri::command]
pub fn special_list(state: State<'_, AppState>) -> R<Vec<SpecialDay>> {
    db!(state).special_days().map_err(e)
}

#[tauri::command]
pub fn special_save(app: AppHandle, state: State<'_, AppState>, special: SpecialInput) -> R<SpecialDay> {
    let s = db!(state).special_save(special).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "calendar");
    Ok(s)
}

#[tauri::command]
pub fn special_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    db!(state).special_delete(&id).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "calendar");
    Ok(())
}

// ----- profile --------------------------------------------------------------

#[tauri::command]
pub fn profile_get(state: State<'_, AppState>) -> R<Profile> {
    db!(state).profile().map_err(e)
}

#[tauri::command]
pub fn profile_save(app: AppHandle, state: State<'_, AppState>, profile: Profile) -> R<Profile> {
    let p = db!(state).profile_save(profile).map_err(e)?;
    changed(&app, "profile");
    Ok(p)
}

// ----- Ramadan ---------------------------------------------------------------

#[tauri::command]
pub fn ramadan_settings(state: State<'_, AppState>) -> R<RamadanSettings> {
    let db = db!(state);
    Ok(ramadan_settings_of(&db))
}

#[tauri::command]
pub fn ramadan_save_settings(app: AppHandle, state: State<'_, AppState>, settings: RamadanSettings) -> R<RamadanSettings> {
    let s = settings.sanitized();
    db!(state).set_json("ramadan", &s).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "ramadan");
    Ok(s)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamadanDay {
    pub date: String,
    pub day_no: u32,
    pub fajr: DateTime<Utc>,
    pub sehri_end: DateTime<Utc>,
    pub wake: DateTime<Utc>,
    pub maghrib: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamadanStatus {
    pub settings: RamadanSettings,
    pub hijri_year: i32,
    pub start: String,
    pub end: String,
    /// upcoming | during
    pub phase: &'static str,
    pub days_until: i64,
    /// 1-based day of Ramadan today (0 when not started).
    pub day_no: u32,
    pub days_left: i64,
    pub is_estimate: bool,
    /// Last day for which Sehri/Iftar alerts are already queued.
    pub queued_through: Option<String>,
    pub timetable: Vec<RamadanDay>,
}

#[tauri::command]
pub fn ramadan_status(state: State<'_, AppState>) -> R<RamadanStatus> {
    let now = Utc::now();
    let tz = local_tz();
    let today = now.with_timezone(&tz).date_naive();
    let (settings, adjust) = {
        let db = db!(state);
        (ramadan_settings_of(&db), calendar_settings_of(&db).hijri_adjust)
    };
    let (hy, start, end) = ramadan::current_or_next(today, adjust, &settings);
    let len = ((end - start).num_days() + 1) as u32;
    let timetable = {
        let mut svc = state.svc.lock().map_err(|_| "prayer service unavailable".to_string())?;
        ramadan_times(&mut svc, start, start, len)
    };
    let queued_through = plan_all(&state, now)
        .into_iter()
        .filter(|p| p.kind == "ramadan")
        .map(|p| p.fire_at.with_timezone(&tz).date_naive())
        .max()
        .map(|d| d.format("%Y-%m-%d").to_string());
    let during = today >= start;
    Ok(RamadanStatus {
        hijri_year: hy,
        start: start.format("%Y-%m-%d").to_string(),
        end: end.format("%Y-%m-%d").to_string(),
        phase: if during { "during" } else { "upcoming" },
        days_until: (start - today).num_days().max(0),
        day_no: if during { ((today - start).num_days() + 1) as u32 } else { 0 },
        days_left: if during { (end - today).num_days() } else { len as i64 },
        is_estimate: !(settings.override_year == Some(hy) && settings.override_start.is_some()),
        queued_through,
        timetable: timetable
            .iter()
            .map(|d| RamadanDay {
                date: d.date.format("%Y-%m-%d").to_string(),
                day_no: d.day_no,
                fajr: d.fajr,
                sehri_end: d.sehri_end(&settings),
                wake: d.wake(&settings),
                maghrib: d.maghrib,
            })
            .collect(),
        settings,
    })
}

#[allow(dead_code)]
fn _unused(_: Duration) {}

// ----- cycle tracker ---------------------------------------------------------

use nexa_widgets::cycle::{self, CycleData, CycleStatus};

pub fn cycle_of(db: &nexa_widgets::WidgetDb) -> CycleData {
    db.get_json::<CycleData>("cycle").ok().flatten().unwrap_or_default().sanitized()
}

#[tauri::command]
pub fn cycle_get(state: State<'_, AppState>) -> R<CycleData> {
    let db = db!(state);
    Ok(cycle_of(&db))
}

#[tauri::command]
pub fn cycle_save(app: AppHandle, state: State<'_, AppState>, data: CycleData) -> R<CycleData> {
    let data = data.sanitized();
    db!(state).set_json("cycle", &data).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "cycle");
    Ok(data)
}

#[tauri::command]
pub fn cycle_status(state: State<'_, AppState>) -> R<CycleStatus> {
    let today = Utc::now().with_timezone(&local_tz()).date_naive();
    let db = db!(state);
    Ok(cycle::status(&cycle_of(&db), today))
}

// ----- salah tracker ---------------------------------------------------------

use nexa_widgets::salah::{self, Qaza, SalahMark, SalahStats, SalahStatus};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalahOverview {
    pub marks: Vec<SalahMark>,
    pub stats: SalahStats,
    pub qaza: Qaza,
    pub today: String,
}

/// Marks between two dates (inclusive), with streak stats and the qaza count.
#[tauri::command]
pub fn salah_overview(state: State<'_, AppState>, from: String, to: String) -> R<SalahOverview> {
    let db = db!(state);
    let today = Utc::now().with_timezone(&local_tz()).date_naive();
    let all = db.salah_all().map_err(e)?;
    let stats = salah::stats(&all, today);
    let marks = db.salah_marks(&from, &to).map_err(e)?;
    Ok(SalahOverview { marks, stats, qaza: db.qaza().map_err(e)?, today: today.format("%Y-%m-%d").to_string() })
}

#[tauri::command]
pub fn salah_set(app: AppHandle, state: State<'_, AppState>, date: String, prayer: String, status: Option<SalahStatus>) -> R<Qaza> {
    let q = db!(state).salah_set(&date, &prayer, status).map_err(e)?;
    changed(&app, "salah");
    Ok(q)
}

#[tauri::command]
pub fn qaza_save(app: AppHandle, state: State<'_, AppState>, qaza: Qaza) -> R<Qaza> {
    let q = db!(state).qaza_save(qaza).map_err(e)?;
    changed(&app, "salah");
    Ok(q)
}

#[tauri::command]
pub fn qaza_made_up(app: AppHandle, state: State<'_, AppState>, prayer: String) -> R<Qaza> {
    let q = db!(state).qaza_made_up(&prayer).map_err(e)?;
    changed(&app, "salah");
    Ok(q)
}

// ----- fitness ---------------------------------------------------------------

use nexa_widgets::fitness::{self, FitnessData, FitnessProfile, FitnessSummary};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessOverview {
    pub data: FitnessData,
    pub summary: FitnessSummary,
}

pub fn fitness_of(db: &nexa_widgets::WidgetDb) -> FitnessData {
    db.get_json::<FitnessData>("fitness").ok().flatten().unwrap_or_default().sanitized()
}

fn fitness_store(app: &AppHandle, state: &State<'_, AppState>, data: FitnessData) -> R<FitnessOverview> {
    let data = data.sanitized();
    let profile_changed = { let db = db!(state); fitness_of(&db).profile != data.profile };
    db!(state).set_json("fitness", &data).map_err(e)?;
    // Only the weigh-in reminder depends on fitness data, and it reads the profile alone:
    // step and weight logs don't need the notifications re-planned.
    if profile_changed {
        state.refresh_scheduler();
    }
    changed(app, "fitness");
    let today = Utc::now().with_timezone(&local_tz()).date_naive();
    Ok(FitnessOverview { summary: fitness::summary(&data, today), data })
}

#[tauri::command]
pub fn fitness_get(state: State<'_, AppState>) -> R<FitnessOverview> {
    let data = { let db = db!(state); fitness_of(&db) };
    let today = Utc::now().with_timezone(&local_tz()).date_naive();
    Ok(FitnessOverview { summary: fitness::summary(&data, today), data })
}

#[tauri::command]
pub fn fitness_save_profile(app: AppHandle, state: State<'_, AppState>, profile: FitnessProfile) -> R<FitnessOverview> {
    let mut data = { let db = db!(state); fitness_of(&db) };
    data.profile = profile;
    fitness_store(&app, &state, data)
}

#[tauri::command]
pub fn fitness_log_weight(app: AppHandle, state: State<'_, AppState>, date: String, kg: Option<f64>) -> R<FitnessOverview> {
    parse_date(&date)?;
    let mut data = { let db = db!(state); fitness_of(&db) };
    data.log_weight(&date, kg);
    fitness_store(&app, &state, data)
}

#[tauri::command]
pub fn fitness_set_steps(app: AppHandle, state: State<'_, AppState>, date: String, steps: u32) -> R<FitnessOverview> {
    parse_date(&date)?;
    let mut data = { let db = db!(state); fitness_of(&db) };
    data.set_steps(&date, steps, "manual");
    fitness_store(&app, &state, data)
}

/// Pull the last week's step counts from the iPhone's motion chip (no-op elsewhere).
#[tauri::command]
pub async fn fitness_sync_steps(app: AppHandle, state: State<'_, AppState>) -> R<FitnessOverview> {
    // Reading the motion chip waits on iOS (up to a few seconds per day): do it on its own thread,
    // and never twice at once, so it can't hold up other calls.
    static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let counts = if BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
        Vec::new()
    } else {
        let r = tauri::async_runtime::spawn_blocking(|| crate::ios_motion::step_counts(7)).await;
        BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
        r.unwrap_or_default()
    };
    let before = { let db = db!(state); fitness_of(&db) };
    let mut data = before.clone();
    for (date, steps) in counts {
        data.set_steps(&date, steps, "motion");
    }
    let data = data.sanitized();
    // Battery: nothing new from the motion chip → no write, no event, no re-plan.
    if data == before {
        let today = Utc::now().with_timezone(&local_tz()).date_naive();
        return Ok(FitnessOverview { summary: fitness::summary(&data, today), data });
    }
    fitness_store(&app, &state, data)
}

#[tauri::command]
pub fn fitness_motion_available() -> bool {
    crate::ios_motion::available()
}

/// A report over the last `days` days: steps, energy, weight change and health checks.
#[tauri::command]
pub fn fitness_report(state: State<'_, AppState>, days: u32) -> R<fitness::FitnessReport> {
    let data = { let db = db!(state); fitness_of(&db) };
    let today = Utc::now().with_timezone(&local_tz()).date_naive();
    Ok(fitness::report(&data, today, days))
}
