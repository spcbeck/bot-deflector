import { RedditCommentActivity, RedditProfileData, RedditSubmission } from '../types';
import { requestQueue } from './rateLimiter';

export async function fetchUserProfile(username: string): Promise<RedditProfileData | null> {
  const clean = username.replace(/^u\//, '').trim();
  if (!clean || clean === '[deleted]') return null;

  return requestQueue.enqueue(async () => {
    const url = `https://www.reddit.com/user/${encodeURIComponent(clean)}/about.json`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (res.status === 429) {
      throw new Error(`Reddit API rate limit 429 for ${clean}`);
    }

    if (res.status === 404) {
      // Account deleted or shadowbanned
      return {
        username: clean,
        createdUtc: 0,
        linkKarma: 0,
        commentKarma: 0,
        totalKarma: 0,
        bio: '',
        isSuspended: true
      };
    }

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const data = json?.data;
    if (!data) return null;

    return {
      username: data.name || clean,
      createdUtc: data.created_utc || 0,
      linkKarma: data.link_karma || 0,
      commentKarma: data.comment_karma || 0,
      totalKarma: data.total_karma || ((data.link_karma || 0) + (data.comment_karma || 0)),
      bio: data.subreddit?.public_description || '',
      isSuspended: Boolean(data.is_suspended),
      over18: Boolean(data.subreddit?.over_18)
    };
  });
}

export async function fetchUserComments(username: string): Promise<RedditCommentActivity[]> {
  const clean = username.replace(/^u\//, '').trim();
  if (!clean || clean === '[deleted]') return [];

  return requestQueue.enqueue(async () => {
    const url = `https://www.reddit.com/user/${encodeURIComponent(clean)}/comments.json?limit=25`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (res.status === 429) {
      throw new Error(`Reddit API rate limit 429 for comments of ${clean}`);
    }

    if (!res.ok) return [];

    const json = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children)) return [];

    return children.map((c: any) => ({
      id: c.data.id || '',
      linkId: c.data.link_id || '',
      subreddit: c.data.subreddit || '',
      createdUtc: c.data.created_utc || 0,
      body: c.data.body || '',
      score: c.data.score || 0
    }));
  });
}

export async function searchSubredditHistoricalPosts(
  subreddit: string,
  title: string
): Promise<RedditSubmission | null> {
  const cleanSub = subreddit.replace(/^r\//, '').trim();
  const cleanTitle = title.trim();
  if (!cleanSub || !cleanTitle) return null;

  return requestQueue.enqueue(async () => {
    // Search within the subreddit for exact title match
    const query = `"${cleanTitle.replace(/"/g, '')}"`;
    const url = `https://www.reddit.com/r/${encodeURIComponent(cleanSub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&limit=5`;

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (res.status === 429) {
      throw new Error(`Reddit API rate limit 429 for search in r/${cleanSub}`);
    }

    if (!res.ok) return null;

    const json = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children) || children.length === 0) return null;

    const nowUtc = Math.floor(Date.now() / 1000);
    const ONE_HUNDRED_EIGHTY_DAYS_SEC = 180 * 86400;

    for (const item of children) {
      const p = item.data;
      if (!p) continue;

      // Check if this post is older than 180 days and has significant karma (> 500)
      const ageSec = nowUtc - p.created_utc;
      if (ageSec > ONE_HUNDRED_EIGHTY_DAYS_SEC && p.score > 500) {
        // Compare titles normalized
        const normExisting = (p.title || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        const normCurrent = cleanTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();

        if (normExisting === normCurrent || normExisting.includes(normCurrent) || normCurrent.includes(normExisting)) {
          return {
            id: p.id,
            title: p.title,
            subreddit: p.subreddit,
            author: p.author,
            createdUtc: p.created_utc,
            score: p.score,
            url: p.url,
            permalink: p.permalink
          };
        }
      }
    }

    return null;
  });
}

export async function fetchHistoricalTopComments(postId: string): Promise<string[]> {
  const cleanId = postId.replace(/^t3_/, '').trim();
  if (!cleanId) return [];

  return requestQueue.enqueue(async () => {
    const url = `https://www.reddit.com/comments/${encodeURIComponent(cleanId)}.json?limit=25&depth=1`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) return [];

    const json = await res.json();
    if (!Array.isArray(json) || json.length < 2) return [];

    const commentListing = json[1]?.data?.children;
    if (!Array.isArray(commentListing)) return [];

    return commentListing
      .map((c: any) => c.data?.body)
      .filter((body: any): body is string => typeof body === 'string' && body.trim().length > 10);
  });
}
