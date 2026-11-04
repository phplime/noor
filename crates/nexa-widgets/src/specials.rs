//! Special days the user adds to the calendar (birthdays, anniversaries, a
//! Hijri date such as "Ashura"), repeating every year, with an optional alert.

use crate::calendar::{date_for_hijri, hijri_for, hijri_month_len};
use crate::db::{WidgetDb, WidgetError, WidgetResult};
use chrono::{Datelike, NaiveDate, NaiveTime};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DateKind {
    #[default]
    Gregorian,
    Hijri,
}

impl DateKind {
    fn as_str(self) -> &'static str {
        match self {
            DateKind::Gregorian => "gregorian",
            DateKind::Hijri => "hijri",
        }
    }
    fn parse(s: &str) -> Self {
        if s == "hijri" { DateKind::Hijri } else { DateKind::Gregorian }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDay {
    pub id: String,
    pub title: String,
    pub note: String,
    pub calendar: DateKind,
    pub month: u32,
    pub day: u32,
    /// Set for a one-off day (Gregorian or Hijri year, as per `calendar`); None = every year.
    pub year: Option<i32>,
    pub alert: bool,
    /// Local "HH:MM".
    pub alert_time: String,
    /// Alert this many days before (0 = on the day).
    pub days_before: u32,
    pub sound: String,
    pub color: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub calendar: DateKind,
    pub month: u32,
    pub day: u32,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub alert: bool,
    #[serde(default)]
    pub alert_time: String,
    #[serde(default)]
    pub days_before: u32,
    #[serde(default)]
    pub sound: String,
    #[serde(default)]
    pub color: String,
}

pub fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").ok()
}

impl SpecialDay {
    /// Gregorian dates in `[start, end]` on which this day falls.
    pub fn dates_between(&self, start: NaiveDate, end: NaiveDate, adjust: i32) -> Vec<NaiveDate> {
        let mut out = Vec::new();
        match self.calendar {
            DateKind::Gregorian => {
                for y in start.year()..=end.year() {
                    if self.year.is_some_and(|only| only != y) {
                        continue;
                    }
                    // 29 Feb falls back to 28 Feb in common years
                    let date = NaiveDate::from_ymd_opt(y, self.month, self.day).or_else(|| NaiveDate::from_ymd_opt(y, self.month, self.day - 1));
                    if let Some(d) = date.filter(|d| *d >= start && *d <= end) {
                        out.push(d);
                    }
                }
            }
            DateKind::Hijri => {
                let (h0, h1) = (hijri_for(start, adjust).year - 1, hijri_for(end, adjust).year + 1);
                for hy in h0..=h1 {
                    if self.year.is_some_and(|only| only != hy) {
                        continue;
                    }
                    let day = self.day.min(hijri_month_len(hy, self.month));
                    let d = date_for_hijri(hy, self.month, day, adjust);
                    if d >= start && d <= end {
                        out.push(d);
                    }
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }
}

impl WidgetDb {
    pub fn special_days(&self) -> WidgetResult<Vec<SpecialDay>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, note, calendar, month, day, year, alert, alert_time, days_before, sound, color, created_at
             FROM special_days ORDER BY month, day, created_at",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SpecialDay {
                id: r.get(0)?,
                title: r.get(1)?,
                note: r.get(2)?,
                calendar: DateKind::parse(&r.get::<_, String>(3)?),
                month: r.get::<_, i64>(4)? as u32,
                day: r.get::<_, i64>(5)? as u32,
                year: r.get::<_, Option<i64>>(6)?.map(|y| y as i32),
                alert: r.get(7)?,
                alert_time: r.get(8)?,
                days_before: r.get::<_, i64>(9)? as u32,
                sound: r.get(10)?,
                color: r.get(11)?,
                created_at: r.get(12)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn special_save(&self, input: SpecialInput) -> WidgetResult<SpecialDay> {
        let title: String = input.title.trim().chars().take(80).collect();
        if title.is_empty() {
            return Err(WidgetError::Invalid("Give the day a name".into()));
        }
        if !(1..=12).contains(&input.month) {
            return Err(WidgetError::Invalid("Month must be 1–12".into()));
        }
        let day_ok = match input.calendar {
            DateKind::Gregorian => NaiveDate::from_ymd_opt(2000, input.month, input.day).is_some(), // 2000 is a leap year
            DateKind::Hijri => (1..=30).contains(&input.day),
        };
        if !day_ok {
            return Err(WidgetError::Invalid("That day doesn't exist in that month".into()));
        }
        let alert_time = if parse_hhmm(&input.alert_time).is_some() { input.alert_time.clone() } else { "09:00".into() };
        let existing = match &input.id {
            Some(id) => self.special_days()?.into_iter().find(|s| &s.id == id),
            None => None,
        };
        if existing.is_none() && self.special_days()?.len() >= 200 {
            return Err(WidgetError::Invalid("Up to 200 special days".into()));
        }
        let s = SpecialDay {
            id: existing.as_ref().map(|s| s.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            title,
            note: input.note.trim().chars().take(500).collect(),
            calendar: input.calendar,
            month: input.month,
            day: input.day,
            year: input.year.filter(|y| (1..=9999).contains(y)),
            alert: input.alert,
            alert_time,
            days_before: input.days_before.min(14),
            sound: if input.sound.trim().is_empty() { "default".into() } else { input.sound.trim().into() },
            color: if input.color.trim().is_empty() { "#5b8def".into() } else { input.color.trim().chars().take(16).collect() },
            created_at: existing.map(|s| s.created_at).unwrap_or_else(crate::now_ms),
        };
        self.conn.execute(
            "INSERT INTO special_days (id, title, note, calendar, month, day, year, alert, alert_time, days_before, sound, color, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, note = excluded.note, calendar = excluded.calendar,
               month = excluded.month, day = excluded.day, year = excluded.year, alert = excluded.alert,
               alert_time = excluded.alert_time, days_before = excluded.days_before, sound = excluded.sound, color = excluded.color",
            params![
                s.id, s.title, s.note, s.calendar.as_str(), s.month as i64, s.day as i64, s.year.map(|y| y as i64),
                s.alert, s.alert_time, s.days_before as i64, s.sound, s.color, s.created_at
            ],
        )?;
        Ok(s)
    }

    pub fn special_delete(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM special_days WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn input(title: &str, cal: DateKind, m: u32, day: u32) -> SpecialInput {
        SpecialInput { id: None, title: title.into(), note: String::new(), calendar: cal, month: m, day, year: None, alert: true, alert_time: "08:30".into(), days_before: 1, sound: String::new(), color: String::new() }
    }

    #[test]
    fn crud_and_validation() {
        let db = WidgetDb::open_in_memory().unwrap();
        assert!(db.special_save(input("  ", DateKind::Gregorian, 3, 4)).is_err());
        assert!(db.special_save(input("x", DateKind::Gregorian, 13, 4)).is_err());
        assert!(db.special_save(input("x", DateKind::Gregorian, 2, 30)).is_err());
        assert!(db.special_save(input("x", DateKind::Hijri, 9, 31)).is_err());
        assert!(db.special_save(input("Leap day", DateKind::Gregorian, 2, 29)).is_ok());

        let s = db.special_save(input(" Ammu's birthday ", DateKind::Gregorian, 3, 14)).unwrap();
        assert_eq!((s.title.as_str(), s.alert_time.as_str(), s.days_before), ("Ammu's birthday", "08:30", 1));
        let mut e = input("Ammu", DateKind::Gregorian, 3, 15);
        e.id = Some(s.id.clone());
        e.alert_time = "nonsense".into();
        e.days_before = 99;
        let s2 = db.special_save(e).unwrap();
        assert_eq!((s2.id.as_str(), s2.month, s2.alert_time.as_str(), s2.days_before), (s.id.as_str(), 3, "09:00", 14));
        assert_eq!(db.special_days().unwrap().len(), 2);
        db.special_delete(&s.id).unwrap();
        assert_eq!(db.special_days().unwrap().len(), 1);
    }

    #[test]
    fn gregorian_repeats_every_year_and_handles_leap_day() {
        let db = WidgetDb::open_in_memory().unwrap();
        let b = db.special_save(input("B", DateKind::Gregorian, 3, 14)).unwrap();
        assert_eq!(b.dates_between(d(2026, 1, 1), d(2028, 12, 31), 0), vec![d(2026, 3, 14), d(2027, 3, 14), d(2028, 3, 14)]);
        let leap = db.special_save(input("L", DateKind::Gregorian, 2, 29)).unwrap();
        assert_eq!(leap.dates_between(d(2027, 1, 1), d(2028, 12, 31), 0), vec![d(2027, 2, 28), d(2028, 2, 29)]);
        let mut one_off = input("Once", DateKind::Gregorian, 6, 1);
        one_off.year = Some(2027);
        let o = db.special_save(one_off).unwrap();
        assert_eq!(o.dates_between(d(2026, 1, 1), d(2028, 12, 31), 0), vec![d(2027, 6, 1)]);
    }

    #[test]
    fn hijri_special_follows_the_moon_calendar() {
        let db = WidgetDb::open_in_memory().unwrap();
        let a = db.special_save(input("Ashura", DateKind::Hijri, 1, 10)).unwrap();
        let dates = a.dates_between(d(2026, 1, 1), d(2028, 12, 31), 0);
        assert_eq!(dates.len(), 3, "{dates:?}"); // about 11 days earlier each year
        assert!((dates[0] - dates[1]).num_days().abs() >= 353 && (dates[0] - dates[1]).num_days().abs() <= 356);
        assert_eq!(hijri_for(dates[0], 0).month, 1);
        assert_eq!(hijri_for(dates[0], 0).day, 10);
        // the adjustment moves the date the other way
        let adj = a.dates_between(d(2026, 1, 1), d(2028, 12, 31), -1);
        assert_eq!((adj[0] - dates[0]).num_days(), 1);
    }
}
