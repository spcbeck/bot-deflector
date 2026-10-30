import { RedditCommentElement } from './adapters/base';

export class ViewportPrioritizer {
  private visibleElements = new Set<string>();
  private observer: IntersectionObserver;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id =
            el.dataset.bdObserveId ||
            el.id ||
            el.getAttribute('thingid') ||
            el.getAttribute('data-fullname') ||
            '';
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
        rootMargin: '250px', // Pre-load elements 250px before they scroll into view
        threshold: 0.01
      }
    );
  }

  observeComment(comment: RedditCommentElement): void {
    comment.element.dataset.bdObserveId = comment.id;
    // Check immediate bounding box so elements currently in viewport are marked visible synchronously
    if (typeof window !== 'undefined' && typeof comment.element.getBoundingClientRect === 'function') {
      const rect = comment.element.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement?.clientHeight || 800;
      if (rect.bottom >= -250 && rect.top <= vh + 250) {
        this.visibleElements.add(comment.id);
      }
    }
    this.observer.observe(comment.element);
  }

  isVisible(id: string): boolean {
    return this.visibleElements.has(id);
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
