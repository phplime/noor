//! Astronomical prayer-time calculation.
//!
//! Based on the PrayTimes.org algorithm (H. Zarrabi-Zadeh, LGPL; formulas from
//! the U.S. Naval Observatory approximate solar coordinates and Meeus'
//! Astronomical Algorithms). Verified to the minute against the reference
//! implementation for many locations, methods, DST dates and high latitudes
//! (see `tests/acceptance.rs`).
//!
//! Differences from the reference implementation:
//! * Results are produced in **UTC hours from 00:00 UTC of the local date**, so
//!   no fixed time-zone offset is involved; converting to a wall-clock time is
//!   done later with the IANA zone, which makes DST transitions correct.
//! * The reference Python port's sign bug for "Isha = N minutes" is not carried over.

use crate::models::{HighLatitudeRule, IshaRule, MethodParams};
use chrono::{Datelike, NaiveDate};

#[derive(Debug, Clone, Copy)]
pub struct AstroInput {
    pub date: NaiveDate,
    pub latitude: f64,
    pub longitude: f64,
    pub elevation: f64,
    pub params: MethodParams,
    /// 1 = standard, 2 = Hanafi.
    pub asr_factor: f64,
    pub high_latitude: HighLatitudeRule,
}

/// A computed time in hours (UTC, relative to 00:00 UTC of the local date)
/// and whether the high-latitude rule produced it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AstroTime {
    pub hours: f64,
    pub high_latitude_adjusted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AstroTimes {
    pub fajr: Option<AstroTime>,
    pub sunrise: Option<AstroTime>,
    pub dhuhr: Option<AstroTime>,
    pub asr: Option<AstroTime>,
    pub sunset: Option<AstroTime>,
    pub maghrib: Option<AstroTime>,
    pub isha: Option<AstroTime>,
}

// ----- degree math ---------------------------------------------------------

fn dsin(d: f64) -> f64 {
    d.to_radians().sin()
}
fn dcos(d: f64) -> f64 {
    d.to_radians().cos()
}
fn dtan(d: f64) -> f64 {
    d.to_radians().tan()
}
fn darcsin(x: f64) -> f64 {
    x.asin().to_degrees()
}
fn darctan2(y: f64, x: f64) -> f64 {
    y.atan2(x).to_degrees()
}
fn darccot(x: f64) -> f64 {
    (1.0 / x).atan().to_degrees()
}
fn fix_angle(a: f64) -> f64 {
    a - 360.0 * (a / 360.0).floor()
}
fn fix_hour(h: f64) -> f64 {
    h - 24.0 * (h / 24.0).floor()
}

/// Julian day at 00:00 UT (Meeus).
pub fn julian_day(year: i32, month: u32, day: u32) -> f64 {
    let (mut y, mut m) = (year as f64, month as f64);
    if m <= 2.0 {
        y -= 1.0;
        m += 12.0;
    }
    let a = (y / 100.0).floor();
    let b = 2.0 - a + (a / 4.0).floor();
    (365.25 * (y + 4716.0)).floor() + (30.6001 * (m + 1.0)).floor() + day as f64 + b - 1524.5
}

/// Sun declination (degrees) and equation of time (hours).
fn sun_position(jd: f64) -> (f64, f64) {
    let d = jd - 2451545.0;
    let g = fix_angle(357.529 + 0.98560028 * d);
    let q = fix_angle(280.459 + 0.98564736 * d);
    let l = fix_angle(q + 1.915 * dsin(g) + 0.020 * dsin(2.0 * g));
    let e = 23.439 - 0.00000036 * d;
    let ra = darctan2(dcos(e) * dsin(l), dcos(l)) / 15.0;
    let eqt = q / 15.0 - fix_hour(ra);
    let decl = darcsin(dsin(e) * dsin(l));
    (decl, eqt)
}

struct Ctx {
    jd: f64,
    lat: f64,
}

impl Ctx {
    fn mid_day(&self, t: f64) -> f64 {
        let (_, eqt) = sun_position(self.jd + t / 24.0);
        fix_hour(12.0 - eqt)
    }

    /// Time at which the sun is `angle` degrees below the horizon.
    /// `ccw` = before noon. `None` when the sun never reaches that angle.
    fn sun_angle_time(&self, angle: f64, t: f64, ccw: bool) -> Option<f64> {
        let (decl, _) = sun_position(self.jd + t / 24.0);
        let noon = self.mid_day(t);
        let c = (-dsin(angle) - dsin(decl) * dsin(self.lat)) / (dcos(decl) * dcos(self.lat));
        if !c.is_finite() || !(-1.0..=1.0).contains(&c) {
            return None;
        }
        let x = c.acos().to_degrees() / 15.0;
        Some(if ccw { noon - x } else { noon + x })
    }

    fn asr_time(&self, factor: f64, t: f64) -> Option<f64> {
        let (decl, _) = sun_position(self.jd + t / 24.0);
        let angle = -darccot(factor + dtan((self.lat - decl).abs()));
        self.sun_angle_time(angle, t, false)
    }
}

pub fn compute(input: &AstroInput) -> AstroTimes {
    let lat = input.latitude.clamp(-89.9, 89.9);
    let lng = input.longitude;
    let jd = julian_day(input.date.year(), input.date.month(), input.date.day()) - lng / (15.0 * 24.0);
    let ctx = Ctx { jd, lat };
    let p = input.params;

    let rise_set = 0.833 + 0.0347 * input.elevation.max(0.0).sqrt();

    // One iteration from the standard initial guesses (as in the reference).
    let fajr = ctx.sun_angle_time(p.fajr_angle, 5.0, true);
    let sunrise = ctx.sun_angle_time(rise_set, 6.0, true);
    let dhuhr = Some(ctx.mid_day(12.0));
    let asr = ctx.asr_time(input.asr_factor, 13.0);
    let sunset = ctx.sun_angle_time(rise_set, 18.0, false);
    let maghrib_angle_time = p.maghrib_angle.map(|a| ctx.sun_angle_time(a, 18.0, false));
    let isha_angle_time = match p.isha {
        IshaRule::Angle(a) => Some(ctx.sun_angle_time(a, 18.0, false)),
        IshaRule::Minutes(_) => None,
    };

    // Local mean solar time → UTC.
    let to_utc = |h: Option<f64>| h.map(|v| v - lng / 15.0);
    let fajr = to_utc(fajr);
    let sunrise = to_utc(sunrise);
    let dhuhr = to_utc(dhuhr);
    let asr = to_utc(asr);
    let sunset = to_utc(sunset);
    let maghrib_angle_time = maghrib_angle_time.map(to_utc);
    let isha_angle_time = isha_angle_time.map(to_utc);

    let plain = |h: Option<f64>| {
        h.map(|hours| AstroTime {
            hours,
            high_latitude_adjusted: false,
        })
    };

    // High-latitude adjustment (needs sunrise and sunset).
    let adjust = |time: Option<f64>, base: Option<f64>, angle: f64, night: Option<f64>, ccw: bool| {
        let (Some(base), Some(night)) = (base, night) else {
            return plain(time);
        };
        if input.high_latitude == HighLatitudeRule::None {
            return plain(time);
        }
        let portion = night
            * match input.high_latitude {
                HighLatitudeRule::MiddleOfNight => 0.5,
                HighLatitudeRule::SeventhOfNight => 1.0 / 7.0,
                HighLatitudeRule::TwilightAngle => angle / 60.0,
                HighLatitudeRule::None => unreachable!(),
            };
        let too_far = match time {
            None => true,
            Some(t) => {
                let diff = if ccw { fix_hour(base - t) } else { fix_hour(t - base) };
                diff > portion
            }
        };
        if too_far {
            Some(AstroTime {
                hours: if ccw { base - portion } else { base + portion },
                high_latitude_adjusted: true,
            })
        } else {
            plain(time)
        }
    };

    let night = match (sunset, sunrise) {
        (Some(s), Some(r)) => Some(fix_hour(r - s)),
        _ => None,
    };

    let fajr = adjust(fajr, sunrise, p.fajr_angle, night, true);
    let maghrib = match (p.maghrib_angle, maghrib_angle_time) {
        (Some(angle), Some(t)) => adjust(t, sunset, angle, night, false),
        _ => plain(sunset),
    };
    let isha = match (p.isha, isha_angle_time) {
        (IshaRule::Minutes(m), _) => maghrib.map(|mg| AstroTime {
            hours: mg.hours + m / 60.0,
            high_latitude_adjusted: mg.high_latitude_adjusted,
        }),
        (IshaRule::Angle(angle), Some(t)) => adjust(t, sunset, angle, night, false),
        (IshaRule::Angle(_), None) => None,
    };

    AstroTimes {
        fajr,
        sunrise: plain(sunrise),
        dhuhr: plain(dhuhr),
        asr: plain(asr),
        sunset: plain(sunset),
        maghrib,
        isha,
    }
}
