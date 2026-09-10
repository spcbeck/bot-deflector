import assert from 'node:assert';
import test from 'node:test';
import { scoreUser } from '../scorer';
import {
  evaluateAutoUsername,
  evaluateBioSpam,
  evaluateCircadianAnomaly,
  evaluateDialogueReciprocity,
  evaluateKarmaAsymmetry,
  evaluateSleeperGap,
  evaluateUnescapedEntities,
  evaluateVelocityCadence
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
