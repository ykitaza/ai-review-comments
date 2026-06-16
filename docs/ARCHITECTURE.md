# Architecture

The extension has two halves that talk over `postMessage`: the **extension
host** (Node, TypeScript) and the **webview UI** (browser-context JS).

```
┌───────────────────────────── extension host (src/, TypeScript) ─────────────────────────────┐
│ extension.ts        registers the command, reads the file, builds the webview HTML,          │
│                     handles messages (save → workspaceState, copy → clipboard, reveal → editor) │
│ render/             preview generators (Node-side, reused anywhere)                          │
│   markdown.ts        Markdown → HTML (mermaid-aware, data-md-line)                           │
│   html.ts            injectLineNumbers: data-line on each opening tag                         │
│   index.ts           previewKindFor / langFor / renderPreview dispatch                       │
│ types.ts            shared types: ReviewMeta, ReviewComment, BootData, WebviewMessage         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                │  BootData {meta, source, previewHtml}  +  fetch/comment-store/clipboard host shims
                ▼
┌───────────────────────────── webview UI (webview/, plain ESM) ───────────────────────────────┐
│ boot.js     controller: owns Preview + Source views, the toggle, settings, resize            │
│ core.js     the engine: comment store, persistence, panel + composer, prompt building        │
│ render.js   PREVIEW adapter — iframe (srcdoc) of the rendered HTML/Markdown; element/text     │
│             selection → CSS selector + source line (data-md-line / data-line)                 │
│ source.js   SOURCE adapter — line/range selection, GitHub-style inline threads                │
│ datapath.js JSON/YAML structural path heuristics                                              │
│ settings.js prompt-template drawer + panel collapse/resize                                    │
│ drawiopng.js (carried over; not wired into the extension yet)                                 │
│ styles.css  all UI styling                                                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Why a webview that thinks it's talking to a server

The webview UI was designed to run against a tiny local HTTP server (the
original browser tool). To reuse it unchanged inside VS Code — which has no
such server — the host injects three shims before loading `boot.js`:

- **`window.fetch`** intercepts `/__meta` and `/__source` and answers from the
  injected `BootData`.
- **`localStorage`** is replaced with an in-memory map that forwards the
  per-file comment key to the host as a `save` message (→ `workspaceState`).
- **`navigator.clipboard.writeText`** posts a `copy` message (→ `env.clipboard`).

This keeps the UI host-agnostic: the same `webview/` code could run in a plain
browser against a server, or in the extension against the bridge.

## Preview without a server

In the browser the preview iframe loads `src="/target"`. In the webview there's
no server, so the host renders the preview HTML up-front (`render/`) and passes
it as `BootData.previewHtml`. The render adapter detects `window.__PREVIEW_HTML__`
and loads it via **`iframe.srcdoc`**, which stays same-origin — so the adapter
can still read `contentDocument`, attach click handlers, and resolve selectors.

## The adapter contract

`core.js` is view-agnostic. Each view is an *adapter* implementing:

```
{ mount(), relocate(), reveal(comment), setActive(id), clearSelection() }
```

`boot.js` builds a controller that mounts the right adapter for the file's
`previewKind`, wires the Preview/Source toggle, and calls `useAdapter()` on the
core when switching. Adding a new previewable format = one new adapter + a
`previewKind` mapping; nothing in `core.js` changes.

## Data flow for one comment

1. User clicks in a view → the adapter builds a *target* descriptor
   (`selector` / `line` / `mdLine` / `srcLine` / data `path` / `snippet`).
2. `core.addComment()` stores it, persists (`save()` →
   `aiReviewHost.saveComments()` → `.ai-review/comments.json`), and re-renders
   the panel.
3. **Copy** fills the active template's `{{comments}}` with each comment's
   locator + note and posts the text to the host clipboard.

Copied prompts are composed from an independently editable common prompt plus
the selected task-specific template. The common prompt uses `BootData.meta`
(`path`, `dir`, `workspaceRoot`, `storePath`, `storeKey`) so agents can locate
`.ai-review/comments.json` even when they are launched from a different CWD.
The CLI mirrors this with `--store <comments.json>` and `--root <workspace>` so
callers can bypass auto-discovery when a reviewed file lives inside a nested Git
repository.

## Build

`esbuild.mjs` bundles `src/extension.ts` → `dist/extension.js` (CJS, `vscode`
external) and copies `webview/` → `dist/webview/`. The `.vsix` ships only
`dist/` + `package.json` + docs.
