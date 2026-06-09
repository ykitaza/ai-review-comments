# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

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
