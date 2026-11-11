import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "data/neverwinter-news.json");
const PAGE = resolve(ROOT, "index.html");
const API_URL = "https://api.arcgames.com/v1.0/games/nw/news";
const PAGE_SIZE = 20;
const MAX_ARTICLES = 100;

async function requestPage(offset) {
  const params = new URLSearchParams({ tag: "*", limit: String(PAGE_SIZE), offset: String(offset) });
  params.append("field[]", "images.img_microsite_thumbnail");
  params.append("field[]", "platforms");
  params.append("field[]", "updated");
  const response = await fetch(`${API_URL}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "SynergyGuildNewsFeed/1.0" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Neverwinter API returned ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (!Array.isArray(payload.news)) throw new Error("Neverwinter API returned an unexpected response");
  return payload;
}

const records = [];
const seen = new Set();
let offset = 0;
let moreNews = true;

while (moreNews && records.length < MAX_ARTICLES) {
  const page = await requestPage(offset);
  const pageItems = page.news;
  if (pageItems.length === 0) break;

  for (const item of pageItems) {
    if (item.language?.id && item.language.id !== "en") continue;
    const id = String(item.id || "");
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    records.push({
      id,
      title: String(item.title || "Neverwinter announcement").trim(),
      summary: String(item.summary || "").trim(),
      date: String(item.updated || "").slice(0, 10),
      url: `https://www.playneverwinter.com/en/news-details/${id}`,
      image: item.images?.img_microsite_thumbnail?.url || "",
      platforms: Array.isArray(item.platforms) ? item.platforms : [],
      tags: Array.isArray(item.tags) ? item.tags : []
    });
    if (records.length >= MAX_ARTICLES) break;
  }

  moreNews = Boolean(page.more_news);
  offset += pageItems.length;
}

if (records.length === 0) throw new Error("No English Neverwinter articles were returned; keeping the current feed file unchanged.");

let previousFeed = null;
try {
  previousFeed = JSON.parse(await readFile(OUTPUT, "utf8"));
} catch {
  previousFeed = null;
}
const feedUnchanged = JSON.stringify(previousFeed?.articles || null) === JSON.stringify(records);
const output = {
  source: "https://www.playneverwinter.com/en/news",
  api: API_URL,
  generatedAt: feedUnchanged && previousFeed?.generatedAt ? previousFeed.generatedAt : new Date().toISOString(),
  count: records.length,
  articles: records
};

await mkdir(dirname(OUTPUT), { recursive: true });
const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;
if (!feedUnchanged) await writeFile(OUTPUT, serializedOutput, "utf8");

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[character]));
const platformNames = { pc: "PC", ps: "PlayStation", xbox: "Xbox" };
const formatDate = (value) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? new Date(`${value}T12:00:00Z`) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : "Date unavailable";
};
const initialCards = records.slice(0, 20).map((article) => {
  const url = `https://www.playneverwinter.com/en/news-details/${article.id}`;
  const platforms = article.platforms.map((platform) => platformNames[platform]).filter(Boolean).join(" · ");
  const image = article.image
    ? `<img class="news-card-image" src="${escapeHtml(article.image)}" alt="" loading="lazy" decoding="async">`
    : "";
  return `          <article class="news-card${image ? " has-image" : ""}">\n            <div class="news-card-copy">\n              <p class="news-card-date"><time datetime="${escapeHtml(article.date)}">${escapeHtml(formatDate(article.date))}</time></p>\n              <h3><a href="${url}" target="_blank" rel="noopener noreferrer external">${escapeHtml(article.title)}</a></h3>\n              <p class="news-card-summary">${escapeHtml(article.summary || "Open the official article for the full announcement.")}</p>\n              ${platforms ? `<p class="news-card-date">${escapeHtml(platforms)}</p>\n              ` : ""}<a class="news-card-link" href="${url}" target="_blank" rel="noopener noreferrer external">Read the official article ↗</a>\n            </div>\n            ${image ? `            ${image}\n` : ""}          </article>`;
}).join("\n");

const html = await readFile(PAGE, "utf8");
const marker = /<!-- NEWS_ITEMS_START -->[\s\S]*?<!-- NEWS_ITEMS_END -->/;
if (!marker.test(html)) throw new Error("Could not find the news page content markers; refusing to overwrite the page.");
const nextHtml = html.replace(marker, `<!-- NEWS_ITEMS_START -->\n${initialCards}\n          <!-- NEWS_ITEMS_END -->`);
const itemList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: records.slice(0, 20).map((article, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: article.title,
    url: article.url
  }))
};
const schemaMarker = /(<script id="news-item-list-schema" type="application\/ld\+json">)[\s\S]*?(<\/script>)/;
if (!schemaMarker.test(nextHtml)) throw new Error("Could not find the news structured-data marker; refusing to overwrite the page.");
const schemaJson = JSON.stringify(itemList).replace(/</g, "\\u003c");
const renderedHtml = nextHtml.replace(schemaMarker, `$1${schemaJson}$2`);
if (renderedHtml !== html) await writeFile(PAGE, renderedHtml, "utf8");

console.log(`${feedUnchanged ? "No feed changes" : `Wrote ${records.length} official English news records`}; rendered ${Math.min(20, records.length)} crawlable article cards.`);
