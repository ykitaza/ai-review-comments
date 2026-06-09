# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

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
