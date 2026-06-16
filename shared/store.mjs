// Comment-store helpers shared by the ai-review CLI and the browser server.
// The store is <root>/.ai-review/comments.json; root is found by walking up
// from a starting directory to the nearest .ai-review/ or .git/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join, sep, basename } from "node:path";

export const STORE_REL = ".ai-review/comments.json";

export function findRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".ai-review")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function storePathFor(root) {
  return join(root, STORE_REL);
}

/** Infer the workspace root from an explicit .ai-review/comments.json path. */
export function rootForStorePath(file) {
  const p = resolve(file);
  const dir = dirname(p);
  return basename(dir) === ".ai-review" ? dirname(dir) : dir;
}

export function readStoreSync(root, storePath = storePathFor(root)) {
  try {
    const data = JSON.parse(readFileSync(storePath, "utf8"));
    if (data && data.version === 1 && data.files) return data;
  } catch {
    /* missing or invalid */
  }
  return { version: 1, files: {} };
}

export function writeStoreSync(root, store, storePath = storePathFor(root)) {
  mkdirSync(dirname(storePath), { recursive: true });
  const json = JSON.stringify(store, null, 2) + "\n";
  writeFileSync(storePath, json);
  return json;
}

/** Normalize a path (rel or abs) to the store key: root-relative, /-separated. */
export function keyFor(root, file) {
  return relative(root, resolve(file)).split(sep).join("/");
}
