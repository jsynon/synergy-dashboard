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

    const timeZone = dateOnly ? "UTC" : "America/New_York";
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
    const upcomingEvents = events
      .filter((event) => {
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
      addText(row, "span", "news-event-date", formatEventDateRange(event));

      const details = document.createElement("div");
      details.className = "news-event-copy";
      const discordEvent = event.source === "discord";
      if (discordEvent) {
        const title = document.createElement("a");
        title.className = "news-event-name";
        title.href = `https://discord.com/events/${encodeURIComponent(event.guildId)}/${encodeURIComponent(event.id)}`;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.textContent = event.name;
        details.append(title);
      } else {
        addText(details, "span", "news-event-name", event.name);
      }

      const links = document.createElement("div");
      links.className = "news-event-links";
      if (event.recurring) addText(links, "span", "news-event-repeat", "Recurring");
      const eventUrl = safeHttpsUrl(event.url || event.location);
      if (eventUrl) {
        const linkLabel = /raid[-.]?helper/i.test(eventUrl) ? "Raid-Helper signup ↗" : "Event link ↗";
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
})();
