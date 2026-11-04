use crate::notes::NotesStore;
use crate::scroll::ScrollController;
use crate::settings::{AppSettings, SettingsStore};
use mackit_core::geometry::Limits;
use mackit_core::preview::PreviewCache;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub store: SettingsStore,
    pub previews: Arc<PreviewCache>,
    pub jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub scroll: ScrollController,
    pub notes: NotesStore,
}

impl AppState {
    pub fn new(store: SettingsStore, notes: NotesStore) -> Self {
        let settings = store.load();
        AppState {
            settings: Mutex::new(settings),
            store,
            // Downscaled preview sources up to 2048 px, at most 6 kept (~100 MB worst case).
            previews: Arc::new(PreviewCache::new(2048, 6)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            scroll: ScrollController::new(),
            notes,
        }
    }

    pub fn limits(&self) -> Limits {
        self.settings.lock().unwrap().limits
    }

    pub fn concurrency(&self) -> usize {
        self.settings.lock().unwrap().concurrency
    }
}
