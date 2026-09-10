import { RedditCommentActivity, ThreatRuleHit } from '../types';

// Regex for Reddit's auto-generated username format (e.g. Word-Word-1234 or Word_Word_1234)
export const AUTO_USERNAME_REGEX = /^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{2,5}$/i;

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
