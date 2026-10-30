# Privacy Policy for BotDeflector for Reddit

**Last Updated:** October 30, 2026

**BotDeflector for Reddit** is designed from the ground up to operate locally on your device. It does not collect, transmit, sell, or share any personal data, browsing history, or analytics.

---

## 1. What Data Is Accessed and Processed Locally
When you browse `reddit.com`, BotDeflector reads publicly visible submission titles, comment bodies, and author usernames on the current page, and queries public Reddit JSON endpoints (`/user/<username>/about.json`, `/user/<username>/comments.json`, and `/r/<subreddit>/search.json`) directly from your browser to evaluate heuristic bot scores.

If you enable the optional **Auto-Block on Reddit** feature or click **Block on Reddit** / **Sync**, the extension communicates directly with `https://www.reddit.com/api/block_user` and `https://www.reddit.com/prefs/blocked.json` using your active browser session with Reddit.

## 2. How Data Is Stored
All data is stored exclusively on your local device using `chrome.storage.local` and `chrome.storage.session`:
* **Evaluated User Cache:** Cached bot/clean classifications and heuristic breakdowns with automatic time-to-live (TTL) expiration (swept daily via `chrome.alarms`).
* **User Preferences:** Your chosen deflection threshold, display mode (`Stealth Collapse` or `Audit Tag`), feature toggles, and local username whitelist.
* **Aggregate Counters:** Local counts of scanned, deflected, cached, and blocked accounts displayed in the extension popup.

## 3. Data Transmission & Third-Party Services
* **Zero Off-Device Transmission:** No browsing data, Reddit usernames, settings, or telemetry are ever sent to the developer or any third-party server.
* **Zero Analytics or Tracking:** This extension contains no analytics SDKs, trackers, cookies, or remote scripts.
* **All requests stay between your browser and `*.reddit.com`.**

## 4. Data Retention and Deletion
* Ephemeral per-tab deflection lists stored in `chrome.storage.session` are deleted automatically as soon as the tab or browser closes.
* Cached profile evaluations in `chrome.storage.local` expire automatically (7 to 90 days) and are purged every 24 hours.
* Uninstalling the extension immediately and permanently deletes all local storage data associated with BotDeflector.

## 5. Changes to This Policy
Any future updates to this privacy policy will be published in this file within the official repository (`https://github.com/spcbeck/bot-deflector/blob/main/PRIVACY.md`).

## 6. Contact
If you have questions or concerns regarding this privacy policy, please open an issue on the [GitHub Repository](https://github.com/spcbeck/bot-deflector/issues).
