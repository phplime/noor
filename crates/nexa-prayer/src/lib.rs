//! Nexa Island — Prayer Times engine.
//!
//! * [`astro`]     — astronomical calculation (PrayTimes.org algorithm, UTC based, DST-safe)
//! * [`schedule`]  — daily schedules with per-prayer offsets and manual timetables
//! * [`reminders`] — multiple reminders per prayer → concrete notifications, de-duplicated
//! * [`store`]     — SQLite persistence (settings, locations, reminders, delivered log)
//! * [`service`]   — the API used by the Tauri app (with an in-memory schedule cache)
//! * [`cities`]    — offline city search / nearest city

pub mod astro;
pub mod cities;
pub mod error;
pub mod models;
pub mod reminders;
pub mod schedule;
pub mod service;
pub mod store;

pub use error::{PrayerError, Result};
pub use models::*;
pub use service::{LocationAdjustments, PrayerAdjust, PrayerService, PrayerSettings, PrayerSnapshot, DEVICE_LOCATION_ID};
pub use store::Store;
