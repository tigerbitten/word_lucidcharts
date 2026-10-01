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
const DPI = 192; // export resolution; the pane sizes the picture from this
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

// Lucid access tokens last about an hour; refresh a minute early.
async function accessToken() {
  if (tokens && Date.now() > tokens.expires - 60000) {
    if (!tokens.refresh || !(await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh }))) signOut();
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
  if (r.status === 403) throw new Shown(403, "Lucid refused the request (403). Check that your Lucid OAuth client allows the scopes "
    + SCOPES.join(", ") + ", then sign in again. Lucid said: " + body.slice(0, 200));
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

  "/export": async url => {
    const id = url.searchParams.get("doc");
    if (!/^[0-9a-f-]{36}$/.test(id || "")) throw new Shown(400, "Bad document id: " + id);
    const doc = await (await lucid("/documents/" + id, { headers: { Accept: "application/json" } })).json();
    const png = Buffer.from(await (await lucid("/documents/" + id + "?crop=content", {
      headers: { Accept: `image/png;dpi=${DPI}` } })).arrayBuffer());
    if (png.toString("latin1", 1, 4) !== "PNG") throw new Shown(502, "Lucid's export wasn't a PNG: " + png.toString("utf8", 0, 100));
    // Pixel size from the IHDR chunk, so the pane can size the picture without decoding it.
    return { title: doc.title, base64: png.toString("base64"), width: png.readUInt32BE(16), height: png.readUInt32BE(20), dpi: DPI };
  },
};

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
