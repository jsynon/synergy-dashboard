"use strict";

// Achievements page: four top-five boards computed from the guild's own
// published records — data/snapshot.json (roster + bank log) and
// data/screenshots.json (the Discord screenshot gallery index).

const BOARD_SIZE = 5;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tenureText(from, to) {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  if (months < 1) return "under a month in the guild";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years > 0 ? `${years} yr${years === 1 ? "" : "s"}` : "";
  const monthPart = rest > 0 ? `${rest} mo${rest === 1 ? "" : "s"}` : "";
  return `${[yearPart, monthPart].filter(Boolean).join(" ")} in the guild`;
}

// Best display character for an account: highest rank first, then the
// longest-standing character (the likeliest main), then name.
function leadCharacter(characters) {
  const joinedAt = (member) => {
    const joined = parseDate(member.joinDate) || parseDate(member.originalJoinDate);
    return joined ? joined.getTime() : Number.MAX_SAFE_INTEGER;
  };
  return [...characters].sort((a, b) =>
    (b.rankOrder || 0) - (a.rankOrder || 0) || joinedAt(a) - joinedAt(b) || String(a.name).localeCompare(String(b.name)))[0];
}

function groupRosterByAccount(roster) {
  const byAccount = new Map();
  for (const member of roster || []) {
    const key = String(member.account || "").trim().toLowerCase();
    if (!key) continue;
    if (!byAccount.has(key)) byAccount.set(key, { account: member.account, characters: [] });
    byAccount.get(key).characters.push(member);
  }
  return byAccount;
}

function buildElders(snapshot) {
  const asOf = parseDate(snapshot.generatedAt) || new Date();
  const rows = [];
  for (const { account, characters } of groupRosterByAccount(snapshot.roster).values()) {
    let earliest = null;
    for (const member of characters) {
      const joined = parseDate(member.originalJoinDate) || parseDate(member.joinDate);
      if (joined && (!earliest || joined < earliest)) earliest = joined;
    }
    if (!earliest) continue;
    const lead = leadCharacter(characters);
    rows.push({
      name: lead.name,
      sub: account,
      value: formatDate(earliest),
      valueSub: tenureText(earliest, asOf),
      sort: earliest.getTime(),
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function buildAltArmy(snapshot) {
  const rows = [];
  for (const { account, characters } of groupRosterByAccount(snapshot.roster).values()) {
    let earliest = null;
    for (const member of characters) {
      const joined = parseDate(member.originalJoinDate) || parseDate(member.joinDate);
      if (joined && (!earliest || joined < earliest)) earliest = joined;
    }
    const lead = leadCharacter(characters);
    rows.push({
      name: lead.name,
      sub: account,
      value: `${characters.length} character${characters.length === 1 ? "" : "s"}`,
      valueSub: characters.length > 1 ? `${characters.length - 1} alts in the guild` : "one and only",
      sort: -(characters.length),
      tie: earliest ? earliest.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function buildBenefactor(snapshot) {
  const depositsByAccount = new Map();
  for (const event of snapshot.bankEvents || []) {
    if (event.action !== "deposit") continue;
    const key = String(event.account || "").trim().toLowerCase();
    if (!key) continue;
    if (!depositsByAccount.has(key)) {
      depositsByAccount.set(key, { account: event.account, count: 0, players: new Map(), first: null });
    }
    const entry = depositsByAccount.get(key);
    entry.count += 1;
    entry.players.set(event.player, (entry.players.get(event.player) || 0) + 1);
    const when = parseDate(event.date);
    if (when && (!entry.first || when < entry.first)) entry.first = when;
  }
  const rows = [];
  for (const entry of depositsByAccount.values()) {
    const leadPlayer = [...entry.players.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    rows.push({
      name: leadPlayer ? leadPlayer[0] : entry.account,
      sub: entry.account,
      value: `${entry.count} deposit${entry.count === 1 ? "" : "s"}`,
      valueSub: "into the guild bank",
      sort: -entry.count,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function buildPhotographer(shotsData) {
  const byUser = new Map();
  for (const shot of shotsData.screenshots || []) {
    // A deleted Discord account cannot hold a board spot.
    if (!shot.username || shot.author === "Deleted User") continue;
    if (!byUser.has(shot.username)) {
      byUser.set(shot.username, { author: shot.author || shot.username, count: 0, first: null, latest: null });
    }
    const entry = byUser.get(shot.username);
    entry.count += 1;
    const when = parseDate(shot.postedAt);
    if (when && (!entry.first || when < entry.first)) entry.first = when;
    if (when && (!entry.latest || when > entry.latest)) entry.latest = when;
  }
  const rows = [];
  for (const entry of byUser.values()) {
    rows.push({
      name: entry.author,
      sub: entry.latest ? `Latest shared ${formatDate(entry.latest)}` : "Discord screenshot channel",
      value: `${entry.count} screenshot${entry.count === 1 ? "" : "s"}`,
      valueSub: "shared with the guild",
      sort: -entry.count,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function renderBoard(listId, rows) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    const item = document.createElement("li");
    item.className = "score-empty";
    item.textContent = "No records yet.";
    list.append(item);
    return;
  }
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    item.className = "score-row";

    const rank = document.createElement("span");
    rank.className = `score-rank rank-${index + 1}`;
    rank.textContent = String(index + 1);
    item.append(rank);

    const who = document.createElement("span");
    who.className = "score-who";
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = row.name;
    const sub = document.createElement("span");
    sub.className = "score-sub";
    sub.textContent = row.sub;
    who.append(name, sub);
    item.append(who);

    const stat = document.createElement("span");
    stat.className = "score-stat";
    const value = document.createElement("span");
    value.className = "score-value";
    value.textContent = row.value;
    const valueSub = document.createElement("span");
    valueSub.className = "score-value-sub";
    valueSub.textContent = row.valueSub;
    stat.append(value, valueSub);
    item.append(stat);

    list.append(item);
  });
}

function renderUnavailable(listIds) {
  for (const listId of listIds) {
    const list = document.getElementById(listId);
    if (!list) continue;
    list.replaceChildren();
    const item = document.createElement("li");
    item.className = "score-empty";
    item.textContent = "Records unavailable right now.";
    list.append(item);
  }
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  return response.json();
}

async function init() {
  const snapshotBoards = ["board-elders", "board-alt-army", "board-benefactor"];
  try {
    const snapshot = await loadJson("data/snapshot.json");
    renderBoard("board-elders", buildElders(snapshot));
    renderBoard("board-alt-army", buildAltArmy(snapshot));
    renderBoard("board-benefactor", buildBenefactor(snapshot));

    const bankDates = (snapshot.bankEvents || []).map((event) => parseDate(event.date)).filter(Boolean);
    if (bankDates.length) {
      const note = document.getElementById("benefactor-note");
      const earliest = new Date(Math.min(...bankDates.map((date) => date.getTime())));
      if (note) note.textContent = `Ranked by deposits in the guild bank records the site holds, which begin ${formatDate(earliest)}.`;
    }
    const updated = document.getElementById("achievements-updated");
    const generated = parseDate(snapshot.generatedAt);
    if (updated && generated) updated.textContent = `Boards current as of ${formatDate(generated)}.`;
  } catch (error) {
    renderUnavailable(snapshotBoards);
  }

  try {
    const shots = await loadJson("data/screenshots.json");
    renderBoard("board-photographer", buildPhotographer(shots));
  } catch (error) {
    renderUnavailable(["board-photographer"]);
  }
}

init();
