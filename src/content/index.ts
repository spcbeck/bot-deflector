import { DeflectorClient, ExtensionBackendClient } from '../core/client';
import {
  evaluateMerchSpam,
  evaluateScriptHomoglyphBleed,
  evaluateUnescapedEntities,
  isStolenCommentMatch
} from '../engine/heuristics';
import { ExtensionSettings, ScoredUser } from '../types';
import { RedditAdapter, RedditCommentElement } from './adapters/base';
import { OldRedditAdapter } from './adapters/oldReddit';
import { ShredditAdapter } from './adapters/shreddit';
import { ViewportPrioritizer } from './viewport';

export class ContentOrchestrator {
  private client: DeflectorClient;
  private adapter: RedditAdapter | null = null;
  private viewport = new ViewportPrioritizer();
  private historicalTopComments: string[] = [];
  private processedCommentIds = new Set<string>();
  private evaluatedAuthors = new Set<string>();
  private activeSettings: ExtensionSettings | null = null;
  private isScanning = false;
  private pendingRescan = false;
  private lastUrl = typeof location !== 'undefined' ? location.pathname + location.search : '';
  private hydrationSweepTimer: number | null = null;

  constructor(client: DeflectorClient = new ExtensionBackendClient()) {
    this.client = client;
  }

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

    // 1. Register streaming background evaluation listener immediately before any async work
    this.client.onUsersEvaluated((newlyScored) => {
      if (!this.adapter) return;
      const allComments = this.adapter.findComments();
      this.applyScoredResults(allComments, newlyScored);
    });

    // 2. Attach MutationObserver for dynamically loaded comments/posts (infinite scroll)
    this.adapter.observe(() => {
      this.checkRouteUrl();
      this.debouncedScan();
      this.scheduleHydrationSweep();
    });

    // 2b. Attach passive scroll listener to catch lazy-hydrated Shreddit feed posts and re-prioritize viewport
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'scroll',
        () => {
          this.debouncedScan(250);
          this.scheduleHydrationSweep();
        },
        { passive: true }
      );
    }

    // 3. Watch for Single Page Application (SPA) history navigation on Reddit
    this.initSpaNavigationWatcher();

    // 4. Load initial settings
    await this.refreshSettings();

    // 5. Check Submission (OP & Repost Archival Search) in parallel without blocking comment/feed scan
    void this.evaluateSubmission();

    // 6. Scan visible comments & feed posts immediately, plus follow-up sweeps for delayed Shreddit hydration
    await this.scanComments();
    if (typeof window !== 'undefined') {
      window.setTimeout(() => this.debouncedScan(), 1200);
      window.setTimeout(() => this.debouncedScan(), 3000);
    }
  }

  private initSpaNavigationWatcher(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('popstate', () => this.checkRouteUrl());

    // Modern Navigation API fires across Content Script Isolated Worlds on host pushState/replaceState
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    if (nav && typeof nav.addEventListener === 'function') {
      nav.addEventListener('navigate', () => {
        window.setTimeout(() => this.checkRouteUrl(), 50);
      });
    }

    // Patch pushState and replaceState (effective in userscript context)
    const origPush = history.pushState;
    history.pushState = (...args) => {
      origPush.apply(history, args);
      this.checkRouteUrl();
    };

    const origReplace = history.replaceState;
    history.replaceState = (...args) => {
      origReplace.apply(history, args);
      this.checkRouteUrl();
    };

    // Lightweight fallback poll for isolated world browsers without Navigation API
    window.setInterval(() => this.checkRouteUrl(), 1000);
  }

  private checkRouteUrl(): void {
    if (typeof location === 'undefined') return;
    const currentUrl = location.pathname + location.search;
    if (currentUrl !== this.lastUrl) {
      console.log(`[BotDeflector] SPA Route transition: ${this.lastUrl} -> ${currentUrl}`);
      this.lastUrl = currentUrl;
      this.handleRouteChange();
    }
  }

  private handleRouteChange(): void {
    // Reset thread state for the new route
    this.historicalTopComments = [];
    this.processedCommentIds.clear();
    this.evaluatedAuthors.clear();

    // Re-evaluate the new submission and trigger scanning
    void this.evaluateSubmission();
    this.debouncedScan();
  }

  private debounceTimer: number | null = null;
  private debouncedScan(delayMs = 300): void {
    if (typeof window === 'undefined') {
      void this.scanComments();
      return;
    }
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      void this.scanComments();
    }, delayMs);
  }

  private scheduleHydrationSweep(): void {
    if (typeof window === 'undefined') return;
    if (this.hydrationSweepTimer) window.clearTimeout(this.hydrationSweepTimer);
    this.hydrationSweepTimer = window.setTimeout(() => {
      void this.scanComments();
    }, 950);
  }

  private async refreshSettings(): Promise<void> {
    try {
      this.activeSettings = await this.client.getSettings();
    } catch {
      // Backend client might be idle or uninitialized
    }
  }

  private async evaluateSubmission(): Promise<void> {
    if (!this.adapter) return;
    if (typeof location !== 'undefined' && !location.pathname.includes('/comments/')) {
      return;
    }
    const sub = this.adapter.extractSubmission();
    if (!sub) return;

    try {
      const res = await this.client.checkSubmission({
        title: sub.title,
        subreddit: sub.subreddit,
        author: sub.author
      });

      if (res?.isRepost && res?.originalPost) {
        this.historicalTopComments = res.historicalComments || [];
        const opScored: ScoredUser = res.opScored || {
          username: sub.author,
          score: 85,
          classification: 'DEFLECT',
          breakdown: [
            {
              ruleId: 'exact_title_repost',
              category: 'submission',
              name: 'Viral Title Repost',
              points: 85,
              description: 'Exact match with historical viral post'
            }
          ],
          evaluatedAt: Date.now()
        };
        this.adapter.injectSubmissionWarning(sub, res.originalPost, opScored);
        this.client.recordDeflection(opScored).catch(() => {});
      } else if (res?.opScored?.classification === 'DEFLECT') {
        this.client.recordDeflection(res.opScored).catch(() => {});
      }
    } catch (err) {
      console.warn('[BotDeflector] Submission check error:', err);
    }
  }

  private async scanComments(): Promise<void> {
    if (!this.adapter) return;
    if (this.isScanning) {
      this.pendingRescan = true;
      return;
    }
    this.isScanning = true;

    try {
      const rawComments = this.adapter.findComments();
      const newComments: RedditCommentElement[] = [];
      const visiblePendingComments: RedditCommentElement[] = [];

      for (const c of rawComments) {
        if (!this.processedCommentIds.has(c.id)) {
          this.processedCommentIds.add(c.id);
          this.viewport.observeComment(c);
          newComments.push(c);
        } else if (this.viewport.isVisible(c.id)) {
          const cleanAuthor = c.author.toLowerCase().replace(/^u\//, '').trim();
          if (cleanAuthor && !this.evaluatedAuthors.has(cleanAuthor)) {
            visiblePendingComments.push(c);
          }
        }
      }

      if (newComments.length === 0 && visiblePendingComments.length === 0) {
        return;
      }

      // Prioritize comments currently in viewport
      const prioritized = this.viewport.sortPrioritized(newComments);

      // Instant DOM-Level Check: Check Accomplice Comment Theft against historical thread
      const remainingComments: RedditCommentElement[] = [];
      for (const c of prioritized) {
        if (this.isAccompliceStolenComment(c.bodyText)) {
          // Invalidate any stale clean cache for this account
          this.client.invalidateUser(c.author).catch(() => {});

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
          this.evaluatedAuthors.add(c.author.toLowerCase().replace(/^u\//, '').trim());
          this.client.recordDeflection(syntheticScored).catch(() => {});
          this.adapter.collapseComment(
            c,
            syntheticScored,
            () => {},
            () => this.client.addWhitelist(syntheticScored.username),
            () => this.client.blockUser(syntheticScored.username)
          );
        } else {
          remainingComments.push(c);
        }
      }

      // Combine visible pending comments with remaining new comments (viewport-visible first)
      const combinedTargetComments = [
        ...visiblePendingComments,
        ...remainingComments
      ];

      // Batch query usernames to backend (promotes currently visible authors to front of queue)
      const usernames = Array.from(new Set(combinedTargetComments.map((c) => c.author)));
      if (usernames.length === 0) {
        return;
      }

      const scoredMap = await this.client.checkUsers(usernames);
      this.applyScoredResults(rawComments, scoredMap);
    } finally {
      this.isScanning = false;
      if (this.pendingRescan) {
        this.pendingRescan = false;
        void this.scanComments();
      }
    }
  }

  private applyScoredResults(comments: RedditCommentElement[], scoredMap: Record<string, ScoredUser>): void {
    if (!this.adapter) return;

    for (const key of Object.keys(scoredMap)) {
      this.evaluatedAuthors.add(key.toLowerCase().replace(/^u\//, '').trim());
    }

    for (const c of comments) {
      if (c.element.dataset.bdDeflected === 'true') continue;

      const cleanAuthor = c.author.toLowerCase().replace(/^u\//, '').trim();
      let scored = scoredMap[cleanAuthor];
      if (!scored) continue;

      this.evaluatedAuthors.add(cleanAuthor);

      // Local Heuristic Veto:
      // Even if account scored CLEAN or FLAG on profile metadata alone,
      // check current comment body for hard scraper artifacts or merch spam links
      const unescapedHit = evaluateUnescapedEntities(c.bodyText);
      const merchHit = evaluateMerchSpam(c.bodyText);
      const homoglyphHit = evaluateScriptHomoglyphBleed([], '', c.bodyText, '');

      if (scored.classification !== 'DEFLECT' && (unescapedHit || merchHit || homoglyphHit)) {
        const hits = [unescapedHit, merchHit, homoglyphHit].filter(Boolean) as NonNullable<typeof unescapedHit>[];
        const addedPoints = hits.reduce((sum, h) => sum + h.points, 0);
        const threshold = this.activeSettings?.deflectThreshold ?? 70;
        this.client.invalidateUser(c.author).catch(() => {});
        scored = {
          ...scored,
          score: Math.min(100, Math.max(scored.score + addedPoints, threshold)),
          classification: 'DEFLECT',
          breakdown: [...scored.breakdown, ...hits]
        };
        this.client.recordDeflection(scored).catch(() => {});
      }

      if (scored.classification === 'DEFLECT') {
        this.adapter.collapseComment(
          c,
          scored,
          () => {},
          () => this.client.addWhitelist(scored.username),
          () => this.client.blockUser(scored.username)
        );
      } else if (scored.classification === 'FLAG' && this.activeSettings?.mode === 'AUDIT_TAG') {
        c.element.style.borderLeft = '3px solid #FBC02D';
      }
    }
  }

  private isAccompliceStolenComment(bodyText: string): boolean {
    if (!bodyText || this.historicalTopComments.length === 0) return false;
    for (const hist of this.historicalTopComments) {
      if (isStolenCommentMatch(bodyText, hist)) {
        return true;
      }
    }
    return false;
  }
}

// Auto-boot in browser extension context
if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
  const orchestrator = new ContentOrchestrator(new ExtensionBackendClient());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => orchestrator.init());
  } else {
    orchestrator.init();
  }
}
