export type RuleCategory =
  | 'syndicate'
  | 'submission'
  | 'cadence'
  | 'artifacts'
  | 'dormancy'
  | 'profile'
  | 'karma'
  | 'dialogue'
  | 'content'
  | 'identity'
  | 'safe_harbor';

export interface ThreatRuleHit {
  ruleId: string;
  category: RuleCategory;
  name: string;
  points: number;
  description: string;
}

export interface RedditProfileData {
  username: string;
  createdUtc: number;
  linkKarma: number;
  commentKarma: number;
  totalKarma: number;
  bio: string;
  isSuspended?: boolean;
  over18?: boolean;
  isMod?: boolean;
}

export interface RedditCommentActivity {
  id: string;
  linkId: string; // Submission ID (e.g. t3_xyz)
  subreddit: string;
  createdUtc: number;
  body: string;
  score: number;
}

export interface RedditSubmission {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  createdUtc: number;
  score: number;
  url?: string;
  permalink?: string;
}

export type Classification = 'DEFLECT' | 'FLAG' | 'CLEAN';

export type ConfidenceTier = 1 | 2 | 3;

export interface CompactCleanRecord {
  username: string;
  evaluatedAt: number;
  tier: ConfidenceTier;
  score: number;
}

export interface ScoredUser {
  username: string;
  score: number;
  classification: Classification;
  breakdown: ThreatRuleHit[];
  evaluatedAt: number;
  profile?: RedditProfileData;
  isBlockedOnReddit?: boolean;
  confidenceTier?: ConfidenceTier;
}

export type DeflectionMode = 'STEALTH_COLLAPSE' | 'AUDIT_TAG';

export interface ExtensionSettings {
  deflectThreshold: number; // default 70
  flagThreshold: number; // default 40
  mode: DeflectionMode; // default 'STEALTH_COLLAPSE'
  enableSubmissionCheck: boolean;
  enableCadenceCheck: boolean;
  autoBlockReddit: boolean; // default false / user configurable
  whitelist: string[];
}

export interface DeflectorStats {
  deflectedCount: number;
  scannedCount: number;
  cacheHitCount: number;
  blockedCount: number;
  quotaExceeded?: boolean;
  lastActive: number;
}

// Runtime messaging protocols
export type BackgroundMessage =
  | { type: 'CHECK_USERS'; usernames: string[] }
  | { type: 'CHECK_SUBMISSION'; title: string; subreddit: string; author: string }
  | { type: 'CHECK_HISTORICAL_COMMENTS'; originalPostId: string; currentComments: { id: string; body: string }[] }
  | { type: 'BLOCK_USER'; username: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'GET_STATS' }
  | { type: 'RECORD_DEFLECTION'; username: string; points: number }
  | { type: 'ADD_WHITELIST'; username: string }
  | { type: 'REMOVE_WHITELIST'; username: string }
  | { type: 'INVALIDATE_USER'; username: string };

export type BackgroundResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
