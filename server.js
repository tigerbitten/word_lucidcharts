// Prototype backend, one machine only: holds the Lucid client secret, does
// OAuth, mints embed session tokens and exports diagrams as PNG.
// Run: node server.js
// Needs localhost.pem + localhost-key.pem (mkcert localhost; Lucid requires an
// https redirect URI) and a .env with LUCID_CLIENT_ID and LUCID_CLIENT_SECRET.
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");

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
// Export resolution. A first export at BASE_DPI gives the diagram's natural size;
// if that leaves fewer than TARGET_PPI pixels per inch at the size the picture is
// shown in Word, it's exported again at a higher DPI. Lucid caps exports at
// roughly 10 megapixels whatever DPI is asked for, and big DPIs are slow (600 is ~5s).
const BASE_DPI = 192;
const TARGET_PPI = 400;
const MAX_DPI = 800;
const MAX_WIDTH_PT = 468; // 6.5in: new pictures fit the text width of a Letter page with 1in margins
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
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
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

  // Title and version (bumped on every saved edit), so the pane can tell whether a picture is out of date.
  "/info": async url => {
    const doc = await docInfo(docId(url));
    return { title: doc.title, version: doc.version };
  },

  // `shownPt` is the width the picture will have in Word (an updated picture
  // keeps its width); without it, a new picture's width: natural size capped to
  // the page. Exports are cached per version, and the pane calls this when the
  // pointer reaches its buttons, so by the click the PNG is usually ready.
  "/export": async url => {
    const id = docId(url);
    // The base export is the slow call (~1s), so it runs alongside the info call.
    const abort = new AbortController();
    const baseRequest = fetchPng(id, BASE_DPI, abort.signal);
    baseRequest.catch(() => {}); // awaited below, or deliberately abandoned
    let doc;
    try { doc = await docInfo(id); } catch (e) { abort.abort(); throw e; }
    let base = cachedPng(id, BASE_DPI, doc.version);
    if (base) abort.abort();
    else base = storePng(id, BASE_DPI, doc.version, await baseRequest);

    const naturalPt = base.readUInt32BE(16) * 72 / BASE_DPI;
    const shownPt = +url.searchParams.get("shownPt") || Math.min(naturalPt, MAX_WIDTH_PT);
    const basePpi = base.readUInt32BE(16) / (shownPt / 72);
    let png = base, dpi = BASE_DPI;
    if (basePpi < TARGET_PPI) {
      // Rounded up to a multiple of 32 so nearby sizes share a cached export.
      dpi = Math.min(MAX_DPI, Math.ceil(BASE_DPI * TARGET_PPI / basePpi / 32) * 32);
      png = cachedPng(id, dpi, doc.version) || storePng(id, dpi, doc.version, await fetchPng(id, dpi));
    }
    // Pixel size from the IHDR chunk, so the pane can size the picture without decoding it.
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    console.log(`   export ${width}x${height} at ${dpi}dpi, ${Math.round(width / (shownPt / 72))}ppi at ${Math.round(shownPt)}pt wide`);
    return { title: doc.title, version: doc.version, base64: png.toString("base64"), width, height, naturalPt, shownPt };
  },
};

// Exports by document and DPI, each remembered with the version it shows.
const exportCache = new Map();

function cachedPng(id, dpi, version) {
  const c = exportCache.get(id + "@" + dpi);
  return c && version != null && c.version === version ? c.png : null;
}

function storePng(id, dpi, version, png) {
  exportCache.set(id + "@" + dpi, { version, png });
  return png;
}

async function fetchPng(id, dpi, signal) {
  const r = await lucid("/documents/" + id + "?crop=content", { headers: { Accept: `image/png;dpi=${dpi}` }, signal });
  const png = Buffer.from(await r.arrayBuffer());
  if (png.toString("latin1", 1, 4) !== "PNG") throw new Shown(502, "Lucid's export wasn't a PNG: " + png.toString("utf8", 0, 100));
  return png;
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
