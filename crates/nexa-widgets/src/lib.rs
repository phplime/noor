//! Nexa Island widgets — everything except prayer times.
//!
//! All data lives in the same SQLite file as the prayer module (separate
//! tables, separate connection, own schema version table).
//!
//! * [`todo`]      — to-do list
//! * [`clipboard`] — clipboard history (text)
//! * [`water`]     — water intake + reminder planning
//! * [`shelf`]     — files parked in the island
//! * [`apps`]      — quick-launch apps (scan + pins)
//! * [`clocks`]    — world clocks
//! * [`timer`]     — countdown timer and stopwatch state
//! * [`lyrics`]    — LRC parser and lyrics cache
//! * [`calendar`]  — Hijri / Bangla calendars, holidays and occasions (Noor)
//! * [`ramadan`]   — Ramadan range + Sehri/Iftar alert planning (Noor)
//! * [`specials`]  — the user's special days (Noor)
//! * [`profile`]   — name, photos, birthday for the Home screen (Noor)
//! * [`places`]    — quiet places (map pins + radius) (Noor)
//! * [`reminders`] — personal reminders with repeat rules (Noor)
//! * [`settings`]  — island/module settings

pub mod apps;
pub mod calendar;
pub mod clipboard;
pub mod cycle;
pub mod clocks;
pub mod db;
pub mod fitness;
pub mod lyrics;
pub mod places;
pub mod profile;
pub mod ramadan;
pub mod salah;
pub mod reminders;
pub mod specials;
pub mod sunnah;
pub mod settings;
pub mod shelf;
pub mod timer;
pub mod todo;
pub mod water;

pub use db::{WidgetDb, WidgetError, WidgetResult};

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
