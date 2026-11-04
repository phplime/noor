use chrono::{DateTime, Duration, TimeZone, Utc};
use chrono_tz::Tz;
use nexa_widgets::apps::{scan_apps, AppEntry};
use nexa_widgets::lyrics::{current_line, lyrics_key, parse_lrc};
use nexa_widgets::settings::{IslandSettings, Module};
use nexa_widgets::timer::{StopwatchState, TimerState};
use nexa_widgets::water::{next_water_reminder, WaterReminderMode, WaterSettings, WaterState};
use nexa_widgets::*;

fn db() -> WidgetDb {
    WidgetDb::open_in_memory().unwrap()
}

#[test]
fn todos_crud_and_order() {
    let mut d = db();
    assert!(d.todo_add("   ").is_err());
    let a = d.todo_add("Buy milk").unwrap();
    let b = d.todo_add("Call Rahim").unwrap();
    let c = d.todo_add("Ship release").unwrap();
    d.todo_set_done(&a.id, true).unwrap();
    let list = d.todos().unwrap();
    assert_eq!(list.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["Call Rahim", "Ship release", "Buy milk"]);
    assert!(list[2].done_at.is_some());
    d.todo_reorder(&[c.id.clone(), b.id.clone()]).unwrap();
    assert_eq!(d.todos().unwrap()[0].id, c.id);
    d.todo_rename(&b.id, "Call Karim").unwrap();
    assert_eq!(d.todo_clear_done().unwrap(), 1);
    assert_eq!(d.todos().unwrap().len(), 2);
    assert!(d.todo_set_done("nope", true).is_err());
}

#[test]
fn clipboard_dedupes_trims_and_keeps_pins() {
    let d = db();
    assert!(!d.clip_add("   ", 3).unwrap());
    assert!(!d.clip_add(&"x".repeat(70_000), 3).unwrap());
    for t in ["one", "two", "three"] {
        d.clip_add(t, 3).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let one = d.clips("one", 10).unwrap()[0].id;
    d.clip_pin(one, true).unwrap();
    d.clip_add("four", 3).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    d.clip_add("five", 3).unwrap();
    let all: Vec<String> = d.clips("", 10).unwrap().into_iter().map(|c| c.text).collect();
    assert_eq!(all[0], "one", "pinned first");
    assert!(all.contains(&"five".into()) && all.len() == 4, "{all:?}");
    // Copying again moves to top.
    std::thread::sleep(std::time::Duration::from_millis(2));
    d.clip_add("four", 3).unwrap();
    assert_eq!(d.clips("", 10).unwrap()[1].text, "four");
    // LIKE wildcards are literal.
    d.clip_add("100% sure", 10).unwrap();
    assert_eq!(d.clips("%", 10).unwrap().len(), 1);
    d.clip_clear().unwrap();
    assert_eq!(d.clips("", 10).unwrap().len(), 1);
}

#[test]
fn water_totals_and_reminders() {
    let d = db();
    let tz: Tz = "Asia/Dhaka".parse().unwrap();
    let at = |h, m| tz.with_ymd_and_hms(2026, 10, 31, h, m, 0).unwrap().with_timezone(&Utc);
    d.water_add_at(250, at(9, 0)).unwrap();
    d.water_add_at(500, at(12, 0)).unwrap();
    d.water_add_at(300, at(23, 30) - Duration::days(1)).unwrap(); // yesterday
    let today = d.water_today(at(13, 0), tz, 2000).unwrap();
    assert_eq!(today.total_ml, 750);
    assert_eq!(today.week.len(), 7);
    assert_eq!(today.week[5].1, 300);
    d.water_undo(at(13, 0), tz).unwrap();
    assert_eq!(d.water_today(at(13, 0), tz, 2000).unwrap().total_ml, 250);

    let st = |now, drink: Option<DateTime<Utc>>, rem: Option<DateTime<Utc>>, total| WaterState { now, last_drink: drink, last_reminder: rem, today_total_ml: total };
    let due = |s: &WaterSettings, x: WaterState| next_water_reminder(s, x, tz).map(|d| d.at);

    // Interval mode.
    let s = WaterSettings { reminders: true, remind_every_min: 60, start: "09:00".into(), end: "21:00".into(), ..Default::default() };
    assert_eq!(due(&s, st(at(10, 0), Some(at(9, 30)), None, 250)), Some(at(10, 30)));
    assert_eq!(due(&s, st(at(6, 0), None, None, 0)), Some(at(10, 0)));
    assert_eq!(due(&s, st(at(15, 0), Some(at(11, 0)), None, 250)), Some(at(15, 0)), "overdue → now");
    assert_eq!(due(&s, st(at(15, 0), Some(at(11, 0)), Some(at(14, 30)), 250)), Some(at(15, 30)), "counts from last reminder");
    assert_eq!(due(&s, st(at(15, 0), Some(at(11, 0)), None, 2000)), Some(at(10, 0) + Duration::days(1)), "goal met");
    assert_eq!(due(&s, st(at(21, 30), Some(at(20, 0)), None, 250)), Some(at(10, 0) + Duration::days(1)), "after hours");
    let off = WaterSettings { reminders: false, ..s.clone() };
    assert_eq!(due(&off, st(at(10, 0), None, None, 0)), None);

    // Fixed times, each shown once.
    let t = WaterSettings { mode: WaterReminderMode::Times, times: vec!["13:00".into(), "09:00".into(), "11:00".into(), "bad".into()], ..s.clone() }.sanitized();
    assert_eq!(t.times, vec!["09:00", "11:00", "13:00"]);
    assert_eq!(due(&t, st(at(8, 0), None, None, 0)), Some(at(9, 0)));
    assert_eq!(due(&t, st(at(9, 5), None, None, 0)), Some(at(9, 0)), "just missed → still due (grace)");
    assert_eq!(due(&t, st(at(9, 5), None, Some(at(9, 0)), 0)), Some(at(11, 0)), "already shown");
    assert_eq!(due(&t, st(at(10, 0), None, None, 0)), Some(at(11, 0)), "older than grace → skipped");
    assert_eq!(due(&t, st(at(14, 0), None, Some(at(13, 0)), 0)), Some(at(9, 0) + Duration::days(1)));
    assert_eq!(due(&t, st(at(10, 0), None, None, 2000)), Some(at(9, 0) + Duration::days(1)), "goal met");

    // Smart: 2000 ml over 09:00–21:00 → ideal pace ~167 ml/h; reminds when half a glass behind.
    let sm = WaterSettings { mode: WaterReminderMode::Smart, min_gap_min: 30, glass_ml: 250, goal_ml: 2000, ..s.clone() };
    // Nothing drunk: first reminder at 09:45 (125 ml of pace), not earlier than start + gap.
    assert_eq!(due(&sm, st(at(8, 0), None, None, 0)), Some(at(9, 45)));
    // Drank 1000 ml by noon (ahead of pace): due when pace reaches 1125 ml → 15:45.
    assert_eq!(due(&sm, st(at(12, 0), Some(at(11, 50)), None, 1000)), Some(at(15, 45)));
    // Way behind at 15:00 with 250 ml (pace says 1000): due now, 750 ml behind.
    let d = next_water_reminder(&sm, st(at(15, 0), Some(at(9, 0)), None, 250), tz).unwrap();
    assert_eq!(d.at, at(15, 0));
    assert_eq!(d.behind_ml, 750);
    // …but not again within the gap after a reminder or a drink.
    assert_eq!(due(&sm, st(at(15, 0), Some(at(9, 0)), Some(at(14, 50)), 250)), Some(at(15, 20)));
    assert_eq!(due(&sm, st(at(15, 0), Some(at(14, 55)), None, 250)), Some(at(15, 25)));
}

#[test]
fn shelf_keeps_references() {
    let d = db();
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("Q3 Report.PDF");
    std::fs::write(&f, b"hello").unwrap();
    let paths = vec![f.to_string_lossy().into_owned(), dir.path().to_string_lossy().into_owned(), "relative.txt".into(), "/does/not/exist".into()];
    assert_eq!(d.shelf_add(&paths).unwrap(), 2);
    assert_eq!(d.shelf_add(&paths[..1]).unwrap(), 1, "re-adding refreshes, no duplicate");
    let items = d.shelf().unwrap();
    assert_eq!(items.len(), 2);
    let file = items.iter().find(|i| !i.is_dir).unwrap();
    assert_eq!((file.ext.as_str(), file.size, file.name.as_str()), ("pdf", 5, "Q3 Report.PDF"));
    std::fs::remove_file(&f).unwrap();
    assert!(!d.shelf().unwrap().iter().find(|i| !i.is_dir).unwrap().exists);
    d.shelf_clear().unwrap();
    assert!(d.shelf().unwrap().is_empty());
}

#[test]
fn apps_scan_and_pins() {
    let d = db();
    let dir = tempfile::tempdir().unwrap();
    for p in ["Safari.app", "Notes.app", "Adobe/Photoshop.app", "readme.txt"] {
        let path = dir.path().join(p);
        if p.ends_with(".app") {
            std::fs::create_dir_all(path).unwrap();
        } else {
            std::fs::write(path, b"").unwrap();
        }
    }
    let apps = scan_apps(&[dir.path().to_path_buf()]);
    assert_eq!(apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Notes", "Photoshop", "Safari"]);
    d.seed_apps(&apps).unwrap();
    let pinned = d.pinned_apps().unwrap();
    assert_eq!(pinned.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Safari", "Notes"]);
    assert!(d.pin_app(&AppEntry { name: "x".into(), path: "/tmp/x".into() }).is_err());
    d.unpin_app(&pinned[0].path).unwrap();
    d.seed_apps(&apps).unwrap();
    assert_eq!(d.pinned_apps().unwrap().len(), 1, "seeding happens once");
}

#[test]
fn clocks_resolve_offsets() {
    let d = db();
    d.seed_clocks().unwrap();
    assert_eq!(d.clocks().unwrap().len(), 4);
    assert!(d.clock_add("", "Mars/Olympus").is_err());
    let c = d.clock_add("", "America/Los_Angeles").unwrap();
    assert_eq!(c.label, "Los Angeles");
    let now: DateTime<Utc> = "2026-10-31T06:00:00Z".parse().unwrap();
    let r = clocks::resolve(&d.clocks().unwrap(), now, "Asia/Dhaka".parse().unwrap());
    let tokyo = r.iter().find(|x| x.clock.label == "Tokyo").unwrap();
    assert_eq!((tokyo.utc_offset_min, tokyo.diff_min), (540, 180));
    d.clock_delete(&c.id).unwrap();
    assert_eq!(d.clocks().unwrap().len(), 4);
}

#[test]
fn timer_and_stopwatch() {
    let mut t = TimerState::start(60_000, "Tea", 1_000);
    assert!(t.is_running());
    assert_eq!(t.remaining(31_000), 30_000);
    t.pause(31_000);
    assert!(t.is_paused());
    assert_eq!(t.remaining(99_000), 30_000);
    t.resume(100_000);
    assert_eq!(t.remaining(100_000), 30_000);
    t.add(60_000, 100_000);
    assert_eq!(t.remaining(100_000), 90_000);
    assert!(!t.is_due(189_999));
    assert!(t.is_due(190_000));
    t.notified = true;
    assert!(!t.is_due(200_000));
    t.reset();
    assert!(t.is_idle());

    let mut s = StopwatchState::default();
    s.start(0);
    s.lap(1500);
    s.stop(2000);
    assert_eq!(s.elapsed(9999), 2000);
    s.start(10_000);
    assert_eq!(s.elapsed(10_500), 2500);
    assert_eq!(s.laps, vec![1500]);
}

#[test]
fn lyrics_parse_and_cache() {
    let lrc = "[ar:Lumen Coast]\n[00:12.50]Hold the light a little longer\n[00:16.2][01:02.300]till the evening finds us here\n[00:20.00]\nnot a lyric line";
    let lines = parse_lrc(lrc);
    assert_eq!(lines.len(), 4);
    assert_eq!(lines[0].time_ms, 12_500);
    assert_eq!(lines[1].time_ms, 16_200);
    assert_eq!(lines[3].time_ms, 62_300);
    assert_eq!(lines[2].text, "");
    assert_eq!(current_line(&lines, 1_000), None);
    assert_eq!(current_line(&lines, 16_200), Some(1));
    assert_eq!(current_line(&lines, 99_000), Some(3));

    let d = db();
    let k = lyrics_key("Lumen Coast ", "Paper Sky");
    assert!(d.lyrics_cached(&k).unwrap().is_none());
    d.lyrics_store(&k, Some(lrc), Some("plain"), false, true).unwrap();
    let c = d.lyrics_cached(&k).unwrap().unwrap();
    assert!(c.found && c.synced.len() == 4);
}

#[test]
fn island_settings_sanitized() {
    let d = db();
    let mut s = d.island_settings().unwrap();
    assert_eq!(s.modules.len(), Module::ALL.len());
    s.modules = vec![Module::Todo, Module::Todo];
    s.default_module = Some(Module::Music);
    s.clipboard_max_items = 5;
    let s = d.set_island_settings(s).unwrap();
    assert_eq!(s.modules, vec![Module::Todo]);
    assert_eq!(s.default_module, None);
    assert_eq!(s.clipboard_max_items, 10);
    assert_eq!(d.island_settings().unwrap(), s);
    let empty = IslandSettings { modules: vec![], ..Default::default() }.sanitized();
    assert_eq!(empty.modules, vec![Module::Prayer]);
    // Settings saved by an older version (no Iphone module, no seen list) get the new tab once.
    let old: IslandSettings = serde_json::from_str(r#"{"modules":["music","prayer"]}"#).unwrap();
    let upgraded = old.sanitized();
    assert!(upgraded.modules.contains(&Module::Iphone));
    // …but if the user then hides it, it stays hidden.
    let hidden = IslandSettings { modules: vec![Module::Music], ..upgraded }.sanitized();
    assert_eq!(hidden.modules, vec![Module::Music]);
}
