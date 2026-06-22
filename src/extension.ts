import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { BootData, ReviewMeta, WebviewMessage } from "./types.js";
import { previewKindFor, langFor, renderPreview } from "./render/index.js";
import { readComments, storeKeyFor, storeUri, workspaceRootFor, writeComments } from "./store.js";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiReviewComments.review", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage("レビューするファイルを選択してください。");
        return;
      }
      await openReviewWithConfiguredTarget(context, target);
    }),
    vscode.commands.registerCommand("aiReviewComments.reviewInBrowser", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage("レビューするファイルを選択してください。");
        return;
      }
      await openReviewInBrowser(context, target);
    })
  );
}

export function deactivate() {}

async function openReviewWithConfiguredTarget(context: vscode.ExtensionContext, fileUri: vscode.Uri) {
  const configured = vscode.workspace
    .getConfiguration("aiReviewComments")
    .get<"vscode" | "browser" | "ask">("openTarget", "vscode");

  let target = configured;
  if (configured === "ask") {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "VS Code内で開く", value: "vscode" as const },
        { label: "ブラウザで開く", value: "browser" as const },
      ],
      { placeHolder: "AI Review Comments をどこで開きますか？" }
    );
    if (!picked) return;
    target = picked.value;
  }

  if (target === "browser") {
    await openReviewInBrowser(context, fileUri);
  } else {
    await openReview(context, fileUri);
  }
}

async function openReviewInBrowser(context: vscode.ExtensionContext, fileUri: vscode.Uri) {
  const cliPath = path.join(context.extensionPath, "cli", "ai-review.mjs");
  const cwd = workspaceRootFor(fileUri)?.fsPath ?? path.dirname(fileUri.fsPath);
  const child = spawn(process.execPath, [cliPath, "open", fileUri.fsPath], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    vscode.window.showErrorMessage(`ブラウザ表示を起動できませんでした: ${error.message}`);
  });
  child.unref();
  vscode.window.showInformationMessage("AI Review Comments をブラウザで開きます。");
}

async function openReview(context: vscode.ExtensionContext, fileUri: vscode.Uri) {
  const fsPath = fileUri.fsPath;
  const fileName = path.basename(fsPath);
  const extensionVersion = String(context.extension.packageJSON.version ?? "dev");
  const root = workspaceRootFor(fileUri);
  const storeKey = root ? storeKeyFor(root, fileUri) : undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  let commentTimer: NodeJS.Timeout | undefined;

  const panel = vscode.window.createWebviewPanel(
    "aiReviewComments",
    `Review: ${fileName}`,
    // open as a tab in the active editor group (not a split pane)
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    }
  );

  const createBootData = async (): Promise<BootData> => {
    const source = await readCurrentText(fileUri);
    const previewHtml = await renderPreview(fsPath, source);
    const previewKind = previewHtml ? previewKindFor(fsPath) : "none";

    const meta: ReviewMeta = {
      file: fileName,
      path: fsPath,
      dir: path.dirname(fsPath),
      workspaceRoot: root?.fsPath,
      storePath: root ? storeUri(root).fsPath : undefined,
      storeKey,
      previewKind,
      defaultView: previewKind === "none" ? "source" : "preview",
      lang: langFor(fsPath),
    };

    return { meta, source, previewHtml, extensionVersion, loadedAt: new Date().toISOString() };
  };

  panel.webview.html = buildHtml(context, panel.webview, await createBootData());

  const pushReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      panel.webview.postMessage({ type: "reload-result", boot: await createBootData() });
    }, 100);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(fsPath), path.basename(fsPath))
  );
  const storeWatcher = root
    ? vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root.fsPath, ".ai-review/comments.json")
      )
    : undefined;
  const pushComments = () => {
    if (!root || !storeKey) return;
    if (commentTimer) clearTimeout(commentTimer);
    commentTimer = setTimeout(async () => {
      panel.webview.postMessage({
        type: "comments-updated",
        comments: await readComments(root, storeKey),
      });
    }, 100);
  };
  const disposables = [
    watcher,
    watcher.onDidChange(pushReload),
    watcher.onDidCreate(pushReload),
    ...(storeWatcher
      ? [storeWatcher, storeWatcher.onDidChange(pushComments), storeWatcher.onDidCreate(pushComments)]
      : []),
    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) pushReload();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.toString() === fileUri.toString()) pushReload();
    }),
  ];

  panel.onDidDispose(() => {
    if (reloadTimer) clearTimeout(reloadTimer);
    if (commentTimer) clearTimeout(commentTimer);
    disposables.forEach((disposable) => disposable.dispose());
  });

  panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    if (msg.type === "copy") {
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.showInformationMessage("AIプロンプトをコピーしました。");
    } else if (msg.type === "copy-text") {
      await vscode.env.clipboard.writeText(msg.text);
    } else if (msg.type === "open-external") {
      const uri = vscode.Uri.parse(msg.url);
      if (isAllowedExternalUri(uri)) await vscode.env.openExternal(uri);
      else vscode.window.showWarningMessage("このリンク種別は開けません。");
    } else if (msg.type === "reveal" && typeof msg.line === "number") {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(Math.max(0, msg.line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } else if (msg.type === "close") {
      panel.dispose();
    } else if (msg.type === "reload") {
      panel.webview.postMessage({ type: "reload-result", boot: await createBootData() });
    } else if (msg.type === "load-comments") {
      const comments = root && storeKey ? await readComments(root, storeKey) : [];
      panel.webview.postMessage({ type: "load-comments-result", requestId: msg.requestId, comments });
    } else if (msg.type === "save-comments") {
      try {
        if (root && storeKey) {
          await writeComments(root, storeKey, msg.comments);
        }
        panel.webview.postMessage({ type: "save-comments-result", requestId: msg.requestId, ok: true });
      } catch (error) {
        panel.webview.postMessage({
          type: "save-comments-result",
          requestId: msg.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

function isAllowedExternalUri(uri: vscode.Uri): boolean {
  return ["http", "https", "mailto", "file", "tel"].includes(uri.scheme.toLowerCase());
}

async function readCurrentText(fileUri: vscode.Uri): Promise<string> {
  const openDocument = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === fileUri.toString()
  );
  if (openDocument?.isDirty) return openDocument.getText();
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf8");
  } catch {
    return openDocument?.getText() ?? "";
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
        <button id="reload-view" class="icon-btn" title="プレビューを再読み込み（リンクで遷移してしまったとき等）" aria-label="再読み込み"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.4 3.4V7H10.8"/></svg></button>
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
    // host bridge: the webview UI talks to the extension instead of an HTTP server
    const vscode = acquireVsCodeApi();
    let BOOT = ${injected};
    let requestId = 1;
    const pendingRequests = new Map();
    window.__AI_REVIEW_BOOT__ = BOOT;
    if (BOOT.previewHtml) window.__PREVIEW_HTML__ = BOOT.previewHtml;

    const _rf = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u === "/__meta") return Promise.resolve(new Response(JSON.stringify(BOOT.meta), { headers: { "content-type": "application/json" } }));
      if (u === "/__source") return Promise.resolve(new Response(BOOT.source, { headers: { "content-type": "text/plain" } }));
      return _rf ? _rf(url, opts) : Promise.reject(new Error("blocked: " + u));
    };

    if (!navigator.clipboard) navigator.clipboard = {};
    navigator.clipboard.writeText = (t) => { vscode.postMessage({ type: "copy", text: t }); return Promise.resolve(); };
    const requestHost = (type, payload = {}) => new Promise((resolve, reject) => {
      const id = requestId++;
      pendingRequests.set(id, { resolve, reject });
      vscode.postMessage({ type, requestId: id, ...payload });
    });
    window.aiReviewHost = {
      reload: () => vscode.postMessage({ type: "reload" }),
      close: () => vscode.postMessage({ type: "close" }),
      copyText: (text) => vscode.postMessage({ type: "copy-text", text }),
      openExternal: (url) => vscode.postMessage({ type: "open-external", url }),
      loadComments: () => requestHost("load-comments"),
      saveComments: (comments) => requestHost("save-comments", { comments }),
    };

    // host → webview: latest file content after reload.
    window.addEventListener("message", (e) => {
      const m = e.data;
      if (m && m.type === "reload-result" && m.boot) {
        BOOT = m.boot;
        window.__AI_REVIEW_BOOT__ = BOOT;
        window.__PREVIEW_HTML__ = BOOT.previewHtml || "";
        window.dispatchEvent(new CustomEvent("ai-review:reload", { detail: BOOT }));
      } else if (m && (m.type === "load-comments-result" || m.type === "save-comments-result")) {
        const pending = pendingRequests.get(m.requestId);
        if (pending) {
          pendingRequests.delete(m.requestId);
          if (m.ok === false) pending.reject(new Error(m.error || "host request failed"));
          else pending.resolve(m.comments ?? true);
        }
      } else if (m && m.type === "comments-updated") {
        window.dispatchEvent(new CustomEvent("ai-review:comments-updated", { detail: m.comments || [] }));
      }
    });
  </script>
  <script type="module" src="${asset("boot.js")}"></script>
</body>
</html>`;
}
