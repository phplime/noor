//! Period / cycle tracker: logged periods and day notes, plus predictions —
//! next period, fertile window, ovulation and (when the history allows it) the
//! calendar-method "lower-chance" days. Everything stays on the phone.
//!
//! Predictions are estimates. The calendar method in particular is not a reliable
//! way to avoid pregnancy; the app says so wherever it shows those days.

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CycleSettings {
    /// Whose cycle this is ("Ayesha"); shown in the app only.
    pub name: String,
    /// Used until enough cycles are logged.
    pub cycle_len: u32,
    pub period_len: u32,
    /// Days from ovulation to the next period (usually 14).
    pub luteal_len: u32,
    pub remind_period: bool,
    pub remind_days_before: u32,
    pub remind_fertile: bool,
    /// Local "HH:MM".
    pub remind_time: String,
    /// Lock-screen friendly wording ("Cycle reminder") instead of naming the period.
    pub discreet: bool,
}

impl Default for CycleSettings {
    fn default() -> Self {
        Self { name: String::new(), cycle_len: 28, period_len: 5, luteal_len: 14, remind_period: true, remind_days_before: 2, remind_fertile: false, remind_time: "09:00".into(), discreet: true }
    }
}

impl CycleSettings {
    pub fn sanitized(mut self) -> Self {
        self.name = self.name.trim().chars().take(40).collect();
        self.cycle_len = self.cycle_len.clamp(20, 45);
        self.period_len = self.period_len.clamp(2, 10);
        self.luteal_len = self.luteal_len.clamp(10, 16);
        self.remind_days_before = self.remind_days_before.min(7);
        if crate::specials::parse_hhmm(&self.remind_time).is_none() {
            self.remind_time = "09:00".into();
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub start: NaiveDate,
    #[serde(default)]
    pub end: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DayLog {
    pub date: Option<NaiveDate>,
    /// 0 none · 1 spotting · 2 light · 3 medium · 4 heavy
    pub flow: u8,
    pub symptoms: Vec<String>,
    pub mood: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CycleData {
    pub settings: CycleSettings,
    pub periods: Vec<Period>,
    pub logs: Vec<DayLog>,
}

impl CycleData {
    /// Sorted, de-duplicated, sane values. Overlapping periods are merged.
    pub fn sanitized(mut self) -> Self {
        self.settings = self.settings.sanitized();
        self.periods.retain(|p| p.end.is_none_or(|e| e >= p.start && (e - p.start).num_days() <= 15));
        self.periods.sort_by_key(|p| p.start);
        let mut merged: Vec<Period> = Vec::new();
        for p in self.periods {
            if let Some(last) = merged.last_mut() {
                let last_end = last.end.unwrap_or(last.start + Duration::days(self.settings.period_len as i64 - 1));
                if p.start <= last_end + Duration::days(1) {
                    last.end = match (last.end, p.end) {
                        (Some(a), Some(b)) => Some(a.max(b)),
                        (a, b) => a.or(b),
                    };
                    continue;
                }
            }
            merged.push(p);
        }
        self.periods = merged;
        if self.periods.len() > 400 {
            self.periods.drain(..self.periods.len() - 400);
        }
        self.logs.retain(|l| l.date.is_some());
        for l in &mut self.logs {
            l.flow = l.flow.min(4);
            l.symptoms.truncate(20);
            l.note = l.note.chars().take(500).collect();
            l.mood = l.mood.chars().take(30).collect();
        }
        self.logs.sort_by_key(|l| l.date);
        self.logs.dedup_by_key(|l| l.date);
        if self.logs.len() > 2000 {
            self.logs.drain(..self.logs.len() - 2000);
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Regularity {
    /// Not enough cycles logged yet.
    Unknown,
    Regular,
    SomewhatIrregular,
    Irregular,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Nothing logged yet.
    None,
    Period,
    Follicular,
    Fertile,
    Ovulation,
    Luteal,
    /// Past the expected start.
    Late,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DayKind {
    Period,
    PredictedPeriod,
    Fertile,
    Ovulation,
    /// Calendar method: outside the possibly-fertile days. An estimate only.
    LowerChance,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleDay {
    pub date: NaiveDate,
    pub kind: DayKind,
    /// Day of the cycle (1 = first day of a period).
    pub cycle_day: Option<u32>,
    pub logged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleStatus {
    pub has_data: bool,
    pub cycles_logged: usize,
    pub avg_cycle: f64,
    pub avg_period: f64,
    pub shortest: Option<u32>,
    pub longest: Option<u32>,
    pub regularity: Regularity,
    /// Cycle lengths, oldest first (last 12).
    pub history: Vec<u32>,
    pub last_start: Option<NaiveDate>,
    pub cycle_day: Option<u32>,
    pub phase: Phase,
    pub next_start: Option<NaiveDate>,
    /// Earliest / latest likely start, from the spread of past cycles.
    pub next_window: Option<(NaiveDate, NaiveDate)>,
    pub days_until_next: Option<i64>,
    pub late_days: i64,
    pub ovulation: Option<NaiveDate>,
    pub fertile_start: Option<NaiveDate>,
    pub fertile_end: Option<NaiveDate>,
    /// Calendar method range of possibly-fertile cycle days (inclusive), when usable.
    pub calendar_fertile_days: Option<(u32, u32)>,
    /// Why the lower-chance days are not shown (empty when they are).
    pub calendar_note: String,
    pub insights: Vec<String>,
    pub days: Vec<CycleDay>,
}

fn mean(v: &[u32]) -> f64 {
    v.iter().map(|x| *x as f64).sum::<f64>() / v.len().max(1) as f64
}

fn sd(v: &[u32]) -> f64 {
    if v.len() < 2 {
        return 0.0;
    }
    let m = mean(v);
    (v.iter().map(|x| (*x as f64 - m).powi(2)).sum::<f64>() / (v.len() - 1) as f64).sqrt()
}

/// Cycle lengths between consecutive logged starts. Gaps over 60 days (a missed log) are skipped.
pub fn cycle_lengths(periods: &[Period]) -> Vec<u32> {
    periods
        .windows(2)
        .map(|w| (w[1].start - w[0].start).num_days())
        .filter(|d| (15..=60).contains(d))
        .map(|d| d as u32)
        .collect()
}

pub fn status(data: &CycleData, today: NaiveDate) -> CycleStatus {
    let s = &data.settings;
    let periods = &data.periods;
    let all_lengths = cycle_lengths(periods);
    let recent: Vec<u32> = all_lengths.iter().rev().take(6).rev().copied().collect();
    let avg_cycle = if recent.is_empty() { s.cycle_len as f64 } else { mean(&recent) };
    let period_lens: Vec<u32> = periods.iter().rev().filter_map(|p| p.end.map(|e| (e - p.start).num_days() as u32 + 1)).take(6).collect();
    let avg_period = if period_lens.is_empty() { s.period_len as f64 } else { mean(&period_lens) };
    let spread = sd(&recent);
    let regularity = match recent.len() {
        0..=2 => Regularity::Unknown,
        _ if spread <= 2.5 => Regularity::Regular,
        _ if spread <= 5.0 => Regularity::SomewhatIrregular,
        _ => Regularity::Irregular,
    };
    let shortest = all_lengths.iter().rev().take(12).min().copied();
    let longest = all_lengths.iter().rev().take(12).max().copied();

    let mut st = CycleStatus {
        has_data: !periods.is_empty(),
        cycles_logged: all_lengths.len(),
        avg_cycle: (avg_cycle * 10.0).round() / 10.0,
        avg_period: (avg_period * 10.0).round() / 10.0,
        shortest,
        longest,
        regularity,
        history: all_lengths.iter().rev().take(12).rev().copied().collect(),
        last_start: None,
        cycle_day: None,
        phase: Phase::None,
        next_start: None,
        next_window: None,
        days_until_next: None,
        late_days: 0,
        ovulation: None,
        fertile_start: None,
        fertile_end: None,
        calendar_fertile_days: None,
        calendar_note: String::new(),
        insights: Vec::new(),
        days: Vec::new(),
    };

    // Calendar (rhythm) method: possibly fertile from day (shortest − 18) to day (longest − 11).
    st.calendar_note = match (all_lengths.len(), shortest, longest) {
        (n, _, _) if n < 6 => format!("Log at least 6 cycles to see lower-chance days ({n} so far)."),
        (_, Some(a), Some(b)) if b - a > 9 => "Cycles vary too much for the calendar method.".into(),
        (_, Some(a), Some(_)) if a < 26 => "Cycles shorter than 26 days — the calendar method isn’t suitable.".into(),
        (_, Some(a), Some(b)) => {
            st.calendar_fertile_days = Some((a.saturating_sub(18).max(1), b.saturating_sub(11)));
            String::new()
        }
        _ => String::new(),
    };

    let Some(last) = periods.last() else {
        st.insights.push("Log the first day of the last period to start predictions.".into());
        return st;
    };
    st.last_start = Some(last.start);
    let len = avg_cycle.round() as i64;
    let next = last.start + Duration::days(len);
    let ovulation = next - Duration::days(s.luteal_len as i64);
    st.next_start = Some(next);
    let margin = if recent.len() >= 3 { spread.ceil().max(1.0) as i64 } else { 3 };
    st.next_window = Some((next - Duration::days(margin), next + Duration::days(margin)));
    st.days_until_next = Some((next - today).num_days());
    st.ovulation = Some(ovulation);
    st.fertile_start = Some(ovulation - Duration::days(5));
    st.fertile_end = Some(ovulation + Duration::days(1));

    let cd = (today - last.start).num_days() + 1;
    st.cycle_day = (cd >= 1).then_some(cd as u32);
    let in_logged_period = periods.iter().any(|p| today >= p.start && today <= p.end.unwrap_or(p.start + Duration::days(avg_period.round() as i64 - 1)));
    st.phase = if in_logged_period {
        Phase::Period
    } else if today >= next {
        st.late_days = (today - next).num_days();
        Phase::Late
    } else if today == ovulation {
        Phase::Ovulation
    } else if today >= ovulation - Duration::days(5) && today <= ovulation + Duration::days(1) {
        Phase::Fertile
    } else if today < ovulation {
        Phase::Follicular
    } else {
        Phase::Luteal
    };

    // Insights
    match regularity {
        Regularity::Unknown => st.insights.push(format!("Predictions use a {len}-day cycle until 3 cycles are logged.")),
        Regularity::Regular => st.insights.push(format!("Cycles are regular — about {len} days (±{:.0}).", spread.max(1.0))),
        Regularity::SomewhatIrregular => st.insights.push(format!("Cycles vary by about ±{spread:.0} days, so dates may shift.")),
        Regularity::Irregular => st.insights.push(format!("Cycles vary a lot (±{spread:.0} days). Predictions are rough; a doctor can help if this is new.")),
    }
    if let (Some(a), Some(b)) = (shortest, longest) {
        if all_lengths.len() >= 2 {
            st.insights.push(format!("Shortest {a} days, longest {b} days."));
        }
    }
    if st.late_days >= 7 {
        st.insights.push(format!("{} days late. Stress, travel or illness can delay a period; a test or a doctor can confirm if needed.", st.late_days));
    }
    if all_lengths.iter().rev().take(3).any(|l| *l < 21 || *l > 35) {
        st.insights.push("Some recent cycles were outside 21–35 days.".into());
    }
    if avg_period > 7.5 {
        st.insights.push("Periods longer than 7 days are worth mentioning to a doctor.".into());
    }

    st.days = cycle_days(data, today - Duration::days(70), today + Duration::days(130), avg_cycle, avg_period, st.calendar_fertile_days);
    st
}

/// Day-by-day picture: logged periods, then predicted cycles forward from the last logged start.
pub fn cycle_days(data: &CycleData, from: NaiveDate, to: NaiveDate, avg_cycle: f64, avg_period: f64, cal: Option<(u32, u32)>) -> Vec<CycleDay> {
    let s = &data.settings;
    let periods = &data.periods;
    let len = avg_cycle.round().max(15.0) as i64;
    let plen = avg_period.round().max(1.0) as i64;
    let luteal = s.luteal_len as i64;
    let mut out = Vec::new();
    let mut d = from;
    while d <= to {
        // the cycle this day belongs to: last logged start on or before d, else a predicted one
        let logged_start = periods.iter().rev().find(|p| p.start <= d).map(|p| p.start);
        let (start, predicted) = match (logged_start, periods.last()) {
            (Some(ls), Some(last)) if ls == last.start && d >= last.start + Duration::days(len) => {
                let k = (d - last.start).num_days() / len;
                (last.start + Duration::days(k * len), true)
            }
            (Some(ls), _) => (ls, false),
            (None, _) => {
                out.push(CycleDay { date: d, kind: DayKind::Other, cycle_day: None, logged: false });
                d += Duration::days(1);
                continue;
            }
        };
        let cd = (d - start).num_days() + 1;
        let logged_period = periods.iter().any(|p| d >= p.start && d <= p.end.unwrap_or(p.start + Duration::days(plen - 1)));
        let next_start = start + Duration::days(len);
        let ovu = next_start - Duration::days(luteal);
        let kind = if logged_period {
            DayKind::Period
        } else if predicted && cd <= plen {
            DayKind::PredictedPeriod
        } else if d == ovu {
            DayKind::Ovulation
        } else if d >= ovu - Duration::days(5) && d <= ovu + Duration::days(1) {
            DayKind::Fertile
        } else if let Some((a, b)) = cal {
            if (cd as u32) < a || (cd as u32) > b {
                DayKind::LowerChance
            } else {
                DayKind::Other
            }
        } else {
            DayKind::Other
        };
        out.push(CycleDay { date: d, kind, cycle_day: Some(cd as u32), logged: logged_period || data.logs.iter().any(|l| l.date == Some(d)) });
        d += Duration::days(1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn data(starts: &[NaiveDate]) -> CycleData {
        CycleData { periods: starts.iter().map(|s| Period { start: *s, end: Some(*s + Duration::days(4)) }).collect(), ..Default::default() }.sanitized()
    }

    #[test]
    fn empty_and_defaults() {
        let st = status(&CycleData::default(), d(2026, 11, 2));
        assert!(!st.has_data);
        assert_eq!(st.phase, Phase::None);
        assert_eq!(st.avg_cycle, 28.0);
        assert!(st.next_start.is_none());
        assert!(st.calendar_fertile_days.is_none());
    }

    #[test]
    fn one_period_uses_default_length() {
        let st = status(&data(&[d(2026, 10, 20)]), d(2026, 11, 2));
        assert_eq!(st.next_start, Some(d(2026, 11, 17)));
        assert_eq!(st.ovulation, Some(d(2026, 11, 3)));
        assert_eq!(st.fertile_start, Some(d(2026, 10, 29)));
        assert_eq!(st.cycle_day, Some(14));
        assert_eq!(st.phase, Phase::Fertile);
        assert_eq!(st.regularity, Regularity::Unknown);
    }

    #[test]
    fn regular_history_predicts_from_average_and_enables_calendar_method() {
        // 7 starts, 30-day cycles (one 29, one 31)
        let mut starts = vec![d(2026, 3, 1)];
        for len in [30, 29, 31, 30, 30, 30] {
            let last = *starts.last().unwrap();
            starts.push(last + Duration::days(len));
        }
        let st = status(&data(&starts), *starts.last().unwrap() + Duration::days(3));
        assert_eq!(st.cycles_logged, 6);
        assert_eq!(st.avg_cycle, 30.0);
        assert_eq!(st.regularity, Regularity::Regular);
        assert_eq!(st.phase, Phase::Period);
        assert_eq!(st.next_start, Some(*starts.last().unwrap() + Duration::days(30)));
        // shortest 29 → day 11; longest 31 → day 20
        assert_eq!(st.calendar_fertile_days, Some((11, 20)));
        assert!(st.days.iter().any(|x| x.kind == DayKind::LowerChance));
        assert!(st.days.iter().any(|x| x.kind == DayKind::PredictedPeriod));
        assert!(st.days.iter().any(|x| x.kind == DayKind::Ovulation));
    }

    #[test]
    fn irregular_cycles_disable_calendar_method_and_late_is_flagged() {
        let mut starts = vec![d(2026, 1, 1)];
        for len in [24, 38, 27, 35, 26, 40] {
            let last = *starts.last().unwrap();
            starts.push(last + Duration::days(len));
        }
        let last = *starts.last().unwrap();
        let st = status(&data(&starts), last + Duration::days(45));
        assert_eq!(st.regularity, Regularity::Irregular);
        assert!(st.calendar_fertile_days.is_none());
        assert!(!st.calendar_note.is_empty());
        assert_eq!(st.phase, Phase::Late);
        assert!(st.late_days > 7);
        assert!(st.insights.iter().any(|i| i.contains("late")));
    }

    #[test]
    fn sanitize_merges_overlaps_and_skips_long_gaps() {
        let raw = CycleData {
            periods: vec![
                Period { start: d(2026, 5, 3), end: Some(d(2026, 5, 7)) },
                Period { start: d(2026, 5, 1), end: None },
                Period { start: d(2026, 9, 1), end: Some(d(2026, 8, 1)) }, // end before start: dropped
            ],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(raw.periods.len(), 1);
        assert_eq!(raw.periods[0].start, d(2026, 5, 1));
        assert_eq!(raw.periods[0].end, Some(d(2026, 5, 7)));
        // 90-day gap (missed logging) is not counted as a cycle
        assert!(cycle_lengths(&[Period { start: d(2026, 1, 1), end: None }, Period { start: d(2026, 4, 1), end: None }]).is_empty());
    }
}
