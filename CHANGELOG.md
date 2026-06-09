# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

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
