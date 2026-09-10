import { RedditSubmission, ScoredUser } from '../../types';

export interface RedditCommentElement {
  id: string;
  author: string;
  bodyText: string;
  element: HTMLElement;
  isTopLevel: boolean;
}

export interface RedditSubmissionInfo {
  title: string;
  author: string;
  subreddit: string;
  element: HTMLElement;
}

export interface RedditAdapter {
  name: string;
  detect(): boolean;
  extractSubmission(): RedditSubmissionInfo | null;
  findComments(): RedditCommentElement[];
  collapseComment(
    comment: RedditCommentElement,
    scored: ScoredUser,
    onRestore: () => void
  ): void;
  injectSubmissionWarning(
    submission: RedditSubmissionInfo,
    originalPost: RedditSubmission,
    opScored: ScoredUser
  ): void;
  observe(callback: () => void): MutationObserver;
}
