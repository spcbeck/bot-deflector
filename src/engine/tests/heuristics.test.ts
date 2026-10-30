import assert from 'node:assert';
import test from 'node:test';
import { scoreUser, shouldDrilldownComments } from '../scorer';
import {
  evaluateAutoUsername,
  evaluateBioSpam,
  evaluateCircadianAnomaly,
  evaluateDialogueReciprocity,
  evaluateGhostKarma,
  evaluateHumanActivitySignals,
  evaluateKarmaAsymmetry,
  evaluateKarmaFarmSubreddits,
  evaluateLlmAndTemplateCadence,
  evaluateNsfwFunnelProfile,
  evaluateScriptHomoglyphBleed,
  evaluateSleeperGap,
  evaluateTimezoneShiftAnomaly,
  evaluateUnescapedEntities,
  evaluateUnverifiedEmail,
  evaluateVelocityCadence,
  isDuplicateTitle,
  isStolenCommentMatch
} from '../heuristics';
import { RedditCommentActivity, RedditProfileData } from '../../types';

test('1. Unescaped HTML Entities regex', () => {
  const hit1 = evaluateUnescapedEntities('Me &amp; my dog taking a walk');
  assert.ok(hit1);
  assert.strictEqual(hit1?.points, 50);

  const hit2 = evaluateUnescapedEntities('Don&#39;t talk to me');
  assert.ok(hit2);

  const hit3 = evaluateUnescapedEntities('Normal human title with & and \' apostrophe');
  assert.strictEqual(hit3, null);
});

test('2. Default Auto-generated Username regex', () => {
  assert.ok(evaluateAutoUsername('Cautious-Ad-9142'));
  assert.ok(evaluateAutoUsername('Funny_Cow_102'));
  assert.ok(evaluateAutoUsername('u/Aggressive-Apple-88'));
  assert.strictEqual(evaluateAutoUsername('spbeck'), null);
  assert.strictEqual(evaluateAutoUsername('cyber_warrior'), null);
});

test('3. Telegram & Bio Funnel Links', () => {
  const hit1 = evaluateBioSpam('Daily photos! Follow my telegram: t.me/funnyspam');
  assert.ok(hit1);
  assert.strictEqual(hit1?.points, 45);

  const hit2 = evaluateBioSpam('Check all my links: linktr.ee/myprofile');
  assert.ok(hit2);

  const hit3 = evaluateBioSpam('Just a casual software dev living in NYC');
  assert.strictEqual(hit3, null);
});

test('4. Aged Sleeper Gap', () => {
  const now = 1700000000;
  const createdAged = now - (300 * 86400); // 300 days old
  const commentsRecent: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_a', subreddit: 'ask', createdUtc: now - 3600, body: 'nice', score: 1 },
    { id: '2', linkId: 't3_b', subreddit: 'memes', createdUtc: now - 7200, body: 'same', score: 1 },
    { id: '3', linkId: 't3_c', subreddit: 'pics', createdUtc: now - 10800, body: 'lol', score: 2 }
  ];

  const sleeperHit = evaluateSleeperGap(createdAged, 45, commentsRecent, now);
  assert.ok(sleeperHit);
  assert.strictEqual(sleeperHit?.ruleId, 'aged_sleeper_gap');

  // If oldest comment was 200 days ago, not a sleeper
  const commentsOrganic: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_a', subreddit: 'ask', createdUtc: now - 3600, body: 'nice', score: 1 },
    { id: '2', linkId: 't3_b', subreddit: 'memes', createdUtc: now - (200 * 86400), body: 'old', score: 1 }
  ];
  assert.strictEqual(evaluateSleeperGap(createdAged, 45, commentsOrganic, now), null);
});

test('5. Extreme Karma Asymmetry', () => {
  const hit = evaluateKarmaAsymmetry(25000, 4);
  assert.ok(hit);
  assert.strictEqual(hit?.points, 30);

  // Organic user
  assert.strictEqual(evaluateKarmaAsymmetry(5000, 4200), null);
});

test('6. Inhuman Velocity Cadence', () => {
  const now = 1700000000;
  const botComments: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_1', subreddit: 'askreddit', createdUtc: now, body: 'cool', score: 1 },
    { id: '2', linkId: 't3_2', subreddit: 'gaming', createdUtc: now - 50, body: 'nice', score: 1 },
    { id: '3', linkId: 't3_3', subreddit: 'news', createdUtc: now - 105, body: 'wow', score: 1 },
    { id: '4', linkId: 't3_4', subreddit: 'pics', createdUtc: now - 160, body: 'agree', score: 1 },
    { id: '5', linkId: 't3_5', subreddit: 'funny', createdUtc: now - 210, body: 'lol', score: 1 }
  ];

  const hit = evaluateVelocityCadence(botComments);
  assert.ok(hit);
  assert.strictEqual(hit?.ruleId, 'inhuman_velocity_cadence');
});

test('7. Circadian Rhythm Failure (24/7 Sleepless)', () => {
  const now = 1700000000;
  // Create 24 comments spaced every 1 hour (24 hours span, max gap 1 hour)
  const nonStopComments: RedditCommentActivity[] = [];
  for (let i = 0; i < 24; i++) {
    nonStopComments.push({
      id: String(i),
      linkId: `t3_${i}`,
      subreddit: 'test',
      createdUtc: now - (i * 3600),
      body: 'automated message',
      score: 1
    });
  }

  const hit = evaluateCircadianAnomaly(nonStopComments);
  assert.ok(hit);
  assert.strictEqual(hit?.ruleId, 'circadian_rhythm_failure');
});

test('8. Dialogue Reciprocity (Drive-by deficit vs Conversationalist safe harbor)', () => {
  // Drive-by: 16 comments, each in a unique linkId
  const driveByComments: RedditCommentActivity[] = [];
  for (let i = 0; i < 16; i++) {
    driveByComments.push({
      id: String(i),
      linkId: `t3_unique_${i}`,
      subreddit: `sub_${i % 3}`,
      createdUtc: 1700000000 - (i * 500),
      body: 'first comment',
      score: 1
    });
  }
  const deficitHit = evaluateDialogueReciprocity(driveByComments);
  assert.ok(deficitHit);
  assert.strictEqual(deficitHit?.ruleId, 'drive_by_dialogue_deficit');

  // Conversationalist: Multiple comments within the same thread discussions
  const conversationalComments: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_thread_a', subreddit: 'tech', createdUtc: 1700000000, body: 'what do you think?', score: 3 },
    { id: '2', linkId: 't3_thread_a', subreddit: 'tech', createdUtc: 1700000000 - 300, body: 'I see what you mean', score: 2 },
    { id: '3', linkId: 't3_thread_b', subreddit: 'tech', createdUtc: 1700000000 - 600, body: 'question 1', score: 1 },
    { id: '4', linkId: 't3_thread_b', subreddit: 'tech', createdUtc: 1700000000 - 900, body: 'follow up', score: 1 },
    { id: '5', linkId: 't3_thread_c', subreddit: 'books', createdUtc: 1700000000 - 1200, body: 'favorite author', score: 1 },
    { id: '6', linkId: 't3_thread_c', subreddit: 'books', createdUtc: 1700000000 - 1500, body: 'yes chapter 3 was wild', score: 4 },
    { id: '7', linkId: 't3_thread_d', subreddit: 'news', createdUtc: 1700000000 - 2000, body: 'comment', score: 1 },
    { id: '8', linkId: 't3_thread_e', subreddit: 'news', createdUtc: 1700000000 - 3000, body: 'comment', score: 1 },
    { id: '9', linkId: 't3_thread_f', subreddit: 'news', createdUtc: 1700000000 - 4000, body: 'comment', score: 1 },
    { id: '10', linkId: 't3_thread_g', subreddit: 'news', createdUtc: 1700000000 - 5000, body: 'comment', score: 1 }
  ];
  const safeHit = evaluateDialogueReciprocity(conversationalComments);
  assert.ok(safeHit);
  assert.strictEqual(safeHit?.ruleId, 'conversationalist_safe_harbor');
  assert.strictEqual(safeHit?.points, -30);
});

test('9. Full composite scoring integration', () => {
  // Scenario A: Fresh Telegram funnel spammer
  const profileSpam: RedditProfileData = {
    username: 'Quick-Invest-9921',
    createdUtc: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    linkKarma: 1,
    commentKarma: 0,
    totalKarma: 1,
    bio: 'Crypto tips on telegram: t.me/pump123'
  };
  const scoredSpam = scoreUser(profileSpam.username, profileSpam, [], 'Check out this awesome crypto airdrop!');
  assert.strictEqual(scoredSpam.classification, 'DEFLECT');
  assert.ok(scoredSpam.score >= 70);

  // Scenario B: Whitelisted bot
  const scoredBot = scoreUser('AutoModerator', undefined, undefined, 'I am a bot, and this action was performed automatically.');
  assert.strictEqual(scoredBot.classification, 'CLEAN');
  assert.strictEqual(scoredBot.score, 0);

  // Scenario C: Legitimate established user
  const profileOrganic: RedditProfileData = {
    username: 'normal_redditor',
    createdUtc: Math.floor(Date.now() / 1000) - (800 * 86400), // 800 days old
    linkKarma: 12000,
    commentKarma: 15000,
    totalKarma: 27000,
    bio: 'Just an avid reader'
  };
  const scoredOrganic = scoreUser(profileOrganic.username, profileOrganic, [], 'That is a really interesting perspective.');
  assert.strictEqual(scoredOrganic.classification, 'CLEAN');
  assert.strictEqual(scoredOrganic.score, 0);
});

test('10. Smart Drilldown Gate (shouldDrilldownComments) covers young bots, sleepers, and ghost karma', () => {
  const now = 1700000000;

  // Young account (3 days old): MUST drill down to detect velocity/circadian bots
  const youngBot: RedditProfileData = {
    username: 'Silent-Ad-4412',
    createdUtc: now - (3 * 86400),
    linkKarma: 10,
    commentKarma: 20,
    totalKarma: 30,
    bio: ''
  };
  assert.strictEqual(shouldDrilldownComments(youngBot.username, youngBot, [], now), true);

  // Ghost karma candidate (commentKarma > 1000): MUST drill down so evaluateGhostKarma can run
  const scrubbedBot: RedditProfileData = {
    username: 'Scrubbed-User-9911',
    createdUtc: now - (400 * 86400),
    linkKarma: 10,
    commentKarma: 3500,
    totalKarma: 3510,
    bio: ''
  };
  assert.strictEqual(shouldDrilldownComments(scrubbedBot.username, scrubbedBot, [], now), true);
  const ghostHit = evaluateGhostKarma(scrubbedBot.commentKarma, [
    { id: '1', linkId: 't3_1', subreddit: 'pics', createdUtc: now - 600, body: 'wow', score: 2 }
  ]);
  assert.ok(ghostHit);
  assert.strictEqual(ghostHit?.ruleId, 'ghost_karma_scrubbed');

  // Established veteran human: should skip unnecessary comment drilldown
  const veteranHuman: RedditProfileData = {
    username: 'spbeck',
    createdUtc: now - (1200 * 86400),
    linkKarma: 4000,
    commentKarma: 8000,
    totalKarma: 12000,
    bio: ''
  };
  assert.strictEqual(shouldDrilldownComments(veteranHuman.username, veteranHuman, [], now), false);
});

test('11. Title and Comment Similarity Guards Prevent Substring False Positives', () => {
  // Exact historical title repost matches
  assert.strictEqual(
    isDuplicateTitle(
      'My grandfather built this cabin by hand in 1974',
      'My grandfather built this cabin by hand in 1974!'
    ),
    true
  );

  // Short generic title must NOT substring-match a long historical title
  assert.strictEqual(
    isDuplicateTitle('Update', 'Update on my rescue dog after 6 months of recovery'),
    false
  );
  assert.strictEqual(
    isDuplicateTitle('meirl', 'meirl when the coffee kicks in at 8am'),
    false
  );

  // Exact stolen comment matches
  const viralComment = 'My dad worked at a cannery for thirty years and told me they always sorted the bruised peaches onto a separate belt for jam.';
  assert.strictEqual(
    isStolenCommentMatch(viralComment, viralComment),
    true
  );

  // Short commonplace phrase must NOT substring-match inside a long top comment
  assert.strictEqual(
    isStolenCommentMatch(
      'I completely agree with you on this',
      'I completely agree with you on this, because back in 2018 when our municipality switched contractors the entire recycling schedule fell apart for six months.'
    ),
    false
  );
});

test('12. Karma-Farming Subreddit Footprint Detection', () => {
  const comments: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_a', subreddit: 'FreeKarma4U', createdUtc: 1700000000, body: 'upvoted please return', score: 1 },
    { id: '2', linkId: 't3_b', subreddit: 'Karma4Free', createdUtc: 1700000500, body: 'done', score: 1 }
  ];
  const hit = evaluateKarmaFarmSubreddits(comments);
  assert.ok(hit);
  assert.strictEqual(hit?.ruleId, 'karma_farm_footprint');
  assert.strictEqual(hit?.points, 55);
});

test('13. Mixed-Script Homoglyph Filter Evasion Detection', () => {
  // 't\u0435l\u0435gr\u0430m' uses Cyrillic 'е' (\u0435) and 'а' (\u0430) inside a Latin word
  const evasiveBio = 'Message me on t\u0435l\u0435gr\u0430m for exclusive content';
  const hit = evaluateScriptHomoglyphBleed([], evasiveBio);
  assert.ok(hit);
  assert.strictEqual(hit?.ruleId, 'script_homoglyph_bleed');
  assert.strictEqual(hit?.points, 50);

  // Pure English or separate non-mixed words should not trigger
  assert.strictEqual(evaluateScriptHomoglyphBleed([], 'Just a normal developer bio'), null);
});

test('14. LLM Slop & Repetitive Template Cadence Detection', () => {
  // Case A: Repetitive opening template across comments
  const templateComments: RedditCommentActivity[] = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    linkId: `t3_${i}`,
    subreddit: 'askreddit',
    createdUtc: 1700000000 - i * 600,
    body: `Honestly I think that scenario number ${i} is super interesting and worth considering today.`,
    score: 1
  }));
  const templateHit = evaluateLlmAndTemplateCadence(templateComments);
  assert.ok(templateHit);
  assert.strictEqual(templateHit?.ruleId, 'repetitive_comment_templates');

  // Case B: Synthetic LLM em-dash density + uniform mid-length
  const llmBodies = [
    'That is a fascinating point — the way modern supply chains adapt to pressure really highlights the core issue.',
    'People often overlook the long-term impact — once the initial hype fades, the maintenance cost becomes clear.',
    'Balancing speed and reliability is never easy — teams that invest early in architecture always come out ahead.',
    'Context matters so much in these debates — what works for a small startup rarely scales to an enterprise.',
    'The design tradeoff here is subtle — optimizing for battery life inevitably sacrifices peak rendering throughput.',
    'History tends to repeat itself in tech — every decade swings between centralized clouds and local compute.',
    'Clear communication solves half the battle — most engineering failures trace back to misaligned expectations.',
    'Regulations are finally catching up — transparency around data retention is no longer optional for platforms.'
  ];
  const llmComments: RedditCommentActivity[] = llmBodies.map((body, i) => ({
    id: String(i),
    linkId: `t3_${i}`,
    subreddit: 'technology',
    createdUtc: 1700000000 - i * 1800,
    body,
    score: 2
  }));
  const llmHit = evaluateLlmAndTemplateCadence(llmComments);
  assert.ok(llmHit);
  assert.strictEqual(llmHit?.ruleId, 'llm_slop_cadence');
});

test('15. Geographic Timezone Shift (Sold / Compromised Account Handoff)', () => {
  // Base timestamp at 00:00:00 UTC
  const baseMidnightUtc = 1704067200; // 2024-01-01T00:00:00Z
  const comments: RedditCommentActivity[] = [];

  // 7 recent comments clustered around 09:00 UTC (e.g. Eastern Europe / Asia daytime)
  for (let i = 0; i < 7; i++) {
    comments.push({
      id: `new_${i}`,
      linkId: `t3_new_${i}`,
      subreddit: 'crypto',
      createdUtc: baseMidnightUtc - i * 86400 + 9 * 3600,
      body: 'Great project!',
      score: 1
    });
  }

  // 30-day dormancy gap, preceded by 7 older comments clustered around 21:00 UTC (e.g. US evening)
  const olderBaseUtc = baseMidnightUtc - 40 * 86400;
  for (let i = 0; i < 7; i++) {
    comments.push({
      id: `old_${i}`,
      linkId: `t3_old_${i}`,
      subreddit: 'baseball',
      createdUtc: olderBaseUtc - i * 86400 + 21 * 3600,
      body: 'What a great game tonight',
      score: 5
    });
  }

  const shiftHit = evaluateTimezoneShiftAnomaly(comments);
  assert.ok(shiftHit);
  assert.strictEqual(shiftHit?.ruleId, 'timezone_shift_compromise');
  assert.strictEqual(shiftHit?.points, 40);
});

test('16. Active "Not-a-Bot" Humanity Signals & Compromised Veteran Account Guard', () => {
  const now = Math.floor(Date.now() / 1000);

  // Active human with edited comments and OP thread replies
  const humanComments: RedditCommentActivity[] = [
    { id: '1', linkId: 't3_1', subreddit: 'woodworking', createdUtc: now - 300, body: 'Thanks!', score: 3, isSubmitter: true },
    { id: '2', linkId: 't3_1', subreddit: 'woodworking', createdUtc: now - 600, body: 'I used tung oil on the walnut.', score: 5, isSubmitter: true, edited: now - 500 },
    { id: '3', linkId: 't3_2', subreddit: 'diy', createdUtc: now - 1200, body: 'Fixed a typo in my measurements.', score: 2, edited: now - 1100 }
  ];
  const humanProfile: RedditProfileData = {
    username: 'craftsman_joe',
    createdUtc: now - 800 * 86400,
    linkKarma: 1500,
    commentKarma: 3000,
    totalKarma: 4500,
    bio: 'Woodworker',
    hasVerifiedEmail: true,
    hasCustomAvatar: true
  };

  const humanSignals = evaluateHumanActivitySignals(humanComments, humanProfile);
  assert.ok(humanSignals.some((h) => h.ruleId === 'human_edited_comments'));
  assert.ok(humanSignals.some((h) => h.ruleId === 'human_op_engagement'));
  assert.ok(humanSignals.some((h) => h.ruleId === 'human_verified_veteran_traits'));

  const scoredHuman = scoreUser(humanProfile.username, humanProfile, humanComments);
  assert.strictEqual(scoredHuman.classification, 'CLEAN');
  assert.ok((scoredHuman.humanityScore ?? 0) >= 90);

  // Compromised Veteran Account: 3-year-old account with 5,000 karma that was sold and added a Telegram funnel + NSFW funnel
  const compromisedProfile: RedditProfileData = {
    username: 'bought_veteran_acc',
    createdUtc: now - 1000 * 86400,
    linkKarma: 4980,
    commentKarma: 20,
    totalKarma: 5000,
    bio: 'Check my exclusive links on t.me/scamchannel',
    over18: true,
    hasVerifiedEmail: true,
    hasCustomAvatar: true
  };

  const scoredCompromised = scoreUser(compromisedProfile.username, compromisedProfile, []);
  // Historical safe harbors MUST be stripped when bio_funnel_link is present!
  assert.ok(!scoredCompromised.breakdown.some((h) => h.ruleId === 'established_user_safe_harbor'));
  assert.strictEqual(scoredCompromised.classification, 'DEFLECT');
  assert.ok(scoredCompromised.score >= 70);
});

test('17. Unverified Email & NSFW Funnel Profile Heuristics', () => {
  const now = Math.floor(Date.now() / 1000);
  const nsfwBotProfile: RedditProfileData = {
    username: 'Hot_Promo_99',
    createdUtc: now - 10 * 86400,
    linkKarma: 1200,
    commentKarma: 5,
    totalKarma: 1205,
    bio: '',
    over18: true,
    hasVerifiedEmail: false
  };

  const unverifiedHit = evaluateUnverifiedEmail(nsfwBotProfile, now);
  assert.ok(unverifiedHit);
  assert.strictEqual(unverifiedHit?.ruleId, 'unverified_email_account');

  const nsfwHit = evaluateNsfwFunnelProfile(nsfwBotProfile);
  assert.ok(nsfwHit);
  assert.strictEqual(nsfwHit?.ruleId, 'nsfw_funnel_profile');
});
