"use strict";

// Achievements tab: seven top-ten boards computed from the guild's own
// published records — data/snapshot.json (roster + bank log),
// data/screenshots.json (the Discord screenshot gallery index), and
// data/raid-helper-events.json (Raid-Helper sign-up posts).

const BOARD_SIZE = 10;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
      sort: -(characters.length),
      tie: earliest ? earliest.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// Taking an item out and putting it back — moving it between bank
// tabs, or withdrawing it and re-depositing it moments later — logs
// a withdrawal and then a deposit of the same item and amount by
// the same account. The deposit side of such a pair is not a new
// contribution, so it never counts toward the deposit-count board.
// Pairs are matched one-to-one in time order within a minute; a
// deposit that comes BEFORE a withdrawal is a real deposit and
// always counts.
const MOVE_WINDOW_MS = 60000;

function bankMoveDeposits(events) {
  const keyOf = (event) => [String(event.account || "").trim().toLowerCase(), event.item, event.amount].join("|");
  const withdrawals = new Map();
  for (const event of events) {
    if (event.action !== "withdraw") continue;
    const when = parseDate(event.date);
    if (!when) continue;
    const key = keyOf(event);
    if (!withdrawals.has(key)) withdrawals.set(key, []);
    withdrawals.get(key).push(when.getTime());
  }
  for (const list of withdrawals.values()) list.sort((a, b) => a - b);
  const pointers = new Map();
  const moves = new Set();
  const deposits = events
    .filter((event) => event.action === "deposit")
    .map((event) => [event, parseDate(event.date)])
    .filter((pair) => pair[1])
    .sort((a, b) => a[1] - b[1]);
  for (const [event, when] of deposits) {
    const key = keyOf(event);
    const list = withdrawals.get(key);
    if (!list) continue;
    const t = when.getTime();
    let i = pointers.get(key) || 0;
    while (i < list.length && list[i] < t - MOVE_WINDOW_MS) i += 1;
    if (i < list.length && list[i] <= t) {
      moves.add(event);
      i += 1;
    }
    pointers.set(key, i);
  }
  return moves;
}

function buildBenefactor(snapshot) {
  const moves = bankMoveDeposits(snapshot.bankEvents || []);
  const depositsByAccount = new Map();
  for (const event of snapshot.bankEvents || []) {
    if (event.action !== "deposit") continue;
    if (moves.has(event)) continue;
    const key = String(event.account || "").trim().toLowerCase();
    if (!key) continue;
    // The guild leader stocks the bank with donated funds, so his
    // account does not compete on the bank boards.
    if (key === "@zorlonix") continue;
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
      sort: -entry.count,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// Gold is recorded in the bank log as "Copper"; amounts are shown as gold.
const COPPER_PER_GOLD = 10000;

function formatGold(copper) {
  const gold = copper / COPPER_PER_GOLD;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(gold);
}

function buildHighRoller(snapshot) {
  const totalsByAccount = new Map();
  for (const event of snapshot.bankEvents || []) {
    if (event.action !== "deposit") continue;
    if (String(event.item || "").trim().toLowerCase() !== "copper") continue;
    const key = String(event.account || "").trim().toLowerCase();
    if (!key) continue;
    if (key === "@zorlonix") continue;
    const amount = Number(event.amount) || 0;
    if (amount <= 0) continue;
    if (!totalsByAccount.has(key)) {
      totalsByAccount.set(key, { account: event.account, total: 0, players: new Map(), first: null });
    }
    const entry = totalsByAccount.get(key);
    entry.total += amount;
    const player = String(event.player || "").trim();
    if (player) entry.players.set(player, (entry.players.get(player) || 0) + amount);
    const when = parseDate(event.date);
    if (when) {
      if (!entry.first || when < entry.first) entry.first = when;
    }
  }
  const rows = [];
  for (const entry of totalsByAccount.values()) {
    const leadPlayer = [...entry.players.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    rows.push({
      name: leadPlayer ? leadPlayer[0] : entry.account,
      sub: entry.account,
      account: entry.account,
      value: `${formatGold(entry.total)} gold`,
      sort: -entry.total,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

function buildNewBlood(snapshot) {
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
      sort: -earliest.getTime(),
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// Discord accounts that cannot hold a photographer board spot:
// former members who have left the guild. (A deleted account is
// excluded separately, by its "Deleted User" author name.)
const INELIGIBLE_PHOTOGRAPHERS = new Set(["palikka9904", "raumraktzatanhaag", ".maladroite", "diskordal", "ilytbrbluu", "acyl_vrion1", "cal_cass", "k5oul", "sachi314159", "rafaelbruno021", "MEE6"]);

function buildPhotographer(shotsData) {
  const byUser = new Map();
  for (const shot of shotsData.screenshots || []) {
    // A deleted Discord account cannot hold a board spot, and
    // neither can a former member who has left the guild.
    if (!shot.username || shot.author === "Deleted User" || INELIGIBLE_PHOTOGRAPHERS.has(shot.username)) continue;
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
      sort: -entry.count,
      tie: entry.first ? entry.first.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  rows.sort((a, b) => a.sort - b.sort || a.tie - b.tie || a.name.localeCompare(b.name));
  return rows.slice(0, BOARD_SIZE);
}

// Organizer names in Raid-Helper posts are Discord display names, and
// the same host can appear under more than one spelling: these are one
// person, counted together under the plainer name.
const HOST_NAME_ALIASES = new Map([
  ["Reinds/sojo/sojo1", "Reinds"],
  ["Elanor/Rydark", "Elanor"],
]);

// Organizers who cannot hold an event host board spot: former members
// who have left the guild, per the guild leader's audit of the records.
const INELIGIBLE_HOSTS = new Set(["Vega", "Vega ~ Soul", "Elenara", "Andealous", "Micioarancio"]);

// The collector stores each run's date as an Eastern calendar date
// ("2026-11-11"); read it as a plain date, not a UTC-midnight instant,
// so the board shows the same day in every visitor's timezone.
function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function buildEventHost(raidData) {
  const byHost = new Map();
  for (const event of raidData.events || []) {
    const raw = String(event.organizer || "").trim();
    if (!raw || INELIGIBLE_HOSTS.has(raw)) continue;
    const name = HOST_NAME_ALIASES.get(raw) || raw;
    if (!byHost.has(name)) byHost.set(name, { name, count: 0, first: null, latest: null });
    const entry = byHost.get(name);
    entry.count += 1;
    const when = parseDateOnly(event.eventDate) || parseDate(event.postedAt);
    if (when && (!entry.first || when < entry.first)) entry.first = when;
    if (when && (!entry.latest || when > entry.latest)) entry.latest = when;
  }
  const rows = [];
  for (const entry of byHost.values()) {
    rows.push({
      name: entry.name,
      sub: entry.latest ? `Latest run ${formatDate(entry.latest)}` : "Raid-Helper sign-up posts",
      value: `${entry.count} run${entry.count === 1 ? "" : "s"} hosted`,
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
    stat.append(value);
    if (row.valueSub) {
      const valueSub = document.createElement("span");
      valueSub.className = "score-value-sub";
      valueSub.textContent = row.valueSub;
      stat.append(valueSub);
    }
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
  const snapshotBoards = ["board-elders", "board-alt-army", "board-benefactor", "board-high-roller", "board-new-blood"];
  try {
    const snapshot = await loadJson("data/snapshot.json");
    renderBoard("board-elders", buildElders(snapshot));
    renderBoard("board-alt-army", buildAltArmy(snapshot));
    renderBoard("board-benefactor", buildBenefactor(snapshot));
    renderBoard("board-high-roller", buildHighRoller(snapshot));
    renderBoard("board-new-blood", buildNewBlood(snapshot));

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

  try {
    const raid = await loadJson("data/raid-helper-events.json");
    renderBoard("board-event-host", buildEventHost(raid));
  } catch (error) {
    renderUnavailable(["board-event-host"]);
  }
}

init();
