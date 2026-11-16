(() => {
  "use strict";

  // Guild ticker: loaded by every page, it fills the strip under the
  // main menu. Highlights are computed from the roster snapshot, the
  // screenshots feed, and the events files. Items with nothing to show
  // are skipped, except the next join anniversary, which always shows
  // the nearest upcoming one. If the snapshot cannot be loaded, the
  // ticker stays hidden.
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
    const buildTickerItems = (snapshot, screenshots, manualEvents, discordEvents) => {
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
      const bank = snapshot.bankEvents || [];
      const deposits = bank.filter((event) => event.action === "deposit");
      const goldDeposited = (event) => (event.item === "Copper" ? (event.amount || 0) / 10000 : 0);
      const totalsByAccount = (events, measure) => {
        const totals = new Map();
        events.forEach((event) => {
          totals.set(event.account, (totals.get(event.account) || 0) + measure(event));
        });
        return totals;
      };
      const goldWeek = topEntry(totalsByAccount(deposits.filter((event) => inWeek(event.date)), goldDeposited));
      if (goldWeek && goldWeek[1] > 0) {
        items.push(`Most gold deposited this week: ${displayName(goldWeek[0])} — ${formatCount(goldWeek[1])} gold`);
      }
      const depositsWeek = topEntry(totalsByAccount(deposits.filter((event) => inWeek(event.date)), () => 1));
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
      const joinsWeek = guildEvents.filter((event) => event.kind === "join" && inWeek(event.date)).length;
      if (joinsWeek) items.push(`${joinsWeek} new member${joinsWeek === 1 ? "" : "s"} joined this week`);
      const promosWeek = guildEvents
        .filter((event) => event.kind === "rank" && inWeek(event.date))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (promosWeek.length) {
        let text = `${promosWeek.length} promotion${promosWeek.length === 1 ? "" : "s"} this week`;
        const match = /^(.+?)@.+?'s guild rank is now (.+)$/.exec(promosWeek[0].text || "");
        if (match) text += ` — most recently, ${match[1]} reached ${match[2]}`;
        items.push(text);
      }
      // Counted like the Guild Photographer board: by Discord
      // username, shown under the author's display name, with a
      // deleted account unable to hold a spot and Palikka
      // (Sakuya), who has left the guild, ineligible.
      const shotCounts = new Map();
      const shotCountsWeek = new Map();
      const shotAuthors = new Map();
      ((screenshots && screenshots.screenshots) || []).forEach((shot) => {
        if (!shot.username || shot.author === "Deleted User" || shot.username === "palikka9904") return;
        if (!shotAuthors.has(shot.username)) shotAuthors.set(shot.username, shot.author || shot.username);
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
      const benefactor = topEntry(totalsByAccount(deposits, () => 1));
      if (benefactor) {
        items.push(`Guild Benefactor: ${displayName(benefactor[0])} — ${formatCount(benefactor[1])} deposits on record`);
      }
      const highRoller = topEntry(totalsByAccount(deposits, goldDeposited));
      if (highRoller && highRoller[1] > 0) {
        items.push(`High Roller: ${displayName(highRoller[0])} — ${formatCount(highRoller[1])} gold deposited`);
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
      // Ending soon: events already running whose end date is the
      // nearest one, today through the next two days.
      const soon = new Date();
      soon.setDate(soon.getDate() + 2);
      const soonKey = soon.toLocaleDateString("en-CA");
      const endGroups = new Map();
      const addEnding = (key, name) => {
        if (!endGroups.has(key)) endGroups.set(key, []);
        endGroups.get(key).push(name);
      };
      (manualEvents || []).forEach((event) => {
        const endDate = event.endDate || event.startDate;
        if (event.startDate && event.startDate <= todayKey && endDate && endDate >= todayKey && endDate <= soonKey) {
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
      fetchJson("data/discord-events.json").catch(() => null)
    ])
      .then(([snapshot, screenshots, manual, discord]) => {
        renderTicker(buildTickerItems(snapshot, screenshots, (manual && manual.events) || [], (discord && discord.events) || []));
      })
      .catch(() => {
        // The ticker stays hidden if the snapshot cannot be loaded.
      });
  }
})();
