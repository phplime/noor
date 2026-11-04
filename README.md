<p align="center">
  <img src="app-icon.png" width="112" alt="Noor app icon" />
</p>

<h1 align="center">Noor · নূর · نور</h1>

<p align="center">
  <b>A personal assistant and prayer management app for Android and iPhone.</b><br/>
  Prayer times with jamaat alerts, Quran with recitation, duas, namaz shikkha, a Bangla &amp; Hijri calendar,
  fitness, reminders and a private photo studio, all in one app that works offline.
</p>

<p align="center">
  <a href="../../releases/latest"><b>⬇️ Download the latest release</b></a>
</p>

---

## Features

### 🕌 Prayer
- Accurate prayer times for your location (12 calculation methods, Hanafi/Standard Asr, high-latitude rules, offline city search)
- **Jamaat times**: set your mosque's jamaat time; get an alert when the prayer starts, *N* minutes before jamaat and at jamaat
- Notifications with sound (they ring twice) even when the app is closed
- **Makruh (no-salah) times** and **Tahajjud** window (last third of the night)
- **Salah tracker** with streaks, on-time stats and qaza count
- Month timetable and **Qibla compass**
- iPhone: live prayer countdown on the **lock screen** (Live Activity)

### 📖 Quran, Dua &amp; Tasbih
- All 114 surahs offline: Arabic (Uthmani), **Bangla pronunciation (উচ্চারণ)** and **Bangla meaning**
- Ayah-by-ayah **recitation** with highlighting (streamed, small data use)
- Morning, evening and sleep duas, salah duas and the last ten surahs, with daily *amal* checklist
- Tasbih counter with dhikr sets

### 🧎 নামাজ শিক্ষা (Learn Salah)
- Step-by-step salah with every recitation in Arabic, উচ্চারণ and অর্থ
- **Niyat** for every prayer, a colour-coded **rakat table** and the 13 farz of salah
- **Wudu**: farz, steps, dua and what breaks it
- Dua qunut, sahu sajda and rules for 3- and 4-rakat prayers

### 🏠 Home &amp; Calendar
- Today in **English, বাংলা and Hijri (in Bangla)**, live weather and a sky card that follows the sun and moon
- Calendar with Bangla, Hijri and Gregorian dates, **moon phases**, public holidays, Islamic occasions and Sunnah fasts
- Ramadan sehri/iftar alerts, special days (birthdays, anniversaries) with reminders

### 🌿 Daily Life
- Reminders (once / daily / weekdays / weekly / monthly), water tracker, timer &amp; stopwatch, to-do, world clocks
- **Fitness**: steps from your phone, weight log, BMI and a weekly health report with calories
- Cycle tracker and quiet places

### 🖼️ Studio
Private photo tools that run entirely on your phone: watermark/logo, crop, resize &amp; canvas, compression,
format converter, adjust, background removal, collage and batch processing.

### 🔒 Private by design
No account and no tracking. Your data stays on your phone. The network is only used for weather and Quran recitation.

---

## Install

### Android
1. Download **`Noor-vX.Y.Z-android.apk`** from the [latest release](../../releases/latest).
2. Open it and allow *Install unknown apps* for your browser or file manager when Android asks.
3. Open Noor, allow **notifications** and **alarms &amp; reminders** so prayer alerts arrive on time.

### iPhone
iOS only installs apps from the App Store, TestFlight or a sideloading tool, so the IPA is installed with your own Apple ID:

1. Install **[SideStore](https://sidestore.io)** or **[AltStore](https://altstore.io)** (or use **[Sideloadly](https://sideloadly.io)** on a Mac/PC).
2. Download **`Noor-vX.Y.Z-iphone.ipa`** from the [latest release](../../releases/latest) and open it with that app.
3. On the iPhone: **Settings → General → VPN &amp; Device Management →** trust your Apple ID.
4. Refresh Noor in SideStore/AltStore **once a week** (free Apple IDs sign apps for 7 days).

> A free Apple ID can have 3 sideloaded apps at a time. Noor's lock-screen widget counts as one of them.

---

## Build from source

Stack: **Tauri 2 · React + TypeScript · Rust** (the prayer, widget and image engines are Rust crates in `crates/`).

```bash
npm install
npm run dev:mock                 # run the UI in a browser with sample data
npm test                         # front-end tests
cargo test --workspace           # Rust tests

npm run tauri android build -- --apk --target aarch64       # Android
npm run tauri ios build -- --export-method debugging        # iPhone (needs Xcode)
```

`./build-release.command` builds both release files into `release/`.

Android release signing reads `src-tauri/gen/android/keystore.properties` (`storeFile`, `keyAlias`, `password`).
Create your own keystore and **never commit it**. Both are ignored by git.

More technical notes: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## Credits
Quran text and Bangla translation from the open **quran-json** dataset · recitation from **everyayah.com** ·
weather from **Open-Meteo** · fonts: **Scheherazade New** and **Amiri Quran** (SIL Open Font License).

The salah guide follows common Hanafi practice in Bangladesh. If you spot a mistake, please open an issue.

Made with ❤️ by Nazmul.
