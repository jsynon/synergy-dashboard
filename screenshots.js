(() => {
  const grid = document.getElementById("gallery-grid");
  const status = document.getElementById("gallery-status");
  const message = document.getElementById("gallery-message");
  const dialog = document.getElementById("gallery-lightbox");
  const lightboxImg = document.getElementById("gallery-lightbox-img");
  const lightboxCaption = document.getElementById("gallery-lightbox-caption");
  const lightboxByline = document.getElementById("gallery-lightbox-byline");
  if (!grid || !status || !message) return;

  let items = [];
  let current = 0;
  const PAGE_SIZE = 20;
  let shown = 0;
  const moreButton = document.getElementById("gallery-more");
  const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const dateLabel = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.valueOf()) ? "" : dateFormat.format(date);
  };

  function show(index) {
    if (!items.length) return;
    current = (index + items.length) % items.length;
    const item = items[current];
    lightboxImg.src = item.file;
    lightboxImg.alt = item.caption || `Screenshot by ${item.author}`;
    lightboxCaption.textContent = item.caption || "";
    const date = dateLabel(item.postedAt);
    lightboxByline.textContent = date ? `${item.author} · ${date}` : item.author;
  }

  function open(index) {
    show(index);
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function renderBatch() {
    const batch = items.slice(shown, shown + PAGE_SIZE);
    batch.forEach((item, offset) => {
      const index = shown + offset;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-item";
      button.setAttribute("aria-label", `View screenshot by ${item.author} full size`);
      const img = document.createElement("img");
      img.src = item.file;
      img.alt = item.caption || `Screenshot by ${item.author}`;
      img.loading = "lazy";
      if (item.width && item.height) { img.width = item.width; img.height = item.height; }
      const caption = document.createElement("span");
      caption.className = "gallery-item-caption";
      const date = dateLabel(item.postedAt);
      caption.textContent = date ? `${item.author} · ${date}` : item.author;
      button.append(img, caption);
      button.addEventListener("click", () => open(index));
      grid.append(button);
    });
    shown += batch.length;
    if (moreButton) moreButton.hidden = shown >= items.length;
  }

  moreButton?.addEventListener("click", renderBatch);

  document.getElementById("gallery-close")?.addEventListener("click", () => dialog.close());
  document.getElementById("gallery-prev")?.addEventListener("click", () => show(current - 1));
  document.getElementById("gallery-next")?.addEventListener("click", () => show(current + 1));
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.addEventListener("keydown", (event) => {
    if (!dialog?.open) return;
    if (event.key === "ArrowLeft") show(current - 1);
    if (event.key === "ArrowRight") show(current + 1);
  });

  fetch("data/screenshots.json", { cache: "no-store" })
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then((data) => {
      items = Array.isArray(data?.screenshots) ? data.screenshots : [];
      status.textContent = `${items.length} screenshot${items.length === 1 ? "" : "s"}`;
      if (!items.length) {
        message.textContent = "No screenshots yet — post one in the 📸 Screenshots channel on Discord and it will appear here after the next refresh.";
        return;
      }
      message.hidden = true;
      grid.replaceChildren();
      shown = 0;
      renderBatch();
    })
    .catch(() => {
      status.textContent = "Gallery unavailable";
      message.textContent = "The gallery could not be loaded right now. Please try again later.";
    });
})();
