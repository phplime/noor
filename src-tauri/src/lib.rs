//! Noor — one app for iPhone that brings together
//!   * MacKit's photo tools and notes (crates/mackit-core + commands/, notes, settings)
//!   * Nexa Island's prayer times, water, timer, world clock and to-do
//!     (crates/nexa-prayer, crates/nexa-widgets + prayer_cmds, widgets_cmds)
//!   * personal reminders and scheduled local notifications with sound (notify)

mod backup;
mod commands;
mod ios_live;
mod ios_motion;
mod ios_share;
mod island_state;
pub mod notes;
mod noor;
mod notify;
mod prayer_cmds;
pub mod scroll;
pub mod settings;
mod state;
mod widgets_cmds;

use island_state::IslandState;
use nexa_prayer::{PrayerService, Store};
use nexa_widgets::WidgetDb;
use settings::SettingsStore;
use state::AppState;
use std::sync::{mpsc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // ----- MacKit: settings + notes (JSON files) -------------------------
            let config_dir = app.path().app_config_dir()?;
            app.manage(AppState::new(
                SettingsStore::new(config_dir.clone()),
                notes::NotesStore::new(notes::notes_dir(&config_dir)),
            ));

            // ----- Nexa Island: prayer engine + widgets (one SQLite file) -------
            let db = app.path().app_data_dir()?.join("noor.sqlite");
            let system_tz = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
            let store = Store::open(&db).map_err(|e| format!("cannot open {}: {e}", db.display()))?;
            let svc = PrayerService::new(store, &system_tz).map_err(|e| e.to_string())?;
            let wdb = WidgetDb::open(&db).map_err(|e| format!("cannot open {}: {e}", db.display()))?;
            let _ = wdb.seed_clocks();

            let (tx, rx) = mpsc::channel();
            app.manage(IslandState {
                svc: Mutex::new(svc),
                wdb: Mutex::new(wdb),
                scheduler: Mutex::new(tx),
            });

            // ----- notifications ------------------------------------------------
            notify::install_sounds(&handle);
            notify::spawn(handle.clone(), rx);
            app.state::<IslandState>().refresh_scheduler();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // MacKit
            commands::app::app_info,
            commands::app::output_dir,
            commands::app::get_settings,
            commands::app::save_settings,
            commands::app::reset_settings,
            commands::images::scan_inputs,
            commands::images::import_image,
            commands::images::thumbnail,
            commands::images::render_preview,
            commands::images::plan_operations,
            commands::images::preflight_batch,
            commands::images::measure_output,
            commands::images::start_batch,
            commands::images::cancel_batch,
            commands::images::check_path,
            commands::images::clear_preview_cache,
            commands::creative::notes_load,
            commands::creative::notes_save,
            commands::creative::export_collage,
            commands::creative::save_image_bytes,
            // Prayer times
            prayer_cmds::prayer_snapshot,
            prayer_cmds::prayer_schedule,
            prayer_cmds::prayer_month,
            prayer_cmds::prayer_upcoming,
            prayer_cmds::save_calculation,
            prayer_cmds::save_manual,
            prayer_cmds::save_display,
            prayer_cmds::save_notifications,
            prayer_cmds::prayer_adjust,
            prayer_cmds::new_reminder,
            prayer_cmds::location_search,
            prayer_cmds::location_save,
            prayer_cmds::location_delete,
            prayer_cmds::location_set_active,
            prayer_cmds::location_set_device,
            prayer_cmds::location_set_mode,
            prayer_cmds::timezones,
            // Everyday modules
            widgets_cmds::island_settings,
            widgets_cmds::save_island_settings,
            widgets_cmds::todo_list,
            widgets_cmds::todo_add,
            widgets_cmds::todo_set_done,
            widgets_cmds::todo_rename,
            widgets_cmds::todo_delete,
            widgets_cmds::todo_clear_done,
            widgets_cmds::todo_reorder,
            widgets_cmds::water_today,
            widgets_cmds::water_add,
            widgets_cmds::water_undo,
            widgets_cmds::clocks_list,
            widgets_cmds::clock_add,
            widgets_cmds::clock_delete,
            widgets_cmds::timer_get,
            widgets_cmds::timer_start,
            widgets_cmds::timer_action,
            widgets_cmds::stopwatch_get,
            widgets_cmds::stopwatch_action,
            widgets_cmds::reminder_list,
            widgets_cmds::reminder_save,
            widgets_cmds::reminder_set_enabled,
            widgets_cmds::reminder_delete,
            widgets_cmds::place_list,
            widgets_cmds::place_save,
            widgets_cmds::place_set_automated,
            widgets_cmds::place_delete,
            widgets_cmds::place_status,
            // Notifications
            noor::calendar_settings,
            noor::calendar_save_settings,
            noor::calendar_month,
            noor::calendar_day,
            noor::calendar_upcoming,
            noor::special_list,
            noor::special_save,
            noor::special_delete,
            noor::profile_get,
            noor::profile_save,
            noor::ramadan_settings,
            noor::ramadan_save_settings,
            noor::ramadan_status,
            noor::cycle_get,
            noor::cycle_save,
            noor::cycle_status,
            ios_share::save_to_photos,
            ios_share::share_files,
            ios_live::live_activity,
            ios_live::live_activity_supported,
            backup::backup_export,
            backup::backup_import,
            noor::fitness_get,
            noor::fitness_save_profile,
            noor::fitness_log_weight,
            noor::fitness_set_steps,
            noor::fitness_sync_steps,
            noor::fitness_motion_available,
            noor::fitness_report,
            noor::salah_overview,
            noor::salah_set,
            noor::qaza_save,
            noor::qaza_made_up,
            notify::notify_sounds,
            notify::notify_upcoming,
            notify::notify_refresh,
            notify::notify_permission,
            notify::notify_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noor");
}
