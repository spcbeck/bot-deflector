import { getSessionModhash, setSessionModhash } from './cache';
import { requestQueue } from './rateLimiter';

export async function getRedditModhash(): Promise<string | null> {
  const session = await getSessionModhash();
  const now = Date.now();
  if (session && now < session.expiry) {
    return session.modhash;
  }

  return requestQueue.enqueue(async () => {
    try {
      const res = await fetch('https://www.reddit.com/api/me.json', {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.warn('[BotDeflector Blocker] Could not fetch user session from /api/me.json');
        return null;
      }

      const data = await res.json();
      const modhash = data?.data?.modhash;
      if (typeof modhash === 'string' && modhash.length > 0) {
        const expiry = Date.now() + (30 * 60 * 1000); // 30 min cache
        await setSessionModhash(modhash, expiry);
        return modhash;
      }
      return null;
    } catch (err) {
      console.error('[BotDeflector Blocker] Error fetching modhash:', err);
      return null;
    }
  });
}

export interface BlockResult {
  success: boolean;
  username: string;
  alreadyBlocked?: boolean;
  quotaExceeded?: boolean;
  error?: string;
}

export async function blockRedditUser(username: string): Promise<BlockResult> {
  const clean = username.replace(/^u\//, '').trim();
  if (!clean || clean === '[deleted]') {
    return { success: false, username: clean, error: 'Invalid username' };
  }

  const modhash = await getRedditModhash();

  return requestQueue.enqueue(async () => {
    try {
      const params = new URLSearchParams();
      params.append('name', clean);
      params.append('api_type', 'json');
      if (modhash) {
        params.append('uh', modhash);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (modhash) {
        headers['X-Modhash'] = modhash;
      }

      const res = await fetch('https://www.reddit.com/api/block_user', {
        method: 'POST',
        headers,
        body: params.toString()
      });

      if (res.status === 429) {
        throw new Error('Rate limit 429 encountered during block_user');
      }

      const json = await res.json();
      const errors = json?.json?.errors;

      if (Array.isArray(errors) && errors.length > 0) {
        const firstError = errors[0][0];
        if (firstError === 'TOO_MANY_BLOCKED') {
          console.warn(`[BotDeflector Blocker] Reddit 1,000 block quota exceeded!`);
          return { success: false, username: clean, quotaExceeded: true, error: 'Reddit 1,000 block quota exceeded' };
        }
        if (firstError === 'USER_DOESNT_EXIST') {
          return { success: false, username: clean, error: 'User does not exist or was deleted' };
        }
        return { success: false, username: clean, error: firstError };
      }

      console.log(`[BotDeflector Blocker] Successfully blocked u/${clean} on Reddit account`);
      return { success: true, username: clean };
    } catch (err: unknown) {
      console.error(`[BotDeflector Blocker] Failed to block u/${clean}:`, err);
      return {
        success: false,
        username: clean,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });
}
