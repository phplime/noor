//! Commands for the everyday modules: to-do, water, world clocks, timer,
//! stopwatch (ported from Nexa Island) and personal reminders (new in Noor).

use crate::island_state::{local_tz, IslandState as AppState};
use nexa_widgets::clocks::{self, ClockNow};
use nexa_widgets::now_ms;
use nexa_widgets::places::{statuses, Place, PlaceInput, PlaceStatus};
use nexa_widgets::reminders::{Reminder, ReminderInput};
use nexa_widgets::settings::IslandSettings;
use nexa_widgets::timer::{StopwatchState, TimerState};
use nexa_widgets::todo::Todo;
use nexa_widgets::water::WaterToday;
use tauri::{AppHandle, Emitter, State};

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

macro_rules! db {
    ($state:expr) => {
        $state.wdb.lock().map_err(|_| "storage unavailable".to_string())?
    };
}

fn changed(app: &AppHandle, module: &str) {
    let _ = app.emit("widgets://changed", module);
}

// ----- settings (water goal & reminders, 24-hour clock …) -------------------

#[tauri::command]
pub fn island_settings(state: State<'_, AppState>) -> R<IslandSettings> {
    db!(state).island_settings().map_err(e)
}

#[tauri::command]
pub fn save_island_settings(app: AppHandle, state: State<'_, AppState>, settings: IslandSettings) -> R<IslandSettings> {
    let saved = db!(state).set_island_settings(settings).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "settings");
    changed(&app, "water");
    Ok(saved)
}

// ----- to-do ----------------------------------------------------------------

#[tauri::command]
pub fn todo_list(state: State<'_, AppState>) -> R<Vec<Todo>> {
    db!(state).todos().map_err(e)
}

#[tauri::command]
pub fn todo_add(app: AppHandle, state: State<'_, AppState>, title: String) -> R<Todo> {
    let t = db!(state).todo_add(&title).map_err(e)?;
    changed(&app, "todo");
    Ok(t)
}

#[tauri::command]
pub fn todo_set_done(app: AppHandle, state: State<'_, AppState>, id: String, done: bool) -> R<()> {
    db!(state).todo_set_done(&id, done).map_err(e)?;
    changed(&app, "todo");
    Ok(())
}

#[tauri::command]
pub fn todo_rename(app: AppHandle, state: State<'_, AppState>, id: String, title: String) -> R<()> {
    db!(state).todo_rename(&id, &title).map_err(e)?;
    changed(&app, "todo");
    Ok(())
}

#[tauri::command]
pub fn todo_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    db!(state).todo_delete(&id).map_err(e)?;
    changed(&app, "todo");
    Ok(())
}

#[tauri::command]
pub fn todo_clear_done(app: AppHandle, state: State<'_, AppState>) -> R<usize> {
    let n = db!(state).todo_clear_done().map_err(e)?;
    changed(&app, "todo");
    Ok(n)
}

#[tauri::command]
pub fn todo_reorder(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>) -> R<()> {
    db!(state).todo_reorder(&ids).map_err(e)?;
    changed(&app, "todo");
    Ok(())
}

// ----- water ----------------------------------------------------------------

#[tauri::command]
pub fn water_today(state: State<'_, AppState>) -> R<WaterToday> {
    let db = db!(state);
    let goal = db.island_settings().map_err(e)?.water.goal_ml;
    db.water_today(chrono::Utc::now(), local_tz(), goal).map_err(e)
}

#[tauri::command]
pub fn water_add(app: AppHandle, state: State<'_, AppState>, ml: i64) -> R<()> {
    db!(state).water_add(ml).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "water");
    Ok(())
}

#[tauri::command]
pub fn water_undo(app: AppHandle, state: State<'_, AppState>) -> R<()> {
    db!(state).water_undo(chrono::Utc::now(), local_tz()).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "water");
    Ok(())
}

// ----- world clocks ---------------------------------------------------------

#[tauri::command]
pub fn clocks_list(state: State<'_, AppState>) -> R<Vec<ClockNow>> {
    let list = db!(state).clocks().map_err(e)?;
    Ok(clocks::resolve(&list, chrono::Utc::now(), local_tz()))
}

#[tauri::command]
pub fn clock_add(app: AppHandle, state: State<'_, AppState>, label: String, timezone: String) -> R<()> {
    db!(state).clock_add(&label, &timezone).map_err(e)?;
    changed(&app, "clock");
    Ok(())
}

#[tauri::command]
pub fn clock_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    db!(state).clock_delete(&id).map_err(e)?;
    changed(&app, "clock");
    Ok(())
}

// ----- timer & stopwatch ----------------------------------------------------

fn save_timer(app: &AppHandle, state: &AppState, t: &TimerState) -> R<TimerState> {
    db!(state).set_json("timer", t).map_err(e)?;
    state.refresh_scheduler();
    changed(app, "timer");
    Ok(t.clone())
}

fn load_timer(state: &AppState) -> R<TimerState> {
    Ok(db!(state).get_json("timer").map_err(e)?.unwrap_or_default())
}

#[tauri::command]
pub fn timer_get(state: State<'_, AppState>) -> R<TimerState> {
    load_timer(&state)
}

#[tauri::command]
pub fn timer_start(app: AppHandle, state: State<'_, AppState>, duration_ms: i64, label: Option<String>) -> R<TimerState> {
    let t = TimerState::start(duration_ms, label.as_deref().unwrap_or(""), now_ms());
    save_timer(&app, &state, &t)
}

#[tauri::command]
pub fn timer_action(app: AppHandle, state: State<'_, AppState>, action: String, ms: Option<i64>) -> R<TimerState> {
    let mut t = load_timer(&state)?;
    let now = now_ms();
    match action.as_str() {
        "pause" => t.pause(now),
        "resume" => t.resume(now),
        "add" => t.add(ms.unwrap_or(60_000), now),
        "reset" => t.reset(),
        _ => return Err("unknown timer action".into()),
    }
    save_timer(&app, &state, &t)
}

#[tauri::command]
pub fn stopwatch_get(state: State<'_, AppState>) -> R<StopwatchState> {
    Ok(db!(state).get_json("stopwatch").map_err(e)?.unwrap_or_default())
}

#[tauri::command]
pub fn stopwatch_action(app: AppHandle, state: State<'_, AppState>, action: String) -> R<StopwatchState> {
    let db = db!(state);
    let mut s: StopwatchState = db.get_json("stopwatch").map_err(e)?.unwrap_or_default();
    let now = now_ms();
    match action.as_str() {
        "start" => s.start(now),
        "stop" => s.stop(now),
        "lap" => s.lap(now),
        "reset" => s.reset(),
        _ => return Err("unknown stopwatch action".into()),
    }
    db.set_json("stopwatch", &s).map_err(e)?;
    drop(db);
    changed(&app, "stopwatch");
    Ok(s)
}

// ----- personal reminders ---------------------------------------------------

#[tauri::command]
pub fn reminder_list(state: State<'_, AppState>) -> R<Vec<Reminder>> {
    db!(state).reminders().map_err(e)
}

#[tauri::command]
pub fn reminder_save(app: AppHandle, state: State<'_, AppState>, reminder: ReminderInput) -> R<Reminder> {
    let r = db!(state).reminder_save(reminder).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "reminders");
    Ok(r)
}

#[tauri::command]
pub fn reminder_set_enabled(app: AppHandle, state: State<'_, AppState>, id: String, enabled: bool) -> R<()> {
    db!(state).reminder_set_enabled(&id, enabled).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "reminders");
    Ok(())
}

#[tauri::command]
pub fn reminder_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    db!(state).reminder_delete(&id).map_err(e)?;
    state.refresh_scheduler();
    changed(&app, "reminders");
    Ok(())
}

// ----- quiet places ---------------------------------------------------------

#[tauri::command]
pub fn place_list(state: State<'_, AppState>) -> R<Vec<Place>> {
    db!(state).places().map_err(e)
}

#[tauri::command]
pub fn place_save(app: AppHandle, state: State<'_, AppState>, place: PlaceInput) -> R<Place> {
    let p = db!(state).place_save(place).map_err(e)?;
    changed(&app, "places");
    Ok(p)
}

#[tauri::command]
pub fn place_set_automated(app: AppHandle, state: State<'_, AppState>, id: String, automated: bool) -> R<()> {
    db!(state).place_set_automated(&id, automated).map_err(e)?;
    changed(&app, "places");
    Ok(())
}

#[tauri::command]
pub fn place_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> R<()> {
    db!(state).place_delete(&id).map_err(e)?;
    changed(&app, "places");
    Ok(())
}

/// Distance to every saved place from a position, and whether it is inside each radius.
#[tauri::command]
pub fn place_status(state: State<'_, AppState>, latitude: f64, longitude: f64) -> R<Vec<PlaceStatus>> {
    let places = db!(state).places().map_err(e)?;
    Ok(statuses(&places, latitude, longitude))
}
