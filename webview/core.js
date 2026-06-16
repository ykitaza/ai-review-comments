// Shared review engine: comment store, persistence, panel/composer UI, and
// AI-prompt generation. Mode-specific behaviour (how a target is displayed and
// how a selection becomes a comment) lives in an "adapter" that the bootstrap
// wires in. This is shared by render mode (HTML iframe) and source mode (raw
// text with line numbers).

export const els = {
  panel: document.getElementById("panel"),
  comments: document.getElementById("comments"),
  count: document.getElementById("count"),
  hint: document.getElementById("hint"),
  copy: document.getElementById("copy"),
  clear: document.getElementById("clear"),
  toast: document.getElementById("copied-toast"),
  fileLabel: document.getElementById("file-label"),
  version: document.getElementById("extension-version"),
  composer: document.getElementById("composer"),
  composerTarget: document.getElementById("composer-target"),
  composerInput: document.getElementById("composer-input"),
  composerSave: document.getElementById("composer-save"),
  composerCancel: document.getElementById("composer-cancel"),
};

export const state = {
  comments: [],
  nextId: 1,
  meta: { file: "", path: "", dir: "", previewKind: "none", defaultView: "source", lang: "text" },
};

let adapter = null; // set by init()
let pending = null; // selection awaiting a comment
let editingId = null; // comment being edited
let replyParentId = null; // comment being replied to
let findBar = null;
let findInput = null;
let findStatus = null;
let lastFindQuery = "";
const commentSectionOpen = { open: true, closed: false };

// ---------------------------------------------------------------------------
// Comments are persisted by the host only. Preview HTML/webview state is never
// persisted, so reopening always regenerates the rendered content from the file.
export function save() {
  window.aiReviewHost?.saveComments?.(state.comments).catch((error) => {
    console.error("Failed to save review comments", error);
  });
}
function replaceComments(comments) {
  state.comments = comments;
  state.nextId = comments.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
}
async function loadComments() {
  try {
    const comments = await window.aiReviewHost?.loadComments?.();
    replaceComments(Array.isArray(comments) ? comments : []);
  } catch (error) {
    console.error("Failed to load review comments", error);
    replaceComments([]);
  }
}

// ---------------------------------------------------------------------------
// comment mutations — used by adapters that manage their own inline UI
// (e.g. the GitHub-style source view). Each persists + re-renders the panel.
export function addComment(target, body) {
  const c = { id: state.nextId++, ...target, body };
  state.comments.push(c);
  save();
  renderComments();
  return c;
}
export function updateComment(id, body) {
  const c = state.comments.find((x) => x.id === id);
  if (c) {
    c.body = body;
    save();
    renderComments();
  }
  return c;
}
export function deleteComment(id) {
  state.comments = state.comments.filter((x) => x.id !== id);
  save();
  renderComments();
  adapter?.relocate?.();
}

export function setCommentResolved(id, resolved) {
  const ids = threadIdsFor(id);
  state.comments.forEach((c) => {
    if (!ids.has(c.id)) return;
    c.resolved = resolved;
    if (!resolved) delete c.resolutionNote;
  });
  save();
  renderComments();
  adapter?.relocate?.();
}

// ---------------------------------------------------------------------------
// init: fetch meta, restore comments, let the adapter mount its view
export async function init(makeAdapter) {
  const meta = await (await fetch("/__meta")).json();
  state.meta = meta;
  els.fileLabel.textContent = meta.file;
  els.fileLabel.title = meta.path;
  setVersionBadge();
  document.title = `Review — ${meta.file}`;

  await loadComments();
  loadCommentListState();
  loadTemplate(); // restore the user's chosen prompt template
  loadCommonPrompt(); // restore the common prompt prepended to every output

  // makeAdapter may return an adapter, or a "controller" that manages multiple
  // views and exposes its own mount(). Either way it must satisfy the adapter
  // interface (mount/relocate/reveal/setActive/clearSelection).
  adapter = makeAdapter({ state, startComposer, refresh, useAdapter });
  await adapter.mount();
  renderComments();
  adapter.relocate?.();

}

export async function applyBootData(boot) {
  state.meta = boot.meta;
  els.fileLabel.textContent = boot.meta.file;
  els.fileLabel.title = boot.meta.path;
  document.title = `Review — ${boot.meta.file}`;
  await loadComments();
  setVersionBadge(boot);
}

function setVersionBadge(boot = window.__AI_REVIEW_BOOT__) {
  if (!els.version) return;
  const version = boot?.extensionVersion || "dev";
  const loadedAt = boot?.loadedAt ? new Date(boot.loadedAt).toLocaleTimeString() : "";
  els.version.textContent = `v${version}${loadedAt ? ` / ${loadedAt}` : ""}`;
  els.version.title = `AI Review Comments ${version}${loadedAt ? ` loaded at ${loadedAt}` : ""}`;
}

// Swap the active adapter (used when toggling preview/source). The new adapter
// must already be mounted. Re-renders the panel + repositions markers.
export function useAdapter(next) {
  adapter = next;
  renderComments();
  adapter?.relocate?.();
}

// adapters call this after the view changes (scroll/resize/reflow)
export function refresh() {
  adapter?.relocate?.();
}

// ---------------------------------------------------------------------------
// find bar — VS Code webviews/iframes often swallow native Cmd/Ctrl+F, so the
// review UI provides its own small search box and delegates matching to adapters.
export function openFindBar(initialText = "") {
  ensureFindBar();
  findBar.classList.remove("hidden");
  if (initialText) findInput.value = initialText;
  findInput.focus();
  findInput.select();
  runFind(1, true);
}

function ensureFindBar() {
  if (findBar) return;
  findBar = document.createElement("div");
  findBar.id = "find-bar";
  findBar.className = "find-bar hidden";
  findBar.innerHTML = `
    <input id="find-input" type="search" placeholder="検索" autocomplete="off" />
    <span id="find-status" class="find-status"></span>
    <button id="find-prev" type="button" title="前を検索">↑</button>
    <button id="find-next" type="button" title="次を検索">↓</button>
    <button id="find-close" type="button" title="閉じる">×</button>
  `;
  (document.getElementById("app") || document.body).appendChild(findBar);
  findInput = findBar.querySelector("#find-input");
  findStatus = findBar.querySelector("#find-status");
  findInput.addEventListener("input", () => runFind(1, true));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runFind(e.shiftKey ? -1 : 1, false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFindBar();
    }
  });
  findBar.querySelector("#find-prev").addEventListener("click", () => runFind(-1, false));
  findBar.querySelector("#find-next").addEventListener("click", () => runFind(1, false));
  findBar.querySelector("#find-close").addEventListener("click", closeFindBar);
}

function runFind(direction, reset) {
  if (!findInput) return;
  const query = findInput.value.trim();
  lastFindQuery = query;
  const result = adapter?.find?.(query, direction, reset);
  updateFindStatus(result);
}

function updateFindStatus(result) {
  if (!findStatus) return;
  if (!lastFindQuery) {
    findStatus.textContent = "";
  } else if (!result || result.total === 0 || result.found === false) {
    findStatus.textContent = "一致なし";
  } else if (Number.isFinite(result.current) && Number.isFinite(result.total)) {
    findStatus.textContent = `${result.current} / ${result.total}`;
  } else {
    findStatus.textContent = "一致";
  }
}

function closeFindBar() {
  findBar?.classList.add("hidden");
  adapter?.clearFind?.();
}

document.addEventListener("keydown", (e) => {
  const key = String(e.key || "").toLowerCase();
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key === "f") {
    e.preventDefault();
    openFindBar();
  } else if (e.key === "Escape" && findBar && !findBar.classList.contains("hidden")) {
    e.preventDefault();
    closeFindBar();
  }
}, true);

// ---------------------------------------------------------------------------
// composer (shared popover). `target` is the selection descriptor the adapter
// built; it must carry { kind, selector, label } and optionally { quote, snippet, anchor }.
export function startComposer(target, position) {
  pending = target;
  editingId = null;
  replyParentId = null;
  els.composerTarget.textContent = composerLabel(target);
  els.composerInput.value = "";
  placeComposer(position);
  els.composer.classList.remove("hidden");
  els.composerInput.focus();
}

function openEditComposer(c) {
  pending = null;
  editingId = c.id;
  replyParentId = null;
  els.composerTarget.textContent = composerLabel(c);
  els.composerInput.value = c.body;
  els.composer.style.top = "120px";
  els.composer.style.left = "calc(50% - 160px)";
  els.composer.classList.remove("hidden");
  els.composerInput.focus();
}

export function openReplyComposer(c, position) {
  pending = replyTargetOf(c);
  editingId = null;
  replyParentId = c.id;
  els.composerTarget.textContent = `↪ #${c.id} への返信 · ${composerLabel(c)}`;
  els.composerInput.value = "";
  placeComposer(position || { x: window.innerWidth / 2 - 160, y: 120 });
  els.composer.classList.remove("hidden");
  els.composerInput.focus();
}

function composerLabel(c) {
  if (c.quote) return `“${truncate(c.quote, 80)}”  ·  ${c.selector}`;
  return c.selector;
}

function placeComposer(pos) {
  const w = 320, h = 160;
  let x = (pos?.x ?? window.innerWidth / 2 - w / 2);
  let y = (pos?.y ?? 120);
  x = Math.max(12, Math.min(x, window.innerWidth - w - 12));
  y = Math.max(12, Math.min(y, window.innerHeight - h - 12));
  els.composer.style.left = `${x}px`;
  els.composer.style.top = `${y}px`;
}

function closeComposer() {
  els.composer.classList.add("hidden");
  pending = null;
  editingId = null;
  replyParentId = null;
}

function saveComposer() {
  const body = els.composerInput.value.trim();
  if (!body) {
    els.composerInput.focus();
    return;
  }
  if (editingId != null) {
    const c = state.comments.find((c) => c.id === editingId);
    if (c) c.body = body;
  } else if (pending) {
    state.comments.push({ id: state.nextId++, ...pending, body, ...(replyParentId ? { replyTo: replyParentId } : {}) });
  }
  save();
  closeComposer();
  renderComments();
  adapter?.relocate?.();
  adapter?.clearSelection?.();
}

els.composerSave.addEventListener("click", saveComposer);
els.composerCancel.addEventListener("click", closeComposer);
els.composerInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveComposer();
  if (e.key === "Escape") closeComposer();
});

// ---------------------------------------------------------------------------
// comment list rendering
const COMMENT_SECTION_OPEN_KEY = "review:commentSectionOpen";

function loadCommentListState() {
  try {
    const saved = JSON.parse(localStorage.getItem(COMMENT_SECTION_OPEN_KEY) || "{}");
    if (typeof saved.open === "boolean") commentSectionOpen.open = saved.open;
    if (typeof saved.closed === "boolean") commentSectionOpen.closed = saved.closed;
  } catch {}
}

function saveCommentListState() {
  try {
    localStorage.setItem(COMMENT_SECTION_OPEN_KEY, JSON.stringify(commentSectionOpen));
  } catch {}
}

export function renderComments() {
  const unresolvedCount = state.comments.filter((c) => !c.resolved).length;
  const resolvedCount = state.comments.length - unresolvedCount;
  els.count.textContent = resolvedCount ? `${unresolvedCount}/${state.comments.length}` : String(unresolvedCount);
  els.copy.disabled = unresolvedCount === 0;
  els.clear.disabled = state.comments.length === 0;
  els.hint.style.display = state.comments.length ? "none" : "block";

  els.comments.innerHTML = "";
  if (!state.comments.length) return;

  const { roots, replies } = threadedComments();
  const unresolvedRoots = roots.filter((c) => threadHasUnresolved(c, replies));
  const resolvedRoots = roots.filter((c) => !threadHasUnresolved(c, replies));

  appendCommentSection({
    key: "open",
    title: "Open",
    count: unresolvedCount,
    roots: unresolvedRoots,
    replies,
    open: commentSectionOpen.open,
    emptyText: "Open コメントはありません。",
  });

  if (resolvedCount) {
    appendCommentSection({
      key: "closed",
      title: "Closed",
      count: resolvedCount,
      roots: resolvedRoots,
      replies,
      open: commentSectionOpen.closed,
      emptyText: "Closed コメントはありません。",
    });
  }
}

function appendCommentSection({ key, title, count, roots, replies, open, emptyText }) {
  const section = document.createElement("li");
  section.className = "comment-section collapsible";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "comment-section-head";
  head.innerHTML = `
    <span class="comment-section-caret">${open ? "▾" : "▸"}</span>
    <span class="comment-section-title">${title}</span>
    <span class="comment-section-count">${count}</span>
  `;
  head.addEventListener("click", () => {
    commentSectionOpen[key] = !commentSectionOpen[key];
    saveCommentListState();
    renderComments();
  });
  section.appendChild(head);

  const list = document.createElement("ul");
  list.className = "comment-section-list";
  if (!open) list.hidden = true;
  if (roots.length) {
    roots.forEach((c) => appendThread(list, c, replies));
  } else if (open) {
    const empty = document.createElement("li");
    empty.className = "comment-section-empty";
    empty.textContent = emptyText;
    list.appendChild(empty);
  }
  section.appendChild(list);
  els.comments.appendChild(section);
}

function appendThread(list, c, replies) {
    const li = commentItem(c);
    const threadReplies = replies.get(c.id) || [];
    if (threadReplies.length) {
      const replyList = document.createElement("ul");
      replyList.className = "comment-replies";
      threadReplies.forEach((reply) => replyList.appendChild(commentItem(reply)));
      li.appendChild(replyList);
    }
    list.appendChild(li);
}

function threadHasUnresolved(c, replies) {
  return !c.resolved || (replies.get(c.id) || []).some((reply) => !reply.resolved);
}

function commentItem(c) {
  const i = state.comments.indexOf(c);
  const li = document.createElement("li");
  li.className = "comment" + (c.resolved ? " resolved" : "") + (c.replyTo ? " reply" : "");
  li.dataset.id = c.id;

  const head = document.createElement("div");
  head.className = "comment-head";
  head.innerHTML = `
    <span class="comment-num">${i + 1}</span>
    <span class="comment-kind">${kindLabel(c)}</span>
    ${c.author === "ai" ? '<span class="comment-author-ai" title="AIが追加したコメント">AI</span>' : ""}
    ${c.replyTo ? `<span class="comment-reply" title="#${c.replyTo} への返信">↪ #${c.replyTo}</span>` : ""}
    ${c.resolved ? '<span class="comment-resolved" title="対応済み">✓ 対応済み</span>' : ""}
  `;
  const copyOne = document.createElement("button");
  copyOne.className = "comment-copy";
  copyOne.textContent = "📋";
  copyOne.title = "このコメントだけAIプロンプトとしてコピー";
  copyOne.addEventListener("click", (e) => {
    e.stopPropagation();
    copyText(buildPrompt([c]));
    flashToast(copyOne);
  });
  const edit = document.createElement("button");
  edit.className = "comment-copy";
  edit.textContent = "✎";
  edit.title = "編集";
  edit.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditComposer(c);
  });
  const reply = document.createElement("button");
  reply.className = "comment-copy";
  reply.textContent = "↩";
  reply.title = "返信";
  reply.addEventListener("click", (e) => {
    e.stopPropagation();
    openReplyComposer(c);
  });
  const resolve = document.createElement("button");
  resolve.className = "comment-resolve";
  resolve.textContent = c.resolved ? "再開" : (c.replyTo ? "解決" : "スレッド解決");
  resolve.title = c.resolved ? "未対応に戻す" : "対応済みにする";
  resolve.addEventListener("click", (e) => {
    e.stopPropagation();
    setCommentResolved(c.id, !c.resolved);
  });
  const del = document.createElement("button");
  del.className = "comment-del";
  del.textContent = "🗑";
  del.title = "削除";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteComment(c.id);
  });
  head.appendChild(copyOne);
  head.appendChild(reply);
  head.appendChild(resolve);
  head.appendChild(edit);
  head.appendChild(del);
  li.appendChild(head);

  if (c.quote) {
    const q = document.createElement("div");
    q.className = "comment-quote";
    q.textContent = `“${truncate(c.quote, 160)}”`;
    li.appendChild(q);
  }
  const sel = document.createElement("div");
  sel.className = "comment-sel";
  sel.textContent = c.selector;
  li.appendChild(sel);

  const body = document.createElement("div");
  body.className = "comment-body";
  body.textContent = c.body;
  li.appendChild(body);

  // resolution note left by whoever resolved it (typically the AI)
  if (c.resolved && c.resolutionNote) {
    const note = document.createElement("div");
    note.className = "comment-note";
    note.textContent = `↳ 対応メモ: ${c.resolutionNote}`;
    li.appendChild(note);
  }

  li.addEventListener("click", (e) => {
    e.stopPropagation();
    setActive(c.id);
    adapter?.reveal?.(c);
  });
  li.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    openEditComposer(c);
  });
  return li;
}

function threadedComments() {
  const byId = new Map(state.comments.map((c) => [c.id, c]));
  const roots = [];
  const replies = new Map();
  state.comments.forEach((c) => {
    const root = threadRootOf(c, byId);
    if (root && root.id !== c.id) {
      if (!replies.has(root.id)) replies.set(root.id, []);
      replies.get(root.id).push(c);
    } else {
      roots.push(c);
    }
  });
  return { roots, replies };
}

function threadRootOf(c, byId) {
  let root = c;
  const seen = new Set([c.id]);
  while (root.replyTo && byId.has(root.replyTo) && !seen.has(root.replyTo)) {
    root = byId.get(root.replyTo);
    seen.add(root.id);
  }
  return root;
}

function threadIdsFor(id) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of state.comments) {
      if (c.replyTo && ids.has(c.replyTo) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
    }
  }
  return ids;
}

window.addEventListener("ai-review:comments-updated", (e) => {
  replaceComments(Array.isArray(e.detail) ? e.detail : []);
  renderComments();
  adapter?.relocate?.();
});

function replyTargetOf(c) {
  const { id, body, resolved, resolutionNote, author, replyTo, ...target } = c;
  return target;
}

function kindLabel(c) {
  if (c.kind === "lines") return c.range ? `L${c.range[0]}-L${c.range[1]}` : `L${c.line}`;
  const at = c.mdLine || c.srcLine ? ` · L${c.mdLine || c.srcLine}` : "";
  if (c.kind === "text") return "テキスト" + at;
  if (c.kind === "element") return "要素" + at;
  return c.kind || "";
}

export function setActive(id) {
  document.querySelectorAll(".comment").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.id) === id);
  });
  adapter?.setActive?.(id);
}

// ---------------------------------------------------------------------------
// clear all
els.clear.addEventListener("click", async () => {
  if (!state.comments.length) return;
  const ok = await confirmClearComments(state.comments.length);
  if (!ok) return;
  state.comments = [];
  save();
  renderComments();
  adapter?.relocate?.();
});

function confirmClearComments(count) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "clear-confirm-title");

    const title = document.createElement("h2");
    title.id = "clear-confirm-title";
    title.textContent = "コメントをすべて削除しますか？";

    const message = document.createElement("p");
    message.className = "confirm-message";
    message.textContent = `このファイルのコメント ${count} 件を削除します。この操作は元に戻せません。`;

    const actions = document.createElement("div");
    actions.className = "confirm-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "キャンセル";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "confirm-danger";
    remove.textContent = "削除する";

    actions.appendChild(cancel);
    actions.appendChild(remove);
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const done = (ok) => {
      document.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      resolve(ok);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") done(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(false);
    });
    cancel.addEventListener("click", () => done(false));
    remove.addEventListener("click", () => done(true));
    setTimeout(() => cancel.focus(), 0);
  });
}

// ---------------------------------------------------------------------------
// copy → AI prompt
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function flashToast(btn) {
  const prev = btn.textContent;
  btn.textContent = "✓";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = prev;
    btn.classList.remove("copied");
  }, 1000);
}

els.copy.addEventListener("click", async () => {
  await copyText(buildPrompt(state.comments));
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 1600);
});

// ---------------------------------------------------------------------------
// Prompt templates. The output is a common prompt followed by the selected
// task-specific prompt. Both are plain text with placeholders:
//   {{file}}      → absolute path of the target
//   {{dir}}       → containing directory
//   {{workspace}} → workspace/comment-store root when known
//   {{store}}     → absolute path to .ai-review/comments.json when known
//   {{storeKey}}  → workspace-relative key in comments.json when known
//   {{count}}     → number of comments
//   {{comments}}  → the formatted list of comments (locator + snippet + note)
// The {{comments}} block is generated by formatComments() so every mode
// (HTML/Markdown/source) produces consistent, actionable locators.
export const DEFAULT_COMMON_PROMPT_BODY =
  "## AI Review Comments 共通コンテキスト\n" +
  "- レビュー対象ファイル: `{{file}}`\n" +
  "- 対象ディレクトリ: `{{dir}}`\n" +
  "- 作業ルート: `{{workspace}}`\n" +
  "- コメントストア: `{{store}}`\n" +
  "- コメントストア内キー: `{{storeKey}}`\n\n" +
  "AI Review Comments のレビューコメントを処理する場合は、カレントディレクトリに依存せず、上記の作業ルートとコメントストアを基準にしてください。\n" +
  "コメント確認・対応済み化には、可能なら `--store \"{{store}}\"` と対象ファイルの絶対パスを渡して `ai-review --store \"{{store}}\" pending \"{{file}}\"` / `ai-review --store \"{{store}}\" resolve \"{{file}}\" <id> --note \"...\"` を使ってください。";

export const TEMPLATE_PRESETS = {
  fix: {
    label: "修正を依頼",
    body:
      "以下は `{{file}}` のレビューコメントです（{{count}}件）。各コメントに従ってファイルを修正してください。\n" +
      "対象箇所を特定するための位置情報（セレクタ／行番号など）と、必要に応じて該当箇所の内容を記載しています。\n\n" +
      "対象が生成HTML等の場合は、直接編集する前に元ファイル（OpenAPI YAML / Markdown 等）と再生成手順を確認し、元ファイルがある場合はそちらを修正して再ビルドしてください。\n\n" +
      "{{comments}}\n\n" +
      "---\n" +
      "修正後は、変更箇所と変更理由を簡潔に説明してください。" +
      "位置情報が複数箇所にマッチする場合は、コメントの意図に最も合う箇所を選んでください。",
  },
  question: {
    label: "質問する",
    body:
      "以下は `{{file}}` に対する質問・確認事項です（{{count}}件）。\n" +
      "それぞれの箇所について、質問に回答してください。修正はまだ行わず、まず説明と提案をお願いします。\n" +
      "AI Review Comments のコメント機能が使える環境では、回答を各コメントIDへの返信として残してください。使えない場合は、各回答に `返信先: #ID` を明記してください。\n\n" +
      "{{comments}}\n\n" +
      "---\n" +
      "不明点があれば質問し返してください。",
  },
  review: {
    label: "レビュー観点で意見",
    body:
      "以下は `{{file}}` のレビューコメントです（{{count}}件）。\n" +
      "各箇所について、指摘の妥当性・代替案・潜在的な問題を、レビュアーの視点で評価してください。\n\n" +
      "{{comments}}\n\n" +
      "---\n" +
      "総合的な所感と、優先して対応すべき項目があれば最後にまとめてください。",
  },
  plain: {
    label: "コメントのみ（指示文なし）",
    body: "{{file}}（{{count}}件）\n\n{{comments}}",
  },
};

export const DEFAULT_TEMPLATE_KEY = "fix";

// active prompt state (restored from localStorage in init)
export const commonPrompt = { body: null };
export const template = { key: DEFAULT_TEMPLATE_KEY, customBody: null };

function commonPromptStorageKey() {
  return "review:commonPrompt"; // global, not per-file
}
function templateStorageKey() {
  return "review:template"; // global, not per-file
}
export function loadCommonPrompt() {
  try {
    const raw = localStorage.getItem(commonPromptStorageKey());
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved.body === "string") commonPrompt.body = saved.body;
    }
  } catch {}
}
export function saveCommonPrompt() {
  try {
    localStorage.setItem(commonPromptStorageKey(), JSON.stringify(commonPrompt));
  } catch {}
}
export function loadTemplate() {
  try {
    const raw = localStorage.getItem(templateStorageKey());
    if (raw) {
      const t = JSON.parse(raw);
      if (t.key) template.key = t.key;
      if (typeof t.customBody === "string") template.customBody = t.customBody;
    }
  } catch {}
}
export function saveTemplate() {
  try {
    localStorage.setItem(templateStorageKey(), JSON.stringify(template));
  } catch {}
}
// The currently-effective prompt bodies.
export function currentCommonPromptBody() {
  return commonPrompt.body ?? DEFAULT_COMMON_PROMPT_BODY;
}
export function currentTemplateBody() {
  if (template.key === "custom") return template.customBody || "";
  return TEMPLATE_PRESETS[template.key]?.body || TEMPLATE_PRESETS[DEFAULT_TEMPLATE_KEY].body;
}

function promptValue(value) {
  return value || "未設定";
}

export function fillPromptPlaceholders(body, list, emptyComments = "") {
  const fullPath = state.meta.path || state.meta.file || "the file";
  const dir = state.meta.dir || "";
  const workspace = state.meta.workspaceRoot || "";
  const storePath = state.meta.storePath || "";
  const storeKey = state.meta.storeKey || state.meta.file || "";
  const comments = list.length ? formatComments(list) : emptyComments;
  return String(body || "")
    .replace(/\{\{\s*file\s*\}\}/g, promptValue(fullPath))
    .replace(/\{\{\s*dir\s*\}\}/g, promptValue(dir))
    .replace(/\{\{\s*workspace\s*\}\}/g, promptValue(workspace))
    .replace(/\{\{\s*store\s*\}\}/g, promptValue(storePath))
    .replace(/\{\{\s*storeKey\s*\}\}/g, promptValue(storeKey))
    .replace(/\{\{\s*count\s*\}\}/g, String(list.length))
    .replace(/\{\{\s*comments\s*\}\}/g, comments);
}

export function composePrompt(commonBody, templateBody, list, emptyComments = "") {
  return [
    fillPromptPlaceholders(commonBody, list, emptyComments).trim(),
    fillPromptPlaceholders(templateBody, list, emptyComments).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Format one comment into its locator + snippet + note block.
function formatComment(c, index, total) {
  const fullPath = state.meta.path || state.meta.file || "the file";
  const single = total === 1;
  const out = [];
  out.push(single ? `## コメント` : `## コメント ${index + 1}`);
  out.push(`- コメントID: \`#${c.id}\``);
  out.push(`- 対象ファイル: \`${fullPath}\``);
  if (c.replyTo) out.push(`- 返信先: \`#${c.replyTo}\``);
  if (c.kind === "lines") {
    const ref = c.range ? `L${c.range[0]}-L${c.range[1]}` : `L${c.line}`;
    out.push(`- 対象行: \`${ref}\``);
    if (c.path) out.push(`- データパス: \`${c.path}\``);
    if (c.snippet) {
      out.push("- 該当箇所:");
      out.push("```" + (state.meta.lang || ""));
      out.push(c.snippet);
      out.push("```");
    }
  } else if (c.mdLine) {
    out.push(`- 対象行(Markdown): \`L${c.mdLine}\``);
    if (c.quote) out.push(`- 対象テキスト: 「${c.quote}」`);
  } else {
    out.push(`- 対象セレクタ: \`${c.selector}\``);
    if (c.srcLine) out.push(`- 対象行: \`L${c.srcLine}\``);
    if (c.kind === "text" && c.quote) out.push(`- 対象テキスト: 「${c.quote}」`);
    if (c.kind === "element" && c.snippet) {
      out.push("- 該当HTML:");
      out.push("```html");
      out.push(c.snippet);
      out.push("```");
    }
  }
  out.push(`- 指摘 / 修正指示:`);
  out.push(`  ${String(c.body ?? "").replace(/\n/g, "\n  ")}`);
  return out.join("\n");
}

export function formatComments(list) {
  return list.map((c, i) => formatComment(c, i, list.length)).join("\n\n");
}

// Build an AI prompt for a subset (all, or one) by filling the active template.
// Resolved comments are excluded — they're already handled.
export function buildPrompt(subset) {
  let list = subset && subset.length ? subset : state.comments;
  list = list.filter((c) => !c.resolved);
  return composePrompt(currentCommonPromptBody(), currentTemplateBody(), list);
}

export function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Escape text for safe insertion into HTML (used by adapters building markup).
export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The source line range a comment refers to, if any — so the source view can
// show preview-made comments inline too. Returns [start, end] or null.
// - line comments carry .line / .range
// - preview comments carry .mdLine (Markdown) or .srcLine (HTML), set by render
export function lineRangeOf(c) {
  if (c.kind === "lines") {
    return c.range ? [c.range[0], c.range[1]] : [c.line, c.line];
  }
  const n = c.mdLine || c.srcLine;
  return n ? [n, n] : null;
}
