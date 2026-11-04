use crate::settings::AppSettings;
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub arch: &'static str,
    pub os: &'static str,
    pub settings_path: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let cfg = app.config();
    AppInfo {
        name: cfg.product_name.clone().unwrap_or_else(|| "Noor".into()),
        version: app.package_info().version.to_string(),
        identifier: cfg.identifier.clone(),
        arch: std::env::consts::ARCH,
        os: std::env::consts::OS,
        settings_path: state.store.path().display().to_string(),
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let saved = state.store.save(&settings)?;
    *state.settings.lock().unwrap() = saved.clone();
    Ok(saved)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    // Resetting app preferences must not silently change the user's scrolling setup.
    let defaults = AppSettings {
        scrolling: state.settings.lock().unwrap().scrolling.clone(),
        ..AppSettings::default()
    };
    let saved = state.store.save(&defaults)?;
    *state.settings.lock().unwrap() = saved.clone();
    Ok(saved)
}

/// Folder where exports go when the platform has no "next to the original"
/// (iOS: `Documents/MacKit`, shown in the Files app under On My iPhone › MacKit).
#[tauri::command]
pub fn output_dir(app: AppHandle) -> Result<String, String> {
    // Android 11+: save straight into Pictures/Noor so exports show up in the Gallery.
    #[cfg(target_os = "android")]
    {
        let public = std::path::PathBuf::from("/storage/emulated/0/Pictures/Noor");
        let probe = public.join(".noor-probe.png");
        if std::fs::create_dir_all(&public).is_ok() && std::fs::write(&probe, b"ok").is_ok() {
            let _ = std::fs::remove_file(&probe);
            return Ok(public.display().to_string());
        }
    }
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("Noor");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}
