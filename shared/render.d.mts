// Type declarations for the shared plain-JS render module (single source of
// truth used by both the extension host and the build-free CLI server).
export function escapeHtml(s: string): string;
export function renderInline(s: string): string;
export function renderMarkdownBody(md: string, options?: { baseDir?: string }): Promise<string>;
export function renderMarkdownDoc(md: string, options?: { baseDir?: string }): Promise<string>;
export function injectLineNumbers(html: string): string;
export function previewKindFor(filePath: string): "html" | "markdown" | "none";
export function langFor(filePath: string): string;
export function renderPreview(filePath: string, source: string): Promise<string | null>;
