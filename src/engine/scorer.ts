import { Classification, RedditCommentActivity, RedditProfileData, ScoredUser, ThreatRuleHit } from '../types';
import {
  evaluateAccountAge,
  evaluateAutoUsername,
  evaluateBioSpam,
  evaluateCircadianAnomaly,
  evaluateDialogueReciprocity,
  evaluateEstablishedUser,
  evaluateGhostKarma,
  evaluateKarmaAsymmetry,
  evaluateLowReputation,
  evaluateMerchSpam,
  evaluateSleeperGap,
  evaluateUnescapedEntities,
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
      profile
    };
  }

  // 2. Moderator Safe Harbor
  if (options.isMod || profile?.isMod) {
    return {
      username,
      score: 0,
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
      profile
    };
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
  if (comments && comments.length > 0 && profile) {
    // Sleeper gap check
    const sleeperHit = evaluateSleeperGap(profile.createdUtc, profile.totalKarma, comments);
    if (sleeperHit) breakdown.push(sleeperHit);

    // Ghost karma check
    const ghostHit = evaluateGhostKarma(profile.commentKarma, comments);
    if (ghostHit) breakdown.push(ghostHit);

    // Inhuman velocity cadence
    const velocityHit = evaluateVelocityCadence(comments);
    if (velocityHit) breakdown.push(velocityHit);

    // Circadian anomaly
    const circadianHit = evaluateCircadianAnomaly(comments);
    if (circadianHit) breakdown.push(circadianHit);

    // Dialogue reciprocity (Drive-by deficit vs Conversationalist safe harbor)
    const dialogueHit = evaluateDialogueReciprocity(comments);
    if (dialogueHit) breakdown.push(dialogueHit);
  }

  // Calculate composite score
  const totalPoints = breakdown.reduce((sum, hit) => sum + hit.points, 0);
  const normalizedScore = Math.max(0, Math.min(100, totalPoints));

  let classification: Classification = 'CLEAN';
  if (normalizedScore >= deflectThreshold) {
    classification = 'DEFLECT';
  } else if (normalizedScore >= flagThreshold) {
    classification = 'FLAG';
  }

  return {
    username,
    score: normalizedScore,
    classification,
    breakdown,
    evaluatedAt: Date.now(),
    profile
  };
}
