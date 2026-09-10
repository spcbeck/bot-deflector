import {
  CompactCleanRecord,
  DeflectorStats,
  ExtensionSettings,
  ScoredUser
} from '../types';

export const CLEAN_CACHE_PREFIX = 'clean_user_';
export const THREAT_CACHE_PREFIX = 'threat_user_';
export const LEGACY_CACHE_PREFIX = 'user_cache_';
const SETTINGS_KEY = 'deflector_settings';
const STATS_KEY = 'deflector_stats';

// Tiered TTLs
export const TTL_TIER_1_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (Ironclad organic human)
export const TTL_TIER_2_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (Standard organic human)
export const TTL_TIER_3_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days (Borderline or young account)
export const TTL_THREAT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (Deflected or flagged bots)

export const DEFAULT_SETTINGS: ExtensionSettings = {
  deflectThreshold: 70,
  flagThreshold: 40,
  mode: 'STEALTH_COLLAPSE',
  enableSubmissionCheck: true,
  enableCadenceCheck: true,
  autoBlockReddit: true,
  whitelist: []
};

export const DEFAULT_STATS: DeflectorStats = {
  deflectedCount: 0,
  scannedCount: 0,
  cacheHitCount: 0,
  blockedCount: 0,
  quotaExceeded: false,
  lastActive: Date.now()
};

export function compactToScoredUser(record: CompactCleanRecord): ScoredUser {
  return {
    username: record.username,
    score: record.score ?? 0,
    classification: 'CLEAN',
    breakdown: [],
    evaluatedAt: record.evaluatedAt,
    confidenceTier: record.tier
  };
}

export function isCleanRecordExpired(record: CompactCleanRecord, now = Date.now()): boolean {
  const ttl =
    record.tier === 1 ? TTL_TIER_1_MS : record.tier === 2 ? TTL_TIER_2_MS : TTL_TIER_3_MS;
  return now - record.evaluatedAt > ttl;
}

export function isThreatRecordExpired(record: ScoredUser, now = Date.now()): boolean {
  return now - record.evaluatedAt > TTL_THREAT_MS;
}

export async function getCachedUsersBatch(usernames: string[]): Promise<Map<string, ScoredUser>> {
  const results = new Map<string, ScoredUser>();
  if (!usernames.length) return results;

  const cleanedNames = usernames.map((u) => u.toLowerCase().replace(/^u\//, '').trim()).filter(Boolean);
  if (!cleanedNames.length) return results;

  const keysToFetch: string[] = [];
  for (const name of cleanedNames) {
    keysToFetch.push(`${CLEAN_CACHE_PREFIX}${name}`);
    keysToFetch.push(`${THREAT_CACHE_PREFIX}${name}`);
    keysToFetch.push(`${LEGACY_CACHE_PREFIX}${name}`);
  }

  const stored = await chrome.storage.local.get(keysToFetch);
  const now = Date.now();
  const keysToRemove: string[] = [];
  const keysToMigrate: Record<string, unknown> = {};

  for (const name of cleanedNames) {
    const cleanKey = `${CLEAN_CACHE_PREFIX}${name}`;
    const threatKey = `${THREAT_CACHE_PREFIX}${name}`;
    const legacyKey = `${LEGACY_CACHE_PREFIX}${name}`;

    // 1. Check compact clean cache
    const cleanRecord = stored[cleanKey] as CompactCleanRecord | undefined;
    if (cleanRecord) {
      if (isCleanRecordExpired(cleanRecord, now)) {
        keysToRemove.push(cleanKey);
      } else {
        results.set(name, compactToScoredUser(cleanRecord));
        continue;
      }
    }

    // 2. Check threat cache
    const threatRecord = stored[threatKey] as ScoredUser | undefined;
    if (threatRecord) {
      if (isThreatRecordExpired(threatRecord, now)) {
        keysToRemove.push(threatKey);
      } else {
        results.set(name, threatRecord);
        continue;
      }
    }

    // 3. Check legacy cache (user_cache_*)
    const legacyRecord = stored[legacyKey] as ScoredUser | undefined;
    if (legacyRecord) {
      keysToRemove.push(legacyKey);
      if (legacyRecord.classification === 'CLEAN') {
        const tier = legacyRecord.confidenceTier || 3;
        const compact: CompactCleanRecord = {
          username: name,
          evaluatedAt: legacyRecord.evaluatedAt,
          tier,
          score: legacyRecord.score
        };
        if (!isCleanRecordExpired(compact, now)) {
          results.set(name, compactToScoredUser(compact));
          keysToMigrate[cleanKey] = compact;
        }
      } else {
        if (!isThreatRecordExpired(legacyRecord, now)) {
          results.set(name, legacyRecord);
          keysToMigrate[threatKey] = legacyRecord;
        }
      }
    }
  }

  // Asynchronously clean up expired or migrated keys
  if (keysToRemove.length > 0) {
    chrome.storage.local.remove(keysToRemove).catch((err) => {
      console.warn('[BotDeflector] Error removing stale cache keys:', err);
    });
  }
  if (Object.keys(keysToMigrate).length > 0) {
    chrome.storage.local.set(keysToMigrate).catch((err) => {
      console.warn('[BotDeflector] Error migrating legacy cache keys:', err);
    });
  }

  return results;
}

export async function getCachedUser(username: string): Promise<ScoredUser | null> {
  const clean = username.toLowerCase().replace(/^u\//, '').trim();
  if (!clean) return null;
  const batch = await getCachedUsersBatch([clean]);
  return batch.get(clean) || null;
}

export async function setCachedUser(scored: ScoredUser): Promise<void> {
  const clean = scored.username.toLowerCase().replace(/^u\//, '').trim();
  if (!clean) return;

  const cleanKey = `${CLEAN_CACHE_PREFIX}${clean}`;
  const threatKey = `${THREAT_CACHE_PREFIX}${clean}`;
  const legacyKey = `${LEGACY_CACHE_PREFIX}${clean}`;

  if (scored.classification === 'CLEAN') {
    const compact: CompactCleanRecord = {
      username: clean,
      evaluatedAt: scored.evaluatedAt || Date.now(),
      tier: scored.confidenceTier || 3,
      score: scored.score
    };
    await chrome.storage.local.set({ [cleanKey]: compact });
    // Remove threat or legacy entry if it previously existed
    await chrome.storage.local.remove([threatKey, legacyKey]);
  } else {
    await chrome.storage.local.set({ [threatKey]: scored });
    await chrome.storage.local.remove([cleanKey, legacyKey]);
  }
}

export async function invalidateCachedUser(username: string): Promise<void> {
  const clean = username.toLowerCase().replace(/^u\//, '').trim();
  if (!clean) return;

  const cleanKey = `${CLEAN_CACHE_PREFIX}${clean}`;
  const threatKey = `${THREAT_CACHE_PREFIX}${clean}`;
  const legacyKey = `${LEGACY_CACHE_PREFIX}${clean}`;

  await chrome.storage.local.remove([cleanKey, threatKey, legacyKey]);
}

export async function getSettings(): Promise<ExtensionSettings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] as ExtensionSettings | undefined) };
}

export async function updateSettings(updates: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = { ...current, ...updates };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getStats(): Promise<DeflectorStats> {
  const res = await chrome.storage.local.get(STATS_KEY);
  return { ...DEFAULT_STATS, ...(res[STATS_KEY] as DeflectorStats | undefined) };
}

export async function incrementStats(updates: {
  deflected?: number;
  scanned?: number;
  cacheHits?: number;
  blocked?: number;
  quotaExceeded?: boolean;
}): Promise<DeflectorStats> {
  const current = await getStats();
  const next: DeflectorStats = {
    deflectedCount: current.deflectedCount + (updates.deflected || 0),
    scannedCount: current.scannedCount + (updates.scanned || 0),
    cacheHitCount: current.cacheHitCount + (updates.cacheHits || 0),
    blockedCount: current.blockedCount + (updates.blocked || 0),
    quotaExceeded: updates.quotaExceeded !== undefined ? updates.quotaExceeded : current.quotaExceeded,
    lastActive: Date.now()
  };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}
