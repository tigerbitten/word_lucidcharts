// Saves a Lucid document's raw contents (GET /documents/{id}/contents) as a
// translator fixture: node dev/contents.js <doc id or URL> <name>
// -> dev/fixtures/<name>.json. Asks Lucid through the pane in the test Word
// (dev/cdp.js), which holds the Lucid sign-in.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [, , arg, name] = process.argv;
const id = (arg || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
if (!id || !name) throw new Error("usage: node dev/contents.js <doc id or URL> <name>");

const doc = JSON.parse(execFileSync("node", [path.join(__dirname, "cdp.js"), "eval", "taskpane.html",
  `Promise.all([docInfo("${id}"), fetchContents("${id}")]).then(([info, contents]) => ({ id: "${id}", title: info.title, version: info.version, ...contents }))`],
  { encoding: "utf8", maxBuffer: 1e9 }));
const out = path.join(__dirname, "fixtures", name + ".json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 1));
for (const p of doc.pages) {
  const shapes = p.items.shapes || [], lines = p.items.lines || [];
  const classes = {};
  for (const s of shapes) classes[s.class] = (classes[s.class] || 0) + 1;
  console.log(`${p.title}: ${shapes.length} shapes, ${lines.length} lines`, classes);
}
console.log("wrote", out);
