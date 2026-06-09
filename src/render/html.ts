// Add data-line="N" (1-based source line) to each opening HTML tag so a comment
// made in the rendered preview can reference the original source line. Tags
// inside <script>/<style>/<pre>/<textarea> are left untouched.

const SKIP_TAGS: Record<string, true> = {
  script: true,
  style: true,
  pre: true,
  textarea: true,
};

export function injectLineNumbers(html: string): string {
  let line = 1;
  let out = "";
  let i = 0;
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
        const t = m[1].toLowerCase();
        let full = m[0];
        if (!isClosing && !/\sdata-line=/.test(full)) {
          full = full.replace(/^<([a-zA-Z][\w-]*)/, `<$1 data-line="${line}"`);
        }
        out += full;
        line += (m[0].match(/\n/g) || []).length;
        i += m[0].length;
        if (!isClosing && SKIP_TAGS[t]) {
          const close = html.toLowerCase().indexOf(`</${t}`, i);
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
