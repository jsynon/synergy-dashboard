"use strict";

// Achievements tab: seven top-ten boards computed from the guild's own
// published records — data/snapshot.json (roster + bank log) and
// data/screenshots.json (the Discord screenshot gallery index).

const BOARD_SIZE = 10;

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
      account,
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
      account,
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
      account: entry.account,
      value: `${entry.count} deposit${entry.count === 1 ? "" : "s"}`,
      valueSub: "into the guild bank",
      sort: -entry.count,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// Gold sits in the bank log as "Copper": 100 copper = 1 silver and
// 100 silver = 1 gold, so 10,000 copper = 1 gold.
const COPPER_PER_GOLD = 10000;

function formatGold(copper) {
  const gold = copper / COPPER_PER_GOLD;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(gold);
}

function buildHighRoller(snapshot) {
  const bestByAccount = new Map();
  for (const event of snapshot.bankEvents || []) {
    if (event.action !== "deposit") continue;
    if (String(event.item || "").trim().toLowerCase() !== "copper") continue;
    const key = String(event.account || "").trim().toLowerCase();
    if (!key) continue;
    const current = bestByAccount.get(key);
    if (!current || (event.amount || 0) > current.amount) {
      bestByAccount.set(key, {
        account: event.account,
        player: event.player,
        amount: event.amount || 0,
        when: parseDate(event.date),
      });
    }
  }
  const rows = [];
  for (const entry of bestByAccount.values()) {
    rows.push({
      name: entry.player || entry.account,
      sub: entry.account,
      account: entry.account,
      value: `${formatGold(entry.amount)} gold`,
      valueSub: entry.when ? `single deposit · ${formatDate(entry.when)}` : "single deposit",
      sort: -entry.amount,
      tie: entry.when ? entry.when.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// A return is an account coming back: a join that arrives while none
// of the account's characters are in the guild, after the account has
// previously emptied out (every character gone). Counted from the
// recorded guild log; current roster accounts only.
function buildBoomerang(snapshot) {
  const groups = groupRosterByAccount(snapshot.roster);
  const events = [...(snapshot.events || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)));
  const accounts = new Map();
  for (const event of events) {
    if (event.kind !== "join" && event.kind !== "exit") continue;
    const match = /^(.+?)@([^\s']+)/.exec(event.text || "");
    if (!match) continue;
    const characterKey = `${match[1].trim().toLowerCase()}|${match[2].toLowerCase()}`;
    const accountKey = `@${match[2]}`.toLowerCase();
    if (!accounts.has(accountKey)) {
      accounts.set(accountKey, { inSet: new Set(), hasLeft: false, returns: 0, last: null });
    }
    const entry = accounts.get(accountKey);
    if (event.kind === "exit") {
      entry.inSet.delete(characterKey);
      if (entry.inSet.size === 0) entry.hasLeft = true;
    } else {
      if (entry.inSet.size === 0 && entry.hasLeft) {
        entry.returns += 1;
        const when = parseDate(event.date);
        if (when && (!entry.last || when > entry.last)) entry.last = when;
      }
      entry.inSet.add(characterKey);
    }
  }
  const rows = [];
  for (const [accountKey, entry] of accounts) {
    if (!entry.returns) continue;
    const group = groups.get(accountKey);
    if (!group) continue;
    const lead = leadCharacter(group.characters);
    rows.push({
      name: lead.name,
      sub: group.account,
      account: group.account,
      value: `${entry.returns} return${entry.returns === 1 ? "" : "s"}`,
      valueSub: entry.last ? `latest ${formatDate(entry.last)}` : "came back to Synergy",
      sort: -entry.returns,
      tie: entry.last ? -entry.last.getTime() : 0,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function buildNewBlood(snapshot) {
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
      account,
      value: formatDate(earliest),
      valueSub: tenureText(earliest, asOf),
      sort: -earliest.getTime(),
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
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
    if (row.account) {
      const link = document.createElement("a");
      link.className = "activity-member-link";
      link.href = "#account-dialog";
      link.setAttribute("aria-haspopup", "dialog");
      link.dataset.memberQuery = row.name;
      link.dataset.accountQuery = row.account;
      link.textContent = row.name;
      name.append(link);
    } else {
      name.textContent = row.name;
    }
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
  const snapshotBoards = ["board-elders", "board-alt-army", "board-benefactor", "board-high-roller", "board-boomerang", "board-new-blood"];
  try {
    const snapshot = await loadJson("data/snapshot.json");
    renderBoard("board-elders", buildElders(snapshot));
    renderBoard("board-alt-army", buildAltArmy(snapshot));
    renderBoard("board-benefactor", buildBenefactor(snapshot));
    renderBoard("board-high-roller", buildHighRoller(snapshot));
    renderBoard("board-boomerang", buildBoomerang(snapshot));
    renderBoard("board-new-blood", buildNewBlood(snapshot));

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
