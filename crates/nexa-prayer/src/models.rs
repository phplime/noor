//! Data models for the Prayer Times module. Everything is `serde` camelCase so it
//! crosses the Tauri IPC boundary unchanged and can be stored as JSON in SQLite.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Prayer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Prayer {
    Fajr,
    Sunrise,
    Dhuhr,
    Asr,
    Maghrib,
    Isha,
}

impl Prayer {
    pub const ALL: [Prayer; 6] = [
        Prayer::Fajr,
        Prayer::Sunrise,
        Prayer::Dhuhr,
        Prayer::Asr,
        Prayer::Maghrib,
        Prayer::Isha,
    ];

    /// The five obligatory prayers (Sunrise is informational).
    pub const PRAYERS: [Prayer; 5] = [
        Prayer::Fajr,
        Prayer::Dhuhr,
        Prayer::Asr,
        Prayer::Maghrib,
        Prayer::Isha,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Prayer::Fajr => "Fajr",
            Prayer::Sunrise => "Sunrise",
            Prayer::Dhuhr => "Dhuhr",
            Prayer::Asr => "Asr",
            Prayer::Maghrib => "Maghrib",
            Prayer::Isha => "Isha",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Prayer::Fajr => "fajr",
            Prayer::Sunrise => "sunrise",
            Prayer::Dhuhr => "dhuhr",
            Prayer::Asr => "asr",
            Prayer::Maghrib => "maghrib",
            Prayer::Isha => "isha",
        }
    }

    pub fn from_key(key: &str) -> Option<Prayer> {
        Prayer::ALL.into_iter().find(|p| p.key() == key)
    }

    pub fn is_sunrise(self) -> bool {
        self == Prayer::Sunrise
    }
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LocationSource {
    /// Picked from the offline city list.
    Search,
    /// Latitude / longitude typed by the user.
    #[default]
    Manual,
    /// The Mac's current location (only with the user's permission).
    Device,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerLocation {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
    /// IANA identifier, e.g. "Asia/Dhaka".
    pub timezone: String,
    /// Metres above sea level; refines sunrise/sunset slightly.
    #[serde(default)]
    pub elevation: f64,
    #[serde(default)]
    pub source: LocationSource,
}

impl PrayerLocation {
    pub fn label(&self) -> String {
        if self.country.is_empty() {
            self.name.clone()
        } else {
            format!("{}, {}", self.name, self.country)
        }
    }
}

// ---------------------------------------------------------------------------
// Calculation settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CalculationMethod {
    MuslimWorldLeague,
    Isna,
    Egypt,
    UmmAlQura,
    #[default]
    Karachi,
    Dubai,
    Kuwait,
    Qatar,
    Singapore,
    Turkey,
    Tehran,
    Custom,
}

/// How Isha is defined by a method.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum IshaRule {
    /// Sun depression angle in degrees.
    Angle(f64),
    /// Fixed minutes after Maghrib.
    Minutes(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodParams {
    pub fajr_angle: f64,
    pub isha: IshaRule,
    /// Maghrib as an angle below the horizon (Shia methods). `None` = sunset.
    pub maghrib_angle: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodInfo {
    pub id: CalculationMethod,
    pub name: &'static str,
    pub description: String,
    pub params: MethodParams,
}

impl CalculationMethod {
    pub const ALL: [CalculationMethod; 12] = [
        CalculationMethod::MuslimWorldLeague,
        CalculationMethod::Isna,
        CalculationMethod::Egypt,
        CalculationMethod::UmmAlQura,
        CalculationMethod::Karachi,
        CalculationMethod::Dubai,
        CalculationMethod::Kuwait,
        CalculationMethod::Qatar,
        CalculationMethod::Singapore,
        CalculationMethod::Turkey,
        CalculationMethod::Tehran,
        CalculationMethod::Custom,
    ];

    pub fn name(self) -> &'static str {
        match self {
            CalculationMethod::MuslimWorldLeague => "Muslim World League",
            CalculationMethod::Isna => "Islamic Society of North America (ISNA)",
            CalculationMethod::Egypt => "Egyptian General Authority of Survey",
            CalculationMethod::UmmAlQura => "Umm al-Qura University, Makkah",
            CalculationMethod::Karachi => "University of Islamic Sciences, Karachi",
            CalculationMethod::Dubai => "Dubai (UAE)",
            CalculationMethod::Kuwait => "Kuwait",
            CalculationMethod::Qatar => "Qatar",
            CalculationMethod::Singapore => "Singapore / Malaysia / Indonesia",
            CalculationMethod::Turkey => "Diyanet İşleri Başkanlığı, Turkey",
            CalculationMethod::Tehran => "Institute of Geophysics, University of Tehran",
            CalculationMethod::Custom => "Custom angles",
        }
    }

    /// Standard parameters. `Custom` returns the user's values from `settings`.
    pub fn params(self, settings: &PrayerCalculationSettings) -> MethodParams {
        let angle = |f: f64, i: f64| MethodParams {
            fajr_angle: f,
            isha: IshaRule::Angle(i),
            maghrib_angle: None,
        };
        match self {
            CalculationMethod::MuslimWorldLeague => angle(18.0, 17.0),
            CalculationMethod::Isna => angle(15.0, 15.0),
            CalculationMethod::Egypt => angle(19.5, 17.5),
            CalculationMethod::UmmAlQura => MethodParams {
                fajr_angle: 18.5,
                isha: IshaRule::Minutes(90.0),
                maghrib_angle: None,
            },
            CalculationMethod::Karachi => angle(18.0, 18.0),
            CalculationMethod::Dubai => angle(18.2, 18.2),
            CalculationMethod::Kuwait => angle(18.0, 17.5),
            CalculationMethod::Qatar => MethodParams {
                fajr_angle: 18.0,
                isha: IshaRule::Minutes(90.0),
                maghrib_angle: None,
            },
            CalculationMethod::Singapore => angle(20.0, 18.0),
            CalculationMethod::Turkey => angle(18.0, 17.0),
            CalculationMethod::Tehran => MethodParams {
                fajr_angle: 17.7,
                isha: IshaRule::Angle(14.0),
                maghrib_angle: Some(4.5),
            },
            CalculationMethod::Custom => MethodParams {
                fajr_angle: settings.custom_fajr_angle,
                isha: match settings.custom_isha_minutes {
                    Some(m) if m > 0.0 => IshaRule::Minutes(m),
                    _ => IshaRule::Angle(settings.custom_isha_angle),
                },
                maghrib_angle: None,
            },
        }
    }

    pub fn info(self, settings: &PrayerCalculationSettings) -> MethodInfo {
        let params = self.params(settings);
        let isha = match params.isha {
            IshaRule::Angle(a) => format!("Isha {a}°"),
            IshaRule::Minutes(m) => format!("Isha {m} min after Maghrib"),
        };
        let maghrib = params
            .maghrib_angle
            .map(|a| format!(", Maghrib {a}°"))
            .unwrap_or_default();
        MethodInfo {
            id: self,
            name: self.name(),
            description: format!("Fajr {}°, {isha}{maghrib}", params.fajr_angle),
            params,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AsrMethod {
    /// Shafi'i, Maliki, Hanbali — shadow length = object length.
    #[default]
    Standard,
    /// Shadow length = twice the object length.
    Hanafi,
}

impl AsrMethod {
    pub fn shadow_factor(self) -> f64 {
        match self {
            AsrMethod::Standard => 1.0,
            AsrMethod::Hanafi => 2.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HighLatitudeRule {
    /// Fajr/Isha never further than half the night from sunrise/sunset.
    #[default]
    MiddleOfNight,
    /// One seventh of the night.
    SeventhOfNight,
    /// angle/60 of the night (twilight angle based).
    TwilightAngle,
    /// No adjustment (times may be missing in summer at high latitudes).
    None,
}

/// Per-prayer minute offsets applied on top of calculated times.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrayerOffsets {
    pub fajr: i32,
    pub sunrise: i32,
    pub dhuhr: i32,
    pub asr: i32,
    pub maghrib: i32,
    pub isha: i32,
}

impl PrayerOffsets {
    pub fn set(&mut self, p: Prayer, v: i32) {
        match p {
            Prayer::Fajr => self.fajr = v,
            Prayer::Sunrise => self.sunrise = v,
            Prayer::Dhuhr => self.dhuhr = v,
            Prayer::Asr => self.asr = v,
            Prayer::Maghrib => self.maghrib = v,
            Prayer::Isha => self.isha = v,
        }
    }

    pub fn get(&self, p: Prayer) -> i32 {
        match p {
            Prayer::Fajr => self.fajr,
            Prayer::Sunrise => self.sunrise,
            Prayer::Dhuhr => self.dhuhr,
            Prayer::Asr => self.asr,
            Prayer::Maghrib => self.maghrib,
            Prayer::Isha => self.isha,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TimetableMode {
    #[default]
    Calculated,
    /// Use the user's manual timetable (missing entries fall back to calculated).
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrayerCalculationSettings {
    pub method: CalculationMethod,
    pub asr: AsrMethod,
    pub high_latitude: HighLatitudeRule,
    pub custom_fajr_angle: f64,
    pub custom_isha_angle: f64,
    /// When set (> 0) a custom method uses "minutes after Maghrib" for Isha.
    pub custom_isha_minutes: Option<f64>,
    pub offsets: PrayerOffsets,
    pub mode: TimetableMode,
}

impl Default for PrayerCalculationSettings {
    fn default() -> Self {
        Self {
            method: CalculationMethod::Karachi,
            asr: AsrMethod::Hanafi,
            high_latitude: HighLatitudeRule::MiddleOfNight,
            custom_fajr_angle: 18.0,
            custom_isha_angle: 17.0,
            custom_isha_minutes: None,
            offsets: PrayerOffsets::default(),
            mode: TimetableMode::Calculated,
        }
    }
}

impl PrayerCalculationSettings {
    /// Clamp user input to sane ranges.
    pub fn sanitized(mut self) -> Self {
        let clamp_angle = |a: f64| if a.is_finite() { a.clamp(5.0, 25.0) } else { 18.0 };
        self.custom_fajr_angle = clamp_angle(self.custom_fajr_angle);
        self.custom_isha_angle = clamp_angle(self.custom_isha_angle);
        self.custom_isha_minutes = self
            .custom_isha_minutes
            .filter(|m| m.is_finite() && *m > 0.0)
            .map(|m| m.clamp(1.0, 240.0));
        let o = &mut self.offsets;
        for v in [
            &mut o.fajr,
            &mut o.sunrise,
            &mut o.dhuhr,
            &mut o.asr,
            &mut o.maghrib,
            &mut o.isha,
        ] {
            *v = (*v).clamp(-120, 120);
        }
        self
    }
}

/// A fixed daily timetable typed by the user ("HH:MM", 24-hour, location time).
/// Stored separately from the calculated times and never mixed into them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManualTimetable {
    pub fajr: Option<String>,
    pub sunrise: Option<String>,
    pub dhuhr: Option<String>,
    pub asr: Option<String>,
    pub maghrib: Option<String>,
    pub isha: Option<String>,
}

impl ManualTimetable {
    pub fn set(&mut self, p: Prayer, v: Option<String>) {
        let slot = match p {
            Prayer::Fajr => &mut self.fajr,
            Prayer::Sunrise => &mut self.sunrise,
            Prayer::Dhuhr => &mut self.dhuhr,
            Prayer::Asr => &mut self.asr,
            Prayer::Maghrib => &mut self.maghrib,
            Prayer::Isha => &mut self.isha,
        };
        *slot = v;
    }

    pub fn get(&self, p: Prayer) -> Option<&str> {
        match p {
            Prayer::Fajr => self.fajr.as_deref(),
            Prayer::Sunrise => self.sunrise.as_deref(),
            Prayer::Dhuhr => self.dhuhr.as_deref(),
            Prayer::Asr => self.asr.as_deref(),
            Prayer::Maghrib => self.maghrib.as_deref(),
            Prayer::Isha => self.isha.as_deref(),
        }
        .filter(|s| !s.trim().is_empty())
    }
}

/// Parse "HH:MM" (24h). Also accepts "H:MM".
pub fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let (h, m) = s.trim().split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    (h < 24 && m < 60).then_some((h, m))
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeSource {
    Calculated,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerTimeEntry {
    pub prayer: Prayer,
    /// The effective time (after offsets, or the manual time).
    pub time: DateTime<Utc>,
    /// The raw astronomical time before offsets; kept separately so manual
    /// adjustments never overwrite calculations.
    pub calculated_time: Option<DateTime<Utc>>,
    pub offset_minutes: i32,
    pub source: TimeSource,
    /// The high-latitude rule changed this time.
    pub high_latitude_adjusted: bool,
    /// The mosque's jamaat (congregation) time, if set; `time` stays the prayer's start.
    #[serde(default)]
    pub jamaat: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPrayerSchedule {
    pub date: NaiveDate,
    pub location_id: String,
    pub location_name: String,
    pub timezone: String,
    pub method: CalculationMethod,
    pub asr: AsrMethod,
    pub entries: Vec<PrayerTimeEntry>,
}

impl DailyPrayerSchedule {
    pub fn entry(&self, p: Prayer) -> Option<&PrayerTimeEntry> {
        self.entries.iter().find(|e| e.prayer == p)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextPrayer {
    pub prayer: Prayer,
    pub time: DateTime<Utc>,
    pub date: NaiveDate,
    pub seconds_remaining: i64,
}

// ---------------------------------------------------------------------------
// Reminders & notifications
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerReminder {
    /// Stable identifier (UUID); used to build notification ids.
    pub id: String,
    pub prayer: Prayer,
    /// Negative = before the prayer, 0 = at prayer time, positive = after.
    pub offset_minutes: i32,
    pub enabled: bool,
    /// Custom title template; `None` = default. Placeholders: {prayer} {minutes} {time}.
    #[serde(default)]
    pub title: Option<String>,
    /// Custom message template; `None` = default.
    #[serde(default)]
    pub message: Option<String>,
    /// Sound name ("default", "none" or a macOS system sound like "Glass"); `None` = use default.
    #[serde(default)]
    pub sound: Option<String>,
}

impl PrayerReminder {
    pub fn new(prayer: Prayer, offset_minutes: i32) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            prayer,
            offset_minutes,
            enabled: true,
            title: None,
            message: None,
            sound: None,
        }
    }

    pub fn describe_offset(&self) -> String {
        describe_offset(self.offset_minutes)
    }
}

pub fn describe_offset(offset: i32) -> String {
    match offset {
        0 => "At prayer time".to_string(),
        o if o < 0 => format!("{} min before", -o),
        o => format!("{o} min after"),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerNotificationConfig {
    pub prayer: Prayer,
    pub enabled: bool,
    pub reminders: Vec<PrayerReminder>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrayerNotificationSettings {
    pub master_enabled: bool,
    /// "default", "none" or a macOS system sound name.
    pub default_sound: String,
    /// Reminders missed while the Mac slept are still shown if no older than this.
    pub grace_minutes: u32,
    pub prayers: Vec<PrayerNotificationConfig>,
    /// For prayers with a jamaat time: alert this many minutes before jamaat (0 = off) and at jamaat.
    pub jamaat_alerts: bool,
    pub jamaat_before_minutes: u32,
}

impl Default for PrayerNotificationSettings {
    fn default() -> Self {
        let cfg = |prayer: Prayer, enabled: bool, offsets: &[i32]| PrayerNotificationConfig {
            prayer,
            enabled,
            reminders: offsets
                .iter()
                .map(|o| PrayerReminder::new(prayer, *o))
                .collect(),
        };
        Self {
            master_enabled: true,
            default_sound: "default".into(),
            grace_minutes: 10,
            jamaat_alerts: true,
            jamaat_before_minutes: 10,
            prayers: vec![
                cfg(Prayer::Fajr, true, &[-15, 0]),
                cfg(Prayer::Sunrise, false, &[-15]),
                cfg(Prayer::Dhuhr, true, &[-10, 0]),
                cfg(Prayer::Asr, true, &[-10, 0]),
                cfg(Prayer::Maghrib, true, &[-5, 0]),
                cfg(Prayer::Isha, true, &[-10, 0]),
            ],
        }
    }
}

impl PrayerNotificationSettings {
    pub fn config(&self, p: Prayer) -> Option<&PrayerNotificationConfig> {
        self.prayers.iter().find(|c| c.prayer == p)
    }

    /// Make sure every prayer has exactly one config, reminders are valid and ids unique.
    pub fn sanitized(mut self) -> Self {
        self.grace_minutes = self.grace_minutes.min(120);
        self.jamaat_before_minutes = self.jamaat_before_minutes.min(120);
        if self.default_sound.trim().is_empty() {
            self.default_sound = "default".into();
        }
        let mut out = Vec::with_capacity(6);
        let mut seen_ids = std::collections::HashSet::new();
        for p in Prayer::ALL {
            let mut cfg = self
                .prayers
                .iter()
                .find(|c| c.prayer == p)
                .cloned()
                .unwrap_or(PrayerNotificationConfig {
                    prayer: p,
                    enabled: false,
                    reminders: vec![],
                });
            cfg.reminders.retain(|r| r.prayer == p);
            for r in &mut cfg.reminders {
                r.offset_minutes = r.offset_minutes.clamp(-180, 180);
                if r.id.trim().is_empty() || !seen_ids.insert(r.id.clone()) {
                    r.id = uuid::Uuid::new_v4().to_string();
                    seen_ids.insert(r.id.clone());
                }
                for s in [&mut r.title, &mut r.message, &mut r.sound] {
                    if s.as_deref().map(str::trim).is_some_and(str::is_empty) {
                        *s = None;
                    }
                }
            }
            cfg.reminders.sort_by_key(|r| r.offset_minutes);
            out.push(cfg);
        }
        self.prayers = out;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CardStyle {
    #[default]
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrayerDisplaySettings {
    pub show_next_in_compact: bool,
    pub show_countdown: bool,
    pub highlight_upcoming: bool,
    pub show_sunrise: bool,
    /// Show a prominent countdown in the compact island this many minutes
    /// before a prayer (0 = off). Never forces the island open.
    pub pre_prayer_countdown_minutes: u32,
    pub use_24_hour: bool,
    pub card_style: CardStyle,
    /// CSS colour for the highlight.
    pub accent: String,
    /// Expand the island when a notification is clicked.
    pub expand_on_notification_click: bool,
}

impl Default for PrayerDisplaySettings {
    fn default() -> Self {
        Self {
            show_next_in_compact: true,
            show_countdown: true,
            highlight_upcoming: true,
            show_sunrise: true,
            pre_prayer_countdown_minutes: 10,
            use_24_hour: false,
            card_style: CardStyle::Comfortable,
            accent: "#34d399".into(),
            expand_on_notification_click: true,
        }
    }
}

impl PrayerDisplaySettings {
    pub fn sanitized(mut self) -> Self {
        self.pre_prayer_countdown_minutes = self.pre_prayer_countdown_minutes.min(120);
        let a = self.accent.trim();
        let valid = a.len() == 7 && a.starts_with('#') && a[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !valid {
            self.accent = PrayerDisplaySettings::default().accent;
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LocationMode {
    /// Use the selected saved location.
    #[default]
    Saved,
    /// Use the Mac's location when available; falls back to the saved one.
    Automatic,
}

/// One planned notification (a reminder resolved against a concrete day).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedReminder {
    /// Stable id: `prayer:<date>:<prayer>:<reminder-id>`.
    pub id: String,
    pub reminder_id: String,
    pub prayer: Prayer,
    pub date: NaiveDate,
    pub prayer_time: DateTime<Utc>,
    pub fire_at: DateTime<Utc>,
    pub offset_minutes: i32,
    pub title: String,
    pub body: String,
    pub sound: String,
}
