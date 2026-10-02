// Drives the test Chrome (dev/chrome.ps1) over the DevTools protocol on :9222.
// <urlSubstr> picks the page or iframe: taskpane.html (the pane, where Office.js
// runs), wordeditorframe (Word's ribbon and dialogs), word.cloud.microsoft (the
// whole window, for screenshots), documents/picker or embeds (Lucid).
//   node cdp.js targets
//   node cdp.js eval <urlSubstr> <js>          (await-able; result printed as JSON)
//   node cdp.js click <urlSubstr> <text|css:selector>
//   node cdp.js file <urlSubstr> <path>        (fills the frame's file input)
//   node cdp.js shot <urlSubstr> <file.png>    (hangs while the window is minimised)
const [, , cmd, sel, ...rest] = process.argv;

async function targets() { return (await fetch("http://127.0.0.1:9222/json/list")).json(); }

async function connect(substr) {
  const t = (await targets()).find(t => (t.type === "page" || t.type === "iframe") && t.url.includes(substr));
  if (!t) throw new Error("no target matching " + substr);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(++id, m => m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}

(async () => {
  if (cmd === "targets") {
    for (const t of await targets()) if (t.type === "page" || t.type === "iframe") console.log(t.type.padEnd(7), t.url.slice(0, 160));
    return;
  }
  const c = await connect(sel);
  if (cmd === "eval") {
    const r = await c.send("Runtime.evaluate", { expression: rest.join(" "), awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.exceptionDetails) { console.error("EXCEPTION", JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails)); process.exitCode = 1; }
    else console.log(JSON.stringify(r.result.value, null, 1));
  } else if (cmd === "shot") {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    require("fs").writeFileSync(rest[0], Buffer.from(r.data, "base64"));
    console.log("wrote", rest[0]);
  } else if (cmd === "click") {
    // A real (trusted) mouse click at the centre of the first element whose own
    // text is exactly rest[0] (or that matches it as a CSS selector, when it
    // starts with "css:"), in this frame's coordinates.
    const r = await c.send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
      const q = ${JSON.stringify(rest[0])};
      const el = q.startsWith("css:") ? document.querySelector(q.slice(4))
        : [...document.querySelectorAll("*")].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === q));
      if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()` });
    const p = r.result.value;
    if (!p) throw new Error("no element with text " + rest[0]);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    console.log("clicked", rest[0], "at", Math.round(p.x), Math.round(p.y));
  } else if (cmd === "file") {
    // Fills the frame's file input without the OS file dialog.
    const { root } = await c.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
    if (!nodeId) throw new Error("no file input");
    await c.send("DOM.setFileInputFiles", { nodeId, files: [rest[0]] });
    console.log("set file", rest[0]);
  } else throw new Error("unknown command " + cmd);
  c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
