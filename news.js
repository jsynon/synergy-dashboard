(() => {
  "use strict";

  const PAGE_SIZE = 20;
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
