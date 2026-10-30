import { scoreUser, shouldDrilldownComments } from '../engine/scorer';
import { BackgroundMessage, RedditCommentActivity, ScoredUser, TabMessage } from '../types';
import { logger } from '../core/logger';
import { blockRedditUser, fetchRedditBlockedUsers } from './blocker';
import {
  addBlockedUserToHistory,
  addTabDeflectedUsers,
  clearTabDeflections,
  ensureEngineCacheVersion,
  getBlockedUsersHistory,
  getCachedUser,
  getCachedUsersBatch,
  getEnrichedBlockedUsers,
  getKnownBotSet,
  getRecentThreatUsers,
  getSettings,
  getStats,
  getTabDeflectedCount,
  getTabThreatUsers,
  incrementStats,
  invalidateCachedUser,
  mergeKnownBots,
  saveBlockedUsersHistory,
  setCachedUser,
  sweepExpiredCacheRecords,
  updateSettings
} from './cache';
import {
  checkBotBouncerUser,
  fetchBotBouncerBannedBatch,
  fetchHistoricalTopComments,
  fetchUserComments,
  fetchUserProfile,
  searchSubredditHistoricalPosts
} from './fetcher';

// ---------------------------------------------------------------------------
// Scheduled Sync Task (r/BotBouncer Known Bot Feed & Reddit Blocked List)
// ---------------------------------------------------------------------------

export async function runScheduledBlocklistSync(): Promise<{
  botBouncerAdded: number;
  botBouncerTotal: number;
  redditBlockedSynced: number;
}> {
  let botBouncerAdded = 0;
  let botBouncerTotal = 0;
  let redditBlockedSynced = 0;

  try {
    const bannedBatch = await fetchBotBouncerBannedBatch();
    if (bannedBatch.length > 0) {
      const merged = await mergeKnownBots(bannedBatch);
      botBouncerAdded = merged.added;
      botBouncerTotal = merged.total;
    }
  } catch (err) {
    console.warn('[BotDeflector] Error syncing r/BotBouncer feed:', err);
  }

  try {
    const blocked = await fetchRedditBlockedUsers();
    if (blocked.length > 0) {
      await saveBlockedUsersHistory(blocked);
      redditBlockedSynced = blocked.length;
    }
  } catch (err) {
    console.warn('[BotDeflector] Error syncing Reddit blocked list:', err);
  }

  return { botBouncerAdded, botBouncerTotal, redditBlockedSynced };
}

// ---------------------------------------------------------------------------
// Lifecycle & Alarms Handlers
// ---------------------------------------------------------------------------

let engineMigrationPromise: Promise<number> | null = null;
function ensureEngineMigrated(): Promise<number> {
  if (!engineMigrationPromise) {
    engineMigrationPromise = ensureEngineCacheVersion();
  }
  return engineMigrationPromise;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[BotDeflector] Installed / Updated: ${details.reason}`);
  logger.info('BotDeflector background worker installed', { reason: details.reason });
  await ensureEngineMigrated();
  await getSettings();
  void runScheduledBlocklistSync();

  try {
    await chrome.alarms.create('cache_sweep_alarm', {
      periodInMinutes: 1440,
      delayInMinutes: 60
    });
    await chrome.alarms.create('blocklist_sync_alarm', {
      periodInMinutes: 360, // Every 6 hours
      delayInMinutes: 1     // Initial sync 1 minute after install/update
    });
  } catch (err) {
    console.warn('[BotDeflector] Could not register alarms:', err);
    logger.warn('Could not register alarms', { error: String(err) });
  }
});

chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === 'cache_sweep_alarm') {
    console.log('[BotDeflector] Running scheduled cache sweep...');
    try {
      const res = await sweepExpiredCacheRecords();
      console.log(`[BotDeflector] Cache sweep complete: scanned ${res.scanned}, removed ${res.removed} expired keys.`);
      logger.info('Cache sweep completed', { scanned: res.scanned, removed: res.removed });
    } catch (err) {
      console.warn('[BotDeflector] Cache sweep error:', err);
      logger.error('Cache sweep error', err as Error);
    }
  } else if (alarm.name === 'blocklist_sync_alarm') {
    console.log('[BotDeflector] Running scheduled blocklist & r/BotBouncer sync...');
    try {
      const syncRes = await runScheduledBlocklistSync();
      logger.info('Scheduled blocklist sync completed', syncRes);
    } catch (err) {
      console.warn('[BotDeflector] Scheduled blocklist sync error:', err);
      logger.error('Scheduled blocklist sync error', err as Error);
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
  await ensureEngineMigrated();
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

      // Update tab session and badge immediately for cached deflected or flagged accounts
      if (tabId) {
        const threatsCached = Object.values(results)
          .filter((user) => user.classification === 'DEFLECT' || user.classification === 'FLAG')
          .map((u) => u.username);

        if (threatsCached.length > 0) {
          const count = await addTabDeflectedUsers(tabId, threatsCached);
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

      const [historicalPost, opProfile, knownBotSet] = await Promise.all([
        searchSubredditHistoricalPosts(message.subreddit, message.title),
        fetchUserProfile(message.author).catch(() => null),
        getKnownBotSet()
      ]);
      let topComments: string[] = [];
      let opComments: RedditCommentActivity[] = [];

      if (historicalPost) {
        topComments = await fetchHistoricalTopComments(historicalPost.id);
      }

      if (
        opProfile &&
        settings.enableCadenceCheck &&
        shouldDrilldownComments(message.author, opProfile, settings.whitelist)
      ) {
        opComments = await fetchUserComments(message.author).catch(() => []);
      }

      const cleanAuthor = message.author.replace(/^u\//, '').trim().toLowerCase();
      const opScored = scoreUser(
        message.author,
        opProfile || undefined,
        opComments,
        undefined,
        message.title,
        {
          isOp: true,
          isExactTitleRepost: Boolean(historicalPost),
          isKnownBotDatabase: knownBotSet.has(cleanAuthor),
          deflectThreshold: settings.deflectThreshold,
          flagThreshold: settings.flagThreshold,
          userWhitelist: settings.whitelist
        }
      );

      await setCachedUser(opScored);
      await incrementStats({
        scanned: 1,
        deflected: opScored.classification === 'DEFLECT' ? 1 : 0
      });

      const tabId = sender.tab?.id;
      if (tabId && (opScored.classification === 'DEFLECT' || opScored.classification === 'FLAG')) {
        const count = await addTabDeflectedUsers(tabId, [opScored.username]);
        await updateTabBadge(tabId, count);
      }

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
        logger.info('Reddit user blocked', { username: message.username });
        await incrementStats({ blocked: 1 });
        await addBlockedUserToHistory(message.username);
        const cached = await getCachedUser(message.username);
        if (cached) {
          cached.isBlockedOnReddit = true;
          await setCachedUser(cached);
        }
      } else if (blockRes.quotaExceeded) {
        logger.warn('Reddit block quota exceeded', { username: message.username });
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

    case 'GET_CAUGHT_BOTS': {
      const targetTabId = message.tabId || sender.tab?.id;
      const tabBots = targetTabId ? await getTabThreatUsers(targetTabId) : [];
      const recentBots = await getRecentThreatUsers(30);
      return { tabBots, recentBots };
    }

    case 'GET_BLOCKED_USERS': {
      let history = await getBlockedUsersHistory();
      if (message.forceSync || history.length === 0) {
        const fresh = await fetchRedditBlockedUsers();
        if (fresh.length > 0) {
          history = fresh;
          await saveBlockedUsersHistory(history);
        }
      }

      const enriched = await getEnrichedBlockedUsers(history);
      return { blocked: enriched };
    }

    case 'RECORD_DEFLECTION': {
      const scored: ScoredUser = {
        username: message.username,
        score: message.points,
        classification: 'DEFLECT',
        breakdown: message.breakdown || [
          {
            ruleId: 'accomplice_comment_theft',
            category: 'syndicate',
            name: 'Accomplice Comment Hijacking',
            points: message.points,
            description: 'Word-for-word copy of top comment from original historical thread'
          }
        ],
        evaluatedAt: Date.now()
      };
      await setCachedUser(scored);
      await incrementStats({ deflected: 1 });
      const tabId = sender.tab?.id;
      if (tabId) {
        const count = await addTabDeflectedUsers(tabId, [scored.username]);
        await updateTabBadge(tabId, count);
      }
      return { success: true };
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

    case 'SYNC_BOT_DATABASE': {
      return await runScheduledBlocklistSync();
    }

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function pushEvaluatedUsersToTab(tabId: number, batch: Record<string, ScoredUser>): Promise<void> {
  if (Object.keys(batch).length === 0) return;
  try {
    const pushMessage: TabMessage = {
      type: 'USERS_EVALUATED',
      users: { ...batch }
    };
    await chrome.tabs.sendMessage(tabId, pushMessage);
  } catch {
    // Tab may have navigated or closed
  }
}

interface PendingUserTask {
  cleanName: string;
  tabIds: Set<number>;
  promise: Promise<ScoredUser | null>;
  resolve: (val: ScoredUser | null) => void;
}

const pendingEvaluationOrder: string[] = [];
const pendingUserTasks = new Map<string, PendingUserTask>();
const inFlightUserTasks = new Map<string, PendingUserTask>();
let isDrainingScheduler = false;
const tabPendingPushBatches = new Map<number, Record<string, ScoredUser>>();

async function flushTabPushBatch(tabId: number): Promise<void> {
  const batch = tabPendingPushBatches.get(tabId);
  if (!batch || Object.keys(batch).length === 0) return;
  tabPendingPushBatches.delete(tabId);
  await pushEvaluatedUsersToTab(tabId, batch);
}

async function evaluateSingleUser(
  cleanName: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  knownBotSet: Set<string>
): Promise<ScoredUser | null> {
  // Double-check cache in case user was evaluated while waiting in queue
  const alreadyCached = await getCachedUser(cleanName);
  if (alreadyCached) return alreadyCached;

  let isKnownBot = knownBotSet.has(cleanName);
  const profile = await fetchUserProfile(cleanName);
  let comments: RedditCommentActivity[] = [];

  if (profile && settings.enableCadenceCheck && shouldDrilldownComments(cleanName, profile, settings.whitelist)) {
    comments = await fetchUserComments(cleanName, true);
  }

  let scored = scoreUser(
    cleanName,
    profile || undefined,
    comments,
    undefined,
    undefined,
    {
      deflectThreshold: settings.deflectThreshold,
      flagThreshold: settings.flagThreshold,
      userWhitelist: settings.whitelist,
      isKnownBotDatabase: isKnownBot
    }
  );

  // For borderline FLAG accounts not yet in our local synced database, verify against r/BotBouncer on demand
  if (scored.classification === 'FLAG' && !isKnownBot) {
    const confirmedOnBotBouncer = await checkBotBouncerUser(cleanName, true);
    if (confirmedOnBotBouncer) {
      isKnownBot = true;
      knownBotSet.add(cleanName);
      await mergeKnownBots([cleanName]);
      scored = scoreUser(
        cleanName,
        profile || undefined,
        comments,
        undefined,
        undefined,
        {
          deflectThreshold: settings.deflectThreshold,
          flagThreshold: settings.flagThreshold,
          userWhitelist: settings.whitelist,
          isKnownBotDatabase: true
        }
      );
    }
  }

  // If user is deflected and auto-block is enabled, block them on Reddit
  if (scored.classification === 'DEFLECT' && settings.autoBlockReddit && !scored.isBlockedOnReddit) {
    const blockRes = await blockRedditUser(cleanName);
    if (blockRes.success) {
      scored.isBlockedOnReddit = true;
      logger.info('Reddit bot account auto-blocked', { username: scored.username });
      await incrementStats({ blocked: 1 });
      await addBlockedUserToHistory(scored.username);
    } else if (blockRes.quotaExceeded) {
      logger.warn('Reddit auto-block quota exceeded', { username: scored.username });
      await incrementStats({ quotaExceeded: true });
    }
  }

  if (scored.classification === 'DEFLECT') {
    logger.info('Reddit bot account deflected', {
      username: scored.username,
      score: scored.score,
      breakdownCount: scored.breakdown.length,
      rules: scored.breakdown.map((b) => b.name)
    });
  }

  await setCachedUser(scored);
  await incrementStats({
    scanned: 1,
    deflected: scored.classification === 'DEFLECT' ? 1 : 0
  });

  return scored;
}

async function drainEvaluationScheduler(): Promise<void> {
  if (isDrainingScheduler) return;
  isDrainingScheduler = true;

  try {
    while (pendingEvaluationOrder.length > 0) {
      const nextClean = pendingEvaluationOrder.shift();
      if (!nextClean) continue;

      const task = pendingUserTasks.get(nextClean);
      if (!task) continue;

      pendingUserTasks.delete(nextClean);
      inFlightUserTasks.set(nextClean, task);

      try {
        const [settings, knownBotSet] = await Promise.all([getSettings(), getKnownBotSet()]);
        const scored = await evaluateSingleUser(nextClean, settings, knownBotSet);
        task.resolve(scored);

        if (scored) {
          for (const tabId of task.tabIds) {
            const batch = tabPendingPushBatches.get(tabId) || {};
            batch[nextClean] = scored;
            tabPendingPushBatches.set(tabId, batch);

            if (scored.classification === 'DEFLECT' || scored.classification === 'FLAG') {
              const count = await addTabDeflectedUsers(tabId, [scored.username]);
              await updateTabBadge(tabId, count);
            }

            if (
              scored.classification === 'DEFLECT' ||
              scored.classification === 'FLAG' ||
              Object.keys(batch).length >= 3 ||
              pendingEvaluationOrder.length === 0
            ) {
              await flushTabPushBatch(tabId);
            }
          }
        }
      } catch (err) {
        console.warn(`[BotDeflector] Could not evaluate ${nextClean}:`, err);
        logger.warn(`Could not evaluate user ${nextClean}`, { error: String(err) });
        task.resolve(null);
      } finally {
        inFlightUserTasks.delete(nextClean);
      }
    }

    // Flush any remaining partial batches across all tabs
    for (const tabId of Array.from(tabPendingPushBatches.keys())) {
      await flushTabPushBatch(tabId);
    }
  } finally {
    isDrainingScheduler = false;
    if (pendingEvaluationOrder.length > 0) {
      void drainEvaluationScheduler();
    }
  }
}

/**
 * Schedules uncached users with viewport-front prioritization (newest scroll batch first),
 * deduplicates concurrent requests, and streams results progressively to the active tab.
 */
async function processUncachedUsers(
  usernames: string[],
  _settings: Awaited<ReturnType<typeof getSettings>>,
  tabId?: number
): Promise<Record<string, ScoredUser>> {
  const cleanList = Array.from(
    new Set(
      usernames
        .map((u) => u.replace(/^u\//, '').trim().toLowerCase())
        .filter((u) => u && u !== '[deleted]')
    )
  );

  const taskPromises: Array<Promise<[string, ScoredUser | null]>> = [];
  const toPrepend: string[] = [];

  for (const cleanName of cleanList) {
    const existingInFlight = inFlightUserTasks.get(cleanName);
    if (existingInFlight) {
      if (tabId !== undefined) existingInFlight.tabIds.add(tabId);
      taskPromises.push(existingInFlight.promise.then((res) => [cleanName, res]));
      continue;
    }

    let pendingTask = pendingUserTasks.get(cleanName);
    if (!pendingTask) {
      let resolveFn!: (val: ScoredUser | null) => void;
      const promise = new Promise<ScoredUser | null>((resolve) => {
        resolveFn = resolve;
      });
      pendingTask = {
        cleanName,
        tabIds: new Set<number>(),
        promise,
        resolve: resolveFn
      };
      pendingUserTasks.set(cleanName, pendingTask);
    } else {
      // Remove from old position so we can promote it to the front in the new viewport order
      const idx = pendingEvaluationOrder.indexOf(cleanName);
      if (idx !== -1) {
        pendingEvaluationOrder.splice(idx, 1);
      }
    }

    if (tabId !== undefined) {
      pendingTask.tabIds.add(tabId);
    }
    toPrepend.push(cleanName);
    taskPromises.push(pendingTask.promise.then((res) => [cleanName, res]));
  }

  if (toPrepend.length > 0) {
    // Promote newest viewport-sorted batch to the front of the evaluation queue
    pendingEvaluationOrder.unshift(...toPrepend);
    void drainEvaluationScheduler();
  }

  const resolvedEntries = await Promise.all(taskPromises);
  const newlyScored: Record<string, ScoredUser> = {};
  for (const [name, scored] of resolvedEntries) {
    if (scored) {
      newlyScored[name] = scored;
    }
  }
  return newlyScored;
}
