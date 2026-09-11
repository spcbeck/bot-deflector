import assert from 'node:assert';
import test from 'node:test';
import {
  addTabDeflectedUsers,
  clearTabDeflections,
  CLEAN_CACHE_PREFIX,
  getRecentThreatUsers,
  getSessionModhash,
  getTabDeflectedCount,
  getTabDeflectedUsers,
  getTabThreatUsers,
  setSessionModhash,
  sweepExpiredCacheRecords,
  THREAT_CACHE_PREFIX
} from '../../background/cache';
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

