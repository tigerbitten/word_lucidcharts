// Prototype backend, one machine only: holds the Lucid client secret, does
// OAuth, and mints embed session tokens. Run: node server.js
// Needs localhost.pem + localhost-key.pem (mkcert localhost; Lucid requires an https redirect URI)
// and a .env with LUCID_CLIENT_ID and LUCID_CLIENT_SECRET (gitignored).
const https = require("https");
const fs = require("fs");

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const { LUCID_CLIENT_ID: ID, LUCID_CLIENT_SECRET: SECRET } = process.env;
if (!ID || !SECRET) throw new Error("set LUCID_CLIENT_ID and LUCID_CLIENT_SECRET in .env");

const PORT = 3000;
const REDIRECT = `https://localhost:${PORT}/callback`;
const SCOPE = "lucidchart.document.app.picker.share.embed";
const PANE_ORIGIN = "https://tigerbitten.github.io";

let accessToken = null; // in memory: restart the server, sign in again

https.createServer({ key: fs.readFileSync("localhost-key.pem"), cert: fs.readFileSync("localhost.pem") }, async (req, res) => {
  const url = new URL(req.url, `https://localhost:${PORT}`);
  console.log(req.method, url.pathname);
  res.setHeader("Access-Control-Allow-Origin", PANE_ORIGIN);
  try {
    if (url.pathname === "/login") {
      res.writeHead(302, { Location: "https://lucid.app/oauth2/authorize?" + new URLSearchParams({
        client_id: ID, redirect_uri: REDIRECT, scope: SCOPE, response_type: "code" }) });
      return res.end();
    }
    if (url.pathname === "/callback") {
      const r = await fetch("https://api.lucid.co/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: url.searchParams.get("code"),
          client_id: ID, client_secret: SECRET, redirect_uri: REDIRECT }) });
      const body = await r.json();
      console.log("token exchange", r.status, Object.keys(body));
      if (!r.ok) throw new Error("token exchange failed: " + JSON.stringify(body));
      accessToken = body.access_token;
      return res.end("Signed in. Close this tab and click Load editor in Word.");
    }
    if (url.pathname === "/embed-token") {
      if (!accessToken) { res.writeHead(401); return res.end("not signed in"); }
      const r = await fetch("https://api.lucid.co/embeds/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lucid-Api-Version": "1",
          Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ origin: PANE_ORIGIN, sessionConfig: { products: ["lucidchart"] } }) });
      const body = await r.text();
      console.log("embeds/token", r.status, body.slice(0, 80));
      if (r.status === 401) accessToken = null; // expired: force re-login
      res.writeHead(r.status);
      return res.end(body);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log("listening on " + PORT));
