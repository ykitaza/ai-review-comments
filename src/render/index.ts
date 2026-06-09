import { extname } from "node:path";
import type { PreviewKind } from "../types.js";
import { renderMarkdownDoc } from "./markdown.js";
import { injectLineNumbers } from "./html.js";

const PREVIEW_KIND_BY_EXT: Record<string, PreviewKind> = {
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
};

const LANG_BY_EXT: Record<string, string> = {
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".csv": "csv",
  ".txt": "text",
  ".js": "javascript",
  ".ts": "typescript",
  ".css": "css",
  ".toml": "toml",
  ".ini": "ini",
  ".sh": "shell",
};

export function previewKindFor(filePath: string): PreviewKind {
  return PREVIEW_KIND_BY_EXT[extname(filePath).toLowerCase()] || "none";
}

export function langFor(filePath: string): string {
  return LANG_BY_EXT[extname(filePath).toLowerCase()] || "text";
}

/** Build the preview HTML for a file, or null if it has no preview. */
export function renderPreview(filePath: string, source: string): string | null {
  const kind = previewKindFor(filePath);
  if (kind === "markdown") return renderMarkdownDoc(source);
  if (kind === "html") return injectLineNumbers(source);
  return null;
}

export { renderMarkdownDoc, injectLineNumbers };
