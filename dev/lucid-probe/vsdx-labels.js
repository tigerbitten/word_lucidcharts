// Tests the idea behind the extension without the extension: with positions, can
// loose text boxes be attached to the right arrows by a fixed rule?
// Positions come from Lucid's Visio export (editor menu: Export > Visio), which
// holds the same geometry an extension reads (bounding boxes, line points).
//   node dev/lucid-probe/vsdx-labels.js <file.vsdx> [expected.json]   (samples/ has three, two with answers)
// Prints the attachments, the Mermaid they give, and a score against expected.json
// ({lineLabels: {"src>dst": "text"}, shapeNotes: {shape: "text"}, freeNotes: [...]},
// shapes named by their text).
const fs = require("fs"), zlib = require("zlib");
const [, , file, expectedFile] = process.argv;
if (!file) throw new Error("usage: node vsdx-labels.js <file.vsdx> [expected.json]");

// A .vsdx is a zip; read one entry by name.
function unzip(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error(name + " not in " + file);
}
const xml = unzip(fs.readFileSync(file), "visio/pages/page1.xml");

// Top-level shapes only: Lucid writes each shape as a Visio group whose children are its text.
const shapesXml = xml.slice(xml.indexOf("<Shapes>") + 8, xml.lastIndexOf("</Shapes>"));
const top = [];
for (let depth = 0, i = 0, start = 0; i < shapesXml.length;) {
  const open = shapesXml.indexOf("<Shape ", i), close = shapesXml.indexOf("</Shape>", i);
  if (open !== -1 && open < close) { if (depth++ === 0) start = open; i = open + 7; }
  else { if (--depth === 0) top.push(shapesXml.slice(start, close + 8)); i = close + 8; }
}
const cell = (s, n) => { const m = s.match(new RegExp(`<Cell N="${n}" V="([^"]*)"`)); return m ? +m[1] : null; };
const text = s => [...s.matchAll(/<Text>([\s\S]*?)<\/Text>/g)].map(m => m[1].replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ").trim();
// Visio measures in inches with y up; work in points with y down.
const H = 11 * 72;
const items = top.map(s => {
  const id = s.match(/ID="(\d+)"/)[1], cls = s.match(/NameU="com\.lucidchart\.([A-Za-z0-9]+)/)?.[1] || "?";
  if (cell(s, "BeginX") != null) {
    // A line: its path is the Geometry rows, relative to the line's own box.
    const [px, py, lx, ly] = ["PinX", "PinY", "LocPinX", "LocPinY"].map(n => cell(s, n));
    const pts = [...s.matchAll(/<Row T="(?:MoveTo|LineTo)"[^>]*><Cell N="X" V="([^"]*)"[^>]*\/><Cell N="Y" V="([^"]*)"/g)]
      .map(m => [(px - lx + +m[1]) * 72, H - (py - ly + +m[2]) * 72]);
    const at = (x, y) => [cell(s, x) * 72, H - cell(s, y) * 72];
    return { id, kind: "line", cls, text: text(s), pts, begin: at("BeginX", "BeginY"), end: at("EndX", "EndY"),
      // Visio draws from begin to end; an arrowhead only at the begin means the arrow points back.
      reversed: cell(s, "BeginArrow") > 0 && !(cell(s, "EndArrow") > 0) };
  }
  const [w, h, px, py] = ["Width", "Height", "PinX", "PinY"].map(n => cell(s, n) * 72);
  // Text boxes: Lucid's text classes, or no visible border (imported ones are plain squares).
  const isText = /Text/.test(cls) || cell(s, "LineWeight") === 0 || cell(s, "LineColorTrans") === 1;
  return { id, kind: "shape", cls, text: text(s), box: [px - w / 2, H - py - h / 2, w, h], isText, frame: /Frame/.test(cls),
    font: cell(s, "Size") * 72 };
});
const byId = Object.fromEntries(items.map(i => [i.id, i]));
for (const c of xml.matchAll(/<Connect FromSheet="(\d+)" FromPart="(\d+)" ToSheet="(\d+)"/g)) {
  const line = byId[c[1]];
  line[c[2] === "9" ? "from" : "to"] = c[3]; // FromPart 9 = begin, 12 = end
}
const shapes = items.filter(i => i.kind === "shape" && !i.frame), lines = items.filter(i => i.kind === "line");
const frames = items.filter(i => i.frame);

// Distance from a box to a segment / to another box, in points.
function segBox([x1, y1], [x2, y2], [bx, by, bw, bh]) {
  // Sample the segment: plenty for diagrams, and obvious.
  let best = Infinity;
  for (let t = 0; t <= 1; t += 1 / 64) {
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    const dx = Math.max(bx - x, 0, x - bx - bw), dy = Math.max(by - y, 0, y - by - bh);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
const lineDist = (l, box) => Math.min(...l.pts.slice(1).map((p, i) => segBox(l.pts[i], p, box)));
const boxDist = ([ax, ay, aw, ah], [bx, by, bw, bh]) =>
  Math.hypot(Math.max(bx - ax - aw, 0, ax - bx - bw), Math.max(by - ay - ah, 0, ay - by - bh));

// The rule. A loose label is a text box no line touches. It belongs to the nearest
// line when that line is within REACH and no box other than the line's own two
// ends is closer (yes/no labels hug their decision shape). Otherwise it's a note on
// the nearest box within REACH, or a free note. A line takes at most one loose label:
// the closest wins, the other tries its next line.
const REACH = 36; // half an inch
// An arrow end drawn up to a box but not glued to it belongs to that box.
const pointDist = ([x, y], [bx, by, bw, bh]) => Math.hypot(Math.max(bx - x, 0, x - bx - bw), Math.max(by - y, 0, y - by - bh));
for (const l of lines) for (const [end, p] of [["from", l.begin], ["to", l.end]]) {
  if (l[end]) continue;
  const near = shapes.filter(s => !s.isText).map(s => ({ s, d: pointDist(p, s.box) })).sort((a, b) => a.d - b.d)[0];
  if (near && near.d <= REACH) { l[end] = near.s.id; l.snapped = (l.snapped || 0) + 1; }
}
for (const l of lines) if (l.reversed) [l.from, l.to] = [l.to, l.from];
const dangling = lines.filter(l => !l.from || !l.to);
if (dangling.length) console.log("Lines with an end at no box:", dangling.map(l => l.id).join(", "));
const connected = new Set(lines.flatMap(l => [l.from, l.to]));
const nodes = shapes.filter(s => connected.has(s.id) || !s.isText);
const loose = shapes.filter(s => !connected.has(s.id) && s.isText && s.text);
const label = new Map(lines.filter(l => l.text).map(l => [l.id, { text: l.text, d: 0, attached: true }]));
// A loose text in a bigger font than any box's is the diagram's title, not a label.
const nodeFont = Math.max(...nodes.map(s => s.font));
const title = loose.find(t => t.font > nodeFont);
const notes = [];
const queue = loose.filter(t => t !== title).map(t => ({ t, tried: new Set() }));
while (queue.length) {
  const q = queue.shift(), { t } = q;
  const cand = lines.filter(l => !q.tried.has(l.id)).map(l => ({ l, d: lineDist(l, t.box) })).sort((a, b) => a.d - b.d)[0];
  const nearBox = nodes.map(s => ({ s, d: boxDist(s.box, t.box) })).sort((a, b) => a.d - b.d);
  const rival = cand && nearBox.find(n => n.s.id !== cand.l.from && n.s.id !== cand.l.to);
  if (cand && cand.d <= REACH && !(rival && rival.d < cand.d)) {
    const held = label.get(cand.l.id);
    if (!held) { label.set(cand.l.id, { text: t.text, d: cand.d, t }); continue; }
    q.tried.add(cand.l.id);
    if (!held.attached && held.d > cand.d) { label.set(cand.l.id, { text: t.text, d: cand.d, t }); queue.push({ t: held.t, tried: new Set([cand.l.id]) }); }
    else queue.push(q);
    continue;
  }
  const n = nearBox[0];
  notes.push(n && n.d <= REACH ? { text: t.text, on: n.s } : { text: t.text });
}

const name = s => s.text || s.cls + s.id;
console.log("Line labels:");
for (const l of lines) console.log(`  ${name(byId[l.from])} --> ${name(byId[l.to])}${l.snapped ? " (an end unglued, snapped)" : ""}: ${label.has(l.id) ? JSON.stringify(label.get(l.id).text) + (label.get(l.id).attached ? " (on the line in Lucid)" : ` (loose, ${label.get(l.id).d.toFixed(0)}pt away)`) : "-"}`);
console.log("Title:", title ? JSON.stringify(title.text) : "-");
console.log("Notes:");
for (const n of notes) console.log(`  ${JSON.stringify(n.text)}${n.on ? " on " + name(n.on) : " (free)"}`);

// The Mermaid this gives.
const nid = new Map(nodes.map((s, i) => [s.id, "n" + (i + 1)]));
const q = s => JSON.stringify(s.replace(/"/g, "'"));
const decl = s => `${nid.get(s.id)}${s.cls.includes("Diamond") ? `{${q(s.text)}}` : `[${q(s.text)}]`}`;
// A frame is a group: its nodes go in a subgraph with the frame's title.
const inFrame = new Map();
for (const f of frames) for (const s of nodes) {
  const [x, y, w, h] = s.box, [fx, fy, fw, fh] = f.box;
  if (x >= fx && y >= fy && x + w <= fx + fw && y + h <= fy + fh) inFrame.set(s.id, f);
}
const out = [...(title ? ["---", "title: " + q(title.text), "---"] : []), "flowchart TD"];
frames.forEach((f, i) => out.push(`  subgraph frame${i + 1}[${q(f.text)}]`, ...nodes.filter(s => inFrame.get(s.id) === f).map(s => "    " + decl(s)), "  end"));
out.push(...nodes.filter(s => !inFrame.has(s.id)).map(s => "  " + decl(s)));
for (const l of lines) out.push(`  ${nid.get(l.from)} -->${label.has(l.id) ? `|${q(label.get(l.id).text)}|` : ""} ${nid.get(l.to)}`);
notes.forEach((n, i) => { out.push(`  note${i + 1}>${q(n.text)}]`); if (n.on) out.push(`  note${i + 1} -.- ${nid.get(n.on.id)}`); });
console.log("\n" + out.join("\n"));

if (expectedFile) {
  const exp = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  let right = 0, total = 0;
  const check = (what, ok) => { total++; if (ok) right++; else console.log("  WRONG:", what); };
  console.log("\nScore:");
  for (const [k, v] of Object.entries(exp.lineLabels)) {
    const [a, b] = k.split(">");
    const l = lines.find(l => byId[l.from].text === a && byId[l.to].text === b);
    if (!l) throw new Error("no line " + k);
    check(`${k} should be ${JSON.stringify(v)}, got ${JSON.stringify(label.get(l.id)?.text)}`, label.get(l.id)?.text === v);
  }
  for (const [k, v] of Object.entries(exp.shapeNotes)) check(`${JSON.stringify(v)} should be a note on ${k}`, notes.some(n => n.text === v && n.on?.text === k));
  for (const v of exp.freeNotes) check(`${JSON.stringify(v)} should be a free note`, notes.some(n => n.text === v && !n.on));
  if (exp.title) check(`${JSON.stringify(exp.title)} should be the title`, title?.text === exp.title);
  const extra = [...label.values()].filter(x => !x.attached && !Object.values(exp.lineLabels).includes(x.text));
  for (const x of extra) check(`${JSON.stringify(x.text)} wrongly put on a line`, false);
  console.log(`  ${right}/${total} right`);
}
