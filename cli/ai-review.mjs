#!/usr/bin/env node
// ai-review — CLI companion to the AI Review Comments VS Code extension.
//
// Comments live in <root>/.ai-review/comments.json (the same store the
// extension panel uses), so an AI agent can READ review comments and WRITE
// its own — the open panel picks up changes live.
//
//   ai-review list   [file]                 コメント一覧（人間向け）
//   ai-review json   [file]                 コメントをJSONで出力（エージェント向け）
//   ai-review prompt <file>                 未対応コメントをAIプロンプト形式で出力
//   ai-review add    <file> --line N [--end M] --body "..." [--author ai]
//   ai-review resolve <file> <id>           対応済みにする
//   ai-review remove  <file> <id>           コメントを削除
//   ai-review clear   <file>                ファイルのコメントを全削除
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";

const STORE_REL = ".ai-review/comments.json";

// Root = nearest ancestor with .ai-review/ or .git/ (so the CLI works from
// subdirectories); falls back to the current directory.
function findRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".ai-review")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const root = findRoot();
const storePath = join(root, STORE_REL);

function readStore() {
  try {
    const data = JSON.parse(readFileSync(storePath, "utf8"));
    if (data && data.version === 1 && data.files) return data;
  } catch {
    /* missing or invalid */
  }
  return { version: 1, files: {} };
}

function writeStore(store) {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
}

/** Normalize a user-supplied path to the store key (root-relative, /-separated). */
function keyFor(file) {
  return relative(root, resolve(file)).split(sep).join("/");
}

function commentsFor(store, key) {
  return store.files[key]?.comments ?? [];
}

function locator(c) {
  if (c.kind === "lines") return c.range ? `L${c.range[0]}-L${c.range[1]}` : `L${c.line}`;
  const at = c.mdLine || c.srcLine ? ` L${c.mdLine || c.srcLine}` : "";
  return `${c.selector ?? c.kind}${at}`;
}

function formatComment(c, key) {
  const out = [];
  out.push(`- 対象ファイル: \`${key}\``);
  if (c.kind === "lines") {
    out.push(`- 対象行: \`${c.range ? `L${c.range[0]}-L${c.range[1]}` : `L${c.line}`}\``);
    if (c.path) out.push(`- データパス: \`${c.path}\``);
    if (c.snippet) out.push("- 該当箇所:\n```\n" + c.snippet + "\n```");
  } else {
    if (c.selector) out.push(`- 対象セレクタ: \`${c.selector}\``);
    const line = c.mdLine || c.srcLine;
    if (line) out.push(`- 対象行: \`L${line}\``);
    if (c.quote) out.push(`- 対象テキスト: 「${c.quote}」`);
    if (c.snippet) out.push("- 該当HTML:\n```html\n" + c.snippet + "\n```");
  }
  out.push(`- 指摘 / 修正指示:\n  ${String(c.body ?? "").replace(/\n/g, "\n  ")}`);
  return out.join("\n");
}

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--line") flags.line = Number(args[++i]);
    else if (a === "--end") flags.end = Number(args[++i]);
    else if (a === "--body") flags.body = args[++i];
    else if (a === "--author") flags.author = args[++i];
    else if (a === "--note") flags.note = args[++i];
    else if (a === "--reply-to") flags.replyTo = Number(args[++i]);
    else rest.push(a);
  }
  return { flags, rest };
}

// Has the file drifted since the comment was made? Compares the recorded
// snippet against the current content (line comments: exact lines at the
// recorded position; element comments: substring match with injected
// data-line attributes stripped). undefined = can't tell.
function isStale(key, c) {
  if (!c.snippet) return undefined;
  let content;
  try {
    content = readFileSync(resolve(root, key), "utf8").replace(/\r\n?/g, "\n");
  } catch {
    return undefined;
  }
  if (c.kind === "lines") {
    const lines = content.split("\n");
    const a = c.range ? c.range[0] : c.line;
    const b = c.range ? c.range[1] : c.line;
    return lines.slice(a - 1, b).join("\n") !== c.snippet;
  }
  const plain = c.snippet.replace(/\s(?:data-line|data-md-line)="\d+"/g, "");
  return !content.includes(plain);
}

const [cmd, ...argv] = process.argv.slice(2);
const { flags, rest } = parseFlags(argv);
const store = readStore();

switch (cmd) {
  case "list": {
    const keys = rest[0] ? [keyFor(rest[0])] : Object.keys(store.files);
    if (!keys.length) {
      console.log("コメントはありません。");
      break;
    }
    for (const key of keys) {
      const list = commentsFor(store, key);
      if (!list.length) continue;
      console.log(`\n${key} (${list.length}件)`);
      for (const c of list) {
        const mark = c.resolved ? "✓" : "・";
        const who = c.author === "ai" ? " [AI]" : "";
        const reply = c.replyTo ? ` ↪#${c.replyTo}` : "";
        console.log(`  ${mark} #${c.id} ${locator(c)}${who}${reply}: ${String(c.body ?? "").split("\n")[0]}`);
        if (c.resolved && c.resolutionNote) console.log(`      └ 対応メモ: ${c.resolutionNote}`);
      }
    }
    break;
  }

  case "json": {
    if (rest[0]) {
      const key = keyFor(rest[0]);
      console.log(JSON.stringify({ file: key, comments: commentsFor(store, key) }, null, 2));
    } else {
      console.log(JSON.stringify(store, null, 2));
    }
    break;
  }

  // The AI agent's work list: every unresolved comment in the workspace, with a
  // computed `stale` flag (file changed since the comment was made → don't
  // trust the recorded line numbers blindly; locate by snippet/intent instead).
  case "pending": {
    const out = [];
    const keys = rest[0] ? [keyFor(rest[0])] : Object.keys(store.files);
    for (const key of keys) {
      const open = commentsFor(store, key)
        .filter((c) => !c.resolved)
        .map((c) => ({ ...c, stale: isStale(key, c) }));
      if (open.length) out.push({ file: key, comments: open });
    }
    console.log(JSON.stringify(out, null, 2));
    break;
  }

  case "prompt": {
    if (!rest[0]) die("usage: ai-review prompt <file>");
    const key = keyFor(rest[0]);
    const list = commentsFor(store, key).filter((c) => !c.resolved);
    if (!list.length) {
      console.log(`(${key} に未対応のコメントはありません)`);
      break;
    }
    const parts = [
      `以下は \`${key}\` のレビューコメントです（${list.length}件）。各コメントに従ってファイルを修正してください。`,
      "",
    ];
    list.forEach((c, i) => {
      parts.push(`## コメント ${i + 1} (id: ${c.id})`);
      parts.push(formatComment(c, key));
      parts.push("");
    });
    parts.push("---");
    parts.push("修正後は、変更箇所と理由を簡潔に説明してください。対応したコメントは `ai-review resolve` で対応済みにできます。");
    console.log(parts.join("\n"));
    break;
  }

  case "add": {
    if (!rest[0] || !flags.line || !flags.body) {
      die('usage: ai-review add <file> --line N [--end M] --body "..." [--author ai]');
    }
    const key = keyFor(rest[0]);
    const list = commentsFor(store, key);
    const id = list.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
    // capture the referenced lines as a snippet for the prompt
    let snippet;
    try {
      const lines = readFileSync(resolve(root, key), "utf8").replace(/\r\n?/g, "\n").split("\n");
      const a = flags.line, b = flags.end || flags.line;
      snippet = lines.slice(a - 1, b).join("\n");
    } catch {
      snippet = undefined;
    }
    const comment = {
      id,
      kind: "lines",
      line: flags.line,
      range: flags.end && flags.end !== flags.line ? [flags.line, flags.end] : null,
      selector: flags.end && flags.end !== flags.line ? `L${flags.line}-L${flags.end}` : `L${flags.line}`,
      snippet,
      body: flags.body,
      author: flags.author === "ai" ? "ai" : "human",
      anchor: { line: flags.line },
    };
    if (flags.replyTo) comment.replyTo = flags.replyTo;
    store.files[key] = { comments: [...list, comment] };
    writeStore(store);
    console.log(`追加しました: ${key} #${id} ${comment.selector}${flags.replyTo ? ` (↪ #${flags.replyTo} への返信)` : ""}`);
    break;
  }

  case "resolve":
  case "remove": {
    if (!rest[0] || !rest[1]) die(`usage: ai-review ${cmd} <file> <id>`);
    const key = keyFor(rest[0]);
    const id = Number(rest[1]);
    const list = commentsFor(store, key);
    if (!list.some((c) => c.id === id)) die(`コメント #${id} が ${key} に見つかりません`);
    if (cmd === "resolve") {
      store.files[key] = {
        comments: list.map((c) =>
          c.id === id ? { ...c, resolved: true, ...(flags.note ? { resolutionNote: flags.note } : {}) } : c
        ),
      };
    } else {
      const next = list.filter((c) => c.id !== id);
      if (next.length) store.files[key] = { comments: next };
      else delete store.files[key];
    }
    writeStore(store);
    console.log(`${cmd === "resolve" ? "対応済みにしました" : "削除しました"}: ${key} #${id}`);
    break;
  }

  case "clear": {
    if (!rest[0]) die("usage: ai-review clear <file>");
    const key = keyFor(rest[0]);
    delete store.files[key];
    writeStore(store);
    console.log(`クリアしました: ${key}`);
    break;
  }

  default:
    console.log(`ai-review — AI Review Comments のコメントストアを読み書きするCLI

  ai-review list    [file]                コメント一覧
  ai-review json    [file]                JSONで出力（エージェント向け）
  ai-review pending [file]                未対応コメントのみJSON（stale=ファイル変更で位置ズレの可能性）
  ai-review prompt  <file>                未対応コメントをAIプロンプト形式で出力
  ai-review add     <file> --line N [--end M] --body "..." [--author ai] [--reply-to ID]
  ai-review resolve <file> <id> [--note "対応内容"]   対応済みにする
  ai-review remove  <file> <id>           削除
  ai-review clear   <file>                全削除

store: ${storePath}`);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}
