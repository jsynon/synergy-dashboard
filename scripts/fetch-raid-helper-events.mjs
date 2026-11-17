import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Collects Raid-Helper event posts from every text channel in the guild and
// records who organized each run and who signed up for it, for the Event
// Host audit/leaderboard and a participation tally.
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

// The organizer is named in the embed's first field, on the line carrying
// the Leader custom emoji: "<:LeaderX:1124529969926779050> Elenara". (In the
// rendered post that emoji is the little flag beside the name.) Older or
// alternate templates may put a flag/crown/label line in the description
// instead, so those are accepted as a fallback.
const parseOrganizer = (embed) => {
  if (!embed) return null;
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  for (const field of fields) {
    const value = typeof field.value === "string" ? field.value : "";
    const leader = value.match(/<:Leader[^:>\s]*:\d+>\s*([^\n]+)/);
    if (leader) return leader[1].trim();
  }
  const description = typeof embed.description === "string" ? embed.description : "";
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

// The same first field carries the run's moment as a Discord timestamp
// ("<t:1785466800:D>"); the board dates it in Eastern, like the calendar.
const parseEventDate = (embed) => {
  if (!embed) return null;
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  for (const field of fields) {
    const value = typeof field.value === "string" ? field.value : "";
    const stamp = value.match(/<t:(\d+):[A-Za-z]>/);
    if (stamp) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/New_York"
      }).formatToParts(new Date(Number(stamp[1]) * 1000));
      const part = (type) => parts.find((item) => item.type === type)?.value;
      return `${part("year")}-${part("month")}-${part("day")}`;
    }
  }
  const description = typeof embed.description === "string" ? embed.description : "";
  const match = description.match(/📅\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/u);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
};

// Sign-ups live in the embed's role fields: a header line names the
// section ("**__Tank__ (1)**", "**__Support__ (2)**", …) and each entry
// line carries a slot number in backticks followed by the member's name
// in bold: "`2` **Ragnar@Dokrahm#9**". Tentative and benched sections
// list people who did not take part, so a field whose header names one
// of those never counts; every other role field does, Support included.
// Names are stored as written; merging spelling variants of the same
// member happens where the tally is presented, not here.
const parseParticipants = (embed) => {
  if (!embed) return [];
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  const names = [];
  const seen = new Set();
  for (const field of fields) {
    const value = typeof field.value === "string" ? field.value : "";
    const entries = [...value.matchAll(/`(\d+)`\s*\*\*([^*]+)\*\*/g)];
    if (!entries.length) continue;
    const header = value.slice(0, entries[0].index);
    if (/tentative|bench/i.test(header)) continue;
    for (const entry of entries) {
      const name = entry[2].trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
};

// Posts without an embed title spell it in letter emojis on the
// description's first line: "**<:M:…> <:D:…> <:empty:…> … **" = "MD …".
const decodeEmojiTitle = (description) => {
  if (!description) return null;
  const firstLine = description.split("\n")[0].replace(/\*\*/g, "").trim();
  if (!firstLine || !/^(\s*<:[A-Za-z0-9_]+:\d+>\s*)+$/.test(firstLine)) return null;
  const letters = [...firstLine.matchAll(/<:([A-Za-z0-9_]+):\d+>/g)]
    .map((token) => (token[1] === "empty" ? " " : token[1]));
  const title = letters.join("").replace(/\s+/g, " ").trim();
  return title || null;
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
  // Raw copies of a few posts, kept so the embed layout can be inspected if
  // the parser misses: the first posts seen, plus the first titled ones.
  const samples = [];
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
        const titled = Boolean(embed && embed.title);
        if (samples.length < 5 || (titled && samples.filter((sample) => sample.titled).length < 2)) {
          samples.push({
            id: message.id,
            channel: channel.name || "",
            titled,
            content: message.content || "",
            embeds: message.embeds || [],
            components: message.components || []
          });
        }
        events.push({
          id: message.id,
          channelId: channel.id,
          channel: channel.name || "",
          postedAt: message.timestamp || null,
          title: embed && embed.title ? String(embed.title) : decodeEmojiTitle(description),
          eventDate: parseEventDate(embed),
          organizer: parseOrganizer(embed),
          participants: parseParticipants(embed)
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
    samples: samples.map(({ titled, ...rest }) => rest),
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
