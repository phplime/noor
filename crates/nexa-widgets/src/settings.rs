//! Island-wide settings: which modules appear and how.

use crate::db::{WidgetDb, WidgetResult};
use crate::water::WaterSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Module {
    Music,
    Timer,
    Clock,
    Water,
    Todo,
    Shelf,
    Clipboard,
    Apps,
    Prayer,
    Iphone,
}

impl Module {
    pub const ALL: [Module; 10] = [
        Module::Music,
        Module::Timer,
        Module::Clock,
        Module::Water,
        Module::Todo,
        Module::Shelf,
        Module::Clipboard,
        Module::Apps,
        Module::Prayer,
        Module::Iphone,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {
    /// Enabled modules, in tab order.
    pub modules: Vec<Module>,
    /// Tab shown when the island opens (None = last used).
    pub default_module: Option<Module>,
    /// Open the island when the pointer rests on it (closes again when it leaves).
    pub expand_on_hover: bool,
    /// Compact island shows what's playing when music plays.
    pub compact_music: bool,
    pub clipboard_history: bool,
    pub clipboard_max_items: u32,
    pub music_lyrics: bool,
    pub use_24_hour: bool,
    pub water: WaterSettings,
    /// Where photos received from an iPhone are saved (None = ~/Downloads/Nexa Island).
    pub iphone_folder: Option<String>,
    /// Add received photos to the shelf.
    pub iphone_to_shelf: bool,
    /// Last tab the user looked at.
    pub last_module: Option<Module>,
    /// Modules the user has already been offered; new modules from app
    /// updates are switched on once, then respect the user's choice.
    /// (Missing in older saved settings → empty → every new module is added.)
    #[serde(default)]
    pub seen_modules: Vec<Module>,
}

impl Default for IslandSettings {
    fn default() -> Self {
        Self {
            modules: Module::ALL.to_vec(),
            default_module: None,
            expand_on_hover: true,
            compact_music: true,
            clipboard_history: true,
            clipboard_max_items: 200,
            music_lyrics: true,
            use_24_hour: true,
            water: WaterSettings::default(),
            iphone_folder: None,
            iphone_to_shelf: true,
            last_module: None,
            seen_modules: Module::ALL.to_vec(),
        }
    }
}

impl IslandSettings {
    pub fn sanitized(mut self) -> Self {
        // Turn on modules added by an update (inserted at their natural position).
        for m in Module::ALL {
            if !self.seen_modules.contains(&m) && !self.modules.contains(&m) {
                self.modules.push(m);
            }
        }
        self.seen_modules = Module::ALL.to_vec();
        let mut seen = std::collections::HashSet::new();
        self.modules.retain(|m| seen.insert(*m));
        if self.modules.is_empty() {
            self.modules = vec![Module::Prayer];
        }
        if self.default_module.is_some_and(|m| !self.modules.contains(&m)) {
            self.default_module = None;
        }
        self.clipboard_max_items = self.clipboard_max_items.clamp(10, 1000);
        self.water = self.water.sanitized();
        if self.iphone_folder.as_deref().is_some_and(|f| f.trim().is_empty()) {
            self.iphone_folder = None;
        }
        self
    }
}

impl WidgetDb {
    pub fn island_settings(&self) -> WidgetResult<IslandSettings> {
        Ok(self.get_json::<IslandSettings>("island.settings")?.unwrap_or_default().sanitized())
    }

    pub fn set_island_settings(&self, s: IslandSettings) -> WidgetResult<IslandSettings> {
        let s = s.sanitized();
        self.set_json("island.settings", &s)?;
        Ok(s)
    }
}
