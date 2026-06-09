import * as vscode from "vscode";
import * as path from "node:path";
import type { BootData, ReviewMeta, WebviewMessage, PersistedComments } from "./types.js";
import { previewKindFor, langFor, renderPreview } from "./render/index.js";
import {
  workspaceRootFor,
  storeKeyFor,
  storeUri,
  readComments,
  writeComments,
  migrateFromWorkspaceState,
  STORE_DIR,
  STORE_FILE,
} from "./store.js";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiReviewComments.review", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage("レビューするファイルを選択してください。");
        return;
      }
      await openReview(context, target);
    })
  );
}

export function deactivate() {}

async function openReview(context: vscode.ExtensionContext, fileUri: vscode.Uri) {
  const fsPath = fileUri.fsPath;
  const fileName = path.basename(fsPath);

  const panel = vscode.window.createWebviewPanel(
    "aiReviewComments",
    `Review: ${fileName}`,
    // open as a tab in the active editor group (not a split pane)
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    }
  );

  let source = "";
  try {
    source = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf8");
  } catch {
    source = "";
  }

  const previewHtml = renderPreview(fsPath, source);
  const previewKind = previewHtml ? previewKindFor(fsPath) : "none";

  const meta: ReviewMeta = {
    file: fileName,
    path: fsPath,
    dir: path.dirname(fsPath),
    previewKind,
    defaultView: previewKind === "none" ? "source" : "preview",
    lang: langFor(fsPath),
  };

  // Comments live in <workspace>/.ai-review/comments.json so AI agents and the
  // CLI can read/write them too. Outside a workspace, fall back to
  // workspaceState (no external sharing possible there).
  const root = workspaceRootFor(fileUri);
  const key = root ? storeKeyFor(root, fileUri) : null;
  let saved: PersistedComments | null = null;
  if (root && key) {
    await migrateFromWorkspaceState(context, root, key, fsPath);
    const comments = await readComments(root, key);
    saved = comments.length ? { path: fsPath, comments } : null;
  } else {
    saved = context.workspaceState.get<PersistedComments | null>("review:" + fsPath, null);
  }

  const boot: BootData = { meta, source, saved, previewHtml };
  panel.webview.html = buildHtml(context, panel.webview, boot);

  // remember what we last wrote so the watcher can ignore our own writes
  let lastWritten = "";

  panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    if (msg.type === "save") {
      if (root && key) {
        lastWritten = await writeComments(root, key, msg.payload.comments ?? []);
      } else {
        await context.workspaceState.update("review:" + fsPath, msg.payload);
      }
    } else if (msg.type === "copy") {
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.showInformationMessage("AIプロンプトをコピーしました。");
    } else if (msg.type === "reveal" && typeof msg.line === "number") {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(Math.max(0, msg.line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  });

  // Watch the store file: when the CLI / an AI agent adds or resolves comments,
  // push the new list into the open panel immediately.
  if (root && key) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, `${STORE_DIR}/${STORE_FILE}`)
    );
    const onStoreChange = async () => {
      let raw = "";
      try {
        raw = Buffer.from(await vscode.workspace.fs.readFile(storeUri(root))).toString("utf8");
      } catch {
        /* deleted → treat as empty */
      }
      if (raw === lastWritten) return; // our own write echoing back
      const comments = await readComments(root, key);
      panel.webview.postMessage({ type: "comments", comments });
    };
    watcher.onDidChange(onStoreChange);
    watcher.onDidCreate(onStoreChange);
    watcher.onDidDelete(onStoreChange);
    panel.onDidDispose(() => watcher.dispose());
  }
}

function buildHtml(context: vscode.ExtensionContext, webview: vscode.Webview, boot: BootData): string {
  const asset = (f: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", f));

  // CSP: webview assets + inline bootstrap; srcdoc preview iframe (frame-src);
  // https for the Markdown preview's mermaid ESM from cdn.jsdelivr.net.
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline' https:`,
    `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https:`,
    `font-src ${webview.cspSource} https: data:`,
    `connect-src ${webview.cspSource} https:`,
    `frame-src 'self' data:`,
  ].join("; ");

  const injected = JSON.stringify(boot).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset("styles.css")}">
</head>
<body>
  <div id="app">
    <main id="stage">
      <div id="toolbar">
        <span id="file-label">…</span>
        <div id="view-toggle" class="seg" hidden>
          <button id="view-preview" class="seg-btn" title="レンダリング結果を表示">👁 プレビュー</button>
          <button id="view-source" class="seg-btn" title="生のソースを行番号付きで表示">&lt;&gt; ソース</button>
        </div>
        <span class="spacer"></span>
        <button id="mode-element" class="mode-btn active" title="要素をクリックしてコメント">⬚ 要素</button>
        <button id="mode-text" class="mode-btn" title="テキストをドラッグ選択してコメント">✎ テキスト</button>
        <button id="mode-off" class="mode-btn" title="選択を無効化してページを普通に操作">✋ 操作</button>
        <button id="reload-view" class="icon-btn" title="プレビューを再読み込み（リンクで遷移してしまったとき等）">⟳</button>
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
    // host bridge: the webview UI talks to the extension instead of an HTTP server
    const vscode = acquireVsCodeApi();
    const BOOT = ${injected};
    if (BOOT.previewHtml) window.__PREVIEW_HTML__ = BOOT.previewHtml;

    const _ls = {};
    if (BOOT.saved) _ls["review:" + BOOT.meta.path] = JSON.stringify(BOOT.saved);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k) => (k in _ls ? _ls[k] : null),
        setItem: (k, v) => {
          _ls[k] = v;
          if (k === "review:" + BOOT.meta.path) {
            try { vscode.postMessage({ type: "save", payload: JSON.parse(v) }); } catch {}
          }
        },
        removeItem: (k) => { delete _ls[k]; },
      },
    });

    const _rf = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u === "/__meta") return Promise.resolve(new Response(JSON.stringify(BOOT.meta), { headers: { "content-type": "application/json" } }));
      if (u === "/__source") return Promise.resolve(new Response(BOOT.source, { headers: { "content-type": "text/plain" } }));
      return _rf ? _rf(url, opts) : Promise.reject(new Error("blocked: " + u));
    };

    if (!navigator.clipboard) navigator.clipboard = {};
    navigator.clipboard.writeText = (t) => { vscode.postMessage({ type: "copy", text: t }); return Promise.resolve(); };

    // host → webview: external comment updates (CLI / AI agent edited the
    // store file). Relayed to the UI as a DOM event the core engine listens to.
    window.addEventListener("message", (e) => {
      const m = e.data;
      if (m && m.type === "comments" && Array.isArray(m.comments)) {
        _ls["review:" + BOOT.meta.path] = JSON.stringify({ path: BOOT.meta.path, comments: m.comments });
        window.dispatchEvent(new CustomEvent("ai-review:comments", { detail: m.comments }));
      }
    });
  </script>
  <script type="module" src="${asset("boot.js")}"></script>
</body>
</html>`;
}
