//! Salah tracker: which prayers were prayed (with jamaat, on time, late) or
//! missed, streaks, and the qaza (missed prayers to make up) count.

use crate::db::{WidgetDb, WidgetError, WidgetResult};
use chrono::{Duration, NaiveDate};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PRAYERS: [&str; 5] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SalahStatus {
    Jamaat,
    OnTime,
    Late,
    Missed,
}

impl SalahStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Jamaat => "jamaat",
            Self::OnTime => "onTime",
            Self::Late => "late",
            Self::Missed => "missed",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "jamaat" => Self::Jamaat,
            "onTime" => Self::OnTime,
            "late" => Self::Late,
            "missed" => Self::Missed,
            _ => return None,
        })
    }
    pub fn prayed(self) -> bool {
        self != Self::Missed
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalahMark {
    /// Local date "YYYY-MM-DD".
    pub date: String,
    pub prayer: String,
    pub status: SalahStatus,
}

/// Missed prayers still to make up, per prayer (plus witr).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Qaza {
    pub fajr: u32,
    pub dhuhr: u32,
    pub asr: u32,
    pub maghrib: u32,
    pub isha: u32,
    pub witr: u32,
    /// Total made up since tracking began.
    pub made_up: u32,
}

impl Qaza {
    fn slot(&mut self, prayer: &str) -> Option<&mut u32> {
        Some(match prayer {
            "fajr" => &mut self.fajr,
            "dhuhr" => &mut self.dhuhr,
            "asr" => &mut self.asr,
            "maghrib" => &mut self.maghrib,
            "isha" => &mut self.isha,
            "witr" => &mut self.witr,
            _ => return None,
        })
    }
    pub fn total(&self) -> u32 {
        self.fajr + self.dhuhr + self.asr + self.maghrib + self.isha + self.witr
    }
    pub fn sanitized(mut self) -> Self {
        for v in [&mut self.fajr, &mut self.dhuhr, &mut self.asr, &mut self.maghrib, &mut self.isha, &mut self.witr] {
            *v = (*v).min(100_000);
        }
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalahStats {
    /// Days in a row (up to today, or yesterday if today isn't finished) with all five prayed.
    pub streak: u32,
    pub best_streak: u32,
    /// Last 7 days including today: prayers prayed / prayers that were due and marked or passed.
    pub week_prayed: u32,
    pub week_jamaat: u32,
    pub week_missed: u32,
    /// Last 30 days, share prayed on time or with jamaat among those marked.
    pub on_time_pct: u32,
}

fn valid_prayer(p: &str) -> bool {
    PRAYERS.contains(&p)
}

/// Some(true): all five prayed. Some(false): one was missed. None: not all marked yet.
fn day_complete(marks: &HashMap<(String, String), SalahStatus>, d: NaiveDate) -> Option<bool> {
    let key = d.format("%Y-%m-%d").to_string();
    let mut all = true;
    for p in PRAYERS {
        match marks.get(&(key.clone(), p.to_string())) {
            Some(s) if !s.prayed() => return Some(false),
            Some(_) => {}
            None => all = false,
        }
    }
    all.then_some(true)
}

/// Stats from all marks. `today` is the local date.
pub fn stats(list: &[SalahMark], today: NaiveDate) -> SalahStats {
    let marks: HashMap<(String, String), SalahStatus> =
        list.iter().map(|m| ((m.date.clone(), m.prayer.clone()), m.status)).collect();

    // Current streak: today counts only once complete; a partly-marked today doesn't break it.
    let mut streak = 0;
    let mut d = today;
    match day_complete(&marks, d) {
        Some(false) => d = NaiveDate::MIN, // missed one today: streak is broken
        None => d -= Duration::days(1),
        Some(true) => {}
    }
    while d > NaiveDate::MIN && day_complete(&marks, d) == Some(true) {
        streak += 1;
        d -= Duration::days(1);
    }

    // Best streak over every marked day.
    let mut dates: Vec<NaiveDate> = list.iter().filter_map(|m| NaiveDate::parse_from_str(&m.date, "%Y-%m-%d").ok()).collect();
    dates.sort();
    dates.dedup();
    let mut best = 0;
    let mut run = 0;
    let mut prev: Option<NaiveDate> = None;
    for day in dates {
        if day_complete(&marks, day) == Some(true) {
            run = if prev.is_some_and(|p| day - p == Duration::days(1)) { run + 1 } else { 1 };
            prev = Some(day);
            best = best.max(run);
        } else {
            run = 0;
            prev = None;
        }
    }

    let mut s = SalahStats { streak, best_streak: best.max(streak), ..Default::default() };
    let week_from = today - Duration::days(6);
    let month_from = today - Duration::days(29);
    let (mut good, mut marked) = (0u32, 0u32);
    for m in list {
        let Ok(day) = NaiveDate::parse_from_str(&m.date, "%Y-%m-%d") else { continue };
        if day > today {
            continue;
        }
        if day >= week_from {
            match m.status {
                SalahStatus::Missed => s.week_missed += 1,
                SalahStatus::Jamaat => {
                    s.week_prayed += 1;
                    s.week_jamaat += 1;
                }
                _ => s.week_prayed += 1,
            }
        }
        if day >= month_from {
            marked += 1;
            if matches!(m.status, SalahStatus::Jamaat | SalahStatus::OnTime) {
                good += 1;
            }
        }
    }
    s.on_time_pct = if marked == 0 { 0 } else { (good * 100 + marked / 2) / marked };
    s
}

impl WidgetDb {
    pub fn salah_marks(&self, from: &str, to: &str) -> WidgetResult<Vec<SalahMark>> {
        let mut st = self
            .conn
            .prepare("SELECT date, prayer, status FROM salah_log WHERE date >= ?1 AND date <= ?2 ORDER BY date, prayer")?;
        let rows = st.query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (date, prayer, status) = row?;
            if let Some(status) = SalahStatus::parse(&status) {
                out.push(SalahMark { date, prayer, status });
            }
        }
        Ok(out)
    }

    pub fn salah_all(&self) -> WidgetResult<Vec<SalahMark>> {
        self.salah_marks("0000-00-00", "9999-99-99")
    }

    /// Set (or clear, with `None`) one prayer's mark. Marking it missed adds one
    /// to the qaza count; un-marking a missed prayer takes it back off.
    pub fn salah_set(&self, date: &str, prayer: &str, status: Option<SalahStatus>) -> WidgetResult<Qaza> {
        if !valid_prayer(prayer) || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err(WidgetError::Invalid("invalid prayer or date".into()));
        }
        let old: Option<SalahStatus> = self
            .conn
            .query_row("SELECT status FROM salah_log WHERE date = ?1 AND prayer = ?2", params![date, prayer], |r| r.get::<_, String>(0))
            .optional()?
            .and_then(|s| SalahStatus::parse(&s));
        match status {
            Some(s) => {
                self.conn.execute(
                    "INSERT INTO salah_log (date, prayer, status, updated_at) VALUES (?1, ?2, ?3, strftime('%s','now'))
                     ON CONFLICT(date, prayer) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
                    params![date, prayer, s.as_str()],
                )?;
            }
            None => {
                self.conn.execute("DELETE FROM salah_log WHERE date = ?1 AND prayer = ?2", params![date, prayer])?;
            }
        }
        let mut q = self.qaza()?;
        let was_missed = old == Some(SalahStatus::Missed);
        let now_missed = status == Some(SalahStatus::Missed);
        if let Some(slot) = q.slot(prayer) {
            if now_missed && !was_missed {
                *slot += 1;
            } else if was_missed && !now_missed {
                *slot = slot.saturating_sub(1);
            }
        }
        self.set_json("qaza", &q)?;
        Ok(q)
    }

    pub fn qaza(&self) -> WidgetResult<Qaza> {
        Ok(self.get_json::<Qaza>("qaza")?.unwrap_or_default().sanitized())
    }

    pub fn qaza_save(&self, q: Qaza) -> WidgetResult<Qaza> {
        let q = q.sanitized();
        self.set_json("qaza", &q)?;
        Ok(q)
    }

    /// One qaza prayer made up.
    pub fn qaza_made_up(&self, prayer: &str) -> WidgetResult<Qaza> {
        let mut q = self.qaza()?;
        if let Some(slot) = q.slot(prayer) {
            if *slot > 0 {
                *slot -= 1;
                q.made_up += 1;
            }
        } else {
            return Err(WidgetError::Invalid("unknown prayer".into()));
        }
        self.set_json("qaza", &q)?;
        Ok(q)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn full(db: &WidgetDb, date: &str) {
        for p in PRAYERS {
            db.salah_set(date, p, Some(SalahStatus::OnTime)).unwrap();
        }
    }

    #[test]
    fn missed_prayers_count_as_qaza_and_can_be_made_up() {
        let db = WidgetDb::open_in_memory().unwrap();
        let q = db.salah_set("2026-11-01", "fajr", Some(SalahStatus::Missed)).unwrap();
        assert_eq!(q.fajr, 1);
        // Re-marking the same miss doesn't double count.
        assert_eq!(db.salah_set("2026-11-01", "fajr", Some(SalahStatus::Missed)).unwrap().fajr, 1);
        // Fixing the mark removes it.
        assert_eq!(db.salah_set("2026-11-01", "fajr", Some(SalahStatus::Late)).unwrap().fajr, 0);
        db.salah_set("2026-11-02", "asr", Some(SalahStatus::Missed)).unwrap();
        let q = db.qaza_made_up("asr").unwrap();
        assert_eq!((q.asr, q.made_up), (0, 1));
        assert_eq!(db.qaza_made_up("asr").unwrap().made_up, 1, "nothing left to make up");
        assert!(db.salah_set("2026-11-02", "witr", Some(SalahStatus::OnTime)).is_err());
    }

    #[test]
    fn streak_counts_complete_days_and_ignores_unfinished_today() {
        let db = WidgetDb::open_in_memory().unwrap();
        full(&db, "2026-10-30");
        full(&db, "2026-10-31");
        full(&db, "2026-11-01");
        db.salah_set("2026-11-02", "fajr", Some(SalahStatus::Jamaat)).unwrap();
        let s = stats(&db.salah_all().unwrap(), day("2026-11-02"));
        assert_eq!(s.streak, 3);
        assert_eq!(s.best_streak, 3);
        assert_eq!(s.week_prayed, 16);
        assert_eq!(s.week_jamaat, 1);
        assert_eq!(s.on_time_pct, 100);

        // A missed prayer today breaks it.
        db.salah_set("2026-11-02", "dhuhr", Some(SalahStatus::Missed)).unwrap();
        let s = stats(&db.salah_all().unwrap(), day("2026-11-02"));
        assert_eq!(s.streak, 0);
        assert_eq!(s.best_streak, 3);
        assert_eq!(s.week_missed, 1);
    }

    #[test]
    fn marks_query_by_range() {
        let db = WidgetDb::open_in_memory().unwrap();
        full(&db, "2026-10-31");
        full(&db, "2026-11-01");
        assert_eq!(db.salah_marks("2026-11-01", "2026-11-30").unwrap().len(), 5);
        db.salah_set("2026-11-01", "isha", None).unwrap();
        assert_eq!(db.salah_marks("2026-11-01", "2026-11-30").unwrap().len(), 4);
    }
}
