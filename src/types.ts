// Shared types across the extension host and (informally) the webview UI.

/** How a file is presented in the preview pane. "none" = source-only. */
export type PreviewKind = "html" | "markdown" | "none";

export type ViewMode = "preview" | "source";

/** Metadata handed to the webview at boot. */
export interface ReviewMeta {
  file: string; // basename
  path: string; // absolute path
  dir: string; // containing directory
  workspaceRoot?: string; // workspace/comment-store root when known
  storePath?: string; // absolute path to .ai-review/comments.json when known
  storeKey?: string; // workspace-relative store key when known
  previewKind: PreviewKind;
  defaultView: ViewMode;
  lang: string; // source-viewer language hint (json/yaml/markdown/…)
}

/** A single review comment (mirrors the webview's comment shape). */
export interface ReviewComment {
  id: number;
  kind: "lines" | "element" | "text";
  body: string;
  // line-based (source view)
  line?: number;
  range?: [number, number];
  path?: string; // json/yaml data path
  snippet?: string;
  quote?: string;
  selector?: string; // element view
  // preview→source mapping
  mdLine?: number;
  srcLine?: number;
  // AI collaboration
  author?: "human" | "ai";
  resolved?: boolean;
  resolutionNote?: string; // what was done when resolving (shown in the panel)
  replyTo?: number; // id of the comment this one replies to
}

/** The workspace comment store (.ai-review/comments.json). */
export interface CommentStore {
  version: 1;
  files: Record<string, { comments: ReviewComment[] }>;
}

/** The bootstrap payload injected into the webview. */
export interface BootData {
  meta: ReviewMeta;
  source: string;
  previewHtml: string | null;
  extensionVersion: string;
  loadedAt: string;
}

/** Messages sent from the webview to the extension host. */
export type WebviewMessage =
  | { type: "copy"; text: string }
  | { type: "copy-text"; text: string }
  | { type: "reveal"; line: number }
  | { type: "close" }
  | { type: "reload" }
  | { type: "load-comments"; requestId: number }
  | { type: "save-comments"; requestId: number; comments: ReviewComment[] };
