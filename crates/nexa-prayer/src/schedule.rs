//! Turns calculation settings + a location into concrete daily schedules.

use crate::astro::{self, AstroInput, AstroTime};
use crate::error::{PrayerError, Result};
use crate::models::*;
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

pub fn parse_tz(name: &str) -> Result<Tz> {
    name.parse::<Tz>()
        .map_err(|_| PrayerError::InvalidInput(format!("unknown time zone '{name}'")))
}

/// The calendar date "now" at the location.
pub fn local_date(now: DateTime<Utc>, tz: Tz) -> NaiveDate {
    now.with_timezone(&tz).date_naive()
}

fn round_to_minute(t: DateTime<Utc>) -> DateTime<Utc> {
    let t = t + Duration::seconds(30);
    t.with_second(0).and_then(|t| t.with_nanosecond(0)).unwrap_or(t)
}

fn hours_to_utc(date: NaiveDate, hours: f64) -> DateTime<Utc> {
    let midnight = Utc.from_utc_datetime(&date.and_time(NaiveTime::MIN));
    round_to_minute(midnight + Duration::milliseconds((hours * 3_600_000.0).round() as i64))
}

/// Resolve a local wall-clock time on `date` in `tz`. Times inside a DST gap
/// move forward to the first valid instant; ambiguous times use the earlier one.
pub fn local_to_utc(date: NaiveDate, hour: u32, minute: u32, tz: Tz) -> Option<DateTime<Utc>> {
    let naive = date.and_hms_opt(hour, minute, 0)?;
    if let Some(t) = tz.from_local_datetime(&naive).earliest() {
        return Some(t.with_timezone(&Utc));
    }
    // DST gap: step forward in 15-minute increments (max 3 h).
    (1..=12).find_map(|i| {
        tz.from_local_datetime(&(naive + Duration::minutes(15 * i)))
            .earliest()
            .map(|t| t.with_timezone(&Utc))
    })
}

pub fn build_schedule(
    date: NaiveDate,
    location: &PrayerLocation,
    calc: &PrayerCalculationSettings,
    manual: &ManualTimetable,
) -> Result<DailyPrayerSchedule> {
    let tz = parse_tz(&location.timezone)?;
    if !(location.latitude.is_finite()
        && location.longitude.is_finite()
        && (-90.0..=90.0).contains(&location.latitude)
        && (-180.0..=180.0).contains(&location.longitude))
    {
        return Err(PrayerError::InvalidInput("latitude/longitude out of range".into()));
    }

    let raw = astro::compute(&AstroInput {
        date,
        latitude: location.latitude,
        longitude: location.longitude,
        elevation: location.elevation,
        params: calc.method.params(calc),
        asr_factor: calc.asr.shadow_factor(),
        high_latitude: calc.high_latitude,
    });

    let raw_for = |p: Prayer| -> Option<AstroTime> {
        match p {
            Prayer::Fajr => raw.fajr,
            Prayer::Sunrise => raw.sunrise,
            Prayer::Dhuhr => raw.dhuhr,
            Prayer::Asr => raw.asr,
            Prayer::Maghrib => raw.maghrib,
            Prayer::Isha => raw.isha,
        }
    };

    let mut entries = Vec::with_capacity(6);
    for p in Prayer::ALL {
        let calculated = raw_for(p).map(|t| (hours_to_utc(date, t.hours), t.high_latitude_adjusted));

        let manual_time = (calc.mode == TimetableMode::Manual)
            .then(|| manual.get(p).and_then(parse_hhmm))
            .flatten()
            .and_then(|(h, m)| local_to_utc(date, h, m, tz));

        // A time set by hand is the mosque's jamaat; the prayer still starts at the calculated time.
        let entry = match (manual_time, calculated) {
            (jamaat, Some((calc_time, hl))) => {
                let offset = calc.offsets.get(p);
                PrayerTimeEntry {
                    prayer: p,
                    time: calc_time + Duration::minutes(offset as i64),
                    calculated_time: Some(calc_time),
                    offset_minutes: offset,
                    source: TimeSource::Calculated,
                    high_latitude_adjusted: hl,
                    jamaat,
                }
            }
            // No calculated time (extreme latitude): the hand-set time is all we have.
            (Some(time), None) => PrayerTimeEntry {
                prayer: p,
                time,
                calculated_time: None,
                offset_minutes: 0,
                source: TimeSource::Manual,
                high_latitude_adjusted: false,
                jamaat: Some(time),
            },
            // Sun never reaches the angle and no high-latitude rule: skip.
            (None, None) => continue,
        };
        entries.push(entry);
    }

    Ok(DailyPrayerSchedule {
        date,
        location_id: location.id.clone(),
        location_name: location.label(),
        timezone: location.timezone.clone(),
        method: calc.method,
        asr: calc.asr,
        entries,
    })
}

/// First prayer strictly after `now` across the given schedules (Sunrise excluded
/// unless `include_sunrise`).
pub fn next_prayer(
    schedules: &[DailyPrayerSchedule],
    now: DateTime<Utc>,
    include_sunrise: bool,
) -> Option<NextPrayer> {
    schedules
        .iter()
        .flat_map(|s| s.entries.iter().map(move |e| (s.date, e)))
        .filter(|(_, e)| include_sunrise || !e.prayer.is_sunrise())
        .filter(|(_, e)| e.time > now)
        .min_by_key(|(_, e)| e.time)
        .map(|(date, e)| NextPrayer {
            prayer: e.prayer,
            time: e.time,
            date,
            seconds_remaining: (e.time - now).num_seconds(),
        })
}

/// Format a time at the location (used in notification text).
pub fn format_time(t: DateTime<Utc>, tz: Tz, use_24h: bool) -> String {
    let local = t.with_timezone(&tz);
    if use_24h {
        local.format("%H:%M").to_string()
    } else {
        local.format("%-I:%M %p").to_string()
    }
}
