// Keeps a CDP connection open and answers every request for the add-in's
// GitHub Pages files from the local repo, so a change is live on the next pane
// reload with no push. Same URL, so Lucid's embed origin still matches.
// Runs until killed.
const fs = require("fs");
const REPO = require("path").join(__dirname, "..") + "/";
const PREFIX = "https://tigerbitten.github.io/word_lucidcharts/";
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript", png: "image/png", svg: "image/svg+xml", css: "text/css" };

(async () => {
  const v = await (await fetch("http://127.0.0.1:9222/json/version")).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    pending.set(++id, m => m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // Every page and iframe (the pane is an iframe inside Word's editor iframe)
    // gets interception, and its own children auto-attached, paused until
    // interception is on so a new pane's first requests can't slip past.
    if (m.method === "Target.attachedToTarget") {
      const s = m.params.sessionId, type = m.params.targetInfo.type;
      if (type === "page" || type === "iframe") {
        await send("Fetch.enable", { patterns: [{ urlPattern: PREFIX + "*" }] }, s).catch(e => console.log(e.message));
        await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(e => console.log(e.message));
      }
      return send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
    }
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    const file = request.url.slice(PREFIX.length).split(/[?#]/)[0] || "taskpane.html";
    const path = REPO + file;
    if (!fs.existsSync(path)) {
      console.log("pass  ", request.url);
      return send("Fetch.continueRequest", { requestId }, m.sessionId).catch(e => console.log(e.message));
    }
    const body = fs.readFileSync(path);
    console.log("local ", file, body.length, "bytes");
    send("Fetch.fulfillRequest", { requestId, responseCode: 200, body: body.toString("base64"), responseHeaders: [
      { name: "Content-Type", value: TYPES[file.split(".").pop()] || "application/octet-stream" },
      { name: "Cache-Control", value: "no-store" },
    ] }, m.sessionId).catch(e => console.log(e.message));
  };
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  console.log("serving", PREFIX, "from", REPO);
})().catch(e => { console.error(e.message); process.exit(1); });
