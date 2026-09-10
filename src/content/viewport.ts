import { RedditCommentElement } from './adapters/base';

export class ViewportPrioritizer {
  private visibleElements = new Set<string>();
  private observer: IntersectionObserver;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.id || el.getAttribute('thingid') || el.getAttribute('data-fullname') || '';
          if (!id) continue;

          if (entry.isIntersecting) {
            this.visibleElements.add(id);
          } else {
            this.visibleElements.delete(id);
          }
        }
      },
      {
        root: null,
        rootMargin: '200px', // Pre-load elements 200px before they scroll into view
        threshold: 0.05
      }
    );
  }

  observeComment(comment: RedditCommentElement): void {
    this.observer.observe(comment.element);
  }

  sortPrioritized(comments: RedditCommentElement[]): RedditCommentElement[] {
    return [...comments].sort((a, b) => {
      const aVisible = this.visibleElements.has(a.id);
      const bVisible = this.visibleElements.has(b.id);
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      return 0;
    });
  }

  disconnect(): void {
    this.observer.disconnect();
  }
}
