# BotDeflector for Reddit

A Manifest V3 browser extension built with TypeScript and Bauhaus modernist design principles to detect, flag, and stealthily deflect automated bot accounts, repost farms, and hijacked comments across Reddit.

---

## A Note from the author

The rest of this shit is made by AI, sorry. I'm tired of the constant unreality on the internet. 
This is my first, basic attempt at fighting back, I guess I can start with Reddit.

## Features & Detection Engine

* **Personal Account Auto-Blocking:** Automatically blocks detected bot accounts on your personal Reddit profile (`/api/block_user`) using active session cookies, with graceful quota management.
* **Stealth Deflection:** High-scoring bot comments are automatically collapsed from view and replaced with a crisp 1-line Bauhaus reveal strip.
* **Archival Repost Search:** Detects viral submissions recycled from months/years ago using Reddit's search API.
* **Accomplice Comment Hijacking:** Catches bot syndicates that copy top comments from the original viral thread and paste them into new threads (including nested replies).
* **Unescaped Scraper Artifacts:** Identifies crude web scrapers leaving raw HTML entities (`&amp;`, `&#39;`, `&quot;`) in titles or comments with zero network overhead.
* **Aged Sleeper Gap:** Uncovers bulk-registered accounts that sat dormant for 6–24 months before abruptly activating in the last 72 hours.
* **Inhuman Velocity Cadence:** Detects automated machine posting across multiple subreddits every 45–60 seconds.
* **Circadian Rhythm Anomaly:** Flags scripts running 24/7 with zero biological sleep breaks.
* **Extreme Karma Asymmetry & Ghost Karma:** Identifies automated repost bots (10k+ post karma vs <25 comment karma) and accounts with scrubbed karma-farming history.
* **Drive-by Dialogue Deficit vs. Conversationalist Credit:** Distinguishes fire-and-forget spammers from genuine organic Redditors engaged in back-and-forth dialogue.
* **Functional Modernist UI:** Stark high-contrast palette, elementary geometry, modular grid, and live deflection statistics.
* **Universal Reddit Support:** Native adapters for both Modern Reddit (`shreddit` web components) and Classic Old Reddit (`old.reddit.com`).

---

## ⚡ Installation & Quick Start

Choose the easiest method for your browser setup:

### Method 1: 1-Click Userscript (Fastest — All Browsers & Mobile)
If you use **Tampermonkey**, **Violentmonkey**, **Greasemonkey**, or **Userscripts** (Safari macOS/iOS, Firefox Mobile, Orion, Kiwi):
1. Make sure you have a userscript manager installed in your browser.
2. Click this direct installation link:
   👉 **[Install BotDeflector Userscript](https://raw.githubusercontent.com/spcbeck/bot-deflector/main/bot-deflector.user.js)**
3. Confirm **Install** in your userscript extension prompt. Done!

### Method 2: Pre-Built Extension ZIP (No Node/Git Required)
For **Google Chrome**, **Brave**, **Arc**, **Microsoft Edge**, and **Opera**:
1. Download the latest **`bot-deflector-v1.0.0.zip`** from [GitHub Releases](https://github.com/spcbeck/bot-deflector/releases).
2. Unzip the downloaded file into a folder on your computer.
3. Open your browser and navigate to `chrome://extensions/` (or `brave://extensions/`, `edge://extensions/`).
4. Toggle **Developer mode** on (top right corner).
5. Click **Load unpacked** and select the unzipped folder.
6. Browse Reddit! The extension will automatically deflect detected bots.

### Method 3: Official Chrome Web Store
* Ready for one-click installation once published to the Chrome Web Store.
* See [CHROMEWEBSTORE.md](./CHROMEWEBSTORE.md) for full developer store metadata, permissions justifications, and submission instructions.

---

## Development & Building from Source

If you want to contribute or build from source:

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Heuristic Test Suite
Runs the 9 unit test suites covering the heuristic threat matrix:
```bash
npm test
```

### 3. Build Everything
Builds both the browser extension (`dist/`) and the standalone userscript (`dist/bot-deflector.user.js`):
```bash
npm run build:all
```

### 4. Create Distribution Package
Generates a verified, production-ready `bot-deflector-v1.0.0.zip` ready for store submission or release upload:
```bash
npm run package
```

### 5. Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** via the toggle switch in the top right corner.
3. Click **Load unpacked**.
4. Select the `dist/` folder inside this repository.

---

## Chrome Web Store Publishing
See [CHROMEWEBSTORE.md](./CHROMEWEBSTORE.md) for full store listing copy, permissions justifications, privacy disclosures, and the pre-publish checklist.
