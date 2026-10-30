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

    // 1. Collect all <shreddit-comment> elements on thread pages
    const commentElements = document.querySelectorAll('shreddit-comment');
    commentElements.forEach((el) => {
      const commentEl = el as HTMLElement;
      if (commentEl.dataset.bdProcessed === 'true') return;

      const author =
        commentEl.getAttribute('author') ||
        commentEl.querySelector('a[href*="/user/"]')?.textContent?.replace(/^u\//, '').trim() ||
        '';
      if (!author || author === '[deleted]' || author === 'AutoModerator') return;

      const id =
        commentEl.getAttribute('thingid') ||
        commentEl.id ||
        commentEl.getAttribute('permalink') ||
        (commentEl.dataset.bdUid ||= `bd_c_${Math.random().toString(36).slice(2, 10)}`);
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

    // 2. Also collect <shreddit-post> elements (enables full scanning on Home/Popular/Subreddit feeds)
    const isThreadPage = typeof location !== 'undefined' && location.pathname.includes('/comments/');
    if (!isThreadPage || commentElements.length === 0) {
      const postElements = document.querySelectorAll('shreddit-post');
      postElements.forEach((el) => {
        const postEl = el as HTMLElement;
        if (postEl.dataset.bdProcessed === 'true') return;

        const author =
          postEl.getAttribute('author') ||
          postEl.getAttribute('author-name') ||
          postEl.querySelector('a[href*="/user/"]')?.textContent?.replace(/^u\//, '').trim() ||
          '';
        if (!author || author === '[deleted]' || author === 'AutoModerator') return;

        const id =
          postEl.getAttribute('id') ||
          postEl.getAttribute('thingid') ||
          postEl.getAttribute('permalink') ||
          (postEl.dataset.bdUid ||= `bd_p_${Math.random().toString(36).slice(2, 10)}`);
        const titleText =
          postEl.getAttribute('post-title') ||
          postEl.querySelector('[slot="title"], h1, h2')?.textContent?.trim() ||
          '';
        const bodySlotText = postEl.querySelector('[slot="text-body"]')?.textContent?.trim() || '';
        const bodyText = [titleText, bodySlotText].filter(Boolean).join(' ');

        comments.push({
          id,
          author,
          bodyText,
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
    if (el.dataset.bdDeflected === 'true') return;
    el.dataset.bdProcessed = 'true';
    el.dataset.bdDeflected = 'true';

    const isPost = el.tagName.toLowerCase() === 'shreddit-post';
    if (isPost) {
      el.classList.add('bd-hidden-content');
    } else {
      el.setAttribute('collapsed', '');
      el.classList.add('bd-hidden-content');
    }

    const bar = createDeflectionBar(
      scored,
      () => {
        el.removeAttribute('collapsed');
        el.classList.remove('bd-hidden-content');
        el.dataset.bdDeflected = 'false';
        onRestore();
      },
      onWhitelist || (() => {}),
      onBlock
    );

    if (el.parentElement) {
      el.parentElement.insertBefore(bar, el);
    } else {
      el.prepend(bar);
    }
  }

  injectSubmissionWarning(
    submission: RedditSubmissionInfo,
    originalPost: RedditSubmission,
    opScored: ScoredUser
  ): void {
    if (submission.element.parentElement?.querySelector('.bd-submission-banner')) return;
    if (submission.element.querySelector('.bd-submission-banner')) return;
    const banner = createSubmissionRepostBanner(originalPost, opScored);
    if (submission.element.parentElement) {
      submission.element.parentElement.insertBefore(banner, submission.element);
    } else {
      submission.element.prepend(banner);
    }
  }

  observe(callback: () => void): MutationObserver {
    const observer = new MutationObserver((mutations) => {
      let hasRelevantChanges = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            const tag = node.tagName.toLowerCase();
            if (
              tag === 'shreddit-comment' ||
              tag === 'shreddit-post' ||
              tag === 'shreddit-comment-tree' ||
              node.querySelector('shreddit-comment, shreddit-post')
            ) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
        if (hasRelevantChanges) break;
      }
      if (hasRelevantChanges) {
        callback();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }
}
