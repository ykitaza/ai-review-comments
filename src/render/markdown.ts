// Dependency-free Markdown → HTML for the preview pane. Covers the constructs
// common in design docs: headings, lists (nested), fenced & inline code,
// blockquote, tables, hr, links, images, bold/italic/strikethrough, and
// ```mermaid blocks (rendered client-side). Each top-level block carries
// data-md-line (1-based source line) so a comment in the preview maps back to
// the original Markdown line.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(s: string): string {
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return ` ${codes.length - 1} `;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, a, u) => `<img alt="${a}" src="${u}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/ (\d+) /g, (_m, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return s;
}

interface ListItem {
  indent: number;
  ordered: boolean;
  html: string;
  line: number;
}

const tag = (n: number) => ` data-md-line="${n}"`;

function renderList(items: ListItem[], baseLine: number): string {
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
    if (j > i + 1) li += renderList(items.slice(i + 1, j), items[i + 1].line);
    li += "</li>";
    html += li;
    i = j;
  }
  html += ordered ? "</ol>" : "</ul>";
  return html;
}

export function renderMarkdownBody(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 1;

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code (incl. mermaid)
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      const langName = fence[2].trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const code = buf.join("\n");
      if (/^mermaid$/i.test(langName)) {
        const attrSrc = escapeHtml(code).replace(/"/g, "&quot;");
        out.push(`<div class="mermaid"${tag(lineNo)} data-mermaid-src="${attrSrc}">${escapeHtml(code)}</div>`);
      } else {
        out.push(`<pre${tag(lineNo)}><code class="lang-${escapeHtml(langName)}">${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}${tag(lineNo)}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(`<hr${tag(lineNo)}>`);
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      const start = lineNo;
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote${tag(start)}>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const start = lineNo;
      const splitRow = (r: string) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = `<table${tag(start)}><thead><tr>`;
      t += headers.map((c) => `<th>${renderInline(c)}</th>`).join("");
      t += "</tr></thead><tbody>";
      for (const r of rows) t += "<tr>" + r.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
      t += "</tbody></table>";
      out.push(t);
      continue;
    }

    // lists
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const start = lineNo;
      const items: ListItem[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)!;
        items.push({ indent: m[1].length, ordered: /\d+\./.test(m[2]), html: renderInline(m[3]), line: i + 1 });
        i++;
      }
      out.push(renderList(items, start));
      continue;
    }

    // paragraph
    const buf = [line];
    const start = lineNo;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|([-*+]|\d+\.)\s|`{3,}|~{3,})/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p${tag(start)}>${renderInline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const STYLES = `
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
  .mermaid { background:#fff; text-align:center; margin: 1em 0; }
  .mermaid-error { background:#fff5f5; border:1px solid #f3c0c0; color:#b00; border-radius:8px;
    padding:10px 14px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:12px; }
`;

const MERMAID_SCRIPT = `
<script type="module">
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
        el.innerHTML = '<div class="mermaid-error">Mermaid: ' + String((e && e.message) || e) + '</div>';
      }
    }
  } catch (e) { /* offline: leave raw text */ }
</script>`;

export function renderMarkdownDoc(md: string): string {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>${STYLES}</style></head>
<body>
${renderMarkdownBody(md)}
${MERMAID_SCRIPT}
</body></html>`;
}
