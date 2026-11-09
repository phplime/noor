## v0.1.2 — 2026-11-09

### ID / Passport copy — guided scan
- **Scan card — front, then back**: scan the front, check it (Retake / Corners / Use), then Noor asks for the back.
- Cleaner result: no table edges left around the card, natural colours (removes the yellow room-light cast), rounded corners and a thin outline like a real photocopy.

### নামাজ শিক্ষা — জানাজা, ঈদ, সাহু সিজদা, বিশেষ নামাজ
- **জানাজা**: ফরজ, শর্ত, নিয়ত, চার তাকবিরের নিয়ম, প্রাপ্তবয়স্ক / নাবালেগ ছেলে / মেয়ের দোয়া, মাসআলা, দাফন ও কবর জিয়ারতের দোয়া।
- **ঈদ**: নিয়ত, ছয় তাকবিরের নিয়ম ধাপে ধাপে, দেরিতে এলে করণীয়, ঈদের সুন্নত, তাকবির ও তাকবিরে তাশরিক।
- **সাহু সিজদা**: নিয়ম, কোন ভুলে লাগে, রাকাত সংখ্যায় সন্দেহ, জরুরি মাসআলা।
- **বিশেষ নামাজ**: জুমা, বিতর, তারাবিহ, তাহাজ্জুদ, ইস্তিখারা, সালাতুত তাসবিহ, কসর, কাজা, ইশরাক-চাশত, নিষিদ্ধ সময়।

### Fixes & release
- বিশেষ নামাজ and Recent walks now look right in dark mode.
- One-click release: `build-release.command` applies updates, builds Android + iPhone, pushes to GitHub and publishes the release with "What's new".

### ID / Passport copy — one photo at a time
- **Scan** now opens the camera for a single photo with a card-shaped guide frame (and a torch button), instead of the multi-page scanner.
- Right after each photo: preview with **Retake**, **Corners** and **Use**. If the card edges aren't found, the corner screen opens straight away.
- The corner screen now has big **Cancel** / **✓ Done** buttons at the bottom and covers the whole app, so the back button can't close the tool by accident.

### ID / Passport copy — auto-capture & cleaner edges
- The card camera now finds the card live (green outline) and **takes the photo by itself** once you hold it steady — like the old scanner, but one photo per side. Tap **AUTO** to switch it off and use the shutter instead.
- Dark strips along the card's edges (table, shadow, laminate edge) are now trimmed automatically.
- About now shows when the app was built, next to the version.


