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

// Two patterns keep a deposit out of the deposit-count board,
// because neither leaves the bank better off:
//
// Put-backs: taking an item out and putting it back — moving it
// between bank tabs, or withdrawing it and re-depositing it
// moments later — logs a withdrawal and then a deposit of the
// same item and amount by the same account. The deposit side of
// such a pair is not a new contribution. Pairs are matched
// one-to-one in time order within a minute; a deposit that comes
// BEFORE a withdrawal is a real deposit and always counts.
//
// Take-backs: a deposit whose item the same account withdraws
// again later — whenever that happens — did not stay given, so
// it stops counting. Each withdrawal cancels the most recent
// deposit before it, and a withdrawal already spent on a
// put-back pair is not spent twice.
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
    withdrawals.get(key).push([when.getTime(), event]);
  }
  for (const list of withdrawals.values()) list.sort((a, b) => a[0] - b[0]);
  const deposits = events
    .filter((event) => event.action === "deposit")
    .map((event) => [event, parseDate(event.date)])
    .filter((pair) => pair[1])
    .sort((a, b) => a[1] - b[1]);
  const moves = new Set();
  const spentWithdrawals = new Set();
  const pointers = new Map();
  for (const [event, when] of deposits) {
    const key = keyOf(event);
    const list = withdrawals.get(key);
    if (!list) continue;
    const t = when.getTime();
    let i = pointers.get(key) || 0;
    while (i < list.length && list[i][0] < t - MOVE_WINDOW_MS) i += 1;
    if (i < list.length && list[i][0] <= t) {
      moves.add(event);
      spentWithdrawals.add(list[i][1]);
      i += 1;
    }
    pointers.set(key, i);
  }
  const countedByKey = new Map();
  for (const [event, when] of deposits) {
    if (moves.has(event)) continue;
    const key = keyOf(event);
    if (!countedByKey.has(key)) countedByKey.set(key, []);
    countedByKey.get(key).push([event, when.getTime()]);
  }
  for (const [key, list] of withdrawals) {
    const counted = countedByKey.get(key);
    if (!counted) continue;
    for (const [t, withdrawal] of list) {
      if (spentWithdrawals.has(withdrawal)) continue;
      for (let i = counted.length - 1; i >= 0; i -= 1) {
        if (counted[i][1] < t) {
          moves.add(counted[i][0]);
          counted.splice(i, 1);
          break;
        }
      }
    }
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
  // Gold is reported net: a withdrawal of gold cancels gold the
  // same account deposited earlier, so what an account took back
  // out is not counted as given. Withdrawing gold the account
  // never deposited changes nothing.
  const totalsByAccount = new Map();
  const ordered = (snapshot.bankEvents || [])
    .map((event) => [event, parseDate(event.date)])
    .filter((pair) => pair[1])
    .sort((a, b) => a[1] - b[1]);
  for (const [event, when] of ordered) {
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
    if (event.action === "deposit") {
      entry.total += amount;
      const player = String(event.player || "").trim();
      if (player) entry.players.set(player, (entry.players.get(player) || 0) + amount);
      if (!entry.first || when < entry.first) entry.first = when;
    } else if (event.action === "withdraw") {
      entry.total = Math.max(0, entry.total - amount);
    }
  }
  const rows = [];
  for (const entry of totalsByAccount.values()) {
    if (entry.total <= 0) continue;
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
// Photographers shown by their Discord username rather than their
// display name: Sora's display name is just "k", and the guild
// leader asked for his username to be shown instead.
const PHOTOGRAPHER_SHOW_USERNAME = new Set(["k5oul"]);

const INELIGIBLE_PHOTOGRAPHERS = new Set(["palikka9904", "raumraktzatanhaag", ".maladroite", "diskordal", "ilytbrbluu", "acyl_vrion1", "cal_cass", "sachi314159", "rafaelbruno021", "MEE6"]);

function buildPhotographer(shotsData) {
  const byUser = new Map();
  for (const shot of shotsData.screenshots || []) {
    // A deleted Discord account cannot hold a board spot, and
    // neither can a former member who has left the guild.
    if (!shot.username || shot.author === "Deleted User" || INELIGIBLE_PHOTOGRAPHERS.has(shot.username)) continue;
    if (!byUser.has(shot.username)) {
      byUser.set(shot.username, { author: PHOTOGRAPHER_SHOW_USERNAME.has(shot.username) ? shot.username : (shot.author || shot.username), count: 0, first: null, latest: null });
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
// person, counted together under the plainer name. The Leader field
// also cuts long names off at 17 characters; Azazel and Ayara are
// shown by their short names, as the guild leader prefers.
const HOST_NAME_ALIASES = new Map([
  ["Reinds/sojo/sojo1", "Reinds"],
  ["Elanor/Rydark", "Elanor"],
  ["Azazel@eatsomewaf", "Azazel"],
  ["Azazel@eatsomewaffles", "Azazel"],
  ["MrZenigata / Ayar", "Ayara"],
  ["MrZenigata / Ayara", "Ayara"],
]);

// Organizers who cannot hold an event host board spot: former members
// who have left the guild, per the guild leader's audit of the records.
const INELIGIBLE_HOSTS = new Set(["Vega", "Vega ~ Soul", "Elenara", "Andealous", "Micioarancio"]);

// Standing rule (guild leader, 2026-11-21): a run only counts —
// hosted or attended, for anyone — when it drew at least this many
// sign-ups in total. Runs posted with fewer sometimes never actually
// happen, so the boards only credit runs that filled.
const MIN_RUN_SIGNUPS = 5;

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
    if ((event.participants || []).length < MIN_RUN_SIGNUPS) continue;
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

// Sign-up names in Raid-Helper posts are Discord display names that
// the bot cuts off at different lengths in different posts, so one
// member appears under several truncated spellings. These variants
// are one person, counted together under the fullest spelling —
// except Azazel and Ayara, who show by their short names.
const PARTICIPANT_NAME_ALIASES = new Map([
  ["Reinds/sojo/sojo12", "Reinds"],
  ["Reinds/sojo12", "Reinds"],
  ["Reinds/sojo/so", "Reinds"],
  ["Sojo", "Reinds"],
  ["Elanor/Rydark", "Elanor"],
  ["Elanor/Rydar", "Elanor"],
  ["MrZenigata/A", "Ayara"],
  ["MrZenigata/Ayara", "Ayara"],
  ["Vega~Soul", "Vega"],
  ["Sakuya@aksa0", "Sakuya@aksa07"],
  ["Amaya/Andromed", "Amaya"],
  ["Azazel@eatsomewa", "Azazel"],
  ["Azazel@eatsomewaffles", "Azazel"],
  ["Azazel@eatso", "Azazel"],
  ["HenryTheHors", "HenryTheHorse"],
  ["Mio-Avatonk(Michael-DK/EU)", "Mio-Avatonk"],
  ["TimtheEnchan", "TimtheEnchanter"],
  ["JadeProvidanc", "JadeProvidance"],
  ["JadeProvidance/J", "JadeProvidance"],
  ["JadeProvidance/Ja", "JadeProvidance"],
  ["BalidorElRen", "BalidorElRenon"],
  ["BalidorElReno", "BalidorElRenon"],
  ["BalidorElRenon🇮🇱", "BalidorElRenon"],
  ["BalidorElRenon🇮🇱🇺🇦", "BalidorElRenon"],
  ["IncantationSt", "IncantationStation"],
  ["CALCASS(CK", "CALCASS(CKU)"],
  ["Yukki", "Yukki/Steve"],
  ["DrewSilverkin/Radi", "DrewSilverkin/RadiantRandy"],
  ["GORO/Hamme", "GORO/HammerofJ"],
  ["GirthQuake/J", "GirthQuake/Jaskie"],
  ["piggo/clanker", "clanker/piggo"],
  ["leggylass/shan", "leggylass/shaniatw"],
  ["Psyche.", "Psyche"],
  ["Aurfelthe\"Wel", "Aurfelthe\"Welostdemo\""],
  ["Aurfelthe\"We", "Aurfelthe\"Welostdemo\""],
  ["DarkWenDigo", "DarkWenDigo666"],
  ["OynxBlaze", "OnyxBlaze"],
]);

// Members who cannot hold a participation board spot: former members
// who have left the guild, per the guild leader's audit of the
// records. (Ayara is deliberately not here: he stays eligible.)
const INELIGIBLE_PARTICIPANTS = new Set(["Vega", "Sakuya@aksa07", "HenryTheHorse"]);

function buildParticipants(raidData) {
  const byMember = new Map();
  for (const event of raidData.events || []) {
    const names = new Set();
    for (const raw of event.participants || []) {
      const trimmed = String(raw || "").trim();
      if (!trimmed) continue;
      names.add(PARTICIPANT_NAME_ALIASES.get(trimmed) || trimmed);
    }
    const when = parseDateOnly(event.eventDate) || parseDate(event.postedAt);
    for (const name of names) {
      if (INELIGIBLE_PARTICIPANTS.has(name)) continue;
      if ((event.participants || []).length < MIN_RUN_SIGNUPS) continue;
      if (!byMember.has(name)) byMember.set(name, { name, count: 0, first: null, latest: null });
      const entry = byMember.get(name);
      entry.count += 1;
      if (when && (!entry.first || when < entry.first)) entry.first = when;
      if (when && (!entry.latest || when > entry.latest)) entry.latest = when;
    }
  }
  const rows = [];
  for (const entry of byMember.values()) {
    rows.push({
      name: entry.name,
      sub: entry.latest ? `Latest run ${formatDate(entry.latest)}` : "Raid-Helper sign-up posts",
      value: `${entry.count} run${entry.count === 1 ? "" : "s"} attended`,
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
    renderBoard("board-participants", buildParticipants(raid));
  } catch (error) {
    renderUnavailable(["board-event-host", "board-participants"]);
  }
}

init();
