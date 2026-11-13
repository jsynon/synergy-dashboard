// Fetch every image posted in the guild's Discord screenshots channel and
// mirror it into the repo so the website gallery never depends on Discord
// CDN links (those expire). Runs in the refresh workflow alongside the news,
// events, and soundtrack fetchers, using the same bot token.
//
// Fail-soft by design (like the Suno fetcher): any problem — missing token,
// channel not found, the bot lacking permission, a Discord outage — logs a
// clear warning and leaves the previous data/screenshots.json and images
// untouched, so the rest of the refresh is never blocked by the gallery.

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const API = "https://discord.com/api/v10";
const IMAGE_DIR = resolve("assets/screenshots");
const THUMB_DIR = resolve("assets/screenshots/thumbs");
const THUMB_WIDTH = 640;
const OUTPUT_PATH = resolve("data/screenshots.json");
const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const PAGE_SIZE = 100;
const MAX_PAGES = 60; // safety stop: 6,000 messages of history per run

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function discord(path, token) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        Accept: "application/json",
        "User-Agent": "DiscordBot (https://synergyonline.org, 1.0)"
      }
    });
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const waitMs = Math.ceil((Number(body.retry_after) || 1) * 1000);
      console.log(`Discord rate limit; waiting ${waitMs}ms.`);
      await sleep(waitMs);
      continue;
    }
    if (!response.ok) {
      const detail = response.status === 403
        ? " (the bot likely cannot view this channel — check its channel permissions)"
        : "";
      throw new Error(`Discord request failed with HTTP ${response.status} for ${path}${detail}.`);
    }
    return response.json();
  }
  throw new Error(`Discord request kept rate-limiting: ${path}`);
}

// Channel names in the guild are decorated ("📸│𝚂𝚌𝚛𝚎𝚎𝚗𝚜𝚑𝚘𝚝𝚜"). NFKC folds
// the mathematical-bold letters back to plain ASCII; stripping everything
// that is not a letter or digit leaves the comparable core name.
function normalizeChannelName(name) {
  return String(name || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extensionOf(filename, contentType) {
  const fromName = String(filename || "").split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(fromName)) return fromName;
  const fromType = String(contentType || "").split("/").pop()?.toLowerCase() || "";
  if (fromType === "jpeg") return "jpg";
  return IMAGE_EXTENSIONS.has(fromType) ? fromType : null;
}

function thumbNameFor(fileName) {
  return fileName.replace(/\.[^.]+$/, ".webp");
}

// Small WebP copies for the gallery grid, made with the ImageMagick that
// ships on the workflow runner ("convert" on v6, "magick" on v7). Returns
// false when the tool is missing or the conversion fails — thumbnails are
// an optimization, never a reason to fail the run.
async function makeThumbnail(sourcePath, targetPath, isGif) {
  const input = isGif ? `${sourcePath}[0]` : sourcePath;
  const args = [input, "-auto-orient", "-resize", `${THUMB_WIDTH}x>`, "-quality", "82", targetPath];
  for (const binary of ["convert", "magick"]) {
    try {
      await execFileAsync(binary, args);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") return false;
    }
  }
  return false;
}

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token) throw new Error("DISCORD_BOT_TOKEN secret is not configured.");
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new Error("DISCORD_GUILD_ID must be configured as a Discord server ID.");
  }

  // Resolve the screenshots channel: explicit ID wins, else match by name.
  let channel = null;
  const override = process.env.DISCORD_SCREENSHOTS_CHANNEL_ID;
  const channels = await discord(`/guilds/${guildId}/channels`, token);
  if (!Array.isArray(channels)) throw new Error("Discord returned an unexpected channel list.");
  if (override) {
    channel = channels.find((item) => String(item.id) === String(override)) || { id: String(override), name: "screenshots" };
  } else {
    channel = channels.find((item) =>
      (item.type === 0 || item.type === 5) && normalizeChannelName(item.name) === "screenshots");
  }
  if (!channel) {
    const names = channels.filter((item) => item.type === 0 || item.type === 5).map((item) => item.name).join(", ");
    throw new Error(`No screenshots channel found. Text channels seen: ${names || "(none)"}.`);
  }
  console.log(`Screenshots channel: "${channel.name}" (${channel.id}).`);

  // Walk the channel history, newest first, one page at a time.
  const messages = [];
  let before = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = before ? `?limit=${PAGE_SIZE}&before=${before}` : `?limit=${PAGE_SIZE}`;
    const batch = await discord(`/channels/${channel.id}/messages${query}`, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    messages.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
    await sleep(250);
  }
  console.log(`Scanned ${messages.length} message(s).`);

  // Existing downloads, so repeat runs only fetch what is new.
  await mkdir(IMAGE_DIR, { recursive: true });
  const onDisk = new Set(await readdir(IMAGE_DIR).catch(() => []));
  let onDiskThumbs = new Set();

  const screenshots = [];
  let attachmentsSeen = 0;
  let downloaded = 0;
  let skippedVideo = 0;
  let downloadFailures = 0;
  const referenced = new Set();
  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      attachmentsSeen += 1;
      const ext = extensionOf(attachment.filename, attachment.content_type);
      if (!ext) { skippedVideo += 1; continue; }
      const fileName = `${message.id}-${attachment.id}.${ext}`;
      referenced.add(fileName);
      if (!onDisk.has(fileName)) {
        try {
          const response = await fetch(attachment.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await writeFile(resolve(IMAGE_DIR, fileName), Buffer.from(await response.arrayBuffer()));
          downloaded += 1;
          await sleep(150);
        } catch (error) {
          downloadFailures += 1;
          console.warn(`Could not download ${attachment.filename}: ${error.message}. It will be retried next run.`);
          continue;
        }
      }
      screenshots.push({
        id: String(attachment.id),
        file: `assets/screenshots/${fileName}`,
        author: String(message.author?.global_name || message.author?.username || "Guild member"),
        username: String(message.author?.username || ""),
        caption: String(message.content || "").trim().slice(0, 300),
        postedAt: message.timestamp,
        width: attachment.width || null,
        height: attachment.height || null
      });
    }
  }

  // Thumbnails for the grid: the page shows these small copies and keeps
  // the full-size originals for the viewer. Any screenshot whose original
  // is on disk gets one, so the first run after this ships also backfills
  // the existing archive. Fail-soft: without ImageMagick (or on a failed
  // conversion) the item simply has no thumb and the page uses the original.
  await mkdir(THUMB_DIR, { recursive: true });
  onDiskThumbs = new Set(await readdir(THUMB_DIR).catch(() => []));
  let thumbsCreated = 0;
  let thumbsFailed = 0;
  for (const shot of screenshots) {
    const fileName = shot.file.split("/").pop();
    const thumbName = thumbNameFor(fileName);
    if (!onDiskThumbs.has(thumbName)) {
      const created = await makeThumbnail(resolve(IMAGE_DIR, fileName), resolve(THUMB_DIR, thumbName), fileName.toLowerCase().endsWith(".gif"));
      if (created) { thumbsCreated += 1; onDiskThumbs.add(thumbName); }
      else thumbsFailed += 1;
    }
    if (onDiskThumbs.has(thumbName)) shot.thumb = `assets/screenshots/thumbs/${thumbName}`;
  }
  if (thumbsFailed > 0) {
    console.warn(`Thumbnails could not be created for ${thumbsFailed} screenshot(s) (ImageMagick missing or conversion failed); those grid tiles will load the full-size original instead.`);
  }

  // Only prune (posts deleted in Discord) after a complete pass in which
  // every kept image is actually on disk; a failed download keeps its file
  // out of the index for this run but must not delete anything.
  let pruned = 0;
  if (downloadFailures === 0) {
    for (const file of onDisk) {
      if (file.startsWith(".") || file === "thumbs") continue;
      if (!referenced.has(file)) {
        await unlink(resolve(IMAGE_DIR, file)).catch(() => {});
        pruned += 1;
      }
    }
    const expectedThumbs = new Set(screenshots.map((shot) => thumbNameFor(shot.file.split("/").pop())));
    for (const file of onDiskThumbs) {
      if (file.startsWith(".")) continue;
      if (!expectedThumbs.has(file)) {
        await unlink(resolve(THUMB_DIR, file)).catch(() => {});
        pruned += 1;
      }
    }
  }

  if (messages.length > 0 && attachmentsSeen === 0) {
    console.warn("WARNING: Discord returned messages but no attachments at all. This is the signature of the bot missing the MESSAGE_CONTENT privileged intent: without it, Discord empties the content/embeds/attachments fields of messages the API returns. Enable it in the Discord Developer Portal (your application -> Bot -> Privileged Gateway Intents -> Message Content Intent), then re-run the refresh.");
  }

  screenshots.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  await mkdir(resolve("data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    channelId: String(channel.id),
    channelName: String(channel.name || "Screenshots"),
    screenshots
  }, null, 2)}\n`, "utf8");
  console.log(`Gallery: ${screenshots.length} screenshot(s) (${downloaded} newly downloaded, ${thumbsCreated} thumbnail(s) created, ${pruned} pruned, ${skippedVideo} non-image attachment(s) skipped).`);
}

main().catch((error) => {
  console.warn(`Screenshots fetch skipped: ${error.message} Keeping the previous gallery data.`);
});
