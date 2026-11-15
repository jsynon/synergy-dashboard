(() => {
  "use strict";

  const PAGE_SIZE = 20;

  const eventList = document.getElementById("news-event-list");
  const eventStatus = document.getElementById("news-event-status");

  const dateParts = (value) => {
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
    if (Number.isNaN(date.valueOf())) return null;

    // Date-only entries are fixed calendar dates, read in UTC. Timed entries
    // (Discord events) are instants: read them in the viewer's own timezone
    // (no timeZone passed) so the date label agrees with the local time
    // shown beside it.
    const timeZone = dateOnly ? "UTC" : undefined;
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return { year: part("year"), month: part("month"), day: Number(part("day")) };
  };

  const dateKey = (value) => {
    const parts = dateParts(value);
    return parts ? `${parts.year}-${String(new Date(`${parts.month} 1, ${parts.year}`).getMonth() + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : null;
  };

  const formatEventDate = (value) => {
    const parts = dateParts(value);
    return parts ? `${parts.month} ${parts.day}, ${parts.year}` : null;
  };

  const formatEventDateRange = (event) => {
    const startValue = event.startDate || event.startTime;
    const endValue = event.endDate || event.endTime;
    const start = dateParts(startValue);
    const end = endValue ? dateParts(endValue) : null;
    if (!start) return "Date unavailable";
    if (!end || dateKey(startValue) === dateKey(endValue)) return formatEventDate(startValue);
    if (start.year === end.year && start.month === end.month) {
      return `${start.month} ${start.day}–${end.day}, ${start.year}`;
    }
    if (start.year === end.year) {
      return `${start.month} ${start.day} – ${end.month} ${end.day}, ${start.year}`;
    }
    return `${formatEventDate(startValue)} – ${formatEventDate(endValue)}`;
  };

  // In-game events all end at 10:30 AM Eastern on their end date (the
  // game's daily event boundary). Resolve an Eastern wall-clock time on a
  // given date to a real instant by correcting a UTC guess against
  // Eastern's actual offset (two passes settle DST changes).
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

  const safeHttpsUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  };

  const renderGuildEvents = (events) => {
    eventList.replaceChildren();
    const todayParts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/New_York"
    }).formatToParts(new Date());
    const today = `${todayParts.find((part) => part.type === "year").value}-${todayParts.find((part) => part.type === "month").value}-${todayParts.find((part) => part.type === "day").value}`;
    const now = new Date();
    const upcomingEvents = events
      .filter((event) => {
        // Discord events are instants: they leave the list when they actually
        // end, not at the end of a calendar day.
        if (event.source === "discord") {
          const end = new Date(event.endTime || event.startTime);
          if (!Number.isNaN(end.valueOf())) return end >= now;
        }
        // In-game events end at 10:30 AM Eastern on their end date, so a
        // manual event leaves the list at that instant on its last day. An
        // event carrying its own endTime ("HH:MM", Eastern) ends then
        // instead — the stronghold's Mysterious Merchant, whose seven days
        // run from when its structure was built.
        if (event.source === "manual" && event.endDate) {
          const override = /^(\d{1,2}):(\d{2})$/.exec(event.endTime || "");
          const valid = override && Number(override[1]) <= 23 && Number(override[2]) <= 59;
          const endsAt = valid
            ? easternInstant(event.endDate, Number(override[1]), Number(override[2]))
            : easternInstant(event.endDate, 10, 30);
          if (endsAt) return endsAt > now;
        }
        const lastDate = event.endDate || event.endTime || event.startDate || event.startTime;
        const key = dateKey(lastDate);
        return key && key >= today;
      })
      .sort((a, b) => dateKey(a.startDate || a.startTime).localeCompare(dateKey(b.startDate || b.startTime)));

    if (!upcomingEvents.length) {
      addText(eventList, "li", "news-event-empty", "No upcoming events are scheduled.");
      eventStatus.textContent = "No upcoming events";
      return;
    }

    for (const event of upcomingEvents) {
      const row = document.createElement("li");
      row.className = "news-event-row";
      const dateLabel = formatEventDateRange(event);
      const startTime = event.source === "discord" && event.startTime ? new Date(event.startTime) : null;
      if (startTime && !Number.isNaN(startTime.valueOf())) {
        const localTime = new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short"
        }).format(startTime);
        addText(row, "span", "news-event-date", `${dateLabel} · ${localTime}`);
      } else {
        addText(row, "span", "news-event-date", dateLabel);
      }

      const details = document.createElement("div");
      details.className = "news-event-copy";
      const discordEvent = event.source === "discord";
      if (discordEvent) {
        const title = document.createElement("a");
        title.className = "news-event-name";
        title.href = `https://discord.com/events/${encodeURIComponent(event.guildId)}/${encodeURIComponent(event.id)}`;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        const eventName = document.createElement("span");
        eventName.textContent = event.name;
        const destination = document.createElement("span");
        destination.className = "news-event-name-destination";
        destination.textContent = "Discord event ↗";
        title.append(eventName, destination);
        details.append(title);
      } else {
        addText(details, "span", "news-event-name", event.name);
      }

      const links = document.createElement("div");
      links.className = "news-event-links";
      if (event.recurring) addText(links, "span", "news-event-repeat", "Recurring");
      const eventUrl = safeHttpsUrl(event.url || event.location);
      if (eventUrl) {
        const linkLabel = /raid[-.]?helper/i.test(eventUrl) ? "Raid-Helper signup ↗" : "Location / details ↗";
        const eventLink = addText(links, "a", "news-event-link", linkLabel);
        eventLink.href = eventUrl;
        eventLink.target = "_blank";
        eventLink.rel = "noopener noreferrer";
      } else if (event.location) {
        addText(links, "span", "news-event-location", event.location);
      }
      if (links.childElementCount) details.append(links);
      row.append(details);
      eventList.append(row);
    }
    eventStatus.textContent = `${upcomingEvents.length} upcoming ${upcomingEvents.length === 1 ? "event" : "events"}`;
  };

  const loadGuildEvents = () => {
    Promise.all([
      fetch("data/discord-events.json", { cache: "no-cache", headers: { Accept: "application/json" } }),
      fetch("data/manual-events.json", { cache: "no-cache", headers: { Accept: "application/json" } })
    ])
      .then(async ([discordResponse, manualResponse]) => {
        if (!discordResponse.ok || !manualResponse.ok) throw new Error("Calendar data request failed");
        return Promise.all([discordResponse.json(), manualResponse.json()]);
      })
      .then(([discordFeed, manualFeed]) => {
        if (!Array.isArray(discordFeed.events) || !Array.isArray(manualFeed.events)) {
          throw new Error("Calendar data is invalid");
        }
        const merged = [
          ...manualFeed.events.map((event) => ({ ...event, source: "manual" })),
          ...discordFeed.events.map((event) => ({ ...event, source: "discord" }))
        ];
        renderGuildEvents(merged);
        window.guildEventsFetchedAt = discordFeed.generatedAt || null;
      })
      .catch((error) => {
        console.error("Unable to load Synergy events:", error);
        eventList.replaceChildren();
        addText(eventList, "li", "news-event-empty", "Guild events are temporarily unavailable.");
        eventStatus.textContent = "Calendar temporarily unavailable";
      });
  };

  const feedRoot = document.getElementById("news-feed-list");
  const status = document.getElementById("news-feed-status");
  const moreButton = document.getElementById("news-load-more");
  let articles = [];
  let visibleCount = 0;

  const officialArticleUrl = (article) => {
    const id = String(article.id || "");
    return /^\d+$/.test(id) ? `https://www.playneverwinter.com/en/news-details/${id}` : null;
  };

  const prettyDate = (value) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? new Date(`${value}T12:00:00Z`) : null;
    return date && !Number.isNaN(date.valueOf())
      ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
      : "Date unavailable";
  };

  const addText = (parent, tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  };

  const renderCard = (article) => {
    const url = officialArticleUrl(article);
    if (!url) return null;

    const card = document.createElement("article");
    card.className = `news-card${article.image ? " has-image" : ""}`;
    const copy = document.createElement("div");
    copy.className = "news-card-copy";

    addText(copy, "p", "news-card-date", prettyDate(article.date));
    const heading = document.createElement("h3");
    const headingLink = document.createElement("a");
    headingLink.href = url;
    headingLink.target = "_blank";
    headingLink.rel = "noopener noreferrer external";
    headingLink.textContent = article.title || "Neverwinter announcement";
    heading.append(headingLink);
    copy.append(heading);
    addText(copy, "p", "news-card-summary", article.summary || "Open the official article for the full announcement.");

    if (Array.isArray(article.platforms) && article.platforms.length) {
      const platformNames = { pc: "PC", ps: "PlayStation", xbox: "Xbox" };
      const platforms = article.platforms.map((platform) => platformNames[platform]).filter(Boolean);
      if (platforms.length) addText(copy, "p", "news-card-date", platforms.join(" · "));
    }

    const readLink = addText(copy, "a", "news-card-link", "Read the official article ↗");
    readLink.href = url;
    readLink.target = "_blank";
    readLink.rel = "noopener noreferrer external";
    card.append(copy);

    if (typeof article.image === "string" && /^https:\/\//.test(article.image)) {
      const image = document.createElement("img");
      image.className = "news-card-image";
      image.src = article.image;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      card.append(image);
    }
    return card;
  };

  const updateStructuredData = () => {
    const script = document.getElementById("news-item-list-schema") || document.createElement("script");
    script.id = "news-item-list-schema";
    script.type = "application/ld+json";
    const items = articles.map((article, index) => {
      const url = officialArticleUrl(article);
      return url ? { "@type": "ListItem", position: index + 1, name: article.title, url } : null;
    }).filter(Boolean);
    script.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: items });
    if (!script.isConnected) document.head.append(script);
  };

  const renderMore = () => {
    const next = articles.slice(visibleCount, visibleCount + PAGE_SIZE);
    for (const article of next) {
      const card = renderCard(article);
      if (card) feedRoot.append(card);
    }
    visibleCount += next.length;
    moreButton.hidden = visibleCount >= articles.length;
    status.textContent = `${articles.length} recent official articles · newest first`;
  };

  const showError = () => {
    if (!feedRoot.querySelector(".news-card")) {
      addText(feedRoot, "p", "news-feed-error", "The news feed could not be loaded right now. Please try again later.");
    }
    status.textContent = "News feed temporarily unavailable";
  };

  moreButton.addEventListener("click", renderMore);
  loadGuildEvents();

  fetch("data/neverwinter-news.json", { cache: "no-cache", headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`News feed request failed (${response.status})`);
      return response.json();
    })
    .then((feed) => {
      if (!Array.isArray(feed.articles) || !feed.articles.length) throw new Error("News feed is empty");
      articles = feed.articles;
      window.newsFeedFetchedAt = feed.generatedAt || new Date().toISOString();
      feedRoot.replaceChildren();
      renderMore();
      updateStructuredData();
    })
    .catch((error) => {
      console.error("Unable to load Neverwinter news:", error);
      showError();
    });

  // Guild ticker: highlights computed from the roster snapshot, the
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
      const shotCounts = new Map();
      ((screenshots && screenshots.screenshots) || []).forEach((shot) => {
        if (shot.author && shot.author !== "Deleted User") {
          shotCounts.set(shot.author, (shotCounts.get(shot.author) || 0) + 1);
        }
      });
      const photographer = topEntry(shotCounts);
      if (photographer) {
        items.push(`Top photographer: ${photographer[0]} — ${formatCount(photographer[1])} screenshots`);
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
      const upcoming = [];
      (manualEvents || []).forEach((event) => {
        if (event.startDate && event.startDate >= todayKey) upcoming.push([event.startDate, event.name]);
      });
      (discordEvents || []).forEach((event) => {
        const start = tickerDate(event.startTime);
        if (start && start.valueOf() >= Date.now() - 24 * 60 * 60 * 1000) {
          upcoming.push([start.toLocaleDateString("en-CA"), event.name]);
        }
      });
      upcoming.sort((a, b) => a[0].localeCompare(b[0]));
      if (upcoming.length) {
        const [key, name] = upcoming[0];
        const label = new Date(`${key}T12:00:00`).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric"
        });
        items.push(`Next up: ${name} — ${label}`);
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
      const setWidth = tickerTrack.children[0].scrollWidth;
      if (setWidth > 0) {
        tickerTrack.style.animationDuration = `${Math.max(20, Math.round(setWidth / 58))}s`;
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
