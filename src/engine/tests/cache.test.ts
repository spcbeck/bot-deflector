import assert from 'node:assert';
import test from 'node:test';
import {
  calculateConfidenceTier,
  scoreUser
} from '../scorer';
import {
  CLEAN_CACHE_PREFIX,
  THREAT_CACHE_PREFIX,
  TTL_THREAT_MS,
  TTL_TIER_1_MS,
  TTL_TIER_2_MS,
  TTL_TIER_3_MS,
  compactToScoredUser,
  getCachedUser,
  getCachedUsersBatch,
  invalidateCachedUser,
  isCleanRecordExpired,
  isThreatRecordExpired,
  setCachedUser
} from '../../background/cache';
import { CompactCleanRecord, RedditProfileData, ScoredUser } from '../../types';

test('1. Confidence Tier Calculation', () => {
  const threeYearsInSec = 3 * 365 * 86400;
  const oneYearInSec = 365 * 86400;
  const sixMonthsInSec = 180 * 86400;
  const twentyDaysInSec = 20 * 86400;

  // Tier 1: Whitelisted or Mod
  assert.strictEqual(calculateConfidenceTier(undefined, [], true, false), 1);
  assert.strictEqual(calculateConfidenceTier(undefined, [], false, true), 1);

  // Tier 1: 3+ years old with strong karma
  const profileIronclad: RedditProfileData = {
    username: 'veteran_user',
    createdUtc: (Date.now() / 1000) - threeYearsInSec - 100,
    linkKarma: 3000,
    commentKarma: 5000,
    totalKarma: 8000,
    bio: ''
  };
  assert.strictEqual(calculateConfidenceTier(profileIronclad), 1);

  // Tier 1: 1+ year old with > 10k karma
  const profileHighKarma: RedditProfileData = {
    username: 'high_karma_user',
    createdUtc: (Date.now() / 1000) - oneYearInSec - 100,
    linkKarma: 8000,
    commentKarma: 4000,
    totalKarma: 12000,
    bio: ''
  };
  assert.strictEqual(calculateConfidenceTier(profileHighKarma), 1);

  // Tier 2: 180+ days old with >= 100 karma
  const profileStandard: RedditProfileData = {
    username: 'standard_user',
    createdUtc: (Date.now() / 1000) - sixMonthsInSec - 100,
    linkKarma: 150,
    commentKarma: 200,
    totalKarma: 350,
    bio: ''
  };
  assert.strictEqual(calculateConfidenceTier(profileStandard), 2);

  // Tier 3: Young account (<60 days) or low karma
  const profileYoung: RedditProfileData = {
    username: 'new_arrival',
    createdUtc: (Date.now() / 1000) - twentyDaysInSec,
    linkKarma: 10,
    commentKarma: 20,
    totalKarma: 30,
    bio: ''
  };
  assert.strictEqual(calculateConfidenceTier(profileYoung), 3);
});

test('2. ScoreUser sets confidenceTier for clean accounts', () => {
  const threeYearsInSec = 3 * 365 * 86400;
  const profile: RedditProfileData = {
    username: 'organic_guy',
    createdUtc: (Date.now() / 1000) - threeYearsInSec - 100,
    linkKarma: 5000,
    commentKarma: 5000,
    totalKarma: 10000,
    bio: 'Hello world'
  };

  const scored = scoreUser('organic_guy', profile);
  assert.strictEqual(scored.classification, 'CLEAN');
  assert.strictEqual(scored.confidenceTier, 1);
});

test('3. Tiered TTL Expiration Validation', () => {
  const now = 1700000000000;

  // Tier 1 (90 days)
  const tier1Record: CompactCleanRecord = {
    username: 'tier1_user',
    evaluatedAt: now - TTL_TIER_1_MS + 1000, // 1 sec before expiry
    tier: 1,
    score: 0
  };
  assert.strictEqual(isCleanRecordExpired(tier1Record, now), false);

  const tier1Expired: CompactCleanRecord = {
    ...tier1Record,
    evaluatedAt: now - TTL_TIER_1_MS - 1000 // 1 sec after expiry
  };
  assert.strictEqual(isCleanRecordExpired(tier1Expired, now), true);

  // Tier 2 (30 days)
  const tier2Record: CompactCleanRecord = {
    username: 'tier2_user',
    evaluatedAt: now - TTL_TIER_2_MS + 1000,
    tier: 2,
    score: 5
  };
  assert.strictEqual(isCleanRecordExpired(tier2Record, now), false);

  const tier2Expired: CompactCleanRecord = {
    ...tier2Record,
    evaluatedAt: now - TTL_TIER_2_MS - 1000
  };
  assert.strictEqual(isCleanRecordExpired(tier2Expired, now), true);

  // Tier 3 (7 days)
  const tier3Record: CompactCleanRecord = {
    username: 'tier3_user',
    evaluatedAt: now - TTL_TIER_3_MS + 1000,
    tier: 3,
    score: 15
  };
  assert.strictEqual(isCleanRecordExpired(tier3Record, now), false);

  const tier3Expired: CompactCleanRecord = {
    ...tier3Record,
    evaluatedAt: now - TTL_TIER_3_MS - 1000
  };
  assert.strictEqual(isCleanRecordExpired(tier3Expired, now), true);

  // Threat TTL (14 days)
  const threatRecord: ScoredUser = {
    username: 'bad_bot',
    score: 85,
    classification: 'DEFLECT',
    breakdown: [],
    evaluatedAt: now - TTL_THREAT_MS + 1000
  };
  assert.strictEqual(isThreatRecordExpired(threatRecord, now), false);

  const threatExpired: ScoredUser = {
    ...threatRecord,
    evaluatedAt: now - TTL_THREAT_MS - 1000
  };
  assert.strictEqual(isThreatRecordExpired(threatExpired, now), true);
});

test('4. Compact Clean Record Reconstruction', () => {
  const compact: CompactCleanRecord = {
    username: 'alice',
    evaluatedAt: 1690000000000,
    tier: 1,
    score: 0
  };

  const restored = compactToScoredUser(compact);
  assert.strictEqual(restored.username, 'alice');
  assert.strictEqual(restored.classification, 'CLEAN');
  assert.strictEqual(restored.score, 0);
  assert.strictEqual(restored.confidenceTier, 1);
  assert.strictEqual(restored.evaluatedAt, 1690000000000);
  assert.deepStrictEqual(restored.breakdown, []);
});

test('5. Batch Cache Lookup and Storage Mock', async () => {
  const mockStorage: Record<string, any> = {};

  // Install temporary chrome.storage mock for test
  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const result: Record<string, any> = {};
          const keyArray = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArray) {
            if (k in mockStorage) {
              result[k] = mockStorage[k];
            }
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
    const cleanUser: ScoredUser = {
      username: 'good_user',
      score: 0,
      classification: 'CLEAN',
      breakdown: [],
      evaluatedAt: Date.now(),
      confidenceTier: 1
    };

    const threatUser: ScoredUser = {
      username: 'repost_bot',
      score: 90,
      classification: 'DEFLECT',
      breakdown: [],
      evaluatedAt: Date.now()
    };

    // Store users
    await setCachedUser(cleanUser);
    await setCachedUser(threatUser);

    // Verify keys stored compactly
    assert.ok(mockStorage[`${CLEAN_CACHE_PREFIX}good_user`]);
    assert.strictEqual(mockStorage[`${CLEAN_CACHE_PREFIX}good_user`].tier, 1);
    assert.ok(mockStorage[`${THREAT_CACHE_PREFIX}repost_bot`]);

    // Batch retrieval
    const batch = await getCachedUsersBatch(['u/good_user', 'u/repost_bot', 'u/unknown_user']);
    assert.strictEqual(batch.size, 2);
    assert.strictEqual(batch.get('good_user')?.classification, 'CLEAN');
    assert.strictEqual(batch.get('good_user')?.confidenceTier, 1);
    assert.strictEqual(batch.get('repost_bot')?.classification, 'DEFLECT');
    assert.strictEqual(batch.get('unknown_user'), undefined);

    // Invalidation (e.g. Local Heuristic Veto)
    await invalidateCachedUser('good_user');
    assert.strictEqual(mockStorage[`${CLEAN_CACHE_PREFIX}good_user`], undefined);

    const afterInvalidation = await getCachedUser('good_user');
    assert.strictEqual(afterInvalidation, null);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});
