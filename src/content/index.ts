import { DeflectorClient, ExtensionBackendClient } from '../core/client';
import { evaluateMerchSpam, evaluateUnescapedEntities } from '../engine/heuristics';
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
  private activeSettings: ExtensionSettings | null = null;
  private isScanning = false;
  private lastUrl = typeof location !== 'undefined' ? location.pathname + location.search : '';

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

    // Load initial settings
    await this.refreshSettings();

    // 1. Check Submission (OP & Repost Archival Search)
    await this.evaluateSubmission();

    // 2. Scan visible comments
    await this.scanComments();

    // 3. Listen for streaming background evaluations
    this.client.onUsersEvaluated((newlyScored) => {
      if (!this.adapter) return;
      const allComments = this.adapter.findComments();
      this.applyScoredResults(allComments, newlyScored);
    });

    // 4. Attach MutationObserver for dynamically loaded comments (infinite scroll)
    this.adapter.observe(() => {
      this.checkRouteUrl();
      this.debouncedScan();
    });

    // 5. Watch for Single Page Application (SPA) history navigation on Reddit
    this.initSpaNavigationWatcher();
  }

  private initSpaNavigationWatcher(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('popstate', () => this.checkRouteUrl());

    // Patch pushState and replaceState to detect programmatic client-side navigation
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

    // Re-evaluate the new submission and trigger scanning
    this.evaluateSubmission();
    this.debouncedScan();
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
      this.activeSettings = await this.client.getSettings();
    } catch {
      // Backend client might be idle or uninitialized
    }
  }

  private async evaluateSubmission(): Promise<void> {
    if (!this.adapter) return;
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
        this.adapter.injectSubmissionWarning(
          sub,
          res.originalPost,
          res.opScored || {
            username: sub.author,
            score: 85,
            classification: 'DEFLECT',
            breakdown: [],
            evaluatedAt: Date.now()
          }
        );
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

      // Batch query usernames to backend
      const usernames = Array.from(new Set(remainingComments.map((c) => c.author)));
      if (usernames.length === 0) {
        this.isScanning = false;
        return;
      }

      const scoredMap = await this.client.checkUsers(usernames);
      this.applyScoredResults(remainingComments, scoredMap);
    } finally {
      this.isScanning = false;
    }
  }

  private applyScoredResults(comments: RedditCommentElement[], scoredMap: Record<string, ScoredUser>): void {
    if (!this.adapter) return;

    for (const c of comments) {
      if (c.element.dataset.bdDeflected === 'true') continue;

      let scored = scoredMap[c.author.toLowerCase().replace(/^u\//, '')];
      if (!scored) continue;

      // Local Heuristic Veto:
      // Even if account passed heuristics previously (cached CLEAN),
      // check current comment for hard scraper artifacts or merch links
      const unescapedHit = evaluateUnescapedEntities(c.bodyText);
      const merchHit = evaluateMerchSpam(c.bodyText);

      if (scored.classification === 'CLEAN' && (unescapedHit || merchHit)) {
        const hits = [unescapedHit, merchHit].filter(Boolean) as NonNullable<typeof unescapedHit>[];
        this.client.invalidateUser(c.author).catch(() => {});
        scored = {
          ...scored,
          score: Math.max(scored.score, 75),
          classification: 'DEFLECT',
          breakdown: [...scored.breakdown, ...hits]
        };
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

// Auto-boot in browser extension context
if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
  const orchestrator = new ContentOrchestrator(new ExtensionBackendClient());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => orchestrator.init());
  } else {
    orchestrator.init();
  }
}
