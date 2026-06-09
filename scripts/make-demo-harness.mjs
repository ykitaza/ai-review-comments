// Dev tool (not shipped): generate a self-contained HTML harness that loads the
// webview UI with a sample file and AUTO-PLAYS a scripted interaction, so a
// headless-Chrome screencast can be turned into media/flow.gif.
import { readFile, writeFile } from "node:fs/promises";
import { injectLineNumbers } from "/tmp/r.mjs";

const file = process.argv[2] || "examples/landing.html";
const out = process.argv[3] || "/tmp/demo-harness.html";

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
const a = (f) => "/dist/webview/" + f; // absolute (served from repo root)

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="stylesheet" href="${a("styles.css")}">
<style>
  /* faux cursor for the demo */
  #demo-cursor { position: fixed; width: 22px; height: 22px; z-index: 9999; pointer-events: none;
    transition: left .5s ease, top .5s ease; }
  #demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
</style></head><body>
<div id="app"><main id="stage"><div id="toolbar"><span id="file-label">…</span>
<div id="view-toggle" class="seg" hidden><button id="view-preview" class="seg-btn">👁 Preview</button><button id="view-source" class="seg-btn">&lt;&gt; Source</button></div>
<span class="spacer"></span><button id="mode-element" class="mode-btn active">⬚ Element</button><button id="mode-text" class="mode-btn">✎ Text</button><button id="mode-off" class="mode-btn">✋ Off</button>
<button id="open-settings" class="icon-btn">⚙</button><button id="toggle-panel" class="icon-btn">⟩</button></div><div id="frame-wrap"></div></main>
<div id="resizer"></div><aside id="panel"><header><h1>Comments</h1><span id="count" class="badge">0</span><span class="spacer"></span><button id="collapse-panel" class="icon-btn">⟩</button></header>
<div id="hint" class="hint">Click an element / line or drag a range on the left to add a comment.</div><ul id="comments"></ul>
<footer><button id="copy" class="primary" disabled>📋 Copy AI prompt</button><button id="clear" class="ghost" disabled>Clear all</button><div id="copied-toast" class="toast">Copied</div></footer></aside></div>
<button id="show-panel" class="show-panel hidden">⟨ Comments</button>
<div id="settings" class="drawer hidden"><div class="drawer-head"><h2>Settings</h2><button id="settings-close" class="icon-btn">✕</button></div><div class="drawer-body"><label class="field-label">t</label><select id="template-select"></select><p class="field-help">h</p><label class="field-label">b</label><textarea id="template-body" rows="10"></textarea><div class="field-vars">v</div><div class="drawer-actions"><button id="template-reset" class="ghost">r</button><button id="template-save" class="primary">s</button></div><div class="drawer-preview-wrap"><label class="field-label">p</label><pre id="template-preview" class="drawer-preview"></pre></div></div></div>
<div id="settings-backdrop" class="backdrop hidden"></div>
<div id="composer" class="composer hidden"><div class="composer-target" id="composer-target"></div><textarea id="composer-input" rows="3" placeholder="Write your note / revision request…"></textarea><div class="composer-actions"><button id="composer-cancel" class="ghost">Cancel</button><button id="composer-save" class="primary">Add</button></div></div>
<div id="demo-cursor"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2 L3 20 L8 15 L11 22 L14 21 L11 14 L18 14 Z" fill="#fff" stroke="#222" stroke-width="1.2"/></svg></div>
<script>
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
  if(!navigator.clipboard)navigator.clipboard={};
  navigator.clipboard.writeText=()=>Promise.resolve();
</script>
<script type="module">
  import "${a("boot.js")}";
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const cursor = document.getElementById("demo-cursor");
  function moveTo(el){ const r=el.getBoundingClientRect(); cursor.style.left=(r.left+r.width/2)+"px"; cursor.style.top=(r.top+r.height/2)+"px"; }
  function typeInto(el, text){ el.focus(); el.value=""; return (async()=>{ for(const ch of text){ el.value+=ch; await sleep(45);} })(); }

  window.__DEMO_DONE = false;
  (async () => {
    // wait for the preview iframe to render
    let n=0; let d=null;
    while(n++<150){ const f=document.getElementById("target"); d=f&&f.contentDocument; if(d&&d.querySelector("a.btn[data-line]")) break; await sleep(100); }
    await sleep(800);
    // 1. move to the hero button and click it
    const btn = d.querySelector("header.hero a.btn");
    // map iframe-local rect to page coords for the cursor
    const fr=document.getElementById("target").getBoundingClientRect();
    const br=btn.getBoundingClientRect();
    cursor.style.left=(fr.left+br.left+br.width/2)+"px"; cursor.style.top=(fr.top+br.top+br.height/2)+"px";
    await sleep(900);
    btn.click();
    await sleep(500);
    // 2. type a comment
    const input=document.getElementById("composer-input");
    moveTo(input); await sleep(300);
    await typeInto(input, "このボタンの文言を「30秒で無料登録」に変えて");
    await sleep(500);
    // 3. save
    const save=document.getElementById("composer-save");
    moveTo(save); await sleep(400); save.click();
    await sleep(700);
    // 4. add a second comment on a feature
    const feat=d.querySelector("#features .feature:nth-of-type(3) p");
    const f2=feat.getBoundingClientRect();
    cursor.style.left=(fr.left+f2.left+f2.width/2)+"px"; cursor.style.top=(fr.top+f2.top+f2.height/2)+"px";
    await sleep(800); feat.click(); await sleep(400);
    await typeInto(document.getElementById("composer-input"), "ここに対応フォーマットの例を一行足して");
    await sleep(400);
    moveTo(document.getElementById("composer-save")); await sleep(300);
    document.getElementById("composer-save").click();
    await sleep(700);
    // 5. move to Copy and click
    const copy=document.getElementById("copy");
    moveTo(copy); await sleep(500); copy.click();
    await sleep(1500);
    window.__DEMO_DONE = true;
  })();
</script>
</body></html>`;

await writeFile(out, html);
console.log("wrote", out);
