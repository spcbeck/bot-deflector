export const DEFAULT_WHITELISTED_BOTS = new Set([
  'automoderator',
  'remindmebot',
  'savevideo',
  'haikusbot',
  'sneakpeekbot',
  'auddbot',
  'repostsleuthbot',
  'gifreversingbot',
  'converter-bot',
  'vredditdownloader',
  'bot-sleuth-bot',
  'qualityvote',
  'moderators'
]);

export function isUserWhitelisted(
  username: string,
  userWhitelist: string[] = []
): boolean {
  if (!username) return false;
  const normalized = username.toLowerCase().replace(/^u\//, '');
  if (DEFAULT_WHITELISTED_BOTS.has(normalized)) {
    return true;
  }
  return userWhitelist.some((item) => item.toLowerCase().replace(/^u\//, '') === normalized);
}
