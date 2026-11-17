import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Collects Raid-Helper event posts from every text channel in the guild and
// records who organized each run, for the Event Host audit/leaderboard.
//
// Fail-soft by design: this data feeds an audit, never the live site, so any
// failure logs a warning and exits 0 without touching the data file — a bad
// run here must never break the rest of the refresh.

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

const warn = (message) => console.warn(`[raid-helper] ${message}`);

if (!token) {
  warn("DISCORD_BOT_TOKEN secret is not configured; skipping.");
  process.exit(0);
}
if (!guildId || !/^\d{17,20}$/.test(guildId)) {
  warn("DISCORD_GUILD_ID must be configured as a Discord server ID; skipping.");
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const api = async (path) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        Accept: "application/json",
        "User-Agent": "DiscordBot (https://synergyonline.org/, 1.0)"
      }
    });
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const waitSeconds = Number(body.retry_after) || 1;
      await sleep(Math.ceil(waitSeconds * 1000) + 250);
      continue;
    }
    return response;
  }
  return null;
};

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12"
};

// A Raid-Helper embed names the organizer on its first description line,
// beside a flag: "🏳 vhorsmam". Some templates crown the leader instead, or
// label the line; accept those too. A leading mention (<@123>) is kept raw —
// the audit output shows it, so it can be resolved by hand if it ever occurs.
const parseOrganizer = (description) => {
  if (!description) return null;
  for (const line of description.split("\n")) {
    const flag = line.match(/^\s*(?:🏳|🏴)\uFE0F?\s+(.+?)\s*$/u);
    if (flag) return flag[1];
    const crown = line.match(/^\s*👑\s+(.+?)\s*$/u);
    if (crown) return crown[1];
    const labeled = line.match(/^\s*(?:leader|organizer|organiser|host)\s*:\s+(.+?)\s*$/iu);
    if (labeled) return labeled[1];
  }
  return null;
};

// The same description carries the run's date: "📅 October 3, 2026".
const parseEventDate = (description) => {
  if (!description) return null;
  const match = description.match(/📅\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/u);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
};

const main = async () => {
  const channelsResponse = await api(`/guilds/${guildId}/channels`);
  if (!channelsResponse || !channelsResponse.ok) {
    warn(`Channel list request failed (${channelsResponse ? channelsResponse.status : "no response"}); skipping.`);
    return;
  }
  const channels = await channelsResponse.json();
  if (!Array.isArray(channels)) {
    warn("Discord returned an unexpected channel list; skipping.");
    return;
  }

  // Text (0) and announcement (5) channels can hold posts. Threads, forums,
  // voice and category channels are skipped: Raid-Helper event posts live in
  // regular channels.
  const textChannels = channels.filter((channel) => channel.type === 0 || channel.type === 5);

  const events = [];
  const unreadable = [];
  const botAuthors = new Set();
  let channelsScanned = 0;
  let messagesScanned = 0;

  for (const channel of textChannels) {
    let before = null;
    let channelFailed = false;
    let readAnyPage = false;
    for (;;) {
      const query = before ? `?limit=100&before=${before}` : "?limit=100";
      const response = await api(`/channels/${channel.id}/messages${query}`);
      if (!response || !response.ok) {
        // Partial read: keep what we have, but flag the channel honestly.
        unreadable.push(readAnyPage ? `${channel.name} (partial)` : (channel.name || channel.id));
        channelFailed = true;
        break;
      }
      readAnyPage = true;
      const messages = await response.json();
      if (!Array.isArray(messages) || messages.length === 0) break;
      messagesScanned += messages.length;
      for (const message of messages) {
        const author = message.author || {};
        if (!author.bot || !/raid-helper/i.test(author.username || "")) continue;
        botAuthors.add(`${author.username} (${author.id})`);
        const embed = Array.isArray(message.embeds) ? message.embeds[0] : null;
        const description = embed && typeof embed.description === "string" ? embed.description : "";
        events.push({
          id: message.id,
          channelId: channel.id,
          channel: channel.name || "",
          postedAt: message.timestamp || null,
          title: embed && embed.title ? String(embed.title) : null,
          eventDate: parseEventDate(description),
          organizer: parseOrganizer(description)
        });
      }
      if (messages.length < 100) break;
      before = messages[messages.length - 1].id;
    }
    if (!channelFailed) channelsScanned += 1;
  }

  events.sort((a, b) => String(b.postedAt || "").localeCompare(String(a.postedAt || "")));

  const output = {
    generatedAt: new Date().toISOString(),
    channelsScanned,
    channelsUnreadable: unreadable,
    messagesScanned,
    postsFound: events.length,
    unparsedPosts: events.filter((event) => !event.organizer).length,
    botAuthors: [...botAuthors],
    events
  };

  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "raid-helper-events.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`[raid-helper] ${events.length} event posts across ${channelsScanned} channels (${messagesScanned} messages scanned, ${output.unparsedPosts} unparsed).`);
};

try {
  await main();
} catch (error) {
  warn(`Collector failed: ${error && error.message ? error.message : error}`);
}
