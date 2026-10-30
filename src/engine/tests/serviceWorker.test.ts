import assert from 'node:assert';
import test from 'node:test';
import {
  addBlockedUserToHistory,
  addTabDeflectedUsers,
  clearTabDeflections,
  CLEAN_CACHE_PREFIX,
  getBlockedUsersHistory,
  getEnrichedBlockedUsers,
  getKnownBotSet,
  getRecentThreatUsers,
  getSessionModhash,
  getStats,
  getTabDeflectedCount,
  getTabDeflectedUsers,
  getTabThreatUsers,
  incrementStats,
  LEGACY_CACHE_PREFIX,
  mergeKnownBots,
  saveBlockedUsersHistory,
  setSessionModhash,
  sweepExpiredCacheRecords,
  THREAT_CACHE_PREFIX
} from '../../background/cache';
import { parseBotBouncerListing } from '../../background/fetcher';
import { RateLimitError, RequestQueue } from '../../background/rateLimiter';
import { scoreUser } from '../scorer';
import { CompactCleanRecord, RedditProfileData, ScoredUser } from '../../types';

test('SW-1: Daily Cache Sweep Prunes Expired Records', async () => {
  const mockStorage: Record<string, any> = {};

  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null) return { ...mockStorage };
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        },
        remove: async (keys: string | string[]) => {
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            delete mockStorage[k];
          }
        }
      }
    }
  };

  try {
    const now = Date.now();

    // 1. Valid clean record (evaluated 1 day ago, tier 3 TTL = 7 days)
    const validClean: CompactCleanRecord = {
      username: 'fresh_human',
      evaluatedAt: now - (24 * 60 * 60 * 1000),
      tier: 3,
      score: 0
    };
    mockStorage[`${CLEAN_CACHE_PREFIX}fresh_human`] = validClean;

    // 2. Expired clean record (evaluated 10 days ago, tier 3 TTL = 7 days)
    const expiredClean: CompactCleanRecord = {
      username: 'stale_clean',
      evaluatedAt: now - (10 * 24 * 60 * 60 * 1000),
      tier: 3,
      score: 0
    };
    mockStorage[`${CLEAN_CACHE_PREFIX}stale_clean`] = expiredClean;

    // 3. Valid threat record (evaluated 3 days ago, TTL = 14 days)
    const validThreat: ScoredUser = {
      username: 'active_bot',
      score: 85,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: now - (3 * 24 * 60 * 60 * 1000)
    };
    mockStorage[`${THREAT_CACHE_PREFIX}active_bot`] = validThreat;

    // 4. Expired threat record (evaluated 20 days ago, TTL = 14 days)
    const expiredThreat: ScoredUser = {
      username: 'ancient_bot',
      score: 95,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: now - (20 * 24 * 60 * 60 * 1000)
    };
    mockStorage[`${THREAT_CACHE_PREFIX}ancient_bot`] = expiredThreat;

    const sweepResult = await sweepExpiredCacheRecords(now);
    assert.strictEqual(sweepResult.scanned, 4);
    assert.strictEqual(sweepResult.removed, 2);

    // Verify correct keys retained
    assert.ok(mockStorage[`${CLEAN_CACHE_PREFIX}fresh_human`]);
    assert.ok(mockStorage[`${THREAT_CACHE_PREFIX}active_bot`]);

    // Verify expired keys removed
    assert.strictEqual(mockStorage[`${CLEAN_CACHE_PREFIX}stale_clean`], undefined);
    assert.strictEqual(mockStorage[`${THREAT_CACHE_PREFIX}ancient_bot`], undefined);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-2: Session Storage Tab Deflection State Survives Restarts', async () => {
  const tabId = 1234;

  // Add initial batch of deflected users
  const count1 = await addTabDeflectedUsers(tabId, ['u/Bot_One', 'u/Bot_Two']);
  assert.strictEqual(count1, 2);

  let users = await getTabDeflectedUsers(tabId);
  assert.deepStrictEqual(users.sort(), ['bot_one', 'bot_two']);

  // Add subsequent batch with duplicate
  const count2 = await addTabDeflectedUsers(tabId, ['u/bot_two', 'u/Bot_Three']);
  assert.strictEqual(count2, 3);

  const totalCount = await getTabDeflectedCount(tabId);
  assert.strictEqual(totalCount, 3);

  // Clear tab on tab close
  await clearTabDeflections(tabId);
  const clearedCount = await getTabDeflectedCount(tabId);
  assert.strictEqual(clearedCount, 0);
});

test('SW-3: Modhash Session Persistence and Expiry', async () => {
  const modhash = 'test_modhash_12345';
  const now = Date.now();

  // Set modhash valid for 30 minutes
  await setSessionModhash(modhash, now + (30 * 60 * 1000));

  const session = await getSessionModhash();
  assert.ok(session);
  assert.strictEqual(session?.modhash, modhash);
});

test('SW-4: Young Account Probationary Dampener Prevents False Positives', () => {
  // Account with ONLY circumstantial baseline traits:
  // Brand new (< 48h = 40 pts) + Default Auto-Username (15 pts) + Low Karma (25 pts) = 80 pts!
  const profileInnocent: RedditProfileData = {
    username: 'Friendly-Ad-8821',
    createdUtc: Math.floor(Date.now() / 1000) - 3600, // 1 hour old
    linkKarma: 1,
    commentKarma: 0,
    totalKarma: 1,
    bio: ''
  };

  const scoredInnocent = scoreUser(
    profileInnocent.username,
    profileInnocent,
    [],
    'I really love this subreddit!'
  );

  // Because there are NO affirmative spam signals (repost, artifact, merch link, bio funnel, cadence),
  // the score must be capped below deflectThreshold (70) and classified as FLAG for review rather than DEFLECT
  assert.strictEqual(scoredInnocent.classification, 'FLAG');
  assert.ok(scoredInnocent.score < 70, `Score was ${scoredInnocent.score}, expected < 70`);
  assert.ok(scoredInnocent.score >= 40, `Score was ${scoredInnocent.score}, expected >= 40`);

  // If the same account DOES have an affirmative spam signal (e.g. unescaped HTML scraper entity):
  const scoredSpammer = scoreUser(
    profileInnocent.username,
    profileInnocent,
    [],
    'Here is the link &amp; details for the event'
  );

  assert.strictEqual(scoredSpammer.classification, 'DEFLECT');
  assert.ok(scoredSpammer.score >= 70, `Score was ${scoredSpammer.score}, expected >= 70`);
});

test('SW-5: Tab Threat Users Retrieval retrieves stored and synthetic tab deflections', async () => {
  const tabId = 555;
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null) return { ...mockStorage };
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        }
      }
    }
  };

  try {
    const now = Date.now();
    const scored1: ScoredUser = {
      username: 'bot_alpha',
      score: 90,
      classification: 'DEFLECT',
      breakdown: [{ ruleId: 'cadence', category: 'cadence', name: 'Inhuman Velocity', points: 50, description: '' }],
      evaluatedAt: now - 5000
    };
    mockStorage[`${THREAT_CACHE_PREFIX}bot_alpha`] = scored1;

    // Add bot_alpha and an un-persisted bot_beta to tab
    await addTabDeflectedUsers(tabId, ['u/bot_alpha', 'u/bot_beta']);

    const tabThreats = await getTabThreatUsers(tabId);
    assert.strictEqual(tabThreats.length, 2);

    const alpha = tabThreats.find((t) => t.username === 'bot_alpha');
    assert.ok(alpha);
    assert.strictEqual(alpha?.score, 90);
    assert.strictEqual(alpha?.breakdown[0].name, 'Inhuman Velocity');

    const beta = tabThreats.find((t) => t.username === 'bot_beta');
    assert.ok(beta);
    assert.strictEqual(beta?.classification, 'DEFLECT');
  } finally {
    await clearTabDeflections(tabId);
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-6: Recent Threat Users Retrieval filters expired, deduplicates, and sorts by evaluatedAt', async () => {
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null) return { ...mockStorage };
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        }
      }
    }
  };

  try {
    const now = Date.now();

    // Threat 1: Most recent
    mockStorage[`${THREAT_CACHE_PREFIX}spambot_new`] = {
      username: 'spambot_new',
      score: 95,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: now - 1000
    };

    // Threat 2: Older but valid
    mockStorage[`${THREAT_CACHE_PREFIX}spambot_old`] = {
      username: 'spambot_old',
      score: 80,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: now - 100000
    };

    // Threat 3: Expired threat (evaluated 30 days ago, TTL = 14 days)
    mockStorage[`${THREAT_CACHE_PREFIX}spambot_expired`] = {
      username: 'spambot_expired',
      score: 85,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: now - (30 * 24 * 60 * 60 * 1000)
    };

    const recent = await getRecentThreatUsers(10);
    assert.strictEqual(recent.length, 2);
    assert.strictEqual(recent[0].username, 'spambot_new');
    assert.strictEqual(recent[1].username, 'spambot_old');
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-7: Legacy Cache Migration & Blocked User History Persistence', async () => {
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null) return { ...mockStorage };
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        },
        set: async (items: Record<string, any>) => {
          Object.assign(mockStorage, items);
        },
        remove: async (keys: string | string[]) => {
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            delete mockStorage[k];
          }
        }
      }
    }
  };

  try {
    const now = Date.now();

    // 1. Put legacy bot in storage
    mockStorage[`${LEGACY_CACHE_PREFIX}old_caught_bot`] = {
      username: 'old_caught_bot',
      score: 88,
      classification: 'DEFLECT',
      breakdown: [{ ruleId: 'cadence', category: 'cadence', name: 'Inhuman Cadence', points: 50, description: '' }],
      evaluatedAt: now - 5000
    };

    const threats = await getRecentThreatUsers(10);
    const migrated = threats.find((t) => t.username === 'old_caught_bot');
    assert.ok(migrated);
    assert.strictEqual(migrated?.score, 88);

    // Verify migrated into THREAT_CACHE_PREFIX and deleted from LEGACY
    assert.ok(mockStorage[`${THREAT_CACHE_PREFIX}old_caught_bot`]);
    assert.strictEqual(mockStorage[`${LEGACY_CACHE_PREFIX}old_caught_bot`], undefined);

    // 2. Test blocked user history persistence
    const blockedData = [
      { username: 'banned_spammer_1', date: 1726078884000 },
      { username: 'banned_spammer_2', date: 1726078800000 }
    ];
    await saveBlockedUsersHistory(blockedData);

    const retrieved = await getBlockedUsersHistory();
    assert.strictEqual(retrieved.length, 2);
    assert.strictEqual(retrieved[0].username, 'banned_spammer_1');
    assert.strictEqual(retrieved[1].username, 'banned_spammer_2');
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-8: Concurrent incrementStats calls serialize without race condition', async () => {
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        },
        set: async (items: Record<string, any>) => {
          Object.assign(mockStorage, items);
        }
      }
    }
  };

  try {
    await Promise.all([
      incrementStats({ scanned: 1, deflected: 1 }),
      incrementStats({ scanned: 1, deflected: 0 }),
      incrementStats({ cacheHits: 5 }),
      incrementStats({ blocked: 1 })
    ]);

    const finalStats = await getStats();
    assert.strictEqual(finalStats.scannedCount, 2);
    assert.strictEqual(finalStats.deflectedCount, 1);
    assert.strictEqual(finalStats.cacheHitCount, 5);
    assert.strictEqual(finalStats.blockedCount, 1);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-9: r/BotBouncer Listing Parser & Scheduled Known Bot Database Sync', async () => {
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        },
        set: async (items: Record<string, any>) => {
          Object.assign(mockStorage, items);
        }
      }
    }
  };

  try {
    const sampleListing = [
      { data: { title: 'Overview for Spam_Bot_9000', link_flair_text: 'Banned' } },
      { data: { title: 'Overview for Repost_Farm_42', link_flair_text: 'Banned', link_flair_css_class: 'banned' } },
      { data: { title: 'Overview for Real_Human_User', link_flair_text: 'Organic' } },
      { data: { title: 'Overview for Under_Review_User', link_flair_text: 'Pending' } },
      { data: { title: 'Weekly BotBouncer Status Thread', link_flair_text: 'Announcement' } }
    ];

    const parsedBanned = parseBotBouncerListing(sampleListing);
    assert.deepStrictEqual(parsedBanned.sort(), ['repost_farm_42', 'spam_bot_9000']);

    const syncRes1 = await mergeKnownBots(parsedBanned);
    assert.strictEqual(syncRes1.added, 2);
    assert.strictEqual(syncRes1.total, 2);

    // Second sync with 1 overlap and 1 new bot
    const syncRes2 = await mergeKnownBots(['Spam_Bot_9000', 'u/New_Bot_11']);
    assert.strictEqual(syncRes2.added, 1);
    assert.strictEqual(syncRes2.total, 3);

    const botSet = await getKnownBotSet();
    assert.strictEqual(botSet.has('spam_bot_9000'), true);
    assert.strictEqual(botSet.has('new_bot_11'), true);
    assert.strictEqual(botSet.has('real_human_user'), false);

    // Scoring a user matched in the synced bot database immediately classifies as DEFLECT
    const scoredDbBot = scoreUser('Spam_Bot_9000', undefined, [], undefined, undefined, {
      isKnownBotDatabase: botSet.has('spam_bot_9000')
    });
    assert.strictEqual(scoredDbBot.classification, 'DEFLECT');
    assert.ok(scoredDbBot.breakdown.some((b) => b.ruleId === 'botbouncer_database_hit'));
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-10: Enriched Blocked Users prioritizes BotDeflector threat breakdowns and sorts newest-first', async () => {
  const originalChrome = (globalThis as any).chrome;
  const mockStorage: Record<string, any> = {};

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null) return { ...mockStorage };
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) result[k] = mockStorage[k];
          }
          return result;
        },
        set: async (items: Record<string, any>) => {
          Object.assign(mockStorage, items);
        }
      }
    }
  };

  try {
    const now = Date.now();

    // Historical Reddit blocks in chronological (oldest-first) order as returned by Reddit
    await saveBlockedUsersHistory([
      { username: 'NerdyRareGem', date: new Date('2023-05-12').getTime() },
      { username: 'Lost-Letterhead879', date: new Date('2023-10-24').getTime() },
      { username: 'RecentManualBlock', date: now - 60000 }
    ]);

    // BotDeflector caught & auto-blocked bot (in threat cache with breakdown)
    const caughtBot: ScoredUser = {
      username: 'CaughtBot_1',
      score: 90,
      classification: 'DEFLECT',
      isBlockedOnReddit: true,
      breakdown: [
        { ruleId: 'cadence', category: 'cadence', name: 'Inhuman Velocity', points: 50, description: '' }
      ],
      evaluatedAt: now - 120000
    };
    mockStorage[`${THREAT_CACHE_PREFIX}caughtbot_1`] = caughtBot;

    // Newly blocked user via addBlockedUserToHistory
    await addBlockedUserToHistory('CaughtBot_2', now - 10000);
    mockStorage[`${THREAT_CACHE_PREFIX}caughtbot_2`] = {
      username: 'CaughtBot_2',
      score: 85,
      classification: 'DEFLECT',
      isBlockedOnReddit: true,
      breakdown: [
        { ruleId: 'repost', category: 'submission', name: 'Exact Title Repost', points: 60, description: '' }
      ],
      evaluatedAt: now - 10000
    } satisfies ScoredUser;

    const enriched = await getEnrichedBlockedUsers();

    // 1. Accounts with a BotDeflector breakdown appear at the very top (newest first)
    assert.strictEqual(enriched[0].username, 'CaughtBot_2');
    assert.ok(enriched[0].scoredUser);
    assert.strictEqual(enriched[1].username, 'CaughtBot_1');
    assert.ok(enriched[1].scoredUser);

    // 2. Remaining manual Reddit blocks appear sorted newest-first (not 2023 oldest-first)
    assert.strictEqual(enriched[2].username, 'RecentManualBlock');
    assert.strictEqual(enriched[3].username, 'Lost-Letterhead879');
    assert.strictEqual(enriched[4].username, 'NerdyRareGem');
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('SW-11: Adaptive RequestQueue predicts 429 from headers/burst, prioritizes tasks, and retries on 429', async () => {
  const queue = new RequestQueue({ baseDelayMs: 5, maxRequestsPerMinute: 3 });
  const now = 1_700_000_000_000;

  // 1. Server header prediction: when x-ratelimit-remaining <= 1, pre-emptively wait until reset
  queue.updateFromResponse(
    {
      headers: {
        get: (name: string) => {
          if (name === 'x-ratelimit-remaining') return '1';
          if (name === 'x-ratelimit-reset') return '8';
          return null;
        }
      }
    },
    now
  );
  assert.strictEqual(queue.getPredictiveWaitMs(now), 8000);

  // 2. Smooth adaptive pacing when remaining is low (e.g. 5 remaining over 10 seconds -> ~1667ms spacing)
  queue.updateFromResponse(
    {
      headers: {
        get: (name: string) => {
          if (name === 'x-ratelimit-remaining') return '5';
          if (name === 'x-ratelimit-reset') return '10';
          return null;
        }
      }
    },
    now
  );
  assert.strictEqual(queue.getPredictiveWaitMs(now), 0);
  const adaptiveDelay = queue.getAdaptiveDelayMs(now);
  assert.ok(adaptiveDelay >= 1500 && adaptiveDelay <= 2000, `Expected ~1667ms adaptive delay, got ${adaptiveDelay}`);

  // 3. Priority execution & automatic retry on 429 without dropping task
  const fastQueue = new RequestQueue({ baseDelayMs: 5, maxRequestsPerMinute: 100 });
  const order: string[] = [];
  let attempts = 0;

  const p1 = fastQueue.enqueue(async () => {
    order.push('first');
    return 'ok1';
  });
  const pNormal = fastQueue.enqueue(async () => {
    order.push('normal');
    return 'okNormal';
  });
  const pPriority = fastQueue.enqueue(
    async () => {
      attempts++;
      if (attempts === 1) {
        order.push('priority-429');
        throw new RateLimitError('HTTP 429', 10); // Will clamp to 2000ms min cooldown and retry
      }
      order.push('priority-recovered');
      return 'okPriority';
    },
    { priority: true }
  );

  const [r1, rPriority, rNormal] = await Promise.all([p1, pPriority, pNormal]);
  assert.strictEqual(r1, 'ok1');
  assert.strictEqual(rPriority, 'okPriority');
  assert.strictEqual(rNormal, 'okNormal');
  assert.deepStrictEqual(order, ['first', 'priority-429', 'priority-recovered', 'normal']);
});




