/**
 * Short-term memory — recent chat messages (per chat) and recent
 * confirmed live moments (per FIXTURE, not per chat). Kept in a plain
 * in-memory Map, not SQLite: losing this on a restart is a minor UX
 * blip (Terry "forgets" the last few lines of banter or match history),
 * not a data-integrity problem — GroupsStore is what actually needs
 * durable persistence.
 *
 * Moments are tracked per FIXTURE deliberately, not per chat: if 50
 * different groups are all watching the same match, they're all
 * watching the same underlying sequence of events. Keying by fixture
 * means Terry's commentary for a given goal gets generated ONCE and
 * reused across every group watching that match, instead of once per
 * group — the same match doesn't need 50 separate (identical) Gemini
 * calls just because 50 groups happen to be watching it.
 */

const MAX_MESSAGES = 30;
const MAX_MOMENTS = 8;

const messagesByChat = new Map();     // chatId -> [{ from, text, ts }]
const momentsByFixture = new Map();   // fixtureId -> [{ text, ts }]
const lastSpokenAtByFixture = new Map(); // fixtureId -> timestamp of the last thing Terry said (real or ambient)

export function recordMessage(chatId, from, text) {
  const list = messagesByChat.get(chatId) ?? [];
  list.push({ from, text, ts: Date.now() });
  if (list.length > MAX_MESSAGES) list.shift();
  messagesByChat.set(chatId, list);
}

export function recordMoment(fixtureId, text) {
  const key = String(fixtureId);
  const list = momentsByFixture.get(key) ?? [];
  list.push({ text, ts: Date.now() });
  if (list.length > MAX_MOMENTS) list.shift();
  momentsByFixture.set(key, list);
  lastSpokenAtByFixture.set(key, Date.now());
}

export function getRecentMessages(chatId) {
  return messagesByChat.get(chatId) ?? [];
}

export function getRecentMoments(fixtureId) {
  return momentsByFixture.get(String(fixtureId)) ?? [];
}

/** Marks that Terry just said something (real event or ambient filler) about this fixture. */
export function markSpoken(fixtureId) {
  lastSpokenAtByFixture.set(String(fixtureId), Date.now());
}

/** Minutes since Terry last said anything about this fixture — Infinity if he's never spoken about it. */
export function minutesSinceLastSpoken(fixtureId) {
  const last = lastSpokenAtByFixture.get(String(fixtureId));
  if (!last) return Infinity;
  return (Date.now() - last) / 60000;
}
