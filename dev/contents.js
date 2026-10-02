// Saves a Lucid document's raw contents (GET /documents/{id}/contents) as a
// translator fixture: node dev/contents.js <doc id or URL> <name>
// -> dev/fixtures/<name>.json. Uses the running server's token; asking the
// server for /info first makes it refresh the token if it's about to expire.
const fs = require("fs"), path = require("path");
const [, , arg, name] = process.argv;
const id = (arg || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
if (!id || !name) throw new Error("usage: node dev/contents.js <doc id or URL> <name>");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // the local server's mkcert certificate

(async () => {
  const info = await (await fetch("https://localhost:3000/info?doc=" + id)).json();
  const token = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".lucid-token.json"))).access;
  const r = await fetch(`https://api.lucid.co/documents/${id}/contents`, { headers: { "Lucid-Api-Version": "1", Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error(`contents ${r.status}: ${await r.text()}`);
  const contents = await r.json();
  const out = path.join(__dirname, "fixtures", name + ".json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ id, title: info.title, version: info.version, ...contents }, null, 1));
  for (const p of contents.pages) {
    const shapes = p.items.shapes || [], lines = p.items.lines || [];
    const classes = {};
    for (const s of shapes) classes[s.class] = (classes[s.class] || 0) + 1;
    console.log(`${p.title}: ${shapes.length} shapes, ${lines.length} lines`, classes);
  }
  console.log("wrote", out);
})().catch(e => { console.error(e.message); process.exit(1); });
