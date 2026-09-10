import { scoreUser } from '../engine/scorer';
import { BackgroundMessage, ScoredUser } from '../types';
import {
  getCachedUser,
  getSettings,
  getStats,
  incrementStats,
  setCachedUser,
  updateSettings
} from './cache';
import {
  fetchHistoricalTopComments,
  fetchUserComments,
  fetchUserProfile,
  searchSubredditHistoricalPosts
} from './fetcher';

// Map tabId -> Set of deflected usernames
const tabDeflectionMap = new Map<number, Set<string>>();

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

      for (const rawName of message.usernames) {
        const clean = rawName.replace(/^u\//, '').trim();
        if (!clean || clean === '[deleted]') continue;

        const cached = await getCachedUser(clean);
        if (cached) {
          results[clean] = cached;
          await incrementStats({ cacheHits: 1 });
        } else {
          uncached.push(clean);
        }
      }

      // Process uncached users through rate-limited fetcher
      for (const username of uncached) {
        try {
          const profile = await fetchUserProfile(username);
          let comments: any[] = [];

          if (profile) {
            // Smart Drilldown check:
            // Fetch comments if account is in the suspicious dormancy window (age 60d to 1000d with low karma),
            // or if account has high karma asymmetry or negative karma
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

          await setCachedUser(scored);
          await incrementStats({
            scanned: 1,
            deflected: scored.classification === 'DEFLECT' ? 1 : 0
          });

          results[username] = scored;
        } catch (err) {
          console.warn(`[BotDeflector] Could not evaluate ${username}:`, err);
        }
      }

      // Update badge for sender tab if applicable
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        const currentSet = tabDeflectionMap.get(tabId) || new Set<string>();

        for (const user of Object.values(results)) {
          if (user.classification === 'DEFLECT') {
            currentSet.add(user.username.toLowerCase());
          }
        }
        tabDeflectionMap.set(tabId, currentSet);

        const count = currentSet.size;
        await chrome.action.setBadgeText({
          tabId,
          text: count > 0 ? String(count) : ''
        });
        await chrome.action.setBadgeBackgroundColor({
          tabId,
          color: '#E53935' // Bauhaus Bold Red
        });
      }

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

    case 'GET_STATS':
      return await getStats();

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

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

// Clear tab map when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabDeflectionMap.delete(tabId);
});
