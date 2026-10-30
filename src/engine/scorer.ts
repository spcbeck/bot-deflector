import { Classification, ConfidenceTier, RedditCommentActivity, RedditProfileData, ScoredUser, ThreatRuleHit } from '../types';
import {
  AUTO_USERNAME_REGEX,
  BIO_SPAM_REGEX,
  evaluateAccountAge,
  evaluateAutoUsername,
  evaluateBioSpam,
  evaluateCircadianAnomaly,
  evaluateDialogueReciprocity,
  evaluateEstablishedUser,
  evaluateGhostKarma,
  evaluateHumanActivitySignals,
  evaluateKarmaAsymmetry,
  evaluateKarmaFarmSubreddits,
  evaluateLlmAndTemplateCadence,
  evaluateLowReputation,
  evaluateMerchSpam,
  evaluateNsfwFunnelProfile,
  evaluateScriptHomoglyphBleed,
  evaluateSleeperGap,
  evaluateTimezoneShiftAnomaly,
  evaluateUnescapedEntities,
  evaluateUnverifiedEmail,
  evaluateVelocityCadence
} from './heuristics';
import { isUserWhitelisted } from './whitelist';

export interface ScoreEvaluationOptions {
  isOp?: boolean;
  isMod?: boolean;
  userWhitelist?: string[];
  deflectThreshold?: number;
  flagThreshold?: number;
  isAccompliceHijacker?: boolean;
  isExactTitleRepost?: boolean;
  isKnownBotDatabase?: boolean;
}

// Hard compromise / active bot indicators that invalidate historical age/karma safe harbors on bought/hacked accounts
const HARD_COMPROMISE_RULE_IDS = new Set([
  'botbouncer_database_hit',
  'bio_funnel_link',
  'aged_sleeper_gap',
  'ghost_karma_scrubbed',
  'timezone_shift_compromise',
  'karma_farm_footprint',
  'accomplice_comment_theft',
  'exact_historical_repost',
  'inhuman_velocity_cadence',
  'script_homoglyph_bleed'
]);

const HISTORICAL_SAFE_HARBOR_RULE_IDS = new Set([
  'established_user_safe_harbor',
  'human_verified_veteran_traits'
]);

/**
 * Determines whether an account warrants fetching recent comment history
 * for behavioral cadence, circadian anomaly, sleeper gap, and ghost karma checks.
 */
export function shouldDrilldownComments(
  username: string,
  profile: RedditProfileData,
  userWhitelist: string[] = [],
  nowUtc = Math.floor(Date.now() / 1000)
): boolean {
  if (!profile || profile.isSuspended || profile.isMod) return false;
  if (isUserWhitelisted(username, userWhitelist)) return false;

  const clean = username.replace(/^u\//, '').trim();
  const ageDays = (nowUtc - profile.createdUtc) / 86400;

  // 1. Young accounts (< 60 days): require behavioral check to distinguish organic newcomers from rapid-fire bots
  if (ageDays < 60) return true;

  // 2. Aged sleeper candidates (60 to 1500 days old with low karma)
  if (ageDays >= 60 && ageDays <= 1500 && profile.totalKarma < 500) return true;

  // 3. Extreme link-to-comment karma asymmetry
  if (profile.linkKarma > 5000 && profile.commentKarma < 50) return true;
  if (profile.linkKarma > 10000 && profile.linkKarma / Math.max(1, profile.commentKarma) > 150) return true;

  // 4. Ghost karma / scrubbed history candidates
  if (profile.commentKarma > 1000 && (profile.totalKarma <= 5000 || AUTO_USERNAME_REGEX.test(clean))) return true;

  // 5. Auto-generated username without veteran karma safe harbor
  if (AUTO_USERNAME_REGEX.test(clean) && profile.totalKarma <= 2000) return true;

  // 6. Negative reputation
  if (profile.totalKarma < 0) return true;

  // 7. NSFW funnel profile candidates or bio spam candidates
  if (profile.over18 && profile.linkKarma >= 200 && profile.commentKarma < 100) return true;
  if (profile.bio && BIO_SPAM_REGEX.test(profile.bio)) return true;

  return false;
}

/**
 * Calculates a 0-100 "Not-a-Bot" Humanity Rating based on threat score,
 * active organic behavioral traits, and profile history.
 */
export function calculateHumanityScore(
  finalThreatScore: number,
  breakdown: ThreatRuleHit[] = [],
  profile?: RedditProfileData,
  isWhitelistedOrMod = false
): number {
  if (isWhitelistedOrMod) return 100;

  const safeHarborBonus = breakdown
    .filter((h) => h.points < 0)
    .reduce((sum, h) => sum + Math.abs(h.points), 0);

  let baseHumanity = 100 - finalThreatScore;

  // If no threats were found, scale humanity rating by positive verification signals
  if (finalThreatScore === 0) {
    let organicBaseline = 60;
    if (profile) {
      const ageDays = (Date.now() / 1000 - profile.createdUtc) / 86400;
      if (ageDays >= 365 && profile.totalKarma >= 1000) organicBaseline = 80;
      else if (ageDays >= 180 && profile.totalKarma >= 100) organicBaseline = 70;
    }
    baseHumanity = Math.min(100, organicBaseline + Math.min(40, safeHarborBonus));
  } else {
    baseHumanity = Math.max(0, Math.min(100, baseHumanity + Math.min(15, Math.floor(safeHarborBonus / 3))));
  }

  return Math.round(baseHumanity);
}

export function calculateConfidenceTier(
  profile?: RedditProfileData,
  breakdown: ThreatRuleHit[] = [],
  isWhitelisted = false,
  isMod = false
): ConfidenceTier {
  if (isWhitelisted || isMod) {
    return 1;
  }

  const hasSafeHarbor = breakdown.some((h) => h.category === 'safe_harbor');

  if (profile) {
    const ageDays = (Date.now() / 1000 - profile.createdUtc) / 86400;

    // Tier 1: Ironclad Human (Age >= 3 years with >= 2k karma, or age >= 1 year with >= 10k karma, or safe harbor with >= 1 year and >= 2k karma)
    if (
      (ageDays >= 3 * 365 && profile.totalKarma >= 2000) ||
      (ageDays >= 365 && profile.totalKarma >= 10000) ||
      (hasSafeHarbor && ageDays >= 365 && profile.totalKarma >= 2000)
    ) {
      return 1;
    }

    // Tier 2: Standard Human (Age >= 180 days with >= 100 karma, or age >= 60 days with >= 500 karma)
    if (
      (ageDays >= 180 && profile.totalKarma >= 100) ||
      (ageDays >= 60 && profile.totalKarma >= 500)
    ) {
      return 2;
    }
  }

  // Tier 3: Borderline / Young or unknown profile
  return 3;
}

export function scoreUser(
  username: string,
  profile?: RedditProfileData,
  comments?: RedditCommentActivity[],
  commentText?: string,
  submissionTitle?: string,
  options: ScoreEvaluationOptions = {}
): ScoredUser {
  const deflectThreshold = options.deflectThreshold ?? 70;
  const flagThreshold = options.flagThreshold ?? 40;
  const breakdown: ThreatRuleHit[] = [];

  // 1. Check Local Whitelist / Verified Bots
  if (isUserWhitelisted(username, options.userWhitelist)) {
    return {
      username,
      score: 0,
      humanityScore: 100,
      classification: 'CLEAN',
      breakdown: [
        {
          ruleId: 'whitelisted_user',
          category: 'safe_harbor',
          name: 'Whitelisted / Verified Utility Account',
          points: -100,
          description: 'Account is explicitly on the safe whitelist'
        }
      ],
      evaluatedAt: Date.now(),
      profile,
      confidenceTier: 1
    };
  }

  // 2. Moderator Safe Harbor
  if (options.isMod || profile?.isMod) {
    return {
      username,
      score: 0,
      humanityScore: 100,
      classification: 'CLEAN',
      breakdown: [
        {
          ruleId: 'moderator_safe_harbor',
          category: 'safe_harbor',
          name: 'Subreddit Moderator Safe Harbor',
          points: -100,
          description: 'Account is a designated moderator of this community'
        }
      ],
      evaluatedAt: Date.now(),
      profile,
      confidenceTier: 1
    };
  }

  // 2b. Known Bot Database Match (e.g. synced from r/BotBouncer)
  if (options.isKnownBotDatabase) {
    breakdown.push({
      ruleId: 'botbouncer_database_hit',
      category: 'syndicate',
      name: 'Known Bot Database Match (r/BotBouncer)',
      points: 85,
      description: 'Account is listed as a confirmed banned bot in the r/BotBouncer database'
    });
  }

  // 3. Exact Historical Title Repost (From Archival Search)
  if (options.isExactTitleRepost) {
    breakdown.push({
      ruleId: 'exact_historical_repost',
      category: 'submission',
      name: 'Exact Historical Title Repost',
      points: 60,
      description: 'Submission title is an exact duplicate of a high-scoring historical post from > 180d ago'
    });
  }

  // 4. Accomplice Comment Hijacking (Copied from original thread)
  if (options.isAccompliceHijacker) {
    breakdown.push({
      ruleId: 'accomplice_comment_theft',
      category: 'syndicate',
      name: 'Accomplice Comment Hijacking',
      points: 65,
      description: 'Comment matches a top comment from the original archival submission'
    });
  }

  // 5. Unescaped HTML Entities (Scraper Artifacts)
  const unescapedTitleHit = submissionTitle ? evaluateUnescapedEntities(submissionTitle) : null;
  const unescapedCommentHit = commentText ? evaluateUnescapedEntities(commentText) : null;
  const unescapedBioHit = profile?.bio ? evaluateUnescapedEntities(profile.bio) : null;

  if (unescapedTitleHit || unescapedCommentHit || unescapedBioHit) {
    breakdown.push(
      unescapedTitleHit || unescapedCommentHit || unescapedBioHit!
    );
  }

  // 6. Default Auto-Generated Username Pattern
  const autoUsernameHit = evaluateAutoUsername(username);
  if (autoUsernameHit) {
    breakdown.push(autoUsernameHit);
  }

  // 7. Merch / Drop-shipping Spam Phrases
  if (commentText) {
    const merchHit = evaluateMerchSpam(commentText);
    if (merchHit) breakdown.push(merchHit);
  }

  // 7b. Mixed-Script Homoglyph Filter Evasion
  const homoglyphHit = evaluateScriptHomoglyphBleed(
    comments || [],
    profile?.bio || '',
    commentText || '',
    submissionTitle || ''
  );
  if (homoglyphHit) {
    breakdown.push(homoglyphHit);
  }

  // 8. Profile Checks (if profile data is available)
  if (profile) {
    // Bio link check
    if (profile.bio) {
      const bioHit = evaluateBioSpam(profile.bio);
      if (bioHit) breakdown.push(bioHit);
    }

    // Account age check
    if (profile.createdUtc) {
      const ageHit = evaluateAccountAge(profile.createdUtc);
      if (ageHit) breakdown.push(ageHit);
    }

    // Unverified email check on low-trust/young accounts
    const unverifiedHit = evaluateUnverifiedEmail(profile);
    if (unverifiedHit) breakdown.push(unverifiedHit);

    // NSFW karma-funnel profile check
    const nsfwFunnelHit = evaluateNsfwFunnelProfile(profile);
    if (nsfwFunnelHit) breakdown.push(nsfwFunnelHit);

    // Low reputation / negative karma check
    const lowRepHit = evaluateLowReputation(profile.totalKarma);
    if (lowRepHit) breakdown.push(lowRepHit);

    // Extreme karma asymmetry check
    const asymmetryHit = evaluateKarmaAsymmetry(profile.linkKarma, profile.commentKarma);
    if (asymmetryHit) breakdown.push(asymmetryHit);

    // Established organic user safe harbor
    const establishedHit = evaluateEstablishedUser(profile.createdUtc, profile.totalKarma);
    if (establishedHit) breakdown.push(establishedHit);
  }

  // 9. Activity Timeline Checks (if comment history is available from Smart Drilldown)
  if (comments && comments.length > 0) {
    if (profile) {
      // Sleeper gap check
      const sleeperHit = evaluateSleeperGap(profile.createdUtc, profile.totalKarma, comments);
      if (sleeperHit) breakdown.push(sleeperHit);

      // Ghost karma check
      const ghostHit = evaluateGhostKarma(profile.commentKarma, comments);
      if (ghostHit) breakdown.push(ghostHit);
    }

    // Known karma-farming subreddit footprint
    const karmaFarmHit = evaluateKarmaFarmSubreddits(comments);
    if (karmaFarmHit) breakdown.push(karmaFarmHit);

    // Inhuman velocity cadence
    const velocityHit = evaluateVelocityCadence(comments);
    if (velocityHit) breakdown.push(velocityHit);

    // Circadian anomaly
    const circadianHit = evaluateCircadianAnomaly(comments);
    if (circadianHit) breakdown.push(circadianHit);

    // Geographic timezone shift (sold/compromised account handoff)
    const timezoneShiftHit = evaluateTimezoneShiftAnomaly(comments);
    if (timezoneShiftHit) breakdown.push(timezoneShiftHit);

    // LLM slop & repetitive template cadence
    const llmTemplateHit = evaluateLlmAndTemplateCadence(comments);
    if (llmTemplateHit) breakdown.push(llmTemplateHit);

    // Dialogue reciprocity (Drive-by deficit vs Conversationalist safe harbor)
    const dialogueHit = evaluateDialogueReciprocity(comments);
    if (dialogueHit) breakdown.push(dialogueHit);
  }

  // 10. Active "Not-a-Bot" Humanity Signals (edited comments, OP thread engagement, lexical diversity, verified traits)
  const humanityHits = evaluateHumanActivitySignals(comments || [], profile);
  if (humanityHits.length > 0) {
    breakdown.push(...humanityHits);
  }

  // 11. Compromised Account Safe-Harbor Guard:
  // Prevent bought or hacked veteran accounts from using historical reputation safe harbors
  // to cancel out active bot/funnel/compromise rules.
  const hasHardCompromiseSignal = breakdown.some((hit) => HARD_COMPROMISE_RULE_IDS.has(hit.ruleId));
  const effectiveBreakdown = hasHardCompromiseSignal
    ? breakdown.filter((hit) => !HISTORICAL_SAFE_HARBOR_RULE_IDS.has(hit.ruleId))
    : breakdown;

  // Calculate composite score
  const totalPoints = effectiveBreakdown.reduce((sum, hit) => sum + hit.points, 0);
  const normalizedScore = Math.max(0, Math.min(100, totalPoints));

  // Circumstantial metadata-only rules (baseline traits that organic new users can naturally possess)
  const circumstantialRuleIds = new Set([
    'fresh_account_48h',
    'young_account_14d',
    'auto_generated_username',
    'low_karma_baseline',
    'unverified_email_account'
  ]);

  // Check if there are affirmative threat signals beyond circumstantial metadata
  const hasAffirmativeThreat = effectiveBreakdown.some(
    (hit) => hit.points > 0 && !circumstantialRuleIds.has(hit.ruleId)
  );

  // If account has ONLY circumstantial baseline metadata hits without affirmative behavioral spam signals,
  // cap score below deflectThreshold (to classify as FLAG for auditing rather than instant DEFLECT)
  let finalScore = normalizedScore;
  if (!hasAffirmativeThreat && normalizedScore >= deflectThreshold) {
    finalScore = Math.min(normalizedScore, deflectThreshold - 5);
  }

  let classification: Classification = 'CLEAN';
  if (finalScore >= deflectThreshold) {
    classification = 'DEFLECT';
  } else if (finalScore >= flagThreshold) {
    classification = 'FLAG';
  }

  const confidenceTier =
    classification === 'CLEAN'
      ? calculateConfidenceTier(profile, effectiveBreakdown, false, Boolean(options.isMod || profile?.isMod))
      : undefined;

  const humanityScore = calculateHumanityScore(
    finalScore,
    effectiveBreakdown,
    profile,
    Boolean(options.isMod || profile?.isMod)
  );

  return {
    username,
    score: finalScore,
    humanityScore,
    classification,
    breakdown: effectiveBreakdown,
    evaluatedAt: Date.now(),
    profile,
    confidenceTier
  };
}
