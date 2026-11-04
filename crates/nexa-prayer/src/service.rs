//! High-level API used by the app: settings, locations, schedules (memory-cached),
//! reminder planning and the delivered-notification log, all backed by SQLite.

use crate::cities;
use crate::error::{PrayerError, Result};
use crate::models::*;
use crate::reminders;
use crate::schedule::{self, local_date, parse_tz};
use crate::store::Store;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

pub const DEVICE_LOCATION_ID: &str = "device";
const K_CALC: &str = "calculation";
const K_MANUAL: &str = "manual";
const K_DISPLAY: &str = "display";
const K_MODE: &str = "location.mode";
const K_ACTIVE: &str = "location.active";
const CACHE_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrayerSettings {
    pub calculation: PrayerCalculationSettings,
    pub manual: ManualTimetable,
    pub notifications: PrayerNotificationSettings,
    pub display: PrayerDisplaySettings,
    pub location_mode: LocationMode,
    pub active_location_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerSnapshot {
    pub settings: PrayerSettings,
    pub locations: Vec<PrayerLocation>,
    pub active_location: PrayerLocation,
    pub today: DailyPrayerSchedule,
    pub tomorrow: DailyPrayerSchedule,
    pub next: Option<NextPrayer>,
    pub methods: Vec<MethodInfo>,
    pub now: DateTime<Utc>,
}

fn adjust_key(location_id: &str) -> String {
    format!("adjust.{location_id}")
}

/// Time adjustments that belong to one location (mosque timetables differ).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocationAdjustments {
    pub offsets: PrayerOffsets,
    pub manual: ManualTimetable,
    pub mode: TimetableMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PrayerAdjust {
    /// Minutes added to the calculated time (negative = earlier).
    Offset { minutes: i32 },
    /// A fixed "HH:MM" time every day.
    Fixed { time: String },
    /// Back to the calculated time.
    Reset,
}

pub struct PrayerService {
    store: Store,
    cache: HashMap<(u64, NaiveDate), DailyPrayerSchedule>,
}

impl PrayerService {
    /// `system_timezone` (IANA) seeds a sensible first location on first launch.
    pub fn new(store: Store, system_timezone: &str) -> Result<Self> {
        let mut svc = Self {
            store,
            cache: HashMap::new(),
        };
        svc.seed(system_timezone)?;
        Ok(svc)
    }

    fn seed(&mut self, system_timezone: &str) -> Result<()> {
        if self.store.locations()?.is_empty() {
            let loc = default_location_for_timezone(system_timezone);
            self.store.upsert_location(&loc)?;
            self.store.set_json(K_ACTIVE, &loc.id)?;
        }
        if self.store.notification_settings()?.is_none() {
            self.store
                .save_notification_settings(&PrayerNotificationSettings::default())?;
        }
        Ok(())
    }

    // ----- settings -------------------------------------------------------

    /// Global calculation settings with the active location's own
    /// minute adjustments and timetable mode applied.
    pub fn calculation(&self) -> Result<PrayerCalculationSettings> {
        let mut c: PrayerCalculationSettings = self.store.get_json(K_CALC)?.unwrap_or_default();
        let adj = self.adjustments(&self.active_location()?.id)?;
        c.offsets = adj.offsets;
        c.mode = adj.mode;
        Ok(c)
    }

    /// Saves the method/Asr/high-latitude settings globally and the minute
    /// adjustments + timetable mode for the active location only.
    pub fn set_calculation(&mut self, s: PrayerCalculationSettings) -> Result<PrayerCalculationSettings> {
        let s = s.sanitized();
        self.store.set_json(K_CALC, &s)?;
        let id = self.active_location()?.id;
        let mut adj = self.adjustments(&id)?;
        adj.offsets = s.offsets;
        adj.mode = s.mode;
        self.store.set_json(&adjust_key(&id), &adj)?;
        self.cache.clear();
        Ok(s)
    }

    /// The active location's manual timetable.
    pub fn manual(&self) -> Result<ManualTimetable> {
        Ok(self.adjustments(&self.active_location()?.id)?.manual)
    }

    pub fn set_manual(&mut self, m: ManualTimetable) -> Result<ManualTimetable> {
        for p in Prayer::ALL {
            if let Some(v) = m.get(p) {
                if parse_hhmm(v).is_none() {
                    return Err(PrayerError::InvalidInput(format!(
                        "{}: '{v}' is not a valid HH:MM time",
                        p.name()
                    )));
                }
            }
        }
        let id = self.active_location()?.id;
        let mut adj = self.adjustments(&id)?;
        adj.manual = m.clone();
        self.store.set_json(&adjust_key(&id), &adj)?;
        self.cache.clear();
        Ok(m)
    }

    /// Per-location adjustments. Locations saved before adjustments became
    /// per-location inherit the old global values once.
    pub fn adjustments(&self, location_id: &str) -> Result<LocationAdjustments> {
        if let Some(a) = self.store.get_json::<LocationAdjustments>(&adjust_key(location_id))? {
            return Ok(a);
        }
        let legacy: PrayerCalculationSettings = self.store.get_json(K_CALC)?.unwrap_or_default();
        Ok(LocationAdjustments {
            offsets: legacy.offsets,
            mode: legacy.mode,
            manual: self.store.get_json(K_MANUAL)?.unwrap_or_default(),
        })
    }

    /// Change one prayer's time at the active location: shift the calculated
    /// time by minutes, pin it to a fixed time, or reset it.
    pub fn adjust_prayer(&mut self, prayer: Prayer, change: PrayerAdjust) -> Result<LocationAdjustments> {
        let id = self.active_location()?.id;
        let mut adj = self.adjustments(&id)?;
        let is_fixed = matches!(change, PrayerAdjust::Fixed { .. });
        match change {
            PrayerAdjust::Offset { minutes } => {
                adj.offsets.set(prayer, minutes.clamp(-120, 120));
                adj.manual.set(prayer, None);
            }
            PrayerAdjust::Fixed { time } => {
                let (h, m) = parse_hhmm(&time).ok_or_else(|| {
                    PrayerError::InvalidInput(format!("'{time}' is not a valid HH:MM time"))
                })?;
                adj.manual.set(prayer, Some(format!("{h:02}:{m:02}")));
                adj.mode = TimetableMode::Manual;
            }
            PrayerAdjust::Reset => {
                adj.offsets.set(prayer, 0);
                adj.manual.set(prayer, None);
            }
        }
        // Manual mode only while at least one fixed time exists.
        if Prayer::ALL.iter().all(|p| adj.manual.get(*p).is_none()) {
            adj.mode = TimetableMode::Calculated;
        } else if is_fixed {
            adj.mode = TimetableMode::Manual;
        }
        self.store.set_json(&adjust_key(&id), &adj)?;
        self.cache.clear();
        Ok(adj)
    }

    pub fn display(&self) -> Result<PrayerDisplaySettings> {
        Ok(self.store.get_json::<PrayerDisplaySettings>(K_DISPLAY)?.unwrap_or_default())
    }

    pub fn set_display(&mut self, d: PrayerDisplaySettings) -> Result<PrayerDisplaySettings> {
        let d = d.sanitized();
        self.store.set_json(K_DISPLAY, &d)?;
        Ok(d)
    }

    pub fn notifications(&self) -> Result<PrayerNotificationSettings> {
        Ok(self.store.notification_settings()?.unwrap_or_default().sanitized())
    }

    pub fn set_notifications(&mut self, n: PrayerNotificationSettings) -> Result<PrayerNotificationSettings> {
        let n = n.sanitized();
        self.store.save_notification_settings(&n)?;
        Ok(n)
    }

    pub fn location_mode(&self) -> Result<LocationMode> {
        Ok(self.store.get_json(K_MODE)?.unwrap_or_default())
    }

    pub fn set_location_mode(&mut self, mode: LocationMode) -> Result<()> {
        self.store.set_json(K_MODE, &mode)
    }

    pub fn settings(&self) -> Result<PrayerSettings> {
        Ok(PrayerSettings {
            calculation: self.calculation()?,
            manual: self.manual()?,
            notifications: self.notifications()?,
            display: self.display()?,
            location_mode: self.location_mode()?,
            active_location_id: self.active_location()?.id,
        })
    }

    // ----- locations ------------------------------------------------------

    pub fn locations(&self) -> Result<Vec<PrayerLocation>> {
        self.store.locations()
    }

    /// The location used for calculations right now.
    pub fn active_location(&self) -> Result<PrayerLocation> {
        let locations = self.store.locations()?;
        if self.location_mode()? == LocationMode::Automatic {
            if let Some(device) = locations.iter().find(|l| l.id == DEVICE_LOCATION_ID) {
                return Ok(device.clone());
            }
        }
        let active: Option<String> = self.store.get_json(K_ACTIVE)?;
        active
            .and_then(|id| locations.iter().find(|l| l.id == id).cloned())
            .or_else(|| locations.iter().find(|l| l.id != DEVICE_LOCATION_ID).cloned())
            .or_else(|| locations.first().cloned())
            .ok_or_else(|| PrayerError::NotFound("no saved location".into()))
    }

    pub fn save_location(&mut self, mut loc: PrayerLocation, make_active: bool) -> Result<PrayerLocation> {
        parse_tz(&loc.timezone)?;
        if !(loc.latitude.is_finite()
            && loc.longitude.is_finite()
            && (-90.0..=90.0).contains(&loc.latitude)
            && (-180.0..=180.0).contains(&loc.longitude))
        {
            return Err(PrayerError::InvalidInput("Latitude must be −90…90 and longitude −180…180".into()));
        }
        loc.name = loc.name.trim().to_string();
        if loc.name.is_empty() {
            loc.name = format!("{:.3}, {:.3}", loc.latitude, loc.longitude);
        }
        if loc.id.trim().is_empty() {
            loc.id = uuid::Uuid::new_v4().to_string();
        }
        loc.elevation = if loc.elevation.is_finite() { loc.elevation.clamp(0.0, 9000.0) } else { 0.0 };
        self.store.upsert_location(&loc)?;
        if make_active && loc.id != DEVICE_LOCATION_ID {
            self.store.set_json(K_ACTIVE, &loc.id)?;
            self.store.set_json(K_MODE, &LocationMode::Saved)?;
        }
        self.cache.clear();
        Ok(loc)
    }

    pub fn set_active_location(&mut self, id: &str) -> Result<()> {
        if self.store.location(id)?.is_none() {
            return Err(PrayerError::NotFound(format!("location {id}")));
        }
        self.store.set_json(K_ACTIVE, &id.to_string())?;
        if id != DEVICE_LOCATION_ID {
            self.store.set_json(K_MODE, &LocationMode::Saved)?;
        } else {
            self.store.set_json(K_MODE, &LocationMode::Automatic)?;
        }
        Ok(())
    }

    pub fn delete_location(&mut self, id: &str) -> Result<()> {
        let saved: Vec<_> = self
            .store
            .locations()?
            .into_iter()
            .filter(|l| l.id != DEVICE_LOCATION_ID)
            .collect();
        if id != DEVICE_LOCATION_ID && saved.len() <= 1 {
            return Err(PrayerError::InvalidInput("Keep at least one saved location".into()));
        }
        self.store.delete_location(id)?;
        let active: Option<String> = self.store.get_json(K_ACTIVE)?;
        if active.as_deref() == Some(id) {
            if let Some(first) = saved.iter().find(|l| l.id != id) {
                self.store.set_json(K_ACTIVE, &first.id)?;
            }
        }
        if id == DEVICE_LOCATION_ID {
            self.store.set_json(K_MODE, &LocationMode::Saved)?;
        }
        self.cache.clear();
        Ok(())
    }

    /// Store the Mac's current position (rounded to ~11 m). Its name and time
    /// zone come from the nearest city in the offline list — nothing is sent anywhere.
    pub fn set_device_location(&mut self, latitude: f64, longitude: f64) -> Result<PrayerLocation> {
        let round = |v: f64| (v * 10_000.0).round() / 10_000.0;
        let (name, region, country, timezone) = match cities::nearest(latitude, longitude) {
            Some((c, km)) if km < 150.0 => (format!("Near {}", c.name), c.region, c.country, c.timezone),
            Some((c, _)) => ("Current location".to_string(), String::new(), c.country, c.timezone),
            None => ("Current location".to_string(), String::new(), String::new(), "UTC".to_string()),
        };
        let loc = PrayerLocation {
            id: DEVICE_LOCATION_ID.into(),
            name,
            region,
            country,
            latitude: round(latitude),
            longitude: round(longitude),
            timezone,
            elevation: 0.0,
            source: LocationSource::Device,
        };
        let loc = self.save_location(loc, false)?;
        self.store.set_json(K_MODE, &LocationMode::Automatic)?;
        Ok(loc)
    }

    // ----- schedules ------------------------------------------------------

    fn fingerprint(loc: &PrayerLocation, calc: &PrayerCalculationSettings, manual: &ManualTimetable) -> u64 {
        let mut h = DefaultHasher::new();
        serde_json::to_string(&(loc, calc, manual))
            .unwrap_or_default()
            .hash(&mut h);
        h.finish()
    }

    pub fn schedule_for(&mut self, date: NaiveDate) -> Result<DailyPrayerSchedule> {
        let loc = self.active_location()?;
        let calc = self.calculation()?;
        let manual = self.manual()?;
        self.schedule_with(date, &loc, &calc, &manual)
    }

    fn schedule_with(
        &mut self,
        date: NaiveDate,
        loc: &PrayerLocation,
        calc: &PrayerCalculationSettings,
        manual: &ManualTimetable,
    ) -> Result<DailyPrayerSchedule> {
        let key = (Self::fingerprint(loc, calc, manual), date);
        if let Some(s) = self.cache.get(&key) {
            return Ok(s.clone());
        }
        let s = schedule::build_schedule(date, loc, calc, manual)?;
        if self.cache.len() >= CACHE_LIMIT {
            self.cache.clear();
        }
        self.cache.insert(key, s.clone());
        Ok(s)
    }

    pub fn schedules_range(&mut self, start: NaiveDate, days: u32) -> Result<Vec<DailyPrayerSchedule>> {
        let loc = self.active_location()?;
        let calc = self.calculation()?;
        let manual = self.manual()?;
        (0..days)
            .map(|i| self.schedule_with(start + Duration::days(i as i64), &loc, &calc, &manual))
            .collect()
    }

    pub fn month(&mut self, year: i32, month: u32) -> Result<Vec<DailyPrayerSchedule>> {
        let first = NaiveDate::from_ymd_opt(year, month, 1)
            .ok_or_else(|| PrayerError::InvalidInput("invalid month".into()))?;
        let next = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)
        }
        .expect("valid date");
        let days = (next - first).num_days() as u32;
        self.schedules_range(first, days)
    }

    pub fn today(&self, now: DateTime<Utc>) -> Result<NaiveDate> {
        Ok(local_date(now, parse_tz(&self.active_location()?.timezone)?))
    }

    pub fn snapshot(&mut self, now: DateTime<Utc>) -> Result<PrayerSnapshot> {
        let settings = self.settings()?;
        let active = self.active_location()?;
        let today_date = local_date(now, parse_tz(&active.timezone)?);
        let days = self.schedules_range(today_date, 2)?;
        let next = schedule::next_prayer(&days, now, false);
        let mut it = days.into_iter();
        let today = it.next().expect("2 days");
        let tomorrow = it.next().expect("2 days");
        let methods = CalculationMethod::ALL
            .iter()
            .map(|m| m.info(&settings.calculation))
            .collect();
        Ok(PrayerSnapshot {
            settings,
            locations: self.locations()?,
            active_location: active,
            today,
            tomorrow,
            next,
            methods,
            now,
        })
    }

    // ----- reminders ------------------------------------------------------

    /// Upcoming notifications from `now - grace` up to `horizon` ahead.
    pub fn plan(&mut self, now: DateTime<Utc>, horizon: Duration, limit: usize) -> Result<Vec<PlannedReminder>> {
        let loc = self.active_location()?;
        let tz = parse_tz(&loc.timezone)?;
        let notifications = self.notifications()?;
        let display = self.display()?;
        let start = local_date(now, tz) - Duration::days(1);
        let days = (horizon.num_days() + 3).clamp(3, 62) as u32;
        let schedules = self.schedules_range(start, days)?;
        let grace = Duration::minutes(notifications.grace_minutes as i64);
        Ok(reminders::plan(
            &schedules,
            &notifications,
            tz,
            display.use_24_hour,
            now - grace,
            now + horizon,
            limit,
        ))
    }

    /// Reminders to show now. Each is recorded in the delivered log *before* it
    /// is returned, so it can never be shown twice — even across restarts.
    pub fn take_due(&mut self, now: DateTime<Utc>) -> Result<(Vec<PlannedReminder>, Vec<PlannedReminder>)> {
        let planned = self.plan(now, Duration::hours(48), 500)?;
        let grace = Duration::minutes(self.notifications()?.grace_minutes as i64);
        let since = planned
            .iter()
            .map(|p| p.date)
            .min()
            .unwrap_or_else(|| now.date_naive() - Duration::days(1));
        let delivered = self.store.delivered_ids(since)?;
        let mut due = Vec::new();
        for p in reminders::due(&planned, now, grace, &delivered) {
            if self.store.mark_delivered(&p.id, p.date)? {
                due.push(p.clone());
            }
        }
        let upcoming = planned.into_iter().filter(|p| p.fire_at > now).collect();
        Ok((due, upcoming))
    }

    pub fn prune(&self, now: DateTime<Utc>) -> Result<usize> {
        self.store.prune_delivered(now.date_naive() - Duration::days(4))
    }

    pub fn store(&self) -> &Store {
        &self.store
    }
}

/// First-launch location: the most populous city in the Mac's time zone (offline).
pub fn default_location_for_timezone(tz: &str) -> PrayerLocation {
    let city = crate::cities::largest_in_timezone(tz).or_else(|| crate::cities::largest_in_timezone("Asia/Dhaka"));
    match city {
        Some(c) => PrayerLocation {
            id: uuid::Uuid::new_v4().to_string(),
            name: c.name,
            region: c.region,
            country: c.country,
            latitude: c.latitude,
            longitude: c.longitude,
            timezone: c.timezone,
            elevation: 0.0,
            source: LocationSource::Search,
        },
        None => PrayerLocation {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Makkah".into(),
            region: String::new(),
            country: "Saudi Arabia".into(),
            latitude: 21.4225,
            longitude: 39.8262,
            timezone: "Asia/Riyadh".into(),
            elevation: 0.0,
            source: LocationSource::Manual,
        },
    }
}

/// Days in the month of `date` (helper for UIs).
pub fn days_in_month(date: NaiveDate) -> u32 {
    let (y, m) = (date.year(), date.month());
    let next = if m == 12 { NaiveDate::from_ymd_opt(y + 1, 1, 1) } else { NaiveDate::from_ymd_opt(y, m + 1, 1) };
    (next.expect("valid") - NaiveDate::from_ymd_opt(y, m, 1).expect("valid")).num_days() as u32
}
