# Terrace

**Live football commentary, right in your Telegram group — called by Terry.**

Bind a group chat to a fixture, and Terry (Terrace's commentator voice) calls every goal, card, corner, shot, and VAR review the moment it happens — genuinely hyped for goals, dry and sardonic about cards, skeptical about VAR — instead of a flat notification feed.

## How this relates to MomentMarket

Terrace is a **fully separate project** — its own repo, its own deploy, its own database. It is not a fork of MomentMarket and shares no code with it. But it **reuses the exact same live match data**, by talking to MomentMarket's already-running backend over plain HTTPS, instead of standing up a second, independent TxLINE subscription (which would need its own Solana wallet and its own TXL token balance to pay for).

Concretely, Terrace depends on MomentMarket's backend for two things, both over ordinary HTTP — no shared code, no shared process, no shared database:

1. **`GET /api/fixtures`** (already public) — Terrace calls this to list fixtures for `/watch` and to resolve a fixture ID to team names.
2. **`POST /webhook/moment`** (this repo, receiving side) — MomentMarket's backend POSTs here every time it detects a real moment (goal, card, corner, shot, VAR), already enriched with team and player names. Terrace has no TxLINE access of its own and never talks to TxLINE directly.

```
┌────────────────────┐        GET /api/fixtures        ┌─────────────────┐
│  Terrace (this repo)│ ───────────────────────────────▶│ MomentMarket     │
│  - Telegram bot      │                                  │ backend          │
│  - own SQLite db      │◀─────────────────────────────  │ (TxLINE session, │
│  - webhook receiver     │   POST /webhook/moment        │  same as before) │
└────────────────────┘                                  └─────────────────┘
```

If MomentMarket's backend ever goes down, Terrace goes quiet (no data source) but doesn't crash — this is a deliberate dependency, not an accident.

## Commands

- `/watch` — list live/upcoming fixtures
- `/watch <fixtureId>` — follow a specific match in this chat
- `/unwatch` — stop following
- `/following` — show what this chat is currently watching

No wallets, no bets, no accounts — anyone in the group can run any command.

## Terry, the commentator voice

Every live moment — goal, card, corner, shot, VAR — gets a real
commentary line from Terry (an LLM, via `GEMINI_API_KEY`), grounded in
what's actually been confirmed so far this match, so he won't invent a
goal or card that didn't happen. Tone shifts by event: genuine excitement
for goals, dry/sardonic for cards, skeptical for VAR reviews, terse
color commentary for corners and shots.

If `GEMINI_API_KEY` isn't set, or a call fails for any reason (rate
limit, network blip), Terrace falls back to a plain template line
("⚽ GOAL 67' — Vietnam") instead of staying silent — losing Terry's
voice for one message is fine, losing the moment entirely isn't.

Tag `@YourBotUsername` or reply to one of Terry's messages any time to
ask him something directly — same grounded, in-character voice.

**One Telegram-side setting matters here.** By default (privacy mode ON),
Telegram only delivers commands, @mentions, and replies-to-the-bot to
Terrace — tagged Q&A works fine either way. Broadcasting live moments
doesn't depend on this setting at all. It only matters if you later want
Terry to read the whole conversation, not just messages aimed at him:
message **@BotFather** → `/mybots` → your bot → **Bot Settings** →
**Group Privacy** → Turn off.

## Setup

1. Message **@BotFather** on Telegram → `/newbot` → get a token
2. Copy `.env.example` to `.env` and fill in:
   - `TELEGRAM_BOT_TOKEN`
   - `MOMENTMARKET_API_URL` (MomentMarket's deployed backend URL)
   - `MOMENT_WEBHOOK_SECRET` — must match the same value set on the MomentMarket backend's `MOMENT_WEBHOOK_SECRET`, if you set one there
   - `GEMINI_API_KEY` — powers Terry's commentary voice and tagged replies; without it, Terrace still works, just with plain template lines instead of commentary
3. `npm install && npm start`
4. On the **MomentMarket backend**, set `MOMENT_WEBHOOK_URL` to this service's public URL + `/webhook/moment` (e.g. `https://terrace-production.up.railway.app/webhook/moment`), and redeploy it — that's the one config change needed on MomentMarket's side to turn this on.
5. Add the bot to a Telegram group, run `/watch`, pick a fixture.

## Deploying

Deploy like any small Node/Express service (Railway, Fly, Render, etc.) — needs a public URL reachable by MomentMarket's backend for the webhook, and (same as MomentMarket) a mounted Volume if you want `terrace.db` to survive redeploys, not just restarts.
