//! Ramadan: finds the month for the current/next Hijri year (with a manual
//! override for the year the start is announced) and plans the daily alerts —
//! "wake up for Sehri", "Sehri ends soon", "Iftar soon" and "Iftar".

use crate::calendar::{date_for_hijri, hijri_for, hijri_month_len};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RamadanSettings {
    /// Sync with the Ramadan calendar every year and schedule the alerts automatically.
    pub enabled: bool,
    /// When the start is announced and differs from the estimate: Hijri year + start date.
    pub override_year: Option<i32>,
    pub override_start: Option<String>,
    /// Sehri ends this many minutes before Fajr (0 = at Fajr).
    pub sehri_end_before_fajr_min: u32,
    /// Wake-up alert this many minutes before Sehri ends (0 = off).
    pub wake_before_min: u32,
    /// "Sehri ends in N min" alert (0 = off).
    pub sehri_warning_min: u32,
    /// "Iftar in N min" alert (0 = off).
    pub iftar_headsup_min: u32,
    /// Alert at Iftar (Maghrib).
    pub iftar_alert: bool,
    /// While Ramadan alerts are queued, keep only the at-time prayer reminders so alerts reach further ahead.
    pub lean_prayer_alerts: bool,
    pub wake_sound: String,
    pub iftar_sound: String,
}

impl Default for RamadanSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            override_year: None,
            override_start: None,
            sehri_end_before_fajr_min: 0,
            wake_before_min: 45,
            sehri_warning_min: 10,
            iftar_headsup_min: 15,
            iftar_alert: true,
            lean_prayer_alerts: true,
            wake_sound: "noor_dawn".into(),
            iftar_sound: "noor_chime".into(),
        }
    }
}

impl RamadanSettings {
    pub fn sanitized(mut self) -> Self {
        self.sehri_end_before_fajr_min = self.sehri_end_before_fajr_min.min(30);
        self.wake_before_min = self.wake_before_min.min(180);
        self.sehri_warning_min = self.sehri_warning_min.min(60);
        self.iftar_headsup_min = self.iftar_headsup_min.min(60);
        if self.override_start.as_deref().and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()).is_none() {
            self.override_start = None;
            self.override_year = None;
        }
        if self.wake_sound.trim().is_empty() {
            self.wake_sound = "noor_dawn".into();
        }
        if self.iftar_sound.trim().is_empty() {
            self.iftar_sound = "noor_chime".into();
        }
        self
    }
}

/// First and last day of Ramadan in a Hijri year (a manual start overrides the estimate for that year).
pub fn range_for(hijri_year: i32, adjust: i32, s: &RamadanSettings) -> (NaiveDate, NaiveDate) {
    let manual = (s.override_year == Some(hijri_year)).then(|| s.override_start.as_deref().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())).flatten();
    let start = manual.unwrap_or_else(|| date_for_hijri(hijri_year, 9, 1, adjust));
    (start, start + Duration::days(hijri_month_len(hijri_year, 9) as i64 - 1))
}

/// The Ramadan that is under way, or the next one to come: (Hijri year, first day, last day).
pub fn current_or_next(today: NaiveDate, adjust: i32, s: &RamadanSettings) -> (i32, NaiveDate, NaiveDate) {
    let hy = hijri_for(today, adjust).year;
    let (start, end) = range_for(hy, adjust, s);
    if today <= end {
        (hy, start, end)
    } else {
        let (a, b) = range_for(hy + 1, adjust, s);
        (hy + 1, a, b)
    }
}

/// Fajr and Maghrib (UTC) for one day of Ramadan.
#[derive(Debug, Clone)]
pub struct DayTimes {
    pub date: NaiveDate,
    pub day_no: u32,
    pub fajr: DateTime<Utc>,
    pub maghrib: DateTime<Utc>,
}

impl DayTimes {
    pub fn sehri_end(&self, s: &RamadanSettings) -> DateTime<Utc> {
        self.fajr - Duration::minutes(s.sehri_end_before_fajr_min as i64)
    }
    pub fn wake(&self, s: &RamadanSettings) -> DateTime<Utc> {
        self.sehri_end(s) - Duration::minutes(s.wake_before_min as i64)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    /// wake | sehri | headsup | iftar
    pub kind: &'static str,
    pub at: DateTime<Utc>,
    pub title: String,
    pub body: String,
    pub sound: String,
}

fn fmt(dt: DateTime<Utc>, tz: Tz, use24: bool) -> String {
    dt.with_timezone(&tz).format(if use24 { "%H:%M" } else { "%-I:%M %p" }).to_string()
}

/// Alerts for the given days that fall within `[from, until]`, soonest first.
pub fn plan_alerts(s: &RamadanSettings, days: &[DayTimes], tz: Tz, use24: bool, from: DateTime<Utc>, until: DateTime<Utc>) -> Vec<Alert> {
    let mut out = Vec::new();
    let mut push = |a: Alert| {
        if a.at >= from && a.at <= until {
            out.push(a);
        }
    };
    for d in days {
        let end = d.sehri_end(s);
        if s.wake_before_min > 0 {
            push(Alert {
                kind: "wake",
                at: d.wake(s),
                title: "Time for Sehri 🌙".into(),
                body: format!("Sehri ends at {} · Ramadan day {}", fmt(end, tz, use24), d.day_no),
                sound: s.wake_sound.clone(),
            });
        }
        if s.sehri_warning_min > 0 {
            push(Alert {
                kind: "sehri",
                at: end - Duration::minutes(s.sehri_warning_min as i64),
                title: format!("Sehri ends in {} min", s.sehri_warning_min),
                body: format!("Finish eating and drinking — Fajr is at {}.", fmt(d.fajr, tz, use24)),
                sound: "noor_bell".into(),
            });
        }
        if s.iftar_headsup_min > 0 {
            push(Alert {
                kind: "headsup",
                at: d.maghrib - Duration::minutes(s.iftar_headsup_min as i64),
                title: format!("Iftar in {} min", s.iftar_headsup_min),
                body: format!("Maghrib is at {}. Get ready to break your fast.", fmt(d.maghrib, tz, use24)),
                sound: "noor_soft".into(),
            });
        }
        if s.iftar_alert {
            push(Alert {
                kind: "iftar",
                at: d.maghrib,
                title: "Iftar time 🌅".into(),
                body: format!("Break your fast — Maghrib is at {}. Ramadan day {} done.", fmt(d.maghrib, tz, use24), d.day_no),
                sound: s.iftar_sound.clone(),
            });
        }
    }
    out.sort_by(|a, b| a.at.cmp(&b.at));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn finds_current_or_next_ramadan_and_honours_the_override() {
        let s = RamadanSettings::default();
        let (hy, start, end) = current_or_next(d(2026, 11, 1), 0, &s);
        assert_eq!(hy, 1448);
        assert!((start - d(2027, 2, 8)).num_days().abs() <= 1, "{start}");
        assert_eq!((end - start).num_days(), 29);
        // during Ramadan it is the current one; after Eid it moves on a year (about 354 days later)
        let mid = start + Duration::days(10);
        assert_eq!(current_or_next(mid, 0, &s).0, 1448);
        let after = current_or_next(end + Duration::days(1), 0, &s);
        assert_eq!(after.0, 1449);
        assert!(((after.1 - start).num_days() - 354).abs() <= 1);
        // moon-sighting adjustment pushes the start later
        assert_eq!(current_or_next(d(2026, 11, 1), -1, &s).1 - start, Duration::days(1));
        // a manual start applies to its own Hijri year only
        let mut o = s.clone();
        o.override_year = Some(1448);
        o.override_start = Some("2027-02-10".into());
        assert_eq!(current_or_next(d(2026, 11, 1), 0, &o).1, d(2027, 2, 10));
        assert_eq!(current_or_next(end + Duration::days(40), 0, &o).1, after.1);
        // a broken override is dropped
        o.override_start = Some("soon".into());
        assert_eq!(o.sanitized().override_year, None);
    }

    fn day(n: u32) -> DayTimes {
        // Dhaka (UTC+6): Fajr 05:00, Maghrib 17:30 local
        let base = d(2027, 2, 7 + n);
        DayTimes {
            date: base,
            day_no: n,
            fajr: Utc.with_ymd_and_hms(2027, 2, 7 + n, 23, 0, 0).unwrap() - Duration::days(1),
            maghrib: Utc.with_ymd_and_hms(2027, 2, 7 + n, 11, 30, 0).unwrap(),
        }
    }

    #[test]
    fn plans_four_alerts_a_day_in_order() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let s = RamadanSettings::default();
        let from = Utc.with_ymd_and_hms(2027, 2, 1, 0, 0, 0).unwrap();
        let until = from + Duration::days(30);
        let alerts = plan_alerts(&s, &[day(1), day(2)], tz, false, from, until);
        assert_eq!(alerts.len(), 8);
        assert!(alerts.windows(2).all(|w| w[0].at <= w[1].at));
        let kinds: Vec<_> = alerts.iter().take(4).map(|a| a.kind).collect();
        assert_eq!(kinds, vec!["wake", "sehri", "headsup", "iftar"]);
        // wake = Fajr − 0 − 45 min = 04:15 local; Sehri warning 04:50; iftar 17:30
        let local = |a: &Alert| a.at.with_timezone(&tz).format("%H:%M").to_string();
        assert_eq!(local(&alerts[0]), "04:15");
        assert_eq!(local(&alerts[1]), "04:50");
        assert_eq!(local(&alerts[2]), "17:15");
        assert_eq!(local(&alerts[3]), "17:30");
        assert_eq!(alerts[0].body, "Sehri ends at 5:00 AM · Ramadan day 1");
        assert_eq!(alerts[3].body, "Break your fast — Maghrib is at 5:30 PM. Ramadan day 1 done.");
        assert_eq!(alerts[0].sound, "noor_dawn");
        // 24-hour clock
        assert!(plan_alerts(&s, &[day(1)], tz, true, from, until)[0].body.contains("05:00"));
    }

    #[test]
    fn switches_and_offsets() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2027, 2, 1, 0, 0, 0).unwrap();
        let until = from + Duration::days(30);
        let mut s = RamadanSettings { wake_before_min: 0, sehri_warning_min: 0, iftar_headsup_min: 0, ..Default::default() };
        let alerts = plan_alerts(&s, &[day(1)], tz, false, from, until);
        assert_eq!(alerts.iter().map(|a| a.kind).collect::<Vec<_>>(), vec!["iftar"]);
        s.iftar_alert = false;
        assert!(plan_alerts(&s, &[day(1)], tz, false, from, until).is_empty());
        // Sehri ends 5 min before Fajr; wake 30 min before that
        let s = RamadanSettings { sehri_end_before_fajr_min: 5, wake_before_min: 30, ..Default::default() };
        let a = plan_alerts(&s, &[day(1)], tz, false, from, until);
        assert_eq!(a[0].at.with_timezone(&tz).format("%H:%M").to_string(), "04:25");
        // only alerts inside the window are kept
        let narrow = plan_alerts(&RamadanSettings::default(), &[day(1)], tz, false, day(1).maghrib - Duration::minutes(20), until);
        assert_eq!(narrow.iter().map(|a| a.kind).collect::<Vec<_>>(), vec!["headsup", "iftar"]);
    }
}
