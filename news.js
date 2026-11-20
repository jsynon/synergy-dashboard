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

  const endTimeOverride = (event) => {
    const override = /^(\d{1,2}):(\d{2})$/.exec(event.endTime || "");
    return override && Number(override[1]) <= 23 && Number(override[2]) <= 59
      ? { hour: Number(override[1]), minute: Number(override[2]) }
      : null;
  };

  const eventStart = (event) => {
    if (event.source === "discord") {
      const start = new Date(event.startTime);
      return Number.isNaN(start.valueOf()) ? null : start;
    }
    if (event.startDate) {
      // An event carrying an endTime starts at that time on its start
      // date (the Mysterious Merchant runs from when its structure was
      // built); other in-game events start at 10:30 AM Eastern.
      const override = endTimeOverride(event);
      return easternInstant(event.startDate, override ? override.hour : 10, override ? override.minute : 30);
    }
    return null;
  };

  const eventEnd = (event) => {
    if (event.source === "discord") {
      const end = new Date(event.endTime || event.startTime);
      return Number.isNaN(end.valueOf()) ? null : end;
    }
    if (event.endDate) {
      const override = endTimeOverride(event);
      return easternInstant(event.endDate, override ? override.hour : 10, override ? override.minute : 30);
    }
    return null;
  };

  const dayParts = (instant, timeZone) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "numeric", day: "numeric", timeZone
    }).formatToParts(instant);
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    return { year: part("year"), month: part("month"), day: part("day") };
  };

  // Whole calendar days between two instants, reckoned in the given
  // timezone (Eastern for in-game events, the viewer's for Discord ones).
  const calendarDaysBetween = (from, to, timeZone) => {
    const a = dayParts(from, timeZone);
    const b = dayParts(to, timeZone);
    return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
  };

  const dayLabel = (instant, timeZone) => new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone
  }).format(instant);

  const buildEventRow = ({ event, start, end, timeZone }, happeningNow, now) => {
    const row = document.createElement("li");
    row.className = "news-event-row";
    const target = happeningNow ? end : start;
    const dateCell = document.createElement("span");
    dateCell.className = "news-event-date";
    dateCell.append(`${happeningNow ? "Ends" : "Starts"} `);
    const day = document.createElement("strong");
    day.textContent = target ? dayLabel(target, timeZone) : "Date unavailable";
    dateCell.append(day);
    row.append(dateCell);

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

    let rangeLabel = formatEventDateRange(event);
    if (discordEvent && start) {
      const localTime = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      }).format(start);
      rangeLabel = `${rangeLabel} · ${localTime}`;
    }
    addText(details, "span", "news-event-range", rangeLabel);

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

    if (target) {
      const days = calendarDaysBetween(now, target, timeZone);
      const chipText = happeningNow
        ? (days <= 0 ? "Ends today" : days === 1 ? "1 day left" : `${days} days left`)
        : (days <= 0 ? "Starts today" : days === 1 ? "Starts in 1 day" : `Starts in ${days} days`);
      const chip = addText(row, "span", "news-event-chip", chipText);
      if (days <= 6) chip.classList.add("soon");
      else if (days > 20) chip.classList.add("later");
    }
    return row;
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
      });

    if (!upcomingEvents.length) {
      addText(eventList, "li", "news-event-empty", "No upcoming events are scheduled.");
      eventStatus.textContent = "No upcoming events";
      return;
    }

    // Group the survivors: everything already running goes first, sorted
    // by when it ends; the rest are grouped by the month they start.
    const decorated = upcomingEvents.map((event) => {
      const start = eventStart(event);
      const end = eventEnd(event);
      const timeZone = event.source === "discord" ? undefined : "America/New_York";
      return { event, start, end, timeZone, started: start ? start <= now : false };
    });
    const nowGroup = { id: "now", title: "Happening now", items: [] };
    const monthGroups = new Map();
    for (const item of decorated) {
      if (item.started) {
        nowGroup.items.push(item);
        continue;
      }
      const parts = item.start ? dayParts(item.start, item.timeZone) : null;
      const key = parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}` : "unknown";
      if (!monthGroups.has(key)) {
        const monthName = item.start ? new Intl.DateTimeFormat("en-US", { month: "long", timeZone: item.timeZone }).format(item.start) : "";
        const yearSuffix = parts && parts.year !== dayParts(now, item.timeZone).year ? ` ${parts.year}` : "";
        monthGroups.set(key, { id: key, title: monthName ? `Starting in ${monthName}${yearSuffix}` : "Starting soon", items: [] });
      }
      monthGroups.get(key).items.push(item);
    }
    nowGroup.items.sort((a, b) => (a.end - b.end) || a.event.name.localeCompare(b.event.name));
    const groups = [];
    if (nowGroup.items.length) groups.push(nowGroup);
    for (const group of [...monthGroups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      group.items.sort((a, b) => (a.start - b.start) || a.event.name.localeCompare(b.event.name));
      groups.push(group);
    }

    groups.forEach((group, groupIndex) => {
      const groupItem = document.createElement("li");
      groupItem.className = "news-event-group";
      const details = document.createElement("details");
      details.className = "news-group";
      if (groupIndex === 0) details.open = true;
      const summary = document.createElement("summary");
      summary.className = "news-group-head";
      if (group.id === "now") {
        const dot = document.createElement("span");
        dot.className = "news-group-live";
        dot.setAttribute("aria-hidden", "true");
        summary.append(dot);
      }
      addText(summary, "span", "news-group-title", group.title);
      const count = group.items.length;
      addText(summary, "span", "news-group-count", group.id === "now"
        ? `${count} ${count === 1 ? "event" : "events"} · soonest ending first`
        : `${count} ${count === 1 ? "event" : "events"}`);
      addText(summary, "span", "news-group-preview", group.items.map((item) => item.event.name).join(" · "));
      details.append(summary);
      const list = document.createElement("ul");
      list.className = "news-group-list";
      for (const item of group.items) list.append(buildEventRow(item, group.id === "now", now));
      details.append(list);
      groupItem.append(details);
      eventList.append(groupItem);
    });
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

  const setAllEventGroups = (open) => {
    eventList.querySelectorAll("details.news-group").forEach((group) => { group.open = open; });
  };
  document.getElementById("news-events-expand")?.addEventListener("click", () => setAllEventGroups(true));
  document.getElementById("news-events-collapse")?.addEventListener("click", () => setAllEventGroups(false));
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
})();
