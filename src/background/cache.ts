import { DeflectorStats, ExtensionSettings, ScoredUser } from '../types';

const CACHE_KEY_PREFIX = 'user_cache_';
const SETTINGS_KEY = 'deflector_settings';
const STATS_KEY = 'deflector_stats';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  deflectThreshold: 70,
  flagThreshold: 40,
  mode: 'STEALTH_COLLAPSE',
  enableSubmissionCheck: true,
  enableCadenceCheck: true,
  whitelist: []
};

export const DEFAULT_STATS: DeflectorStats = {
  deflectedCount: 0,
  scannedCount: 0,
  cacheHitCount: 0,
  lastActive: Date.now()
};

export async function getCachedUser(username: string): Promise<ScoredUser | null> {
  const clean = username.toLowerCase().replace(/^u\//, '');
  const key = `${CACHE_KEY_PREFIX}${clean}`;
  const res = await chrome.storage.local.get(key);
  const cached = res[key] as ScoredUser | undefined;

  if (!cached) return null;

  // Check TTL (7 days)
  if (Date.now() - cached.evaluatedAt > SEVEN_DAYS_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return cached;
}

export async function setCachedUser(scored: ScoredUser): Promise<void> {
  const clean = scored.username.toLowerCase().replace(/^u\//, '');
  const key = `${CACHE_KEY_PREFIX}${clean}`;
  await chrome.storage.local.set({ [key]: scored });
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

export async function incrementStats(updates: { deflected?: number; scanned?: number; cacheHits?: number }): Promise<DeflectorStats> {
  const current = await getStats();
  const next: DeflectorStats = {
    deflectedCount: current.deflectedCount + (updates.deflected || 0),
    scannedCount: current.scannedCount + (updates.scanned || 0),
    cacheHitCount: current.cacheHitCount + (updates.cacheHits || 0),
    lastActive: Date.now()
  };
  await chrome.storage.local.set({ [STATS_KEY]: next });
  return next;
}
