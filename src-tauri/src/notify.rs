//! Local notifications with sound for prayer times, water, the timer and
//! personal reminders.
//!
//! iOS suspends apps in the background, so instead of a live scheduler thread
//! (as on the Mac) Noor *pre-schedules* the upcoming notifications with the
//! system (UNUserNotificationCenter, via tauri-plugin-notification). Every time
//! something changes — or the app comes back to the foreground — the whole plan
//! is rebuilt: all pending requests are cancelled and the next ≤ 60 events are
//! scheduled again (iOS keeps at most 64 pending notifications per app).
//!
//! Sounds are WAV files that ship inside the app and are copied to
//! `Library/Sounds`, where iOS looks for custom notification sounds.

use std::sync::atomic::{AtomicU64, Ordering};
use nexa_prayer::Prayer;
use crate::island_state::{local_tz, IslandState};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use nexa_widgets::calendar::{self, OccasionKind};
use nexa_widgets::ramadan;
use nexa_widgets::reminders::occurrences;
use nexa_widgets::timer::TimerState;
use nexa_widgets::water::{next_water_reminder, WaterReminderMode, WaterState};
use serde::Serialize;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use tauri::{AppHandle, Emitter, Manager};

/// Without AlarmKit, an alarm reminder repeats this many times, a minute apart.
const ALARM_FALLBACK_REPEATS: i64 = 4;
/// iOS allows 64 pending requests per app; keep a few free for tests.
const MAX_PENDING: usize = 60;
const PRAYER_HORIZON_DAYS: i64 = 8;
const REMINDER_HORIZON_DAYS: i64 = 21;
const SPECIAL_HORIZON_DAYS: i64 = 45;
const SUNNAH_HORIZON_DAYS: i64 = 10;
const MAKRUH_HORIZON_HOURS: i64 = 48;
const WATER_MAX: usize = 10;
const TEST_ID: i32 = 9_999;

/// Built-in sounds: (id, label, bytes). The id is the file stem in `public/sounds`.
pub const SOUNDS: &[(&str, &str, &[u8])] = &[
    ("noor_chime", "Noor Chime", include_bytes!("../sounds/noor_chime.wav")),
    ("noor_dawn", "Dawn (long)", include_bytes!("../sounds/noor_dawn.wav")),
    ("noor_bell", "Bell", include_bytes!("../sounds/noor_bell.wav")),
    ("noor_glass", "Glass", include_bytes!("../sounds/noor_glass.wav")),
    ("noor_soft", "Soft Marimba", include_bytes!("../sounds/noor_soft.wav")),
    ("noor_pop", "Pop", include_bytes!("../sounds/noor_pop.wav")),
    ("noor_timer", "Timer", include_bytes!("../sounds/noor_timer.wav")),
];

/// Sound setting → file name in Library/Sounds. `None` = silent notification.
/// Accepts the macOS names used by Nexa Island so imported settings still work.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn sound_file(name: &str) -> Option<String> {
    // A spoken text rendered into Library/Sounds (see voice.rs).
    if let Some(file) = name.strip_prefix("voice:") {
        return Some(file.to_string());
    }
    let id = match name.trim() {
        "" | "none" => return None,
        "default" => "noor_chime",
        "Glass" | "Ping" => "noor_glass",
        "Pop" | "Bottle" => "noor_pop",
        "Tink" | "Morse" => "noor_bell",
        "Hero" | "Submarine" => "noor_dawn",
        "Purr" | "Blow" => "noor_soft",
        n if SOUNDS.iter().any(|(id, _, _)| *id == n) => n,
        _ => "noor_chime",
    };
    Some(format!("{id}.wav"))
}

/// Copy the sounds into `Library/Sounds` (iOS reads custom notification sounds from there).
pub fn install_sounds(app: &AppHandle) {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let library = home.map(|h| h.join("Library")).or_else(|| {
        app.path().app_data_dir().ok().and_then(|d| d.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
    });
    let Some(dir) = library.map(|l| l.join("Sounds")) else { return };
    if !cfg!(target_os = "ios") {
        return; // desktop builds play sounds through the system
    }
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("Noor: cannot create {}: {e}", dir.display());
        return;
    }
    for (id, _, bytes) in SOUNDS {
        let path = dir.join(format!("{id}.wav"));
        let same = std::fs::metadata(&path).map(|m| m.len() == bytes.len() as u64).unwrap_or(false);
        if !same {
            if let Err(e) = std::fs::write(&path, bytes) {
                eprintln!("Noor: cannot write {}: {e}", path.display());
            }
        }
    }
}

/// One notification Noor wants the system to deliver.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    /// prayer | ramadan | special | cycle | water | timer | reminder | refresh
    pub kind: String,
    /// Screen to open when the notification is tapped.
    pub route: String,
    pub fire_at: DateTime<Utc>,
    pub title: String,
    pub body: String,
    pub sound: String,
    /// What it is about, for the user's language and wording (see `voice.rs`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<crate::voice::Event>,
    /// Text spoken aloud as the alert sound (iPhone).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speak: Option<String>,
}

/// A local wall-clock time on a date → UTC.
fn at_local(tz: Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Utc>> {
    tz.from_local_datetime(&date.and_time(time)).earliest().map(|t| t.with_timezone(&Utc))
}

/// Everything that should be scheduled from `now`, soonest first, capped at the iOS limit.
pub fn plan_all(state: &IslandState, now: DateTime<Utc>) -> Vec<Planned> {
    let mut out: Vec<Planned> = Vec::new();
    let soon = now + Duration::seconds(5);
    let tz = local_tz();

    // ----- Ramadan window (decides whether prayer alerts get lean) --------
    let (cal_settings, ram_settings) = match state.wdb.lock() {
        Ok(db) => (crate::noor::calendar_settings_of(&db), crate::noor::ramadan_settings_of(&db)),
        Err(_) => Default::default(),
    };
    let today = now.with_timezone(&tz).date_naive();
    let (ram_year, ram_start, ram_end) = ramadan::current_or_next(today, cal_settings.hijri_adjust, &ram_settings);
    let horizon_end = today + Duration::days(PRAYER_HORIZON_DAYS);
    let ramadan_in_reach = ram_settings.enabled && ram_start <= horizon_end && ram_end >= today;
    let _ = ram_year;

    // ----- prayers --------------------------------------------------------
    if let Ok(mut svc) = state.svc.lock() {
        match svc.plan(now, Duration::days(PRAYER_HORIZON_DAYS), 400) {
            Ok(list) => {
                for p in list.into_iter().filter(|p| p.fire_at > soon) {
                    // During Ramadan keep only the at-time prayer alerts so Sehri/Iftar fit in the 60 slots.
                    let in_ramadan = {
                        let d = p.fire_at.with_timezone(&tz).date_naive();
                        d >= ram_start && d <= ram_end
                    };
                    if ramadan_in_reach && ram_settings.lean_prayer_alerts && in_ramadan && p.offset_minutes != 0 {
                        continue;
                    }
                    let key = p.prayer.key();
                    let event = Some(match (p.reminder_id.as_str(), p.offset_minutes) {
                        ("jamaat-before", off) => crate::voice::Event::prayer("jamaat_before", key, Some(-(off as i64))),
                        ("jamaat", _) => crate::voice::Event::prayer("jamaat", key, None),
                        (_, 0) if key == "sunrise" => crate::voice::Event::new("sunrise"),
                        (_, 0) => crate::voice::Event::prayer("prayer_start", key, None),
                        (_, off) if off < 0 => crate::voice::Event::prayer("prayer_before", key, Some(-(off as i64))),
                        (_, off) => crate::voice::Event::prayer("prayer_after", key, Some(off as i64)),
                    });
                    out.push(Planned {
                        kind: "prayer".into(),
                        route: format!("prayer:{}", p.prayer.key()),
                        fire_at: p.fire_at,
                        title: p.title,
                        body: p.body,
                        sound: p.sound, event, ..Default::default()
                    });
                }
            }
            Err(e) => eprintln!("Noor: prayer planning failed: {e}"),
        }
    }

    // ----- Ramadan: Sehri wake-up & Iftar --------------------------------
    if ramadan_in_reach {
        let use24 = state.wdb.lock().ok().and_then(|db| db.island_settings().ok()).map(|s| s.use_24_hour).unwrap_or(false);
        let first = today.max(ram_start) - Duration::days(1); // yesterday's Maghrib may still be ahead in other zones
        let first = first.max(ram_start);
        let count = ((ram_end - first).num_days() + 1).clamp(0, PRAYER_HORIZON_DAYS + 2) as u32;
        let days = match state.svc.lock() {
            Ok(mut svc) => crate::noor::ramadan_times(&mut svc, ram_start, first, count),
            Err(_) => vec![],
        };
        for a in ramadan::plan_alerts(&ram_settings, &days, tz, use24, soon, now + Duration::days(PRAYER_HORIZON_DAYS)) {
            let event = match a.kind {
                "wake" => Some(crate::voice::Event::new("sehri_wake")),
                "sehri" => Some(crate::voice::Event { minutes: Some(ram_settings.sehri_warning_min as i64), ..crate::voice::Event::new("sehri_before") }),
                "sehri-end" => Some(crate::voice::Event::new("sehri_end")),
                "headsup" => Some(crate::voice::Event { minutes: Some(ram_settings.iftar_headsup_min as i64), ..crate::voice::Event::new("iftar_before") }),
                "iftar" => Some(crate::voice::Event::new("iftar")),
                _ => None,
            };
            out.push(Planned { kind: "ramadan".into(), route: "ramadan".into(), fire_at: a.at, title: a.title, body: a.body, sound: a.sound, event, ..Default::default() });
        }
    }

    if let Ok(db) = state.wdb.lock() {
        // ----- special days & holidays --------------------------------------
        let specials = db.special_days().unwrap_or_default();
        let until = today + Duration::days(SPECIAL_HORIZON_DAYS);
        for sd in specials.iter().filter(|s| s.alert) {
            let time = nexa_widgets::specials::parse_hhmm(&sd.alert_time).unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
            for date in sd.dates_between(today, until + Duration::days(sd.days_before as i64), cal_settings.hijri_adjust) {
                let alert_day = date - Duration::days(sd.days_before as i64);
                let Some(at) = at_local(tz, alert_day, time).filter(|t| *t > soon) else { continue };
                let body = match sd.days_before {
                    0 => if sd.note.is_empty() { "Today".to_string() } else { sd.note.clone() },
                    1 => format!("Tomorrow{}", if sd.note.is_empty() { String::new() } else { format!(" — {}", sd.note) }),
                    n => format!("In {n} days{}", if sd.note.is_empty() { String::new() } else { format!(" — {}", sd.note) }),
                };
                out.push(Planned { kind: "special".into(), route: "calendar".into(), fire_at: at, title: sd.title.clone(), body, sound: sd.sound.clone(), ..Default::default() });
            }
        }
        if cal_settings.holiday_alerts {
            let nine_pm = NaiveTime::from_hms_opt(20, 0, 0).unwrap();
            for d in calendar::upcoming(today, SPECIAL_HORIZON_DAYS, &cal_settings, &[], false) {
                if d.occasion.kind != OccasionKind::Holiday {
                    continue;
                }
                let Ok(date) = NaiveDate::parse_from_str(&d.date, "%Y-%m-%d") else { continue };
                let Some(at) = at_local(tz, date - Duration::days(1), nine_pm).filter(|t| *t > soon) else { continue };
                out.push(Planned {
                    kind: "special".into(),
                    route: "calendar".into(),
                    fire_at: at,
                    title: format!("Tomorrow: {}", d.occasion.en),
                    body: if d.occasion.bn.is_empty() { "Public holiday".into() } else { format!("{} · Public holiday", d.occasion.bn) },
                    sound: "noor_soft".into(), ..Default::default()
                });
            }
        }

        // ----- cycle tracker ------------------------------------------------
        let cycle_data = crate::noor::cycle_of(&db);
        let cs = &cycle_data.settings;
        if (cs.remind_period || cs.remind_fertile) && !cycle_data.periods.is_empty() {
            let st = nexa_widgets::cycle::status(&cycle_data, today);
            let time = nexa_widgets::specials::parse_hhmm(&cs.remind_time).unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
            let who = if cs.name.is_empty() { String::new() } else { format!(" · {}", cs.name) };
            let mut add = |date: NaiveDate, title: String, body: String| {
                if let Some(at) = at_local(tz, date, time).filter(|t| *t > soon && *t < now + Duration::days(SPECIAL_HORIZON_DAYS)) {
                    out.push(Planned { kind: "cycle".into(), route: "cycle".into(), fire_at: at, title, body, sound: "noor_soft".into(), ..Default::default() });
                }
            };
            if let Some(next) = st.next_start {
                if cs.remind_period {
                    let n = cs.remind_days_before as i64;
                    if n > 0 {
                        let (t, b) = if cs.discreet {
                            ("Cycle reminder".to_string(), format!("Expected in {n} day{}{who}", if n == 1 { "" } else { "s" }))
                        } else {
                            (format!("Period expected in {n} day{}", if n == 1 { "" } else { "s" }), format!("Around {}{who}", next.format("%a %-d %b")))
                        };
                        add(next - Duration::days(n), t, b);
                    }
                    let (t, b) = if cs.discreet {
                        ("Cycle reminder".to_string(), format!("Expected today{who}"))
                    } else {
                        ("Period expected today".to_string(), format!("Log it in Noor when it starts{who}"))
                    };
                    add(next, t, b);
                }
            }
            if cs.remind_fertile {
                if let Some(f) = st.fertile_start.filter(|f| *f > today) {
                    let (t, b) = if cs.discreet {
                        ("Cycle reminder".to_string(), format!("A new phase starts tomorrow{who}"))
                    } else {
                        ("Fertile window starts tomorrow".to_string(), format!("Estimated — ovulation around {}{who}", st.ovulation.map(|o| o.format("%a %-d %b").to_string()).unwrap_or_default()))
                    };
                    add(f - Duration::days(1), t, b);
                }
            }
        }

        // ----- fitness: weekly weigh-in -------------------------------------
        let fit = crate::noor::fitness_of(&db).profile;
        if fit.weigh_reminder {
            let time = nexa_widgets::specials::parse_hhmm(&fit.weigh_time).unwrap_or_else(|| NaiveTime::from_hms_opt(8, 0, 0).unwrap());
            for i in 0..15 {
                let date = today + Duration::days(i);
                if date.weekday().number_from_monday() != fit.weigh_day {
                    continue;
                }
                if let Some(at) = at_local(tz, date, time).filter(|t| *t > soon) {
                    out.push(Planned {
                        kind: "fitness".into(),
                        route: "fitness".into(),
                        fire_at: at,
                        title: "Weigh-in day ⚖️".into(),
                        body: "Step on the scale before breakfast and log it in Noor to keep your trend accurate.".into(),
                        sound: "noor_soft".into(), ..Default::default()
                    });
                }
            }
        }

        // ----- timer -------------------------------------------------------
        let timer: TimerState = db.get_json("timer").ok().flatten().unwrap_or_default();
        if let Some(end) = timer.ends_at {
            if let Some(at) = DateTime::from_timestamp_millis(end).filter(|t| *t > soon) {
                let label = if timer.label.is_empty() { "Timer".to_string() } else { timer.label.clone() };
                out.push(Planned {
                    kind: "timer".into(),
                    route: "timer".into(),
                    fire_at: at,
                    title: format!("{label} — done ⏱"),
                    body: "Your timer has finished.".into(),
                    sound: "noor_timer".into(), ..Default::default()
                });
            }
        }

        // ----- water (simulated forward: assumes no more drinks) ----------
        if let Ok(settings) = db.island_settings() {
            let water = settings.water;
            if water.reminders {
                let today = now.with_timezone(&tz).date_naive();
                let total = db.water_today(now, tz, water.goal_ml).map(|t| t.total_ml).unwrap_or(0);
                let mut st = WaterState {
                    now,
                    last_drink: db.water_last_drink().ok().flatten(),
                    last_reminder: Some(now),
                    today_total_ml: total,
                };
                let mut count = 0;
                let mut guard = 0;
                while count < WATER_MAX && guard < 40 {
                    guard += 1;
                    let Some(due) = next_water_reminder(&water, st, tz) else { break };
                    if due.at > now + Duration::hours(36) {
                        break;
                    }
                    let at = due.at.max(soon + Duration::seconds(1));
                    let on_today = at.with_timezone(&tz).date_naive() == today;
                    let so_far = if on_today { total } else { 0 };
                    let left = (water.goal_ml as i64 - so_far).max(0);
                    let body = match water.mode {
                        WaterReminderMode::Smart if due.behind_ml > 0 && on_today => format!(
                            "You're {} ml behind today's pace — have a glass ({} ml). {so_far}/{} ml so far.",
                            due.behind_ml, water.glass_ml, water.goal_ml
                        ),
                        _ => format!("Have a glass ({} ml). {so_far} ml so far — {left} ml to go.", water.glass_ml),
                    };
                    out.push(Planned {
                        kind: "water".into(),
                        route: "water".into(),
                        fire_at: at,
                        title: "Time to drink water 💧".into(),
                        body,
                        sound: "noor_pop".into(), ..Default::default()
                    });
                    count += 1;
                    let next_today = if on_today { total } else { 0 };
                    st = WaterState { now: at + Duration::seconds(1), last_reminder: Some(at), today_total_ml: next_today, ..st };
                }
            }
        }

        // ----- personal reminders -----------------------------------------
        if let Ok(list) = db.reminders() {
            for r in list {
                // Each occurrence may bring several alerts (before + exact): plan fewer occurrences
                // then, to leave room in iOS's limit of 64 pending notifications.
                let per = 1 + r.before.len();
                let max_occ = (30 / per).max(3);
                let time_fmt = |t: chrono::DateTime<Utc>| t.with_timezone(&tz).format("%-I:%M %p").to_string();
                for at in occurrences(&r, tz, soon, now + Duration::days(REMINDER_HORIZON_DAYS), max_occ) {
                    for &m in &r.before {
                        let early = at - Duration::minutes(m as i64);
                        if early <= soon {
                            continue;
                        }
                        out.push(Planned {
                            kind: "reminder".into(),
                            route: format!("reminder:{}", r.id),
                            fire_at: early,
                            title: format!("{} · in {}", r.title, nexa_widgets::reminders::before_label(m)),
                            body: if r.note.is_empty() { format!("At {}", time_fmt(at)) } else { format!("At {} · {}", time_fmt(at), r.note) },
                            sound: r.sound.clone(), ..Default::default()
                        });
                    }
                    if r.exact {
                        let body = if r.note.is_empty() { "Reminder".to_string() } else { r.note.clone() };
                        if r.alarm && crate::ios_alarm::supported() {
                            // Rings until stopped: handed to AlarmKit in `reschedule`.
                            out.push(Planned {
                                kind: "alarm".into(),
                                route: format!("reminder:{}", r.id),
                                fire_at: at,
                                title: format!("⏰ {}", r.title),
                                body,
                                sound: r.sound.clone(), ..Default::default()
                            });
                        } else {
                            out.push(Planned {
                                kind: "reminder".into(),
                                route: format!("reminder:{}", r.id),
                                fire_at: at,
                                title: r.title.clone(),
                                body: body.clone(),
                                sound: r.sound.clone(), ..Default::default()
                            });
                            if r.alarm {
                                // No real alarms here: keep ringing once a minute for 5 minutes.
                                for k in 1..=ALARM_FALLBACK_REPEATS {
                                    out.push(Planned {
                                        kind: "reminder".into(),
                                        route: format!("reminder:{}", r.id),
                                        fire_at: at + Duration::minutes(k),
                                        title: format!("⏰ {} (still ringing)", r.title),
                                        body: body.clone(),
                                        sound: r.sound.clone(), ..Default::default()
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ----- Sunnah fasts & Friday (Kahf, Jumu'ah, durud) ------------------
    if cal_settings.fasting_alerts || cal_settings.friday_reminders || cal_settings.makruh_alerts {
        let use24 = state.wdb.lock().ok().and_then(|db| db.island_settings().ok()).map(|s| s.use_24_hour).unwrap_or(false);
        let days: Vec<nexa_widgets::sunnah::SunnahDay> = match state.svc.lock() {
            Ok(mut svc) => (0..=SUNNAH_HORIZON_DAYS)
                .map(|i| {
                    let date = today + Duration::days(i);
                    let sched = svc.schedule_for(date).ok();
                    let t = |p: Prayer| sched.as_ref().and_then(|s| s.entry(p)).map(|e| e.time);
                    let c = |p: Prayer| sched.as_ref().and_then(|s| s.entry(p)).map(|e| e.calculated_time.unwrap_or(e.time));
                    nexa_widgets::sunnah::SunnahDay {
                        date,
                        fajr: t(Prayer::Fajr),
                        // Jumu'ah alerts follow the mosque's jamaat when one is set.
                        dhuhr: sched.as_ref().and_then(|s| s.entry(Prayer::Dhuhr)).map(|e| e.jamaat.unwrap_or(e.time)),
                        asr: t(Prayer::Asr),
                        sunrise_calc: c(Prayer::Sunrise),
                        dhuhr_calc: c(Prayer::Dhuhr),
                        maghrib_calc: c(Prayer::Maghrib),
                    }
                })
                .collect(),
            Err(_) => vec![],
        };
        for a in nexa_widgets::sunnah::plan(&cal_settings, &days, tz, use24, soon, now + Duration::days(SUNNAH_HORIZON_DAYS)) {
            out.push(Planned { kind: "sunnah".into(), route: a.route, fire_at: a.at, title: a.title, body: a.body, sound: "noor_soft".into(), ..Default::default() });
        }
        if cal_settings.makruh_alerts {
            // Six a day, so only the next ~2 days to leave room for prayer alerts.
            for a in nexa_widgets::sunnah::plan_makruh(&days, tz, use24, soon, now + Duration::hours(MAKRUH_HORIZON_HOURS)) {
                let event = Some(crate::voice::Event::new(if a.kind == "makruh-end" { "makruh_end" } else { "makruh_start" }));
                out.push(Planned { kind: "makruh".into(), route: a.route, fire_at: a.at, title: a.title, body: a.body, sound: "noor_soft".into(), event, ..Default::default() });
            }
        }
    }

    // ----- language & spoken text --------------------------------------
    let voice = state.wdb.lock().ok().map(|db| crate::voice::settings_of(&db)).unwrap_or_default();
    for p in out.iter_mut() {
        if let Some(ev) = &p.event {
            let (title, speak) = crate::voice::apply(&voice, ev);
            if let Some(t) = title {
                p.title = t;
            }
            p.speak = speak;
        }
    }

    out.sort_by(|a, b| a.fire_at.cmp(&b.fire_at));
    if out.len() > MAX_PENDING {
        out.truncate(MAX_PENDING - 1);
        let last = out.last().map(|p| p.fire_at).unwrap_or(now);
        out.push(Planned {
            kind: "refresh".into(),
            route: "today".into(),
            fire_at: last + Duration::minutes(1),
            title: "Open Noor ✨".into(),
            body: "Tap to keep your prayer times and reminders coming.".into(),
            sound: "noor_soft".into(), ..Default::default()
        });
    }
    out
}

/// Fingerprint of the plan last handed to iOS (0 = none / must reschedule).
static LAST_PLAN: AtomicU64 = AtomicU64::new(0);

/// Make the next re-plan schedule everything even if the plan looks unchanged.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn force_next() {
    LAST_PLAN.store(0, Ordering::SeqCst);
}

/// Background thread that re-plans (debounced) whenever something changes.
pub fn spawn(app: AppHandle, rx: Receiver<()>) {
    std::thread::Builder::new()
        .name("noor-notify".into())
        .spawn(move || loop {
            match rx.recv() {
                Ok(()) => {
                    // Collapse bursts of changes (typing in a settings form) into one pass.
                    loop {
                        match rx.recv_timeout(std::time::Duration::from_millis(600)) {
                            Ok(()) => continue,
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    reschedule(&app);
                }
                Err(_) => return,
            }
        })
        .expect("spawn notification thread");
}

/// Replace every pending notification with the current plan.
pub fn reschedule(app: &AppHandle) {
    let state = app.state::<IslandState>();
    #[allow(unused_mut)]
    let mut plan = plan_all(&state, Utc::now());
    // Battery: Noor re-plans on every launch, foreground and setting change. When the plan is
    // exactly what iOS already has queued, skip the cancel-and-reschedule of ~60 notifications
    // (plus voice files and alarms).
    {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        format!("{plan:?}").hash(&mut h);
        let fp = h.finish().max(1);
        if LAST_PLAN.swap(fp, Ordering::SeqCst) == fp {
            return;
        }
    }
    // iPhone: turn spoken texts into alert sounds before scheduling.
    let voice_lang = state.wdb.lock().ok().map(|db| crate::voice::settings_of(&db).voice_lang()).unwrap_or_default();
    crate::voice::prepare_audio(&mut plan, voice_lang);
    // iPhone 26+: alarm reminders go to AlarmKit (ring until Stop); the rest stay notifications.
    if crate::ios_alarm::supported() {
        let alarms: Vec<(String, i64, String)> = plan
            .iter()
            .filter(|p| p.kind == "alarm")
            .take(20)
            .map(|p| (crate::ios_alarm::alarm_uuid(&p.route, p.fire_at.timestamp()), p.fire_at.timestamp(), p.title.trim_start_matches("⏰ ").to_string()))
            .collect();
        let res = crate::ios_alarm::sync(&alarms);
        if res == "ok" {
            plan.retain(|p| p.kind != "alarm");
        } else {
            eprintln!("Noor: alarms not scheduled ({res}); using notifications");
            for p in plan.iter_mut().filter(|p| p.kind == "alarm") {
                p.kind = "reminder".into();
            }
        }
    }
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::{NotificationExt, PermissionState};
        let n = app.notification();
        if !matches!(n.permission_state(), Ok(PermissionState::Granted)) {
            LAST_PLAN.store(0, Ordering::SeqCst);
            let _ = app.emit("notify://scheduled", 0usize);
            return;
        }
        let _ = n.cancel_all();
        let mut ok = 0usize;
        for (i, p) in plan.iter().enumerate() {
            if schedule_one(app, i as i32 + 1, p) {
                ok += 1;
            }
        }
        let _ = app.emit("notify://scheduled", ok);
    }
    #[cfg(not(mobile))]
    {
        // Desktop preview builds: nothing is scheduled (the desktop plugin
        // would show everything immediately). The plan is still visible in the UI.
        let _ = app.emit("notify://scheduled", plan.len());
    }
}

/// The local wall-clock time of `at` (device time zone), labelled as UTC, at whole-second precision.
/// Example: 18:27 in Dhaka (12:27 UTC) → `…T18:27:00Z`, which the iOS plugin reads as 18:27 local.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn ios_wall_clock(at: DateTime<Utc>) -> Option<time::OffsetDateTime> {
    let local = at.with_timezone(&local_tz()).naive_local();
    time::OffsetDateTime::from_unix_timestamp(local.and_utc().timestamp()).ok()
}

#[cfg(mobile)]
fn schedule_one(app: &AppHandle, id: i32, p: &Planned) -> bool {
    use chrono::{Datelike, Timelike};
    use tauri_plugin_notification::{NotificationExt, Schedule, ScheduleInterval};

    let build = || {
        #[allow(unused_mut)]
        let mut b = app
            .notification()
            .builder()
            .id(id)
            .title(&p.title)
            .body(&p.body)
            .extra("route", p.route.clone())
            .extra("kind", p.kind.clone());
        // Custom sounds are installed for iOS (Library/Sounds); Android uses its default sound.
        #[cfg(target_os = "ios")]
        if let Some(file) = sound_file(&p.sound) {
            b = b.sound(file);
        }
        b
    };

    // 1) exact moment. tauri-plugin-notification's iOS side parses the date with a DateFormatter
    //    that treats the trailing 'Z' as literal text and reads the clock time in the phone's own
    //    time zone. So we pass the *local* wall-clock time labelled as UTC (see `ios_wall_clock`).
    #[cfg(target_os = "ios")]
    let exact = ios_wall_clock(p.fire_at);
    // Android's side parses the instant correctly: send the real UTC time.
    #[cfg(not(target_os = "ios"))]
    let exact = time::OffsetDateTime::from_unix_timestamp(p.fire_at.timestamp()).ok();
    if let Some(date) = exact {
        let at = Schedule::At { date, repeating: false, allow_while_idle: true };
        if build().schedule(at).show().is_ok() {
            return true;
        }
    }
    // 2) fallback: calendar trigger in the device's own time zone
    let local = p.fire_at.with_timezone(&local_tz());
    let interval = ScheduleInterval {
        year: None,
        month: Some(local.month() as u8),
        day: Some(local.day() as u8),
        weekday: None,
        hour: Some(local.hour() as u8),
        minute: Some(local.minute() as u8),
        second: Some(local.second() as u8),
    };
    match build().schedule(Schedule::Interval { interval, allow_while_idle: true }).show() {
        Ok(()) => true,
        Err(e) => {
            eprintln!("Noor: could not schedule '{}': {e}", p.title);
            false
        }
    }
}

// ----- commands ---------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundInfo {
    pub id: &'static str,
    pub label: &'static str,
}

#[tauri::command]
pub fn notify_sounds() -> Vec<SoundInfo> {
    SOUNDS.iter().map(|(id, label, _)| SoundInfo { id, label }).collect()
}

/// The notifications that will be delivered next (what the system has queued).
#[tauri::command]
pub fn notify_upcoming(state: tauri::State<'_, IslandState>, limit: Option<usize>) -> Vec<Planned> {
    let mut plan = plan_all(&state, Utc::now());
    plan.truncate(limit.unwrap_or(MAX_PENDING));
    plan
}

/// Re-plan now (the app calls this on launch and whenever it returns to the foreground).
#[tauri::command]
pub fn notify_refresh(state: tauri::State<'_, IslandState>) {
    state.refresh_scheduler();
}

/// "granted" | "denied" | "prompt". With `request`, asks iOS for permission first.
#[tauri::command(async)]
pub fn notify_permission(app: AppHandle, request: bool) -> String {
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::{NotificationExt, PermissionState};
        let n = app.notification();
        let mut s = n.permission_state();
        if request && !matches!(s, Ok(PermissionState::Granted)) {
            s = n.request_permission();
        }
        let out = match s {
            Ok(PermissionState::Granted) => "granted",
            Ok(PermissionState::Denied) => "denied",
            _ => "prompt",
        };
        if out == "granted" {
            force_next();
            app.state::<IslandState>().refresh_scheduler();
        }
        out.to_string()
    }
    #[cfg(not(mobile))]
    {
        let _ = (app, request);
        "granted".to_string()
    }
}

/// Send a sample notification in a few seconds (lock the phone to hear it).
#[tauri::command(async)]
pub fn notify_test(app: AppHandle, title: Option<String>, body: Option<String>, sound: Option<String>, delay_secs: Option<i64>) -> Result<(), String> {
    let p = Planned {
        kind: "test".into(),
        route: "today".into(),
        fire_at: Utc::now() + Duration::seconds(delay_secs.unwrap_or(5).clamp(2, 3600)),
        title: title.unwrap_or_else(|| "Noor ✨".into()),
        body: body.unwrap_or_else(|| "This is how your reminders will look and sound.".into()),
        sound: sound.unwrap_or_else(|| "default".into()), ..Default::default()
    };
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().cancel(vec![TEST_ID]);
        if !schedule_one(&app, TEST_ID, &p) {
            return Err("iOS refused the notification. Check Settings › Noor › Notifications.".into());
        }
        Ok(())
    }
    #[cfg(not(mobile))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = TEST_ID;
        app.notification().builder().title(&p.title).body(&p.body).show().map_err(|e| e.to_string())
    }
}

/// Deliver one notification a few seconds from now (used by the voice test).
pub fn send_test(app: &AppHandle, p: &Planned) -> Result<(), String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().cancel(vec![TEST_ID]);
        if !schedule_one(app, TEST_ID, p) {
            return Err("iOS refused the notification. Check Settings › Noor › Notifications.".into());
        }
        Ok(())
    }
    #[cfg(not(mobile))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification().builder().title(&p.title).body(&p.body).show().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nexa_prayer::{PrayerService, Store};
    use nexa_widgets::reminders::{ReminderInput, Repeat};
    use nexa_widgets::WidgetDb;
    use std::sync::{mpsc, Mutex};

    fn state(dir: &std::path::Path) -> IslandState {
        let db = dir.join("noor.sqlite");
        let svc = PrayerService::new(Store::open(&db).unwrap(), "Asia/Dhaka").unwrap();
        let wdb = WidgetDb::open(&db).unwrap();
        let (tx, _rx) = mpsc::channel();
        IslandState { svc: Mutex::new(svc), wdb: Mutex::new(wdb), scheduler: Mutex::new(tx) }
    }

    #[test]
    fn plan_mixes_every_kind_sorted_and_capped() {
        let dir = tempfile::tempdir().unwrap();
        let st = state(dir.path());
        let now = Utc::now();
        {
            let db = st.wdb.lock().unwrap();
            let mut s = db.island_settings().unwrap();
            s.water.reminders = true;
            s.water.start = "00:00".into();
            s.water.end = "23:59".into();
            db.set_island_settings(s).unwrap();
            let t = TimerState::start(10 * 60_000, "Tea", now.timestamp_millis());
            db.set_json("timer", &t).unwrap();
            let at = (now + Duration::hours(2)).with_timezone(&local_tz()).format("%Y-%m-%dT%H:%M").to_string();
            db.reminder_save(ReminderInput {
                id: None,
                title: "Vitamins".into(),
                note: String::new(),
                at,
                repeat: Repeat::Daily,
                enabled: true,
                sound: "noor_bell".into(),
                color: String::new(),
                before: vec![30],
                exact: true,
                alarm: false,
            })
            .unwrap();
        }
        let plan = plan_all(&st, now);
        // The reminder alerts 30 min early and at the time.
        let vit: Vec<_> = plan.iter().filter(|p| p.kind == "reminder").take(2).collect();
        assert_eq!(vit.len(), 2);
        assert_eq!(vit[1].fire_at - vit[0].fire_at, Duration::minutes(30));
        assert_eq!(vit[0].title, "Vitamins · in 30 min");
        assert!(plan.len() <= MAX_PENDING, "{} planned", plan.len());
        assert!(plan.windows(2).all(|w| w[0].fire_at <= w[1].fire_at));
        assert!(plan.iter().all(|p| p.fire_at > now));
        for kind in ["prayer", "timer", "reminder", "water"] {
            assert!(plan.iter().any(|p| p.kind == kind), "missing {kind}: {:?}", plan.iter().map(|p| &p.kind).collect::<Vec<_>>());
        }
        let timer = plan.iter().find(|p| p.kind == "timer").unwrap();
        assert_eq!(timer.title, "Tea — done ⏱");
    }

    #[test]
    fn ramadan_and_special_alerts_join_the_plan() {
        use nexa_widgets::ramadan::RamadanSettings;
        use nexa_widgets::specials::{DateKind, SpecialInput};
        let dir = tempfile::tempdir().unwrap();
        let st = state(dir.path());
        let now = Utc::now();
        let tz = local_tz();
        let today = now.with_timezone(&tz).date_naive();
        {
            let db = st.wdb.lock().unwrap();
            let rs = RamadanSettings {
                override_year: Some(nexa_widgets::calendar::hijri_for(today, 0).year),
                override_start: Some((today - Duration::days(1)).format("%Y-%m-%d").to_string()),
                ..Default::default()
            };
            db.set_json("ramadan", &rs).unwrap();
            let d = today + Duration::days(3);
            db.special_save(SpecialInput {
                id: None, title: "Anniversary".into(), note: String::new(), calendar: DateKind::Gregorian,
                month: chrono::Datelike::month(&d), day: chrono::Datelike::day(&d), year: None, alert: true,
                alert_time: "23:00".into(), days_before: 1, sound: String::new(), color: String::new(),
            }).unwrap();
        }
        let plan = plan_all(&st, now);
        assert!(plan.len() <= MAX_PENDING);
        assert!(plan.windows(2).all(|w| w[0].fire_at <= w[1].fire_at));
        let kinds = |k: &str| plan.iter().filter(|p| p.kind == k).count();
        assert!(kinds("ramadan") >= 4, "ramadan alerts: {}", kinds("ramadan"));
        assert!(plan.iter().any(|p| p.kind == "ramadan" && p.title.starts_with("Iftar")));
        assert_eq!(kinds("special"), 1);
        // lean prayers: only at-time alerts (no "in 15 min" lead-ins) while Ramadan is under way
        assert!(plan.iter().filter(|p| p.kind == "prayer").all(|p| !p.body.to_lowercase().contains("in 15")), "{:?}", plan.iter().filter(|p| p.kind == "prayer").map(|p| &p.body).collect::<Vec<_>>());
    }

    #[test]
    fn ios_dates_are_local_wall_clock() {
        use chrono::TimeZone;
        // Whatever the machine's zone, the wall-clock fields must match the local time, labelled UTC.
        let at = Utc.with_ymd_and_hms(2026, 11, 2, 12, 27, 0).unwrap();
        let local = at.with_timezone(&local_tz());
        let d = ios_wall_clock(at).unwrap();
        assert_eq!(d.offset(), time::UtcOffset::UTC);
        assert_eq!(d.hour() as u32, chrono::Timelike::hour(&local));
        assert_eq!(d.minute() as u32, chrono::Timelike::minute(&local));
        assert_eq!(d.day() as u32, chrono::Datelike::day(&local));
        assert_eq!(d.nanosecond(), 0);
    }

    #[test]
    fn sound_names_map_to_bundled_files() {
        assert_eq!(sound_file("default").as_deref(), Some("noor_chime.wav"));
        assert_eq!(sound_file("none"), None);
        assert_eq!(sound_file("Glass").as_deref(), Some("noor_glass.wav"));
        assert_eq!(sound_file("noor_dawn").as_deref(), Some("noor_dawn.wav"));
        assert_eq!(sound_file("whatever").as_deref(), Some("noor_chime.wav"));
    }
}
