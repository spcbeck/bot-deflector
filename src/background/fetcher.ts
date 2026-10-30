import { isDuplicateTitle } from '../engine/heuristics';
import { RedditCommentActivity, RedditProfileData, RedditSubmission } from '../types';
import { requestQueue } from './rateLimiter';

export async function fetchUserProfile(username: string, priority = false): Promise<RedditProfileData | null> {
  const clean = username.replace(/^u\//, '').trim();
  if (!clean || clean === '[deleted]') return null;

  return requestQueue.enqueue(async () => {
    const url = `https://www.reddit.com/user/${encodeURIComponent(clean)}/about.json`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    requestQueue.updateFromResponse(res);

    if (res.status === 429) {
      throw requestQueue.createRateLimitError(res, `Reddit API rate limit 429 for ${clean}`);
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

    const subTitle = typeof data.subreddit?.title === 'string' ? data.subreddit.title.trim() : '';
    const subDesc = typeof data.subreddit?.public_description === 'string' ? data.subreddit.public_description.trim() : '';
    const combinedBio = [subTitle, subDesc].filter(Boolean).join(' — ');

    const iconImg = typeof data.icon_img === 'string' ? data.icon_img : '';
    const snoovatarImg = typeof data.snoovatar_img === 'string' ? data.snoovatar_img : '';
    const hasCustomAvatar = Boolean(
      snoovatarImg || (iconImg.length > 0 && !iconImg.includes('default'))
    );

    return {
      username: data.name || clean,
      createdUtc: data.created_utc || 0,
      linkKarma: data.link_karma || 0,
      commentKarma: data.comment_karma || 0,
      totalKarma: data.total_karma || ((data.link_karma || 0) + (data.comment_karma || 0)),
      bio: combinedBio,
      isSuspended: Boolean(data.is_suspended),
      over18: Boolean(data.subreddit?.over_18),
      hasVerifiedEmail: typeof data.has_verified_email === 'boolean' ? data.has_verified_email : undefined,
      isGold: Boolean(data.is_gold),
      isEmployee: Boolean(data.is_employee),
      hasCustomAvatar
    };
  }, { priority });
}

export async function fetchUserComments(username: string, priority = true): Promise<RedditCommentActivity[]> {
  const clean = username.replace(/^u\//, '').trim();
  if (!clean || clean === '[deleted]') return [];

  return requestQueue.enqueue(async () => {
    const url = `https://www.reddit.com/user/${encodeURIComponent(clean)}/comments.json?limit=100`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    requestQueue.updateFromResponse(res);

    if (res.status === 429) {
      throw requestQueue.createRateLimitError(res, `Reddit API rate limit 429 for comments of ${clean}`);
    }

    if (!res.ok) return [];

    const json = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children)) return [];

    return children.map((c: { data?: Record<string, unknown> }) => ({
      id: typeof c.data?.id === 'string' ? c.data.id : '',
      linkId: typeof c.data?.link_id === 'string' ? c.data.link_id : '',
      subreddit: typeof c.data?.subreddit === 'string' ? c.data.subreddit : '',
      createdUtc: typeof c.data?.created_utc === 'number' ? c.data.created_utc : 0,
      body: typeof c.data?.body === 'string' ? c.data.body : '',
      score: typeof c.data?.score === 'number' ? c.data.score : 0,
      edited: c.data?.edited !== undefined ? (c.data.edited as boolean | number) : false,
      isSubmitter: Boolean(c.data?.is_submitter)
    }));
  }, { priority });
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

    requestQueue.updateFromResponse(res);

    if (res.status === 429) {
      throw requestQueue.createRateLimitError(res, `Reddit API rate limit 429 for search in r/${cleanSub}`);
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
        if (isDuplicateTitle(cleanTitle, p.title || '')) {
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
    const url = `https://www.reddit.com/comments/${encodeURIComponent(cleanId)}.json?limit=50&depth=2`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    requestQueue.updateFromResponse(res);

    if (res.status === 429) {
      throw requestQueue.createRateLimitError(res, `Reddit API rate limit 429 for comments of post ${cleanId}`);
    }

    if (!res.ok) return [];

    const json = await res.json();
    if (!Array.isArray(json) || json.length < 2) return [];

    const commentListing = json[1]?.data?.children;
    if (!Array.isArray(commentListing)) return [];

    const bodies: string[] = [];
    for (const c of commentListing) {
      const body = c?.data?.body;
      if (typeof body === 'string' && body.trim().length >= 20) {
        bodies.push(body);
      }
      const replies = c?.data?.replies?.data?.children;
      if (Array.isArray(replies)) {
        for (const r of replies) {
          const rBody = r?.data?.body;
          if (typeof rBody === 'string' && rBody.trim().length >= 20) {
            bodies.push(rBody);
          }
        }
      }
    }

    return bodies;
  }, { priority: true });
}

/**
 * Parses a listing of r/BotBouncer submissions and extracts usernames
 * whose evaluation thread (`Overview for <username>`) carries a Banned classification flair.
 */
export function parseBotBouncerListing(children: Array<{ data?: Record<string, unknown> }>): string[] {
  if (!Array.isArray(children)) return [];
  const bannedUsers = new Set<string>();

  for (const item of children) {
    const d = item?.data;
    if (!d) continue;

    const title = typeof d.title === 'string' ? d.title.trim() : '';
    const match = /^Overview for ([A-Za-z0-9_-]{3,30})$/i.exec(title);
    if (!match) continue;

    const flairText = typeof d.link_flair_text === 'string' ? d.link_flair_text : '';
    const flairCss = typeof d.link_flair_css_class === 'string' ? d.link_flair_css_class : '';
    const combinedFlair = `${flairText} ${flairCss}`.toLowerCase();

    // Only include accounts explicitly classified as Banned (exclude Pending, Organic, Human, Service, Declined)
    if (
      /\bbanned\b/.test(combinedFlair) &&
      !/\b(?:organic|human|declined|service|pending|unbanned)\b/.test(combinedFlair)
    ) {
      bannedUsers.add(match[1].toLowerCase());
    }
  }

  return Array.from(bannedUsers);
}

/**
 * Fetches the latest confirmed banned bot accounts from r/BotBouncer for periodic database sync.
 */
export async function fetchBotBouncerBannedBatch(): Promise<string[]> {
  return requestQueue.enqueue(async () => {
    try {
      const url = 'https://www.reddit.com/r/BotBouncer/new.json?limit=100';
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });

      requestQueue.updateFromResponse(res);

      if (!res.ok) return [];

      const json = await res.json();
      const children = json?.data?.children;
      return parseBotBouncerListing(children);
    } catch {
      return [];
    }
  });
}

/**
 * Performs an on-demand check on r/BotBouncer for a specific borderline account.
 */
export async function checkBotBouncerUser(username: string, priority = true): Promise<boolean> {
  const clean = username.replace(/^u\//, '').trim().toLowerCase();
  if (!clean || clean === '[deleted]') return false;

  return requestQueue.enqueue(async () => {
    const query = `"Overview for ${clean}"`;
    const url = `https://www.reddit.com/r/BotBouncer/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=5`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    requestQueue.updateFromResponse(res);

    if (res.status === 429) {
      throw requestQueue.createRateLimitError(res, `Reddit API rate limit 429 for BotBouncer check on ${clean}`);
    }

    if (!res.ok) return false;

    const json = await res.json();
    const children = json?.data?.children;
    const banned = parseBotBouncerListing(children);
    return banned.includes(clean);
  }, { priority });
}
