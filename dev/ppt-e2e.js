// The pane's main flows in PowerPoint on the web (the test deck open in the
// test Chrome, dev/serve.js running, the manifest uploaded there; see
// CLAUDE.md): rebuilds the deck as a title slide, a "Title and Content" slide
// and a blank one, then checks Insert (into the content placeholder, and in the
// middle of a blank slide), Update after moving and resizing, Update all, the
// menu's "In this document" and the MD view. Uses the "Order intake flow v2"
// Lucid document, or with --stub a drawn picture (dev/stub.js, no sign-in).
//   node dev/ppt-e2e.js [--stub]
const { execFileSync } = require("child_process");
const path = require("path");
const DOC = "b5dd4969-1851-44b4-80e6-0f50639358e4";
const STUB = process.argv[2] === "--stub";
const run = (...args) => execFileSync("node", [path.join(__dirname, "cdp.js"), ...args], { encoding: "utf8" }).trim();
const pane = js => JSON.parse(run("eval", "taskpane.html|powerpoint", js));
const click = id => run("click", "taskpane.html|powerpoint", "css:#" + id);
const status = () => pane(`document.getElementById("status").textContent`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 60; i++) { await sleep(1000); if (!pane("busy")) return; } throw new Error("pane still busy after 60s"); };
// Every slide's shapes: [{ slide, shapes: [{ name, type, box: [left, top, width, height], tag, alt }] }].
const deck = () => pane(`ppt(async ctx => {
  const slides = ctx.presentation.slides.load("items/id"); await ctx.sync();
  const shapes = slides.items.map(s => s.shapes.load("items/name,items/type,items/left,items/top,items/width,items/height")); await ctx.sync();
  const tags = shapes.map(c => c.items.map(s => ({ tag: s.tags.getItemOrNullObject("LUCID").load("value"), alt: s.type === "GeometricShape" ? s.load("altTextDescription") : null })));
  await ctx.sync();
  return slides.items.map((s, i) => ({ slide: s.id, shapes: shapes[i].items.map((x, j) => ({ name: x.name, type: x.type,
    box: [x.left, x.top, x.width, x.height].map(Math.round), tag: tags[i][j].tag.isNullObject ? "" : tags[i][j].tag.value, alt: tags[i][j].alt ? tags[i][j].alt.altTextDescription : "" })) }));
})`);
const select = slide => pane(`ppt(async ctx => { ctx.presentation.setSelectedSlides(["${slide}"]); await ctx.sync(); return 1; })`);
const ours = slide => slide.shapes.filter(s => s.tag);
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ": " + JSON.stringify(detail)}`); if (!ok) failed++; };

(async () => {
  pane("location.reload(), 1");
  await sleep(10000);
  check("pane starts in PowerPoint, without the Caption box", pane(`inPpt && document.getElementById("captionOpt").hidden && document.getElementById("status").textContent !== "Starting..."`), status());

  // The deck: slide 1 kept (title slide) and cleared of shapes that aren't placeholders, then a "Title and Content" slide and a blank one.
  let slides = pane(`ppt(async ctx => {
    const slides = ctx.presentation.slides.load("items/id"); await ctx.sync();
    slides.items.slice(1).forEach(s => s.delete());
    const first = slides.items[0].shapes.load("items/type"); await ctx.sync();
    first.items.filter(s => s.type !== "Placeholder").forEach(s => s.delete());
    const layouts = ctx.presentation.slideMasters.getItemAt(0).layouts.load("items/id,items/name"); await ctx.sync();
    for (const name of ["Title and Content", "Blank"]) ctx.presentation.slides.add({ layoutId: layouts.items.find(l => l.name === name).id });
    await ctx.sync();
    const now = ctx.presentation.slides.load("items/id"); await ctx.sync();
    return now.items.map(s => s.id);
  })`);
  // New slides take a moment to get their placeholders and their lasting ids.
  await sleep(3000);
  slides = pane(`ppt(async ctx => { const slides = ctx.presentation.slides.load("items/id"); await ctx.sync();
    slides.items[1].shapes.getItemAt(0).textFrame.textRange.text = "Order intake"; await ctx.sync(); return slides.items.map(s => s.id); })`);
  check("test deck rebuilt", slides.length === 3, slides);

  if (STUB) pane(require("./stub.js"));
  else pane(`newEmbed("${DOC}").then(async embedId => { await loadEditor(embedId);
    onLucidMessage({ type: "LucidEmbedEvent", event: "EmbedCreated", documentId: "${DOC}", embedId }); return 1; })`);
  await sleep(5000);

  select(slides[1]); await sleep(1500);
  click("insert"); await settle();
  let d = deck();
  const [pic] = ours(d[1]);
  check("Insert on a Title and Content slide fills its content placeholder", pic && d[1].shapes.length === 2 && pic.box[1] >= 140 && pic.box[0] >= 60 && pic.box[2] <= 830, d[1].shapes);
  check("…and keeps the title", d[1].shapes.some(s => s.type === "Placeholder"), d[1].shapes);
  check("…with the Mermaid in its tag and its alt text", pic && /```mermaid/.test(pic.tag) && pic.alt === pic.tag, pic && pic.tag.slice(0, 80));

  select(slides[2]); await sleep(1500);
  click("insert"); await settle();
  d = deck();
  const [mid] = ours(d[2]);
  check("Insert on a blank slide puts the picture in the middle", mid && Math.abs(mid.box[0] * 2 + mid.box[2] - 960) <= 2 && Math.abs(mid.box[1] * 2 + mid.box[3] - 540) <= 2, mid);

  // Moved and shrunk by hand, then Update (nothing selected: the picture last inserted).
  pane(`ppt(async ctx => { const s = ctx.presentation.slides.getItem("${slides[2]}").shapes.load("items/name"); await ctx.sync();
    const p = s.items.find(x => x.name === "${mid && mid.name}"); Object.assign(p, { left: 40, top: 30, width: 300, height: 300 * ${mid ? mid.box[3] / mid.box[2] : 1} }); await ctx.sync(); return 1; })`);
  await pane(`readSelection().then(() => 1)`);
  click("replace"); await settle();
  d = deck();
  const [moved] = ours(d[2]);
  check("Update keeps the picture's place and width", ours(d[2]).length === 1 && moved.box[0] === 40 && moved.box[1] === 30 && moved.box[2] === 300, d[2].shapes);
  check("…and says what it did", /^(Updated|"|Added)/.test(status()), status());

  pane(`docPictures.forEach(p => latestOf.set(p.documentId, { version: 1e9, title: p.title })), refreshButtons(), 1`);
  check("the pane says pictures are out of date", !pane(`document.getElementById("docLine").hidden`), null);
  click("updateAll"); await settle();
  check("Update all updates the pictures on every slide", /^Updated 2 pictures/.test(status()), status());
  d = deck();
  check("…and keeps where they are", ours(d[1]).length === 1 && ours(d[2]).length === 1 && ours(d[2])[0].box[0] === 40, d.map(ours));

  // The menu lists the document's other diagrams, so with none open in the editor this one shows.
  pane(`current = null, refreshButtons(), 1`);
  pane(`(() => { const sel = document.getElementById("diagram"); const o = [...sel.options].find(o => o.value.startsWith("doc:")); sel.value = o.value; sel.onchange(); return 1; })()`);
  await settle();
  check("the menu's In this document entry opens the diagram", /^(Opened|Linked to) /.test(status()), status());

  click("mdToggle"); await settle();
  const md = pane(`document.getElementById("mdText").value`);
  check("the MD view has each slide, its title and its diagram's Mermaid", /## Slide 2\n\nOrder intake\n\nDiagram: .*\n\n```mermaid/.test(md) && (md.match(/```mermaid/g) || []).length === 2, md.slice(0, 400));
  click("mdClose");

  console.log(failed ? `${failed} failed` : "all passed");
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
