// Dev tool (not shipped): generate a self-contained HTML harness that loads the
// webview UI with a sample file and AUTO-PLAYS a scripted interaction, so a
// headless-Chrome screenshot loop can be turned into media/*.gif.
//
// Usage: node scripts/make-demo-harness.mjs <scenario> <file> <out.html>
//   scenario: "flow"   — comment in preview → Copy → show clipboard → paste to a mock AI chat
//             "toggle" — preview ⇄ source toggle, with a source-line comment
import { readFile, writeFile } from "node:fs/promises";
import { injectLineNumbers } from "/tmp/r.mjs";

const scenario = process.argv[2] || "flow";
const file = process.argv[3] || "examples/landing.html";
const out = process.argv[4] || "/tmp/demo-harness.html";

const source = await readFile(file, "utf8");
const previewHtml = injectLineNumbers(source);
const boot = {
  meta: {
    file: file.split("/").pop(),
    path: "/abs/" + file.split("/").pop(),
    dir: "/abs",
    previewKind: "html",
    defaultView: "preview",
    lang: "html",
  },
  source,
  saved: null,
  previewHtml,
};
const injected = JSON.stringify(boot).replace(/</g, "\\u003c");
const a = (f) => "/dist/webview/" + f;

const EXTRA_CSS = `
  #demo-cursor { position: fixed; width: 22px; height: 22px; z-index: 9999; pointer-events: none;
    transition: left .5s ease, top .5s ease; }
  #demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
  /* clipboard peek overlay */
  #clip { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%) scale(.96);
    width: 620px; max-width: 86vw; max-height: 70vh; overflow: auto; z-index: 200;
    background: #11151c; border: 1px solid var(--accent); border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,.6); opacity: 0; transition: all .25s; pointer-events: none; }
  #clip.show { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  #clip .clip-head { display:flex; align-items:center; gap:8px; padding:10px 14px;
    border-bottom:1px solid var(--border); font:600 12.5px -apple-system,sans-serif; color:var(--muted); }
  #clip .clip-head .dot { width:9px; height:9px; border-radius:50%; background:var(--ok); }
  #clip pre { margin:0; padding:14px 16px; font:12px ui-monospace,Menlo,monospace; color:#e6e9ef;
    white-space:pre-wrap; line-height:1.5; }
  /* mock AI chat */
  #chat { position: fixed; inset: 0; z-index: 150; background: #0c0e13; display: none;
    flex-direction: column; }
  #chat.show { display: flex; }
  #chat .chat-head { padding: 14px 20px; border-bottom:1px solid var(--border);
    font:600 14px -apple-system,sans-serif; color:#e6e9ef; display:flex; align-items:center; gap:10px; }
  #chat .logo { width:24px; height:24px; border-radius:6px; background:linear-gradient(135deg,#d97757,#c15f3c);
    display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:14px; }
  #chat .chat-body { flex:1; overflow:auto; padding: 24px; max-width: 820px; margin:0 auto; width:100%; }
  #chat .msg { background:#171a21; border:1px solid var(--border); border-radius:12px; padding:14px 16px;
    font:13.5px -apple-system,sans-serif; color:#e6e9ef; white-space:pre-wrap; line-height:1.55; }
  #chat .chat-input { max-width:820px; margin:0 auto; width:100%; padding: 0 24px 24px; }
  #chat .box { display:flex; gap:10px; align-items:flex-end; background:#171a21; border:1px solid var(--border);
    border-radius:14px; padding:12px 14px; }
  #chat textarea { flex:1; background:transparent; border:none; resize:none; color:#e6e9ef;
    font:13.5px -apple-system,sans-serif; line-height:1.5; outline:none; max-height:200px; }
  #chat .send { background:var(--accent); color:#fff; border:none; border-radius:10px; width:36px; height:36px;
    font-size:16px; cursor:pointer; flex:0 0 auto; }
`;

const SHELL = `
<div id="app"><main id="stage"><div id="toolbar"><span id="file-label">…</span>
<div id="view-toggle" class="seg" hidden><button id="view-preview" class="seg-btn">👁 Preview</button><button id="view-source" class="seg-btn">&lt;&gt; Source</button></div>
<span class="spacer"></span><button id="mode-element" class="mode-btn">⬚ Element</button><button id="mode-text" class="mode-btn active">✎ Text</button><button id="mode-off" class="mode-btn">✋ Off</button>
<button id="open-settings" class="icon-btn">⚙</button><button id="toggle-panel" class="icon-btn">⟩</button></div><div id="frame-wrap"></div></main>
<div id="resizer"></div><aside id="panel"><header><h1>Comments</h1><span id="count" class="badge">0</span><span class="spacer"></span><button id="collapse-panel" class="icon-btn">⟩</button></header>
<div id="hint" class="hint">Click an element / line or drag a range on the left to add a comment.</div><ul id="comments"></ul>
<footer><button id="copy" class="primary" disabled>📋 Copy AI prompt</button><button id="clear" class="ghost" disabled>Clear all</button><div id="copied-toast" class="toast">Copied</div></footer></aside></div>
<button id="show-panel" class="show-panel hidden">⟨ Comments</button>
<div id="settings" class="drawer hidden"><div class="drawer-head"><h2>Settings</h2><button id="settings-close" class="icon-btn">✕</button></div><div class="drawer-body"><label class="field-label">t</label><select id="template-select"></select><p class="field-help">h</p><label class="field-label">b</label><textarea id="template-body" rows="10"></textarea><div class="field-vars">v</div><div class="drawer-actions"><button id="template-reset" class="ghost">r</button><button id="template-save" class="primary">s</button></div><div class="drawer-preview-wrap"><label class="field-label">p</label><pre id="template-preview" class="drawer-preview"></pre></div></div></div>
<div id="settings-backdrop" class="backdrop hidden"></div>
<div id="composer" class="composer hidden"><div class="composer-target" id="composer-target"></div><textarea id="composer-input" rows="3" placeholder="Write your note / revision request…"></textarea><div class="composer-actions"><button id="composer-cancel" class="ghost">Cancel</button><button id="composer-save" class="primary">Add</button></div></div>
<div id="demo-cursor"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2 L3 20 L8 15 L11 22 L14 21 L11 14 L18 14 Z" fill="#fff" stroke="#222" stroke-width="1.2"/></svg></div>
<div id="clip"><div class="clip-head"><span class="dot"></span> Clipboard — AI prompt</div><pre id="clip-text"></pre></div>
<div id="chat"><div class="chat-head"><span class="logo">AI</span> Assistant</div><div class="chat-body"><div class="msg" id="chat-msg" style="display:none"></div></div><div class="chat-input"><div class="box"><textarea id="chat-ta" rows="1" placeholder="Reply to AI…"></textarea><button class="send">↑</button></div></div></div>
`;

const BRIDGE = `
  const vscode = { postMessage(){} };
  const BOOT = ${injected};
  if (BOOT.previewHtml) window.__PREVIEW_HTML__ = BOOT.previewHtml;
  const _ls = {};
  Object.defineProperty(window, "localStorage", { configurable:true, value:{
    getItem:(k)=>(k in _ls?_ls[k]:null), setItem:(k,v)=>{_ls[k]=v;}, removeItem:(k)=>{delete _ls[k];} }});
  const _rf = window.fetch.bind(window);
  window.fetch = (u,o)=>{u=String(u);
    if(u==="/__meta")return Promise.resolve(new Response(JSON.stringify(BOOT.meta),{headers:{"content-type":"application/json"}}));
    if(u==="/__source")return Promise.resolve(new Response(BOOT.source,{headers:{"content-type":"text/plain"}}));
    return _rf(u,o);};
  // capture the copied prompt so the demo can display + "paste" it
  window.__CLIP = "";
  if(!navigator.clipboard)navigator.clipboard={};
  navigator.clipboard.writeText=(t)=>{ window.__CLIP = t; return Promise.resolve(); };
`;

const HELPERS = `
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const cursor = document.getElementById("demo-cursor");
  function moveTo(el){ const r=el.getBoundingClientRect(); cursor.style.left=(r.left+r.width/2)+"px"; cursor.style.top=(r.top+r.height/2)+"px"; }
  function moveToFrameEl(el){ const fr=document.getElementById("target").getBoundingClientRect(); const r=el.getBoundingClientRect();
    cursor.style.left=(fr.left+r.left+r.width/2)+"px"; cursor.style.top=(fr.top+r.top+r.height/2)+"px"; }
  // dispatch a real mousemove inside the iframe so the extension's hover
  // highlight (the light-blue box) shows, just like a user hovering.
  function hoverFrameEl(el){ const d=document.getElementById("target").contentDocument;
    const r=el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,view:d.defaultView})); }
  function typeInto(el, text){ el.focus(); el.value=""; return (async()=>{ for(const ch of text){ el.value+=ch; await sleep(40);} })(); }
  async function waitFrame(){ let n=0,d=null; while(n++<150){ const f=document.getElementById("target"); d=f&&f.contentDocument; if(d&&d.querySelector("[data-line]")) break; await sleep(100);} await sleep(600); return d; }
`;

const FLOW = `
  ${HELPERS}
  window.__DEMO_DONE = false;
  (async () => {
    const d = await waitFrame();
    // 1) comment on the hero button — hover first to show the highlight box
    const btn = d.querySelector("header.hero a.btn");
    moveToFrameEl(btn); hoverFrameEl(btn); await sleep(1100); btn.click(); await sleep(500);
    const input = document.getElementById("composer-input");
    moveTo(input); await sleep(300);
    await typeInto(input, "このボタンの文言を「30秒で無料登録」に変えて");
    await sleep(500);
    const save = document.getElementById("composer-save");
    moveTo(save); await sleep(400); save.click(); await sleep(700);
    // 2) second comment — use the centre feature so its pin stays on-screen
    const feat = d.querySelector("#features .feature:nth-of-type(2) h3");
    moveToFrameEl(feat); hoverFrameEl(feat); await sleep(1000); feat.click(); await sleep(400);
    await typeInto(document.getElementById("composer-input"), "この見出しをもっと具体的にしたい");
    await sleep(400);
    moveTo(document.getElementById("composer-save")); await sleep(300);
    document.getElementById("composer-save").click(); await sleep(700);
    // 3) Copy → show what landed on the clipboard
    const copy = document.getElementById("copy");
    moveTo(copy); await sleep(500); copy.click(); await sleep(400);
    const clip = document.getElementById("clip");
    document.getElementById("clip-text").textContent = window.__CLIP;
    clip.classList.add("show"); await sleep(3200);
    clip.classList.remove("show"); await sleep(400);
    // 4) open a mock AI chat and "paste" + send the prompt
    const chat = document.getElementById("chat");
    chat.classList.add("show"); await sleep(500);
    const ta = document.getElementById("chat-ta");
    ta.value = window.__CLIP; ta.style.height = "160px"; await sleep(900);
    const sendBtn = chat.querySelector(".send"); moveTo(sendBtn); await sleep(500);
    // send: move prompt into a message bubble
    const msg = document.getElementById("chat-msg");
    msg.textContent = window.__CLIP; msg.style.display = "block";
    ta.value = ""; ta.style.height = "auto"; await sleep(1800);
    window.__DEMO_DONE = true;
  })();
`;

const TOGGLE = `
  ${HELPERS}
  window.__DEMO_DONE = false;
  (async () => {
    const d = await waitFrame();
    // comment in preview first (hover to show the highlight)
    const h = d.querySelector("header.hero h1");
    moveToFrameEl(h); hoverFrameEl(h); await sleep(1100); h.click(); await sleep(400);
    await typeInto(document.getElementById("composer-input"), "見出しを短くしたい");
    await sleep(300); document.getElementById("composer-save").click(); await sleep(800);
    // switch to Source
    const toSrc = document.getElementById("view-source");
    moveTo(toSrc); await sleep(600); toSrc.click(); await sleep(900);
    // comment a source line (GitHub-style inline)
    let row=null,n=0; while(n++<100){ row=document.querySelector('.src-line[data-line="6"]'); if(row)break; await sleep(80); }
    moveTo(row); await sleep(500);
    const b=row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:b.left+80,clientY:b.top+2}));
    row.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:b.left+80,clientY:b.top+2}));
    await sleep(500);
    const ci=document.querySelector(".src-composer-input");
    if(ci){ await typeInto(ci, "このスタイル指定をまとめたい"); await sleep(400);
      document.querySelector(".src-save").click(); await sleep(800); }
    // switch back to Preview
    const toPrev = document.getElementById("view-preview");
    moveTo(toPrev); await sleep(700); toPrev.click(); await sleep(1400);
    window.__DEMO_DONE = true;
  })();
`;

const SCRIPT = scenario === "toggle" ? TOGGLE : FLOW;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="stylesheet" href="${a("styles.css")}">
<style>${EXTRA_CSS}</style></head><body>
${SHELL}
<script>${BRIDGE}</script>
<script type="module">
  import "${a("boot.js")}";
  ${SCRIPT}
</script>
</body></html>`;

await writeFile(out, html);
console.log("wrote", out, "(scenario:", scenario + ")");
