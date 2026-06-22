// Browser review server: `ai-review open <file>` serves the same review UI the
// VS Code extension uses (webview/ — plain ESM, no build step) on localhost and
// opens it in the default browser. Comments persist to the shared
// .ai-review/comments.json store, and external changes (CLI / AI agent) are
// pushed to the page live over SSE. Ported from the original html-comment-tool
// server (deferred shutdown, port fallback, target-dir asset serving).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, watch, readFileSync } from "node:fs";
import { resolve, dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { renderPreview, previewKindFor, langFor } from "../shared/render.mjs";
import { findRoot, keyFor, readStoreSync, rootForStorePath, storePathFor, writeStoreSync } from "../shared/store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBVIEW_DIR = existsSync(resolve(__dirname, "..", "webview"))
  ? resolve(__dirname, "..", "webview")
  : resolve(__dirname, "..", "dist", "webview");
// show the real package version in the badge (not a placeholder "browser")
const PKG_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8")).version || "dev";
  } catch {
    return "dev";
  }
})();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const mimeFor = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "pragma": "no-cache",
  "expires": "0",
};
const headers = (contentType, extra = {}) => ({
  "content-type": contentType,
  ...NO_STORE,
  ...extra,
});

// resolved path must stay inside root (no traversal)
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const joined = resolve(root, "." + decoded);
  if (joined !== root && !joined.startsWith(root + sep)) return null;
  return joined;
}

export async function serve({ file, port = 4900, open = true, keepAlive = false, root: rootOption, store }) {
  const targetPath = resolve(process.cwd(), file);
  try {
    const s = await stat(targetPath);
    if (!s.isFile()) throw new Error("not a file");
  } catch {
    console.error(`✗ ファイルが読めません: ${targetPath}`);
    process.exit(1);
  }

  const explicitStorePath = store ? resolve(store) : null;
  const root = explicitStorePath
    ? rootForStorePath(explicitStorePath)
    : rootOption
      ? resolve(rootOption)
      : findRoot(dirname(targetPath));
  const commentStorePath = explicitStorePath ?? storePathFor(root);
  const key = keyFor(root, targetPath);
  const targetDir = dirname(targetPath);
  const previewKind = previewKindFor(targetPath);
  const meta = {
    file: key.split("/").pop(),
    path: targetPath,
    dir: targetDir,
    workspaceRoot: root,
    storePath: commentStorePath,
    storeKey: key,
    previewKind,
    defaultView: previewKind === "none" ? "source" : "preview",
    lang: langFor(targetPath),
  };
  const buildBoot = async () => {
    const source = await readFile(targetPath, "utf8").catch(() => "");
    const previewHtml = await renderPreview(targetPath, source);
    return {
      meta,
      source,
      previewHtml,
      extensionVersion: PKG_VERSION,
      loadedAt: new Date().toISOString(),
    };
  };
  const commentsForFile = () => readStoreSync(root, commentStorePath).files[key]?.comments ?? [];
  const writeCommentsForFile = (comments) => {
    const nextStore = readStoreSync(root, commentStorePath);
    if (comments.length) nextStore.files[key] = { comments };
    else delete nextStore.files[key];
    writeStoreSync(root, nextStore, commentStorePath);
  };

  // deferred shutdown: tab close schedules an exit; any new request cancels it
  let shutdownTimer = null;
  const cancelShutdown = () => {
    if (shutdownTimer) clearTimeout(shutdownTimer), (shutdownTimer = null);
  };

  const eventClients = new Set();
  let notifyTimer = null;
  const notifyChanged = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      const data = JSON.stringify({ loadedAt: new Date().toISOString() });
      for (const client of eventClients) {
        client.write(`event: changed\ndata: ${data}\n\n`);
      }
    }, 100);
  };
  const fileWatcher = watch(targetPath, { persistent: false }, notifyChanged);
  let storeWatcher = null;
  if (existsSync(commentStorePath)) {
    storeWatcher = watch(commentStorePath, { persistent: false }, () => {
      for (const client of eventClients) client.write("event: comments\ndata: {}\n\n");
    });
  }

  const server = createServer(async (req, res) => {
    const url = req.url || "/";
    const pathname = url.split("?")[0];
    if (url !== "/__bye") cancelShutdown();

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, headers(MIME[".html"]));
      return res.end(pageHtml(await buildBoot()));
    }
    if (pathname === "/__boot") {
      res.writeHead(200, headers(MIME[".json"]));
      return res.end(JSON.stringify(await buildBoot()));
    }
    if (pathname === "/__meta") {
      res.writeHead(200, headers(MIME[".json"]));
      return res.end(JSON.stringify(meta));
    }
    if (pathname === "/__source") {
      const text = await readFile(targetPath, "utf8").catch(() => "");
      res.writeHead(200, headers("text/plain; charset=utf-8"));
      return res.end(text);
    }
    if (pathname === "/__open-external") {
      if (req.method !== "POST") {
        res.writeHead(405, headers("text/plain; charset=utf-8"));
        return res.end("Method Not Allowed");
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (typeof body.url !== "string" || !body.url) throw new Error("url is required");
          if (!isAllowedExternalUrl(body.url)) throw new Error("unsupported link scheme");
          openBrowser(body.url);
          res.writeHead(200, headers(MIME[".json"]));
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.writeHead(400, headers(MIME[".json"]));
          res.end(JSON.stringify({ ok: false, error: error.message || String(error) }));
        }
      });
      return;
    }
    if (pathname === "/__comments") {
      if (req.method === "GET") {
        res.writeHead(200, headers(MIME[".json"]));
        return res.end(JSON.stringify({ comments: commentsForFile() }));
      }
      if (req.method === "POST") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const comments = Array.isArray(body.comments) ? body.comments : [];
            writeCommentsForFile(comments);
            res.writeHead(200, headers(MIME[".json"]));
            res.end(JSON.stringify({ ok: true }));
            for (const client of eventClients) client.write("event: comments\ndata: {}\n\n");
          } catch (error) {
            res.writeHead(400, headers(MIME[".json"]));
            res.end(JSON.stringify({ ok: false, error: error.message || String(error) }));
          }
        });
        return;
      }
      res.writeHead(405, headers("text/plain; charset=utf-8"));
      return res.end("Method Not Allowed");
    }
    if (pathname === "/target" || pathname === "/target/") {
      const text = await readFile(targetPath, "utf8").catch(() => "");
      const html = await renderPreview(targetPath, text);
      res.writeHead(200, headers(MIME[".html"]));
      return res.end(html ?? text);
    }
    if (pathname === "/__events") {
      res.writeHead(200, headers("text/event-stream; charset=utf-8", {
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      }));
      res.write("event: ready\ndata: {}\n\n");
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }
    if (pathname === "/__bye") {
      res.writeHead(204);
      res.end();
      if (!keepAlive) {
        cancelShutdown();
        shutdownTimer = setTimeout(() => {
          console.log("\n  ブラウザが閉じられたので終了します（--keep-alive で常駐できます）\n");
          process.exit(0);
        }, 1500);
      }
      return;
    }

    // the review UI's own modules
    const uiAsset = url.match(/^\/([\w-]+\.(?:js|mjs|css))$/);
    if (uiAsset) {
      const p = join(WEBVIEW_DIR, uiAsset[1] === "styles.css" ? "styles.css" : uiAsset[1]);
      if (existsSync(p)) {
        res.writeHead(200, headers(mimeFor(p)));
        return res.end(await readFile(p));
      }
    }

    // fallback: serve the target's directory so the HTML preview's relative
    // assets (css/images) keep working
    const filePath = safeJoin(targetDir, pathname);
    if (filePath && existsSync(filePath)) {
      res.writeHead(200, headers(mimeFor(filePath)));
      return res.end(await readFile(filePath));
    }
    res.writeHead(404, headers("text/plain; charset=utf-8"));
    res.end("404 Not Found");
  });
  server.on("close", () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    fileWatcher.close();
    storeWatcher?.close();
  });

  // try the port; walk forward if busy
  let attempts = 0;
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempts < 20) {
      attempts++;
      server.listen(port + attempts, "127.0.0.1");
    } else {
      console.error(`✗ サーバを起動できません: ${err.message}`);
      process.exit(1);
    }
  });
  server.on("listening", () => {
    const actualPort = server.address().port;
    const link = `http://127.0.0.1:${actualPort}/?t=${Date.now()}`;
    console.log(`\n  ai-review  ▸ ${key}`);
    console.log(`  open       ▸ ${link}`);
    if (keepAlive) console.log(`  keep-alive ▸ on`);
    console.log(`\n  Ctrl+C で終了\n`);
    if (open) openBrowser(link);
  });
  server.listen(port, "127.0.0.1");
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  child.on("error", () => {});
  child.unref();
}

function isAllowedExternalUrl(url) {
  try {
    return ["http:", "https:", "mailto:", "file:", "tel:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// The same DOM skeleton the extension's webview uses, plus a small browser
// bridge: reload requests fresh BootData; tab close notifies /__bye.
// Preview HTML is regenerated on reload; comments persist via .ai-review only.
function pageHtml(boot) {
  const meta = boot.meta;
  const injected = JSON.stringify(boot).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Review — ${meta.file}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app">
    <main id="stage">
      <div id="toolbar">
        <span id="file-label">…</span>
        <span id="extension-version" class="version-badge" title="AI Review Comments version">…</span>
        <div id="view-toggle" class="seg" hidden>
          <button id="view-preview" class="seg-btn" title="レンダリング結果を表示">プレビュー</button>
          <button id="view-source" class="seg-btn" title="生のソースを行番号付きで表示">ソース</button>
        </div>
        <span class="spacer"></span>
        <div class="toolbar-group" role="group" aria-label="コメントモード">
          <button id="mode-element" class="mode-btn" title="要素をクリックしてコメント">要素</button>
          <button id="mode-text" class="mode-btn active" title="テキストをドラッグ選択してコメント">テキスト</button>
          <button id="mode-off" class="mode-btn" title="コメント操作を無効化し、リンク・選択・ショートカットなど通常のページ操作を優先">操作</button>
        </div>
        <span class="toolbar-sep"></span>
        <button id="reload-view" class="icon-btn" title="プレビューを再読み込み" aria-label="再読み込み"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.4 3.4V7H10.8"/></svg></button>
        <button id="open-settings" class="icon-btn" title="設定（プロンプトテンプレート）" aria-label="設定"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="2.3"/><path d="M9 1.6v2.2M9 14.2v2.2M16.4 9h-2.2M3.8 9H1.6M14.2 3.8l-1.55 1.55M5.35 12.65 3.8 14.2M14.2 14.2l-1.55-1.55M5.35 5.35 3.8 3.8"/></svg></button>
        <button id="toggle-panel" class="icon-btn" title="コメントパネルを開閉" aria-label="コメントパネルを開閉"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5-5 5"/></svg></button>
      </div>
      <div id="frame-wrap"></div>
    </main>
    <div id="resizer" title="ドラッグで幅を調整"></div>
    <aside id="panel">
      <header>
        <h1>コメント</h1><span id="count" class="badge">0</span>
        <span class="spacer"></span>
        <button id="collapse-panel" class="icon-btn" title="パネルを隠す" aria-label="パネルを隠す"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5-5 5"/></svg></button>
      </header>
      <div id="hint" class="hint"><span>左の<strong>要素や行をクリック</strong>、または<strong>範囲をドラッグ</strong>すると<br>コメントを追加できます。</span></div>
      <ul id="comments"></ul>
      <footer>
        <button id="copy" class="primary" disabled>AIプロンプトをコピー</button>
        <button id="clear" class="ghost" disabled>すべて削除</button>
        <div id="copied-toast" class="toast">コピーしました</div>
      </footer>
    </aside>
  </div>

  <button id="show-panel" class="show-panel hidden"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4 6 9l5 5"/></svg> コメント</button>

  <div id="settings" class="drawer hidden">
    <div class="drawer-head"><h2>設定 — AIプロンプトテンプレート</h2><button id="settings-close" class="icon-btn" title="閉じる" aria-label="閉じる"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l8 8M13 5l-8 8"/></svg></button></div>
    <div class="drawer-body">
      <label class="field-label">共通プロンプト</label>
      <p class="field-help">すべてのAIプロンプトの先頭に入る共通コンテキストです。作業ルートやコメントストアなど、個別指示から独立した情報を管理します。</p>
      <textarea id="common-prompt-body" rows="9" spellcheck="false"></textarea>
      <div class="field-vars">変数: <code>{{file}}</code> <code>{{dir}}</code> <code>{{workspace}}</code> <code>{{store}}</code> <code>{{storeKey}}</code> <code>{{count}}</code> <code>{{comments}}</code></div>
      <div class="drawer-actions"><button id="common-prompt-reset" class="ghost">共通プロンプトを既定に戻す</button><button id="common-prompt-save" class="primary">共通プロンプトを保存</button></div>
      <label class="field-label">個別テンプレート</label>
      <select id="template-select"></select>
      <p class="field-help">プロンプトの口調・目的を選びます。本文を編集すると「カスタム」として保存されます。</p>
      <label class="field-label">個別プロンプト本文</label>
      <textarea id="template-body" rows="10" spellcheck="false"></textarea>
      <div class="field-vars">変数: <code>{{file}}</code> <code>{{dir}}</code> <code>{{workspace}}</code> <code>{{store}}</code> <code>{{storeKey}}</code> <code>{{comments}}</code> <code>{{count}}</code></div>
      <div class="drawer-actions"><button id="template-reset" class="ghost">プリセットに戻す</button><button id="template-save" class="primary">保存</button></div>
      <div class="drawer-preview-wrap"><label class="field-label">プレビュー</label><pre id="template-preview" class="drawer-preview"></pre></div>
    </div>
  </div>
  <div id="settings-backdrop" class="backdrop hidden"></div>

  <div id="composer" class="composer hidden">
    <div class="composer-target" id="composer-target"></div>
    <textarea id="composer-input" rows="3" placeholder="この箇所への指摘・修正指示を書く…"></textarea>
    <div class="composer-actions"><button id="composer-cancel" class="ghost">キャンセル</button><button id="composer-save" class="primary">追加 (⌘/Ctrl+Enter)</button></div>
  </div>

  <script>
    let BOOT = ${injected};
    window.__AI_REVIEW_BOOT__ = BOOT;
    if (BOOT.previewHtml) window.__PREVIEW_HTML__ = BOOT.previewHtml;
    window.aiReviewHost = {
      reload: async () => {
        BOOT = await fetch("/__boot?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
        window.__AI_REVIEW_BOOT__ = BOOT;
        window.__PREVIEW_HTML__ = BOOT.previewHtml || "";
        window.dispatchEvent(new CustomEvent("ai-review:reload", { detail: BOOT }));
      },
      openExternal: async (url) => {
        const res = await fetch("/__open-external", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "リンクを開けませんでした");
      },
      loadComments: async () => {
        const data = await fetch("/__comments?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
        return data.comments || [];
      },
      saveComments: async (comments) => {
        const res = await fetch("/__comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comments }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "コメントを保存できませんでした");
      },
    };

    if (window.EventSource) {
      const events = new EventSource("/__events");
      let reloadTimer = null;
      events.addEventListener("changed", () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => window.aiReviewHost.reload(), 100);
      });
      events.addEventListener("comments", async () => {
        const comments = await window.aiReviewHost.loadComments();
        window.dispatchEvent(new CustomEvent("ai-review:comments-updated", { detail: comments }));
      });
      window.addEventListener("pagehide", () => events.close());
    }

    // tell the server when the tab goes away (difit-style shutdown)
    window.addEventListener("pagehide", () => {
      try { navigator.sendBeacon("/__bye"); } catch {}
    });
  </script>
  <script type="module" src="/boot.js"></script>
</body>
</html>`;
}
