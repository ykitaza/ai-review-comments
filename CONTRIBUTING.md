# Contributing

Thanks for your interest! This extension is intentionally **dependency-free at
runtime** (only dev tooling: TypeScript + esbuild). Please keep it that way.

## Setup

```bash
npm install
npm run watch      # rebuild dist/ on change
```

Press **F5** in VS Code to launch an Extension Development Host with the
extension loaded. Open a file there and run **AI Review: Open Review Panel**.

## Layout

- `src/` — extension host (TypeScript). Compiled to `dist/extension.js`.
  - `src/render/` — preview generators (Markdown→HTML, HTML line injection).
  - `src/types.ts` — shared types.
- `webview/` — the in-panel UI (plain ESM, no build step). Copied to
  `dist/webview/` at build time.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Before opening a PR

```bash
npm run typecheck   # tsc --noEmit must pass
npm run package     # must produce a .vsix without errors
```

- Match the surrounding code style (concise comments, no new deps).
- Adding a previewable format: add an adapter under `webview/`, a `previewKind`
  mapping in `src/render/index.ts`, and the matching renderer in `src/render/`.
- Update `CHANGELOG.md`.

## Docs media

`media/screenshot.png` and `media/flow.gif` are generated from a scripted,
auto-playing harness (`scripts/make-demo-harness.mjs`) captured with headless
Chrome and assembled with `ffmpeg`. Regenerate when the UI changes notably.

## Commit messages

Describe the change and, for non-trivial work, how you verified it.
