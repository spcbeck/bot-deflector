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

/**
 * Sweeps chrome.storage.local and deletes all expired clean, threat, and legacy cache entries.
 * Runs on daily alarms to prevent unbounded storage growth.
 */
export async function sweepExpiredCacheRecords(now = Date.now()): Promise<{ scanned: number; removed: number }> {
  const all = await chrome.storage.local.get(null);
  const keysToRemove: string[] = [];
  let scanned = 0;

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(CLEAN_CACHE_PREFIX)) {
      scanned++;
      const record = value as CompactCleanRecord;
      if (record && isCleanRecordExpired(record, now)) {
        keysToRemove.push(key);
      }
    } else if (key.startsWith(THREAT_CACHE_PREFIX)) {
      scanned++;
      const record = value as ScoredUser;
      if (record && isThreatRecordExpired(record, now)) {
        keysToRemove.push(key);
      }
    } else if (key.startsWith(LEGACY_CACHE_PREFIX)) {
      scanned++;
      const record = value as ScoredUser;
      if (record) {
        if (record.classification === 'CLEAN') {
          const tier = record.confidenceTier || 3;
          const compact: CompactCleanRecord = {
            username: record.username,
            evaluatedAt: record.evaluatedAt,
            tier,
            score: record.score
          };
          if (isCleanRecordExpired(compact, now)) {
            keysToRemove.push(key);
          }
        } else if (isThreatRecordExpired(record, now)) {
          keysToRemove.push(key);
        }
      }
    }
  }

  if (keysToRemove.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < keysToRemove.length; i += BATCH_SIZE) {
      await chrome.storage.local.remove(keysToRemove.slice(i, i + BATCH_SIZE));
    }
  }

  return { scanned, removed: keysToRemove.length };
}

// ---------------------------------------------------------------------------
// Ephemeral Session Storage (chrome.storage.session)
// Survives Service Worker sleep/restart within a browser session
// ---------------------------------------------------------------------------

export const TAB_DEFLECTION_PREFIX = 'tab_deflected_';
const MODHASH_KEY = 'session_reddit_modhash';

// Fallback in-memory map for environments where chrome.storage.session is unmocked or unavailable
const memorySessionFallback = new Map<string, any>();

async function getSessionData<T>(key: string, fallback: T): Promise<T> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const res = await chrome.storage.session.get(key);
      return (res[key] as T) ?? fallback;
    }
  } catch (err) {
    console.warn('[BotDeflector Cache] Error reading chrome.storage.session:', err);
  }
  return memorySessionFallback.has(key) ? (memorySessionFallback.get(key) as T) : fallback;
}

async function setSessionData<T>(key: string, value: T): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: value });
      return;
    }
  } catch (err) {
    console.warn('[BotDeflector Cache] Error writing to chrome.storage.session:', err);
  }
  memorySessionFallback.set(key, value);
}

async function removeSessionData(key: string): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(key);
      return;
    }
  } catch (err) {
    console.warn('[BotDeflector Cache] Error removing from chrome.storage.session:', err);
  }
  memorySessionFallback.delete(key);
}

export async function getTabDeflectedUsers(tabId: number): Promise<string[]> {
  return await getSessionData<string[]>(`${TAB_DEFLECTION_PREFIX}${tabId}`, []);
}

export async function addTabDeflectedUsers(tabId: number, usernames: string[]): Promise<number> {
  const current = await getTabDeflectedUsers(tabId);
  const set = new Set(current);
  for (const u of usernames) {
    const clean = u.toLowerCase().replace(/^u\//, '').trim();
    if (clean) set.add(clean);
  }
  const updated = Array.from(set);
  await setSessionData(`${TAB_DEFLECTION_PREFIX}${tabId}`, updated);
  return updated.length;
}

export async function clearTabDeflections(tabId: number): Promise<void> {
  await removeSessionData(`${TAB_DEFLECTION_PREFIX}${tabId}`);
}

export async function getTabDeflectedCount(tabId: number): Promise<number> {
  const list = await getTabDeflectedUsers(tabId);
  return list.length;
}

export async function getSessionModhash(): Promise<{ modhash: string; expiry: number } | null> {
  return await getSessionData<{ modhash: string; expiry: number } | null>(MODHASH_KEY, null);
}

export async function setSessionModhash(modhash: string, expiry: number): Promise<void> {
  await setSessionData(MODHASH_KEY, { modhash, expiry });
}

export async function getTabThreatUsers(tabId: number): Promise<ScoredUser[]> {
  const usernames = await getTabDeflectedUsers(tabId);
  if (usernames.length === 0) return [];
  const batch = await getCachedUsersBatch(usernames);
  const results: ScoredUser[] = [];
  for (const name of usernames) {
    const scored = batch.get(name);
    if (scored) {
      results.push(scored);
    } else {
      results.push({
        username: name,
        score: 85,
        classification: 'DEFLECT',
        breakdown: [
          {
            ruleId: 'tab_deflection',
            category: 'syndicate',
            name: 'Deflected Account',
            points: 85,
            description: 'Automated threat deflected on current page'
          }
        ],
        evaluatedAt: Date.now()
      });
    }
  }
  return results.sort((a, b) => (b.evaluatedAt || 0) - (a.evaluatedAt || 0));
}

export async function getRecentThreatUsers(limit = 30): Promise<ScoredUser[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  const all = await chrome.storage.local.get(null);
  const threats: ScoredUser[] = [];
  const seenUsernames = new Set<string>();
  const now = Date.now();

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(THREAT_CACHE_PREFIX)) {
      const record = value as ScoredUser;
      if (record && record.username && !isThreatRecordExpired(record, now)) {
        const clean = record.username.toLowerCase();
        if (!seenUsernames.has(clean)) {
          seenUsernames.add(clean);
          threats.push(record);
        }
      }
    }
  }

  threats.sort((a, b) => (b.evaluatedAt || 0) - (a.evaluatedAt || 0));
  return threats.slice(0, limit);
}

