//! Acceptance tests for the prayer engine. Expected times were produced by the
//! PrayTimes.org reference implementation and match to the minute.

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use nexa_prayer::reminders;
use nexa_prayer::schedule::{build_schedule, next_prayer};
use nexa_prayer::*;

fn loc(name: &str, lat: f64, lng: f64, tz: &str) -> PrayerLocation {
    PrayerLocation {
        id: name.to_lowercase(),
        name: name.into(),
        region: String::new(),
        country: String::new(),
        latitude: lat,
        longitude: lng,
        timezone: tz.into(),
        elevation: 0.0,
        source: LocationSource::Manual,
    }
}

fn calc(method: CalculationMethod, asr: AsrMethod) -> PrayerCalculationSettings {
    PrayerCalculationSettings {
        method,
        asr,
        ..Default::default()
    }
}

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

/// Local "HH:MM" for the six times.
fn local_times(s: &DailyPrayerSchedule) -> Vec<String> {
    let tz: Tz = s.timezone.parse().unwrap();
    Prayer::ALL
        .iter()
        .map(|p| s.entry(*p).unwrap().time.with_timezone(&tz).format("%H:%M").to_string())
        .collect()
}

fn check(l: PrayerLocation, date: NaiveDate, c: PrayerCalculationSettings, expected: [&str; 6]) {
    let s = build_schedule(date, &l, &c, &ManualTimetable::default()).unwrap();
    assert_eq!(local_times(&s), expected, "{} {}", l.name, date);
}

#[test]
fn dhaka_karachi_hanafi() {
    check(
        loc("Dhaka", 23.8103, 90.4125, "Asia/Dhaka"),
        d(2026, 10, 31),
        calc(CalculationMethod::Karachi, AsrMethod::Hanafi),
        ["04:47", "06:04", "11:42", "15:44", "17:20", "18:37"],
    );
    check(
        loc("Dhaka", 23.8103, 90.4125, "Asia/Dhaka"),
        d(2026, 6, 21),
        calc(CalculationMethod::Karachi, AsrMethod::Standard),
        ["03:44", "05:12", "12:00", "15:18", "18:48", "20:16"],
    );
}

#[test]
fn new_york_isna_summer_and_winter_time() {
    let ny = || loc("New York", 40.7128, -74.0060, "America/New_York");
    check(ny(), d(2026, 7, 4), calc(CalculationMethod::Isna, AsrMethod::Standard),
        ["03:52", "05:30", "13:01", "17:00", "20:31", "22:09"]);
    check(ny(), d(2026, 12, 15), calc(CalculationMethod::Isna, AsrMethod::Standard),
        ["05:51", "07:13", "11:51", "14:12", "16:29", "17:52"]);
}

#[test]
fn other_methods_and_hemispheres() {
    let std = AsrMethod::Standard;
    check(loc("Cairo", 30.0444, 31.2357, "Africa/Cairo"), d(2026, 3, 15),
        calc(CalculationMethod::Egypt, std), ["04:39", "06:05", "12:04", "15:29", "18:03", "19:20"]);
    check(loc("Tehran", 35.6892, 51.3890, "Asia/Tehran"), d(2026, 9, 1),
        calc(CalculationMethod::Tehran, std), ["04:09", "05:36", "12:04", "15:43", "18:51", "19:40"]);
    check(loc("Auckland", -36.8485, 174.7633, "Pacific/Auckland"), d(2026, 1, 10),
        calc(CalculationMethod::MuslimWorldLeague, std), ["04:24", "06:13", "13:28", "17:19", "20:43", "22:25"]);
    check(loc("Honolulu", 21.3069, -157.8583, "Pacific/Honolulu"), d(2026, 5, 5),
        calc(CalculationMethod::Isna, std), ["04:53", "05:58", "12:28", "15:48", "18:58", "20:04"]);
    // Umm al-Qura: Isha = Maghrib + 90 min.
    check(loc("Makkah", 21.4225, 39.8262, "Asia/Riyadh"), d(2026, 4, 1),
        calc(CalculationMethod::UmmAlQura, std), ["04:57", "06:14", "12:25", "15:50", "18:36", "20:06"]);
}

#[test]
fn high_latitude_middle_of_night() {
    let l = loc("London", 51.5074, -0.1278, "Europe/London");
    let s = build_schedule(d(2026, 6, 21), &l, &calc(CalculationMethod::MuslimWorldLeague, AsrMethod::Standard), &ManualTimetable::default()).unwrap();
    assert_eq!(local_times(&s), ["01:02", "04:43", "13:02", "17:25", "21:22", "01:02"]);
    assert!(s.entry(Prayer::Fajr).unwrap().high_latitude_adjusted);
    assert!(s.entry(Prayer::Isha).unwrap().high_latitude_adjusted);
    // Isha falls after midnight, i.e. on the next calendar day, after Maghrib.
    assert!(s.entry(Prayer::Isha).unwrap().time > s.entry(Prayer::Maghrib).unwrap().time);

    // Without a rule the times simply don't exist.
    let mut c = calc(CalculationMethod::MuslimWorldLeague, AsrMethod::Standard);
    c.high_latitude = HighLatitudeRule::None;
    let s = build_schedule(d(2026, 6, 21), &l, &c, &ManualTimetable::default()).unwrap();
    assert!(s.entry(Prayer::Fajr).is_none());
    assert!(s.entry(Prayer::Isha).is_none());
}

#[test]
fn daylight_saving_switch_day_is_correct() {
    // US DST starts 2026-03-08: wall-clock times jump ~1h, absolute times don't.
    let ny = loc("New York", 40.7128, -74.0060, "America/New_York");
    let c = calc(CalculationMethod::Isna, AsrMethod::Standard);
    let before = build_schedule(d(2026, 3, 7), &ny, &c, &ManualTimetable::default()).unwrap();
    let after = build_schedule(d(2026, 3, 8), &ny, &c, &ManualTimetable::default()).unwrap();
    let dh = |s: &DailyPrayerSchedule| s.entry(Prayer::Dhuhr).unwrap().time;
    let gap = dh(&after) - dh(&before);
    assert!((gap - Duration::hours(24)).num_minutes().abs() <= 1, "absolute gap {gap}");
    assert_eq!(local_times(&before)[2], "12:07");
    assert_eq!(local_times(&after)[2], "13:07");
}

#[test]
fn offsets_and_manual_timetable_are_kept_separate() {
    let l = loc("Dhaka", 23.8103, 90.4125, "Asia/Dhaka");
    let mut c = calc(CalculationMethod::Karachi, AsrMethod::Hanafi);
    c.offsets.dhuhr = 5;
    c.offsets.maghrib = -2;
    let s = build_schedule(d(2026, 10, 31), &l, &c, &ManualTimetable::default()).unwrap();
    let dh = s.entry(Prayer::Dhuhr).unwrap();
    assert_eq!(dh.offset_minutes, 5);
    assert_eq!(dh.time - dh.calculated_time.unwrap(), Duration::minutes(5));
    assert_eq!(local_times(&s)[2], "11:47");
    assert_eq!(local_times(&s)[4], "17:18");

    c.mode = TimetableMode::Manual;
    let manual = ManualTimetable {
        fajr: Some("05:00".into()),
        dhuhr: Some("13:15".into()),
        ..Default::default()
    };
    let s = build_schedule(d(2026, 10, 31), &l, &c, &manual).unwrap();
    let f = s.entry(Prayer::Fajr).unwrap();
    let tz: Tz = "Asia/Dhaka".parse().unwrap();
    let hm = |t: DateTime<Utc>| t.with_timezone(&tz).format("%H:%M").to_string();
    // A hand-set time is the mosque's jamaat; the prayer still starts at the calculated time (+ offset).
    assert_eq!(f.source, TimeSource::Calculated);
    assert_eq!(hm(f.jamaat.unwrap()), "05:00");
    assert_eq!(hm(s.entry(Prayer::Dhuhr).unwrap().jamaat.unwrap()), "13:15");
    assert_eq!(local_times(&s)[2], "11:47");
    assert!(f.calculated_time.is_some());
    // Missing manual entries fall back to calculated (with offsets).
    assert_eq!(s.entry(Prayer::Asr).unwrap().source, TimeSource::Calculated);
}

#[test]
fn next_prayer_skips_sunrise_and_rolls_to_tomorrow() {
    let l = loc("Dhaka", 23.8103, 90.4125, "Asia/Dhaka");
    let c = calc(CalculationMethod::Karachi, AsrMethod::Hanafi);
    let today = build_schedule(d(2026, 10, 31), &l, &c, &ManualTimetable::default()).unwrap();
    let tomorrow = build_schedule(d(2026, 11, 1), &l, &c, &ManualTimetable::default()).unwrap();
    let tz: Tz = "Asia/Dhaka".parse().unwrap();
    let at = |h, m| tz.with_ymd_and_hms(2026, 10, 31, h, m, 0).unwrap().with_timezone(&Utc);

    let n = next_prayer(&[today.clone(), tomorrow.clone()], at(5, 30), false).unwrap();
    assert_eq!(n.prayer, Prayer::Dhuhr);
    let n = next_prayer(&[today.clone(), tomorrow.clone()], at(5, 30), true).unwrap();
    assert_eq!(n.prayer, Prayer::Sunrise);
    let n = next_prayer(&[today, tomorrow], at(21, 0), false).unwrap();
    assert_eq!((n.prayer, n.date), (Prayer::Fajr, d(2026, 11, 1)));
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

fn dhaka_schedules() -> (Vec<DailyPrayerSchedule>, Tz) {
    let l = loc("Dhaka", 23.8103, 90.4125, "Asia/Dhaka");
    let c = calc(CalculationMethod::Karachi, AsrMethod::Hanafi);
    let s = vec![
        build_schedule(d(2026, 10, 31), &l, &c, &ManualTimetable::default()).unwrap(),
        build_schedule(d(2026, 11, 1), &l, &c, &ManualTimetable::default()).unwrap(),
    ];
    (s, "Asia/Dhaka".parse().unwrap())
}

fn settings_with(prayer: Prayer, offsets: &[i32]) -> PrayerNotificationSettings {
    let mut s = PrayerNotificationSettings::default();
    for cfg in &mut s.prayers {
        cfg.enabled = cfg.prayer == prayer;
        cfg.reminders = offsets.iter().map(|o| PrayerReminder::new(cfg.prayer, *o)).collect();
    }
    s
}

#[test]
fn multiple_reminders_per_prayer_with_clear_text() {
    let (s, tz) = dhaka_schedules();
    let n = settings_with(Prayer::Asr, &[-20, -5, 0, 5]);
    let from = s[0].entries[0].time - Duration::hours(6);
    let plan = reminders::plan(&s, &n, tz, false, from, from + Duration::hours(48), 64);
    assert_eq!(plan.len(), 8); // 4 reminders × 2 days
    let first_day: Vec<_> = plan.iter().filter(|p| p.date == d(2026, 10, 31)).collect();
    assert_eq!(first_day[0].title, "Prayer Reminder — Asr");
    assert_eq!(first_day[0].body, "Asr prayer is in 20 minutes (3:44 PM).");
    assert_eq!(first_day[2].title, "Prayer Time — Asr");
    assert_eq!(first_day[2].body, "It is time for Asr prayer.");
    assert_eq!(first_day[3].body, "Asr began 5 minutes ago at 3:44 PM.");
    // Stable, unique ids.
    let ids: std::collections::HashSet<_> = plan.iter().map(|p| &p.id).collect();
    assert_eq!(ids.len(), plan.len());
    assert!(plan.windows(2).all(|w| w[0].fire_at <= w[1].fire_at));
}

#[test]
fn duplicates_disabled_and_limits() {
    let (s, tz) = dhaka_schedules();
    let mut n = settings_with(Prayer::Fajr, &[-10, -10, 0]);
    n.prayers[0].reminders.push(PrayerReminder { enabled: false, ..PrayerReminder::new(Prayer::Fajr, -30) });
    let from = s[0].entries[0].time - Duration::hours(2);
    let to = from + Duration::hours(40);
    let plan = reminders::plan(&s, &n, tz, true, from, to, 64);
    assert_eq!(plan.len(), 4, "duplicate -10 collapsed, disabled skipped");
    let plan = reminders::plan(&s, &n, tz, true, from, to, 1);
    assert_eq!(plan.len(), 1, "limit keeps the soonest");
    n.master_enabled = false;
    assert!(reminders::plan(&s, &n, tz, true, from, to, 64).is_empty());
}

#[test]
fn custom_text_placeholders() {
    let (s, tz) = dhaka_schedules();
    let mut n = settings_with(Prayer::Maghrib, &[-15]);
    n.prayers[4].reminders[0].title = Some("🕌 {prayer} soon".into());
    n.prayers[4].reminders[0].message = Some("{minutes} min left — {time}".into());
    let from = s[0].entries[0].time;
    let plan = reminders::plan(&s, &n, tz, true, from, from + Duration::hours(20), 64);
    assert_eq!(plan[0].title, "🕌 Maghrib soon");
    assert_eq!(plan[0].body, "15 min left — 17:20");
}

#[test]
fn due_respects_grace_and_delivered() {
    let (s, tz) = dhaka_schedules();
    let n = settings_with(Prayer::Dhuhr, &[-10, 0]);
    let dhuhr = s[0].entry(Prayer::Dhuhr).unwrap().time;
    let plan = reminders::plan(&s, &n, tz, false, dhuhr - Duration::hours(3), dhuhr + Duration::hours(3), 64);
    let mut delivered = std::collections::HashSet::new();
    // 2 minutes after the -10 reminder.
    let now = dhuhr - Duration::minutes(8);
    let due = reminders::due(&plan, now, Duration::minutes(10), &delivered);
    assert_eq!(due.len(), 1);
    delivered.insert(due[0].id.clone());
    assert!(reminders::due(&plan, now, Duration::minutes(10), &delivered).is_empty());
    // Woke from sleep 2 hours later: both are stale → nothing.
    assert!(reminders::due(&plan, dhuhr + Duration::hours(2), Duration::minutes(10), &delivered).is_empty());
    // Next wake = at Dhuhr.
    assert_eq!(reminders::next_wake(&plan, now, Duration::seconds(60)), Duration::seconds(60));
    assert_eq!(reminders::next_wake(&plan, dhuhr - Duration::seconds(20), Duration::seconds(60)), Duration::seconds(20));
}

// ---------------------------------------------------------------------------
// Service + SQLite
// ---------------------------------------------------------------------------

fn utc(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}

#[test]
fn service_seeds_from_system_timezone_and_persists() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("nexa.sqlite");
    let reminder_ids;
    {
        let mut svc = PrayerService::new(Store::open(&db).unwrap(), "Asia/Dhaka").unwrap();
        let active = svc.active_location().unwrap();
        assert_eq!(active.name, "Dhaka");
        assert_eq!(active.timezone, "Asia/Dhaka");

        let mut c = svc.calculation().unwrap();
        c.method = CalculationMethod::MuslimWorldLeague;
        c.offsets.isha = 500; // clamped
        let c = svc.set_calculation(c).unwrap();
        assert_eq!(c.offsets.isha, 120);

        let mut n = svc.notifications().unwrap();
        n.prayers[0].reminders.push(PrayerReminder::new(Prayer::Fajr, -45));
        let n = svc.set_notifications(n).unwrap();
        reminder_ids = n.prayers[0].reminders.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
        assert_eq!(n.prayers[0].reminders[0].offset_minutes, -45, "sorted by offset");
    }
    let svc = PrayerService::new(Store::open(&db).unwrap(), "Europe/London").unwrap();
    assert_eq!(svc.active_location().unwrap().name, "Dhaka", "not re-seeded");
    assert_eq!(svc.calculation().unwrap().method, CalculationMethod::MuslimWorldLeague);
    let ids: Vec<_> = svc.notifications().unwrap().prayers[0].reminders.iter().map(|r| r.id.clone()).collect();
    assert_eq!(ids, reminder_ids, "reminder ids are stable");
}

#[test]
fn delivered_log_prevents_duplicates_across_restarts() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("nexa.sqlite");
    // 11:40 Dhaka = 2 min before Dhuhr (11:42), default reminders: -10 and 0.
    let now = utc("2026-10-31T05:35:00Z"); // 11:35 local, 3 min after the -10 reminder
    {
        let mut svc = PrayerService::new(Store::open(&db).unwrap(), "Asia/Dhaka").unwrap();
        let (due, upcoming) = svc.take_due(now).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].prayer, Prayer::Dhuhr);
        assert_eq!(due[0].offset_minutes, -10);
        assert!(upcoming.iter().any(|p| p.prayer == Prayer::Dhuhr && p.offset_minutes == 0));
        assert!(svc.take_due(now).unwrap().0.is_empty(), "same process");
    }
    let mut svc = PrayerService::new(Store::open(&db).unwrap(), "Asia/Dhaka").unwrap();
    assert!(svc.take_due(now).unwrap().0.is_empty(), "after restart");
    let (due, _) = svc.take_due(utc("2026-10-31T05:42:30Z")).unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].offset_minutes, 0);
}

#[test]
fn location_management_and_device_location() {
    let mut svc = PrayerService::new(Store::open_in_memory().unwrap(), "Asia/Dhaka").unwrap();
    let first = svc.active_location().unwrap();
    let ny = svc
        .save_location(loc("New York", 40.7128, -74.006, "America/New_York"), true)
        .unwrap();
    assert_eq!(svc.active_location().unwrap().id, ny.id);
    assert!(svc.save_location(loc("Bad", 95.0, 0.0, "UTC"), false).is_err());
    assert!(svc.save_location(loc("Bad", 10.0, 0.0, "Mars/Base"), false).is_err());

    // Device location: name + zone from the offline list, coordinates rounded.
    let dev = svc.set_device_location(23.780_123_9, 90.279_876_5).unwrap();
    assert_eq!(dev.id, DEVICE_LOCATION_ID);
    assert_eq!(dev.timezone, "Asia/Dhaka");
    assert!(dev.name.starts_with("Near "));
    assert_eq!(dev.latitude, 23.7801);
    assert_eq!(svc.active_location().unwrap().id, DEVICE_LOCATION_ID);

    // Switching back to saved locations.
    svc.set_active_location(&first.id).unwrap();
    assert_eq!(svc.active_location().unwrap().id, first.id);

    svc.delete_location(&ny.id).unwrap();
    assert!(svc.delete_location(&first.id).is_err(), "last saved location is kept");

    let snap = svc.snapshot(utc("2026-10-31T05:00:00Z")).unwrap();
    assert_eq!(snap.today.date, d(2026, 10, 31));
    assert_eq!(snap.tomorrow.date, d(2026, 11, 1));
    assert_eq!(snap.next.unwrap().prayer, Prayer::Dhuhr);
    assert_eq!(snap.methods.len(), CalculationMethod::ALL.len());
    assert_eq!(svc.month(2026, 2).unwrap().len(), 28);
}

#[test]
fn manual_timetable_validation() {
    let mut svc = PrayerService::new(Store::open_in_memory().unwrap(), "Asia/Dhaka").unwrap();
    assert!(svc.set_manual(ManualTimetable { fajr: Some("25:00".into()), ..Default::default() }).is_err());
    assert!(svc.set_manual(ManualTimetable { fajr: Some("5:05".into()), ..Default::default() }).is_ok());
}

#[test]
fn city_search_is_offline_and_ranked() {
    let r = cities::search("dhaka", 5);
    assert_eq!(r[0].name, "Dhaka");
    assert_eq!(r[0].timezone, "Asia/Dhaka");
    let r = cities::search("london, canada", 5);
    assert_eq!(r[0].country, "Canada");
    let r = cities::search("new y", 3);
    assert_eq!(r[0].name, "New York");
    assert!(cities::search("   ", 5).is_empty());
    let (c, km) = cities::nearest(21.42, 39.83).unwrap();
    assert!(km < 80.0, "{} {km}", c.name);
}

#[test]
fn prayer_times_are_editable_per_location() {
    let mut svc = PrayerService::new(Store::open_in_memory().unwrap(), "Asia/Dhaka").unwrap();
    let dhaka = svc.active_location().unwrap();
    let day = d(2026, 10, 31);
    let tz: Tz = "Asia/Dhaka".parse().unwrap();
    let local = |s: &DailyPrayerSchedule, p: Prayer| s.entry(p).unwrap().time.with_timezone(&tz).format("%H:%M").to_string();
    let base = svc.schedule_for(day).unwrap();

    // Shift Dhuhr by +8 min (local mosque), pin Isha to 19:30.
    svc.adjust_prayer(Prayer::Dhuhr, PrayerAdjust::Offset { minutes: 8 }).unwrap();
    svc.adjust_prayer(Prayer::Isha, PrayerAdjust::Fixed { time: "19:30".into() }).unwrap();
    let s = svc.schedule_for(day).unwrap();
    assert_eq!(s.entry(Prayer::Dhuhr).unwrap().time - base.entry(Prayer::Dhuhr).unwrap().time, Duration::minutes(8));
    let jamaat = |s: &DailyPrayerSchedule, p: Prayer| s.entry(p).unwrap().jamaat.map(|t| t.with_timezone(&tz).format("%H:%M").to_string());
    assert_eq!(jamaat(&s, Prayer::Isha).as_deref(), Some("19:30"));
    assert_eq!(local(&s, Prayer::Isha), local(&base, Prayer::Isha), "Isha still starts at its calculated time");
    assert_eq!(s.entry(Prayer::Asr).unwrap().source, TimeSource::Calculated);
    assert_eq!(svc.calculation().unwrap().mode, TimetableMode::Manual);

    // Another location starts clean.
    let ctg = svc.save_location(loc("Chattogram", 22.3569, 91.7832, "Asia/Dhaka"), true).unwrap();
    let s = svc.schedule_for(day).unwrap();
    assert!(s.entries.iter().all(|e| e.source == TimeSource::Calculated && e.offset_minutes == 0));
    assert_eq!(svc.calculation().unwrap().mode, TimetableMode::Calculated);

    // Back to Dhaka: its adjustments are still there.
    svc.set_active_location(&dhaka.id).unwrap();
    assert_eq!(jamaat(&svc.schedule_for(day).unwrap(), Prayer::Isha).as_deref(), Some("19:30"));
    assert_eq!(svc.calculation().unwrap().offsets.dhuhr, 8);

    // Reset Isha → back to calculated mode (no fixed times left).
    svc.adjust_prayer(Prayer::Isha, PrayerAdjust::Reset).unwrap();
    assert_eq!(svc.calculation().unwrap().mode, TimetableMode::Calculated);
    assert_eq!(svc.schedule_for(day).unwrap().entry(Prayer::Isha).unwrap().jamaat, None);
    assert!(svc.adjust_prayer(Prayer::Fajr, PrayerAdjust::Fixed { time: "25:00".into() }).is_err());
    let _ = ctg;
}

#[test]
fn jamaat_time_brings_start_before_jamaat_and_jamaat_alerts() {
    let mut svc = PrayerService::new(Store::open_in_memory().unwrap(), "Asia/Dhaka").unwrap();
    let tz: Tz = "Asia/Dhaka".parse().unwrap();
    svc.adjust_prayer(Prayer::Asr, PrayerAdjust::Fixed { time: "16:15".into() }).unwrap();
    let day = d(2026, 11, 3);
    let from = tz.with_ymd_and_hms(2026, 11, 3, 12, 0, 0).unwrap().with_timezone(&Utc);
    let s = svc.schedule_for(day).unwrap();
    let asr = s.entry(Prayer::Asr).unwrap().clone();
    let plan: Vec<_> = svc
        .plan(from, Duration::hours(6), 100)
        .unwrap()
        .into_iter()
        .filter(|p| p.prayer == Prayer::Asr && p.date == day)
        .collect();
    let at: Vec<String> = plan.iter().map(|p| p.fire_at.with_timezone(&tz).format("%H:%M").to_string()).collect();
    let start = asr.time.with_timezone(&tz).format("%H:%M").to_string();
    // start (no "10 min before start" any more), 10 min before jamaat, at jamaat
    assert_eq!(at, vec![start, "16:05".to_string(), "16:15".to_string()]);
    assert!(plan[1].title.contains("jamaat in 10 min"));
    assert!(plan[2].title.contains("jamaat now"));

    // Turn jamaat alerts off: back to the normal reminders around the start.
    let mut n = svc.notifications().unwrap();
    n.jamaat_alerts = false;
    svc.set_notifications(n).unwrap();
    let plan = svc.plan(from, Duration::hours(6), 100).unwrap();
    assert!(plan.iter().filter(|p| p.prayer == Prayer::Asr).all(|p| !p.title.contains("jamaat")));
}
