# Chrome Web Store Listing & Publishing Guide: BotDeflector for Reddit

This document is the single source of truth for submitting and publishing **BotDeflector for Reddit** to the Chrome Web Store Developer Dashboard.

---

## 1. Store Metadata

* **Name:** `BotDeflector for Reddit`
* **Short Description (max 132 characters):**
  > Detect and stealthily deflect automated bots, viral repost farms, and hijacked comments on Reddit with a local heuristic engine.
* **Category:** `Productivity` / `Social & Communication`
* **Language:** `English`
* **Pricing:** `Free`

---

## 2. Detailed Store Description

```markdown
Deflect bot swarms, karma-farming repost rings, and comment hijackers on Reddit with zero configuration.

BotDeflector is a privacy-first browser extension that analyzes comment threads and submissions on Reddit in real time. It evaluates accounts against a multi-layered heuristic threat matrix, instantly collapsing detected spam and bot accounts into a minimal, non-intrusive Bauhaus deflection bar with a one-click reveal option.

KEY FEATURES:
• Personal Account Auto-Blocking: Optionally blocks detected bot accounts directly on your personal Reddit profile (/api/block_user) so you never see their posts, comments, or DMs anywhere on the platform.
• Stealth Deflection: Detected bot comments are automatically collapsed from view so you can enjoy organic discussion without distraction.
• Repost Farm Detection: Automatically detects recycled viral submissions scraped from years ago using lightweight archival checks.
• Accomplice Comment Hijacking Defense: Flags bots that copy-paste top comments from original threads onto reposts to siphon karma.
• Sleeper Account Detection: Catches bulk-registered accounts that sat dormant for 6–24 months before suddenly awakening into high-velocity activity.
• Inhuman Velocity & Cadence Profiling: Identifies machine loops posting across multiple subreddits every 45–60 seconds around the clock without natural sleep breaks.
• Scraper Artifact Scanner: Instantly flags unescaped HTML entities (&amp;, &#39;, &quot;) left behind by crude web scrapers.
• Bauhaus Modernist Dashboard: High-contrast, geometric control interface to view deflected statistics, customize sensitivity thresholds (40–90 PTS), and manage whitelists.

100% PRIVATE & ON-DEVICE:
• Zero external tracking or data collection.
• All evaluations and scoring happen locally inside your browser.
• Evaluated profiles are cached locally in your browser storage with a 7-day TTL to minimize network requests.
• Supports both modern Reddit (web components) and classic Old Reddit.
```

---

## 3. Permissions Justifications (For Review Team)

When submitting to the Chrome Web Store Developer Dashboard, you must provide plain-English justifications for each declared permission. Use the exact text below:

### `storage`
* **Justification:**
  > "Required to cache evaluated user profile scores locally on the user's machine (with a 7-day TTL) and persist the user's custom deflection thresholds, mode preferences, and whitelist. No stored data is ever transmitted off the device."

### Host Permission: `*://*.reddit.com/*`
* **Justification:**
  > "Required exclusively to read Reddit comment and submission DOM elements on reddit.com, execute unauthenticated same-origin requests to public profile metadata (/user/<name>/about.json) and archival search endpoints (/r/<subname>/search.json), and inject the comment deflection interface."

---

## 4. Privacy & Data Usage Disclosures

In the Developer Dashboard's **Privacy Practices** tab:

1. **Single Purpose:**
   > "BotDeflector detects and stealthily collapses automated spam bots, viral repost farms, and stolen comments on Reddit."
2. **Data Usage Declarations:**
   * **Does the extension collect personal data?** **NO.**
   * **Does the extension transmit data to third-party servers?** **NO.**
   * Check: *"I certify that this extension does not collect or transmit user data outside the user's device."*
3. **Privacy Policy URL:**
   > Host a simple static markdown privacy policy or GitHub repository README linking to the local privacy section.

---

## 5. Visual Assets Checklist

- [x] **16x16 Extension Icon:** `public/icons/icon-16.png`
- [x] **48x48 Extension Icon:** `public/icons/icon-48.png`
- [x] **128x128 Extension Icon:** `public/icons/icon-128.png`
- [ ] **Store Screenshot (Required by Google):**
  - Minimum 1 screenshot at `1280x800px` or `640x400px` showing the Bauhaus popup dashboard and a deflected comment on Reddit.
- [ ] **Small Promo Tile (Optional):** `440x280px`
- [ ] **Marquee Promo Tile (Optional):** `1400x560px`

---

## 6. Pre-Submission Packaging Checklist

To create the verified release `.zip` for upload:

1. Run:
   ```bash
   npm run package
   ```
2. The script runs type checking, builds the extension, validates that all required files and icons are present, and compresses the contents of `dist/` directly into:
   * `bot-deflector-v1.0.0.zip`
   * `bot-deflector.zip`
3. Upload `bot-deflector-v1.0.0.zip` to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
