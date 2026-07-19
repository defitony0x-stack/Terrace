import axios from "axios";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PERSONA = `You are Terry — the voice of Terrace, a live football commentary bot
in a Telegram group chat. Terry is a lifelong terrace regular who ended
up with a microphone: knows the game inside out, has real opinions, and
talks like an actual football fan, not a broadcast script.

Voice, by situation:
- GOALS: genuine, loud excitement. Let it show. This is the good stuff.
- YELLOW/RED CARDS: dry, a little sardonic — the tone of someone who's
  seen a hundred of these and has a take on the ref, the tackle, or both.
- VAR REVIEWS: skeptical, faintly exasperated — everyone knows VAR takes
  forever and rarely settles the argument.
- CORNERS/SHOTS: terse, matter-of-fact color commentary — these aren't
  huge moments, don't oversell them.
- Tagged questions: same voice, conversational, like replying to a mate
  in the chat.

Hard rules: 1-2 sentences max, this is a chat message not a broadcast
segment. Never invent a goal, card, or event that isn't in the context
you're given — if you don't have the info, say so plainly in character
rather than guessing. No headers, no bullet points, no "As an AI...".
No bias toward either team — Terry is neutral, just passionate about
the game itself.`;

async function callGemini(userPrompt, maxTokens) {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await axios.post(
      GEMINI_URL,
      {
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: PERSONA }] },
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.9,
          // gemini-2.5-flash does an internal "thinking" pass by default
          // that draws from the SAME token budget as the visible reply —
          // without this, most of maxOutputTokens can get silently
          // consumed by hidden reasoning, cutting the actual sentence
          // off mid-word. Set to 0 since these are short, simple
          // in-character lines that don't need multi-step reasoning.
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      {
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "content-type": "application/json",
        },
        timeout: 12000,
      }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() || null;
  } catch (err) {
    console.error("Gemini call failed:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Generates Terry's commentary line for a just-detected live moment.
 * This is the PRIMARY message posted for every event type (goal, card,
 * corner, shot, VAR) — not a bonus reaction. Returns null on failure so
 * the caller can fall back to the plain template line; losing Terry's
 * voice for one message should never mean losing the moment entirely.
 */
export async function generateMomentCommentary({ moment, recentMoments, matchLabel }) {
  const historyText = recentMoments.length
    ? recentMoments.slice(0, -1).map((m) => `- ${m.text}`).join("\n")
    : "(nothing else confirmed yet this match)";

  const userPrompt = `Match: ${matchLabel || "unknown"}

Earlier confirmed moments this match:
${historyText}

JUST CONFIRMED — react to this one, in character:
Event type: ${moment.actionType}
Minute: ${moment.minute ?? "unknown"}
Team: ${moment.team ?? "unknown"}
Player: ${moment.playerName ?? "unknown"}

One line, in Terry's voice for this event type.`;

  return callGemini(userPrompt, 280);
}

/**
 * Generates a short "filling the quiet" line during a stretch with no
 * confirmed events — Terry acknowledging the lull, referencing real
 * known facts (how long it's been, the last real thing that happened,
 * the teams/competition). Deliberately NOT asked to invent specific
 * unconfirmed action (who's pressuring who, a particular buildup, etc)
 * — Terrace only receives discrete confirmed events from MomentMarket,
 * nothing like live possession or on-ball detail, so inventing that
 * kind of specific color commentary would just be making it up.
 */
export async function generateAmbientCommentary({ matchLabel, recentMoments, idleMinutes }) {
  const historyText = recentMoments.length
    ? recentMoments.map((m) => `- ${m.text}`).join("\n")
    : "(nothing confirmed yet this match)";

  const userPrompt = `Match: ${matchLabel || "unknown"}

Confirmed moments so far this match:
${historyText}

It's been roughly ${Math.round(idleMinutes)} minutes since anything confirmed
happened. Say something short to keep the chat feeling alive during this
quiet stretch — reference the real lull and/or the last real event if
there's one to call back to. Do NOT invent specific unconfirmed action
(don't claim a particular pressing move, a near-miss, or any play-by-play
detail you don't actually have) — general tempo/anticipation/banter is
fine, fabricated specifics are not.

One line, in character.`;

  return callGemini(userPrompt, 180);
}

/**
 * Generates Terry's reply when tagged or replied to directly.
 */
export async function generateReply({ question, recentMessages, recentMoments, matchLabel }) {
  const momentsText = recentMoments.length
    ? recentMoments.map((m) => `- ${m.text}`).join("\n")
    : "(no confirmed moments yet)";

  const chatText = recentMessages
    .slice(-12)
    .map((m) => `${m.from}: ${m.text}`)
    .join("\n");

  const userPrompt = `Match: ${matchLabel || "unknown"}

Recent confirmed moments:
${momentsText}

Recent chat:
${chatText}

Someone just asked or tagged you with:
"${question}"

Reply in character, briefly.`;

  return callGemini(userPrompt, 280);
}
