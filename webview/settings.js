// Settings drawer (prompt templates) + panel collapse + panel resize.
// Wired up once at boot; independent of which view adapter is active.

import {
  DEFAULT_COMMON_PROMPT_BODY,
  TEMPLATE_PRESETS,
  commonPrompt,
  template,
  saveCommonPrompt,
  saveTemplate,
  currentCommonPromptBody,
  currentTemplateBody,
  composePrompt,
  state,
} from "./core.js";

const PANEL_WIDTH_KEY = "review:panelWidth";
const PANEL_HEIGHT_KEY = "review:panelHeight";
const PANEL_OPEN_KEY = "review:panelOpen";

export function initSettings() {
  setupPanelToggle();
  setupResizer();
  setupDrawer();
}

// ---------------------------------------------------------------------------
// collapse / expand the comment panel
function setupPanelToggle() {
  const app = document.getElementById("app");
  const showBtn = document.getElementById("show-panel");
  const collapseBtn = document.getElementById("collapse-panel");
  const toggleBtn = document.getElementById("toggle-panel");

  function setOpen(open) {
    app.classList.toggle("panel-collapsed", !open);
    showBtn.classList.toggle("hidden", open);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, open ? "1" : "0");
    } catch {}
  }
  const saved = localStorage.getItem(PANEL_OPEN_KEY);
  if (saved === "0") setOpen(false);

  collapseBtn?.addEventListener("click", () => setOpen(false));
  toggleBtn?.addEventListener("click", () =>
    setOpen(app.classList.contains("panel-collapsed"))
  );
  showBtn?.addEventListener("click", () => setOpen(true));
}

// ---------------------------------------------------------------------------
// drag-resize the panel width
function setupResizer() {
  const app = document.getElementById("app");
  const resizer = document.getElementById("resizer");
  if (!resizer) return;

  // narrow layout stacks vertically → the handle resizes height, not width
  const stacked = () => window.matchMedia("(max-width: 720px)").matches;

  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  if (saved >= 240 && saved <= 900) setWidth(saved);
  const savedH = Number(localStorage.getItem(PANEL_HEIGHT_KEY));
  if (savedH >= 120 && savedH <= 1200) setHeight(savedH);

  let dragging = false;
  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    document.body.style.cursor = stacked() ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (stacked()) {
      const h = Math.min(window.innerHeight - 120, Math.max(120, window.innerHeight - e.clientY));
      setHeight(h);
    } else {
      const w = Math.min(900, Math.max(240, window.innerWidth - e.clientX));
      setWidth(w);
    }
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      if (stacked()) {
        localStorage.setItem(PANEL_HEIGHT_KEY, String(app.__panelH || 0));
      } else {
        localStorage.setItem(PANEL_WIDTH_KEY, String(app.__panelW || 0));
      }
    } catch {}
  });

  function setWidth(px) {
    app.__panelW = px;
    app.style.setProperty("--panel-w", `${px}px`);
  }
  function setHeight(px) {
    app.__panelH = px;
    app.style.setProperty("--panel-h", `${px}px`);
  }
}

// ---------------------------------------------------------------------------
// the prompt-template settings drawer
function setupDrawer() {
  const drawer = document.getElementById("settings");
  const backdrop = document.getElementById("settings-backdrop");
  const openBtn = document.getElementById("open-settings");
  const closeBtn = document.getElementById("settings-close");
  const commonBody = document.getElementById("common-prompt-body");
  const commonSaveBtn = document.getElementById("common-prompt-save");
  const commonResetBtn = document.getElementById("common-prompt-reset");
  const sel = document.getElementById("template-select");
  const body = document.getElementById("template-body");
  const preview = document.getElementById("template-preview");
  const saveBtn = document.getElementById("template-save");
  const resetBtn = document.getElementById("template-reset");

  // populate the dropdown: presets + custom
  for (const [key, t] of Object.entries(TEMPLATE_PRESETS)) {
    sel.appendChild(new Option(t.label, key));
  }
  sel.appendChild(new Option("カスタム", "custom"));

  function syncFromState() {
    commonBody.value = currentCommonPromptBody();
    sel.value = template.key;
    body.value = currentTemplateBody();
    refreshPreview();
  }

  function refreshPreview() {
    // preview using the textarea's current content against current comments
    const list = state.comments.filter((c) => !c.resolved);
    preview.textContent = composePrompt(commonBody.value, body.value, list, "（コメントなし）");
  }

  function open() {
    syncFromState();
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
  }
  function close() {
    drawer.classList.add("hidden");
    backdrop.classList.add("hidden");
  }

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  sel.addEventListener("change", () => {
    template.key = sel.value;
    body.value = currentTemplateBody();
    saveTemplate();
    refreshPreview();
  });

  commonBody.addEventListener("input", refreshPreview);
  body.addEventListener("input", refreshPreview);

  commonSaveBtn.addEventListener("click", () => {
    commonPrompt.body = commonBody.value === DEFAULT_COMMON_PROMPT_BODY ? null : commonBody.value;
    saveCommonPrompt();
    refreshPreview();
    flash(commonSaveBtn, "保存しました");
  });

  commonResetBtn.addEventListener("click", () => {
    commonPrompt.body = null;
    commonBody.value = currentCommonPromptBody();
    saveCommonPrompt();
    refreshPreview();
  });

  saveBtn.addEventListener("click", () => {
    // editing always becomes "custom" unless it still equals the preset
    const presetBody = TEMPLATE_PRESETS[sel.value]?.body;
    if (sel.value !== "custom" && body.value === presetBody) {
      template.key = sel.value;
      template.customBody = null;
    } else {
      template.key = "custom";
      template.customBody = body.value;
      sel.value = "custom";
    }
    saveTemplate();
    refreshPreview();
    flash(saveBtn, "保存しました");
  });

  resetBtn.addEventListener("click", () => {
    const key = sel.value === "custom" ? "fix" : sel.value;
    template.key = key;
    template.customBody = null;
    sel.value = key;
    body.value = currentTemplateBody();
    saveTemplate();
    refreshPreview();
  });
}

function flash(btn, label) {
  const prev = btn.textContent;
  btn.textContent = "✓ " + label;
  setTimeout(() => (btn.textContent = prev), 1200);
}
