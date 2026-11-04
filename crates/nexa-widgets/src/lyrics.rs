//! Synced lyrics: LRC parsing and a SQLite cache for LRCLIB results.

use crate::db::{WidgetDb, WidgetResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub time_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// Time-stamped lines (empty when only plain lyrics exist).
    pub synced: Vec<LyricLine>,
    pub plain: Option<String>,
    pub instrumental: bool,
    pub found: bool,
}

impl Lyrics {
    pub fn not_found() -> Self {
        Self { synced: vec![], plain: None, instrumental: false, found: false }
    }
}

/// Parse LRC text: `[mm:ss.xx] line`, several stamps per line allowed,
/// metadata tags (`[ar:…]`) ignored. Result is sorted by time.
pub fn parse_lrc(lrc: &str) -> Vec<LyricLine> {
    let mut out = Vec::new();
    for raw in lrc.lines() {
        let mut rest = raw.trim();
        let mut stamps = Vec::new();
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(close) = stripped.find(']') else { break };
            let tag = &stripped[..close];
            // Metadata tags ([ar:…], [offset:…]) are not timestamps and are skipped.
            if let Some(ms) = parse_stamp(tag) {
                stamps.push(ms);
            }
            rest = stripped[close + 1..].trim_start();
        }
        for ms in stamps {
            out.push(LyricLine { time_ms: ms, text: rest.trim().to_string() });
        }
    }
    out.sort_by_key(|l| l.time_ms);
    out
}

fn parse_stamp(tag: &str) -> Option<i64> {
    let (m, s) = tag.split_once(':')?;
    let m: i64 = m.trim().parse().ok()?;
    let (sec, frac) = match s.split_once(['.', ':']) {
        Some((a, b)) => (a, b),
        None => (s, "0"),
    };
    let sec: i64 = sec.trim().parse().ok()?;
    if sec >= 60 {
        return None;
    }
    let frac = frac.trim();
    let frac_ms = match frac.len() {
        0 => 0,
        1 => frac.parse::<i64>().ok()? * 100,
        2 => frac.parse::<i64>().ok()? * 10,
        _ => frac[..3].parse::<i64>().ok()?,
    };
    Some(m * 60_000 + sec * 1000 + frac_ms)
}

/// Index of the line being sung at `position_ms` (None before the first line).
pub fn current_line(lines: &[LyricLine], position_ms: i64) -> Option<usize> {
    match lines.partition_point(|l| l.time_ms <= position_ms) {
        0 => None,
        n => Some(n - 1),
    }
}

/// Cache key for a track.
pub fn lyrics_key(artist: &str, title: &str) -> String {
    format!("{}\u{1f}{}", artist.trim().to_lowercase(), title.trim().to_lowercase())
}

type LyricsRow = (Option<String>, Option<String>, bool, bool, i64);

const NOT_FOUND_RETRY_MS: i64 = 3 * 24 * 3600 * 1000;

impl WidgetDb {
    /// Cached lyrics. A cached "not found" expires after 3 days.
    pub fn lyrics_cached(&self, key: &str) -> WidgetResult<Option<Lyrics>> {
        let row: Option<LyricsRow> = self
            .conn
            .query_row(
                "SELECT synced, plain, instrumental, found, fetched_at FROM lyrics WHERE key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        Ok(row.and_then(|(synced, plain, instrumental, found, at)| {
            if !found && crate::now_ms() - at > NOT_FOUND_RETRY_MS {
                return None;
            }
            Some(Lyrics {
                synced: synced.as_deref().map(parse_lrc).unwrap_or_default(),
                plain,
                instrumental,
                found,
            })
        }))
    }

    pub fn lyrics_store(&self, key: &str, synced_lrc: Option<&str>, plain: Option<&str>, instrumental: bool, found: bool) -> WidgetResult<()> {
        self.conn.execute(
            "INSERT INTO lyrics (key, synced, plain, instrumental, found, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(key) DO UPDATE SET synced = excluded.synced, plain = excluded.plain,
                 instrumental = excluded.instrumental, found = excluded.found, fetched_at = excluded.fetched_at",
            params![key, synced_lrc, plain, instrumental, found, crate::now_ms()],
        )?;
        // Keep the cache bounded.
        self.conn.execute(
            "DELETE FROM lyrics WHERE key NOT IN (SELECT key FROM lyrics ORDER BY fetched_at DESC LIMIT 2000)",
            [],
        )?;
        Ok(())
    }
}
