//! Persistent application settings, stored as JSON in the app's config folder.
//! Values are validated and clamped on every load and save; a corrupt file is
//! moved aside and replaced by defaults instead of crashing the app.

use mackit_core::color::Color;
use mackit_core::export::{ConflictPolicy, ExportOptions, OutputFormat};
use mackit_core::geometry::{Anchor, Limits, ResizeMode};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

/// Desired scroll direction for one kind of device.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DeviceDirection {
    /// Follow the macOS setting (no MacKit involvement).
    #[default]
    System,
    Natural,
    Standard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ScrollPrefs {
    pub mouse: DeviceDirection,
    pub trackpad: DeviceDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub version: u32,
    pub theme: Theme,
    /// Empty / None = save next to the source file.
    pub default_output_dir: Option<String>,
    pub default_output_format: OutputFormat,
    pub default_quality: u32,
    pub default_watermark_anchor: Anchor,
    /// 0.0 ..= 1.0
    pub default_watermark_opacity: f64,
    pub default_background: Color,
    /// "free" or "W:H"
    pub default_aspect_ratio: String,
    pub default_resize_mode: ResizeMode,
    /// Empty = each tool uses its own suffix (-cropped, -watermarked, -{w}x{h} …).
    pub default_suffix: String,
    pub default_conflict: ConflictPolicy,
    /// Ask before writing when outputs already exist.
    pub confirm_overwrite: bool,
    pub include_subfolders: bool,
    pub remember_last_export: bool,
    /// Last-used export options per tool id (only when `remember_last_export`).
    pub last_export: BTreeMap<String, ExportOptions>,
    pub limits: Limits,
    /// Files processed in parallel during batches.
    pub concurrency: usize,
    pub scrolling: ScrollPrefs,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            version: SETTINGS_VERSION,
            theme: Theme::System,
            default_output_dir: None,
            default_output_format: OutputFormat::Source,
            default_quality: 85,
            default_watermark_anchor: Anchor::BottomRight,
            default_watermark_opacity: 0.8,
            default_background: Color::WHITE,
            default_aspect_ratio: "free".into(),
            default_resize_mode: ResizeMode::Fit,
            default_suffix: String::new(),
            default_conflict: ConflictPolicy::Rename,
            confirm_overwrite: true,
            include_subfolders: false,
            remember_last_export: true,
            last_export: BTreeMap::new(),
            limits: Limits::default(),
            concurrency: 2,
            scrolling: ScrollPrefs::default(),
        }
    }
}

fn valid_ratio(s: &str) -> bool {
    s == "free" || mackit_core::geometry::parse_ratio(s).is_some()
}

impl AppSettings {
    /// Clamp/repair every field so the rest of the app can trust the values.
    pub fn sanitized(mut self) -> Self {
        let d = AppSettings::default();
        self.version = SETTINGS_VERSION;
        self.default_quality = self.default_quality.clamp(1, 100);
        if !self.default_watermark_opacity.is_finite() {
            self.default_watermark_opacity = d.default_watermark_opacity;
        }
        self.default_watermark_opacity = self.default_watermark_opacity.clamp(0.0, 1.0);
        if !valid_ratio(&self.default_aspect_ratio) {
            self.default_aspect_ratio = d.default_aspect_ratio;
        }
        self.default_suffix = self
            .default_suffix
            .chars()
            .filter(|c| !c.is_control() && *c != '/' && *c != ':')
            .take(64)
            .collect();
        if let Some(dir) = &self.default_output_dir {
            let p = Path::new(dir);
            if dir.trim().is_empty() || !p.is_absolute() {
                self.default_output_dir = None;
            }
        }
        self.limits.max_dimension = self.limits.max_dimension.clamp(1_000, 65_000);
        self.limits.max_megapixels = self.limits.max_megapixels.clamp(10, 1_000);
        self.concurrency = self.concurrency.clamp(1, 8);
        self.last_export
            .retain(|k, v| k.len() <= 64 && v.quality >= 1 && v.quality <= 100);
        for v in self.last_export.values_mut() {
            if let Some(dir) = &v.output_dir {
                if !Path::new(dir).is_absolute() {
                    v.output_dir = None;
                }
            }
            v.allow_source_overwrite = false; // never persisted as "on"
        }
        if !self.remember_last_export {
            self.last_export.clear();
        }
        self
    }
}

/// Deserialize settings field by field, so one bad value (e.g. an unknown theme
/// name from a newer version) only resets that field instead of everything.
pub fn from_value_lenient(value: serde_json::Value) -> AppSettings {
    if let Ok(s) = serde_json::from_value::<AppSettings>(value.clone()) {
        return s;
    }
    let mut merged = serde_json::to_value(AppSettings::default()).expect("defaults serialize");
    if let (Some(user), Some(target)) = (value.as_object(), merged.as_object_mut()) {
        for (k, v) in user {
            if !target.contains_key(k) {
                continue;
            }
            let previous = target.insert(k.clone(), v.clone());
            if serde_json::from_value::<AppSettings>(serde_json::Value::Object(target.clone()))
                .is_err()
            {
                if let Some(p) = previous {
                    target.insert(k.clone(), p);
                }
            }
        }
    }
    serde_json::from_value(merged).unwrap_or_default()
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        SettingsStore {
            path: config_dir.join("settings.json"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> AppSettings {
        let raw = match fs::read_to_string(&self.path) {
            Ok(s) => s,
            Err(_) => return AppSettings::default(),
        };
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(value) => from_value_lenient(value).sanitized(),
            Err(e) => {
                eprintln!("MacKit: settings file is not valid JSON ({e}); using defaults");
                let backup = self.path.with_extension("json.invalid");
                let _ = fs::rename(&self.path, backup);
                AppSettings::default()
            }
        }
    }

    pub fn save(&self, settings: &AppSettings) -> Result<AppSettings, String> {
        let clean = settings.clone().sanitized();
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        Ok(clean)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        assert_eq!(store.load(), AppSettings::default());
        let mut s = AppSettings {
            theme: Theme::Dark,
            default_quality: 70,
            default_suffix: "-web".into(),
            ..Default::default()
        };
        s.scrolling.mouse = DeviceDirection::Standard;
        store.save(&s).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.theme, Theme::Dark);
        assert_eq!(loaded.default_quality, 70);
        assert_eq!(loaded.default_suffix, "-web");
        assert_eq!(loaded.scrolling.mouse, DeviceDirection::Standard);
    }

    #[test]
    fn invalid_values_are_repaired() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        fs::write(
            store.path(),
            r#"{"defaultQuality": 400, "defaultWatermarkOpacity": 9, "defaultAspectRatio": "banana",
                "defaultOutputDir": "relative/path", "concurrency": 99, "defaultSuffix": "a/b:c",
                "unknownField": true, "theme": "dark"}"#,
        )
        .unwrap();
        let s = store.load();
        assert_eq!(s.default_quality, 100);
        assert_eq!(s.default_watermark_opacity, 1.0);
        assert_eq!(s.default_aspect_ratio, "free");
        assert_eq!(s.default_output_dir, None);
        assert_eq!(s.concurrency, 8);
        assert_eq!(s.default_suffix, "abc");
        assert_eq!(s.theme, Theme::Dark);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        fs::write(store.path(), "{not json").unwrap();
        assert_eq!(store.load(), AppSettings::default());
        assert!(dir.path().join("settings.json.invalid").exists());
    }

    #[test]
    fn wrong_enum_value_is_rejected_not_crashing() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        fs::write(
            store.path(),
            r#"{"theme": "neon", "defaultSuffix": "-kept"}"#,
        )
        .unwrap();
        let s = store.load();
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.default_suffix, "-kept", "other valid fields survive");
    }

    /// Must match DEFAULT_SETTINGS in src/types/settings.ts.
    #[test]
    fn frontend_default_settings_deserialize_exactly() {
        let ts = r##"{"version":1,"theme":"system","defaultOutputDir":null,"defaultOutputFormat":"source","defaultQuality":85,
          "defaultWatermarkAnchor":"bottomRight","defaultWatermarkOpacity":0.8,"defaultBackground":"#ffffff","defaultAspectRatio":"free",
          "defaultResizeMode":"fit","defaultSuffix":"","defaultConflict":"rename","confirmOverwrite":true,"includeSubfolders":false,
          "rememberLastExport":true,"lastExport":{},"limits":{"maxDimension":30000,"maxMegapixels":150},"concurrency":2,
          "scrolling":{"mouse":"system","trackpad":"system"}}"##;
        let parsed: AppSettings = serde_json::from_str(ts).unwrap();
        assert_eq!(parsed, AppSettings::default());
        // and the Rust defaults serialize to the same keys the frontend reads
        let back = serde_json::to_value(AppSettings::default()).unwrap();
        let expected: serde_json::Value = serde_json::from_str(ts).unwrap();
        assert_eq!(back, expected);
    }

    #[test]
    fn source_overwrite_is_never_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let mut s = AppSettings::default();
        s.last_export.insert(
            "crop".into(),
            ExportOptions {
                allow_source_overwrite: true,
                ..Default::default()
            },
        );
        let saved = store.save(&s).unwrap();
        assert!(!saved.last_export["crop"].allow_source_overwrite);
    }
}
