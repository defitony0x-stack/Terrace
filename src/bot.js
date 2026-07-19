import { Bot } from "grammy";
import axios from "axios";
import { GroupsStore } from "./db/groupsStore.js";
import { recordMessage, recordMoment, getRecentMessages, getRecentMoments, markSpoken, minutesSinceLastSpoken } from "./chatMemory.js";
import { generateReply, generateMomentCommentary, generateAmbientCommentary } from "./ai.js";

const MOMENTMARKET_API_URL = process.env.MOMENTMARKET_API_URL;
if (!MOMENTMARKET_API_URL) {
  throw new Error("MOMENTMARKET_API_URL is required — Terrace has no data source without it.");
}

const api = axios.create({ baseURL: MOMENTMARKET_API_URL, timeout: 10000 });

const EMOJI = { goal: "⚽", yellow_card: "🟨", red_card: "🟥", corner: "🚩", shot: "🎯", var: "📺" };
const LABEL = { goal: "GOAL", yellow_card: "Yellow card", red_card: "RED CARD", corner: "Corner", shot: "Shot", var: "VAR review" };

/** Plain template line — the fallback if Terry's AI commentary fails to
 * generate, so a broken/rate-limited API call never means silence. */
function templateLine(moment) {
  const emoji = EMOJI[moment.actionType] ?? "🔔";
  const label = LABEL[moment.actionType] ?? moment.actionType;
  const minuteText = moment.minute != null ? ` ${moment.minute}'` : "";
  const teamText = moment.team ? ` — ${moment.team}` : "";
  const playerText = moment.playerName ? ` (${moment.playerName})` : "";
  return `${emoji} ${label}${minuteText}${teamText}${playerText}`;
}

async function lookupMatchLabel(fixtureId) {
  try {
    const { data } = await api.get("/api/fixtures");
    const fixture = (data.fixtures || []).find((f) => String(f.fixtureId) === String(fixtureId));
    return fixture ? `${fixture.home} vs ${fixture.away}` : null;
  } catch {
    return null;
  }
}

export function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

  const bot = new Bot(token);

  bot.command("start", (ctx) => ctx.reply(
    "👋 I'm Terry — I call the match live in this chat, and I'll answer if you tag me or reply to one of my messages.\n\n" +
    "/watch — see live/upcoming fixtures to follow\n" +
    "/watch <fixtureId> — follow a specific match\n" +
    "/unwatch — stop following\n" +
    "/following — show what this chat is currently watching"
  ));

  bot.command("watch", async (ctx) => {
    const arg = ctx.match?.trim();
    const chatId = ctx.chat.id;

    if (!arg) {
      try {
        const { data } = await api.get("/api/fixtures");
        const fixtures = data.fixtures || [];
        if (!fixtures.length) return ctx.reply("No live or upcoming fixtures right now — try again closer to kickoff.");
        const list = fixtures.slice(0, 15).map((f) =>
          `\`${f.fixtureId}\` — ${f.home} vs ${f.away}${f.competition ? ` (${f.competition})` : ""}`
        ).join("\n");
        return ctx.reply(`Pick a fixture and run /watch <fixtureId>:\n\n${list}`, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("failed to list fixtures for /watch:", err.message);
        return ctx.reply("Couldn't reach the live fixtures feed — try again in a moment.");
      }
    }

    try {
      const { data } = await api.get("/api/fixtures");
      const fixtures = data.fixtures || [];
      const fixture = fixtures.find((f) => String(f.fixtureId) === String(arg));
      if (!fixture) return ctx.reply(`Couldn't find a fixture with id ${arg}. Run /watch with no id to see the list.`);

      GroupsStore.watch(chatId, fixture.fixtureId);
      ctx.reply(`✅ This chat is now following ${fixture.home} vs ${fixture.away}. I'll call it live — tag me any time with a question.`);
    } catch (err) {
      console.error("failed to bind /watch:", err.message);
      ctx.reply("Something went wrong looking up that fixture — try again in a moment.");
    }
  });

  bot.command("unwatch", (ctx) => {
    GroupsStore.unwatch(ctx.chat.id);
    ctx.reply("Stopped following live updates in this chat.");
  });

  bot.command("following", async (ctx) => {
    const fixtureId = GroupsStore.getWatchedFixture(ctx.chat.id);
    if (!fixtureId) return ctx.reply("This chat isn't following any match right now. Run /watch to pick one.");
    const label = await lookupMatchLabel(fixtureId);
    ctx.reply(label ? `Following: ${label}` : `Following fixture ${fixtureId} (details unavailable right now).`);
  });

  // ---- Conversational participation ----
  // Telegram's "privacy mode" (@BotFather -> your bot -> Group Privacy)
  // controls how much of this Terry actually receives: with privacy ON
  // (default), tagged Q&A below still works fine, since @mentions and
  // replies-to-the-bot are always delivered regardless of that setting.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.from?.is_bot) return;
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // let bot.command() handlers deal with commands

    const chatId = ctx.chat.id;
    const fromName = ctx.message.from?.first_name || "someone";
    recordMessage(chatId, fromName, text);

    const botUsername = bot.botInfo?.username;
    const wasMentioned = botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
    const wasReplied = ctx.message.reply_to_message?.from?.id === bot.botInfo?.id;
    const isPrivateChat = ctx.chat.type === "private"; // no such thing as "tagging" in a 1-on-1 DM
    if (!wasMentioned && !wasReplied && !isPrivateChat) return;

    const fixtureId = GroupsStore.getWatchedFixture(chatId);
    const matchLabel = fixtureId ? await lookupMatchLabel(fixtureId) : null;

    const reply = await generateReply({
      question: text,
      recentMessages: getRecentMessages(chatId),
      recentMoments: fixtureId ? getRecentMoments(fixtureId) : [],
      matchLabel,
    });

    if (reply) {
      ctx.reply(reply, { reply_parameters: { message_id: ctx.message.message_id } }).catch((err) =>
        console.error(`failed to send AI reply to chat ${chatId}:`, err.message)
      );
    }
  });

  bot.catch((err) => console.error("Telegram bot error:", err));

  return bot;
}

/**
 * Posts Terry's commentary for a just-detected moment (already enriched
 * with team/player names by MomentMarket's backend) into every chat
 * watching that fixture. Terry's AI-generated line is now the PRIMARY
 * message for every event type — goal, card, corner, shot, VAR — not
 * just a bonus reaction. If the AI call fails for any reason (no API
 * key, rate limit, network issue), falls back to the plain template
 * line rather than staying silent.
 *
 * Generated ONCE per moment, not once per chat: if 50 groups are all
 * watching the same fixture, they all get the identical commentary
 * line from a single Gemini call — same match, same event, no reason
 * to pay for (or wait on) 50 separate calls producing the same result.
 */
export async function broadcastMoment(bot, moment) {
  const chatIds = GroupsStore.chatsWatchingFixture(moment.fixtureId);
  if (chatIds.length === 0) return;

  const fallback = templateLine(moment);
  const matchLabel = await lookupMatchLabel(moment.fixtureId);

  // Recorded once at the fixture level, then reused by every chat that
  // asks Terry a tagged question about this match later.
  recordMoment(moment.fixtureId, fallback);

  const commentary = await generateMomentCommentary({
    moment,
    recentMoments: getRecentMoments(moment.fixtureId),
    matchLabel,
  });
  const text = commentary || fallback;

  for (const chatId of chatIds) {
    bot.api.sendMessage(chatId, text).catch((err) =>
      console.error(`failed to post moment to chat ${chatId}:`, err.message)
    );
  }
}

// How long a fixture can go with nothing confirmed before Terry chimes
// in to fill the quiet. Configurable since "quiet" tolerance is a taste
// call, not a technical one.
const AMBIENT_IDLE_MINUTES = Number(process.env.TERRACE_AMBIENT_IDLE_MINUTES || 5);

/**
 * Checks every fixture currently being watched by at least one group,
 * and — if it's been quiet for AMBIENT_IDLE_MINUTES or longer — has
 * Terry post a short ambient line to keep the chat feeling alive.
 * Meant to be called periodically (see server.js), not per-event.
 */
export async function checkAmbientCommentary(bot) {
  const fixtureIds = GroupsStore.watchedFixtures();

  for (const fixtureId of fixtureIds) {
    const idleMinutes = minutesSinceLastSpoken(fixtureId);
    if (idleMinutes < AMBIENT_IDLE_MINUTES) continue; // recent real event or ambient line already covered this

    const chatIds = GroupsStore.chatsWatchingFixture(fixtureId);
    if (chatIds.length === 0) continue;

    const matchLabel = await lookupMatchLabel(fixtureId);
    const line = await generateAmbientCommentary({
      matchLabel,
      recentMoments: getRecentMoments(fixtureId),
      idleMinutes,
    });

    if (!line) continue; // no API key / call failed — stay quiet rather than post nothing useful
    markSpoken(fixtureId);

    for (const chatId of chatIds) {
      bot.api.sendMessage(chatId, line).catch((err) =>
        console.error(`failed to post ambient commentary to chat ${chatId}:`, err.message)
      );
    }
  }
}
