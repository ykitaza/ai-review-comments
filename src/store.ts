// File-based comment store: .ai-review/comments.json at the workspace root.
// This is the single source of truth shared by the extension panel, the CLI,
// and any AI agent — so comments can be read AND written from outside VS Code.
import * as vscode from "vscode";
import * as path from "node:path";
import type { CommentStore, ReviewComment } from "./types.js";

export const STORE_DIR = ".ai-review";
export const STORE_FILE = "comments.json";

/** Workspace folder containing the file, or undefined when outside a workspace. */
export function workspaceRootFor(fileUri: vscode.Uri): vscode.Uri | undefined {
  return vscode.workspace.getWorkspaceFolder(fileUri)?.uri;
}

export function storeUri(root: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(root, STORE_DIR, STORE_FILE);
}

/** Store key for a file: workspace-relative path with forward slashes. */
export function storeKeyFor(root: vscode.Uri, fileUri: vscode.Uri): string {
  return path.relative(root.fsPath, fileUri.fsPath).split(path.sep).join("/");
}

export async function readStore(root: vscode.Uri): Promise<CommentStore> {
  try {
    const raw = await vscode.workspace.fs.readFile(storeUri(root));
    const data = JSON.parse(Buffer.from(raw).toString("utf8"));
    if (data && data.version === 1 && data.files) return data as CommentStore;
  } catch {
    /* missing or invalid → fresh store */
  }
  return { version: 1, files: {} };
}

export async function readComments(root: vscode.Uri, key: string): Promise<ReviewComment[]> {
  const store = await readStore(root);
  return store.files[key]?.comments ?? [];
}

export async function writeComments(
  root: vscode.Uri,
  key: string,
  comments: ReviewComment[]
): Promise<string> {
  const store = await readStore(root);
  if (comments.length) {
    store.files[key] = { comments };
  } else {
    delete store.files[key];
  }
  const json = JSON.stringify(store, null, 2) + "\n";
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, STORE_DIR));
  await vscode.workspace.fs.writeFile(storeUri(root), Buffer.from(json, "utf8"));
  return json;
}
