(() => {
  "use strict";

  // Guild ticker: loaded by every page, it fills the strip under the
  // main menu. Highlights are computed from the roster snapshot, the
  // screenshots feed, the Raid-Helper posts file, and the events
  // files. Items with nothing to show are skipped, except the next
  // join anniversary, which always shows the nearest upcoming one.
  // If the snapshot cannot be loaded, the ticker stays hidden.
  const tickerRoot = document.getElementById("guild-ticker");
  const tickerTrack = document.getElementById("ticker-track");
  if (tickerRoot && tickerTrack) {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const tickerDate = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? null : date;
    };
    const fetchJson = (url) =>
      fetch(url, { cache: "no-cache", headers: { Accept: "application/json" } }).then((response) => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json();
      });
    const topEntry = (map) => {
      let bestAccount = null;
      let bestValue = 0;
      map.forEach((value, account) => {
        if (value > bestValue) {
          bestAccount = account;
          bestValue = value;
        }
      });
      return bestAccount === null ? null : [bestAccount, bestValue];
    };
    const buildTickerItems = (snapshot, screenshots, manualEvents, discordEvents, raidEvents) => {
      const items = [];
      const generatedAt = tickerDate(snapshot.generatedAt) || new Date();
      const weekStart = generatedAt.valueOf() - WEEK_MS;
      const inWeek = (value) => {
        const date = tickerDate(value);
        return date !== null && date.valueOf() >= weekStart;
      };
      const formatCount = (value) => value.toLocaleString("en-US");
      // Display name per account, the Achievements rule: the
      // highest-ranked character, then the earliest to join.
      const displayNames = new Map();
      (snapshot.roster || []).forEach((member) => {
        const current = displayNames.get(member.account);
        const rank = member.rankOrder || 0;
        const joined = member.joinDate || "9999";
        if (!current || rank > current.rank || (rank === current.rank && joined < current.joined)) {
          displayNames.set(member.account, { rank, joined, name: member.name });
        }
      });
      const displayName = (account) => {
        const entry = displayNames.get(account);
        return entry ? entry.name : account;
      };
      // Per-character join dates, and each account's main
      // character: its oldest character, by join date.
      const characterJoins = new Map();
      const mainCharacters = new Map();
      (snapshot.roster || []).forEach((member) => {
        const accountKey = String(member.account || "").trim().toLowerCase();
        const joined = tickerDate(member.joinDate);
        characterJoins.set(`${String(member.name || "").trim().toLowerCase()}|${accountKey}`, joined);
        if (!joined) return;
        const current = mainCharacters.get(accountKey);
        if (!current || joined < current.joined || (joined.valueOf() === current.joined.valueOf() && String(member.name).localeCompare(current.name) < 0)) {
          mainCharacters.set(accountKey, { joined, name: member.name });
        }
      });
      // Two patterns keep a deposit out of the deposit-count
      // items, because neither leaves the bank better off.
      // Put-backs: taking an item out and putting it back —
      // moving it between bank tabs, or withdrawing it and
      // re-depositing it moments later — logs a withdrawal and
      // then a deposit of the same item and amount by the same
      // account; the deposit side of such a pair is not a new
      // contribution. Pairs are matched one-to-one in time
      // order within a minute; a deposit that comes BEFORE a
      // withdrawal is a real deposit and always counts.
      // Take-backs: a deposit whose item the same account
      // withdraws again later — whenever that happens — did not
      // stay given, so it stops counting; each withdrawal
      // cancels the most recent deposit before it, and a
      // withdrawal already spent on a put-back pair is not
      // spent twice. (Gold totals are computed separately
      // below, net of withdrawals.)
      const bankMoveDeposits = (events) => {
        const keyOf = (event) => [String(event.account || "").trim().toLowerCase(), event.item, event.amount].join("|");
        const withdrawals = new Map();
        events.forEach((event) => {
          if (event.action !== "withdraw") return;
          const when = tickerDate(event.date);
          if (!when) return;
          const key = keyOf(event);
          if (!withdrawals.has(key)) withdrawals.set(key, []);
          withdrawals.get(key).push([when.getTime(), event]);
        });
        withdrawals.forEach((list) => list.sort((a, b) => a[0] - b[0]));
        const timedDeposits = events
          .filter((event) => event.action === "deposit")
          .map((event) => [event, tickerDate(event.date)])
          .filter((pair) => pair[1])
          .sort((a, b) => a[1] - b[1]);
        const moves = new Set();
        const spentWithdrawals = new Set();
        const pointers = new Map();
        timedDeposits.forEach(([event, when]) => {
          const key = keyOf(event);
          const list = withdrawals.get(key);
          if (!list) return;
          const t = when.getTime();
          let i = pointers.get(key) || 0;
          while (i < list.length && list[i][0] < t - 60000) i += 1;
          if (i < list.length && list[i][0] <= t) {
            moves.add(event);
            spentWithdrawals.add(list[i][1]);
            i += 1;
          }
          pointers.set(key, i);
        });
        const countedByKey = new Map();
        timedDeposits.forEach(([event, when]) => {
          if (moves.has(event)) return;
          const key = keyOf(event);
          if (!countedByKey.has(key)) countedByKey.set(key, []);
          countedByKey.get(key).push([event, when.getTime()]);
        });
        withdrawals.forEach((list, key) => {
          const counted = countedByKey.get(key);
          if (!counted) return;
          list.forEach(([t, withdrawal]) => {
            if (spentWithdrawals.has(withdrawal)) return;
            for (let i = counted.length - 1; i >= 0; i -= 1) {
              if (counted[i][1] < t) {
                moves.add(counted[i][0]);
                counted.splice(i, 1);
                break;
              }
            }
          });
        });
        return moves;
      };
      const bank = snapshot.bankEvents || [];
      // The guild leader's deposits stock the bank with donated
      // funds, so his account is left out of the bank rankings
      // here, just as on the Achievements boards.
      const deposits = bank.filter(
        (event) => event.action === "deposit" && String(event.account || "").trim().toLowerCase() !== "@zorlonix"
      );
      const moveDeposits = bankMoveDeposits(bank);
      const countedDeposits = deposits.filter((event) => !moveDeposits.has(event));
      const totalsByAccount = (events, measure) => {
        const totals = new Map();
        events.forEach((event) => {
          totals.set(event.account, (totals.get(event.account) || 0) + measure(event));
        });
        return totals;
      };
      // Gold is reported net, here as on the High Roller board:
      // a withdrawal of gold cancels gold the same account
      // deposited earlier, so what an account took back out is
      // not counted as given. Withdrawing gold the account never
      // deposited changes nothing. Balances are tracked in
      // copper, at the week boundary and at the snapshot date,
      // so the weekly figure is the week's change in net gold.
      const goldNet = new Map();
      bank
        .filter((event) => event.item === "Copper" && String(event.account || "").trim().toLowerCase() !== "@zorlonix")
        .map((event) => [event, tickerDate(event.date)])
        .filter((pair) => pair[1])
        .sort((a, b) => a[1] - b[1])
        .forEach(([event, when]) => {
          if (!goldNet.has(event.account)) goldNet.set(event.account, { before: 0, now: 0 });
          const entry = goldNet.get(event.account);
          const amount = event.amount || 0;
          const apply = (balance) => (event.action === "deposit" ? balance + amount : Math.max(0, balance - amount));
          if (when.getTime() < weekStart) entry.before = apply(entry.before);
          entry.now = apply(entry.now);
        });
      // Ties go to the account whose gold deposit appears first
      // in the bank log, as the plain totals did before netting.
      const goldTotalsInLogOrder = (valueOf, weekOnly) => {
        const totals = new Map();
        bank.forEach((event) => {
          if (event.item !== "Copper" || event.action !== "deposit") return;
          if (String(event.account || "").trim().toLowerCase() === "@zorlonix") return;
          if (weekOnly && !inWeek(event.date)) return;
          const entry = goldNet.get(event.account);
          if (entry && !totals.has(event.account)) totals.set(event.account, valueOf(entry));
        });
        goldNet.forEach((entry, account) => {
          if (!totals.has(account)) totals.set(account, valueOf(entry));
        });
        return totals;
      };
      const goldWeek = topEntry(goldTotalsInLogOrder((entry) => (entry.now - entry.before) / 10000, true));
      if (goldWeek && goldWeek[1] > 0) {
        items.push(`Most gold deposited this week: ${displayName(goldWeek[0])} — ${formatCount(goldWeek[1])} gold`);
      }
      const depositsWeek = topEntry(totalsByAccount(countedDeposits.filter((event) => inWeek(event.date)), () => 1));
      if (depositsWeek) {
        items.push(`Most bank deposits this week: ${displayName(depositsWeek[0])} — ${formatCount(depositsWeek[1])} deposits`);
      }
      const joinDates = snapshot.accountJoinDates || {};
      let newest = null;
      Object.entries(joinDates).forEach(([account, date]) => {
        if (displayNames.has(account) && (!newest || date > newest[1])) newest = [account, date];
      });
      if (newest) items.push(`Welcome our newest member: ${displayName(newest[0])}`);
      const guildEvents = snapshot.events || [];
      // New members means new accounts: every alt that joins on
      // an existing account fires its own join event, so the join
      // events are not what is counted — an account counts when
      // its own join date (its first character's arrival) falls
      // this week.
      const joinsWeek = Object.entries(joinDates).filter(([account, date]) => displayNames.has(account) && inWeek(date)).length;
      if (joinsWeek) items.push(`${joinsWeek} new member${joinsWeek === 1 ? "" : "s"} joined this week`);
      // A rank change in the first two weeks after a character
      // joins is the guild leader matching a new alt to its
      // account's rank, not a promotion the character earned, so
      // it never counts here. (Earned promotions begin at about a
      // month in, when the first rank comes due.)
      const MATCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
      const rankEventParts = (event) => /^(.+?)@(.+?)'s guild rank is now (.+)$/.exec(event.text || "");
      const isJoinMatch = (event) => {
        const parts = rankEventParts(event);
        if (!parts) return false;
        const joined = characterJoins.get(`${parts[1].trim().toLowerCase()}|@${parts[2].trim().toLowerCase()}`);
        const when = tickerDate(event.date);
        if (!joined || !when) return false;
        const gap = when.valueOf() - joined.valueOf();
        return gap >= 0 && gap <= MATCH_WINDOW_MS;
      };
      const promosWeek = guildEvents
        .filter((event) => event.kind === "rank" && inWeek(event.date) && !isJoinMatch(event))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (promosWeek.length) {
        let text = `${promosWeek.length} promotion${promosWeek.length === 1 ? "" : "s"} this week`;
        const parts = rankEventParts(promosWeek[0]);
        if (parts) {
          // The item names the account's main character — its
          // oldest character — not whichever character the log
          // entry happens to name.
          const main = mainCharacters.get(`@${parts[2].trim().toLowerCase()}`);
          text += ` — most recently, ${main ? main.name : parts[1]} reached ${parts[3]}`;
        }
        items.push(text);
      }
      // Counted like the Guild Photographer board: by Discord
      // username, shown under the author's display name, with a
      // deleted account unable to hold a spot and former members
      // who have left the guild ineligible.
      const ineligiblePhotographers = new Set(["palikka9904", "raumraktzatanhaag", ".maladroite", "diskordal", "ilytbrbluu", "acyl_vrion1", "cal_cass", "sachi314159", "rafaelbruno021", "MEE6"]);
      // Shown by username, not display name: Sora's display name is
      // just "k", and the guild leader asked for k5oul instead.
      const photographerShowUsername = new Set(["k5oul"]);
      const shotCounts = new Map();
      const shotCountsWeek = new Map();
      const shotAuthors = new Map();
      ((screenshots && screenshots.screenshots) || []).forEach((shot) => {
        if (!shot.username || shot.author === "Deleted User" || ineligiblePhotographers.has(shot.username)) return;
        if (!shotAuthors.has(shot.username)) shotAuthors.set(shot.username, photographerShowUsername.has(shot.username) ? shot.username : (shot.author || shot.username));
        shotCounts.set(shot.username, (shotCounts.get(shot.username) || 0) + 1);
        if (inWeek(shot.postedAt)) {
          shotCountsWeek.set(shot.username, (shotCountsWeek.get(shot.username) || 0) + 1);
        }
      });
      const photographer = topEntry(shotCounts);
      if (photographer) {
        items.push(`Top photographer: ${shotAuthors.get(photographer[0])} — ${formatCount(photographer[1])} screenshots`);
      }
      const photographerWeek = topEntry(shotCountsWeek);
      if (photographerWeek) {
        items.push(`Most screenshots this week: ${shotAuthors.get(photographerWeek[0])} — ${formatCount(photographerWeek[1])} screenshot${photographerWeek[1] === 1 ? "" : "s"}`);
      }
      const benefactor = topEntry(totalsByAccount(countedDeposits, () => 1));
      if (benefactor) {
        items.push(`Guild Benefactor: ${displayName(benefactor[0])} — ${formatCount(benefactor[1])} deposits on record`);
      }
      const highRoller = topEntry(goldTotalsInLogOrder((entry) => entry.now / 10000, false));
      if (highRoller && highRoller[1] > 0) {
        items.push(`High Roller: ${displayName(highRoller[0])} — ${formatCount(highRoller[1])} gold deposited`);
      }
      // Counted like the Event Host board: one hosted run per
      // Raid-Helper sign-up post, credited to the organizer the post
      // names, with the guild leader's audited name merges and
      // exclusions applied.
      const hostAliases = new Map([
        ["Reinds/sojo/sojo1", "Reinds"],
        ["Elanor/Rydark", "Elanor"],
        ["Azazel@eatsomewaf", "Azazel"],
        ["Azazel@eatsomewaffles", "Azazel"],
        ["MrZenigata / Ayar", "Ayara"],
        ["MrZenigata / Ayara", "Ayara"]
      ]);
      const ineligibleHosts = new Set(["Vega", "Vega ~ Soul", "Elenara", "Andealous", "Micioarancio"]);
      const hostCounts = new Map();
      (raidEvents || []).forEach((event) => {
        const raw = String(event.organizer || "").trim();
        if (!raw || ineligibleHosts.has(raw)) return;
        const name = hostAliases.get(raw) || raw;
        // Like the Event Host board: a run counts only when it drew
        // at least 5 sign-ups in total (standing rule, 2026-11-21).
        if ((event.participants || []).length < 5) return;
        hostCounts.set(name, (hostCounts.get(name) || 0) + 1);
      });
      const eventHost = topEntry(hostCounts);
      if (eventHost) {
        items.push(`Top event host: ${eventHost[0]} — ${formatCount(eventHost[1])} run${eventHost[1] === 1 ? "" : "s"} hosted`);
      }
      // Counted like the Top Participants board: one attended run
      // per Raid-Helper sign-up post (Support sign-ups included),
      // with the guild leader's audited name merges — sign-up names
      // are truncated at different lengths in different posts — and
      // exclusions applied.
      const participantAliases = new Map([
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
        ["OynxBlaze", "OnyxBlaze"]
      ]);
      const ineligibleParticipants = new Set(["Vega", "Sakuya@aksa07", "HenryTheHorse"]);
      const participantCounts = new Map();
      (raidEvents || []).forEach((event) => {
        const names = new Set();
        (event.participants || []).forEach((rawName) => {
          const trimmed = String(rawName || "").trim();
          if (trimmed) names.add(participantAliases.get(trimmed) || trimmed);
        });
        names.forEach((name) => {
          if (ineligibleParticipants.has(name)) return;
          // Like the Top Participants board: 5+ total sign-ups or
          // the run does not count (standing rule, 2026-11-21).
          if ((event.participants || []).length < 5) return;
          participantCounts.set(name, (participantCounts.get(name) || 0) + 1);
        });
      });
      const topParticipant = topEntry(participantCounts);
      if (topParticipant) {
        items.push(`Top participant: ${topParticipant[0]} — ${formatCount(topParticipant[1])} run${topParticipant[1] === 1 ? "" : "s"} attended`);
      }
      const todayKey = new Date().toLocaleDateString("en-CA");
      // "Next up" is the soonest event that has not started yet. A
      // manual event starts at 10:30 AM Eastern on its start date —
      // the calendar's rule — except an event carrying an endTime
      // (the Mysterious Merchant), which starts at that time of day,
      // its seven days running from when the structure was built.
      // easternInstant mirrors the calendar's helper in news.js.
      const easternInstant = (dateValue, hour, minute) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || "")) return null;
        const [year, month, day] = dateValue.split("-").map(Number);
        const target = Date.UTC(year, month - 1, day, hour, minute);
        let guess = target;
        for (let pass = 0; pass < 2; pass += 1) {
          const parts = new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
            timeZone: "America/New_York"
          }).formatToParts(new Date(guess));
          const part = (type) => Number(parts.find((item) => item.type === type)?.value);
          guess += target - Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
        }
        return new Date(guess);
      };
      const upcoming = [];
      (manualEvents || []).forEach((event) => {
        if (!event.startDate) return;
        const override = /^(\d{1,2}):(\d{2})$/.exec(event.endTime || "");
        const valid = override && Number(override[1]) <= 23 && Number(override[2]) <= 59;
        const start = valid
          ? easternInstant(event.startDate, Number(override[1]), Number(override[2]))
          : easternInstant(event.startDate, 10, 30);
        if (start && start.getTime() > Date.now()) upcoming.push([start, event.name]);
      });
      (discordEvents || []).forEach((event) => {
        const start = tickerDate(event.startTime);
        if (start && start.getTime() > Date.now()) upcoming.push([start, event.name]);
      });
      upcoming.sort((a, b) => a[0] - b[0]);
      if (upcoming.length) {
        const [start, name] = upcoming[0];
        const label = start.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "America/New_York"
        });
        items.push(`Next up: ${name} — ${label}`);
      }
      // Ending soon: events already running whose end is the
      // nearest one, today through the next two days. An event
      // counts until the moment it actually ends — the calendar's
      // rule: 10:30 AM Eastern on its end date, or its endTime
      // when it carries one — not until midnight.
      const soon = new Date();
      soon.setDate(soon.getDate() + 2);
      const soonKey = soon.toLocaleDateString("en-CA");
      const endGroups = new Map();
      const addEnding = (key, name) => {
        if (!endGroups.has(key)) endGroups.set(key, []);
        endGroups.get(key).push(name);
      };
      (manualEvents || []).forEach((event) => {
        // The Mod 34 launch is a release date, not an event with an
        // end: its entry carries no end date, so it would otherwise
        // read as ending on its launch day. It never appears here.
        if (event.name === "Mod 34: Sleeping Gods Lie") return;
        const endDate = event.endDate || event.startDate;
        if (!event.startDate || !endDate) return;
        if (event.startDate > todayKey || endDate < todayKey || endDate > soonKey) return;
        const override = /^(\d{1,2}):(\d{2})$/.exec(event.endTime || "");
        const valid = override && Number(override[1]) <= 23 && Number(override[2]) <= 59;
        const hour = valid ? Number(override[1]) : 10;
        const minute = valid ? Number(override[2]) : 30;
        const start = easternInstant(event.startDate, hour, minute);
        const end = easternInstant(endDate, hour, minute);
        if (start && end && start.getTime() <= Date.now() && end.getTime() >= Date.now() - 60000) {
          addEnding(endDate, event.name);
        }
      });
      (discordEvents || []).forEach((event) => {
        const start = tickerDate(event.startTime);
        const end = tickerDate(event.endTime || event.startTime);
        if (start && end && start.valueOf() <= Date.now() && end.valueOf() >= Date.now() - 60000 && end.valueOf() <= Date.now() + 2 * 24 * 60 * 60 * 1000) {
          addEnding(end.toLocaleDateString("en-CA"), event.name);
        }
      });
      if (endGroups.size) {
        const key = [...endGroups.keys()].sort()[0];
        const names = endGroups.get(key).join(" · ");
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        let when = new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
        if (key === todayKey) when = "today";
        else if (key === tomorrow.toLocaleDateString("en-CA")) when = "tomorrow";
        items.push(`Ending ${when}: ${names}`);
      }
      let anniversary = null;
      const today = new Date(generatedAt.getFullYear(), generatedAt.getMonth(), generatedAt.getDate());
      Object.entries(joinDates).forEach(([account, dateValue]) => {
        if (!displayNames.has(account)) return;
        const joined = tickerDate(dateValue);
        if (!joined) return;
        [today.getFullYear(), today.getFullYear() + 1].forEach((year) => {
          const date = new Date(year, joined.getMonth(), joined.getDate());
          const years = year - joined.getFullYear();
          if (date >= today && years >= 1 && (!anniversary || date < anniversary.date)) {
            anniversary = { date, name: displayName(account), years };
          }
        });
      });
      if (anniversary) {
        const years = `${anniversary.years} year${anniversary.years === 1 ? "" : "s"}`;
        if (anniversary.date.valueOf() === today.valueOf()) {
          items.push(`Guild anniversary today: ${anniversary.name} — ${years} in Synergy`);
        } else {
          const when = anniversary.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          items.push(`Guild anniversary coming up: ${anniversary.name} — ${years} on ${when}`);
        }
      }
      return items;
    };
    const renderTicker = (items) => {
      if (!items.length) return;
      const makeSet = (hidden) => {
        const set = document.createElement("div");
        set.className = "ticker-set";
        if (hidden) set.setAttribute("aria-hidden", "true");
        items.forEach((text) => {
          const item = document.createElement("span");
          item.className = "ticker-item";
          item.textContent = text;
          set.append(item);
        });
        return set;
      };
      tickerTrack.append(makeSet(false), makeSet(true));
      tickerRoot.hidden = false;
      // The animation is phased to the wall clock: a negative delay
      // starts it partway through its cycle, so on every page the
      // ticker picks up mid-scroll instead of restarting — one
      // continuous ticker across page switches.
      const syncTickerPhase = () => {
        const setWidth = tickerTrack.children[0].scrollWidth;
        if (setWidth <= 0) return;
        const duration = Math.max(20, setWidth / 58);
        tickerTrack.style.animationDuration = `${duration}s`;
        tickerTrack.style.animationDelay = `${-((Date.now() / 1000) % duration)}s`;
      };
      syncTickerPhase();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(syncTickerPhase);
      }
    };
    Promise.all([
      fetchJson("data/snapshot.json"),
      fetchJson("data/screenshots.json").catch(() => null),
      fetchJson("data/manual-events.json").catch(() => null),
      fetchJson("data/discord-events.json").catch(() => null),
      fetchJson("data/raid-helper-events.json").catch(() => null)
    ])
      .then(([snapshot, screenshots, manual, discord, raid]) => {
        renderTicker(buildTickerItems(snapshot, screenshots, (manual && manual.events) || [], (discord && discord.events) || [], (raid && raid.events) || []));
      })
      .catch(() => {
        // The ticker stays hidden if the snapshot cannot be loaded.
      });
  }
})();
