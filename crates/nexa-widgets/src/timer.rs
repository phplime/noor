//! Countdown timer and stopwatch. State is persisted, so a running timer
//! survives closing the island and even restarting the app.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerState {
    pub label: String,
    /// Total length of the current run in ms.
    pub duration_ms: i64,
    /// Running: when it ends (epoch ms).
    pub ends_at: Option<i64>,
    /// Paused: what was left.
    pub paused_remaining: Option<i64>,
    /// The "done" notification was sent for this run.
    pub notified: bool,
}

pub const MAX_TIMER_MS: i64 = 24 * 3600 * 1000;

impl TimerState {
    pub fn start(duration_ms: i64, label: &str, now: i64) -> Self {
        let d = duration_ms.clamp(1000, MAX_TIMER_MS);
        Self {
            label: label.trim().chars().take(40).collect(),
            duration_ms: d,
            ends_at: Some(now + d),
            paused_remaining: None,
            notified: false,
        }
    }

    pub fn is_running(&self) -> bool {
        self.ends_at.is_some()
    }

    pub fn is_paused(&self) -> bool {
        self.paused_remaining.is_some()
    }

    pub fn is_idle(&self) -> bool {
        !self.is_running() && !self.is_paused()
    }

    pub fn remaining(&self, now: i64) -> i64 {
        match (self.ends_at, self.paused_remaining) {
            (Some(end), _) => (end - now).max(0),
            (None, Some(r)) => r,
            _ => 0,
        }
    }

    pub fn pause(&mut self, now: i64) {
        if let Some(end) = self.ends_at.take() {
            self.paused_remaining = Some((end - now).max(0));
        }
    }

    pub fn resume(&mut self, now: i64) {
        if let Some(r) = self.paused_remaining.take() {
            self.ends_at = Some(now + r);
        }
    }

    /// Add (or remove, if negative) time to a running or paused timer.
    pub fn add(&mut self, ms: i64, now: i64) {
        if let Some(end) = self.ends_at.as_mut() {
            *end = (*end + ms).max(now);
            self.duration_ms = (self.duration_ms + ms).max(1000);
            self.notified = false;
        } else if let Some(r) = self.paused_remaining.as_mut() {
            *r = (*r + ms).max(0);
            self.duration_ms = (self.duration_ms + ms).max(1000);
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Finished and not yet announced.
    pub fn is_due(&self, now: i64) -> bool {
        matches!(self.ends_at, Some(end) if end <= now) && !self.notified
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StopwatchState {
    pub started_at: Option<i64>,
    pub accumulated_ms: i64,
    /// Lap split times (elapsed ms at each lap).
    pub laps: Vec<i64>,
}

impl StopwatchState {
    pub fn elapsed(&self, now: i64) -> i64 {
        self.accumulated_ms + self.started_at.map(|s| (now - s).max(0)).unwrap_or(0)
    }
    pub fn start(&mut self, now: i64) {
        if self.started_at.is_none() {
            self.started_at = Some(now);
        }
    }
    pub fn stop(&mut self, now: i64) {
        if let Some(s) = self.started_at.take() {
            self.accumulated_ms += (now - s).max(0);
        }
    }
    pub fn lap(&mut self, now: i64) {
        if self.started_at.is_some() && self.laps.len() < 99 {
            self.laps.push(self.elapsed(now));
        }
    }
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}
