import {
  DEFAULT_SETTINGS
} from '../background/cache';
import { blockRedditUser } from '../background/blocker';
import {
  fetchHistoricalTopComments,
  fetchUserComments,
  fetchUserProfile,
  searchSubredditHistoricalPosts
} from '../background/fetcher';
import { scoreUser } from '../engine/scorer';
import {
  BackgroundMessage,
  BackgroundResponse,
  ExtensionSettings,
  RedditSubmission,
  ScoredUser
} from '../types';

export interface DeflectorClient {
  getSettings(): Promise<ExtensionSettings>;
  checkSubmission(data: { title: string; subreddit: string; author: string }): Promise<{
    isRepost: boolean;
    originalPost?: RedditSubmission;
    historicalComments?: string[];
    opScored?: ScoredUser;
  }>;
  checkUsers(usernames: string[]): Promise<Record<string, ScoredUser>>;
  addWhitelist(username: string): Promise<void>;
  blockUser(username: string): Promise<{ success: boolean; quotaExceeded?: boolean; error?: string }>;
  invalidateUser(username: string): Promise<void>;
  recordDeflection(scored: ScoredUser): Promise<void>;
  onUsersEvaluated(callback: (users: Record<string, ScoredUser>) => void): () => void;
}

export class ExtensionBackendClient implements DeflectorClient {
  async getSettings(): Promise<ExtensionSettings> {
    const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<ExtensionSettings>>({
      type: 'GET_SETTINGS'
    });
    if (res?.success && res.data) return res.data;
    return DEFAULT_SETTINGS;
  }

  async checkSubmission(data: { title: string; subreddit: string; author: string }): Promise<{
    isRepost: boolean;
    originalPost?: RedditSubmission;
    historicalComments?: string[];
    opScored?: ScoredUser;
  }> {
    const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<any>>({
      type: 'CHECK_SUBMISSION',
      ...data
    });
    if (res?.success && res.data) return res.data;
    return { isRepost: false };
  }

  async checkUsers(usernames: string[]): Promise<Record<string, ScoredUser>> {
    const res = await chrome.runtime.sendMessage<BackgroundMessage, BackgroundResponse<Record<string, ScoredUser>>>({
      type: 'CHECK_USERS',
      usernames
    });
    if (res?.success && res.data) return res.data;
    return {};
  }

  async addWhitelist(username: string): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'ADD_WHITELIST',
      username
    });
  }

  async blockUser(username: string): Promise<{ success: boolean; quotaExceeded?: boolean; error?: string }> {
    const res = await chrome.runtime.sendMessage({
      type: 'BLOCK_USER',
      username
    });
    return res?.data || { success: false };
  }

  async invalidateUser(username: string): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'INVALIDATE_USER',
      username
    });
  }

  async recordDeflection(scored: ScoredUser): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'RECORD_DEFLECTION',
      username: scored.username,
      points: scored.score,
      breakdown: scored.breakdown
    });
  }

  onUsersEvaluated(callback: (users: Record<string, ScoredUser>) => void): () => void {
    const listener = (message: any) => {
      if (message?.type === 'USERS_EVALUATED' && message.users) {
        callback(message.users);
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
    return () => {};
  }
}

// Helpers for Userscript environment
declare function GM_getValue<T>(key: string, defaultValue?: T): T;
declare function GM_setValue<T>(key: string, value: T): void;

const USERSCRIPT_SETTINGS_KEY = 'bd_settings';
const USERSCRIPT_CACHE_PREFIX = 'bd_cache_';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getStoredValue<T>(key: string, fallback: T): T {
  try {
    if (typeof GM_getValue === 'function') {
      return GM_getValue(key, fallback);
    }
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
}

function setStoredValue<T>(key: string, value: T): void {
  try {
    if (typeof GM_setValue === 'function') {
      GM_setValue(key, value);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export class UserscriptBackendClient implements DeflectorClient {
  private settings: ExtensionSettings = getStoredValue(USERSCRIPT_SETTINGS_KEY, DEFAULT_SETTINGS);

  async getSettings(): Promise<ExtensionSettings> {
    this.settings = getStoredValue(USERSCRIPT_SETTINGS_KEY, DEFAULT_SETTINGS);
    return this.settings;
  }

  async addWhitelist(username: string): Promise<void> {
    const clean = username.toLowerCase().replace(/^u\//, '');
    if (!this.settings.whitelist.includes(clean)) {
      this.settings.whitelist.push(clean);
      setStoredValue(USERSCRIPT_SETTINGS_KEY, this.settings);
    }
  }

  async blockUser(username: string): Promise<{ success: boolean; quotaExceeded?: boolean; error?: string }> {
    return await blockRedditUser(username);
  }

  async invalidateUser(username: string): Promise<void> {
    const key = USERSCRIPT_CACHE_PREFIX + username.toLowerCase();
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, null);
      } else {
        localStorage.removeItem(key);
      }
    } catch {}
  }

  async recordDeflection(scored: ScoredUser): Promise<void> {
    this.setCachedUser(scored);
  }

  onUsersEvaluated(_callback: (users: Record<string, ScoredUser>) => void): () => void {
    return () => {};
  }

  async checkSubmission(data: { title: string; subreddit: string; author: string }): Promise<{
    isRepost: boolean;
    originalPost?: RedditSubmission;
    historicalComments?: string[];
    opScored?: ScoredUser;
  }> {
    if (!this.settings.enableSubmissionCheck) {
      return { isRepost: false };
    }

    const historicalPost = await searchSubredditHistoricalPosts(data.subreddit, data.title);
    let topComments: string[] = [];

    if (historicalPost) {
      topComments = await fetchHistoricalTopComments(historicalPost.id);
    }

    const opScored = scoreUser(
      data.author,
      undefined,
      undefined,
      undefined,
      data.title,
      {
        isExactTitleRepost: Boolean(historicalPost),
        deflectThreshold: this.settings.deflectThreshold,
        flagThreshold: this.settings.flagThreshold,
        userWhitelist: this.settings.whitelist
      }
    );

    return {
      isRepost: Boolean(historicalPost),
      originalPost: historicalPost || undefined,
      historicalComments: topComments,
      opScored
    };
  }

  async checkUsers(usernames: string[]): Promise<Record<string, ScoredUser>> {
    const results: Record<string, ScoredUser> = {};
    const uncached: string[] = [];

    for (const rawName of usernames) {
      const clean = rawName.replace(/^u\//, '').trim();
      if (!clean || clean === '[deleted]') continue;

      const cached = this.getCachedUser(clean);
      if (cached) {
        results[clean] = cached;
      } else {
        uncached.push(clean);
      }
    }

    for (const username of uncached) {
      try {
        const profile = await fetchUserProfile(username);
        let comments: any[] = [];

        if (profile) {
          const ageDays = (Date.now() / 1000 - profile.createdUtc) / 86400;
          const isSuspiciousProfile =
            (ageDays >= 60 && ageDays <= 1000 && profile.totalKarma < 150) ||
            (profile.linkKarma > 5000 && profile.commentKarma < 30) ||
            profile.totalKarma < 0;

          if (isSuspiciousProfile && this.settings.enableCadenceCheck) {
            comments = await fetchUserComments(username);
          }
        }

        const scored = scoreUser(
          username,
          profile || undefined,
          comments,
          undefined,
          undefined,
          {
            deflectThreshold: this.settings.deflectThreshold,
            flagThreshold: this.settings.flagThreshold,
            userWhitelist: this.settings.whitelist
          }
        );

        if (scored.classification === 'DEFLECT' && this.settings.autoBlockReddit && !scored.isBlockedOnReddit) {
          const blockRes = await blockRedditUser(username);
          if (blockRes.success) {
            scored.isBlockedOnReddit = true;
          }
        }

        this.setCachedUser(scored);
        results[username] = scored;
      } catch (err) {
        console.warn(`[BotDeflector Userscript] Could not evaluate ${username}:`, err);
      }
    }

    return results;
  }

  private getCachedUser(username: string): ScoredUser | null {
    const key = USERSCRIPT_CACHE_PREFIX + username.toLowerCase();
    const cached = getStoredValue<ScoredUser | null>(key, null);
    if (!cached) return null;

    if (Date.now() - cached.evaluatedAt > SEVEN_DAYS_MS) {
      return null;
    }
    return cached;
  }

  private setCachedUser(scored: ScoredUser): void {
    const key = USERSCRIPT_CACHE_PREFIX + scored.username.toLowerCase();
    setStoredValue(key, scored);
  }
}
