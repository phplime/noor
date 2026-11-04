use crate::db::{WidgetDb, WidgetError, WidgetResult};
use chrono::{DateTime, Offset, Utc};
use chrono_tz::Tz;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldClock {
    pub id: String,
    pub label: String,
    pub timezone: String,
    pub position: i64,
}

/// A clock resolved at a moment, for display.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockNow {
    pub clock: WorldClock,
    /// Offset from UTC in minutes at that moment.
    pub utc_offset_min: i32,
    /// Difference to the Mac's local zone in minutes.
    pub diff_min: i32,
}

pub const MAX_CLOCKS: usize = 8;

pub fn resolve(clocks: &[WorldClock], now: DateTime<Utc>, local: Tz) -> Vec<ClockNow> {
    let local_off = now.with_timezone(&local).offset().fix().local_minus_utc() / 60;
    clocks
        .iter()
        .filter_map(|c| {
            let tz: Tz = c.timezone.parse().ok()?;
            let off = now.with_timezone(&tz).offset().fix().local_minus_utc() / 60;
            Some(ClockNow { clock: c.clone(), utc_offset_min: off, diff_min: off - local_off })
        })
        .collect()
}

impl WidgetDb {
    pub fn clocks(&self) -> WidgetResult<Vec<WorldClock>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, label, timezone, position FROM clocks ORDER BY position")?;
        let rows = stmt.query_map([], |r| {
            Ok(WorldClock { id: r.get(0)?, label: r.get(1)?, timezone: r.get(2)?, position: r.get(3)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn clock_add(&self, label: &str, timezone: &str) -> WidgetResult<WorldClock> {
        timezone
            .parse::<Tz>()
            .map_err(|_| WidgetError::Invalid(format!("Unknown time zone '{timezone}'")))?;
        if self.clocks()?.len() >= MAX_CLOCKS {
            return Err(WidgetError::Invalid(format!("Up to {MAX_CLOCKS} clocks")));
        }
        let label = match label.trim() {
            "" => timezone.rsplit('/').next().unwrap_or(timezone).replace('_', " "),
            l => l.chars().take(40).collect(),
        };
        let pos: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM clocks", [], |r| r.get(0))?;
        let c = WorldClock { id: uuid::Uuid::new_v4().to_string(), label, timezone: timezone.into(), position: pos };
        self.conn.execute(
            "INSERT INTO clocks (id, label, timezone, position) VALUES (?1, ?2, ?3, ?4)",
            params![c.id, c.label, c.timezone, c.position],
        )?;
        Ok(c)
    }

    pub fn clock_delete(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM clocks WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn seed_clocks(&self) -> WidgetResult<()> {
        if self.get_json::<bool>("clocks.seeded")?.is_some() {
            return Ok(());
        }
        for (l, tz) in [("London", "Europe/London"), ("New York", "America/New_York"), ("Makkah", "Asia/Riyadh"), ("Tokyo", "Asia/Tokyo")] {
            let _ = self.clock_add(l, tz);
        }
        self.set_json("clocks.seeded", &true)
    }
}
