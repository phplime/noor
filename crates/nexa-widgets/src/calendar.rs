//! Calendars for Noor: Hijri (tabular/civil), Bangla (Bangladesh, 2019 revision),
//! national & Islamic occasions, and per-day info for the calendar screen.
//!
//! The Hijri calendar here is the arithmetic ("tabular") one, which is within a
//! day of Umm al-Qura. Real months start with moon sighting, so every Hijri
//! date can be shifted by `CalendarSettings::hijri_adjust` (Bangladesh usually
//! sights the moon about a day after Saudi Arabia → −1).

use crate::specials::SpecialDay;
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarSettings {
    /// Days added to the computed Hijri date (−2…+2) to match local moon sighting.
    pub hijri_adjust: i32,
    /// Notify at 8 pm the evening before a public/Islamic holiday.
    pub holiday_alerts: bool,
    /// Show Sunnah fasting days (Ayyam al-Bid, Arafah, Ashura).
    pub show_fasting_days: bool,
    /// Also mark every Monday and Thursday as a Sunnah fast.
    pub monday_thursday: bool,
    /// Remind the evening before a Sunnah fast (with the Sehri end time).
    pub fasting_alerts: bool,
    /// Friday reminders: Surah Al-Kahf, Jumu'ah, durud.
    pub friday_reminders: bool,
    /// "HH:MM" for the Surah Al-Kahf reminder on Friday.
    pub kahf_time: String,
    /// Notify when a no-salah (makruh) time starts and ends.
    pub makruh_alerts: bool,
}

impl Default for CalendarSettings {
    fn default() -> Self {
        Self {
            hijri_adjust: 0,
            holiday_alerts: false,
            show_fasting_days: true,
            monday_thursday: false,
            fasting_alerts: true,
            friday_reminders: true,
            kahf_time: "09:00".into(),
            makruh_alerts: true,
        }
    }
}

impl CalendarSettings {
    pub fn sanitized(mut self) -> Self {
        self.hijri_adjust = self.hijri_adjust.clamp(-2, 2);
        if chrono::NaiveTime::parse_from_str(self.kahf_time.trim(), "%H:%M").is_err() {
            self.kahf_time = "09:00".into();
        }
        self
    }
}

// ----- Julian day numbers ----------------------------------------------------

pub fn jdn(d: NaiveDate) -> i64 {
    d.num_days_from_ce() as i64 + 1_721_425
}

pub fn from_jdn(j: i64) -> NaiveDate {
    NaiveDate::from_num_days_from_ce_opt((j - 1_721_425) as i32).expect("date in range")
}

// ----- Hijri -------------------------------------------------------------------

const HIJRI_EPOCH_JDN: i64 = 1_948_440;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hijri {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

pub fn hijri_to_jdn(y: i32, m: u32, d: u32) -> i64 {
    let (y, m, d) = (y as i64, m as i64, d as i64);
    d + (59 * (m - 1) + 1) / 2 + (y - 1) * 354 + (3 + 11 * y).div_euclid(30) + HIJRI_EPOCH_JDN - 1
}

pub fn jdn_to_hijri(j: i64) -> Hijri {
    let y = (30 * (j - HIJRI_EPOCH_JDN) + 10646).div_euclid(10631);
    let first = hijri_to_jdn(y as i32, 1, 1);
    let m = ((2 * (j - 29 - first) + 58).div_euclid(59) + 1).clamp(1, 12);
    let d = j - hijri_to_jdn(y as i32, m as u32, 1) + 1;
    Hijri { year: y as i32, month: m as u32, day: d as u32 }
}

pub fn hijri_month_len(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    (hijri_to_jdn(ny, nm, 1) - hijri_to_jdn(y, m, 1)) as u32
}

/// Hijri date of a Gregorian date, shifted by `adjust` days.
pub fn hijri_for(date: NaiveDate, adjust: i32) -> Hijri {
    jdn_to_hijri(jdn(date) + adjust as i64)
}

/// Gregorian date of a Hijri date (inverse of `hijri_for`).
pub fn date_for_hijri(y: i32, m: u32, d: u32, adjust: i32) -> NaiveDate {
    from_jdn(hijri_to_jdn(y, m, d) - adjust as i64)
}

// ----- Bangla (Bangladesh, revised 2019) ----------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bangla {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Boishakh–Ashwin 31, Kartik–Magh 30, Falgun 29 (30 in a Gregorian leap year), Choitro 30.
fn bangla_lengths(falgun_leap: bool) -> [i64; 12] {
    [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, if falgun_leap { 30 } else { 29 }, 30]
}

pub fn bangla_for(date: NaiveDate) -> Bangla {
    let start_year = if (date.month(), date.day()) >= (4, 14) { date.year() } else { date.year() - 1 };
    let start = NaiveDate::from_ymd_opt(start_year, 4, 14).expect("valid");
    let mut left = (date - start).num_days();
    for (i, len) in bangla_lengths(is_leap(start_year + 1)).iter().enumerate() {
        if left < *len {
            return Bangla { year: start_year - 593, month: i as u32 + 1, day: left as u32 + 1 };
        }
        left -= len;
    }
    Bangla { year: start_year - 593, month: 12, day: 30 }
}

// ----- occasions ----------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OccasionKind {
    /// Public holiday (national or Islamic holiday in Bangladesh).
    Holiday,
    /// Islamic date worth knowing, but not a public holiday.
    Islamic,
    /// Sunnah fasting day.
    Fasting,
    /// Added by the user.
    Special,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occasion {
    pub key: String,
    pub kind: OccasionKind,
    pub en: String,
    pub bn: String,
    pub ar: String,
    pub user_id: Option<String>,
}

fn occ(key: &str, kind: OccasionKind, en: &str, bn: &str, ar: &str) -> Occasion {
    Occasion { key: key.into(), kind, en: en.into(), bn: bn.into(), ar: ar.into(), user_id: None }
}

impl Occasion {
    pub fn from_special(s: &SpecialDay) -> Self {
        Occasion { key: format!("special:{}", s.id), kind: OccasionKind::Special, en: s.title.clone(), bn: String::new(), ar: String::new(), user_id: Some(s.id.clone()) }
    }
}

/// National days (fixed Gregorian dates) and Islamic occasions (from the adjusted Hijri date).
/// Moon-dependent dates can differ from the government gazette by a day: adjust in settings.
pub fn builtin_occasions(date: NaiveDate, adjust: i32, show_fasting: bool) -> Vec<Occasion> {
    use OccasionKind::*;
    let mut out = Vec::new();

    match (date.month(), date.day()) {
        (2, 21) => out.push(occ("shaheed", Holiday, "Shaheed Day & International Mother Language Day", "শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস", "")),
        (3, 26) => out.push(occ("independence", Holiday, "Independence Day", "স্বাধীনতা দিবস", "")),
        (4, 14) => out.push(occ("boishakh", Holiday, "Pohela Boishakh", "পহেলা বৈশাখ", "")),
        (5, 1) => out.push(occ("mayday", Holiday, "May Day", "মে দিবস", "")),
        (8, 5) => out.push(occ("uprising", Holiday, "July Mass Uprising Day", "জুলাই গণ-অভ্যুত্থান দিবস", "")),
        (12, 16) => out.push(occ("victory", Holiday, "Victory Day", "বিজয় দিবস", "")),
        (12, 25) => out.push(occ("christmas", Holiday, "Christmas Day", "বড়দিন", "")),
        _ => {}
    }

    let h = hijri_for(date, adjust);
    match (h.month, h.day) {
        (1, 1) => out.push(occ("hijri-new-year", Islamic, "Islamic New Year", "ইসলামী নববর্ষ", "رأس السنة الهجرية")),
        (1, 9) if show_fasting => out.push(occ("tasua", Fasting, "Tasu'a — fasting day", "তাসুআ — রোজার দিন", "تاسوعاء")),
        (1, 10) => out.push(occ("ashura", Holiday, "Ashura", "আশুরা", "عاشوراء")),
        (3, 12) => out.push(occ("milad", Holiday, "Eid-e-Miladunnabi", "ঈদে মিলাদুন্নবী", "المولد النبوي")),
        (8, 15) => out.push(occ("shab-e-barat", Holiday, "Shab-e-Barat", "শবে বরাত", "ليلة البراءة")),
        (9, 1) => out.push(occ("ramadan-begins", Islamic, "Ramadan begins", "রমজান শুরু", "بداية رمضان")),
        (9, 27) => out.push(occ("shab-e-qadr", Holiday, "Shab-e-Qadr", "শবে কদর", "ليلة القدر")),
        (10, 1) => out.push(occ("eid-fitr-1", Holiday, "Eid ul-Fitr", "ঈদুল ফিতর", "عيد الفطر")),
        (10, 2) => out.push(occ("eid-fitr-2", Holiday, "Eid ul-Fitr · day 2", "ঈদুল ফিতর · ২য় দিন", "عيد الفطر")),
        (10, 3) => out.push(occ("eid-fitr-3", Holiday, "Eid ul-Fitr · day 3", "ঈদুল ফিতর · ৩য় দিন", "عيد الفطر")),
        (12, 9) if show_fasting => out.push(occ("arafah", Fasting, "Day of Arafah — fasting day", "আরাফার দিন — রোজার দিন", "يوم عرفة")),
        (12, 10) => out.push(occ("eid-adha", Holiday, "Eid ul-Adha", "ঈদুল আযহা", "عيد الأضحى")),
        _ => {}
    }

    // last Friday of Ramadan
    if date.weekday() == Weekday::Fri && h.month == 9 && hijri_for(date + Duration::days(7), adjust).month != 9 {
        out.push(occ("jumatul-bida", Holiday, "Jumu'atul Bida", "জুমাতুল বিদা", "جمعة الوداع"));
    }

    // Ayyam al-Bid: 13th–15th of each month (not in Ramadan; not 13 Dhul Hijjah)
    if show_fasting && (13..=15).contains(&h.day) && h.month != 9 && !(h.month == 12 && h.day == 13) {
        out.push(occ("ayyam-al-bid", Fasting, "Ayyam al-Bid — fasting day", "আইয়ামে বীজ — রোজার দিন", "الأيام البيض"));
    }
    out
}

// ----- per-day info -----------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayInfo {
    pub date: String,
    /// 0 = Sunday … 6 = Saturday
    pub weekday: u32,
    pub hijri: Hijri,
    pub bangla: Bangla,
    pub occasions: Vec<Occasion>,
}

fn special_hits<'a>(specials: &'a [SpecialDay], start: NaiveDate, end: NaiveDate, adjust: i32) -> HashMap<NaiveDate, Vec<&'a SpecialDay>> {
    let mut map: HashMap<NaiveDate, Vec<&SpecialDay>> = HashMap::new();
    for s in specials {
        for d in s.dates_between(start, end, adjust) {
            map.entry(d).or_default().push(s);
        }
    }
    map
}

/// Days on which fasting is not allowed: both Eids and the days of Tashreeq.
pub fn fasting_forbidden(date: NaiveDate, adjust: i32) -> bool {
    let h = hijri_for(date, adjust);
    (h.month == 10 && h.day == 1) || (h.month == 12 && (10..=13).contains(&h.day))
}

/// All occasions for a date: built-in ones plus the optional Monday/Thursday fasts.
pub fn occasions_for(date: NaiveDate, s: &CalendarSettings) -> Vec<Occasion> {
    let mut out = builtin_occasions(date, s.hijri_adjust, s.show_fasting_days);
    let h = hijri_for(date, s.hijri_adjust);
    if s.show_fasting_days
        && s.monday_thursday
        && matches!(date.weekday(), Weekday::Mon | Weekday::Thu)
        && h.month != 9
        && !fasting_forbidden(date, s.hijri_adjust)
        && !out.iter().any(|o| o.kind == OccasionKind::Fasting)
    {
        let (en, bn, key) = if date.weekday() == Weekday::Mon {
            ("Monday fast (Sunnah)", "সোমবারের রোজা (সুন্নাত)", "monday-fast")
        } else {
            ("Thursday fast (Sunnah)", "বৃহস্পতিবারের রোজা (সুন্নাত)", "thursday-fast")
        };
        out.push(occ(key, OccasionKind::Fasting, en, bn, ""));
    }
    out
}

/// The Sunnah fast on a date, if any.
pub fn fasting_on(date: NaiveDate, s: &CalendarSettings) -> Option<Occasion> {
    let s = CalendarSettings { show_fasting_days: true, ..s.clone() };
    occasions_for(date, &s).into_iter().find(|o| o.kind == OccasionKind::Fasting)
}

pub fn day_info(date: NaiveDate, s: &CalendarSettings, hits: &HashMap<NaiveDate, Vec<&SpecialDay>>) -> DayInfo {
    let mut occasions = occasions_for(date, s);
    if let Some(list) = hits.get(&date) {
        occasions.extend(list.iter().map(|sd| Occasion::from_special(sd)));
    }
    DayInfo {
        date: date.format("%Y-%m-%d").to_string(),
        weekday: date.weekday().num_days_from_sunday(),
        hijri: hijri_for(date, s.hijri_adjust),
        bangla: bangla_for(date),
        occasions,
    }
}

pub fn month_days(year: i32, month: u32, s: &CalendarSettings, specials: &[SpecialDay]) -> Vec<DayInfo> {
    let Some(first) = NaiveDate::from_ymd_opt(year, month, 1) else { return vec![] };
    let next = if month == 12 { NaiveDate::from_ymd_opt(year + 1, 1, 1) } else { NaiveDate::from_ymd_opt(year, month + 1, 1) }.expect("valid");
    let last = next - Duration::days(1);
    let hits = special_hits(specials, first, last, s.hijri_adjust);
    let mut out = Vec::new();
    let mut d = first;
    while d <= last {
        out.push(day_info(d, s, &hits));
        d += Duration::days(1);
    }
    out
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dated {
    pub date: String,
    pub occasion: Occasion,
}

/// Occasions from `from` for `days` days, soonest first. Fasting days only when asked.
pub fn upcoming(from: NaiveDate, days: i64, s: &CalendarSettings, specials: &[SpecialDay], include_fasting: bool) -> Vec<Dated> {
    let end = from + Duration::days(days);
    let hits = special_hits(specials, from, end, s.hijri_adjust);
    let mut out = Vec::new();
    let mut d = from;
    while d <= end {
        for o in day_info(d, s, &hits).occasions {
            if include_fasting || o.kind != OccasionKind::Fasting {
                out.push(Dated { date: d.format("%Y-%m-%d").to_string(), occasion: o });
            }
        }
        d += Duration::days(1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn near(a: NaiveDate, b: NaiveDate) -> bool {
        (a - b).num_days().abs() <= 1
    }

    #[test]
    fn jdn_round_trip() {
        assert_eq!(jdn(d(2000, 1, 1)), 2_451_545);
        assert_eq!(from_jdn(2_451_545), d(2000, 1, 1));
    }

    #[test]
    fn hijri_round_trips_and_matches_known_dates() {
        for j in (2_440_000..2_520_000).step_by(37) {
            let h = jdn_to_hijri(j);
            assert!((1..=12).contains(&h.month) && (1..=30).contains(&h.day), "{h:?}");
            assert_eq!(hijri_to_jdn(h.year, h.month, h.day), j);
        }
        // 1 Jan 2000 = 24 Ramadan 1420 (±1 day between calendars)
        let h = hijri_for(d(2000, 1, 1), 0);
        assert_eq!((h.year, h.month), (1420, 9));
        assert!((23..=25).contains(&h.day), "{h:?}");
        // Ramadan, Eid ul-Fitr and Eid ul-Adha 1447 (Saudi: 18 Feb, 20 Mar, 27 May 2026)
        assert!(near(date_for_hijri(1447, 9, 1, 0), d(2026, 2, 18)));
        assert!(near(date_for_hijri(1447, 10, 1, 0), d(2026, 3, 20)));
        assert!(near(date_for_hijri(1447, 12, 10, 0), d(2026, 5, 27)));
        // adjust shifts the Hijri date, and date_for_hijri undoes it
        let t = d(2026, 11, 1);
        assert_eq!(jdn(date_for_hijri(1448, 6, 21, -1)) - jdn(date_for_hijri(1448, 6, 21, 0)), 1);
        let h0 = hijri_for(t, 0);
        let h1 = hijri_for(t, -1);
        assert_eq!(hijri_to_jdn(h0.year, h0.month, h0.day) - hijri_to_jdn(h1.year, h1.month, h1.day), 1);
        // tabular Ramadan always has 30 days
        assert_eq!(hijri_month_len(1448, 9), 30);
    }

    #[test]
    fn bangla_matches_the_2019_revision() {
        let b = |y, m, day| bangla_for(d(y, m, day));
        assert_eq!(b(2026, 4, 14), Bangla { year: 1433, month: 1, day: 1 }); // Pohela Boishakh
        assert_eq!(b(2026, 2, 21), Bangla { year: 1432, month: 11, day: 8 }); // 8 Falgun
        assert_eq!(b(2027, 3, 26), Bangla { year: 1433, month: 12, day: 12 }); // 12 Choitro
        assert_eq!(b(2026, 12, 16), Bangla { year: 1433, month: 9, day: 1 }); // 1 Poush
        assert_eq!(b(2026, 10, 17), Bangla { year: 1433, month: 7, day: 1 }); // 1 Kartik
        assert_eq!(b(2026, 11, 1), Bangla { year: 1433, month: 7, day: 16 });
        assert_eq!(b(2026, 2, 14), Bangla { year: 1432, month: 11, day: 1 }); // Pohela Falgun
        assert_eq!(b(2027, 4, 13), Bangla { year: 1433, month: 12, day: 30 }); // last day of the year
        // leap year: 21 Feb is still 8 Falgun, and the year still ends on 13 April
        assert_eq!(b(2028, 2, 21), Bangla { year: 1434, month: 11, day: 8 });
        assert_eq!(b(2028, 4, 13), Bangla { year: 1434, month: 12, day: 30 });
        assert_eq!(b(2028, 4, 14), Bangla { year: 1435, month: 1, day: 1 });
    }

    #[test]
    fn fixed_national_days() {
        let names = |date| builtin_occasions(date, 0, true).into_iter().map(|o| o.key).collect::<Vec<_>>();
        assert_eq!(names(d(2026, 2, 21)), vec!["shaheed"]);
        assert_eq!(names(d(2026, 3, 26)), vec!["independence"]);
        assert_eq!(names(d(2026, 12, 16)), vec!["victory"]);
        assert!(names(d(2026, 11, 1)).is_empty());
    }

    #[test]
    fn ramadan_and_eid_occasions() {
        let s = CalendarSettings::default();
        let days = |a: NaiveDate, b: NaiveDate| {
            let mut v = Vec::new();
            let mut x = a;
            while x <= b {
                for o in builtin_occasions(x, s.hijri_adjust, true) {
                    v.push((x, o.key));
                }
                x += Duration::days(1);
            }
            v
        };
        let all = days(d(2026, 2, 10), d(2026, 3, 30));
        let on = |k: &str| all.iter().filter(|(_, key)| key == k).map(|(dt, _)| *dt).collect::<Vec<_>>();
        assert_eq!(on("ramadan-begins").len(), 1);
        assert!(near(on("ramadan-begins")[0], d(2026, 2, 18)));
        assert!(near(on("shab-e-qadr")[0], d(2026, 3, 16)));
        assert!(near(on("eid-fitr-1")[0], d(2026, 3, 20)));
        assert_eq!(on("eid-fitr-2")[0] - on("eid-fitr-1")[0], Duration::days(1));
        // exactly one last Friday of Ramadan, and it is a Friday just before Eid
        let bida = on("jumatul-bida");
        assert_eq!(bida.len(), 1);
        assert_eq!(bida[0].weekday(), Weekday::Fri);
        assert!(near(bida[0], d(2026, 3, 20)) || near(bida[0], d(2026, 3, 13)), "{:?}", bida);
        // no Ayyam al-Bid inside Ramadan
        assert!(all.iter().filter(|(dt, k)| k == "ayyam-al-bid" && *dt > d(2026, 2, 19) && *dt < d(2026, 3, 19)).count() == 0);
        // fasting days can be hidden
        let hidden = (0..400).flat_map(|i| builtin_occasions(d(2026, 1, 1) + Duration::days(i), 0, false)).any(|o| o.kind == OccasionKind::Fasting);
        assert!(!hidden);
    }

    #[test]
    fn month_grid() {
        let s = CalendarSettings::default();
        let nov = month_days(2026, 11, &s, &[]);
        assert_eq!(nov.len(), 30);
        assert_eq!(nov[0].date, "2026-11-01");
        assert_eq!(nov[0].weekday, 0); // Sunday
        assert_eq!(nov[0].bangla, Bangla { year: 1433, month: 7, day: 16 });
        assert_eq!(month_days(2028, 2, &s, &[]).len(), 29);
        assert!(month_days(2026, 13, &s, &[]).is_empty());
        let up = upcoming(d(2026, 12, 1), 30, &s, &[], false);
        assert!(up.iter().any(|x| x.occasion.key == "victory" && x.date == "2026-12-16"));
    }
}
