// Shared rendering helpers used by both the CLI server and the VS Code
// extension. Pure functions, no Node/DOM APIs.
//
// - renderMarkdownDoc(md)  → full HTML document (markdown-it, diagrams, data-md-line)
// - injectLineNumbers(html) → adds data-line="N" to each opening HTML tag
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import MarkdownIt from "markdown-it";

function createMarkdown(plantumlSvgs = new Map()) {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });

  markdown.core.ruler.push("ai_review_source_lines", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1 && token.tag) {
        token.attrSet("data-md-line", String(token.map[0] + 1));
      }
    }
  });

  markdown.renderer.rules.fence = (tokens, idx, options) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : "";
    const langName = info ? info.split(/\s+/g)[0] : "";
    const lineAttr = sourceLineAttr(token);
    const code = escapeHtml(token.content);

    if (/^mermaid$/i.test(langName)) {
      return `<div class="mermaid"${lineAttr} data-mermaid-src="${escapeAttr(token.content)}">${code}</div>\n`;
    }

    if (isPlantumlLang(langName)) {
      const svg = plantumlSvgs.get(fenceKey(token));
      if (svg) return `<div class="plantuml"${lineAttr}>${svg}</div>\n`;
    }

    const langAttr = langName
      ? ` class="${escapeAttr(`${options.langPrefix || "language-"}${langName}`)}"`
      : "";
    return `<pre${lineAttr}><code${langAttr}>${code}</code></pre>\n`;
  };

  const defaultImage = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") || "";
    if (isPlantumlPath(src)) {
      const svg = plantumlSvgs.get(imageKey(src));
      if (svg) return `<span class="plantuml plantuml-image">${svg}</span>`;
    }
    return defaultImage
      ? defaultImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  return markdown;
}

const inlineMarkdown = createMarkdown();

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function sourceLineAttr(token) {
  const line = token.attrGet("data-md-line");
  return line ? ` data-md-line="${escapeAttr(line)}"` : "";
}

export function renderInline(s) {
  return inlineMarkdown.renderInline(String(s));
}

export async function renderMarkdownBody(md, options = {}) {
  const source = String(md).replace(/\r\n?/g, "\n");
  const plantumlSvgs = new Map();
  const markdown = createMarkdown(plantumlSvgs);
  const env = {};
  const tokens = markdown.parse(source, env);

  await Promise.all(
    tokens
      .filter((token) => token.type === "fence" && isPlantumlLang(firstFenceWord(token.info)))
      .map(async (token) => {
        plantumlSvgs.set(fenceKey(token), await renderPlantumlSvg(token.content));
      })
  );
  await Promise.all(
    collectPlantumlImages(tokens).map(async (src) => {
      plantumlSvgs.set(imageKey(src), await renderPlantumlFile(src, options.baseDir));
    })
  );

  return markdown.renderer.render(tokens, markdown.options, env);
}

// Build a (possibly nested) list from flat items grouped by indent.
// Items at the base indent become <li>; runs of deeper-indented items become a
// nested list spliced into the preceding <li>.
export function renderList(items, _pos, baseLine, tag) {
  if (!items.length) return "";
  const baseIndent = items[0].indent;
  const ordered = items[0].ordered;
  let html = `<${ordered ? "ol" : "ul"}${tag(baseLine)}>`;
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    let li = `<li${tag(it.line)}>${it.html}`;
    let j = i + 1;
    while (j < items.length && items[j].indent > baseIndent) j++;
    if (j > i + 1) {
      li += renderList(items.slice(i + 1, j), 0, items[i + 1].line, tag);
    }
    li += "</li>";
    html += li;
    i = j;
  }
  html += ordered ? "</ol>" : "</ul>";
  return html;
}

// Add data-line="N" (1-based source line) to each opening HTML tag, so a
// comment made in the rendered preview can reference the original line. Tags
// inside <script>/<style>/<pre> are left alone. Existing attributes are kept.
export function injectLineNumbers(html) {
  let line = 1;
  let out = "";
  let i = 0;
  const skipTags = { script: true, style: true, pre: true, textarea: true };
  while (i < html.length) {
    const ch = html[i];
    if (ch === "\n") line++;
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i);
        const chunk = html.slice(i, end === -1 ? html.length : end + 3);
        line += (chunk.match(/\n/g) || []).length;
        out += chunk;
        i += chunk.length;
        continue;
      }
      const m = html.slice(i).match(/^<\/?([a-zA-Z][\w-]*)([^>]*)>/);
      if (m) {
        const isClosing = m[0][1] === "/";
        const tag = m[1].toLowerCase();
        let full = m[0];
        if (!isClosing && !/\sdata-line=/.test(full)) {
          full = full.replace(/^<([a-zA-Z][\w-]*)/, `<$1 data-line="${line}"`);
        }
        out += full;
        const consumed = m[0].length;
        line += (m[0].match(/\n/g) || []).length;
        i += consumed;
        if (!isClosing && skipTags[tag]) {
          const close = html.toLowerCase().indexOf(`</${tag}`, i);
          if (close !== -1) {
            const inner = html.slice(i, close);
            line += (inner.match(/\n/g) || []).length;
            out += inner;
            i = close;
          }
        }
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// File-kind detection (shared by the extension host and the CLI server).
const PREVIEW_KIND_BY_EXT = {
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
};
const LANG_BY_EXT = {
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".xml": "xml",
  ".svg": "xml", ".md": "markdown", ".markdown": "markdown",
  ".html": "html", ".htm": "html", ".csv": "csv", ".txt": "text",
  ".js": "javascript", ".ts": "typescript", ".css": "css",
  ".toml": "toml", ".ini": "ini", ".sh": "shell",
};

function extOf(p) {
  const m = String(p).toLowerCase().match(/\.[^./\\]+$/);
  return m ? m[0] : "";
}

export function previewKindFor(filePath) {
  return PREVIEW_KIND_BY_EXT[extOf(filePath)] || "none";
}

export function langFor(filePath) {
  return LANG_BY_EXT[extOf(filePath)] || "text";
}

/** Build the preview HTML for a file, or null if it has no preview. */
export async function renderPreview(filePath, source) {
  const kind = previewKindFor(filePath);
  if (kind === "markdown") return await renderMarkdownDoc(source, { baseDir: dirname(filePath) });
  if (kind === "html") return injectLineNumbers(source);
  return null;
}

export async function renderMarkdownDoc(md, options = {}) {
  const body = await renderMarkdownBody(md, options);
  return renderMarkdownShell(body);
}

function renderMarkdownShell(body) {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
    line-height: 1.7; color: #1a1a2e; max-width: 820px; margin: 0 auto; padding: 32px 28px 80px; }
  h1,h2,h3,h4 { line-height: 1.3; margin: 1.4em 0 0.5em; }
  h1 { border-bottom: 2px solid #e2e6ef; padding-bottom: .3em; }
  h2 { border-bottom: 1px solid #e8ebf2; padding-bottom: .25em; }
  code { background: #f0f2f7; padding: .15em .4em; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  pre { background: #1c2030; color: #e6e9ef; padding: 14px 16px; border-radius: 8px; overflow:auto; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { border-left: 4px solid #c9d2e3; margin: 1em 0; padding: .2em 1em; color: #555; background:#f7f9fc; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid #d7dce6; padding: 7px 11px; text-align: left; }
  th { background: #f3f6ff; }
  ul, ol { padding-left: 1.6em; }
  img { max-width: 100%; }
  a { color: #2f6bd6; }
  hr { border: none; border-top: 1px solid #e2e6ef; margin: 1.6em 0; }
  .mermaid, .plantuml { background:#fff; text-align:center; margin: 1em 0; }
  .plantuml-image { display:block; }
  .mermaid[data-rendered], .plantuml { padding: 4px; }
  .plantuml svg { max-width: 100%; height: auto; }
  .mermaid-error, .plantuml-error { background:#fff5f5; border:1px solid #f3c0c0; color:#b00; border-radius:8px; padding:10px 14px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:12px; text-align:left; }
</style></head>
<body>
${body}
<script type="module">
  // Render fenced mermaid blocks as diagrams. Loaded from CDN (requires
  // network); if it fails, the raw mermaid source remains visible as text.
  try {
    const mermaid = (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
    const blocks = document.querySelectorAll(".mermaid");
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      const src = el.getAttribute("data-mermaid-src") || el.textContent;
      try {
        const { svg } = await mermaid.render("mmd-" + i, src);
        el.innerHTML = svg;
        el.setAttribute("data-rendered", "1");
      } catch (e) {
        el.innerHTML = '<div class="mermaid-error">Mermaid 描画エラー: ' +
          String(e && e.message || e) + '</div>';
      }
    }
  } catch (e) {
    // mermaid library failed to load (offline?) — leave raw text blocks as-is.
  }
</script>
</body></html>`;
}

function firstFenceWord(info) {
  return String(info || "").trim().split(/\s+/g)[0] || "";
}

function isPlantumlLang(langName) {
  return /^(puml|plantuml)$/i.test(langName);
}

function isPlantumlPath(src) {
  if (/^(?:https?:|data:|mailto:)/i.test(src)) return false;
  return /\.(?:puml|plantuml)$/i.test(String(src).split(/[?#]/)[0]);
}

function fenceKey(token) {
  return `${token.map?.[0] ?? -1}:${firstFenceWord(token.info)}:${token.content}`;
}

function imageKey(src) {
  return `image:${String(src)}`;
}

function collectPlantumlImages(tokens) {
  const sources = new Set();
  const visit = (token) => {
    if (token.type === "image") {
      const src = token.attrGet("src") || "";
      if (isPlantumlPath(src)) sources.add(src);
    }
    if (token.children) token.children.forEach(visit);
  };
  tokens.forEach(visit);
  return [...sources];
}

async function renderPlantumlFile(src, baseDir = process.cwd()) {
  try {
    const filePath = resolvePlantumlPath(src, baseDir);
    const content = await readFile(filePath, "utf8");
    return await renderPlantumlSvg(content);
  } catch (error) {
    return plantumlError(`PlantUMLファイルを読めません: ${src}\n${error.message || error}`);
  }
}

function resolvePlantumlPath(src, baseDir) {
  const withoutHash = String(src).split(/[?#]/)[0];
  let decoded = withoutHash;
  try {
    decoded = decodeURIComponent(withoutHash);
  } catch {
    // Keep the original path if it is not URI-encoded.
  }
  return resolve(baseDir || process.cwd(), decoded);
}

function normalizePlantumlSource(content) {
  const source = String(content).trim();
  if (/^@start\w+/m.test(source)) return source;
  return `@startuml\n${source}\n@enduml`;
}

function renderPlantumlSvg(content) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const done = (html) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(html);
    };
    const child = spawn("plantuml", ["-pipe", "-tsvg", "-charset", "UTF-8"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      done(plantumlError("PlantUML描画がタイムアウトしました。"));
    }, 10000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      const message =
        error?.code === "ENOENT"
          ? "`plantuml` コマンドが見つかりません。ローカルにPlantUMLをインストールすると図として表示されます。"
          : `PlantUMLを起動できません: ${error.message || error}`;
      done(plantumlError(message));
    });
    child.on("close", (code) => {
      const svg = stdout.trim();
      if (code === 0 && svg.includes("<svg")) {
        done(svg);
      } else {
        done(plantumlError(stderr.trim() || `PlantUML描画に失敗しました(exit ${code})`));
      }
    });
    child.stdin.end(normalizePlantumlSource(content), "utf8");
  });
}

function plantumlError(message) {
  return `<pre class="plantuml-error"><code>${escapeHtml(message)}</code></pre>`;
}
