import { RedditSubmission, ScoredUser } from '../types';

export function createDeflectionBar(
  scored: ScoredUser,
  onRestore: () => void,
  onWhitelist: () => void
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bd-deflection-bar';

  const meta = document.createElement('div');
  meta.className = 'bd-deflection-meta';

  const badge = document.createElement('span');
  badge.className = scored.classification === 'DEFLECT' ? 'bd-badge-red' : 'bd-badge-yellow';
  badge.textContent = `${scored.classification} (${scored.score}PTS)`;

  const user = document.createElement('span');
  user.className = 'bd-user-label';
  user.textContent = `u/${scored.username}`;

  const reason = document.createElement('span');
  reason.className = 'bd-reason-text';
  // List top 2 reasons
  const topReasons = scored.breakdown
    .filter((b) => b.points > 0)
    .slice(0, 2)
    .map((b) => b.name)
    .join(' • ');
  reason.textContent = topReasons ? `[ ${topReasons} ]` : '';

  meta.appendChild(badge);
  meta.appendChild(user);
  if (topReasons) meta.appendChild(reason);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

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
  body.innerHTML = `
    <strong>Exact Historical Title Repost Detected:</strong> Original post from <strong>${createdDate}</strong> with <strong>${originalPost.score.toLocaleString()} upvotes</strong>.
    <br/>
    <a class="bd-banner-link" href="https://reddit.com${originalPost.permalink || ''}" target="_blank" rel="noopener noreferrer">
      &rarr; View Original Submission
    </a>
  `;

  banner.appendChild(header);
  banner.appendChild(body);

  return banner;
}
