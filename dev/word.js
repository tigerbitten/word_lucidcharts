// Shortcuts for testing the pane in the test Word (through dev/cdp.js):
//   node dev/word.js doc           pictures (size, alt text head) and paragraphs
//   node dev/word.js clear         empties Claude's test doc
//   node dev/word.js open <docId>  opens that Lucid document in the pane's editor
//                                  without the picker (an edit embed made over the
//                                  API, as if Lucid's picker had announced it)
//   node dev/word.js end           puts the cursor at the end of the document
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const [, , cmd, arg] = process.argv;
const pane = js => execFileSync("node", [path.join(__dirname, "cdp.js"), "eval", "taskpane.html", js], { encoding: "utf8" }).trim();

(async () => {
  if (cmd === "doc") console.log(pane(`Word.run(async ctx => {
    const ps = ctx.document.body.inlinePictures; ps.load("items/altTextTitle,items/width,items/height,items/altTextDescription");
    const paras = ctx.document.body.paragraphs; paras.load("items/text,items/style,items/alignment,items/font/italic,items/font/size");
    await ctx.sync();
    const inPara = paras.items.map(p => p.inlinePictures.load("items/altTextTitle"));
    await ctx.sync();
    return { pictures: ps.items.map(p => [p.altTextTitle, Math.round(p.width) + "x" + Math.round(p.height) + "pt", p.altTextDescription.split("\\n").slice(0, 5).join(" | ")]),
      paragraphs: paras.items.map((p, i) => [p.style, p.alignment, (p.font.italic ? "italic " : "") + p.font.size + "pt",
        inPara[i].items.map(x => "[picture " + x.altTextTitle.slice(-6) + "]").join(" ") + p.text.slice(0, 80)].join(" | ")) };
  })`));
  else if (cmd === "clear") console.log(pane(`Word.run(async ctx => { ctx.document.body.clear(); const p = ctx.document.body.paragraphs.getFirst();
    p.styleBuiltIn = Word.BuiltInStyleName.normal; p.alignment = "Left"; Object.assign(p.font, { italic: false, size: 12, color: "#000000" });
    await ctx.sync(); return "cleared"; })`));
  else if (cmd === "end") console.log(pane(`Word.run(async ctx => { ctx.document.body.getRange("End").select(); await ctx.sync(); return "cursor at end"; })`));
  else if (cmd === "open") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    await fetch("https://localhost:3000/info?doc=" + arg); // lets the server refresh the token
    const token = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".lucid-token.json"))).access;
    const r = await fetch(`https://api.lucid.co/documents/${arg}/embeds`, { method: "POST",
      headers: { "Lucid-Api-Version": "1", Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ embedVersion: "latest-version", accessLevel: "edit" }) });
    if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text()} (only documents picked once in Lucid's picker can be embedded)`);
    const { embedId } = await r.json();
    console.log(pane(`loadEditor("${embedId}").then(() => { onLucidMessage({ type: "LucidEmbedEvent", event: "EmbedCreated", documentId: "${arg}", embedId: "${embedId}" }); return "opened ${arg} as embed ${embedId}"; })`));
  } else throw new Error("usage: node dev/word.js doc|clear|end|open <docId>");
})().catch(e => { console.error(e.message); process.exit(1); });
