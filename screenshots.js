(() => {
  const grid = document.getElementById("gallery-grid");
  const status = document.getElementById("gallery-status");
  const message = document.getElementById("gallery-message");
  const dialog = document.getElementById("gallery-lightbox");
  const lightboxImg = document.getElementById("gallery-lightbox-img");
  const viewport = document.getElementById("gallery-zoom-viewport");
  const lightboxCaption = document.getElementById("gallery-lightbox-caption");
  const lightboxByline = document.getElementById("gallery-lightbox-byline");
  if (!grid || !status || !message) return;

  let items = [];
  let current = 0;
  const PAGE_SIZE = 60;
  let shown = 0;
  const moreButton = document.getElementById("gallery-more");
  const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const dateLabel = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.valueOf()) ? "" : dateFormat.format(date);
  };

  // Viewer zoom: the image is laid out at its fitted size, then scaled and
  // panned by transform, so high-resolution shots can be inspected at full
  // detail. Scale 1 is always the fitted view; navigation resets it.
  const zoom = { scale: 1, x: 0, y: 0 };
  let fitW = 0;
  let fitH = 0;
  let maxScale = 4;

  function applyZoom() {
    lightboxImg.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    if (viewport) viewport.style.cursor = zoom.scale > 1 ? "grab" : "zoom-in";
  }

  function clampPan() {
    const vw = (viewport && viewport.clientWidth) || fitW;
    const sw = fitW * zoom.scale;
    const sh = fitH * zoom.scale;
    zoom.x = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, zoom.x));
    zoom.y = sh <= fitH ? (fitH - sh) / 2 : Math.min(0, Math.max(fitH - sh, zoom.y));
  }

  function resetZoom() {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    clampPan();
    applyZoom();
  }

  function layoutImage(item) {
    const iw = item.width || lightboxImg.naturalWidth || 0;
    const ih = item.height || lightboxImg.naturalHeight || 0;
    if (!iw || !ih || !viewport) return;
    const vw = viewport.clientWidth || 1000;
    const vh = Math.round(window.innerHeight * 0.74);
    const fitScale = Math.min(vw / iw, vh / ih, 1);
    fitW = Math.round(iw * fitScale);
    fitH = Math.round(ih * fitScale);
    maxScale = Math.max(4, 1.15 / fitScale);
    lightboxImg.style.width = `${fitW}px`;
    lightboxImg.style.height = `${fitH}px`;
    viewport.style.height = `${fitH}px`;
    resetZoom();
  }

  function show(index) {
    if (!items.length) return;
    current = (index + items.length) % items.length;
    const item = items[current];
    fitW = 0;
    fitH = 0;
    lightboxImg.src = item.file;
    lightboxImg.alt = item.caption || `Screenshot by ${item.author}`;
    lightboxCaption.textContent = item.caption || "";
    const date = dateLabel(item.postedAt);
    lightboxByline.textContent = date ? `${item.author} · ${date}` : item.author;
    layoutImage(item);
  }

  function open(index) {
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    show(index);
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
      img.src = item.thumb || item.file;
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

  lightboxImg.addEventListener("load", () => { if (!fitW && items[current]) layoutImage(items[current]); });

  function zoomAt(clientX, clientY, factor) {
    if (!viewport || !fitW) return;
    const rect = viewport.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const next = Math.min(maxScale, Math.max(1, zoom.scale * factor));
    if (next === zoom.scale) return;
    const ratio = next / zoom.scale;
    zoom.x = cx - (cx - zoom.x) * ratio;
    zoom.y = cy - (cy - zoom.y) * ratio;
    zoom.scale = next;
    clampPan();
    applyZoom();
  }

  if (viewport) {
    lightboxImg.draggable = false;
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0016));
    }, { passive: false });
    viewport.addEventListener("dblclick", (event) => {
      if (zoom.scale > 1) { resetZoom(); return; }
      zoomAt(event.clientX, event.clientY, 2.5);
    });

    const pointers = new Map();
    let lastPinch = null;
    viewport.addEventListener("pointerdown", (event) => {
      if (typeof viewport.setPointerCapture === "function") viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      const prev = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && lastPinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        if (lastPinch.dist > 0) zoomAt(cx, cy, dist / lastPinch.dist);
        zoom.x += cx - lastPinch.x;
        zoom.y += cy - lastPinch.y;
        clampPan();
        applyZoom();
        lastPinch = { dist, x: cx, y: cy };
      } else if (pointers.size === 1 && zoom.scale > 1) {
        zoom.x += event.clientX - prev.x;
        zoom.y += event.clientY - prev.y;
        clampPan();
        applyZoom();
      }
    });
    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) lastPinch = null;
    };
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
  }
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
