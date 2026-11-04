//! Quiet places: pins on a map with a radius (default 500 m) where the phone
//! should go quiet. iOS doesn't let an app switch Silent mode / Do Not Disturb
//! itself, so the actual switching is done by an iOS automation (Shortcuts or
//! Focus) that Noor helps the user create; `automated` records that the user
//! finished that setup for a place.

use crate::db::{WidgetDb, WidgetError, WidgetResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const DEFAULT_RADIUS_M: u32 = 500;
pub const MIN_RADIUS_M: u32 = 50;
pub const MAX_RADIUS_M: u32 = 5000;
pub const MAX_PLACES: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub id: String,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub radius_m: u32,
    /// The user has created the iOS automation for this place.
    pub automated: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default = "default_radius")]
    pub radius_m: u32,
}

fn default_radius() -> u32 {
    DEFAULT_RADIUS_M
}

/// How far a position is from a place, and whether it is inside the radius.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceStatus {
    pub id: String,
    pub distance_m: f64,
    pub inside: bool,
}

/// Great-circle distance in metres (haversine).
pub fn distance_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_008.8;
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dphi = (lat2 - lat1).to_radians();
    let dlam = (lon2 - lon1).to_radians();
    let a = (dphi / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlam / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().atan2((1.0 - a).sqrt())
}

impl Place {
    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        distance_m(self.latitude, self.longitude, lat, lon) <= self.radius_m as f64
    }
}

pub fn statuses(places: &[Place], lat: f64, lon: f64) -> Vec<PlaceStatus> {
    places
        .iter()
        .map(|p| {
            let d = distance_m(p.latitude, p.longitude, lat, lon);
            PlaceStatus { id: p.id.clone(), distance_m: d, inside: d <= p.radius_m as f64 }
        })
        .collect()
}

impl WidgetDb {
    pub fn places(&self) -> WidgetResult<Vec<Place>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, latitude, longitude, radius_m, automated, created_at FROM quiet_places ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Place {
                id: r.get(0)?,
                name: r.get(1)?,
                latitude: r.get(2)?,
                longitude: r.get(3)?,
                radius_m: r.get::<_, i64>(4)? as u32,
                automated: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn place_save(&self, input: PlaceInput) -> WidgetResult<Place> {
        let name: String = input.name.trim().chars().take(60).collect();
        if name.is_empty() {
            return Err(WidgetError::Invalid("Give the place a name".into()));
        }
        if !(input.latitude.is_finite()
            && input.longitude.is_finite()
            && (-90.0..=90.0).contains(&input.latitude)
            && (-180.0..=180.0).contains(&input.longitude))
        {
            return Err(WidgetError::Invalid("Latitude must be −90…90 and longitude −180…180".into()));
        }
        let existing = match &input.id {
            Some(id) => self.places()?.into_iter().find(|p| &p.id == id),
            None => None,
        };
        if existing.is_none() && self.places()?.len() >= MAX_PLACES {
            return Err(WidgetError::Invalid(format!("Up to {MAX_PLACES} places")));
        }
        let place = Place {
            id: existing.as_ref().map(|p| p.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            name,
            latitude: (input.latitude * 1e6).round() / 1e6,
            longitude: (input.longitude * 1e6).round() / 1e6,
            radius_m: input.radius_m.clamp(MIN_RADIUS_M, MAX_RADIUS_M),
            automated: existing.as_ref().map(|p| p.automated).unwrap_or(false),
            created_at: existing.map(|p| p.created_at).unwrap_or_else(crate::now_ms),
        };
        self.conn.execute(
            "INSERT INTO quiet_places (id, name, latitude, longitude, radius_m, automated, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude,
               longitude = excluded.longitude, radius_m = excluded.radius_m",
            params![place.id, place.name, place.latitude, place.longitude, place.radius_m as i64, place.automated, place.created_at],
        )?;
        Ok(place)
    }

    pub fn place_set_automated(&self, id: &str, automated: bool) -> WidgetResult<()> {
        let n = self
            .conn
            .execute("UPDATE quiet_places SET automated = ?2 WHERE id = ?1", params![id, automated])?;
        if n == 0 {
            return Err(WidgetError::NotFound("place".into()));
        }
        Ok(())
    }

    pub fn place_delete(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM quiet_places WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, lat: f64, lon: f64, radius: u32) -> PlaceInput {
        PlaceInput { id: None, name: name.into(), latitude: lat, longitude: lon, radius_m: radius }
    }

    #[test]
    fn haversine_matches_known_distances() {
        // Dhaka → Makkah ≈ 5 172 km (same figure the Qibla screen shows)
        let d = distance_m(23.8103, 90.4125, 21.4225, 39.8262) / 1000.0;
        assert!((d - 5172.0).abs() < 15.0, "{d}");
        // 0.0045° of latitude ≈ 500 m
        let d = distance_m(23.0, 90.0, 23.0045, 90.0);
        assert!((d - 500.0).abs() < 5.0, "{d}");
        assert_eq!(distance_m(1.0, 2.0, 1.0, 2.0), 0.0);
    }

    #[test]
    fn inside_and_outside_the_radius() {
        let db = WidgetDb::open_in_memory().unwrap();
        let p = db.place_save(input("Masjid", 23.7298, 90.4119, 500)).unwrap();
        assert!(p.contains(23.7298 + 0.0030, 90.4119)); // ≈ 333 m
        assert!(!p.contains(23.7298 + 0.0060, 90.4119)); // ≈ 667 m
        let st = statuses(&[p], 23.7298 + 0.0030, 90.4119);
        assert!(st[0].inside && (st[0].distance_m - 333.6).abs() < 5.0);
    }

    #[test]
    fn save_validates_clamps_and_keeps_automated() {
        let db = WidgetDb::open_in_memory().unwrap();
        assert!(db.place_save(input("  ", 1.0, 1.0, 500)).is_err());
        assert!(db.place_save(input("Bad", 91.0, 1.0, 500)).is_err());
        assert!(db.place_save(input("Bad", 1.0, f64::NAN, 500)).is_err());

        let p = db.place_save(input(" Office ", 23.78, 90.41, 10)).unwrap();
        assert_eq!(p.name, "Office");
        assert_eq!(p.radius_m, MIN_RADIUS_M);
        assert!(!p.automated);

        db.place_set_automated(&p.id, true).unwrap();
        let mut edit = input("Office HQ", 23.78, 90.41, 99_999);
        edit.id = Some(p.id.clone());
        let q = db.place_save(edit).unwrap();
        assert_eq!((q.id.as_str(), q.name.as_str(), q.radius_m, q.automated), (p.id.as_str(), "Office HQ", MAX_RADIUS_M, true));
        assert_eq!(db.places().unwrap().len(), 1);

        db.place_delete(&p.id).unwrap();
        assert!(db.places().unwrap().is_empty());
        assert!(db.place_set_automated(&p.id, true).is_err());
    }
}
