//! Personal reminders (table `custom_reminders`; `reminders` belongs to the prayer engine) ("Call mum", "Take vitamins", "Jumu'ah prep"): a title,
//! an optional note, a first date-time and an optional repeat rule. The app turns
//! them into scheduled local notifications with a sound.

use crate::db::{WidgetDb, WidgetError, WidgetResult};
use chrono::{DateTime, Datelike, Duration, NaiveDateTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Repeat {
    #[default]
    Never,
    Daily,
    /// Monday–Friday.
    Weekdays,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub note: String,
    /// First occurrence, local wall-clock time "YYYY-MM-DDTHH:MM".
    pub at: String,
    pub repeat: Repeat,
    pub enabled: bool,
    /// Sound file name (see the app's sound list) or "none".
    pub sound: String,
    pub color: String,
    pub created_at: i64,
    /// Extra alerts this many minutes before each occurrence (largest first, up to 5).
    #[serde(default)]
    pub before: Vec<u32>,
    /// Also alert at the exact time (on unless the user only wants the early alerts).
    #[serde(default = "yes")]
    pub exact: bool,
    /// At the exact time, ring like an alarm until stopped (iPhone: AlarmKit, iOS 26+).
    #[serde(default)]
    pub alarm: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub note: String,
    pub at: String,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub sound: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub before: Vec<u32>,
    #[serde(default = "yes")]
    pub exact: bool,
    #[serde(default)]
    pub alarm: bool,
}

/// Up to 5 distinct offsets, 1 minute to 7 days, largest first.
pub fn clean_before(list: &[u32]) -> Vec<u32> {
    let mut v: Vec<u32> = list.iter().copied().filter(|m| (1..=7 * 24 * 60).contains(m)).collect();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.dedup();
    v.truncate(5);
    v
}

/// "10 min", "1 h 30 min", "2 days" — for alert titles.
pub fn before_label(min: u32) -> String {
    let (d, h, m) = (min / 1440, (min % 1440) / 60, min % 60);
    let mut parts = Vec::new();
    if d > 0 {
        parts.push(format!("{d} day{}", if d == 1 { "" } else { "s" }));
    }
    if h > 0 {
        parts.push(format!("{h} h"));
    }
    if m > 0 {
        parts.push(format!("{m} min"));
    }
    parts.join(" ")
}

fn yes() -> bool {
    true
}

pub fn parse_local(at: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M")
        .or_else(|_| NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M:%S"))
        .ok()
}

/// Occurrences of `r` within `[from, until]`, soonest first, at most `limit`.
pub fn occurrences(r: &Reminder, tz: Tz, from: DateTime<Utc>, until: DateTime<Utc>, limit: usize) -> Vec<DateTime<Utc>> {
    let mut out = Vec::new();
    if !r.enabled || limit == 0 {
        return out;
    }
    let Some(first) = parse_local(&r.at) else { return out };
    let to_utc = |n: NaiveDateTime| tz.from_local_datetime(&n).earliest().map(|d| d.with_timezone(&Utc));

    if r.repeat == Repeat::Never {
        if let Some(t) = to_utc(first) {
            if t >= from && t <= until {
                out.push(t);
            }
        }
        return out;
    }

    // Walk forward one step at a time; skip quickly to the window for daily-ish rules.
    let mut cur = first;
    let from_local = from.with_timezone(&tz).naive_local();
    if cur < from_local && matches!(r.repeat, Repeat::Daily | Repeat::Weekdays | Repeat::Weekly) {
        let step = if r.repeat == Repeat::Weekly { 7 } else { 1 };
        let behind = (from_local - cur).num_days() / step;
        if behind > 1 {
            cur += Duration::days((behind - 1) * step);
        }
    }
    let mut guard = 0;
    while out.len() < limit && guard < 5000 {
        guard += 1;
        let ok_day = r.repeat != Repeat::Weekdays || !matches!(cur.weekday(), Weekday::Sat | Weekday::Sun);
        if let Some(t) = to_utc(cur) {
            if t > until {
                break;
            }
            if ok_day && t >= from {
                out.push(t);
            }
        }
        cur = match r.repeat {
            Repeat::Daily | Repeat::Weekdays => cur + Duration::days(1),
            Repeat::Weekly => cur + Duration::days(7),
            Repeat::Monthly => {
                let (y, m) = if cur.month() == 12 { (cur.year() + 1, 1) } else { (cur.year(), cur.month() + 1) };
                // Clamp the day (31st → last day of a shorter month).
                let mut day = first.day();
                loop {
                    if let Some(d) = chrono::NaiveDate::from_ymd_opt(y, m, day) {
                        break d.and_time(first.time());
                    }
                    day -= 1;
                }
            }
            Repeat::Never => break,
        };
    }
    out
}

impl WidgetDb {
    pub fn reminders(&self) -> WidgetResult<Vec<Reminder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, note, at, repeat, enabled, sound, color, created_at, before, exact, alarm FROM custom_reminders ORDER BY at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let repeat: String = r.get(4)?;
            Ok(Reminder {
                id: r.get(0)?,
                title: r.get(1)?,
                note: r.get(2)?,
                at: r.get(3)?,
                repeat: serde_json::from_str(&format!("\"{repeat}\"")).unwrap_or_default(),
                enabled: r.get(5)?,
                sound: r.get(6)?,
                color: r.get(7)?,
                created_at: r.get(8)?,
                before: r.get::<_, String>(9)?.split(',').filter_map(|x| x.trim().parse().ok()).collect(),
                exact: r.get(10)?,
                alarm: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn reminder_save(&self, input: ReminderInput) -> WidgetResult<Reminder> {
        let title: String = input.title.trim().chars().take(200).collect();
        if title.is_empty() {
            return Err(WidgetError::Invalid("Give the reminder a title".into()));
        }
        let at = parse_local(&input.at)
            .ok_or_else(|| WidgetError::Invalid(format!("'{}' is not a valid date and time", input.at)))?;
        let existing = match &input.id {
            Some(id) => self.reminders()?.into_iter().find(|r| &r.id == id),
            None => None,
        };
        let r = Reminder {
            id: existing.as_ref().map(|r| r.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            title,
            note: input.note.trim().chars().take(1000).collect(),
            at: at.format("%Y-%m-%dT%H:%M").to_string(),
            repeat: input.repeat,
            enabled: input.enabled,
            sound: if input.sound.trim().is_empty() { "default".into() } else { input.sound.trim().into() },
            color: if input.color.trim().is_empty() { "#7c9cff".into() } else { input.color.trim().chars().take(16).collect() },
            created_at: existing.map(|r| r.created_at).unwrap_or_else(crate::now_ms),
            before: clean_before(&input.before),
            // Never leave a reminder with no alert at all.
            exact: input.exact || input.alarm || clean_before(&input.before).is_empty(),
            alarm: input.alarm,
        };
        let before = r.before.iter().map(|m| m.to_string()).collect::<Vec<_>>().join(",");
        let repeat = serde_json::to_string(&r.repeat)?.trim_matches('"').to_string();
        self.conn.execute(
            "INSERT INTO custom_reminders (id, title, note, at, repeat, enabled, sound, color, created_at, before, exact, alarm)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, note = excluded.note, at = excluded.at,
               repeat = excluded.repeat, enabled = excluded.enabled, sound = excluded.sound, color = excluded.color,
               before = excluded.before, exact = excluded.exact, alarm = excluded.alarm",
            params![r.id, r.title, r.note, r.at, repeat, r.enabled, r.sound, r.color, r.created_at, before, r.exact, r.alarm],
        )?;
        Ok(r)
    }

    pub fn reminder_set_enabled(&self, id: &str, enabled: bool) -> WidgetResult<()> {
        let n = self
            .conn
            .execute("UPDATE custom_reminders SET enabled = ?2 WHERE id = ?1", params![id, enabled])?;
        if n == 0 {
            return Err(WidgetError::NotFound("reminder".into()));
        }
        Ok(())
    }

    pub fn reminder_delete(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM custom_reminders WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rem(at: &str, repeat: Repeat) -> Reminder {
        Reminder {
            id: "x".into(),
            title: "t".into(),
            note: String::new(),
            at: at.into(),
            repeat,
            enabled: true,
            sound: "default".into(),
            color: String::new(),
            created_at: 0,
            before: vec![],
            exact: true,
            alarm: false,
        }
    }

    #[test]
    fn once_and_daily() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap();
        let until = from + Duration::days(3);
        let once = occurrences(&rem("2026-11-01T09:30", Repeat::Never), tz, from, until, 10);
        assert_eq!(once, vec![Utc.with_ymd_and_hms(2026, 11, 1, 3, 30, 0).unwrap()]);
        let daily = occurrences(&rem("2026-01-01T09:30", Repeat::Daily), tz, from, until, 10);
        assert_eq!(daily.len(), 3);
        assert_eq!(daily[0], Utc.with_ymd_and_hms(2026, 11, 1, 3, 30, 0).unwrap());
    }

    #[test]
    fn weekdays_skip_weekend_and_monthly_clamps() {
        let tz: Tz = "UTC".parse().unwrap();
        // 2026-11-06 is a Friday.
        let from = Utc.with_ymd_and_hms(2026, 11, 6, 0, 0, 0).unwrap();
        let wd = occurrences(&rem("2026-11-02T08:00", Repeat::Weekdays), tz, from, from + Duration::days(4), 10);
        let days: Vec<u32> = wd.iter().map(|d| d.day()).collect();
        assert_eq!(days, vec![6, 9]);
        let m = occurrences(&rem("2026-01-31T08:00", Repeat::Monthly), tz, Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap(), Utc.with_ymd_and_hms(2026, 4, 30, 0, 0, 0).unwrap(), 10);
        let days: Vec<(u32, u32)> = m.iter().map(|d| (d.month(), d.day())).collect();
        assert_eq!(days, vec![(2, 28), (3, 31)]);
    }

    #[test]
    fn crud() {
        let db = WidgetDb::open_in_memory().unwrap();
        let r = db
            .reminder_save(ReminderInput {
                id: None,
                title: " Vitamins ".into(),
                note: String::new(),
                at: "2026-11-01T08:00".into(),
                repeat: Repeat::Daily,
                enabled: true,
                sound: String::new(),
                color: String::new(),
                before: vec![10, 30, 10, 0],
                exact: false,
                alarm: false,
            })
            .unwrap();
        assert_eq!(r.title, "Vitamins");
        assert_eq!(r.before, vec![30, 10], "sorted, de-duplicated, zero dropped");
        assert!(!r.exact);
        let back = &db.reminders().unwrap()[0];
        assert_eq!(back.before, vec![30, 10]);
        assert!(!back.exact);
        assert_eq!(before_label(90), "1 h 30 min");
        assert_eq!(before_label(1440), "1 day");
        assert_eq!(db.reminders().unwrap()[0].repeat, Repeat::Daily);
        db.reminder_set_enabled(&r.id, false).unwrap();
        assert!(!db.reminders().unwrap()[0].enabled);
        db.reminder_delete(&r.id).unwrap();
        assert!(db.reminders().unwrap().is_empty());
    }
}
