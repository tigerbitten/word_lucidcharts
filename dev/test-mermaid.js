// Runs mermaid.js over every fixture (dev/fixtures/*.json, saved by
// dev/contents.js or hand-made) and writes each page's output next to it as
// <name>.<page>.mmd, so a translator change shows up in `git diff`. Then checks
// every output with the real Mermaid parser (the version the pane pins) in the
// test Chrome. `--render <name>` also draws that fixture's pages to
// <name>.<page>.png in dev/fixtures/renders/ (gitignored) for a look.
//   node dev/test-mermaid.js [--render <name>]
const fs = require("fs"), path = require("path");
const { pageToMermaid } = require("../mermaid.js");
const DIR = path.join(__dirname, "fixtures");
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs";
const render = process.argv[2] === "--render" ? process.argv[3] : null;
// `--check a.mmd b.mmd`: only parse those files (trying out Mermaid syntax).
const check = process.argv[2] === "--check" ? process.argv.slice(3) : null;

// The pane's script must at least compile: a syntax error there only shows as
// every function being undefined in Word.
const pane = fs.readFileSync(path.join(__dirname, "..", "taskpane.html"), "utf8");
new (require("vm").Script)(pane.slice(pane.lastIndexOf("<script>") + 8, pane.lastIndexOf("</script>")), { filename: "taskpane.html <script>" });

const outputs = check ?check.map(f => ({ name: f, out: f, mmd: fs.readFileSync(f, "utf8"), title: "" })) : [];
if (!check) for (const file of fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort()) {
  const name = file.slice(0, -5);
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, file)));
  doc.pages.forEach((page, i) => {
    const mmd = pageToMermaid(page);
    const out = `${name}.${i + 1}.mmd`;
    fs.writeFileSync(path.join(DIR, out), mmd + "\n");
    outputs.push({ name, out, mmd, title: page.title });
  });
}

(async () => {
  const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  let tab = tabs.find(t => t.type === "page" && t.url.startsWith("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/README"));
  // A page on jsDelivr's origin, so the module import is same-origin and nothing else on the tab runs.
  if (!tab) tab = await (await fetch("http://127.0.0.1:9222/json/new?https://cdn.jsdelivr.net/npm/mermaid@11.17.2/README.md", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(++id, m => m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await new Promise(r => setTimeout(r, 1500));
  // Same settings as the pane (taskpane.html loadMermaid).
  await evaluate(`window.mm || (window.mm = import(${JSON.stringify(MERMAID_URL)}).then(({ default: m }) => {
    m.initialize({ startOnLoad: false, htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: false } }); return m; }))`);
  let failed = 0;
  for (const o of outputs) {
    const err = await evaluate(`window.mm.then(m => m.parse(${JSON.stringify(o.mmd)})).then(() => null, e => String(e.message || e))`);
    if (err) { failed++; console.log(`FAIL ${o.out} (${o.title}): ${err.split("\n").slice(0, 3).join(" | ")}`); }
    else console.log(`ok   ${o.out} (${o.title})`);
  }
  if (render) {
    fs.mkdirSync(path.join(DIR, "renders"), { recursive: true });
    for (const o of outputs.filter(o => o.name === render)) {
      const size = await evaluate(`window.mm.then(async m => {
        const { svg } = await m.render("r" + Date.now(), ${JSON.stringify(o.mmd)});
        document.body.innerHTML = '<div id="out" style="display:inline-block;background:#fff;padding:8px">' + svg + '</div>';
        document.body.style.margin = 0;
        const b = document.getElementById("out").getBoundingClientRect();
        return { width: Math.ceil(b.width), height: Math.ceil(b.height) };
      })`);
      await send("Page.bringToFront");
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
      const file = path.join(DIR, "renders", o.out.replace(/\.mmd$/, ".png"));
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log("rendered", file, size.width + "x" + size.height);
    }
  }
  ws.close();
  console.log(`${outputs.length - failed}/${outputs.length} pages parse`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
