// Browser review server: `ai-review open <file>` serves the same review UI the
// VS Code extension uses (webview/ — plain ESM, no build step) on localhost and
// opens it in the default browser. Comments persist to the shared
// .ai-review/comments.json store, and external changes (CLI / AI agent) are
// pushed to the page live over SSE. Ported from the original html-comment-tool
// server (deferred shutdown, port fallback, target-dir asset serving).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { renderPreview, previewKindFor, langFor } from "../shared/render.mjs";
import { findRoot, keyFor } from "../shared/store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBVIEW_DIR = existsSync(resolve(__dirname, "..", "webview"))
  ? resolve(__dirname, "..", "webview")
  : resolve(__dirname, "..", "dist", "webview");

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

// resolved path must stay inside root (no traversal)
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const joined = resolve(root, "." + decoded);
  if (joined !== root && !joined.startsWith(root + sep)) return null;
  return joined;
}

export async function serve({ file, port = 4900, open = true, keepAlive = false }) {
  const targetPath = resolve(process.cwd(), file);
  try {
    const s = await stat(targetPath);
    if (!s.isFile()) throw new Error("not a file");
  } catch {
    console.error(`✗ ファイルが読めません: ${targetPath}`);
    process.exit(1);
  }

  const root = findRoot(dirname(targetPath));
  const key = keyFor(root, targetPath);
  const targetDir = dirname(targetPath);
  const previewKind = previewKindFor(targetPath);
  const meta = {
    file: key.split("/").pop(),
    path: targetPath,
    dir: targetDir,
    previewKind,
    defaultView: previewKind === "none" ? "source" : "preview",
    lang: langFor(targetPath),
  };
  const buildBoot = async () => {
    const source = await readFile(targetPath, "utf8").catch(() => "");
    const previewHtml = renderPreview(targetPath, source);
    return {
      meta,
      source,
      previewHtml,
      extensionVersion: "browser",
      loadedAt: new Date().toISOString(),
    };
  };

  // deferred shutdown: tab close schedules an exit; any new request cancels it
  let shutdownTimer = null;
  const cancelShutdown = () => {
    if (shutdownTimer) clearTimeout(shutdownTimer), (shutdownTimer = null);
  };

  const server = createServer(async (req, res) => {
    const url = req.url || "/";
    if (url !== "/__bye") cancelShutdown();

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(pageHtml(await buildBoot()));
    }
    if (url === "/__boot") {
      res.writeHead(200, { "content-type": MIME[".json"] });
      return res.end(JSON.stringify(await buildBoot()));
    }
    if (url === "/__meta") {
      res.writeHead(200, { "content-type": MIME[".json"] });
      return res.end(JSON.stringify(meta));
    }
    if (url === "/__source") {
      const text = await readFile(targetPath, "utf8").catch(() => "");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(text);
    }
    if (url === "/target" || url === "/target/") {
      const text = await readFile(targetPath, "utf8").catch(() => "");
      const html = renderPreview(targetPath, text);
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(html ?? text);
    }
    if (url === "/__bye") {
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
        res.writeHead(200, { "content-type": mimeFor(p) });
        return res.end(await readFile(p));
      }
    }

    // fallback: serve the target's directory so the HTML preview's relative
    // assets (css/images) keep working
    const filePath = safeJoin(targetDir, url);
    if (filePath && existsSync(filePath)) {
      res.writeHead(200, { "content-type": mimeFor(filePath) });
      return res.end(await readFile(filePath));
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
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
    const link = `http://127.0.0.1:${actualPort}/`;
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

// The same DOM skeleton the extension's webview uses, plus a small browser
// bridge: reload requests fresh BootData; tab close notifies /__bye.
// Comments are intentionally session-only and disappear on reload/reopen.
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
          <button id="view-preview" class="seg-btn" title="レンダリング結果を表示">👁 プレビュー</button>
          <button id="view-source" class="seg-btn" title="生のソースを行番号付きで表示">&lt;&gt; ソース</button>
        </div>
        <span class="spacer"></span>
        <button id="mode-element" class="mode-btn" title="要素をクリックしてコメント">⬚ 要素</button>
        <button id="mode-text" class="mode-btn active" title="テキストをドラッグ選択してコメント">✎ テキスト</button>
        <button id="mode-off" class="mode-btn" title="選択を無効化してページを普通に操作">✋ 操作</button>
        <button id="reload-view" class="icon-btn" title="プレビューを再読み込み">⟳</button>
        <button id="open-settings" class="icon-btn" title="設定（プロンプトテンプレート）">⚙</button>
        <button id="toggle-panel" class="icon-btn" title="コメントパネルを開閉">⟩</button>
      </div>
      <div id="frame-wrap"></div>
    </main>
    <div id="resizer" title="ドラッグで幅を調整"></div>
    <aside id="panel">
      <header>
        <h1>コメント</h1><span id="count" class="badge">0</span>
        <span class="spacer"></span>
        <button id="collapse-panel" class="icon-btn" title="パネルを隠す">⟩</button>
      </header>
      <div id="hint" class="hint">左の<strong>要素や行をクリック</strong>、または<strong>範囲をドラッグ</strong>するとコメントを追加できます。</div>
      <ul id="comments"></ul>
      <footer>
        <button id="copy" class="primary" disabled>📋 AIプロンプトをコピー</button>
        <button id="clear" class="ghost" disabled>すべて削除</button>
        <div id="copied-toast" class="toast">コピーしました</div>
      </footer>
    </aside>
  </div>

  <button id="show-panel" class="show-panel hidden">⟨ コメント</button>

  <div id="settings" class="drawer hidden">
    <div class="drawer-head"><h2>設定 — AIプロンプトテンプレート</h2><button id="settings-close" class="icon-btn" title="閉じる">✕</button></div>
    <div class="drawer-body">
      <label class="field-label">テンプレート</label>
      <select id="template-select"></select>
      <p class="field-help">プロンプトの口調・目的を選びます。本文を編集すると「カスタム」として保存されます。</p>
      <label class="field-label">本文テンプレート</label>
      <textarea id="template-body" rows="10" spellcheck="false"></textarea>
      <div class="field-vars">変数: <code>{{file}}</code> <code>{{comments}}</code> <code>{{count}}</code></div>
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
        BOOT = await fetch("/__boot").then((r) => r.json());
        window.__AI_REVIEW_BOOT__ = BOOT;
        window.__PREVIEW_HTML__ = BOOT.previewHtml || "";
        window.dispatchEvent(new CustomEvent("ai-review:reload", { detail: BOOT }));
      },
    };

    // tell the server when the tab goes away (difit-style shutdown)
    window.addEventListener("pagehide", () => {
      try { navigator.sendBeacon("/__bye"); } catch {}
    });
  </script>
  <script type="module" src="/boot.js"></script>
</body>
</html>`;
}
