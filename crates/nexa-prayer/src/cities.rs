//! Offline city search. The list (~7,300 cities with coordinates and IANA time
//! zones, from the MIT-licensed `city-timezones` dataset) is embedded in the
//! binary, so searching never sends anything over the network.

use serde::Serialize;
use std::sync::OnceLock;

static RAW: &str = include_str!("../data/cities.json");

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct City {
    pub name: String,
    #[serde(skip)]
    ascii_lower: String,
    pub region: String,
    pub country: String,
    pub country_code: String,
    pub latitude: f64,
    pub longitude: f64,
    pub population: u64,
    pub timezone: String,
}

type Row = (String, String, String, String, String, f64, f64, u64, String);

fn cities() -> &'static [City] {
    static CITIES: OnceLock<Vec<City>> = OnceLock::new();
    CITIES.get_or_init(|| {
        let rows: Vec<Row> = serde_json::from_str(RAW).expect("embedded cities.json is valid");
        rows.into_iter()
            .map(|(name, ascii, region, country, cc, lat, lng, pop, tz)| City {
                ascii_lower: ascii.to_lowercase(),
                name,
                region,
                country,
                country_code: cc,
                latitude: lat,
                longitude: lng,
                population: pop,
                timezone: tz,
            })
            .collect()
    })
}

/// Search by city name (prefix matches first), optionally "city, country".
/// Results are ordered by match quality, then population.
pub fn search(query: &str, limit: usize) -> Vec<City> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let (city_q, country_q) = match q.split_once(',') {
        Some((c, k)) => (c.trim().to_string(), Some(k.trim().to_string())),
        None => (q.clone(), None),
    };
    let mut hits: Vec<(u8, &City)> = cities()
        .iter()
        .filter_map(|c| {
            let name = c.name.to_lowercase();
            let rank = if name == city_q || c.ascii_lower == city_q {
                0
            } else if name.starts_with(&city_q) || c.ascii_lower.starts_with(&city_q) {
                1
            } else if name.contains(&city_q) || c.ascii_lower.contains(&city_q) {
                2
            } else if c.region.to_lowercase().starts_with(&city_q) {
                3
            } else {
                return None;
            };
            if let Some(k) = &country_q {
                if !k.is_empty()
                    && !c.country.to_lowercase().starts_with(k.as_str())
                    && c.country_code.to_lowercase() != *k
                {
                    return None;
                }
            }
            Some((rank, c))
        })
        .collect();
    // The list is pre-sorted by population, so a stable sort by rank keeps that order.
    hits.sort_by_key(|(rank, _)| *rank);
    hits.into_iter().take(limit).map(|(_, c)| c.clone()).collect()
}

/// Nearest known city — used to name a device location and pick its time zone
/// without any network lookup.
pub fn nearest(latitude: f64, longitude: f64) -> Option<(City, f64)> {
    cities()
        .iter()
        .map(|c| (c, haversine_km(latitude, longitude, c.latitude, c.longitude)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, d)| (c.clone(), d))
}

/// Most populous city in an IANA time zone.
pub fn largest_in_timezone(tz: &str) -> Option<City> {
    // Pre-sorted by population, so the first hit is the largest.
    cities().iter().find(|c| c.timezone == tz).cloned()
}

/// All IANA time-zone names known to the calculator.
pub fn timezones() -> Vec<&'static str> {
    chrono_tz::TZ_VARIANTS.iter().map(|tz| tz.name()).collect()
}

pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}
