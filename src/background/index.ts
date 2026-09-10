import { scoreUser } from '../engine/scorer';
import { BackgroundMessage, ScoredUser, TabMessage } from '../types';
import { blockRedditUser } from './blocker';
import {
  addTabDeflectedUsers,
  clearTabDeflections,
  getCachedUser,
  getCachedUsersBatch,
  getSettings,
  getStats,
  getTabDeflectedCount,
  incrementStats,
  invalidateCachedUser,
  setCachedUser,
  sweepExpiredCacheRecords,
  updateSettings
} from './cache';
import {
  fetchHistoricalTopComments,
  fetchUserComments,
  fetchUserProfile,
  searchSubredditHistoricalPosts
} from './fetcher';

// ---------------------------------------------------------------------------
// Lifecycle & Alarms Handlers
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[BotDeflector] Installed / Updated: ${details.reason}`);
  await getSettings();

  try {
    await chrome.alarms.create('cache_sweep_alarm', {
      periodInMinutes: 1440,
      delayInMinutes: 60
    });
  } catch (err) {
    console.warn('[BotDeflector] Could not register cache_sweep_alarm:', err);
  }
});

chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === 'cache_sweep_alarm') {
    console.log('[BotDeflector] Running scheduled cache sweep...');
    try {
      const res = await sweepExpiredCacheRecords();
      console.log(`[BotDeflector] Cache sweep complete: scanned ${res.scanned}, removed ${res.removed} expired keys.`);
    } catch (err) {
      console.warn('[BotDeflector] Cache sweep error:', err);
    }
  }
});

// Clean up session storage when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabDeflections(tabId);
});

// Helper to safely set badge text on a tab
async function updateTabBadge(tabId: number, count: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({
      tabId,
      text: count > 0 ? String(count) : ''
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: '#E53935' // Bauhaus Bold Red
    });
  } catch {
    // Tab may have closed before badge could be updated
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  (async () => {
    try {
      const response = await handleMessage(message, sender);
      sendResponse({ success: true, data: response });
    } catch (err: unknown) {
      console.error('[BotDeflector Service Worker Error]', err);
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  })();
  return true; // Keep message channel open for async response
});

async function handleMessage(message: BackgroundMessage, sender: chrome.runtime.MessageSender): Promise<any> {
  const settings = await getSettings();

  switch (message.type) {
    case 'CHECK_USERS': {
      const results: Record<string, ScoredUser> = {};
      const uncached: string[] = [];

      const cleanCandidates = Array.from(
        new Set(
          message.usernames
            .map((raw) => raw.replace(/^u\//, '').trim().toLowerCase())
            .filter((clean) => clean && clean !== '[deleted]')
        )
      );

      const cachedMap = await getCachedUsersBatch(cleanCandidates);
      let cacheHitCount = 0;

      for (const clean of cleanCandidates) {
        const cached = cachedMap.get(clean);
        if (cached) {
          results[clean] = cached;
          cacheHitCount++;
        } else {
          uncached.push(clean);
        }
      }

      if (cacheHitCount > 0) {
        await incrementStats({ cacheHits: cacheHitCount });
      }

      const tabId = sender.tab?.id;

      // Update tab session and badge immediately for cached deflected accounts
      if (tabId) {
        const deflectedCached = Object.values(results)
          .filter((user) => user.classification === 'DEFLECT')
          .map((u) => u.username);

        if (deflectedCached.length > 0) {
          const count = await addTabDeflectedUsers(tabId, deflectedCached);
          await updateTabBadge(tabId, count);
        }
      }

      // If caller explicitly requested awaitAll or sender is not a tab, await all evaluations
      const shouldAwaitAll = !tabId || (message as any).awaitAll === true;

      if (uncached.length > 0) {
        const evaluationPromise = processUncachedUsers(uncached, settings, tabId);

        if (shouldAwaitAll) {
          const freshResults = await evaluationPromise;
          Object.assign(results, freshResults);
        } else {
          // Fire and forget evaluation in background; results will stream back to the tab
          evaluationPromise.catch((err) => {
            console.warn('[BotDeflector] Background user evaluation error:', err);
          });
        }
      }

      // Return immediately so content script collapses cached bots with zero latency
      return results;
    }

    case 'CHECK_SUBMISSION': {
      if (!settings.enableSubmissionCheck) {
        return { isRepost: false };
      }

      const historicalPost = await searchSubredditHistoricalPosts(message.subreddit, message.title);
      let topComments: string[] = [];

      if (historicalPost) {
        topComments = await fetchHistoricalTopComments(historicalPost.id);
      }

      const opScored = scoreUser(
        message.author,
        undefined,
        undefined,
        undefined,
        message.title,
        {
          isExactTitleRepost: Boolean(historicalPost),
          deflectThreshold: settings.deflectThreshold,
          flagThreshold: settings.flagThreshold,
          userWhitelist: settings.whitelist
        }
      );

      return {
        isRepost: Boolean(historicalPost),
        originalPost: historicalPost,
        historicalComments: topComments,
        opScored
      };
    }

    case 'GET_SETTINGS':
      return await getSettings();

    case 'UPDATE_SETTINGS':
      return await updateSettings(message.settings);

    case 'BLOCK_USER': {
      const blockRes = await blockRedditUser(message.username);
      if (blockRes.success) {
        await incrementStats({ blocked: 1 });
        const cached = await getCachedUser(message.username);
        if (cached) {
          cached.isBlockedOnReddit = true;
          await setCachedUser(cached);
        }
      } else if (blockRes.quotaExceeded) {
        await incrementStats({ quotaExceeded: true });
      }
      return blockRes;
    }

    case 'GET_STATS':
      return await getStats();

    case 'GET_TAB_STATS': {
      const targetTabId = message.tabId || sender.tab?.id;
      if (!targetTabId) return { tabDeflectedCount: 0 };
      const count = await getTabDeflectedCount(targetTabId);
      return { tabDeflectedCount: count };
    }

    case 'ADD_WHITELIST': {
      const current = await getSettings();
      const clean = message.username.toLowerCase().replace(/^u\//, '');
      if (!current.whitelist.includes(clean)) {
        return await updateSettings({ whitelist: [...current.whitelist, clean] });
      }
      return current;
    }

    case 'REMOVE_WHITELIST': {
      const current = await getSettings();
      const clean = message.username.toLowerCase().replace(/^u\//, '');
      return await updateSettings({
        whitelist: current.whitelist.filter((u) => u !== clean)
      });
    }

    case 'INVALIDATE_USER': {
      await invalidateCachedUser(message.username);
      return { success: true };
    }

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

/**
 * Evaluates uncached users in the background with rate-limited requests,
 * saves to storage, updates tab session badge, and pushes results back to the active tab.
 */
async function processUncachedUsers(
  usernames: string[],
  settings: Awaited<ReturnType<typeof getSettings>>,
  tabId?: number
): Promise<Record<string, ScoredUser>> {
  const newlyScored: Record<string, ScoredUser> = {};

  for (const username of usernames) {
    try {
      const profile = await fetchUserProfile(username);
      let comments: any[] = [];

      if (profile) {
        const ageDays = (Date.now() / 1000 - profile.createdUtc) / 86400;
        const isSuspiciousProfile =
          (ageDays >= 60 && ageDays <= 1000 && profile.totalKarma < 150) ||
          (profile.linkKarma > 5000 && profile.commentKarma < 30) ||
          profile.totalKarma < 0;

        if (isSuspiciousProfile && settings.enableCadenceCheck) {
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
          deflectThreshold: settings.deflectThreshold,
          flagThreshold: settings.flagThreshold,
          userWhitelist: settings.whitelist
        }
      );

      // If user is deflected and auto-block is enabled, block them on Reddit
      if (scored.classification === 'DEFLECT' && settings.autoBlockReddit && !scored.isBlockedOnReddit) {
        const blockRes = await blockRedditUser(username);
        if (blockRes.success) {
          scored.isBlockedOnReddit = true;
          await incrementStats({ blocked: 1 });
        } else if (blockRes.quotaExceeded) {
          await incrementStats({ quotaExceeded: true });
        }
      }

      await setCachedUser(scored);
      await incrementStats({
        scanned: 1,
        deflected: scored.classification === 'DEFLECT' ? 1 : 0
      });

      newlyScored[username] = scored;

      // Update badge progressively if deflected
      if (tabId && scored.classification === 'DEFLECT') {
        const count = await addTabDeflectedUsers(tabId, [scored.username]);
        await updateTabBadge(tabId, count);
      }
    } catch (err) {
      console.warn(`[BotDeflector] Could not evaluate ${username}:`, err);
    }
  }

  // Push newly evaluated users back to the sender tab
  if (tabId && Object.keys(newlyScored).length > 0) {
    try {
      const pushMessage: TabMessage = {
        type: 'USERS_EVALUATED',
        users: newlyScored
      };
      await chrome.tabs.sendMessage(tabId, pushMessage);
    } catch {
      // Tab may have navigated or closed
    }
  }

  return newlyScored;
}
