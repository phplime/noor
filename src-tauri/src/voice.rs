//! Notification language, editable notification texts and spoken alerts.
//!
//! Every alert Noor plans carries an [`Event`] (what happened, for which prayer, how many minutes).
//! The user's language decides the notification title, and on iPhone the same text can be
//! spoken: it is rendered to a short audio file ahead of time (see `ios_voice.rs`) and used as
//! the notification's sound, because iOS runs no app code when a notification fires.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// App language: Bangla, English, or the mixed "Banglish" style (English titles with Bangla).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Bn,
    En,
    #[default]
    Mix,
}

/// One editable text, in both languages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Text {
    pub bn: String,
    pub en: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSettings {
    pub lang: Lang,
    /// Speak notifications aloud on iPhone (the text becomes the alert sound).
    pub speak: bool,
    /// Which kinds of alerts are spoken (event ids). Empty = all.
    pub speak_events: Vec<String>,
    /// The user's own wording, by event id. Missing = default text.
    pub texts: BTreeMap<String, Text>,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self { lang: Lang::Mix, speak: true, speak_events: Vec::new(), texts: BTreeMap::new() }
    }
}

impl VoiceSettings {
    pub fn sanitized(mut self) -> Self {
        self.texts.retain(|k, v| {
            v.bn = v.bn.trim().chars().take(160).collect();
            v.en = v.en.trim().chars().take(160).collect();
            EVENTS.iter().any(|e| e.id == k) && !(v.bn.is_empty() && v.en.is_empty())
        });
        self.speak_events.retain(|id| EVENTS.iter().any(|e| e.id == id));
        self
    }

    pub fn text(&self, id: &str) -> Option<(String, String)> {
        let d = EVENTS.iter().find(|e| e.id == id)?;
        let custom = self.texts.get(id);
        let pick = |c: Option<&String>, def: &str| c.filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| def.to_string());
        Some((pick(custom.map(|t| &t.bn), d.bn), pick(custom.map(|t| &t.en), d.en)))
    }

    fn speaks(&self, id: &str) -> bool {
        self.speak && (self.speak_events.is_empty() || self.speak_events.iter().any(|e| e == id))
    }

    /// Language used for the spoken text: Banglish speaks Bangla.
    pub fn voice_lang(&self) -> Lang {
        if self.lang == Lang::En { Lang::En } else { Lang::Bn }
    }
}

/// What a notification is about.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: &'static str,
    /// Prayer key (fajr, dhuhr, …) when it is about a prayer.
    pub prayer: Option<String>,
    pub minutes: Option<i64>,
}

impl Event {
    pub fn new(id: &'static str) -> Self {
        Self { id, prayer: None, minutes: None }
    }
    pub fn prayer(id: &'static str, prayer: &str, minutes: Option<i64>) -> Self {
        Self { id, prayer: Some(prayer.to_string()), minutes }
    }
}

pub struct EventDef {
    pub id: &'static str,
    pub label: &'static str,
    pub bn: &'static str,
    pub en: &'static str,
    /// Placeholders the text may use.
    pub vars: &'static [&'static str],
}

/// Every alert whose wording the user can change. `{prayer}` (এশা), `{prayer_of}` (এশার) and `{min}` are filled in.
pub const EVENTS: &[EventDef] = &[
    EventDef { id: "prayer_start", label: "Prayer time starts", bn: "এখন {prayer_of} ওয়াক্ত শুরু হলো", en: "It's time for {prayer}", vars: &["prayer", "prayer_of"] },
    EventDef { id: "prayer_before", label: "Before a prayer starts", bn: "{prayer_of} ওয়াক্ত শুরু হতে {min} মিনিট বাকি", en: "{prayer} starts in {min} minutes", vars: &["prayer", "prayer_of", "min"] },
    EventDef { id: "prayer_after", label: "After a prayer started", bn: "{prayer_of} ওয়াক্ত শুরু হয়েছে {min} মিনিট আগে", en: "{prayer} started {min} minutes ago", vars: &["prayer", "prayer_of", "min"] },
    EventDef { id: "jamaat_before", label: "Before jamaat", bn: "{prayer_of} জামাত {min} মিনিট পর, অজু করে নিন", en: "{prayer} jamaat in {min} minutes", vars: &["prayer", "prayer_of", "min"] },
    EventDef { id: "jamaat", label: "Jamaat starts", bn: "এখন {prayer_of} জামাত শুরু", en: "{prayer} jamaat is starting now", vars: &["prayer", "prayer_of"] },
    EventDef { id: "sunrise", label: "Sunrise", bn: "সূর্যোদয় হয়েছে, ফজরের সময় শেষ", en: "Sunrise. Fajr time is over", vars: &[] },
    EventDef { id: "makruh_start", label: "No-salah time starts", bn: "এখন নামাজের নিষিদ্ধ সময় শুরু", en: "No-salah time has started", vars: &[] },
    EventDef { id: "makruh_end", label: "No-salah time ends", bn: "নিষিদ্ধ সময় শেষ, এখন নামাজ পড়া যাবে", en: "No-salah time is over, you can pray now", vars: &[] },
    EventDef { id: "sehri_wake", label: "Sehri wake-up", bn: "সেহরির সময় হয়েছে, উঠুন", en: "Wake up, it's time for Sehri", vars: &[] },
    EventDef { id: "sehri_before", label: "Before Sehri ends", bn: "সেহরির সময় শেষ হতে {min} মিনিট বাকি", en: "Sehri ends in {min} minutes", vars: &["min"] },
    EventDef { id: "sehri_end", label: "Sehri ends", bn: "সেহরির সময় শেষ, এখন থেকে রোজা শুরু", en: "Sehri time is over. Your fast begins", vars: &[] },
    EventDef { id: "iftar_before", label: "Before Iftar", bn: "ইফতারের {min} মিনিট বাকি", en: "Iftar in {min} minutes", vars: &["min"] },
    EventDef { id: "iftar", label: "Iftar time", bn: "ইফতারের সময় হয়েছে", en: "It's time for Iftar", vars: &[] },
];

/// (name, possessive) — "এশা" / "এশার"; English uses the name for both.
pub fn prayer_name(key: &str, lang: Lang) -> (&'static str, &'static str) {
    let (bn, bn_of, en) = match key {
        "fajr" => ("ফজর", "ফজরের", "Fajr"),
        "sunrise" => ("সূর্যোদয়", "সূর্যোদয়ের", "Sunrise"),
        "dhuhr" => ("যোহর", "যোহরের", "Dhuhr"),
        "asr" => ("আসর", "আসরের", "Asr"),
        "maghrib" => ("মাগরিব", "মাগরিবের", "Maghrib"),
        "isha" => ("এশা", "এশার", "Isha"),
        "jumuah" => ("জুমা", "জুমার", "Jumu'ah"),
        _ => ("নামাজ", "নামাজের", "Prayer"),
    };
    if lang == Lang::En { (en, en) } else { (bn, bn_of) }
}

fn bn_digits(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_digit() { char::from_u32(0x09E6 + c.to_digit(10).unwrap()).unwrap() } else { c }).collect()
}

/// Fill `{prayer}`, `{prayer_of}` and `{min}`.
pub fn render(template: &str, ev: &Event, lang: Lang) -> String {
    let mut s = template.to_string();
    if let Some(p) = &ev.prayer {
        let (name, of) = prayer_name(p, lang);
        s = s.replace("{prayer_of}", of).replace("{prayer}", name);
    }
    if let Some(m) = ev.minutes {
        let m = m.abs().to_string();
        s = s.replace("{min}", &if lang == Lang::En { m } else { bn_digits(&m) });
    }
    s
}

/// Title and spoken text for an event under these settings.
/// `title` is `None` for the Banglish style, which keeps Noor's original titles.
pub fn apply(s: &VoiceSettings, ev: &Event) -> (Option<String>, Option<String>) {
    let Some((bn, en)) = s.text(ev.id) else { return (None, None) };
    let title = match s.lang {
        Lang::Bn => Some(render(&bn, ev, Lang::Bn)),
        Lang::En => Some(render(&en, ev, Lang::En)),
        Lang::Mix => None,
    };
    let speak = s.speaks(ev.id).then(|| match s.voice_lang() {
        Lang::En => render(&en, ev, Lang::En),
        _ => render(&bn, ev, Lang::Bn),
    });
    (title, speak)
}

/// Short, stable file name for a spoken text (`noor_v_<hash>.caf`).
pub fn audio_name(lang: Lang, text: &str) -> String {
    // FNV-1a, 64-bit
    let mut h: u64 = 0xcbf29ce484222325;
    for b in format!("{lang:?}|{text}").bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("noor_v_{h:016x}.caf")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bangla_title_and_voice() {
        let s = VoiceSettings { lang: Lang::Bn, ..Default::default() };
        let (t, v) = apply(&s, &Event::prayer("prayer_start", "isha", None));
        assert_eq!(t.as_deref(), Some("এখন এশার ওয়াক্ত শুরু হলো"));
        assert_eq!(v, t);
        let (t, _) = apply(&s, &Event::prayer("jamaat_before", "dhuhr", Some(10)));
        assert_eq!(t.as_deref(), Some("যোহরের জামাত ১০ মিনিট পর, অজু করে নিন"));
    }

    #[test]
    fn english_and_mix() {
        let en = VoiceSettings { lang: Lang::En, ..Default::default() };
        let (t, v) = apply(&en, &Event::prayer("jamaat", "maghrib", None));
        assert_eq!(t.as_deref(), Some("Maghrib jamaat is starting now"));
        assert_eq!(v.as_deref(), Some("Maghrib jamaat is starting now"));
        let mix = VoiceSettings::default();
        let (t, v) = apply(&mix, &Event::new("iftar"));
        assert_eq!(t, None, "Banglish keeps the original title");
        assert_eq!(v.as_deref(), Some("ইফতারের সময় হয়েছে"), "and speaks Bangla");
    }

    #[test]
    fn custom_text_and_speak_filter() {
        let mut s = VoiceSettings { lang: Lang::Bn, speak_events: vec!["jamaat".into()], ..Default::default() };
        s.texts.insert("prayer_start".into(), Text { bn: "{prayer_of} আজান হয়েছে".into(), en: String::new() });
        let s = s.sanitized();
        let (t, v) = apply(&s, &Event::prayer("prayer_start", "asr", None));
        assert_eq!(t.as_deref(), Some("আসরের আজান হয়েছে"));
        assert_eq!(v, None, "only jamaat is spoken");
        assert_ne!(audio_name(Lang::Bn, "a"), audio_name(Lang::En, "a"));
    }
}

// ----- storage, audio files, commands ------------------------------------------

pub fn settings_of(db: &nexa_widgets::WidgetDb) -> VoiceSettings {
    db.get_json::<VoiceSettings>("voice").ok().flatten().unwrap_or_default().sanitized()
}

/// `Library/Sounds`, where iOS looks for custom notification sounds.
pub fn sounds_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Library").join("Sounds"))
}

/// Make sure every spoken text has its audio file and point the notification at it.
/// Files no longer needed are removed. Runs on the scheduler thread (rendering blocks).
pub fn prepare_audio(plan: &mut [crate::notify::Planned], lang: Lang) {
    if !cfg!(target_os = "ios") {
        return;
    }
    let Some(dir) = sounds_dir() else { return };
    let code = if lang == Lang::En { "en" } else { "bn" };
    let mut keep = std::collections::HashSet::new();
    // After one failure (no voice installed, or rendering timed out) don't try again this round:
    // those alerts keep their normal ring and the schedule isn't held up.
    let mut can_render = true;
    for p in plan.iter_mut() {
        let Some(text) = p.speak.clone() else { continue };
        let name = audio_name(lang, &text);
        let path = dir.join(&name);
        let ok = path.exists() || (can_render && crate::ios_voice::render(&text, code, &path));
        if ok {
            p.sound = format!("voice:{name}");
            keep.insert(name);
        } else {
            can_render = false;
        }
    }
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("noor_v_") && !keep.contains(&n) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub bn: &'static str,
    pub en: &'static str,
    pub vars: &'static [&'static str],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub settings: VoiceSettings,
    pub events: Vec<EventInfo>,
    /// Installed voices on this phone (iPhone only).
    pub has_bn: bool,
    pub has_en: bool,
    pub ios: bool,
}

#[tauri::command]
pub async fn voice_get(state: tauri::State<'_, crate::island_state::IslandState>) -> Result<VoiceInfo, String> {
    let settings = {
        let db = state.wdb.lock().map_err(|e| e.to_string())?;
        settings_of(&db)
    };
    let (has_bn, has_en) = tauri::async_runtime::spawn_blocking(crate::ios_voice::voices).await.unwrap_or((false, false));
    Ok(VoiceInfo {
        settings,
        events: EVENTS.iter().map(|e| EventInfo { id: e.id, label: e.label, bn: e.bn, en: e.en, vars: e.vars }).collect(),
        has_bn,
        has_en,
        ios: cfg!(target_os = "ios"),
    })
}

#[tauri::command]
pub fn voice_save(app: tauri::AppHandle, state: tauri::State<'_, crate::island_state::IslandState>, settings: VoiceSettings) -> Result<VoiceSettings, String> {
    let s = settings.sanitized();
    state.wdb.lock().map_err(|e| e.to_string())?.set_json("voice", &s).map_err(|e| e.to_string())?;
    state.refresh_scheduler();
    use tauri::Emitter;
    let _ = app.emit("noor:voice", ());
    Ok(s)
}

/// Send a test notification in 5 seconds that speaks `text` (iPhone) — what the real alert will sound like.
#[tauri::command]
pub async fn voice_test(app: tauri::AppHandle, text: String, lang: Lang) -> Result<bool, String> {
    let text: String = text.trim().chars().take(160).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut p = crate::notify::Planned {
            kind: "test".into(),
            route: "today".into(),
            fire_at: chrono::Utc::now() + chrono::Duration::seconds(5),
            title: text.clone(),
            body: "Noor · test".into(),
            sound: "noor_chime".into(),
            speak: Some(text),
            ..Default::default()
        };
        let mut one = [p.clone()];
        prepare_audio(&mut one, lang);
        let spoken = one[0].sound.starts_with("voice:");
        p.sound = one[0].sound.clone();
        crate::notify::send_test(&app, &p).map(|_| spoken)
    })
    .await
    .map_err(|e| e.to_string())?
}
