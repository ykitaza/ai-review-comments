# Copilot instructions for this repository

## Build, test, and lint commands

- Install dependencies: `npm install`
- Build the VS Code extension bundle and copied webview assets: `npm run compile`
- Rebuild on change: `npm run watch`
- Type-check TypeScript: `npm run typecheck`
- Package a VSIX: `npm run package`
- CI-equivalent validation: `npm run typecheck && npm run compile && npx --yes @vscode/vsce package --no-dependencies`
- Manual extension run: press F5 in VS Code, then run `AI Review: Open Review Panel` in the Extension Development Host.
- Browser/CLI run without VS Code: `node cli/ai-review.mjs open ./path/to/file.md --no-open --keep-alive`
- Comment-store CLI examples: `node cli/ai-review.mjs pending [file]`, `node cli/ai-review.mjs prompt <file>`, `node cli/ai-review.mjs resolve <file> <id> --note "..."`
- There is currently no test runner, lint script, or single-test command in `package.json`.

## High-level architecture

This is a VS Code extension plus a browser CLI that share the same review UI and comment store.

- `src/extension.ts` is the VS Code extension host entry point. It registers `aiReviewComments.review` and `aiReviewComments.reviewInBrowser`, reads the target file, builds a webview HTML shell, injects boot data, handles webview messages, watches the reviewed file, and watches `.ai-review/comments.json`.
- `webview/` is plain browser ESM with no build step. `webview/boot.js` chooses the active adapter, `webview/core.js` owns comment state, prompt generation, composer/panel UI, and persistence calls, `webview/render.js` handles rendered HTML/Markdown comments in an iframe, `webview/source.js` handles raw line/range comments, and `webview/datapath.js` adds JSON/YAML path hints.
- The VS Code webview and browser server expose the same host surface to `webview/`: `fetch("/__meta")`, `fetch("/__source")`, `window.__AI_REVIEW_BOOT__`, optional `window.__PREVIEW_HTML__`, and `window.aiReviewHost` methods such as `loadComments`, `saveComments`, `reload`, and clipboard helpers. Keep `webview/` host-agnostic.
- `cli/ai-review.mjs` is the `ai-review` bin for opening the browser UI and reading/writing comments. `cli/serve.mjs` serves the same `webview/` UI over localhost, pushes file/comment changes through SSE, and falls back from source `webview/` to `dist/webview/` when packaged.
- `shared/render.mjs` is the shared rendering implementation used by both the extension and CLI server. `src/render/index.ts` only re-exports it for TypeScript. Markdown preview uses `markdown-it`, adds `data-md-line`, renders Mermaid in the browser, and renders PlantUML through the local `plantuml` command when available. HTML preview is annotated with `data-line`.
- Comments persist in `<workspace>/.ai-review/comments.json` with schema `{ version: 1, files: { "<root-relative/path>": { comments: [...] } } }`. Extension code uses `src/store.ts` with VS Code APIs; CLI/browser code uses `shared/store.mjs`. Store keys are root-relative and slash-separated.
- `esbuild.mjs` deletes and recreates `dist/`, bundles `src/extension.ts` to `dist/extension.js`, and copies `webview/` to `dist/webview/`. Do not edit generated `dist/` files directly.

## Key conventions

- Keep runtime dependencies minimal. `CONTRIBUTING.md` asks not to add runtime dependencies without a strong reason; current tooling is TypeScript/esbuild plus the existing Markdown renderer dependency.
- User-facing UI labels and VS Code messages are mostly Japanese. Match the existing language and tone when changing UI strings.
- When changing the webview DOM shell or host bridge, update both `src/extension.ts` (`buildHtml`) and `cli/serve.mjs` (`pageHtml`) so VS Code and browser modes stay compatible.
- When changing the host/webview message or boot-data contract, update `src/types.ts`, `src/extension.ts`, `cli/serve.mjs`, and the relevant `webview/` callers together. The webview JavaScript mirrors these TypeScript shapes informally.
- When changing exported helpers in `shared/render.mjs`, update `shared/render.d.mts` so TypeScript imports through `src/render/index.ts` stay typed.
- To add a previewable format, update the shared file-kind/render dispatch in `shared/render.mjs`, the TypeScript `PreviewKind`/metadata contract in `src/types.ts`, and the webview adapter/controller path in `webview/boot.js` plus any new adapter. If the format affects browser and VS Code boot HTML, update both hosts.
- The adapter contract used by `webview/core.js` is `mount()`, `relocate()`, `reveal(comment)`, `setActive(id)`, and `clearSelection()`, with optional `find()`/`clearFind()`. Keep new view behavior behind adapters rather than adding mode-specific logic to `core.js`.
- Preserve preview-to-source locators. Rendered Markdown comments rely on `data-md-line`; rendered HTML comments rely on injected `data-line`; source comments rely on `line`, optional `range`, optional JSON/YAML `path`, and `snippet`.
- For AI collaboration features, keep `author`, `resolved`, `resolutionNote`, and `replyTo` compatible across `src/types.ts`, `webview/core.js`, `webview/source.js`, and `cli/ai-review.mjs`.
