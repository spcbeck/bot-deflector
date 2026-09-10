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

## Development & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
Runs the 9 unit test suites covering the heuristic threat matrix:
```bash
npm test
```

### 3. Build Extension
Builds the Manifest V3 bundle into the `dist/` directory:
```bash
npm run build
```

### 4. Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** via the toggle switch in the top right corner.
3. Click **Load unpacked**.
4. Select the `dist/` folder inside this repository.
5. Browse to any Reddit thread on `reddit.com` or `old.reddit.com`.

---

## Chrome Web Store Publishing
See [CHROMEWEBSTORE.md](./CHROMEWEBSTORE.md) for full store listing copy, permissions justifications, privacy disclosures, and the pre-publish checklist.
