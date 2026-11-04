//! Fitness: daily steps, a weight log, height and BMI, with simple trends.

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FitnessProfile {
    pub height_cm: f64,
    /// 0 = no goal.
    pub goal_kg: f64,
    pub step_goal: u32,
    /// BMI bands for South/East Asian adults (overweight from 23), as WHO advises for Asian populations.
    pub asian_bmi: bool,
    /// Weekly weigh-in reminder.
    pub weigh_reminder: bool,
    /// 1 = Monday … 7 = Sunday.
    pub weigh_day: u32,
    /// "HH:MM".
    pub weigh_time: String,
    /// For calorie estimates (BMR). 0 = not set.
    pub birth_year: u32,
    /// "male" | "female" | "" (not set).
    pub sex: String,
}

impl Default for FitnessProfile {
    fn default() -> Self {
        Self {
            height_cm: 0.0,
            goal_kg: 0.0,
            step_goal: 8000,
            asian_bmi: true,
            weigh_reminder: false,
            weigh_day: 5,
            weigh_time: "08:00".into(),
            birth_year: 0,
            sex: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightEntry {
    pub date: String,
    pub kg: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepEntry {
    pub date: String,
    pub steps: u32,
    /// "motion" (counted by the iPhone) or "manual".
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FitnessData {
    pub profile: FitnessProfile,
    pub weights: Vec<WeightEntry>,
    pub steps: Vec<StepEntry>,
}

const MAX_DAYS: usize = 3 * 366;

fn valid_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

impl FitnessData {
    pub fn sanitized(mut self) -> Self {
        let p = &mut self.profile;
        p.height_cm = if p.height_cm > 0.0 { p.height_cm.clamp(50.0, 250.0) } else { 0.0 };
        p.goal_kg = if p.goal_kg > 0.0 { p.goal_kg.clamp(20.0, 300.0) } else { 0.0 };
        p.step_goal = p.step_goal.clamp(1000, 50_000);
        p.weigh_day = p.weigh_day.clamp(1, 7);
        if chrono::NaiveTime::parse_from_str(&p.weigh_time, "%H:%M").is_err() {
            p.weigh_time = "08:00".into();
        }
        if p.birth_year != 0 && !(1900..=2030).contains(&p.birth_year) {
            p.birth_year = 0;
        }
        if p.sex != "male" && p.sex != "female" {
            p.sex.clear();
        }
        self.weights.retain(|w| valid_date(&w.date).is_some() && (20.0..=300.0).contains(&w.kg));
        self.weights.sort_by(|a, b| a.date.cmp(&b.date));
        self.weights.dedup_by(|b, a| a.date == b.date); // keeps the first of each date
        self.steps.retain(|s| valid_date(&s.date).is_some() && s.steps <= 150_000);
        self.steps.sort_by(|a, b| a.date.cmp(&b.date));
        self.steps.dedup_by(|b, a| a.date == b.date);
        if self.weights.len() > MAX_DAYS {
            self.weights.drain(..self.weights.len() - MAX_DAYS);
        }
        if self.steps.len() > MAX_DAYS {
            self.steps.drain(..self.steps.len() - MAX_DAYS);
        }
        self
    }

    /// Set (or clear with `None`) the weight for a date.
    pub fn log_weight(&mut self, date: &str, kg: Option<f64>) {
        self.weights.retain(|w| w.date != date);
        if let Some(kg) = kg {
            self.weights.push(WeightEntry { date: date.into(), kg: (kg * 10.0).round() / 10.0 });
        }
    }

    /// Set the steps for a date. Counts from the iPhone never overwrite a larger manual number.
    pub fn set_steps(&mut self, date: &str, steps: u32, source: &str) {
        if let Some(e) = self.steps.iter_mut().find(|s| s.date == date) {
            if source == "motion" && e.source == "manual" && e.steps > steps {
                return;
            }
            e.steps = steps;
            e.source = source.into();
        } else {
            self.steps.push(StepEntry { date: date.into(), steps, source: source.into() });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BmiBand {
    Under,
    Healthy,
    Over,
    Obese,
}

pub fn bmi(kg: f64, height_cm: f64) -> Option<f64> {
    (height_cm > 0.0 && kg > 0.0).then(|| {
        let m = height_cm / 100.0;
        ((kg / (m * m)) * 10.0).round() / 10.0
    })
}

/// Upper limits of under / healthy / over.
pub fn bmi_cutoffs(asian: bool) -> (f64, f64, f64) {
    if asian {
        (18.5, 23.0, 27.5)
    } else {
        (18.5, 25.0, 30.0)
    }
}

pub fn bmi_band(bmi: f64, asian: bool) -> BmiBand {
    let (u, h, o) = bmi_cutoffs(asian);
    if bmi < u {
        BmiBand::Under
    } else if bmi < h {
        BmiBand::Healthy
    } else if bmi < o {
        BmiBand::Over
    } else {
        BmiBand::Obese
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessSummary {
    pub today: String,
    pub steps_today: u32,
    pub step_goal: u32,
    /// Distance and energy estimated from steps, height and weight.
    pub km_today: f64,
    pub kcal_today: u32,
    pub steps_week_avg: u32,
    /// Days in a row (ending today or yesterday) reaching the step goal.
    pub step_streak: u32,
    pub weight: Option<f64>,
    pub weight_date: Option<String>,
    /// Change against the reading nearest to 7 / 30 days before the latest.
    pub change_7d: Option<f64>,
    pub change_30d: Option<f64>,
    pub bmi: Option<f64>,
    pub bmi_band: Option<BmiBand>,
    /// Healthy weight range for this height.
    pub healthy_min_kg: Option<f64>,
    pub healthy_max_kg: Option<f64>,
    pub to_goal_kg: Option<f64>,
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

pub fn summary(d: &FitnessData, today: NaiveDate) -> FitnessSummary {
    let p = &d.profile;
    let key = |x: NaiveDate| x.format("%Y-%m-%d").to_string();
    let steps_on = |x: NaiveDate| d.steps.iter().find(|s| s.date == key(x)).map(|s| s.steps).unwrap_or(0);

    let steps_today = steps_on(today);
    let latest = d.weights.last();
    let weight = latest.map(|w| w.kg);
    let height = if p.height_cm > 0.0 { p.height_cm } else { 165.0 };
    let km = steps_today as f64 * height * 0.415 / 100_000.0;
    let kcal = steps_today as f64 * 0.04 * weight.unwrap_or(65.0) / 70.0;

    let week: Vec<u32> = (0..7).map(|i| steps_on(today - Duration::days(i))).collect();
    let mut streak = 0;
    let mut day = today;
    if steps_on(day) < p.step_goal {
        day -= Duration::days(1);
    }
    while steps_on(day) >= p.step_goal && streak < 3650 {
        streak += 1;
        day -= Duration::days(1);
    }

    let change = |days: i64| -> Option<f64> {
        let last = latest?;
        let ld = valid_date(&last.date)?;
        let target = ld - Duration::days(days);
        // the reading closest to `target`, at least `days/2` before the latest
        let past = d
            .weights
            .iter()
            .filter_map(|w| valid_date(&w.date).map(|dt| (dt, w.kg)))
            .filter(|(dt, _)| (ld - *dt).num_days() >= (days / 2).max(1))
            .min_by_key(|(dt, _)| (*dt - target).num_days().abs())?;
        Some(round1(last.kg - past.1))
    };

    let (u, h, _) = bmi_cutoffs(p.asian_bmi);
    let m2 = (p.height_cm / 100.0).powi(2);
    let b = weight.and_then(|kg| bmi(kg, p.height_cm));
    FitnessSummary {
        today: key(today),
        steps_today,
        step_goal: p.step_goal,
        km_today: round1(km),
        kcal_today: kcal.round() as u32,
        steps_week_avg: week.iter().sum::<u32>() / 7,
        step_streak: streak,
        weight,
        weight_date: latest.map(|w| w.date.clone()),
        change_7d: change(7),
        change_30d: change(30),
        bmi: b,
        bmi_band: b.map(|x| bmi_band(x, p.asian_bmi)),
        healthy_min_kg: (p.height_cm > 0.0).then(|| round1(u * m2)),
        healthy_max_kg: (p.height_cm > 0.0).then(|| round1((h - 0.1) * m2)),
        to_goal_kg: (p.goal_kg > 0.0).then_some(()).and(weight).map(|w| round1(w - p.goal_kg)),
    }
}


// ----- report ----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Activity {
    /// under 5,000 steps a day
    Sedentary,
    /// 5,000–7,499
    Low,
    /// 7,500–9,999
    Somewhat,
    /// 10,000–12,499
    Active,
    /// 12,500 and more
    Very,
}

impl Activity {
    pub fn of(avg_steps: u32) -> Self {
        match avg_steps {
            0..=4999 => Self::Sedentary,
            5000..=7499 => Self::Low,
            7500..=9999 => Self::Somewhat,
            10000..=12499 => Self::Active,
            _ => Self::Very,
        }
    }
    /// Physical activity level multiplier for daily energy needs.
    fn pal(self) -> f64 {
        match self {
            Self::Sedentary => 1.2,
            Self::Low => 1.375,
            Self::Somewhat => 1.45,
            Self::Active => 1.55,
            Self::Very => 1.725,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckLevel {
    Good,
    Ok,
    Warn,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub key: &'static str,
    pub level: CheckLevel,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBar {
    pub date: String,
    pub steps: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessReport {
    pub days: u32,
    pub from: String,
    pub to: String,
    pub total_steps: u32,
    pub avg_steps: u32,
    pub best: Option<DayBar>,
    /// Days that reached the step goal.
    pub goal_days: u32,
    pub km: f64,
    /// Energy burned by walking over the period (estimate).
    pub walk_kcal: u32,
    pub activity: Activity,
    pub weight_start: Option<f64>,
    pub weight_end: Option<f64>,
    pub weight_change: Option<f64>,
    /// Daily energy: resting (BMR) and total with activity (TDEE). Need age, sex, height, weight.
    pub bmr: Option<u32>,
    pub tdee: Option<u32>,
    /// A gentle daily target toward the goal weight (never below the safe floor).
    pub target_kcal: Option<u32>,
    /// Weeks to the goal at about 0.5 kg a week.
    pub weeks_to_goal: Option<u32>,
    pub checks: Vec<HealthCheck>,
    /// Good checks out of all scored checks.
    pub score: u32,
    pub score_of: u32,
}

fn age_on(birth_year: u32, today: NaiveDate) -> Option<u32> {
    use chrono::Datelike;
    (birth_year > 0).then(|| (today.year() as u32).saturating_sub(birth_year)).filter(|a| (10..=110).contains(a))
}

/// Mifflin–St Jeor resting energy, kcal/day.
pub fn bmr(kg: f64, height_cm: f64, age: u32, male: bool) -> f64 {
    10.0 * kg + 6.25 * height_cm - 5.0 * age as f64 + if male { 5.0 } else { -161.0 }
}

/// Energy burned walking, kcal (≈0.04 kcal per step for 70 kg, scaled by weight).
pub fn walk_kcal(steps: u32, kg: f64) -> f64 {
    steps as f64 * 0.04 * kg / 70.0
}

pub fn report(d: &FitnessData, today: NaiveDate, days: u32) -> FitnessReport {
    let p = &d.profile;
    let days = days.clamp(1, 366);
    let from = today - Duration::days(days as i64 - 1);
    let key = |x: NaiveDate| x.format("%Y-%m-%d").to_string();
    let in_range: Vec<&StepEntry> = d
        .steps
        .iter()
        .filter(|s| valid_date(&s.date).is_some_and(|dt| dt >= from && dt <= today))
        .collect();
    let total: u32 = in_range.iter().map(|s| s.steps).sum();
    // Average over days that have data (today counts only if it has any), so a fresh install isn't "sedentary".
    let counted = in_range.iter().filter(|s| s.steps > 0).count().max(1) as u32;
    let avg = total / counted;
    let best = in_range.iter().max_by_key(|s| s.steps).filter(|s| s.steps > 0).map(|s| DayBar { date: s.date.clone(), steps: s.steps });
    let goal_days = in_range.iter().filter(|s| s.steps >= p.step_goal).count() as u32;

    let weights: Vec<&WeightEntry> = d.weights.iter().filter(|w| valid_date(&w.date).is_some_and(|dt| dt >= from && dt <= today)).collect();
    let latest = d.weights.last().map(|w| w.kg);
    let kg = latest.unwrap_or(65.0);
    let height = if p.height_cm > 0.0 { p.height_cm } else { 165.0 };
    let km = round1(total as f64 * height * 0.415 / 100_000.0);
    let activity = Activity::of(avg);

    let age = age_on(p.birth_year, today);
    let male = match p.sex.as_str() {
        "male" => Some(true),
        "female" => Some(false),
        _ => None,
    };
    let bmr_v = match (latest, age, male, p.height_cm > 0.0) {
        (Some(w), Some(a), Some(m), true) => Some(bmr(w, p.height_cm, a, m)),
        _ => None,
    };
    let tdee = bmr_v.map(|b| b * activity.pal());
    let to_goal = (p.goal_kg > 0.0).then_some(()).and(latest).map(|w| w - p.goal_kg);
    let target = match (tdee, bmr_v, to_goal, male) {
        (Some(t), Some(b), Some(g), Some(m)) if g > 0.5 => {
            let floor = if m { 1500.0 } else { 1200.0 };
            Some((t - 500.0).max(floor).max(b))
        }
        (Some(t), _, Some(g), _) if g < -0.5 => Some(t + 300.0),
        (Some(t), ..) => Some(t),
        _ => None,
    };
    let weeks = to_goal.filter(|g| g.abs() > 0.5).map(|g| (g.abs() / 0.5).ceil() as u32);

    // ----- health checks -----
    let mut checks = Vec::new();
    let s = summary(d, today);
    match (s.bmi, s.bmi_band) {
        (Some(b), Some(band)) => {
            let (lo, hi) = (s.healthy_min_kg.unwrap_or(0.0), s.healthy_max_kg.unwrap_or(0.0));
            let (level, title, detail) = match band {
                BmiBand::Healthy => (CheckLevel::Good, "Healthy weight".to_string(), format!("BMI {b} — inside the healthy range ({lo}–{hi} kg).")),
                BmiBand::Over => (CheckLevel::Warn, "Overweight".to_string(), format!("BMI {b}. About {} kg above the healthy range ({lo}–{hi} kg).", round1(kg - hi))),
                BmiBand::Obese => (CheckLevel::Warn, "Obese range".to_string(), format!("BMI {b}. {} kg above the healthy range — worth talking to a doctor about a plan.", round1(kg - hi))),
                BmiBand::Under => (CheckLevel::Warn, "Underweight".to_string(), format!("BMI {b}. About {} kg below the healthy range ({lo}–{hi} kg).", round1(lo - kg))),
            };
            checks.push(HealthCheck { key: "weight", level, title, detail });
        }
        _ => checks.push(HealthCheck { key: "weight", level: CheckLevel::Info, title: "Weight status unknown".into(), detail: "Add your height and weight to check it.".into() }),
    }
    let (al, at, ad) = match activity {
        Activity::Sedentary => (CheckLevel::Warn, "Not very active", format!("{avg} steps a day on average. Aim for 7,500+ — a 20-minute walk adds about 2,000.")),
        Activity::Low => (CheckLevel::Ok, "A little active", format!("{avg} steps a day. Another 2,500 a day would reach a healthy level.")),
        Activity::Somewhat => (CheckLevel::Good, "Fairly active", format!("{avg} steps a day — good. 10,000 a day is a great next step.")),
        Activity::Active | Activity::Very => (CheckLevel::Good, "Active", format!("{avg} steps a day — excellent, keep it up.")),
    };
    checks.push(HealthCheck { key: "activity", level: al, title: at.into(), detail: ad });
    let gl = if goal_days * 7 >= days * 5 {
        CheckLevel::Good
    } else if goal_days * 7 >= days * 3 {
        CheckLevel::Ok
    } else {
        CheckLevel::Warn
    };
    checks.push(HealthCheck { key: "consistency", level: gl, title: "Step goal".into(), detail: format!("Reached on {goal_days} of {days} days.") });
    if let Some(change) = s.change_30d {
        let toward = match to_goal {
            Some(g) if g.abs() > 0.5 => g.signum() != change.signum() || change == 0.0,
            _ => change.abs() <= 1.0,
        };
        let detail = if change == 0.0 { "No change in the last month.".to_string() } else { format!("{} {} kg in the last month.", if change < 0.0 { "Down" } else { "Up" }, change.abs()) };
        checks.push(HealthCheck { key: "trend", level: if toward { CheckLevel::Good } else { CheckLevel::Ok }, title: "Weight trend".into(), detail });
    }
    if let Some(last) = d.weights.last().and_then(|w| valid_date(&w.date)) {
        let ago = (today - last).num_days();
        if ago > 14 {
            checks.push(HealthCheck { key: "weighin", level: CheckLevel::Info, title: "Weigh in".into(), detail: format!("Last weigh-in was {ago} days ago.") });
        }
    }
    let scored: Vec<&HealthCheck> = checks.iter().filter(|c| c.level != CheckLevel::Info).collect();

    FitnessReport {
        days,
        from: key(from),
        to: key(today),
        total_steps: total,
        avg_steps: avg,
        best,
        goal_days,
        km,
        walk_kcal: walk_kcal(total, kg).round() as u32,
        activity,
        weight_start: weights.first().map(|w| w.kg),
        weight_end: weights.last().map(|w| w.kg),
        weight_change: (weights.len() >= 2).then(|| round1(weights.last().unwrap().kg - weights.first().unwrap().kg)),
        bmr: bmr_v.map(|x| x.round() as u32),
        tdee: tdee.map(|x| x.round() as u32),
        target_kcal: target.map(|x| (x / 10.0).round() as u32 * 10),
        weeks_to_goal: weeks,
        score: scored.iter().filter(|c| c.level == CheckLevel::Good).count() as u32,
        score_of: scored.len() as u32,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn report_has_energy_activity_and_checks() {
        let mut f = FitnessData {
            profile: FitnessProfile { height_cm: 170.0, goal_kg: 66.0, birth_year: 1991, sex: "male".into(), ..Default::default() },
            ..Default::default()
        };
        f.log_weight("2026-10-01", Some(74.0));
        f.log_weight("2026-11-03", Some(72.0));
        for i in 0..7 {
            let day = d("2026-11-03") - Duration::days(i);
            f.set_steps(&day.format("%Y-%m-%d").to_string(), if i % 2 == 0 { 9000 } else { 6000 }, "motion");
        }
        let r = report(&f.sanitized(), d("2026-11-03"), 7);
        assert_eq!(r.total_steps, 4 * 9000 + 3 * 6000);
        assert_eq!(r.avg_steps, 54000 / 7);
        assert_eq!(r.activity, Activity::Somewhat);
        assert_eq!(r.goal_days, 4);
        // Mifflin–St Jeor: 10·72 + 6.25·170 − 5·35 + 5 = 1612.5
        assert_eq!(r.bmr, Some(1613));
        assert_eq!(r.tdee, Some((1612.5f64 * 1.45).round() as u32));
        // 6 kg to lose → deficit of 500, never under BMR or 1,500
        assert_eq!(r.target_kcal, Some(((1612.5 * 1.45 - 500.0f64).max(1612.5) / 10.0).round() as u32 * 10));
        assert_eq!(r.weeks_to_goal, Some(12));
        let weight = r.checks.iter().find(|c| c.key == "weight").unwrap();
        assert_eq!(weight.level, CheckLevel::Warn);
        assert_eq!(weight.title, "Overweight");
        assert!(r.walk_kcal > 2000);
        assert!(r.score_of >= 3);
    }

    #[test]
    fn report_without_age_or_sex_skips_calorie_needs() {
        let mut f = FitnessData { profile: FitnessProfile { height_cm: 165.0, ..Default::default() }, ..Default::default() };
        f.log_weight("2026-11-03", Some(60.0));
        let r = report(&f, d("2026-11-03"), 30);
        assert_eq!((r.bmr, r.tdee, r.target_kcal), (None, None, None));
        assert_eq!(r.checks[0].level, CheckLevel::Good);
        assert_eq!(Activity::of(0), Activity::Sedentary);
    }

    #[test]
    fn bmi_and_bands() {
        assert_eq!(bmi(70.0, 170.0), Some(24.2));
        assert_eq!(bmi_band(24.2, true), BmiBand::Over);
        assert_eq!(bmi_band(24.2, false), BmiBand::Healthy);
        assert_eq!(bmi_band(17.0, true), BmiBand::Under);
        assert_eq!(bmi_band(31.0, false), BmiBand::Obese);
        assert_eq!(bmi(70.0, 0.0), None);
    }

    #[test]
    fn summary_has_trends_ranges_and_streak() {
        let mut f = FitnessData { profile: FitnessProfile { height_cm: 170.0, goal_kg: 68.0, ..Default::default() }, ..Default::default() };
        f.log_weight("2026-10-01", Some(74.0));
        f.log_weight("2026-10-27", Some(72.4));
        f.log_weight("2026-11-03", Some(71.6));
        for (day, n) in [("2026-11-01", 9000), ("2026-11-02", 8500), ("2026-11-03", 4000)] {
            f.set_steps(day, n, "motion");
        }
        let s = summary(&f.clone().sanitized(), d("2026-11-03"));
        assert_eq!(s.weight, Some(71.6));
        assert_eq!(s.change_7d, Some(-0.8));
        assert_eq!(s.change_30d, Some(-2.4));
        assert_eq!(s.bmi, Some(24.8));
        assert_eq!(s.bmi_band, Some(BmiBand::Over));
        assert_eq!(s.healthy_min_kg, Some(53.5));
        assert_eq!(s.healthy_max_kg, Some(66.2));
        assert_eq!(s.to_goal_kg, Some(3.6));
        assert_eq!(s.steps_today, 4000);
        assert_eq!(s.step_streak, 2, "today isn't finished, so the streak runs to yesterday");
        assert!(s.km_today > 2.5 && s.km_today < 3.0);
    }

    #[test]
    fn iphone_counts_dont_replace_a_bigger_manual_entry() {
        let mut f = FitnessData::default();
        f.set_steps("2026-11-03", 12000, "manual");
        f.set_steps("2026-11-03", 3000, "motion");
        assert_eq!(f.steps[0].steps, 12000);
        f.set_steps("2026-11-03", 13000, "motion");
        assert_eq!((f.steps[0].steps, f.steps[0].source.as_str()), (13000, "motion"));
    }

    #[test]
    fn sanitizing_drops_bad_rows_and_keeps_one_per_day() {
        let f = FitnessData {
            weights: vec![
                WeightEntry { date: "bad".into(), kg: 70.0 },
                WeightEntry { date: "2026-11-02".into(), kg: 5.0 },
                WeightEntry { date: "2026-11-03".into(), kg: 70.0 },
                WeightEntry { date: "2026-11-03".into(), kg: 71.0 },
            ],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(f.weights.len(), 1);
    }
}
