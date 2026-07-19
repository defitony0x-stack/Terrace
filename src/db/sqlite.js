import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Terrace's own database — completely separate file/process/deploy from
 * MomentMarket's. Same Railway-Volume caveat as MomentMarket: set DB_PATH
 * to a mounted volume path for this to survive redeploys, not just
 * crashes/restarts.
 */
const DB_PATH = process.env.DB_PATH || "./terrace.db";
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    chatId    TEXT PRIMARY KEY,
    fixtureId TEXT,
    updatedAt INTEGER
  );
`);
