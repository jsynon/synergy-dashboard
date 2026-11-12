import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Suno has no official public API. This reads the same public profile
// endpoint that the suno.com profile page itself loads, and keeps only
// the fields the Guild Info soundtrack card displays. Because the source
// is unofficial, a Suno failure must never break the rest of the refresh
// run: on any error the script keeps the previous data file untouched
// (or writes an empty catalog on first run) and exits successfully.
const handle = "antilogic";
const profileUrl = `https://suno.com/@${handle}`;
const outputPath = resolve("data/suno-music.json");

const readPrevious = async () => {
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8"));
    if (previous && Array.isArray(previous.songs)) return previous;
  } catch {
    // A missing or invalid prior file should not prevent a fresh write.
  }
  return null;
};

const fetchProfilePage = async (page) => {
  const endpoint = `https://studio-api.prod.suno.com/api/profiles/${handle}?playlists_sort_by=created_at&clips_sort_by=created_at&page=${page}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Synergy guild website refresh (https://synergyonline.org/)"
    }
  });
  if (!response.ok) {
    throw new Error(`Suno profile request failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.clips)) {
    throw new Error("Suno returned an unexpected profile response.");
  }
  return payload;
};

try {
  const songsById = new Map();
  let totalClips = Infinity;
  let displayName = "Antilogic";
  for (let page = 1; page <= 10 && songsById.size < totalClips; page++) {
    const payload = await fetchProfilePage(page);
    if (page === 1) {
      totalClips = Number(payload.num_total_clips) || 0;
      if (typeof payload.display_name === "string" && payload.display_name) {
        displayName = payload.display_name;
      }
    }
    let added = 0;
    for (const clip of payload.clips) {
      if (!clip || clip.is_public !== true || clip.status !== "complete") continue;
      if (clip.is_trashed || clip.is_hidden) continue;
      if (typeof clip.id !== "string" || typeof clip.title !== "string") continue;
      if (songsById.has(clip.id)) continue;
      songsById.set(clip.id, {
        id: clip.id,
        title: clip.title,
        url: `https://suno.com/song/${clip.id}`,
        imageUrl: typeof clip.image_url === "string" ? clip.image_url : "",
        plays: Number(clip.play_count) || 0,
        likes: Number(clip.upvote_count) || 0,
        durationSeconds: Math.round(Number(clip.metadata?.duration) || 0),
        createdAt: typeof clip.created_at === "string" ? clip.created_at : null
      });
      added++;
    }
    if (!payload.clips.length || added === 0) break;
  }

  const songs = [...songsById.values()].sort(
    (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  );
  if (!songs.length) throw new Error("Suno profile returned no public songs.");

  const totals = {
    songs: songs.length,
    plays: songs.reduce((sum, song) => sum + song.plays, 0),
    likes: songs.reduce((sum, song) => sum + song.likes, 0)
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), handle, displayName, profileUrl, totals, songs }, null, 2)}\n`,
    "utf8"
  );
  console.log(`Fetched ${songs.length} public Suno song(s) for @${handle} (${totals.plays} total plays).`);
} catch (error) {
  const previous = await readPrevious();
  if (previous) {
    console.warn(`Suno refresh failed (${error.message}); keeping the previous soundtrack data from ${previous.generatedAt || "an earlier run"}.`);
  } else {
    console.warn(`Suno refresh failed (${error.message}); writing an empty soundtrack file so the card can show its fallback.`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), handle, displayName: "Antilogic", profileUrl, totals: { songs: 0, plays: 0, likes: 0 }, songs: [] }, null, 2)}\n`,
      "utf8"
    );
  }
}
