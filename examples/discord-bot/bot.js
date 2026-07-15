/**
 * Example service for Pterodroid.
 *
 * This file shows the shape any service should follow to work well with
 * the panel's process manager:
 *   1. Read configuration from environment variables (set them in the
 *      service's "Variáveis de ambiente" field in the panel UI — they're
 *      injected into this process's env, nothing to hardcode here).
 *   2. Log meaningful things to stdout/stderr — the panel captures both
 *      and shows them in Logs / the service console in real time.
 *   3. Handle SIGTERM (and SIGINT) to shut down cleanly. The panel sends
 *      SIGTERM first and only escalates to SIGKILL if the process doesn't
 *      exit within a few seconds.
 *
 * Without a DISCORD_TOKEN this runs in "demo mode" — it just logs a
 * heartbeat — so you can create this service in the panel, start it, and
 * see the whole pipeline (spawn → logs → status → stop → auto-restart)
 * working immediately, before wiring up a real bot token.
 */

const token = process.env.DISCORD_TOKEN;

console.log(`[bot] starting, pid=${process.pid}, mode=${token ? 'discord' : 'demo'}`);

let shutdown = async () => process.exit(0);

if (!token) {
  // ── Demo mode: no external dependencies, nothing to configure ──────────
  let n = 0;
  const interval = setInterval(() => {
    n += 1;
    console.log(`[bot] demo heartbeat #${n} — set DISCORD_TOKEN in this service's environment to run for real`);
  }, 4000);

  shutdown = async () => {
    clearInterval(interval);
    console.log('[bot] shutting down (demo mode)');
    process.exit(0);
  };
} else {
  // ── Real mode: a minimal discord.js bot ────────────────────────────────
  // npm install discord.js   (already listed in this example's package.json)
  const { Client, GatewayIntentBits, Events } = require('discord.js');

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    if (message.content === '!ping') {
      console.log(`[bot] responding to !ping from ${message.author.tag}`);
      message.reply('pong 🏓').catch((err) => console.error('[bot] reply failed:', err.message));
    }
  });

  client.on(Events.Error, (err) => console.error('[bot] client error:', err.message));

  client.login(token).catch((err) => {
    console.error('[bot] login failed:', err.message);
    process.exit(1); // non-zero exit — the panel's auto-restart (if enabled) will retry
  });

  shutdown = async () => {
    console.log('[bot] shutting down, destroying client connection');
    await client.destroy();
    process.exit(0);
  };
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
