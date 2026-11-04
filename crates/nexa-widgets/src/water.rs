//! Water intake log and hydration reminders.

use crate::db::{WidgetDb, WidgetResult};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WaterReminderMode {
    /// Every N minutes after the last drink / reminder.
    #[default]
    Interval,
    /// At fixed clock times (e.g. 09:00, 11:00, 13:00…).
    Times,
    /// Only when you fall behind the pace needed to reach the goal by the end of the day.
    Smart,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WaterSettings {
    pub goal_ml: u32,
    pub glass_ml: u32,
    pub reminders: bool,
    pub mode: WaterReminderMode,
    /// Interval mode: remind this long after the last drink (or the last reminder).
    pub remind_every_min: u32,
    /// Times mode: "HH:MM" local times.
    pub times: Vec<String>,
    /// Smart mode: never remind more often than this, nor this soon after a drink.
    pub min_gap_min: u32,
    /// Active hours, "HH:MM" local time.
    pub start: String,
    pub end: String,
}

impl Default for WaterSettings {
    fn default() -> Self {
        Self {
            goal_ml: 2000,
            glass_ml: 250,
            reminders: false,
            mode: WaterReminderMode::Interval,
            remind_every_min: 60,
            times: ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"].map(String::from).to_vec(),
            min_gap_min: 30,
            start: "09:00".into(),
            end: "21:00".into(),
        }
    }
}

impl WaterSettings {
    pub fn sanitized(mut self) -> Self {
        self.goal_ml = self.goal_ml.clamp(250, 10_000);
        self.glass_ml = self.glass_ml.clamp(50, 2_000);
        self.remind_every_min = self.remind_every_min.clamp(15, 480);
        self.min_gap_min = self.min_gap_min.clamp(10, 240);
        let mut times: Vec<NaiveTime> = self.times.iter().filter_map(|t| parse_hm(t)).collect();
        times.sort();
        times.dedup();
        times.truncate(24);
        self.times = times.iter().map(|t| t.format("%H:%M").to_string()).collect();
        if parse_hm(&self.start).is_none() {
            self.start = "09:00".into();
        }
        if parse_hm(&self.end).is_none() {
            self.end = "21:00".into();
        }
        self
    }
}

pub fn parse_hm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterEntry {
    pub id: i64,
    pub ml: i64,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterToday {
    pub date: NaiveDate,
    pub total_ml: i64,
    pub goal_ml: u32,
    pub entries: Vec<WaterEntry>,
    /// Totals for the last 7 days, oldest first (including today).
    pub week: Vec<(NaiveDate, i64)>,
}

fn day_bounds(date: NaiveDate, tz: Tz) -> (i64, i64) {
    let start = tz
        .from_local_datetime(&date.and_time(NaiveTime::MIN))
        .earliest()
        .map(|t| t.timestamp_millis())
        .unwrap_or(0);
    let next = date + Duration::days(1);
    let end = tz
        .from_local_datetime(&next.and_time(NaiveTime::MIN))
        .earliest()
        .map(|t| t.timestamp_millis())
        .unwrap_or(i64::MAX);
    (start, end)
}

impl WidgetDb {
    pub fn water_add(&self, ml: i64) -> WidgetResult<()> {
        let ml = ml.clamp(-2000, 2000);
        if ml == 0 {
            return Ok(());
        }
        self.conn
            .execute("INSERT INTO water (ml, at) VALUES (?1, ?2)", params![ml, crate::now_ms()])?;
        Ok(())
    }

    pub fn water_add_at(&self, ml: i64, at: DateTime<Utc>) -> WidgetResult<()> {
        self.conn
            .execute("INSERT INTO water (ml, at) VALUES (?1, ?2)", params![ml, at.timestamp_millis()])?;
        Ok(())
    }

    /// Remove the most recent entry of the day.
    pub fn water_undo(&self, now: DateTime<Utc>, tz: Tz) -> WidgetResult<()> {
        let (s, e) = day_bounds(now.with_timezone(&tz).date_naive(), tz);
        self.conn.execute(
            "DELETE FROM water WHERE id = (SELECT id FROM water WHERE at >= ?1 AND at < ?2 ORDER BY at DESC LIMIT 1)",
            params![s, e],
        )?;
        Ok(())
    }

    fn water_total(&self, date: NaiveDate, tz: Tz) -> WidgetResult<i64> {
        let (s, e) = day_bounds(date, tz);
        Ok(self.conn.query_row(
            "SELECT COALESCE(SUM(ml), 0) FROM water WHERE at >= ?1 AND at < ?2",
            params![s, e],
            |r| r.get(0),
        )?)
    }

    pub fn water_today(&self, now: DateTime<Utc>, tz: Tz, goal_ml: u32) -> WidgetResult<WaterToday> {
        let date = now.with_timezone(&tz).date_naive();
        let (s, e) = day_bounds(date, tz);
        let mut stmt = self
            .conn
            .prepare("SELECT id, ml, at FROM water WHERE at >= ?1 AND at < ?2 ORDER BY at")?;
        let entries = stmt
            .query_map(params![s, e], |r| Ok(WaterEntry { id: r.get(0)?, ml: r.get(1)?, at: r.get(2)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        let total_ml = entries.iter().map(|e| e.ml).sum::<i64>().max(0);
        let week = (0..7)
            .rev()
            .map(|i| {
                let d = date - Duration::days(i);
                Ok((d, self.water_total(d, tz)?.max(0)))
            })
            .collect::<WidgetResult<Vec<_>>>()?;
        Ok(WaterToday { date, total_ml, goal_ml, entries, week })
    }

    pub fn water_last_drink(&self) -> WidgetResult<Option<DateTime<Utc>>> {
        let at: Option<i64> = self
            .conn
            .query_row("SELECT MAX(at) FROM water WHERE ml > 0", [], |r| r.get(0))?;
        Ok(at.and_then(DateTime::from_timestamp_millis))
    }
}

/// Why a reminder is due (used for the notification text).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaterDue {
    pub at: DateTime<Utc>,
    /// Smart mode: how many ml behind the ideal pace (0 otherwise).
    pub behind_ml: i64,
}

/// Inputs for planning the next reminder.
#[derive(Debug, Clone, Copy)]
pub struct WaterState {
    pub now: DateTime<Utc>,
    pub last_drink: Option<DateTime<Utc>>,
    pub last_reminder: Option<DateTime<Utc>>,
    pub today_total_ml: i64,
}

/// Grace for a fixed time missed while the Mac slept.
const TIMES_GRACE_MIN: i64 = 15;

/// When the next hydration reminder is due (`at <= now` means "now").
pub fn next_water_reminder(s: &WaterSettings, st: WaterState, tz: Tz) -> Option<WaterDue> {
    if !s.reminders {
        return None;
    }
    let (start, end) = (parse_hm(&s.start)?, parse_hm(&s.end)?);
    if start >= end {
        return None;
    }
    let now = st.now;
    let today = now.with_timezone(&tz).date_naive();
    let at = |d: NaiveDate, t: NaiveTime| tz.from_local_datetime(&d.and_time(t)).earliest().map(|x| x.with_timezone(&Utc));
    let today_start = at(today, start)?;
    let today_end = at(today, end)?;
    let tomorrow = today + Duration::days(1);
    let goal_met = st.today_total_ml >= s.goal_ml as i64;
    let plain = |at: DateTime<Utc>| Some(WaterDue { at, behind_ml: 0 });

    match s.mode {
        WaterReminderMode::Times => {
            let times: Vec<NaiveTime> = s.times.iter().filter_map(|t| parse_hm(t)).collect();
            let first_tomorrow = times.first().and_then(|t| at(tomorrow, *t));
            if goal_met {
                return first_tomorrow.and_then(plain);
            }
            let after = st.last_reminder.unwrap_or(DateTime::<Utc>::MIN_UTC);
            times
                .iter()
                .filter_map(|t| at(today, *t))
                .find(|t| *t > after && *t >= now - Duration::minutes(TIMES_GRACE_MIN))
                .or(first_tomorrow)
                .and_then(plain)
        }
        WaterReminderMode::Interval => {
            let interval = Duration::minutes(s.remind_every_min as i64);
            let tomorrow_first = at(tomorrow, start)? + interval;
            if goal_met || now >= today_end {
                return plain(tomorrow_first);
            }
            let last_event = match (st.last_drink, st.last_reminder) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            };
            let base = last_event.filter(|t| *t >= today_start).unwrap_or(today_start);
            let next = (base + interval).max(now);
            if next >= today_end {
                return plain(tomorrow_first);
            }
            plain(next)
        }
        WaterReminderMode::Smart => {
            let gap = Duration::minutes(s.min_gap_min as i64);
            let tomorrow_first = at(tomorrow, start)? + gap;
            if goal_met || now >= today_end {
                return plain(tomorrow_first);
            }
            let span = (today_end - today_start).num_seconds() as f64;
            let goal = s.goal_ml as f64;
            let expected_at = |t: DateTime<Utc>| goal * ((t - today_start).num_seconds() as f64 / span).clamp(0.0, 1.0);
            // When the ideal pace gets half a glass ahead of what you drank.
            let target = st.today_total_ml as f64 + s.glass_ml as f64 / 2.0;
            let due_secs = (target / goal).clamp(0.0, 1.0) * span;
            let mut due = today_start + Duration::seconds(due_secs as i64);
            if let Some(d) = st.last_drink.filter(|d| *d >= today_start) {
                due = due.max(d + gap);
            }
            if let Some(r) = st.last_reminder.filter(|r| *r >= today_start) {
                due = due.max(r + gap);
            }
            due = due.max(today_start + gap);
            if due >= today_end {
                return plain(tomorrow_first);
            }
            let at_time = due.max(now);
            let behind = (expected_at(at_time) - st.today_total_ml as f64).max(0.0).round() as i64;
            Some(WaterDue { at: at_time, behind_ml: behind })
        }
    }
}
