import { RedditCommentActivity, RedditProfileData, ThreatRuleHit } from '../types';

// Regex for Reddit's auto-generated username format (e.g. Word-Word-1234 or Word_Word_1234)
export const AUTO_USERNAME_REGEX = /^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{2,5}$/i;

// Known free-karma exchange and bot-incubator subreddits
export const KARMA_FARM_SUBREDDITS = new Set([
  'freekarma4u',
  'freekarma4you',
  'karma4free',
  'upvote',
  'freekarma',
  'getkarma',
  'karmaroulette',
  'freekarmasubreddit',
  'upvoteforupvote',
  'karmafarming'
]);

// Regex for mixed-script homoglyph evasion within a single word (Latin + Cyrillic/Greek in same token)
export const HOMOGLYPH_MIXED_WORD_REGEX =
  /(?:[a-zA-Z]+[\u0400-\u04FF\u0370-\u03FF]+|[\u0400-\u04FF\u0370-\u03FF]+[a-zA-Z]+)/;

// Regex for unescaped scraper HTML entity artifacts
export const UNESCAPED_ENTITY_REGEX = /&(?:amp|quot|apos|lt|gt|#39|#x27|nbsp);|&amp;amp;/i;

// Commercial/Funnel red flag regex in bios
export const BIO_SPAM_REGEX = /(?:t\.me\/|telegram(?:\.me|\.dog|\s*[:@])|onlyfans(?:\.com|\.me|\s*[:@])|fansly|linktr\.ee|beacons\.ai|allmylinks|cash\.app|\$cashtag|cutt\.ly|bit\.ly)/i;

// Merch/T-shirt spam trigger phrases
export const MERCH_SPAM_REGEX = /(?:where (?:did you|can i) (?:get|buy|find) this|got mine (?:here|from)|bought (?:it )?from here|get yours (?:here|now)|limited edition (?:here|link))/i;

/**
 * 1. Check for unescaped scraper entities in post title, comment body, or bio
 */
export function evaluateUnescapedEntities(text: string): ThreatRuleHit | null {
  if (!text) return null;
  if (UNESCAPED_ENTITY_REGEX.test(text)) {
    return {
      ruleId: 'unescaped_html_entities',
      category: 'artifacts',
      name: 'Unescaped Scraper HTML Entities',
      points: 50,
      description: 'Found raw HTML entities (&amp;, &#39;, etc.) typical of unparsed scraper scripts'
    };
  }
  return null;
}

/**
 * 2. Check for auto-generated default Reddit username format
 */
export function evaluateAutoUsername(username: string): ThreatRuleHit | null {
  if (!username) return null;
  const clean = username.replace(/^u\//, '');
  if (AUTO_USERNAME_REGEX.test(clean)) {
    return {
      ruleId: 'auto_generated_username',
      category: 'identity',
      name: 'Default Generated Username Pattern',
      points: 15,
      description: `Username matches Reddit auto-generated Word-Word-1234 format`
    };
  }
  return null;
}

/**
 * 3. Check for external funnel/spam links in user bio
 */
export function evaluateBioSpam(bio: string): ThreatRuleHit | null {
  if (!bio) return null;
  if (BIO_SPAM_REGEX.test(bio)) {
    return {
      ruleId: 'bio_funnel_link',
      category: 'profile',
      name: 'External Funnel / Telegram Link in Bio',
      points: 45,
      description: 'Bio advertises Telegram, OnlyFans, cash handles, or link aggregators'
    };
  }
  return null;
}

/**
 * 4. Check account age
 */
export function evaluateAccountAge(createdUtc: number, nowUtc = Math.floor(Date.now() / 1000)): ThreatRuleHit | null {
  if (!createdUtc) return null;
  const ageSeconds = nowUtc - createdUtc;
  const ageDays = ageSeconds / 86400;

  if (ageDays < 2) {
    return {
      ruleId: 'fresh_account_48h',
      category: 'profile',
      name: 'Brand New Account (< 48 Hours)',
      points: 40,
      description: `Account created only ${Math.max(1, Math.round(ageSeconds / 3600))} hours ago`
    };
  } else if (ageDays < 14) {
    return {
      ruleId: 'young_account_14d',
      category: 'profile',
      name: 'Young Account (< 14 Days)',
      points: 20,
      description: `Account created ${Math.round(ageDays)} days ago`
    };
  }
  return null;
}

/**
 * 5. Check for Aged Sleeper Gap
 * Account created > 180 days ago, total karma < 100, but all recent visible activity is within the last 72 hours
 */
export function evaluateSleeperGap(
  createdUtc: number,
  totalKarma: number,
  comments: RedditCommentActivity[],
  nowUtc = Math.floor(Date.now() / 1000)
): ThreatRuleHit | null {
  if (!createdUtc || comments.length === 0) return null;
  const ageDays = (nowUtc - createdUtc) / 86400;

  if (ageDays > 180 && totalKarma < 100) {
    // Check if all visible comments were posted within the last 72 hours
    const oldestCommentUtc = Math.min(...comments.map((c) => c.createdUtc));
    const hoursSinceOldest = (nowUtc - oldestCommentUtc) / 3600;

    if (hoursSinceOldest <= 72) {
      return {
        ruleId: 'aged_sleeper_gap',
        category: 'dormancy',
        name: 'Aged Sleeper Gap (Awakened Farm Account)',
        points: 45,
        description: `Account is ${Math.round(ageDays)} days old with low karma, but all activity began in the last ${Math.round(hoursSinceOldest)}h`
      };
    }
  }
  return null;
}

/**
 * 6. Extreme Post-to-Comment Karma Asymmetry
 * Automated repost bots farm massive link karma with 0 conversation
 */
export function evaluateKarmaAsymmetry(linkKarma: number, commentKarma: number): ThreatRuleHit | null {
  if (linkKarma > 5000 && commentKarma < 25) {
    return {
      ruleId: 'extreme_karma_asymmetry',
      category: 'karma',
      name: 'Extreme Post/Comment Karma Asymmetry',
      points: 30,
      description: `High post karma (${linkKarma}) with near-zero comment karma (${commentKarma})`
    };
  }
  if (linkKarma > 10000 && (linkKarma / Math.max(1, commentKarma)) > 150) {
    return {
      ruleId: 'extreme_karma_asymmetry',
      category: 'karma',
      name: 'Extreme Post/Comment Karma Asymmetry',
      points: 30,
      description: `Disproportionate link-to-comment ratio (${Math.round(linkKarma / Math.max(1, commentKarma))}:1)`
    };
  }
  return null;
}

/**
 * 7. Ghost Karma / Scrubbed Farm
 * High comment karma on profile, but very few visible comments and tiny visible score sum
 */
export function evaluateGhostKarma(
  commentKarma: number,
  comments: RedditCommentActivity[]
): ThreatRuleHit | null {
  if (commentKarma > 1000 && comments.length > 0 && comments.length < 10) {
    const visibleScoreSum = comments.reduce((acc, c) => acc + (c.score || 0), 0);
    // If visible score accounts for less than 5% of total comment karma
    if (visibleScoreSum < commentKarma * 0.05) {
      return {
        ruleId: 'ghost_karma_scrubbed',
        category: 'karma',
        name: 'Ghost Karma / Scrubbed History',
        points: 35,
        description: `Profile has ${commentKarma} comment karma but visible history accounts for only ${visibleScoreSum} points`
      };
    }
  }
  return null;
}

/**
 * 8. Inhuman Velocity Cadence
 * Median interval between consecutive comments < 90 seconds across >= 4 distinct subreddits
 */
export function evaluateVelocityCadence(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (comments.length < 5) return null;

  // Sort chronologically descending
  const sorted = [...comments].sort((a, b) => b.createdUtc - a.createdUtc);
  const intervals: number[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = sorted[i].createdUtc - sorted[i + 1].createdUtc;
    if (diff > 0) intervals.push(diff);
  }

  if (intervals.length < 4) return null;

  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  const distinctSubs = new Set(sorted.slice(0, 10).map((c) => c.subreddit.toLowerCase()));

  if (medianInterval <= 90 && distinctSubs.size >= 4) {
    return {
      ruleId: 'inhuman_velocity_cadence',
      category: 'cadence',
      name: 'Inhuman Multi-Subreddit Comment Cadence',
      points: 55,
      description: `Rapid-fire comments (median ${Math.round(medianInterval)}s apart) across ${distinctSubs.size} distinct subreddits`
    };
  }
  return null;
}

/**
 * 9. Circadian Rhythm Failure
 * Activity spanning >= 20 hours of continuous operation with no sleep break > 2.5 hours
 */
export function evaluateCircadianAnomaly(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (comments.length < 10) return null;

  const sorted = [...comments].sort((a, b) => b.createdUtc - a.createdUtc);
  const totalSpanHours = (sorted[0].createdUtc - sorted[sorted.length - 1].createdUtc) / 3600;

  if (totalSpanHours >= 20) {
    let maxGapHours = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = (sorted[i].createdUtc - sorted[i + 1].createdUtc) / 3600;
      if (gap > maxGapHours) maxGapHours = gap;
    }

    if (maxGapHours < 2.5) {
      return {
        ruleId: 'circadian_rhythm_failure',
        category: 'cadence',
        name: '24/7 Sleepless Circadian Anomaly',
        points: 40,
        description: `Continuous posting spanning ${Math.round(totalSpanHours)}h with no natural sleep break longer than ${maxGapHours.toFixed(1)}h`
      };
    }
  }
  return null;
}

/**
 * 10. Drive-By Dialogue Deficit vs Conversationalist Safe Harbor
 * 100% single-shot comments across distinct threads with zero follow-ups
 */
export function evaluateDialogueReciprocity(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (comments.length < 10) return null;

  const linkIdCounts = new Map<string, number>();
  for (const c of comments) {
    if (c.linkId) {
      linkIdCounts.set(c.linkId, (linkIdCounts.get(c.linkId) || 0) + 1);
    }
  }

  const multiTurnThreads = Array.from(linkIdCounts.values()).filter((cnt) => cnt > 1);

  // If user has natural back-and-forth in threads (organic human trait)
  if (multiTurnThreads.length >= 3) {
    return {
      ruleId: 'conversationalist_safe_harbor',
      category: 'safe_harbor',
      name: 'Conversational Dialogue Safe Harbor',
      points: -30,
      description: 'Engages in multi-comment conversational chains across discussion threads'
    };
  }

  // If user has >= 15 comments and 100% are isolated single-shot threads
  if (comments.length >= 15 && linkIdCounts.size === comments.length) {
    return {
      ruleId: 'drive_by_dialogue_deficit',
      category: 'dialogue',
      name: 'Drive-By Dialogue Deficit',
      points: 30,
      description: 'Single isolated comments across 15+ threads with zero conversational replies'
    };
  }

  return null;
}

/**
 * 11. Merch/T-shirt spam trigger
 */
export function evaluateMerchSpam(text: string): ThreatRuleHit | null {
  if (!text) return null;
  if (MERCH_SPAM_REGEX.test(text)) {
    return {
      ruleId: 'merch_spam_trigger',
      category: 'content',
      name: 'Merch / T-Shirt Spam Trigger',
      points: 30,
      description: 'Text matches common drop-shipping or merchandise scam triggers'
    };
  }
  return null;
}

/**
 * 12. Low baseline total karma penalty
 */
export function evaluateLowReputation(totalKarma: number): ThreatRuleHit | null {
  if (totalKarma < 0) {
    return {
      ruleId: 'negative_karma',
      category: 'profile',
      name: 'Negative Total Karma',
      points: 35,
      description: `Account has negative overall reputation (${totalKarma})`
    };
  }
  if (totalKarma < 10) {
    return {
      ruleId: 'low_karma_baseline',
      category: 'profile',
      name: 'Near-Zero Karma Baseline',
      points: 25,
      description: `Account has under 10 total karma (${totalKarma})`
    };
  }
  return null;
}

/**
 * 13. Established Legitimate User Safe Harbor
 */
export function evaluateEstablishedUser(
  createdUtc: number,
  totalKarma: number,
  nowUtc = Math.floor(Date.now() / 1000)
): ThreatRuleHit | null {
  const ageDays = (nowUtc - createdUtc) / 86400;
  if (ageDays > 365 && totalKarma > 2000) {
    return {
      ruleId: 'established_user_safe_harbor',
      category: 'safe_harbor',
      name: 'Established Organic User Safe Harbor',
      points: -50,
      description: `Account is over 1 year old (${Math.round(ageDays)}d) with strong karma (${totalKarma})`
    };
  }
  return null;
}

/**
 * Normalize text for title/comment similarity comparisons
 */
export function normalizeComparisonText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 14. Check if two submission titles represent an exact or near-exact duplicate repost
 * Guards against short generic titles ("meirl", "update", "help") triggering substring false positives
 */
export function isDuplicateTitle(currentTitle: string, historicalTitle: string): boolean {
  const normCurrent = normalizeComparisonText(currentTitle);
  const normExisting = normalizeComparisonText(historicalTitle);

  if (!normCurrent || !normExisting) return false;

  if (normCurrent === normExisting) {
    return normCurrent.length >= 6;
  }

  const minLen = Math.min(normCurrent.length, normExisting.length);
  const maxLen = Math.max(normCurrent.length, normExisting.length);

  if (minLen < 15) return false;

  if (normExisting.includes(normCurrent) || normCurrent.includes(normExisting)) {
    return minLen / maxLen >= 0.8;
  }

  return false;
}

/**
 * 15. Check if a comment is a stolen copy of an archival top comment
 * Guards against short commonplace phrases matching inside long paragraphs
 */
export function isStolenCommentMatch(currentBody: string, historicalBody: string): boolean {
  const cleanCurrent = normalizeComparisonText(currentBody);
  const cleanHist = normalizeComparisonText(historicalBody);

  if (cleanCurrent.length < 20 || cleanHist.length < 20) return false;

  if (cleanCurrent === cleanHist) return true;

  const minLen = Math.min(cleanCurrent.length, cleanHist.length);
  const maxLen = Math.max(cleanCurrent.length, cleanHist.length);

  if (cleanHist.includes(cleanCurrent) || cleanCurrent.includes(cleanHist)) {
    return minLen / maxLen >= 0.75;
  }

  return false;
}

/**
 * 16. Check for participation in known Karma-Farming / Bot-Incubator Subreddits
 */
export function evaluateKarmaFarmSubreddits(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (!comments || comments.length === 0) return null;

  const matchedSubs = new Set<string>();
  let hitCount = 0;

  for (const c of comments) {
    const sub = (c.subreddit || '').toLowerCase().replace(/^r\//, '').trim();
    if (KARMA_FARM_SUBREDDITS.has(sub)) {
      matchedSubs.add(sub);
      hitCount++;
    }
  }

  if (hitCount >= 2) {
    return {
      ruleId: 'karma_farm_footprint',
      category: 'syndicate',
      name: 'Karma-Farming Subreddit Footprint',
      points: 55,
      description: `Found ${hitCount} comments in bot-incubator subreddits (r/${Array.from(matchedSubs).join(', r/')})`
    };
  }

  if (hitCount === 1) {
    return {
      ruleId: 'karma_farm_footprint',
      category: 'syndicate',
      name: 'Karma-Farming Subreddit Footprint',
      points: 40,
      description: `Activity detected in known karma-farming subreddit r/${Array.from(matchedSubs)[0]}`
    };
  }

  return null;
}

/**
 * 17. Check for Unverified Email on Young or Low-Karma Accounts
 */
export function evaluateUnverifiedEmail(
  profile: RedditProfileData,
  nowUtc = Math.floor(Date.now() / 1000)
): ThreatRuleHit | null {
  if (profile.hasVerifiedEmail !== false) return null;

  const ageDays = profile.createdUtc ? (nowUtc - profile.createdUtc) / 86400 : 0;
  if (ageDays < 30 || profile.totalKarma < 100) {
    return {
      ruleId: 'unverified_email_account',
      category: 'profile',
      name: 'Unverified Email on Low-Trust Profile',
      points: 15,
      description: 'Account lacks a verified email address while under 30 days old or below 100 karma'
    };
  }
  return null;
}

/**
 * 18. Check for NSFW Karma-Funnel Profile Pattern
 * High link karma, near-zero comment engagement, and NSFW profile flag
 */
export function evaluateNsfwFunnelProfile(profile: RedditProfileData): ThreatRuleHit | null {
  if (!profile.over18) return null;

  if (
    profile.linkKarma >= 200 &&
    profile.commentKarma < 50 &&
    profile.linkKarma > Math.max(1, profile.commentKarma) * 5
  ) {
    return {
      ruleId: 'nsfw_funnel_profile',
      category: 'profile',
      name: 'NSFW Link-Farming Funnel Profile',
      points: 30,
      description: `NSFW-flagged account with disproportionate post karma (${profile.linkKarma}) and minimal comment history (${profile.commentKarma})`
    };
  }
  return null;
}

/**
 * 19. Check for Mixed-Script Homoglyph Filter Evasion (e.g. Cyrillic 'а'/'е' mixed into Latin words)
 */
export function evaluateScriptHomoglyphBleed(
  comments: RedditCommentActivity[] = [],
  bio = '',
  commentText = '',
  submissionTitle = ''
): ThreatRuleHit | null {
  const texts = [bio, commentText, submissionTitle, ...comments.map((c) => c.body)].filter(Boolean);

  for (const text of texts) {
    if (HOMOGLYPH_MIXED_WORD_REGEX.test(text)) {
      return {
        ruleId: 'script_homoglyph_bleed',
        category: 'artifacts',
        name: 'Mixed-Script Homoglyph Filter Evasion',
        points: 50,
        description: 'Detected Cyrillic/Greek homoglyphs mixed inside Latin words to bypass spam filters'
      };
    }
  }
  return null;
}

/**
 * 20. Check for LLM Slop Cadence & Repetitive Comment Templates
 */
export function evaluateLlmAndTemplateCadence(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (!comments || comments.length < 6) return null;

  const validBodies = comments
    .map((c) => (c.body || '').trim())
    .filter((b) => b.length >= 12);

  if (validBodies.length < 6) return null;

  // Check A: Exact normalized self-duplicate comments or repetitive 3-word opening prefixes
  const normalizedCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();

  for (const body of validBodies) {
    const norm = normalizeComparisonText(body);
    if (norm.length >= 15) {
      normalizedCounts.set(norm, (normalizedCounts.get(norm) || 0) + 1);
    }
    const words = norm.split(' ').filter(Boolean);
    if (words.length >= 4) {
      const prefix = words.slice(0, 3).join(' ');
      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    }
  }

  const maxDuplicateCount = Math.max(0, ...normalizedCounts.values());
  const maxPrefixCount = Math.max(0, ...prefixCounts.values());

  if (maxDuplicateCount >= 3 || (validBodies.length >= 6 && maxPrefixCount / validBodies.length >= 0.4)) {
    return {
      ruleId: 'repetitive_comment_templates',
      category: 'content',
      name: 'Repetitive Template / Copy-Paste Commenting',
      points: 45,
      description:
        maxDuplicateCount >= 3
          ? `Repeated identical comment body ${maxDuplicateCount} times across recent history`
          : `${Math.round((maxPrefixCount / validBodies.length) * 100)}% of recent comments begin with the exact same 3-word template`
    };
  }

  // Check B: LLM Slop Uniformity + Em-Dash Overuse
  if (validBodies.length >= 8) {
    const emDashCount = validBodies.filter((b) => b.includes('—') || b.includes(' -- ')).length;
    const lengths = validBodies.map((b) => b.length);
    const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((acc, l) => acc + Math.pow(l - meanLen, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = meanLen > 0 ? stdDev / meanLen : 1;
    const hasShortCasual = comments.some((c) => (c.body || '').trim().length > 0 && (c.body || '').trim().length < 25);

    if (emDashCount / validBodies.length >= 0.4 && meanLen >= 50 && meanLen <= 350 && cv < 0.35 && !hasShortCasual) {
      return {
        ruleId: 'llm_slop_cadence',
        category: 'content',
        name: 'Synthetic LLM Comment Cadence',
        points: 35,
        description: `High em-dash density (${Math.round((emDashCount / validBodies.length) * 100)}%) paired with robotic comment length uniformity (CV ${cv.toFixed(2)})`
      };
    }
  }

  return null;
}

/**
 * Helper to compute circular mean UTC hour (0..24) and concentration R (0..1)
 */
function computeCircularHourStats(timestamps: number[]): { meanHour: number; concentration: number } {
  if (timestamps.length === 0) return { meanHour: 0, concentration: 0 };

  let sinSum = 0;
  let cosSum = 0;

  for (const ts of timestamps) {
    const date = new Date(ts * 1000);
    const fractionalHour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const angle = (2 * Math.PI * fractionalHour) / 24;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }

  const meanSin = sinSum / timestamps.length;
  const meanCos = cosSum / timestamps.length;
  const concentration = Math.sqrt(meanSin * meanSin + meanCos * meanCos);

  let meanAngle = Math.atan2(meanSin, meanCos);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  const meanHour = (meanAngle * 24) / (2 * Math.PI);

  return { meanHour, concentration };
}

/**
 * 21. Inferred Country/Region Timezone Shift Detection (Compromised / Sold Account Detector)
 * Detects when an account's active circadian window shifts by >= 6 hours after a dormancy gap
 */
export function evaluateTimezoneShiftAnomaly(comments: RedditCommentActivity[]): ThreatRuleHit | null {
  if (!comments || comments.length < 12) return null;

  const sorted = [...comments].sort((a, b) => b.createdUtc - a.createdUtc);

  // Find the largest dormancy gap (>= 14 days) that splits recent vs historical comments with >= 6 on each side
  let bestSplitIndex = -1;
  let maxGapDays = 0;

  for (let i = 5; i <= sorted.length - 7; i++) {
    const gapDays = (sorted[i].createdUtc - sorted[i + 1].createdUtc) / 86400;
    if (gapDays >= 14 && gapDays > maxGapDays) {
      maxGapDays = gapDays;
      bestSplitIndex = i;
    }
  }

  if (bestSplitIndex === -1) return null;

  const recentTimestamps = sorted.slice(0, bestSplitIndex + 1).map((c) => c.createdUtc);
  const olderTimestamps = sorted.slice(bestSplitIndex + 1).map((c) => c.createdUtc);

  const recentStats = computeCircularHourStats(recentTimestamps);
  const olderStats = computeCircularHourStats(olderTimestamps);

  // Require both epochs to have a clear regional circadian concentration
  if (recentStats.concentration < 0.35 || olderStats.concentration < 0.35) {
    return null;
  }

  const rawDiff = Math.abs(recentStats.meanHour - olderStats.meanHour);
  const circularHourShift = Math.min(rawDiff, 24 - rawDiff);

  if (circularHourShift >= 6) {
    return {
      ruleId: 'timezone_shift_compromise',
      category: 'dormancy',
      name: 'Geographic Timezone Shift (Account Handoff)',
      points: 40,
      description: `Active circadian peak shifted by ${circularHourShift.toFixed(1)}h UTC after a ${Math.round(maxGapDays)}d gap, typical of a sold or compromised account`
    };
  }

  return null;
}

/**
 * 22. Evaluate Active "Not-a-Bot" (Humanity) Signals
 * Extracts affirmative organic human traits from comment history and profile metadata
 */
export function evaluateHumanActivitySignals(
  comments: RedditCommentActivity[] = [],
  profile?: RedditProfileData
): ThreatRuleHit[] {
  const hits: ThreatRuleHit[] = [];

  if (comments.length > 0) {
    // 1. Edited comments (fixing typos or adding follow-up notes)
    const editedCount = comments.filter((c) => c.edited !== undefined && c.edited !== false && Boolean(c.edited)).length;
    if (editedCount >= 2) {
      hits.push({
        ruleId: 'human_edited_comments',
        category: 'safe_harbor',
        name: 'Organic Comment Edits Safe Harbor',
        points: -20,
        description: `User has edited ${editedCount} recent comments (rare for automated scripts)`
      });
    }

    // 2. OP Thread Engagement (replying inside their own submissions)
    const opReplyCount = comments.filter((c) => c.isSubmitter === true).length;
    if (opReplyCount >= 2) {
      hits.push({
        ruleId: 'human_op_engagement',
        category: 'safe_harbor',
        name: 'Active OP Thread Participation Safe Harbor',
        points: -20,
        description: `User actively replies to comments inside their own submissions (${opReplyCount} OP replies)`
      });
    }

    // 3. Natural Comment Length Variance (mixing short reactions and detailed paragraphs)
    if (comments.length >= 10) {
      const lengths = comments.map((c) => (c.body || '').trim().length).filter((l) => l > 0);
      if (lengths.length >= 10) {
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / lengths.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        const hasShort = lengths.some((l) => l < 25);
        const hasLong = lengths.some((l) => l > 180);

        if (hasShort && hasLong && cv > 0.75) {
          hits.push({
            ruleId: 'human_organic_diversity',
            category: 'safe_harbor',
            name: 'Organic Lexical Length Diversity Safe Harbor',
            points: -15,
            description: 'Exhibits natural human variance between brief reactions and detailed paragraphs'
          });
        }
      }
    }
  }

  // 4. Verified Profile & Veteran Customization Signals
  if (profile) {
    if (
      profile.isEmployee ||
      profile.isGold ||
      (profile.hasVerifiedEmail === true && profile.hasCustomAvatar === true && profile.totalKarma >= 500)
    ) {
      hits.push({
        ruleId: 'human_verified_veteran_traits',
        category: 'safe_harbor',
        name: 'Verified Custom Profile Safe Harbor',
        points: -15,
        description: 'Account has verified email, custom avatar/Gold status, and established reputation'
      });
    }
  }

  return hits;
}

