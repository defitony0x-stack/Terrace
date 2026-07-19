/**
 * Short-term conversational memory — recent chat messages and recent
 * live moments, per chat, kept in a plain in-memory Map (not SQLite).
 * This is deliberately NOT durable: losing a chat's last 30 messages on
 * a restart is a minor UX blip (the bot "forgets" the last few lines of
 * banter), not a data-integrity problem, so it doesn't need the same
 * persistence guarantees as GroupsStore.
 */

const MAX_MESSAGES = 30;
const MAX_MOMENTS = 8;

const messagesByChat = new Map(); // chatId -> [{ from, text, ts }]
const momentsByChat = new Map();  // chatId -> [{ text, ts }]

export function recordMessage(chatId, from, text) {
  const list = messagesByChat.get(chatId) ?? [];
  list.push({ from, text, ts: Date.now() });
  if (list.length > MAX_MESSAGES) list.shift();
  messagesByChat.set(chatId, list);
}

export function recordMoment(chatId, text) {
  const list = momentsByChat.get(chatId) ?? [];
  list.push({ text, ts: Date.now() });
  if (list.length > MAX_MOMENTS) list.shift();
  momentsByChat.set(chatId, list);
}

export function getRecentMessages(chatId) {
  return messagesByChat.get(chatId) ?? [];
}

export function getRecentMoments(chatId) {
  return momentsByChat.get(chatId) ?? [];
}
