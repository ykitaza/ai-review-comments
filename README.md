# AI Review Comments

A VS Code extension to **review any file in a side panel, drop comments on the
rendered view or the raw lines, and copy an AI-ready revision prompt** you can
paste straight into Claude Code, Copilot, ChatGPT, etc.

It bridges a common gap: you want to review the **rendered** result (a Markdown
doc, an HTML page) but your AI needs to edit the **source**. This extension
captures what you click — a CSS selector, an element, a line range — and turns
your notes into a precise prompt that points the AI at the exact spot.

![review panel](media/screenshot.png)

## Features

- **Right-click any file → "AI Review: Open Review Panel"** — opens beside the editor.
- **Two views, toggle freely (Obsidian-style):**
  - **Preview** — HTML renders live; Markdown renders to HTML (with `mermaid`
    diagrams). Click an element or select text to comment.
  - **Source** — raw text with line numbers. Click a line or drag a range; a
    GitHub-style inline comment box opens right there.
- **Comments map back to the source.** A note on a rendered heading records the
  original Markdown line; a note on an HTML element records its source line and
  a stable CSS selector.
- **Data paths for JSON/YAML.** Commenting a line also captures its structural
  path (e.g. `services.web.ports`) so the AI knows which key you mean.
- **Prompt templates.** Pick *Fix / Question / Review / Plain*, or write your
  own with `{{file}}`, `{{count}}`, `{{comments}}` placeholders.
- **Comments persist** per file in the workspace; **copy** sends the prompt to
  your clipboard.
- **Resizable / collapsible panel**, responsive layout.

## Install

### From a packaged VSIX (today)

```bash
# build it
git clone https://github.com/ykitaza/ai-review-comments.git
cd ai-review-comments
npm install
npm run package          # produces ai-review-comments-<version>.vsix

# install into VS Code
code --install-extension ai-review-comments-*.vsix
```

Or in VS Code: **Extensions panel → ··· → Install from VSIX…**

### From the Marketplace

_Not published yet._ Once published: search **“AI Review Comments”** in the
Extensions view, or `code --install-extension ykitaza.ai-review-comments`.

## Usage

1. In the **Explorer**, right-click a file (e.g. `README.md`, `index.html`,
   `config.yaml`) and choose **AI Review: Open Review Panel**. (Also available
   from the editor tab/context menu and the Command Palette.)
2. If the file supports a preview (HTML/Markdown), toggle **👁 Preview / `<>` Source**.
3. Add comments:
   - **Preview:** click an element, or pick **✎ Text** and drag-select prose.
   - **Source:** click a line, or drag across a range; type in the inline box
     (⌘/Ctrl+Enter to save).
4. Press **📋 Copy AI prompt** and paste it to your AI assistant.

### Supported files

| File | Preview | Source |
|------|---------|--------|
| `.html` `.htm` | Live render, element/text comments | Raw HTML + line numbers |
| `.md` `.markdown` | Rendered (incl. `mermaid`), element/text comments | Raw Markdown + line numbers |
| `.json` `.yaml` `.xml` `.svg` `.txt` `.csv`, source files, … | — (source only) | Lines + JSON/YAML data paths |

> Markdown preview loads `mermaid` from a CDN (needs network); without it the
> diagram source stays visible as text.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `aiReviewComments.defaultTemplate` | `fix` | Default prompt template (`fix` / `question` / `review` / `plain`). |

## Development

```bash
npm install
npm run watch        # rebuild on change (dist/)
npm run typecheck    # tsc --noEmit
npm run package      # build a .vsix
```

Press **F5** in VS Code to launch an Extension Development Host.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the host and webview
fit together.

## License

[MIT](LICENSE)
