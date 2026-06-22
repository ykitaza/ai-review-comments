// Render-mode adapter: show the target HTML in an iframe and let the user
// comment by clicking an element or selecting text. Produces "element" and
// "text" comments carrying a robust CSS selector + an HTML snippet.

import { openFindBar, truncate } from "./core.js";

export function makeRenderAdapter({ state, startComposer }) {
  const frameWrap = document.getElementById("frame-wrap");
  let iframe, hoverBox, markers, copyMenu;
  let mode = "element"; // element | text | off
  let diagramLines = null; // diagram source lines (label→line mapping for puml/mmd)
  let messageHandler = null;

  // PlantUML and Mermaid both render to SVG whose element IDs are unstable, so
  // comments are located by the clicked label's text rather than a CSS selector.
  const isLabelDiagram = () =>
    state.meta.previewKind === "plantuml" || state.meta.previewKind === "mermaid";

  function doc() {
    return iframe.contentDocument || iframe.contentWindow.document;
  }
  function win() {
    return iframe.contentWindow;
  }

  async function mount() {
    // (re)build the stage: iframe + overlay layers
    frameWrap.innerHTML = "";
    iframe = document.createElement("iframe");
    iframe.id = "target";
    iframe.title = "target";
    // In a host without an HTTP server (VS Code webview), the preview HTML is
    // injected as a string; load it via srcdoc (same-origin → clickable).
    // Otherwise load the CLI's /target endpoint.
    if (typeof window.__PREVIEW_HTML__ === "string") {
      iframe.srcdoc = "";
      iframe.srcdoc = window.__PREVIEW_HTML__;
    } else {
      iframe.src = `/target?t=${Date.now()}`;
    }
    markers = document.createElement("div");
    markers.id = "markers";
    hoverBox = document.createElement("div");
    hoverBox.id = "hover-box";
    copyMenu = document.createElement("div");
    copyMenu.id = "frame-copy-menu";
    copyMenu.innerHTML = `<button type="button">コピー</button>`;
    frameWrap.appendChild(iframe);
    frameWrap.appendChild(markers);
    frameWrap.appendChild(hoverBox);
    frameWrap.appendChild(copyMenu);

    setupToolbar();
    // for diagrams, load the source lines so clicks can map labels → line refs
    if (isLabelDiagram() && diagramLines === null) {
      try {
        const text = await (await fetch("/__source")).text();
        diagramLines = text.replace(/\r\n?/g, "\n").split("\n");
      } catch {
        diagramLines = [];
      }
    }
    // Mermaid renders client-side after load; re-place pins when it signals done.
    if (messageHandler) window.removeEventListener("message", messageHandler);
    messageHandler = (e) => {
      if (e.data === "ai-review:diagram-rendered") relocate();
    };
    window.addEventListener("message", messageHandler);
    await new Promise((res) => {
      iframe.addEventListener("load", () => {
        attachFrameListeners();
        relocate();
        res();
      });
    });
  }

  function setupToolbar() {
    const map = { element: "mode-element", text: "mode-text", off: "mode-off" };
    for (const [m, id] of Object.entries(map)) {
      const old = document.getElementById(id);
      if (!old) continue;
      // replace with a clone to drop any listeners from a previous mount
      const btn = old.cloneNode(true);
      old.replaceWith(btn);
      btn.addEventListener("click", () => setMode(m));
    }
    // drawio is a cross-origin iframe (view-only). Everything else defaults to
    // text-select so dragging text is the first interaction.
    setMode(state.meta.previewKind === "drawio" ? "off" : "text");
  }

  function setMode(m) {
    mode = m;
    const map = { element: "mode-element", text: "mode-text", off: "mode-off" };
    for (const [k, id] of Object.entries(map)) {
      document.getElementById(id)?.classList.toggle("active", k === m);
    }
    frameWrap.classList.remove("mode-element", "mode-text", "mode-off");
    frameWrap.classList.add(`mode-${m}`);
    if (m === "element") frameWrap.classList.add("mode-element");
    if (m === "text") frameWrap.classList.add("mode-text");
    hideHover();
    hideCopyMenu();
  }

  function attachFrameListeners() {
    const d = doc();
    d.addEventListener("mousemove", onHover, true);
    d.addEventListener("mouseleave", hideHover, true);
    d.addEventListener("click", onLinkClick, true);
    d.addEventListener("click", onClick, true);
    d.addEventListener("mouseup", onMouseUp, true);
    d.addEventListener("keydown", onFrameKeyDown, true);
    d.addEventListener("contextmenu", onContextMenu, true);
    d.addEventListener("click", hideCopyMenu, true);
    win().addEventListener("scroll", relocate, true);
    win().addEventListener("resize", relocate);
  }

  // ---- hover highlight ----------------------------------------------------
  function onHover(e) {
    if (mode !== "element") return hideHover();
    const el = e.target;
    if (!el || el === doc().body || el === doc().documentElement) return hideHover();
    const r = el.getBoundingClientRect();
    const fr = iframe.getBoundingClientRect();
    const base = frameWrap.getBoundingClientRect();
    Object.assign(hoverBox.style, {
      display: "block",
      top: `${r.top + fr.top - base.top}px`,
      left: `${r.left + fr.left - base.left}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }
  function hideHover() {
    if (hoverBox) hoverBox.style.display = "none";
  }

  // ---- link navigation -----------------------------------------------------
  function onLinkClick(e) {
    if (mode === "element") return;
    const link = e.target?.closest?.("a[href]");
    if (!link) return;
    const href = (link.getAttribute("href") || "").trim();
    if (!href) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    hideCopyMenu();

    if (href.toLowerCase().startsWith("javascript:")) return;
    if (isInPageAnchor(href)) {
      followInPageAnchor(href);
      return;
    }

    const url = resolveLinkUrl(href);
    if (!url) return;
    if (!isAllowedExternalUrl(url)) return;
    const opened = window.aiReviewHost?.openExternal
      ? window.aiReviewHost.openExternal(url)
      : window.open(url, "_blank", "noopener");
    if (opened?.catch) opened.catch((error) => console.error("Failed to open link", error));
  }

  function isInPageAnchor(href) {
    if (href.startsWith("#")) return true;
    try {
      const target = new URL(href, sourceFileUrl()).href;
      return Boolean(new URL(target).hash) && stripHash(target) === stripHash(sourceFileUrl());
    } catch {
      return false;
    }
  }

  function followInPageAnchor(href) {
    let hash = href.startsWith("#") ? href : "";
    if (!hash) {
      try {
        hash = new URL(href, sourceFileUrl()).hash;
      } catch {
        hash = "";
      }
    }
    if (!hash || hash === "#") {
      win().scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(relocate, 350);
      return;
    }
    const id = decodeHash(hash.slice(1));
    const target = doc().getElementById(id) || elementByName(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(relocate, 350);
  }

  function decodeHash(hash) {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  }

  function elementByName(name) {
    try {
      return doc().querySelector(`[name="${cssString(name)}"]`);
    } catch {
      return null;
    }
  }

  function cssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function resolveLinkUrl(href) {
    try {
      const base = doc().querySelector("base[href]")?.href || sourceFileUrl();
      return new URL(href, base).href;
    } catch {
      return "";
    }
  }

  function isAllowedExternalUrl(url) {
    try {
      return ["http:", "https:", "mailto:", "file:", "tel:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function stripHash(url) {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  }

  function sourceFileUrl() {
    const filePath = String(state.meta.path || "");
    if (!filePath) return win().location.href;
    let normalized = filePath.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) normalized = `/${normalized}`;
    const encoded = normalized
      .split("/")
      .map((segment, index) => {
        if (index === 0 && segment === "") return "";
        if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
        return encodeURIComponent(segment);
      })
      .join("/");
    return `file://${encoded}`;
  }

  // ---- selection → comment ------------------------------------------------
  function onClick(e) {
    if (mode !== "element") return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (!el) return;
    if (isLabelDiagram()) return onDiagramClick(el, e);
    startComposer(
      {
        kind: "element",
        selector: cssPath(el),
        snippet: outerHtmlSnippet(el),
        label: describeEl(el),
        ...lineRefOf(el), // mdLine (Markdown) or srcLine (HTML) for sync
        anchor: { fx: 0.5, fy: 0.5 },
      },
      framePos(e)
    );
  }

  // Locate the clicked diagram label by its text and map it back to the first
  // matching line in the .puml/.mmd source (SVG element IDs are unstable).
  function onDiagramClick(el, e) {
    // climb to a node that carries readable text (the SVG <text> or its group)
    let label = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!label && el.closest) {
      const g = el.closest("g");
      if (g) label = (g.textContent || "").trim().replace(/\s+/g, " ");
    }
    const srcLine = label ? findDiagramLine(label) : null;
    startComposer(
      {
        kind: "element",
        selector: label ? `図要素「${truncate(label, 30)}」` : "図要素",
        label,
        quote: label || undefined,
        srcLine: srcLine || undefined,
        anchor: { fx: 0.5, fy: 0.5 },
      },
      framePos(e)
    );
  }

  // first source line whose text contains the label (longest-token match)
  function findDiagramLine(label) {
    if (!diagramLines) return null;
    const needle = label.split(/\s+/).sort((a, b) => b.length - a.length)[0] || label;
    for (let i = 0; i < diagramLines.length; i++) {
      if (diagramLines[i].includes(needle)) return i + 1;
    }
    return null;
  }

  function onMouseUp(e) {
    if (mode !== "text") return;
    const sel = win().getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const container =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    startComposer(
      {
        kind: "text",
        selector: cssPath(container),
        quote: text,
        label: describeEl(container),
        ...lineRefOf(container),
        anchor: { fx: 0.05, fy: 0.1 },
      },
      framePos(e)
    );
  }

  function onFrameKeyDown(e) {
    const key = String(e.key || "").toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key === "f") {
      e.preventDefault();
      e.stopPropagation();
      openFindBar(selectedText());
      return;
    }
    if (mode !== "off") return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key === "w" && window.aiReviewHost?.close) {
      e.preventDefault();
      window.aiReviewHost.close();
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key === "c") {
      if (!window.aiReviewHost?.copyText) return;
      const text = selectedText();
      if (!text) return;
      e.preventDefault();
      writeSelectionToClipboard(text);
    }
  }

  function onContextMenu(e) {
    if (mode !== "off") return;
    if (!window.aiReviewHost?.copyText) return;
    const text = selectedText();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    const p = frameLocalPos(e);
    copyMenu.style.display = "block";
    copyMenu.style.left = `${p.x}px`;
    copyMenu.style.top = `${p.y}px`;
    copyMenu.querySelector("button").onclick = () => {
      writeSelectionToClipboard(text);
      hideCopyMenu();
    };
  }

  function selectedText() {
    return (win().getSelection()?.toString() || "").trim();
  }

  function writeSelectionToClipboard(text) {
    return window.aiReviewHost.copyText(text);
  }

  function hideCopyMenu() {
    if (copyMenu) copyMenu.style.display = "none";
  }

  // Nearest ancestor's source line number, for preview→source sync.
  // Markdown blocks carry data-md-line; injected HTML carries data-line.
  function lineRefOf(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.dataset?.mdLine) return { mdLine: Number(n.dataset.mdLine) };
      if (n.dataset?.line) return { srcLine: Number(n.dataset.line) };
      n = n.parentElement;
    }
    return {};
  }

  function framePos(e) {
    const fr = iframe.getBoundingClientRect();
    return { x: (e.clientX ?? 0) + fr.left + 12, y: (e.clientY ?? 0) + fr.top + 12 };
  }

  function frameLocalPos(e) {
    const fr = iframe.getBoundingClientRect();
    const base = frameWrap.getBoundingClientRect();
    return { x: (e.clientX ?? 0) + fr.left - base.left, y: (e.clientY ?? 0) + fr.top - base.top };
  }

  // ---- pins ---------------------------------------------------------------
  function relocate() {
    if (!markers) return;
    markers.innerHTML = "";
    const fr = iframe.getBoundingClientRect();
    const base = frameWrap.getBoundingClientRect();
    const frTop = fr.top - base.top;
    const frLeft = fr.left - base.left;
    state.comments.forEach((c, i) => {
      if (c.resolved) return; // resolved comments drop their marker entirely
      if (!c.anchor || !c.selector) return;
      const el = resolve(c);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pin = document.createElement("div");
      pin.className = "pin";
      pin.dataset.id = c.id;
      pin.style.left = `${r.left + (c.anchor.fx ?? 0) * r.width + frLeft}px`;
      pin.style.top = `${r.top + (c.anchor.fy ?? 0) * r.height + frTop}px`;
      pin.innerHTML = `<span>${i + 1}</span>`;
      pin.addEventListener("click", () => {
        document.querySelector(`.comment[data-id="${c.id}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      markers.appendChild(pin);
    });
  }

  function resolve(c) {
    // Diagram (PlantUML/Mermaid) comments aren't located by CSS selector
    // (unstable IDs) but by the clicked label's text — re-find the matching SVG
    // <text> element so the pin reappears after the diagram is re-rendered.
    if (isLabelDiagram()) {
      const label = (c.quote || "").trim();
      if (!label) return null;
      const texts = doc().querySelectorAll("svg text");
      for (const t of texts) {
        if ((t.textContent || "").trim() === label) return t;
      }
      // fall back to a partial match on the longest token
      const needle = label.split(/\s+/).sort((a, b) => b.length - a.length)[0] || label;
      for (const t of texts) {
        if ((t.textContent || "").includes(needle)) return t;
      }
      return null;
    }
    try {
      return doc().querySelector(c.selector);
    } catch {
      return null;
    }
  }

  function reveal(c) {
    const el = resolve(c);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(relocate, 350);
    }
  }

  function setActive(id) {
    document.querySelectorAll(".pin").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.id) === id);
    });
  }

  function clearSelection() {
    try {
      win().getSelection().removeAllRanges();
    } catch {}
  }

  function find(query, direction = 1, reset = false) {
    if (!query) {
      clearFind();
      return { current: 0, total: 0 };
    }
    try {
      iframe.focus();
      win().focus();
      if (reset) win().getSelection()?.removeAllRanges();
      const found = win().find(query, false, direction < 0, true, false, false, false);
      return { found, current: Number.NaN, total: Number.NaN };
    } catch {
      return { found: false, current: 0, total: 0 };
    }
  }

  function clearFind() {
    clearSelection();
  }

  // ---- CSS selector generation -------------------------------------------
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && uniqueId(el.id)) return `#${esc(el.id)}`;
    const parts = [];
    let node = el;
    const d = doc();
    while (node && node.nodeType === 1 && node !== d.body && node !== d.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id && uniqueId(node.id)) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      const cls = stableClass(node);
      if (cls) part += `.${esc(cls)}`;
      const idx = siblingIndex(node);
      if (idx != null) part += `:nth-of-type(${idx})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }
  function uniqueId(id) {
    try {
      return doc().querySelectorAll(`#${esc(id)}`).length === 1;
    } catch {
      return false;
    }
  }
  function stableClass(node) {
    const list = Array.from(node.classList || []);
    return (
      list.find(
        (c) =>
          c.length > 1 &&
          !/^(is-|has-|js-|active|open|hover|ng-|css-)/.test(c) &&
          !/\d{4,}/.test(c)
      ) || null
    );
  }
  function siblingIndex(node) {
    const parent = node.parentElement;
    if (!parent) return null;
    const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    return same.length <= 1 ? null : same.indexOf(node) + 1;
  }
  function esc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function outerHtmlSnippet(el, max = 400) {
    let html = el.outerHTML || "";
    if (html.length > max) {
      const open = html.match(/^<[^>]+>/);
      const close = html.match(/<\/[^>]+>\s*$/);
      html = open && close ? `${open[0]} … ${close[0]}` : html.slice(0, max) + " …";
    }
    return html.trim();
  }
  function describeEl(el) {
    if (!el) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (txt) s += ` — “${truncate(txt, 40)}”`;
    return s;
  }

  return { mount, relocate, reveal, setActive, clearSelection, find, clearFind };
}
