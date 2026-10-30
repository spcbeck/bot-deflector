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
      if (!author || author === '[deleted]' || author === 'AutoModerator') return;

      const id =
        commentEl.getAttribute('data-fullname') ||
        commentEl.id ||
        (commentEl.dataset.bdUid ||= `bd_oc_${Math.random().toString(36).slice(2, 10)}`);
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

    const isThreadPage = typeof location !== 'undefined' && location.pathname.includes('/comments/');
    if (!isThreadPage || elements.length === 0) {
      const postElements = document.querySelectorAll('.thing.link');
      postElements.forEach((el) => {
        const postEl = el as HTMLElement;
        if (postEl.dataset.bdProcessed === 'true') return;

        const author =
          postEl.getAttribute('data-author') ||
          postEl.querySelector('a.author')?.textContent?.trim() ||
          '';
        if (!author || author === '[deleted]' || author === 'AutoModerator') return;

        const id =
          postEl.getAttribute('data-fullname') ||
          postEl.id ||
          (postEl.dataset.bdUid ||= `bd_op_${Math.random().toString(36).slice(2, 10)}`);
        const titleText = postEl.querySelector('a.title')?.textContent?.trim() || '';

        comments.push({
          id,
          author,
          bodyText: titleText,
          element: postEl,
          isTopLevel: true
        });
      });
    }

    return comments;
  }

  collapseComment(
    comment: RedditCommentElement,
    scored: ScoredUser,
    onRestore: () => void,
    onWhitelist?: () => void,
    onBlock?: () => Promise<{ success: boolean; quotaExceeded?: boolean; error?: string }> | void
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
      let hasNewItems = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof HTMLElement &&
            (node.classList.contains('comment') ||
              node.classList.contains('link') ||
              node.querySelector('.comment, .link'))
          ) {
            hasNewItems = true;
            break;
          }
        }
        if (hasNewItems) break;
      }
      if (hasNewItems) {
        callback();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }
}
