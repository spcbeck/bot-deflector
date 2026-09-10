import { RedditSubmission, ScoredUser } from '../../types';
import { createDeflectionBar, createSubmissionRepostBanner } from '../ui';
import { RedditAdapter, RedditCommentElement, RedditSubmissionInfo } from './base';

export class OldRedditAdapter implements RedditAdapter {
  name = 'Old Reddit (Classic)';

  detect(): boolean {
    return (
      document.body.classList.contains('reddit-classic') ||
      document.querySelector('#siteTable, .nestedlisting, .commentarea') !== null
    );
  }

  extractSubmission(): RedditSubmissionInfo | null {
    const linkEl = document.querySelector('.thing.link') as HTMLElement | null;
    if (!linkEl) return null;

    const titleEl = linkEl.querySelector('a.title');
    const authorEl = linkEl.querySelector('a.author');
    const title = titleEl?.textContent?.trim() || '';
    const author = authorEl?.textContent?.trim() || '';
    const sub = linkEl.getAttribute('data-subreddit') || '';

    if (!title || !author) return null;

    return {
      title,
      author,
      subreddit: sub,
      element: linkEl
    };
  }

  findComments(): RedditCommentElement[] {
    const comments: RedditCommentElement[] = [];
    const elements = document.querySelectorAll('.thing.comment');

    elements.forEach((el) => {
      const commentEl = el as HTMLElement;
      if (commentEl.dataset.bdProcessed === 'true') return;

      const author = commentEl.getAttribute('data-author') || '';
      if (!author || author === '[deleted]') return;

      const id = commentEl.getAttribute('data-fullname') || commentEl.id || '';
      const bodyEl = commentEl.querySelector('div.usertext-body');
      const bodyText = bodyEl?.textContent?.trim() || '';

      comments.push({
        id,
        author,
        bodyText,
        element: commentEl,
        isTopLevel: !commentEl.parentElement?.closest('.thing.comment')
      });
    });

    return comments;
  }

  collapseComment(
    comment: RedditCommentElement,
    scored: ScoredUser,
    onRestore: () => void
  ): void {
    const el = comment.element;
    el.dataset.bdProcessed = 'true';
    el.dataset.bdDeflected = 'true';

    const entry = el.querySelector('.entry') as HTMLElement | null;
    if (entry) {
      entry.classList.add('bd-hidden-content');
    }

    const bar = createDeflectionBar(
      scored,
      () => {
        if (entry) entry.classList.remove('bd-hidden-content');
        el.dataset.bdDeflected = 'false';
        onRestore();
      },
      () => {
        chrome.runtime.sendMessage({ type: 'ADD_WHITELIST', username: scored.username });
      },
      () => {
        chrome.runtime.sendMessage({ type: 'BLOCK_USER', username: scored.username });
      }
    );

    el.prepend(bar);
  }

  injectSubmissionWarning(
    submission: RedditSubmissionInfo,
    originalPost: RedditSubmission,
    opScored: ScoredUser
  ): void {
    if (submission.element.querySelector('.bd-submission-banner')) return;
    const banner = createSubmissionRepostBanner(originalPost, opScored);
    submission.element.prepend(banner);
  }

  observe(callback: () => void): MutationObserver {
    const observer = new MutationObserver((mutations) => {
      let hasNewComments = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && (node.classList.contains('comment') || node.querySelector('.comment'))) {
            hasNewComments = true;
            break;
          }
        }
        if (hasNewComments) break;
      }
      if (hasNewComments) {
        callback();
      }
    });

    const target = document.querySelector('.commentarea') || document.body;
    observer.observe(target, { childList: true, subtree: true });
    return observer;
  }
}
