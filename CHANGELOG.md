# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
- AI prompts now prepend an independently editable common prompt with target
  file, workspace root, comment-store path, and store key metadata.
- The `ai-review prompt` CLI output includes the same comment-store metadata so
  agents can work from the correct store even when launched from another CWD.
- The CLI and browser server now support `--store <comments.json>` and
  `--root <workspace>` to avoid nested Git roots resolving to the wrong comment
  store.
- The "clear all comments" action now asks for confirmation before deleting.
- The comments panel now separates unresolved threads from resolved threads, with
  resolved threads collapsed by default.

## [0.4.6]

### Added
- `Cmd/Ctrl+F` opens an in-review find bar for preview and source views.
- Source view search highlights all matches and supports next/previous navigation.

## [0.4.5]

### Added
- Users can now resolve and reopen comments from the review UI.

### Changed
- Replies are grouped under their parent comment in a GitHub-style thread layout.
- Resolving a parent comment resolves its reply thread together.

## [0.4.4]

### Changed
- Fix prompts now tell assistants to check for source files behind generated
  HTML and rebuild from the source when available.

## [0.4.3]

### Fixed
- In VS Code webviews, operation mode now bridges selected preview text to the
  host clipboard for `Cmd/Ctrl+C`.
- Right-clicking selected preview text in operation mode now shows a Copy action
  when native iframe context menus are unavailable.

## [0.4.2]

### Fixed
- Operation mode no longer lets review pins intercept page interactions, so the
  rendered preview behaves more like a normal web page.
- In VS Code webviews, `Cmd/Ctrl+W` from inside the preview frame now closes the
  review tab instead of being swallowed by the iframe.

## [0.4.1]

### Changed
- Question prompts now ask AI assistants to answer as replies to the original
  comment IDs when possible.
- Copied prompts include each review comment's stable `#id`.

## [0.4.0]

### Added
- Review comments persist again in `.ai-review/comments.json` while preview HTML
  remains regenerated from the file on each open/reload.
- Comment cards now support replies via `replyTo`.

## [0.3.9]

### Added
- Markdown image references to local `.puml` / `.plantuml` files are rendered
  through the local `plantuml` command.

## [0.3.8]

### Added
- Markdown preview renders fenced `plantuml` / `puml` blocks through the local
  `plantuml` command when it is available.

## [0.3.7]

### Changed
- Markdown preview now uses `markdown-it` while keeping source-line attributes
  for review comments and Mermaid rendering.

## [0.3.6]

### Fixed
- Review previews now reload from the latest file content instead of reusing
  stale browser/webview bootstrap HTML.
- Browser mode disables HTTP caching for boot data, source, target previews, and
  webview assets.

## [0.3.5]

### Changed
- Review UI comments are now session-only. Reloading or reopening the review
  clears comments instead of restoring them from `.ai-review/comments.json`.

## [0.3.4]

### Added
- VS Code command/configuration to open reviews either inside VS Code or in the
  default browser.

## [0.3.3]

### Changed
- Preview mode now defaults to text selection instead of element selection.

## [0.3.2]

### Changed
- Simplified comment state management: the UI now keeps comments only in memory,
  while VS Code and browser hosts own persistence to `.ai-review/comments.json`.
- Browser mode now uses explicit host APIs (`/__comments`, `/__save`, `/__boot`)
  instead of a comment-specific localStorage shim.

## [0.3.1]

### Fixed
- VS Code webview reload now requests fresh file content from the extension host.
- Comment deletion now saves directly through the VS Code extension host instead
  of relying only on the webview localStorage shim.
- The review toolbar shows the running extension version so local VSIX updates
  are visible during manual verification.

## [0.3.0]

### Added
- **Browser mode** (`ai-review open <file>` / `ai-review <file>`): a zero-build
  local server that opens the same review UI in the default browser — no VS Code
  needed, friendly for non-engineers. Comments persist to the same
  `.ai-review/comments.json` store; external changes (CLI / AI agent) stream to
  the page live over SSE. Tab close shuts the server down (deferred, reload-safe).

### Changed
- Render implementations moved to plain-JS `shared/render.mjs` (single source of
  truth for the extension host and the build-free CLI server); `src/render` is
  now a typed re-export.
- Store helpers extracted to `shared/store.mjs` (CLI + server).

### Fixed
- CLI root discovery now walks up from the target file's directory, so
  `ai-review add /abs/path/file --line N …` works from any cwd (and avoids a
  macOS `/tmp` symlink key mismatch).

## [0.2.1]

### Added (AI-requested features — what an agent wants when working the loop)
- `ai-review pending [file]` — every unresolved comment across the workspace in
  one JSON call, with a computed **`stale`** flag (file changed since the
  comment → don't trust recorded line numbers; re-locate by snippet/intent).
- `ai-review resolve --note "..."` — record *what was done*; the note shows in
  the panel under the resolved comment.
- `ai-review add --reply-to <id>` — reply to a specific comment (panel shows an
  ↪ reply marker), e.g. for the AI to ask clarifying questions.

## [0.2.0]

### Added
- **AI agent collaboration**: comments now persist to `.ai-review/comments.json`
  in the workspace (was: extension-private storage), so external tools can read
  and write them. Existing comments migrate automatically.
- **`ai-review` CLI** (zero-dependency): `list` / `json` / `prompt` / `add` /
  `resolve` / `remove` / `clear`. AI agents can fetch comments and post their
  own (`--author ai`).
- **Live updates**: the open panel picks up store changes (e.g. an AI adding or
  resolving comments) immediately via a file watcher.
- **AI badge** on AI-authored comments; **resolved** state (✓, struck through,
  excluded from generated prompts).
- **Claude Code skill** (`skills/ai-review/SKILL.md`) wrapping the CLI.
- Edit (✎) button on panel comment cards (was double-click only).

### Changed
- UI labels unified to Japanese; tooltips added to all toolbar buttons.

## [0.1.0] - Initial release

### Added
- Review panel (right-click a file → **AI Review: Open Review Panel**).
- **Preview / Source** toggle for HTML and Markdown; source-only for other files.
- Preview comments on rendered elements/text, mapped back to source lines
  (`data-md-line` for Markdown, injected `data-line` for HTML).
- GitHub-style inline line/range comments in the source view.
- JSON/YAML data-path hints on line comments.
- `mermaid` diagram rendering inside Markdown preview.
- Prompt templates (Fix / Question / Review / Plain) + custom editing.
- Per-file comment persistence in workspace state; copy prompt to clipboard.
- Resizable / collapsible, responsive panel.
