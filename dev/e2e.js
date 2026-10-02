// The pane's main flows, run in the test Word (dev/chrome.ps1, with
// dev/serve.js and server.js running): clears Claude's test doc, then checks
// Insert (picture, caption, cursor), Insert after a heading and into a table
// cell, Insert without a caption, Update of an unchanged picture, and the MD view. Uses the "small test"
// / "Order intake flow" Lucid document. Prints PASS / FAIL per check.
//   node dev/e2e.js
const { execFileSync } = require("child_process");
const path = require("path");
const DOC = "d52e08a7-5c54-4df4-aa9e-1ff509683043";
const run = (script, ...args) => execFileSync("node", [path.join(__dirname, script), ...args], { encoding: "utf8" }).trim();
const pane = js => JSON.parse(run("cdp.js", "eval", "taskpane.html", js));
const click = id => run("cdp.js", "click", "taskpane.html", "css:#" + id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Waits for the pane to finish what a click started (its buttons come back).
const settle = async () => { for (let i = 0; i < 60; i++) { await sleep(1000); if (!pane("busy")) return; } throw new Error("pane still busy after 60s"); };
const paragraphs = () => pane(`Word.run(async ctx => {
  const ps = ctx.document.body.paragraphs; ps.load("items/text,items/styleBuiltIn,items/tableNestingLevel,items/font/italic");
  await ctx.sync();
  const pics = ps.items.map(p => p.inlinePictures.load("items/width,items/altTextDescription"));
  await ctx.sync();
  return ps.items.map((p, i) => ({ text: p.text, style: p.styleBuiltIn, table: p.tableNestingLevel, italic: p.font.italic,
    pictures: pics[i].items.map(x => ({ width: Math.round(x.width), mermaid: /\`\`\`mermaid/.test(x.altTextDescription) })) }));
})`);
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ": " + JSON.stringify(detail)}`); if (!ok) failed++; };

(async () => {
  run("word.js", "clear");
  pane("location.reload(), 1");
  await sleep(10000);
  check("pane starts", /^build v\d+$/.test(pane(`document.getElementById("build").textContent`)) && pane(`document.getElementById("status").textContent`) !== "Starting...",
    pane(`document.getElementById("status").textContent`));
  run("word.js", "open", DOC);
  await sleep(5000);

  click("insert"); await settle();
  let ps = paragraphs();
  const pic = ps.find(p => p.pictures.length);
  check("Insert puts a picture with Mermaid alt text", pic && pic.pictures[0].mermaid, ps);
  check("…and a caption under it", ps.some(p => /^Figure 1: /.test(p.text)), ps);
  check("…and leaves the cursor below", pane(`Word.run(async ctx => { const s = ctx.document.getSelection(); s.load("text"); const p = s.paragraphs.getFirst(); p.load("text"); await ctx.sync(); return p.text; })`) === "", null);

  click("insert"); await settle();
  ps = paragraphs();
  check("a second Insert follows the first (Figure 1, Figure 2 in order)", ps.filter(p => /^Figure \d+:/.test(p.text)).map(p => p.text.slice(0, 8)).join() === "Figure 1,Figure 2", ps);

  pane(`Word.run(async ctx => { const h = ctx.document.body.insertParagraph("A heading", "Start"); h.styleBuiltIn = Word.BuiltInStyleName.heading1; await ctx.sync(); h.getRange("End").select(); await ctx.sync(); return 1; })`);
  await sleep(1500);
  click("insert"); await settle();
  ps = paragraphs();
  check("Insert after a heading keeps the figure and caption out of the heading style", ps[1].pictures.length && ps[1].style === "Normal" && ps[2].style === "Normal", ps.slice(0, 3));
  check("captions are renumbered in document order", ps.filter(p => /^Figure \d+:/.test(p.text)).map(p => p.text.slice(0, 8)).join() === "Figure 1,Figure 2,Figure 3", ps);

  pane(`Word.run(async ctx => { const t = ctx.document.body.insertTable(2, 2, "End", [["Step", "Diagram"], ["Intake", ""]]); await ctx.sync(); t.getCell(1, 1).body.paragraphs.getFirst().getRange("Start").select(); await ctx.sync(); return 1; })`);
  await sleep(1500);
  click("insert"); await settle();
  ps = paragraphs();
  const cellPic = ps.find(p => p.table && p.pictures.length);
  check("Insert into a table cell fits the picture to the cell", cellPic && cellPic.pictures[0].width <= 234, cellPic);

  // Caption unticked: a picture and no caption.
  pane(`document.getElementById("caption").click(), 1`);
  run("word.js", "end"); await sleep(1500);
  const counts = ps => [ps.filter(p => p.pictures.length).length, ps.filter(p => /^Figure \d+:/.test(p.text)).length];
  const before = counts(ps);
  click("insert"); await settle();
  ps = paragraphs();
  check("Insert with Caption unticked adds the picture only", counts(ps).join() === [before[0] + 1, before[1]].join(), counts(ps));
  pane(`document.getElementById("caption").click(), 1`);

  pane(`Word.run(async ctx => { ctx.document.body.inlinePictures.getFirst().select(); await ctx.sync(); return 1; })`);
  await sleep(2500);
  click("replace"); await settle();
  check("Update of an unchanged picture refreshes it", /already up to date|Updated to the latest/.test(pane(`document.getElementById("status").textContent`)), pane(`document.getElementById("status").textContent`));

  click("mdToggle"); await settle();
  const md = pane(`document.getElementById("mdText").value`);
  check("the MD view has the diagrams' Mermaid and the table", (md.match(/```mermaid/g) || []).length >= 4 && /\| Step \| Diagram \|/.test(md), md.slice(0, 300));
  click("mdClose");

  console.log(failed ? `${failed} failed` : "all passed");
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
