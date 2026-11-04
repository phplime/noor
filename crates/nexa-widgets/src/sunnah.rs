//! Sunnah reminders: the evening before a voluntary fast, and Friday
//! (Surah Al-Kahf, Jumu'ah, durud).

use crate::calendar::{fasting_on, CalendarSettings};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;

/// One day's prayer times needed for the reminders.
#[derive(Debug, Clone)]
pub struct SunnahDay {
    pub date: NaiveDate,
    pub fajr: Option<DateTime<Utc>>,
    pub dhuhr: Option<DateTime<Utc>>,
    pub asr: Option<DateTime<Utc>>,
    /// Calculated (astronomical) times, for the no-salah windows; a fixed
    /// mosque time doesn't move these.
    pub sunrise_calc: Option<DateTime<Utc>>,
    pub dhuhr_calc: Option<DateTime<Utc>>,
    pub maghrib_calc: Option<DateTime<Utc>>,
}

/// The three no-salah windows of a day: (name, bangla, start, end).
pub fn makruh_windows(d: &SunnahDay) -> Vec<(&'static str, &'static str, DateTime<Utc>, DateTime<Utc>)> {
    let mut out = Vec::new();
    if let Some(t) = d.sunrise_calc {
        out.push(("Sunrise", "সূর্যোদয়", t, t + Duration::minutes(15)));
    }
    if let Some(t) = d.dhuhr_calc {
        out.push(("Zawal (midday)", "দ্বিপ্রহর", t - Duration::minutes(10), t));
    }
    if let Some(t) = d.maghrib_calc {
        out.push(("Before sunset", "সূর্যাস্তের আগে", t - Duration::minutes(15), t));
    }
    out
}

/// "No-salah time started" / "…is over" alerts, up to `until`.
pub fn plan_makruh(days: &[SunnahDay], tz: Tz, use24: bool, after: DateTime<Utc>, until: DateTime<Utc>) -> Vec<SunnahAlert> {
    let mut out = Vec::new();
    for d in days {
        for (en, bn, start, end) in makruh_windows(d) {
            out.push(SunnahAlert {
                at: start,
                kind: "makruh",
                route: "prayer".into(),
                title: format!("No-salah time started ⛔ · {en}"),
                body: format!("Don't begin a salah until {}. নিষিদ্ধ সময় শুরু — {bn}।", clock(end, tz, use24)),
            });
            out.push(SunnahAlert {
                at: end,
                kind: "makruh-end",
                route: "prayer".into(),
                title: "No-salah time is over ✅".into(),
                body: format!("You may pray now. নিষিদ্ধ সময় শেষ — এখন নামাজ পড়া যাবে ({bn})।"),
            });
        }
    }
    out.retain(|a| a.at > after && a.at < until);
    out.sort_by_key(|a| a.at);
    out
}

#[derive(Debug, Clone, PartialEq)]
pub struct SunnahAlert {
    pub at: DateTime<Utc>,
    /// fast | kahf | jumuah | durud
    pub kind: &'static str,
    pub route: String,
    pub title: String,
    pub body: String,
}

fn local(tz: Tz, date: NaiveDate, h: u32, m: u32) -> Option<DateTime<Utc>> {
    tz.from_local_datetime(&date.and_time(NaiveTime::from_hms_opt(h, m, 0)?)).earliest().map(|t| t.with_timezone(&Utc))
}

fn clock(t: DateTime<Utc>, tz: Tz, use24: bool) -> String {
    let l = t.with_timezone(&tz);
    if use24 {
        l.format("%H:%M").to_string()
    } else {
        l.format("%-I:%M %p").to_string()
    }
}

/// Reminders between `after` and `until`.
pub fn plan(s: &CalendarSettings, days: &[SunnahDay], tz: Tz, use24: bool, after: DateTime<Utc>, until: DateTime<Utc>) -> Vec<SunnahAlert> {
    let mut out = Vec::new();
    let kahf = NaiveTime::parse_from_str(&s.kahf_time, "%H:%M").unwrap_or_else(|_| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
    for d in days {
        if s.fasting_alerts {
            if let Some(o) = fasting_on(d.date, s) {
                let sehri = d.fajr.map(|f| format!(" Sehri ends at {}.", clock(f, tz, use24))).unwrap_or_default();
                if let Some(at) = local(tz, d.date - Duration::days(1), 21, 0) {
                    out.push(SunnahAlert {
                        at,
                        kind: "fast",
                        route: "calendar".into(),
                        title: format!("Tomorrow: {}", o.en),
                        body: format!("{}.{sehri} Make the intention and set an alarm.", o.bn),
                    });
                }
            }
        }
        if s.friday_reminders && d.date.weekday() == Weekday::Fri {
            if let Some(at) = tz.from_local_datetime(&d.date.and_time(kahf)).earliest().map(|t| t.with_timezone(&Utc)) {
                out.push(SunnahAlert {
                    at,
                    kind: "kahf",
                    route: "quran:18".into(),
                    title: "Jumu'ah Mubarak — read Surah Al-Kahf".into(),
                    body: "Light for you between the two Fridays. আজ সূরা কাহফ পড়ুন।".into(),
                });
            }
            if let Some(dh) = d.dhuhr {
                out.push(SunnahAlert {
                    at: dh - Duration::minutes(60),
                    kind: "jumuah",
                    route: "prayer".into(),
                    title: "Jumu'ah in 1 hour 🕌".into(),
                    body: format!("Ghusl, clean clothes, and go early — Jumu'ah at {}. জুমার প্রস্তুতি নিন।", clock(dh, tz, use24)),
                });
            }
            if let Some(asr) = d.asr {
                out.push(SunnahAlert {
                    at: asr + Duration::minutes(30),
                    kind: "durud",
                    route: "duas".into(),
                    title: "Send durud on the Prophet ﷺ".into(),
                    body: "Fridays are for abundant durud — and du'a in the last hour before Maghrib. বেশি বেশি দরুদ পড়ুন।".into(),
                });
            }
        }
    }
    out.retain(|a| a.at > after && a.at < until);
    out.sort_by_key(|a| a.at);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::{fasting_forbidden, occasions_for, OccasionKind};

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn day(date: NaiveDate, tz: Tz) -> SunnahDay {
        SunnahDay {
            date,
            fajr: local(tz, date, 4, 56),
            dhuhr: local(tz, date, 11, 48),
            asr: local(tz, date, 15, 41),
            sunrise_calc: local(tz, date, 6, 9),
            dhuhr_calc: local(tz, date, 11, 48),
            maghrib_calc: local(tz, date, 17, 22),
        }
    }

    #[test]
    fn makruh_alerts_mark_start_and_end_of_each_window() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let date = d(2026, 11, 3);
        let list = plan_makruh(&[day(date, tz)], tz, false, local(tz, date, 6, 0).unwrap(), local(tz, date, 23, 0).unwrap());
        let at: Vec<_> = list.iter().map(|a| (a.kind, a.at.with_timezone(&tz).format("%H:%M").to_string())).collect();
        assert_eq!(
            at,
            [
                ("makruh", "06:09".to_string()),
                ("makruh-end", "06:24".to_string()),
                ("makruh", "11:38".to_string()),
                ("makruh-end", "11:48".to_string()),
                ("makruh", "17:07".to_string()),
                ("makruh-end", "17:22".to_string()),
            ]
        );
        assert!(list[0].body.contains("6:24 AM"));
    }

    #[test]
    fn friday_brings_kahf_jumuah_and_durud() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let s = CalendarSettings { fasting_alerts: false, ..Default::default() };
        let fri = d(2026, 11, 6);
        let list = plan(&s, &[day(fri, tz)], tz, false, local(tz, fri, 0, 0).unwrap(), local(tz, fri + Duration::days(1), 0, 0).unwrap());
        let kinds: Vec<_> = list.iter().map(|a| a.kind).collect();
        assert_eq!(kinds, ["kahf", "jumuah", "durud"]);
        assert_eq!(list[0].at, local(tz, fri, 9, 0).unwrap());
        assert_eq!(list[1].at, local(tz, fri, 10, 48).unwrap());
        assert!(list[1].body.contains("11:48 AM"));
    }

    #[test]
    fn monday_thursday_fasts_are_optional_and_remind_the_evening_before() {
        let tz: Tz = "Asia/Dhaka".parse().unwrap();
        let mon = d(2026, 11, 9);
        let mut s = CalendarSettings { friday_reminders: false, ..Default::default() };
        assert!(!occasions_for(mon, &s).iter().any(|o| o.key == "monday-fast"));
        s.monday_thursday = true;
        assert!(occasions_for(mon, &s).iter().any(|o| o.key == "monday-fast"));
        let list = plan(&s, &[day(mon, tz)], tz, false, local(tz, mon - Duration::days(1), 0, 0).unwrap(), local(tz, mon, 23, 0).unwrap());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].at, local(tz, mon - Duration::days(1), 21, 0).unwrap());
        assert!(list[0].body.contains("Sehri ends at 4:56 AM"));
    }

    #[test]
    fn no_voluntary_fast_on_eid_or_in_ramadan() {
        let s = CalendarSettings { monday_thursday: true, ..Default::default() };
        for i in 0..800 {
            let date = d(2026, 1, 1) + Duration::days(i);
            if fasting_forbidden(date, 0) {
                assert!(!occasions_for(date, &s).iter().any(|o| o.kind == OccasionKind::Fasting), "{date}");
            }
        }
    }
}
