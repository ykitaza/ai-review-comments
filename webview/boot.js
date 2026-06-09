// Entry point. Builds a controller that owns up to two views — PREVIEW
// (rendered) and SOURCE (raw text) — and an Obsidian-style toggle between them.
// Each view is its own adapter; the controller mounts them lazily and tells the
// core engine which one is active.
import { init, useAdapter } from "./core.js";
import { makeRenderAdapter } from "./render.js";
import { makeSourceAdapter } from "./source.js";
import { initSettings } from "./settings.js";

initSettings();

init((ctx) => {
  const { state } = ctx;
  const previewKind = state.meta.previewKind; // html | markdown | none
  const hasPreview = previewKind !== "none";

  const toggle = document.getElementById("view-toggle");
  const btnPreview = document.getElementById("view-preview");
  const btnSource = document.getElementById("view-source");
  const toolbar = document.getElementById("toolbar");
  const frameWrap = document.getElementById("frame-wrap");

  let current = null; // "preview" | "source"
  let active = null; // the currently-mounted adapter

  // HTML/Markdown previews use the render adapter (iframe srcdoc). Other files
  // are source-only.
  const factories = {
    preview: () => makeRenderAdapter(ctx),
    source: () => makeSourceAdapter(ctx),
  };

  // Mount a view fresh. Re-mounting is cheap: source re-fetches text, preview
  // reloads the iframe. This keeps element refs valid and state simple — the
  // comment store lives in core, so nothing is lost across switches.
  async function show(view) {
    if (view === current) return;
    frameWrap.innerHTML = "";
    const a = factories[view]();
    await a.mount();
    active = a;
    current = view;
    syncButtons();
    syncToolbar();
    useAdapter(a);
  }

  // Re-mount the current view from scratch. Useful if a link click inside the
  // preview iframe navigated away from the reviewed file — this restores it.
  async function reload() {
    frameWrap.innerHTML = "";
    const a = factories[current]();
    await a.mount();
    active = a;
    useAdapter(a);
  }

  function syncButtons() {
    btnPreview?.classList.toggle("active", current === "preview");
    btnSource?.classList.toggle("active", current === "source");
  }
  function syncToolbar() {
    // element/text/off selection modes apply to any rendered preview
    // (HTML or Markdown); the source view uses line comments instead.
    const showModes = current === "preview";
    toolbar.classList.toggle("source-mode", !showModes);
  }

  // controller satisfies the adapter interface via the active sub-adapter
  const controller = {
    async mount() {
      if (hasPreview) {
        toggle.hidden = false;
        btnPreview.addEventListener("click", () => show("preview"));
        btnSource.addEventListener("click", () => show("source"));
      } else {
        toggle.hidden = true;
      }
      document.getElementById("reload-view")?.addEventListener("click", () => reload());
      const start = state.meta.defaultView === "source" || !hasPreview ? "source" : "preview";
      frameWrap.innerHTML = "";
      active = factories[start]();
      await active.mount();
      current = start;
      syncButtons();
      syncToolbar();
      // core will call relocate() on the returned object; delegate below
    },
    relocate: () => active?.relocate?.(),
    reveal: (c) => active?.reveal?.(c),
    setActive: (id) => active?.setActive?.(id),
    clearSelection: () => active?.clearSelection?.(),
  };
  return controller;
});
