// Prototype backend, one machine only: holds the Lucid client secret, does
// OAuth, mints embed session tokens and exports diagrams as PNG.
// Run: node server.js
// Needs localhost.pem + localhost-key.pem (mkcert localhost; Lucid requires an
// https redirect URI) and a .env with LUCID_CLIENT_ID and LUCID_CLIENT_SECRET.
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const { pageToMermaid } = require("./mermaid.js");

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const { LUCID_CLIENT_ID: ID, LUCID_CLIENT_SECRET: SECRET } = process.env;
if (!ID || !SECRET) throw new Error("set LUCID_CLIENT_ID and LUCID_CLIENT_SECRET in .env");

const PORT = 3000;
const REDIRECT = `https://localhost:${PORT}/callback`;
const SCOPES = ["offline_access", "lucidchart.document.app.picker.share.embed", "lucidchart.document.content:readonly"];
const PANE_ORIGIN = "https://tigerbitten.github.io";
// Export resolution: enough DPI for TARGET_PPI pixels per inch at the size the
// picture is shown in Word, and at least BASE_DPI (what a first export of an
// unknown diagram uses, to learn its size). Lucid caps exports at roughly 10
// megapixels whatever DPI is asked for, and big DPIs are slow (600 is ~5s).
const BASE_DPI = 192;
const TARGET_PPI = 400;
const MAX_DPI = 800;
// A planned export stays under this, clear of Lucid's ~10 MP cap: rounding the
// DPI up used to push page-sized diagrams over it, which made Lucid shrink the
// export and the size check below forget the diagram (two exports every time).
const PLAN_PIXELS = 8.9e6;
const MAX_WIDTH_PT = 468; // 6.5in: new pictures fit the text width of a Letter page with 1in margins
// 8.5in: and its 9in text height, leaving room for the caption line under the picture.
const MAX_HEIGHT_PT = 612;
// Tokens survive restarts so you don't sign in every time. Gitignored.
const TOKEN_FILE = ".lucid-token.json";

let tokens = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) : null;
let loginState = null; // OAuth state param, so /callback only accepts a sign-in we started

// An error whose message is meant for the person using the pane.
class Shown extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function signOut() {
  tokens = null;
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}

async function tokenRequest(body) {
  const r = await fetch("https://api.lucid.co/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, client_id: ID, client_secret: SECRET }),
  });
  const json = await r.json();
  console.log("oauth2/token", body.grant_type, r.status, r.ok ? json.scopes || json.scope : json);
  if (!r.ok) return null;
  tokens = { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000 };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens), { mode: 0o600 }); // a Lucid sign-in: owner only (no effect on Windows)
  return tokens;
}

// Lucid access tokens last about an hour; refresh a minute early. One refresh at
// a time: refresh tokens are single-use, so a second concurrent refresh would fail.
let refreshing = null;
async function accessToken() {
  if (tokens && Date.now() > tokens.expires - 60000) {
    refreshing = refreshing || (tokens.refresh ? tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh })
      : Promise.resolve(null)).finally(() => { refreshing = null; });
    if (!(await refreshing)) signOut();
  }
  if (!tokens) throw new Shown(401, "Not signed in to Lucid.");
  return tokens.access;
}

async function lucid(path, init = {}) {
  const r = await fetch("https://api.lucid.co" + path, { ...init, headers: {
    ...init.headers, "Lucid-Api-Version": "1", Authorization: "Bearer " + (await accessToken()) } });
  console.log(" ", init.method || "GET", path, r.status);
  if (r.ok) return r;
  const body = await r.text();
  console.log("  ", body.slice(0, 300));
  if (r.status === 401) { signOut(); throw new Shown(401, "Your Lucid sign-in expired. Sign in again."); }
  if (r.status === 403) throw new Shown(403, "Lucid refused the request (403): either your account can't open this diagram, "
    + "or the Lucid OAuth client is missing one of the scopes " + SCOPES.join(", ") + " (add it, then sign in again). Lucid said: " + body.slice(0, 200));
  if (r.status === 404) throw new Shown(404, "Lucid couldn't find that diagram, or your account can't open it.");
  throw new Shown(502, `Lucid returned ${r.status}: ${body.slice(0, 200)}`);
}

const routes = {
  "/status": async () => ({ signedIn: !!tokens }),

  "/login": async (url, res) => {
    loginState = crypto.randomUUID();
    res.writeHead(302, { Location: "https://lucid.app/oauth2/authorize?" + new URLSearchParams({
      client_id: ID, redirect_uri: REDIRECT, scope: SCOPES.join(" "), response_type: "code", state: loginState }) });
    res.end();
  },

  "/callback": async (url, res) => {
    const page = msg => { res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Lucid sign-in</title><body style="font:16px Segoe UI,sans-serif;margin:3rem">${msg}</body>`); };
    const error = url.searchParams.get("error");
    if (error) return page("Sign-in was cancelled or refused: " + error.replace(/[^\w .-]/g, ""));
    if (!loginState || url.searchParams.get("state") !== loginState) return page("This sign-in link is stale. Start again from the add-in.");
    loginState = null;
    if (!(await tokenRequest({ grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: REDIRECT })))
      return page("Lucid rejected the sign-in. The server console has the details.");
    page("Signed in to Lucid. You can close this tab and go back to Word.");
  },

  // Without an embedId the iframe shows Lucid's document picker; with one it reopens that diagram.
  "/embed-token": async url => {
    const embedId = url.searchParams.get("embedId");
    const r = await lucid("/embeds/token", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: PANE_ORIGIN, ...(embedId && { embedId }), sessionConfig: { products: ["lucidchart"] } }) });
    return { token: await r.text() };
  },

  // A new editable embed of a document, for a picture that has none (linked by
  // pasted URL), so it opens straight in the editor. Lucid only allows this for
  // documents picked in its picker at some point (403 otherwise: the pane then
  // shows the picker).
  "/embed": async url => {
    const r = await lucid(`/documents/${docId(url)}/embeds`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedVersion: "latest-version", accessLevel: "edit" }) });
    return { embedId: (await r.json()).embedId };
  },

  // Title and version (bumped on every saved edit), so the pane can tell whether a picture is out of date.
  "/info": async url => {
    const doc = await docInfo(docId(url));
    return { title: doc.title, version: doc.version };
  },

  // `shownPt` is the width the picture will have in Word (an updated picture
  // keeps its width); without it, a new picture's width: natural size capped so
  // the picture fits the page. `page` is a Lucid page id; without it, the first page. The pane
  // calls this when the pointer reaches its buttons, so by the click the PNG is
  // usually cached already.
  "/export": async url => {
    const id = docId(url), page = pageId(url), key = id + " " + page;
    // The width the picture is shown at, and the DPI that gives it TARGET_PPI,
    // for a diagram of a given natural size (in points at 100%).
    const plan = ({ naturalPt, aspect }) => {
      const shownPt = +url.searchParams.get("shownPt") || Math.min(naturalPt, MAX_WIDTH_PT, MAX_HEIGHT_PT / aspect);
      // Rounded up to a multiple of 32 so nearby sizes share a cached export.
      const dpi = Math.min(MAX_DPI, Math.max(BASE_DPI, Math.ceil(TARGET_PPI * shownPt / naturalPt / 32) * 32));
      return { shownPt, dpi: Math.min(dpi, Math.floor(72 * Math.sqrt(PLAN_PIXELS / aspect) / naturalPt)) };
    };
    // Only an export tells the natural size, which then decides the DPI. It
    // hardly changes between edits, so the last one seen picks the DPI and one
    // export is usually enough (each is several seconds for a big diagram); a
    // first export, or a diagram that grew a lot, gets a second at the right DPI.
    // The export starts alongside the info call that says whether it's cached.
    let dpi = sizes.has(key) ? plan(sizes.get(key)).dpi : BASE_DPI;
    let { doc, value: png } = await withDoc(id, `png ${key} ${dpi}`, signal => fetchPng(id, page, dpi, signal));
    // Pixel size from the IHDR chunk, so the pane can size the picture without decoding it.
    const sizeOf = (png, dpi) => ({ naturalPt: png.readUInt32BE(16) * 72 / dpi, aspect: png.readUInt32BE(20) / png.readUInt32BE(16) });
    let size = sizeOf(png, dpi);
    const better = plan(size).dpi;
    if (better > dpi) {
      dpi = better;
      png = await versioned(`png ${key} ${dpi}`, doc.version, () => fetchPng(id, page, dpi));
      size = sizeOf(png, dpi);
    }
    // Lucid caps an export near 10 megapixels whatever the DPI, which would
    // make the diagram look smaller than it is: such sizes aren't remembered.
    if (png.readUInt32BE(16) * png.readUInt32BE(20) < 9e6) sizes.set(key, size);
    else sizes.delete(key); // so the next export learns the size again from BASE_DPI
    const { shownPt } = plan(size);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    console.log(`   export ${width}x${height} at ${dpi}dpi, ${Math.round(width / (shownPt / 72))}ppi at ${Math.round(shownPt)}pt wide`);
    return { title: doc.title, version: doc.version, base64: png.toString("base64"), width, height, naturalPt: size.naturalPt, shownPt };
  },

  // The document's pages, for the pane's page chooser. An empty page exports as
  // a blank square. A page drawn from Mermaid code in Lucid ("diagram as code",
  // LucidNativeMermaid* shapes) exports with every shape piled in one spot:
  // Lucid's export API doesn't lay those out, so the pane draws those pages
  // itself from their Mermaid (/mermaid below) instead of using /export. Mermaid
  // code that isn't a flowchart is one picture (LucidNativeMermaidDiagramBlock),
  // which exports fine.
  "/pages": async url => {
    const id = docId(url);
    const { doc, value: contents } = await withDoc(id, "contents " + id, signal => fetchContents(id, signal));
    return { version: doc.version, pages: contents.pages.map(p => {
      const shapes = (p.items || {}).shapes || [], lines = (p.items || {}).lines || [];
      return { id: p.id, title: p.title, empty: !shapes.length && !lines.length,
        fromCode: shapes.some(s => /^LucidNativeMermaid/.test(s.class) && s.class !== "LucidNativeMermaidDiagramBlock") };
    }) };
  },

  // The page as Mermaid (mermaid.js), for the picture's alt text.
  "/mermaid": async url => {
    const id = docId(url), page = pageId(url);
    const { doc, value: contents } = await withDoc(id, "contents " + id, signal => fetchContents(id, signal));
    const p = page ? contents.pages.find(p => p.id === page) : contents.pages[0];
    if (!p) throw new Shown(404, `Lucid's diagram has no page "${page}" any more.`);
    // The sizing numbers come along for pages the pane draws itself, so drawn and
    // exported pictures follow the same rules.
    // Cached per version: translating a big sequence diagram can take a second or two.
    const mermaid = await versioned(`mermaid ${id} ${p.id}`, doc.version, async () => pageToMermaid(p));
    return { title: doc.title, version: doc.version, page: p.id, pageTitle: p.title, mermaid,
      targetPpi: TARGET_PPI, maxWidthPt: MAX_WIDTH_PT, maxHeightPt: MAX_HEIGHT_PT };
  },
};

// Lucid results that only change when the document does, cached with the version they came from.
const cache = new Map();
// The last natural size seen per document page, { naturalPt, aspect }, whatever its version (/export).
const sizes = new Map();

async function versioned(key, version, fetch) {
  const c = cache.get(key);
  if (c && version != null && c.version === version) return c.value;
  const value = await fetch();
  cache.set(key, { version, value });
  return value;
}

// A slow Lucid request whose freshness depends on the document's version: it
// starts alongside the info call (which gives the version) and is abandoned
// if the cache turns out to have it already.
async function withDoc(id, key, slow) {
  const abort = new AbortController();
  const request = slow(abort.signal);
  request.catch(() => {}); // awaited below, or deliberately abandoned
  let doc;
  try { doc = await docInfo(id); } catch (e) { abort.abort(); throw e; }
  let used = false;
  const value = await versioned(key, doc.version, () => { used = true; return request; });
  if (!used) abort.abort();
  return { doc, value };
}

async function fetchPng(id, page, dpi, signal) {
  const r = await lucid(`/documents/${id}?crop=content${page ? "&pageId=" + encodeURIComponent(page) : ""}`,
    { headers: { Accept: `image/png;dpi=${dpi}` }, signal });
  const png = Buffer.from(await r.arrayBuffer());
  if (png.toString("latin1", 1, 4) !== "PNG") throw new Shown(502, "Lucid's export wasn't a PNG: " + png.toString("utf8", 0, 100));
  return png;
}

// Shapes, connectors and containment for every page (~1-4s, even for a small diagram).
async function fetchContents(id, signal) {
  return (await lucid(`/documents/${id}/contents`, { signal })).json();
}

function pageId(url) {
  const page = url.searchParams.get("page");
  if (page && !/^[\w~.-]+$/.test(page)) throw new Shown(400, "Bad page id: " + page);
  return page || "";
}

function docId(url) {
  const id = url.searchParams.get("doc");
  if (!/^[0-9a-f-]{36}$/.test(id || "")) throw new Shown(400, "Bad document id: " + id);
  return id;
}

async function docInfo(id) {
  return (await lucid("/documents/" + id, { headers: { Accept: "application/json" } })).json();
}

https.createServer({ key: fs.readFileSync("localhost-key.pem"), cert: fs.readFileSync("localhost.pem") }, async (req, res) => {
  const url = new URL(req.url, `https://localhost:${PORT}`);
  console.log(req.method, url.pathname);
  res.setHeader("Access-Control-Allow-Origin", PANE_ORIGIN);
  // Chrome asks before letting a public page reach localhost.
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const route = routes[url.pathname];
  if (!route) { res.writeHead(404); return res.end("no such route"); }
  try {
    const result = await route(url, res);
    if (result) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
  } catch (e) {
    if (!(e instanceof Shown)) console.error(e);
    res.writeHead(e.status || 500, { "Content-Type": "text/plain" });
    res.end(e instanceof Shown ? e.message : "Backend error: " + e.message);
  }
// Loopback only: this server holds your Lucid sign-in, so nothing else on the network may reach it.
}).listen(PORT, "127.0.0.1", () => console.log(`listening on https://localhost:${PORT}`));
