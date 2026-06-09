// Build the extension host bundle (src/extension.ts → dist/extension.js) and
// copy the webview assets into dist/webview so they ship in the .vsix.
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function copyWebview() {
  await mkdir("dist/webview", { recursive: true });
  await cp("webview", "dist/webview", { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
});

await rm("dist", { recursive: true, force: true });
await ctx.rebuild();
await copyWebview();

if (watch) {
  await ctx.watch();
  console.log("watching…");
} else {
  await ctx.dispose();
}
