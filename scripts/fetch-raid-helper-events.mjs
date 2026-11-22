import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Collects Raid-Helper event posts from every text channel in the guild and
// records who organized each run and who signed up for it, for the Event
// Host audit/leaderboard and a participation tally.
//
// Incremental by design: the previous run's output file carries a per-channel
// watermark (the newest message ID seen), so a normal run only re-reads
// messages newer than that watermark — plus a rolling 7-day overlap, because
// Raid-Helper edits a post's embed as members sign up, and an edit does not
// change the message ID. Once a week (or whenever the saved state is missing
// or unusable) the collector falls back to a full scan of every channel,
// which also prunes posts that were deleted since they were recorded.
// Progress is logged per channel so a long run never looks stuck.
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

// Discord message IDs are snowflakes: the creation time, in milliseconds,
// sits in the high bits above a fixed epoch, so a timestamp converts to the
// smallest possible ID for that moment and IDs compare chronologically.
const DISCORD_EPOCH = 1420070400000n;
const DAY_MS = 24 * 60 * 60 * 1000;
const snowflakeForTime = (ms) => ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();
const idValue = (id) => {
  try { return BigInt(id); } catch { return 0n; }
};

// How far back every run re-reads even in incremental mode, so sign-up edits
// to recent posts are picked up, and how often a full rescan happens anyway.
const OVERLAP_MS = 7 * DAY_MS;
const FULL_SCAN_INTERVAL_MS = 7 * DAY_MS;

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

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "raid-helper-events.json");

// The previous run's output, if it exists and parses. Anything unusable is
// treated as "no previous run", which simply means the next scan is a full
// one — the safe direction to fall back.
const loadPrevious = async () => {
  try {
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    if (!parsed || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
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

  const now = Date.now();
  const previous = await loadPrevious();
  const previousState = previous && previous.scanState && typeof previous.scanState === "object"
    ? previous.scanState
    : null;
  const previousChannels = previousState && previousState.channels && typeof previousState.channels === "object"
    ? previousState.channels
    : {};
  const lastFullScanAt = previousState && Number.isFinite(Date.parse(previousState.lastFullScanAt))
    ? Date.parse(previousState.lastFullScanAt)
    : null;

  // A full scan rebuilds the event list from scratch. It is due when there is
  // no usable saved state, when the saved state predates this incremental
  // format but the last run left channels unreadable (so its coverage is
  // unknown), or when the last full scan is over a week old.
  let fullScan = !previous;
  if (previous && !previousState) {
    if (!Array.isArray(previous.channelsUnreadable) || previous.channelsUnreadable.length > 0
      || !Number.isFinite(Date.parse(previous.generatedAt))) {
      fullScan = true;
    }
  }
  if (lastFullScanAt !== null && now - lastFullScanAt > FULL_SCAN_INTERVAL_MS) fullScan = true;
  const seededWatermark = !fullScan && previous && !previousState
    ? snowflakeForTime(Date.parse(previous.generatedAt))
    : null;
  const effectiveLastFullScanAt = fullScan
    ? now
    : (lastFullScanAt !== null ? lastFullScanAt : (previous ? Date.parse(previous.generatedAt) : now));

  // Every incremental run re-reads at least the overlap window, so edits to
  // recent posts (sign-ups) land even though their message IDs are old.
  const overlapFloor = snowflakeForTime(now - OVERLAP_MS);

  console.log(fullScan
    ? "[raid-helper] Full scan: reading the complete history of every channel."
    : `[raid-helper] Incremental scan: re-checking new messages plus the last ${OVERLAP_MS / DAY_MS} days per channel (last full scan ${new Date(effectiveLastFullScanAt).toISOString()}).`);

  // Start from the recorded events; freshly fetched posts replace their
  // stored versions by message ID. A full scan starts empty, which is what
  // prunes posts deleted since they were recorded.
  const eventsById = new Map();
  if (!fullScan && previous) {
    for (const event of previous.events) {
      if (event && event.id) eventsById.set(String(event.id), event);
    }
  }
  const botAuthors = new Set(fullScan || !previous ? [] : (previous.botAuthors || []));
  // Raw copies of a few posts, kept so the embed layout can be inspected if
  // the parser misses: the first posts seen, plus the first titled ones.
  // Carried over from the previous run when nothing new is fetched.
  const samples = [];
  const unreadable = [];
  const scanChannels = {};
  let channelsScanned = 0;
  let messagesScanned = 0;

  for (const channel of textChannels) {
    const channelState = previousChannels[channel.id];
    let watermark = 0n;
    if (!fullScan) {
      if (channelState && channelState.newestMessageId) watermark = idValue(channelState.newestMessageId);
      else if (seededWatermark) watermark = idValue(seededWatermark);
      const floor = idValue(overlapFloor);
      if (floor < watermark) watermark = floor;
    }

    let before = null;
    let channelFailed = false;
    let readAnyPage = false;
    let newestSeen = 0n;
    let channelMessages = 0;
    let channelPosts = 0;
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
      channelMessages += messages.length;
      let crossedWatermark = false;
      for (const message of messages) {
        const messageId = idValue(message.id);
        if (messageId > newestSeen) newestSeen = messageId;
        if (messageId <= watermark) { crossedWatermark = true; continue; }
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
        eventsById.set(String(message.id), {
          id: message.id,
          channelId: channel.id,
          channel: channel.name || "",
          postedAt: message.timestamp || null,
          title: embed && embed.title ? String(embed.title) : decodeEmojiTitle(description),
          eventDate: parseEventDate(embed),
          organizer: parseOrganizer(embed),
          participants: parseParticipants(embed)
        });
        channelPosts += 1;
      }
      if (crossedWatermark || messages.length < 100) break;
      before = messages[messages.length - 1].id;
    }
    if (!channelFailed) {
      channelsScanned += 1;
      // The watermark only ever moves forward, and only on a clean scan: a
      // failed channel keeps its old watermark so the next run retries the
      // stretch this one could not read.
      const previousWatermark = channelState && channelState.newestMessageId
        ? idValue(channelState.newestMessageId)
        : 0n;
      const watermarkNow = newestSeen > previousWatermark ? newestSeen : previousWatermark;
      scanChannels[channel.id] = { newestMessageId: watermarkNow > 0n ? watermarkNow.toString() : null };
    } else if (channelState) {
      scanChannels[channel.id] = channelState;
    }
    console.log(`[raid-helper] #${channel.name || channel.id}: ${channelMessages} messages checked, ${channelPosts} event posts found${channelFailed ? " (read failed; kept previous data)" : ""}.`);
  }

  const events = [...eventsById.values()];
  events.sort((a, b) => String(b.postedAt || "").localeCompare(String(a.postedAt || "")));

  const output = {
    generatedAt: new Date().toISOString(),
    channelsScanned,
    channelsUnreadable: unreadable,
    messagesScanned,
    postsFound: events.length,
    unparsedPosts: events.filter((event) => !event.organizer).length,
    botAuthors: [...botAuthors],
    samples: (samples.length > 0 || fullScan || !previous
      ? samples
      : (previous.samples || [])).map(({ titled, ...rest }) => rest),
    events,
    scanState: {
      lastFullScanAt: new Date(effectiveLastFullScanAt).toISOString(),
      channels: scanChannels
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`[raid-helper] ${events.length} event posts across ${channelsScanned} channels (${messagesScanned} messages scanned, ${output.unparsedPosts} unparsed, ${fullScan ? "full scan" : "incremental scan"}).`);
};

try {
  await main();
} catch (error) {
  warn(`Collector failed: ${error && error.message ? error.message : error}`);
}
