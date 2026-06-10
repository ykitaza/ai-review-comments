// Thin typed re-export. The implementations live in shared/render.mjs (plain
// JS) so the build-free CLI server uses the exact same code as the extension.
export {
  renderMarkdownDoc,
  injectLineNumbers,
  previewKindFor,
  langFor,
  renderPreview,
} from "../../shared/render.mjs";
