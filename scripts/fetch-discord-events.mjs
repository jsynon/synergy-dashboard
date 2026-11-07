import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) throw new Error("DISCORD_BOT_TOKEN secret is not configured.");
if (!guildId || !/^\d{17,20}$/.test(guildId)) {
  throw new Error("DISCORD_GUILD_ID must be configured as a Discord server ID.");
}

const endpoint = `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`;
const response = await fetch(endpoint, {
  headers: {
    Authorization: `Bot ${token}`,
    Accept: "application/json",
    "User-Agent": "DiscordBot (https://jsynon.github.io/synergy-dashboard/, 1.0)"
  }
});

if (!response.ok) {
  throw new Error(`Discord Scheduled Events request failed with HTTP ${response.status}.`);
}

const payload = await response.json();
if (!Array.isArray(payload)) {
  throw new Error("Discord returned an unexpected Scheduled Events response.");
}

const now = Date.now();
const localDayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const todayLocal = localDayKey(now);
const events = payload
  .filter((event) => {
    const status = event.status;
    const scheduled = status === 1 || status === "SCHEDULED";
    const active = status === 2 || status === "ACTIVE";
    if (!scheduled && !active) return false;

    const start = Date.parse(event.scheduled_start_time || "");
    if (!Number.isFinite(start)) return false;
    if (scheduled) return start > now;

    const end = Date.parse(event.scheduled_end_time || "");
    return !Number.isFinite(end) || end > now;
  })
  .map((event) => ({
    id: String(event.id),
    guildId: String(event.guild_id || guildId),
    name: String(event.name || "Guild event"),
    startTime: event.scheduled_start_time,
    endTime: event.scheduled_end_time || null,
    location: typeof event.entity_metadata?.location === "string" ? event.entity_metadata.location : "",
    recurring: Boolean(event.recurrence_rule)
  }));

const outputPath = resolve("data/discord-events.json");
let previousEvents = [];
try {
  const previousFeed = JSON.parse(await readFile(outputPath, "utf8"));
  if (Array.isArray(previousFeed.events)) previousEvents = previousFeed.events;
} catch {
  // A missing or invalid prior feed should not prevent a fresh feed from being written.
}

// Keep a just-completed event through its final calendar day in Eastern time.
const currentIds = new Set(events.map((event) => event.id));
for (const event of previousEvents) {
  if (currentIds.has(event.id)) continue;
  const lastMoment = event.endTime || event.startTime;
  if (localDayKey(lastMoment) === todayLocal) events.push(event);
}

events.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), guildId, events }, null, 2)}\n`, "utf8");
console.log(`Fetched ${events.length} upcoming or active Synergy Discord event(s).`);
