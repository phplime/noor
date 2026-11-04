# Noor ✨ — نور

**Prayer times, gentle reminders and a private photo studio — for iPhone.**

Noor merges your two Mac apps into one iPhone app, built with the same stack
(**Tauri 2 + React/TypeScript + Rust**) and reusing their engines unchanged:

| From | What's in Noor |
| --- | --- |
| **Nexa Island** (`~/Herd/macisland`) | Prayer engine (12 methods, Hanafi/Standard Asr, high-latitude rules, offsets, fixed mosque times, offline city search, device location), multiple reminders per prayer with sounds, water tracker + smart reminders, timer & stopwatch, world clocks, to-do. The island's live activity lives on as a slim **mini timer bar** above the tab bar while a timer runs. |
| **MacKit** (`~/Herd/mackit`) | The whole image engine and every iOS-capable tool: Watermark, Crop, Resize & Canvas, Batch, Compression, Format Converter, Adjust & Enhance, Remove Background (Apple Vision), Photo Collage, Facebook Post, Notes. |
| **Home** | Your name + photo, today's date in **English, বাংলা and العربية**, public holidays and Islamic occasions highlighted, next prayer, Ramadan card, upcoming special days, **My photos**, today-at-a-glance. Every card can be switched off or reordered (*Customize Home*). |
| **Island menu** | Floating pill navigation (Home · Prayer · Calendar · Routine · Studio); the active tab expands with its label. Settings is the gear on Home. |
| **Calendar** | Month grid showing Gregorian + Bangla + Hijri day numbers, markers for holidays / Islamic days / Sunnah fasts / your own days, a day panel in three languages, and **special days** (birthdays, anniversaries, any Hijri date) that repeat yearly with an alert (on the day or up to a week before, with sound). |
| **Ramadan sync** | Settings › Ramadan, or tap the Ramadan card. Every year Noor works out when Ramadan starts and schedules **wake-up, "Sehri ends soon", "Iftar soon" and Iftar** alerts from your own prayer settings. Set the real start date when the moon is announced; a full Sehri/Iftar timetable is included. |
| **Quiet places** (Routine › Places) | Pin places on an OpenStreetMap map (default 500 m radius, shown as a circle), see how far you are and whether you're inside, then follow a built-in guide to make iOS switch Do Not Disturb on arrival / off on leaving. See *Quiet places* below. |
| **New in Noor** | iOS **scheduled notifications with sound** (they ring when the app is closed / the phone is locked), personal **Reminders** (once / daily / weekdays / weekly / monthly), **Qibla compass**, Hijri date, month timetable, onboarding, 7 bundled notification sounds. |

Not ported (macOS-only by nature): mouse scrolling, Spotify/Music control, clipboard history, file shelf, quick-launch apps, iPhone ⇄ Mac transfer.

## Run it on your iPhone

**You need full Xcode** (free from the Mac App Store). The Command Line Tools alone are not enough.

```bash
cd ~/Herd/noor
npm run ios:sim               # Simulator — checks everything, creates the Xcode project on first run
npm run ios:dev               # your iPhone (plugged in, unlocked)
```

`scripts/ios-run.sh` checks Xcode, the iOS platform and the Rust targets first and tells you exactly what's missing.

First time on a real iPhone: add your Apple ID in **Xcode › Settings › Accounts**, turn on
**Developer Mode** on the phone, and pick your team when Tauri asks (or set
`APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX`). With a free Apple ID the app stops opening after
7 days — run `npm run ios:dev` again. A paid developer account gives 1-year installs + TestFlight.

Preview the UI in a browser with sample data (no Xcode needed):

```bash
npm run dev:mock    # → http://localhost:1440 (use the iPhone view in Safari/Chrome dev tools)
```

## Calendar, holidays & Ramadan — how accurate is it?

* **Bangla dates** follow Bangladesh's revised calendar (Pohela Boishakh = 14 April, six months of 31 days, Falgun 29/30). Verified against known dates in the Rust and TypeScript tests.
* **Hijri dates** are computed arithmetically (within a day of Umm al-Qura). Real months start with moon sighting, so *Settings › Calendar & holidays* has a −2…+2 day correction (Bangladesh is usually −1). Eid, Shab-e-Barat, Shab-e-Qadr, Ashura and the Ramadan start all follow it.
* **Fixed national days** (21 Feb, 26 Mar, 14 Apr, 1 May, 5 Aug, 16 Dec, 25 Dec) are built in. Moon-dependent holidays are estimates — check the official gazette each year and adjust.
* **Ramadan alerts** are queued with the other notifications (iOS keeps 64). During Ramadan Noor keeps only the at-time prayer alerts so Sehri/Iftar reach about a week ahead; the queue refreshes every time you open the app.
* Notification sounds follow the Ring/Silent switch and Focus. For an alarm that must wake you, also set one in the Clock app (the Ramadan page shows the time).
* **Widgets:** the Home cards are Noor's in-app widgets. Real iPhone Home-Screen/Lock-Screen widgets need a native WidgetKit extension (Swift) — not included yet.

## Quiet places — what's automatic and what isn't

iOS does not let any app change the Silent switch or Do Not Disturb. Only the Shortcuts app and Focus can do that
automatically. So Noor stores your places + radius (SQLite table `quiet_places`), draws them on the map, shows live distance
("You're inside" / "320 m away") and, for each place, shows the exact steps for either
**Shortcuts** (Arrive/Leave automation + *Set Focus*, honours your radius) or **Focus** (location schedule, simplest).
That is a one-time minute per place; after that iOS does it by itself, even when Noor is closed. Mark "I've set it up" to keep track.
Map tiles come from OpenStreetMap (needs a connection; pins and circles work offline).

## How notifications work on iOS

iOS suspends apps in the background, so Noor can't run a timer thread like the Mac app.
Instead `src-tauri/src/notify.rs` **pre-schedules** the next events with the system
(`UNUserNotificationCenter` via `tauri-plugin-notification`):

* prayer reminders for the next ~8 days (every reminder you set: before / at / after),
* the running countdown timer,
* water reminders for the next ~36 h (Smart / Every N min / Set times),
* your personal reminders for the next 3 weeks,

sorted by time and capped at 60 (iOS keeps 64 per app). The plan is rebuilt whenever
anything changes and every time Noor comes to the foreground. If the queue is full,
the last one is a gentle "Open Noor ✨" so it never silently runs dry.

Sounds are WAV files in `public/sounds/` (synthesised for Noor, no licensing issues).
They're embedded in the Rust binary and copied to `Library/Sounds/` on launch — that's
where iOS looks for custom notification sounds. Previews play in-app.
Settings › **Send a test notification** fires one in 5 seconds — lock the phone to hear it.

## Project layout

```
crates/mackit-core/      MacKit image engine (+ Swift Vision bridge) — unchanged
crates/nexa-prayer/      Nexa Island prayer engine — unchanged
crates/nexa-widgets/     Nexa Island widgets + NEW reminders.rs (table custom_reminders)
src-tauri/src/
  lib.rs                 app setup + every command
  notify.rs              iOS notification planner/scheduler, sounds, tests
  prayer_cmds.rs         prayer commands (from Nexa Island)
  widgets_cmds.rs        water/timer/to-do/clocks/reminders commands
  commands/, notes.rs,   MacKit commands (images, collage, notes, settings)
  settings.rs, state.rs
  Info.ios.plist         merged into the iOS Info.plist (photos, location, file sharing)
src/
  app/                   Noor's UI: tabs, screens, live island, design system (noor.css)
  kit/                   MacKit's frontend (tools render full-screen via ToolScreen)
  island/                Nexa Island's libs + Prayer Center sections (embedded in settings)
  dev/mock.ts            browser preview data (npm run dev:mock)
vite.config.ts           scopes MacKit CSS → .kit-scope and Nexa Island CSS → .ni-scope
src/app/noor.css         design system (light · dark · glass, accent set at runtime)
brand/noor-logo.svg      logo source → app-icon.png → `npm run icons`
scripts/ios-setup.sh     one-command iOS setup
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run ios:sim` / `ios:dev` / `ios:build` | Simulator / device / release `.ipa` |
| `npm run app:dev` | Desktop preview window (notifications are not scheduled on desktop) |
| `npm run dev:mock` | Browser preview with sample data |
| `npm run typecheck` · `npm test` · `npm run test:rust` | Checks (TS strict, Vitest, Rust) |
| `npm run icons` | Regenerate icons from `app-icon.png` |

## Data

Everything stays on the phone. One SQLite file `noor.sqlite` in the app's Application
Support folder (prayer settings, locations, reminders, water, timer, to-dos, clocks);
MacKit settings/notes as JSON next to it; exported images in **Files › On My iPhone › Noor**.
