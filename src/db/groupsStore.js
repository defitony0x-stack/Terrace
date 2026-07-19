import { db } from "./sqlite.js";

const upsertGroup = db.prepare(`
  INSERT INTO groups (chatId, fixtureId, updatedAt)
  VALUES (?, ?, ?)
  ON CONFLICT(chatId) DO UPDATE SET
    fixtureId = excluded.fixtureId,
    updatedAt = excluded.updatedAt
`);
const getGroupStmt = db.prepare(`SELECT fixtureId FROM groups WHERE chatId = ?`);
const unwatchStmt = db.prepare(`UPDATE groups SET fixtureId = NULL, updatedAt = ? WHERE chatId = ?`);
const groupsWatchingFixtureStmt = db.prepare(`SELECT chatId FROM groups WHERE fixtureId = ?`);

export const GroupsStore = {
  watch(chatId, fixtureId) {
    upsertGroup.run(String(chatId), String(fixtureId), Date.now());
  },
  unwatch(chatId) {
    unwatchStmt.run(Date.now(), String(chatId));
  },
  getWatchedFixture(chatId) {
    return getGroupStmt.get(String(chatId))?.fixtureId ?? null;
  },
  chatsWatchingFixture(fixtureId) {
    return groupsWatchingFixtureStmt.all(String(fixtureId)).map((r) => r.chatId);
  },
};
