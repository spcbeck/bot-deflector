import { RedditSubmission, ScoredUser } from '../../types';
import { createDeflectionBar, createSubmissionRepostBanner } from '../ui';
import { RedditAdapter, RedditCommentElement, RedditSubmissionInfo } from './base';

export class ShredditAdapter implements RedditAdapter {
  name = 'Shreddit (Modern Reddit)';

  detect(): boolean {
    return Boolean(document.querySelector('shreddit-app, shreddit-comment, shreddit-post'));
  }

  extractSubmission(): RedditSubmissionInfo | null {
    const postEl = document.querySelector('shreddit-post') as HTMLElement | null;
    if (!postEl) return null;

    const title = postEl.getAttribute('post-title') || postEl.querySelector('h1')?.textContent?.trim() || '';
    const author = postEl.getAttribute('author') || '';
    const sub = postEl.getAttribute('subreddit-prefixed-name') || '';

    if (!title || !author) return null;

    return {
      title,
      author,
      subreddit: sub.replace(/^r\//, ''),
      element: postEl
    };
  }

  findComments(): RedditCommentElement[] {
    const comments: RedditCommentElement[] = [];
    const elements = document.querySelectorAll('shreddit-comment');

    elements.forEach((el) => {
      const commentEl = el as HTMLElement;
      if (commentEl.dataset.bdProcessed === 'true') return;

      const author = commentEl.getAttribute('author') || '';
      if (!author || author === '[deleted]') return;

      const id = commentEl.getAttribute('thingid') || commentEl.id || '';
      const bodySlot = commentEl.querySelector('div[slot="comment"]') || commentEl;
      const bodyText = bodySlot.textContent?.trim() || '';

      comments.push({
        id,
        author,
        bodyText,
        element: commentEl,
        isTopLevel: commentEl.parentElement?.tagName.toLowerCase() !== 'shreddit-comment'
      });
    });

    return comments;
  }

  collapseComment(
    comment: RedditCommentElement,
    scored: ScoredUser,
    onRestore: () => void,
    onWhitelist?: () => void,
    onBlock?: () => void
  ): void {
    const el = comment.element;
    el.dataset.bdProcessed = 'true';
    el.dataset.bdDeflected = 'true';

    // Shreddit supports the collapsed attribute natively
    el.setAttribute('collapsed', '');

    const bar = createDeflectionBar(
      scored,
      () => {
        el.removeAttribute('collapsed');
        el.dataset.bdDeflected = 'false';
        onRestore();
      },
      onWhitelist || (() => {}),
      onBlock
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
          if (node instanceof HTMLElement && (node.tagName.toLowerCase() === 'shreddit-comment' || node.querySelector('shreddit-comment'))) {
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

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }
}
