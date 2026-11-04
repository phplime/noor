//! The person's own details for the Home screen: name, photo, cover photo,
//! a few favourite photos and a birthday. Images are small JPEG data URLs
//! prepared (resized) by the app before saving.

use crate::db::{WidgetDb, WidgetError, WidgetResult};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub const MAX_PHOTOS: usize = 8;
const MAX_AVATAR: usize = 200_000;
const MAX_COVER: usize = 600_000;
const MAX_PHOTO: usize = 450_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub name: String,
    pub avatar: Option<String>,
    pub cover: Option<String>,
    pub photos: Vec<String>,
    /// "MM-DD"
    pub birthday: Option<String>,
}

fn check_image(label: &str, s: &str, max: usize) -> WidgetResult<()> {
    if !s.starts_with("data:image/") {
        return Err(WidgetError::Invalid(format!("{label} must be an image")));
    }
    if s.len() > max {
        return Err(WidgetError::Invalid(format!("{label} is too large")));
    }
    Ok(())
}

impl Profile {
    pub fn validated(mut self) -> WidgetResult<Self> {
        self.name = self.name.trim().chars().take(60).collect();
        if let Some(a) = &self.avatar {
            check_image("Photo", a, MAX_AVATAR)?;
        }
        if let Some(c) = &self.cover {
            check_image("Cover photo", c, MAX_COVER)?;
        }
        if self.photos.len() > MAX_PHOTOS {
            return Err(WidgetError::Invalid(format!("Up to {MAX_PHOTOS} photos")));
        }
        for p in &self.photos {
            check_image("Photo", p, MAX_PHOTO)?;
        }
        self.birthday = match self.birthday.take().filter(|b| !b.trim().is_empty()) {
            None => None,
            Some(b) => {
                let ok = NaiveDate::parse_from_str(&format!("2000-{b}"), "%Y-%m-%d").is_ok();
                if !ok {
                    return Err(WidgetError::Invalid("Birthday must look like 03-14".into()));
                }
                Some(b)
            }
        };
        Ok(self)
    }

    /// Birthday as (month, day).
    pub fn birthday_md(&self) -> Option<(u32, u32)> {
        let b = self.birthday.as_deref()?;
        let (m, d) = b.split_once('-')?;
        Some((m.parse().ok()?, d.parse().ok()?))
    }
}

impl WidgetDb {
    pub fn profile(&self) -> WidgetResult<Profile> {
        Ok(self.get_json("profile")?.unwrap_or_default())
    }

    pub fn profile_save(&self, p: Profile) -> WidgetResult<Profile> {
        let p = p.validated()?;
        self.set_json("profile", &p)?;
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_round_trips() {
        let db = WidgetDb::open_in_memory().unwrap();
        assert_eq!(db.profile().unwrap(), Profile::default());
        let p = db
            .profile_save(Profile { name: "  Nazmul ".into(), avatar: Some("data:image/jpeg;base64,AAAA".into()), birthday: Some("03-14".into()), ..Default::default() })
            .unwrap();
        assert_eq!(p.name, "Nazmul");
        assert_eq!(p.birthday_md(), Some((3, 14)));
        assert_eq!(db.profile().unwrap(), p);

        let bad = |f: &dyn Fn(&mut Profile)| {
            let mut p = Profile::default();
            f(&mut p);
            db.profile_save(p).is_err()
        };
        assert!(bad(&|p| p.avatar = Some("http://evil/x.png".into())));
        assert!(bad(&|p| p.cover = Some(format!("data:image/jpeg;base64,{}", "A".repeat(700_000)))));
        assert!(bad(&|p| p.photos = vec!["data:image/jpeg;base64,AA".into(); 9]));
        assert!(bad(&|p| p.birthday = Some("13-40".into())));
        assert!(!bad(&|p| p.birthday = Some(String::new())));
        assert!(!bad(&|p| p.birthday = Some("02-29".into())));
    }
}
