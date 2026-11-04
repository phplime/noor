//! Resolves reminder settings against concrete schedules and decides which
//! notifications are due. Pure functions — the Tauri scheduler thread calls them.

use crate::models::*;
use crate::schedule::format_time;
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use std::collections::HashSet;

pub const DEFAULT_TITLE_BEFORE: &str = "Prayer Reminder — {prayer}";
pub const DEFAULT_BODY_BEFORE: &str = "{prayer} prayer is in {minutes} minutes ({time}).";
pub const DEFAULT_TITLE_AT: &str = "Prayer Time — {prayer}";
pub const DEFAULT_BODY_AT: &str = "It is time for {prayer} prayer.";
pub const DEFAULT_TITLE_AFTER: &str = "{prayer} — {minutes} minutes ago";
pub const DEFAULT_BODY_AFTER: &str = "{prayer} began {minutes} minutes ago at {time}.";

pub const SUNRISE_BODY_BEFORE: &str = "Sunrise is in {minutes} minutes ({time}).";
pub const SUNRISE_BODY_AT: &str = "The sun is rising now ({time}).";

/// Stable notification id for one reminder on one day.
pub fn notification_id(schedule_date: chrono::NaiveDate, prayer: Prayer, reminder_id: &str) -> String {
    format!("prayer:{schedule_date}:{}:{reminder_id}", prayer.key())
}

pub fn render_template(template: &str, prayer: Prayer, minutes: i32, time: &str) -> String {
    template
        .replace("{prayer}", prayer.name())
        .replace("{minutes}", &minutes.abs().to_string())
        .replace("{time}", time)
}

fn default_templates(prayer: Prayer, offset: i32) -> (&'static str, &'static str) {
    match (prayer.is_sunrise(), offset.signum()) {
        (true, -1) => ("Sunrise — in {minutes} minutes", SUNRISE_BODY_BEFORE),
        (true, 0) => ("Sunrise", SUNRISE_BODY_AT),
        (true, _) => ("Sunrise — {minutes} minutes ago", "Sunrise was {minutes} minutes ago ({time})."),
        (false, -1) => (DEFAULT_TITLE_BEFORE, DEFAULT_BODY_BEFORE),
        (false, 0) => (DEFAULT_TITLE_AT, DEFAULT_BODY_AT),
        (false, _) => (DEFAULT_TITLE_AFTER, DEFAULT_BODY_AFTER),
    }
}

/// Build the list of notifications to deliver within `[from, until]`.
///
/// * Disabled master switch / prayer / reminder → nothing.
/// * Two reminders of the same prayer on the same day with the same offset are
///   collapsed into one (prevents duplicates after edits).
/// * Sorted by fire time and capped at `limit` (soonest first).
pub fn plan(
    schedules: &[DailyPrayerSchedule],
    settings: &PrayerNotificationSettings,
    tz: Tz,
    use_24h: bool,
    from: DateTime<Utc>,
    until: DateTime<Utc>,
    limit: usize,
) -> Vec<PlannedReminder> {
    if !settings.master_enabled {
        return vec![];
    }
    let mut out = Vec::new();
    let mut seen: HashSet<(chrono::NaiveDate, Prayer, i32)> = HashSet::new();

    for schedule in schedules {
        for entry in &schedule.entries {
            let Some(cfg) = settings.config(entry.prayer) else { continue };
            if !cfg.enabled {
                continue;
            }
            let has_jamaat = settings.jamaat_alerts && entry.jamaat.is_some();
            // With a jamaat time, "before the start" alerts give way to the jamaat alerts below.
            let mut reminders: Vec<&PrayerReminder> = cfg.reminders.iter().filter(|r| r.enabled && !(has_jamaat && r.offset_minutes < 0)).collect();
            reminders.sort_by_key(|r| r.offset_minutes);
            for r in reminders {
                if !seen.insert((schedule.date, entry.prayer, r.offset_minutes)) {
                    continue;
                }
                let fire_at = entry.time + Duration::minutes(r.offset_minutes as i64);
                if fire_at < from || fire_at > until {
                    continue;
                }
                let (dt, db) = default_templates(entry.prayer, r.offset_minutes);
                let time_str = format_time(entry.time, tz, use_24h);
                let title = render_template(r.title.as_deref().unwrap_or(dt), entry.prayer, r.offset_minutes, &time_str);
                let body = render_template(r.message.as_deref().unwrap_or(db), entry.prayer, r.offset_minutes, &time_str);
                out.push(PlannedReminder {
                    id: notification_id(schedule.date, entry.prayer, &r.id),
                    reminder_id: r.id.clone(),
                    prayer: entry.prayer,
                    date: schedule.date,
                    prayer_time: entry.time,
                    fire_at,
                    offset_minutes: r.offset_minutes,
                    title,
                    body,
                    sound: r
                        .sound
                        .clone()
                        .unwrap_or_else(|| settings.default_sound.clone()),
                });
            }
            if let (true, Some(jamaat)) = (has_jamaat, entry.jamaat) {
                let jt = format_time(jamaat, tz, use_24h);
                let sound = cfg.reminders.iter().find(|r| r.offset_minutes == 0).and_then(|r| r.sound.clone()).unwrap_or_else(|| settings.default_sound.clone());
                let mut push = |id: &str, fire_at: DateTime<Utc>, title: String, body: String, offset: i32| {
                    if fire_at < from || fire_at > until || fire_at < entry.time {
                        return;
                    }
                    out.push(PlannedReminder {
                        id: notification_id(schedule.date, entry.prayer, id),
                        reminder_id: id.into(),
                        prayer: entry.prayer,
                        date: schedule.date,
                        prayer_time: jamaat,
                        fire_at,
                        offset_minutes: offset,
                        title,
                        body,
                        sound: sound.clone(),
                    });
                };
                let n = settings.jamaat_before_minutes as i64;
                if n > 0 {
                    push(
                        "jamaat-before",
                        jamaat - Duration::minutes(n),
                        format!("{} jamaat in {n} min 🕌", entry.prayer.name()),
                        format!("Jamaat at {jt} in your mosque — time to make wudu and go. জামাত {jt}-এ।"),
                        -(n as i32),
                    );
                }
                push(
                    "jamaat",
                    jamaat,
                    format!("{} jamaat now 🕌", entry.prayer.name()),
                    format!("Jamaat is starting in your mosque ({jt}). জামাত শুরু হচ্ছে।"),
                    0,
                );
            }
        }
    }
    out.sort_by(|a, b| a.fire_at.cmp(&b.fire_at).then_with(|| a.id.cmp(&b.id)));
    out.truncate(limit);
    out
}

/// Decide which planned reminders should be shown now.
///
/// A reminder fires when its time has passed, it has not been delivered yet, and
/// it is not older than `grace` (so a Mac waking from sleep shows recent
/// reminders but not a pile of stale ones).
pub fn due<'a>(
    planned: &'a [PlannedReminder],
    now: DateTime<Utc>,
    grace: Duration,
    delivered: &HashSet<String>,
) -> Vec<&'a PlannedReminder> {
    planned
        .iter()
        .filter(|p| p.fire_at <= now && now - p.fire_at <= grace && !delivered.contains(&p.id))
        .collect()
}

/// When the scheduler should next wake up: the next future fire time, capped.
pub fn next_wake(planned: &[PlannedReminder], now: DateTime<Utc>, max: Duration) -> Duration {
    planned
        .iter()
        .map(|p| p.fire_at - now)
        .filter(|d| *d > Duration::zero())
        .min()
        .map(|d| d.min(max))
        .unwrap_or(max)
        .max(Duration::milliseconds(250))
}
