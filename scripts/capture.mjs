// Dev tool: drive a demo harness in headless Chrome, capturing periodic
// screenshots to /tmp/frames, until window.__DEMO_DONE. Frames → ffmpeg → gif
// is done by the caller (see scripts/make-gifs.sh).
import { writeFile, mkdir, rm } from "node:fs/promises";

const dbgPort = process.argv[2];
const urlPart = process.argv[3];
const maxMs = Number(process.argv[4] || 20000);

await rm("/tmp/frames", { recursive: true, force: true });
await mkdir("/tmp/frames", { recursive: true });

const base = `http://127.0.0.1:${dbgPort}`;
const list = await (await fetch(base + "/json")).json();
const page = list.find((t) => t.url.includes(urlPart) && t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const p = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p.has(m.id)) {
    p.get(m.id)(m);
    p.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    p.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");

const shot = async (n) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) await writeFile(`/tmp/frames/f${String(n).padStart(4, "0")}.png`, Buffer.from(r.result.data, "base64"));
};

let n = 0;
let doneAt = null;
const t0 = Date.now();
while (Date.now() - t0 < maxMs) {
  await shot(n++);
  const done = (await send("Runtime.evaluate", { expression: "window.__DEMO_DONE===true", returnByValue: true })).result?.result?.value;
  if (done && doneAt === null) doneAt = Date.now();
  if (doneAt && Date.now() - doneAt > 1500) break;
  await new Promise((r) => setTimeout(r, 80));
}
console.log("frames:", n);
ws.close();
