import { RedditSubmission, ScoredUser } from '../types';

export function createDeflectionBar(
  scored: ScoredUser,
  onRestore: () => void,
  onWhitelist: () => void,
  onBlock?: () => void
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bd-deflection-bar';

  const meta = document.createElement('div');
  meta.className = 'bd-deflection-meta';

  const badge = document.createElement('span');
  badge.className = scored.classification === 'DEFLECT' ? 'bd-badge-red' : 'bd-badge-yellow';
  badge.textContent = `${scored.classification} (${scored.score}PTS)`;

  meta.appendChild(badge);

  if (scored.isBlockedOnReddit) {
    const blockedBadge = document.createElement('span');
    blockedBadge.className = 'bd-badge-red';
    blockedBadge.style.backgroundColor = '#B71C1C';
    blockedBadge.textContent = 'BLOCKED ON REDDIT';
    meta.appendChild(blockedBadge);
  }

  const user = document.createElement('span');
  user.className = 'bd-user-label';
  user.textContent = `u/${scored.username}`;
  meta.appendChild(user);

  const reason = document.createElement('span');
  reason.className = 'bd-reason-text';
  // List top 2 reasons
  const topReasons = scored.breakdown
    .filter((b) => b.points > 0)
    .slice(0, 2)
    .map((b) => b.name)
    .join(' • ');
  if (topReasons) {
    reason.textContent = `[ ${topReasons} ]`;
    meta.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  // If not blocked on Reddit, offer 1-click Block on Reddit
  if (!scored.isBlockedOnReddit && onBlock) {
    const blockBtn = document.createElement('button');
    blockBtn.className = 'bd-action-btn';
    blockBtn.style.color = '#FF8A80';
    blockBtn.textContent = 'Block on Reddit';
    blockBtn.title = 'Permanently block this user on your Reddit account';
    blockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      blockBtn.textContent = 'Blocking...';
      blockBtn.disabled = true;
      onBlock();
      blockBtn.textContent = 'Blocked';
      blockBtn.style.color = '#AAAAAA';
    });
    actions.appendChild(blockBtn);
  }

  const revealBtn = document.createElement('button');
  revealBtn.className = 'bd-action-btn';
  revealBtn.textContent = 'Reveal';
  revealBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRestore();
    container.remove();
  });

  const whitelistBtn = document.createElement('button');
  whitelistBtn.className = 'bd-action-btn';
  whitelistBtn.textContent = 'Whitelist';
  whitelistBtn.title = 'Never deflect this account';
  whitelistBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onWhitelist();
    onRestore();
    container.remove();
  });

  actions.appendChild(revealBtn);
  actions.appendChild(whitelistBtn);

  container.appendChild(meta);
  container.appendChild(actions);

  return container;
}

export function createSubmissionRepostBanner(
  originalPost: RedditSubmission,
  opScored: ScoredUser
): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'bd-submission-banner';

  const header = document.createElement('div');
  header.className = 'bd-banner-header';

  const badge = document.createElement('span');
  badge.className = 'bd-badge-red';
  badge.textContent = `DEFLECTED REPOST FARM (${opScored.score} PTS)`;

  const author = document.createElement('span');
  author.className = 'bd-user-label';
  author.textContent = `OP u/${originalPost.author} suspected bot`;

  header.appendChild(badge);
  header.appendChild(author);

  const body = document.createElement('div');
  body.className = 'bd-banner-body';

  const createdDate = new Date(originalPost.createdUtc * 1000).toLocaleDateString();

  const titlePrefix = document.createElement('strong');
  titlePrefix.textContent = 'Exact Historical Title Repost Detected: ';
  body.appendChild(titlePrefix);

  body.appendChild(document.createTextNode('Original post from '));

  const dateStrong = document.createElement('strong');
  dateStrong.textContent = createdDate;
  body.appendChild(dateStrong);

  body.appendChild(document.createTextNode(' with '));

  const upvotesStrong = document.createElement('strong');
  upvotesStrong.textContent = `${originalPost.score.toLocaleString()} upvotes`;
  body.appendChild(upvotesStrong);

  body.appendChild(document.createTextNode('.'));
  body.appendChild(document.createElement('br'));

  const link = document.createElement('a');
  link.className = 'bd-banner-link';
  const permalink = (originalPost.permalink || '').trim();
  const safeHref = permalink.startsWith('/')
    ? `https://reddit.com${permalink}`
    : permalink.startsWith('https://reddit.com/') || permalink.startsWith('https://www.reddit.com/')
    ? permalink
    : `https://reddit.com/r/${encodeURIComponent(originalPost.subreddit || '')}`;
  link.href = safeHref;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '→ View Original Submission';
  body.appendChild(link);

  banner.appendChild(header);
  banner.appendChild(body);

  return banner;
}
