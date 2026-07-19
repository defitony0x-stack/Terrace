import "dotenv/config";
import express from "express";
import { createBot, broadcastMoment, checkAmbientCommentary } from "./bot.js";

const app = express();
app.use(express.json());

const bot = createBot();
bot.start();
console.log("Terrace bot started.");

// Checks every watched fixture for a quiet stretch and has Terry chime
// in — see checkAmbientCommentary() in bot.js for the idle threshold.
// Runs every 2 minutes; the threshold itself (default 5 min) decides
// how often Terry actually speaks, this is just the polling cadence.
setInterval(() => {
  checkAmbientCommentary(bot).catch((err) => console.error("ambient commentary check failed:", err.message));
}, 2 * 60 * 1000);

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * MomentMarket's backend POSTs here every time it detects a real moment.
 * Verifies the shared secret if one is configured, so nobody else can
 * spam fake "goals" into people's groups.
 */
app.post("/webhook/moment", async (req, res) => {
  const expectedSecret = process.env.MOMENT_WEBHOOK_SECRET;
  if (expectedSecret && req.headers["x-webhook-secret"] !== expectedSecret) {
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  try {
    await broadcastMoment(bot, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("failed to handle incoming moment:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 8081;
app.listen(port, () => console.log(`Terrace listening on :${port}`));
