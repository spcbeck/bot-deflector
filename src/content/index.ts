import { BackgroundMessage, BackgroundResponse, ExtensionSettings, ScoredUser } from '../types';
import { RedditAdapter, RedditCommentElement } from './adapters/base';
import { OldRedditAdapter } from './adapters/oldReddit';
import { ShredditAdapter } from './adapters/shreddit';
import { ViewportPrioritizer } from './viewport';

class ContentOrchestrator {
  private adapter: RedditAdapter | null = null;
  private viewport = new ViewportPrioritizer();
  private historicalTopComments: string[] = [];
  private processedCommentIds = new Set<string>();
  private activeSettings: ExtensionSettings | null = null;
  private isScanning = false;

  async init(): Promise<void> {
    // Select active adapter
    const shreddit = new ShredditAdapter();
    const oldReddit = new OldRedditAdapter();

    if (shreddit.detect()) {
      this.adapter = shreddit;
    } else if (oldReddit.detect()) {
      this.adapter = oldReddit;
    } else {
      // Default to Shreddit if modern elements found later
      this.adapter = shreddit;
    }

    console.log(`[BotDeflector] Active Adapter: ${this.adapter.name}`);

    // Load initial settings
    await this.refreshSettings();

    // 1. Check Submission (OP & Repost Archival Search)
    await this.evaluateSubmission();

    // 2. Scan visible comments
    await this.scanComments();

    // 3. Attach MutationObserver for dynamically loaded comments (infinite scroll)
    this.adapter.observe(() => {
      this.debouncedScan();
    });
  }

  private debounceTimer: number | null = null;
  private debouncedScan(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.scanComments();
    }, 400);
  }

  private async refreshSettings(): Promise<void> {
    try {
      const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
        type: 'GET_SETTINGS'
      });
      if (res?.success) {
        this.activeSettings = res.data;
      }
    } catch {
      // Background worker might be idle
    }
  }

  private async evaluateSubmission(): Promise<void> {
    if (!this.adapter) return;
    const sub = this.adapter.extractSubmission();
    if (!sub) return;

    try {
      const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<any>>({
        type: 'CHECK_SUBMISSION',
        title: sub.title,
        subreddit: sub.subreddit,
        author: sub.author
      });

      if (res?.success && res.data?.isRepost && res.data?.originalPost) {
        this.historicalTopComments = res.data.historicalComments || [];
        this.adapter.injectSubmissionWarning(sub, res.data.originalPost, res.data.opScored);
      }
    } catch (err) {
      console.warn('[BotDeflector] Submission check error:', err);
    }
  }

  private async scanComments(): Promise<void> {
    if (!this.adapter || this.isScanning) return;
    this.isScanning = true;

    try {
      const rawComments = this.adapter.findComments();
      const newComments: RedditCommentElement[] = [];

      for (const c of rawComments) {
        if (!this.processedCommentIds.has(c.id)) {
          this.processedCommentIds.add(c.id);
          this.viewport.observeComment(c);
          newComments.push(c);
        }
      }

      if (newComments.length === 0) {
        this.isScanning = false;
        return;
      }

      // Prioritize comments currently in viewport
      const prioritized = this.viewport.sortPrioritized(newComments);

      // Instant DOM-Level Check: Check Accomplice Comment Theft against historical thread
      const remainingComments: RedditCommentElement[] = [];
      for (const c of prioritized) {
        if (this.isAccompliceStolenComment(c.bodyText)) {
          // Instant deflection!
          const syntheticScored: ScoredUser = {
            username: c.author,
            score: 95,
            classification: 'DEFLECT',
            breakdown: [
              {
                ruleId: 'accomplice_comment_theft',
                category: 'syndicate',
                name: 'Accomplice Comment Hijacking',
                points: 65,
                description: 'Word-for-word copy of top comment from original historical thread'
              }
            ],
            evaluatedAt: Date.now()
          };
          this.adapter.collapseComment(c, syntheticScored, () => {});
        } else {
          remainingComments.push(c);
        }
      }

      // Batch query usernames to background worker
      const usernames = Array.from(new Set(remainingComments.map((c) => c.author)));
      if (usernames.length === 0) {
        this.isScanning = false;
        return;
      }

      const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<Record<string, ScoredUser>>>({
        type: 'CHECK_USERS',
        usernames
      });

      if (res?.success && res.data) {
        const scoredMap = res.data;

        for (const c of remainingComments) {
          const scored = scoredMap[c.author.toLowerCase().replace(/^u\//, '')];
          if (!scored) continue;

          if (scored.classification === 'DEFLECT') {
            this.adapter.collapseComment(c, scored, () => {});
          } else if (scored.classification === 'FLAG' && this.activeSettings?.mode === 'AUDIT_TAG') {
            c.element.style.borderLeft = '3px solid #FBC02D';
          }
        }
      }
    } finally {
      this.isScanning = false;
    }
  }

  private isAccompliceStolenComment(bodyText: string): boolean {
    if (!bodyText || this.historicalTopComments.length === 0) return false;
    const cleanCurrent = bodyText.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (cleanCurrent.length < 20) return false;

    for (const hist of this.historicalTopComments) {
      const cleanHist = hist.toLowerCase().replace(/[^\w\s]/g, '').trim();
      if (cleanCurrent === cleanHist || cleanHist.includes(cleanCurrent) || cleanCurrent.includes(cleanHist)) {
        return true;
      }
    }
    return false;
  }
}

// Auto-boot on Reddit pages
const orchestrator = new ContentOrchestrator();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => orchestrator.init());
} else {
  orchestrator.init();
}
