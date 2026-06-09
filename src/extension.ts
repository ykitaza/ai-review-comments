import * as vscode from "vscode";
import * as path from "node:path";
import type { BootData, ReviewMeta, WebviewMessage, PersistedComments } from "./types.js";
import { previewKindFor, langFor, renderPreview } from "./render/index.js";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiReviewComments.review", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage("Select a file to review.");
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
    vscode.ViewColumn.Beside,
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

  const storeKey = "review:" + fsPath;
  const saved = context.workspaceState.get<PersistedComments | null>(storeKey, null);

  const boot: BootData = { meta, source, saved, previewHtml };
  panel.webview.html = buildHtml(context, panel.webview, boot);

  panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    if (msg.type === "save") {
      await context.workspaceState.update(storeKey, msg.payload);
    } else if (msg.type === "copy") {
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.showInformationMessage("AI prompt copied to clipboard.");
    } else if (msg.type === "reveal" && typeof msg.line === "number") {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(Math.max(0, msg.line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  });
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
<html lang="en">
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
          <button id="view-preview" class="seg-btn">👁 Preview</button>
          <button id="view-source" class="seg-btn">&lt;&gt; Source</button>
        </div>
        <span class="spacer"></span>
        <button id="mode-element" class="mode-btn active">⬚ Element</button>
        <button id="mode-text" class="mode-btn">✎ Text</button>
        <button id="mode-off" class="mode-btn">✋ Off</button>
        <button id="open-settings" class="icon-btn" title="Settings">⚙</button>
        <button id="toggle-panel" class="icon-btn" title="Toggle panel">⟩</button>
      </div>
      <div id="frame-wrap"></div>
    </main>
    <div id="resizer"></div>
    <aside id="panel">
      <header>
        <h1>Comments</h1><span id="count" class="badge">0</span>
        <span class="spacer"></span>
        <button id="collapse-panel" class="icon-btn" title="Hide panel">⟩</button>
      </header>
      <div id="hint" class="hint">Click an element / line or drag a range on the left to add a comment.</div>
      <ul id="comments"></ul>
      <footer>
        <button id="copy" class="primary" disabled>📋 Copy AI prompt</button>
        <button id="clear" class="ghost" disabled>Clear all</button>
        <div id="copied-toast" class="toast">Copied</div>
      </footer>
    </aside>
  </div>

  <button id="show-panel" class="show-panel hidden">⟨ Comments</button>

  <div id="settings" class="drawer hidden">
    <div class="drawer-head"><h2>Settings — AI prompt template</h2><button id="settings-close" class="icon-btn">✕</button></div>
    <div class="drawer-body">
      <label class="field-label">Template</label>
      <select id="template-select"></select>
      <p class="field-help">Choose the tone/intent of the prompt. Editing the text saves it as a custom template.</p>
      <label class="field-label">Template body</label>
      <textarea id="template-body" rows="10" spellcheck="false"></textarea>
      <div class="field-vars">Variables: <code>{{file}}</code> <code>{{comments}}</code> <code>{{count}}</code></div>
      <div class="drawer-actions"><button id="template-reset" class="ghost">Reset to preset</button><button id="template-save" class="primary">Save</button></div>
      <div class="drawer-preview-wrap"><label class="field-label">Preview</label><pre id="template-preview" class="drawer-preview"></pre></div>
    </div>
  </div>
  <div id="settings-backdrop" class="backdrop hidden"></div>

  <div id="composer" class="composer hidden">
    <div class="composer-target" id="composer-target"></div>
    <textarea id="composer-input" rows="3" placeholder="Write your note / revision request…"></textarea>
    <div class="composer-actions"><button id="composer-cancel" class="ghost">Cancel</button><button id="composer-save" class="primary">Add (⌘/Ctrl+Enter)</button></div>
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
  </script>
  <script type="module" src="${asset("boot.js")}"></script>
</body>
</html>`;
}
