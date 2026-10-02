// A Mermaid diagram that Lucid holds as a picture. Mermaid code for anything
// but a flowchart (a sequence, class, state or ER diagram pasted or imported
// into Lucid) becomes one LucidNativeMermaidDiagramBlock shape whose only
// content is Mermaid's own SVG drawing of it, as a data URL in `image.url`: no
// text areas, no source. The SVG is read back into Mermaid: a sequence
// diagram completely (Mermaid tags its participants and messages), any other
// kind as its header plus its text as comments, which still tells a reader
// what's in it.

const decode = t => t.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const all = (svg, re) => [...svg.matchAll(re)];
// As in uml.js: one line, and ";" / "#" are statement and entity syntax.
const seqText = t => t.split("\n").map(l => l.trim()).filter(Boolean).join("<br>")
  .replace(/#/g, "#35;").replace(/;/g, "#59;").replace(/"/g, "#quot;");

function pictureToMermaid(shape) {
  const url = (shape.image && shape.image.url) || "";
  const m = url.match(/^data:image\/svg\+xml(;base64)?,(.*)$/s);
  if (!m) return "flowchart TD\n  %% Lucid holds this page as a picture of a Mermaid diagram, and doesn't give its contents";
  const svg = m[1] ? Buffer.from(m[2], "base64").toString("utf8") : decodeURIComponent(m[2]);
  const kind = attr(svg.slice(0, 2000), "aria-roledescription") || "";
  if (kind === "sequence") return sequence(svg);
  const graph = kind === "class" || kind === "classDiagram" ? classes(svg) : kind === "stateDiagram" ? states(svg) : null;
  if (graph) return graph;
  // Everything that's drawn as text, in drawing order, without the stylesheet.
  const texts = [];
  for (const [, t] of all(svg.replace(/<style[\s\S]*?<\/style>/g, ""), />([^<>]+)</g)) {
    const text = decode(t);
    if (text && text !== texts[texts.length - 1]) texts.push(text);
  }
  const header = { class: "classDiagram", classDiagram: "classDiagram", stateDiagram: "stateDiagram-v2", er: "erDiagram",
    erDiagram: "erDiagram" }[kind] || "flowchart TD";
  return [header, `  %% Lucid holds this page as a picture of a Mermaid ${kind || "diagram"} (no source), so only its text is known:`,
    ...texts.map(t => `  %% ${t.replace(/\s+/g, " ")}`)].join("\n");
}

function sequence(svg) {
  // Participants left to right by their lifelines; names are the text drawn on their heads.
  const types = new Map(all(svg, /<g[^>]*data-et="participant"[^>]*>/g).map(([g]) => [attr(g, "data-id"), attr(g, "data-type")]));
  const names = new Map();
  for (const [, x, name] of all(svg, /<text[^>]*?\sx="([\d.-]+)"[^>]*class="actor[^"]*"[^>]*>(?:<tspan[^>]*>)?([^<]*)/g))
    if (!names.has(+x)) names.set(+x, decode(name));
  const lifelines = all(svg, /<line[^>]*data-et="life-line"[^>]*>/g).map(([l]) => ({ id: attr(l, "data-id"), x: +attr(l, "x1") }))
    .sort((a, b) => a.x - b.x);
  const pid = new Map(lifelines.map((l, i) => [l.id, "p" + (i + 1)]));
  const out = ["sequenceDiagram"];
  lifelines.forEach(l => out.push(`  ${types.get(l.id) === "actor" ? "actor" : "participant"} ${pid.get(l.id)} as ${seqText(names.get(l.x) || l.id)}`));

  // Everything that happens, by height on the page: messages (their texts come
  // in the same order), notes, and the edges of loop / alt / opt... boxes.
  const events = [];
  const texts = all(svg, /<text[^>]*class="messageText"[^>]*>([\s\S]*?)<\/text>/g).map(([, t]) => decode(t.replace(/<\/tspan>/g, "\n")));
  all(svg, /<(line|path)[^>]*data-et="message"[^>]*>/g).forEach(([tag, el], i) => {
    const y = el === "line" ? +attr(tag, "y1") : +(attr(tag, "d").match(/[\d.-]+[ ,]([\d.-]+)/) || [])[1];
    const marker = attr(tag, "marker-end") || "";
    const head = /crosshead/.test(marker) ? "x" : /filled-head/.test(marker) ? ")" : /arrowhead/.test(marker) ? ">>" : ">";
    const dashed = /messageLine1/.test(attr(tag, "class") || "");
    events.push({ y, line: `${pid.get(attr(tag, "data-from"))}${dashed ? "--" : "-"}${head}${pid.get(attr(tag, "data-to"))}: ${seqText(texts[i] || "")}` });
  });
  // A note is over the lifelines its box spans.
  for (const [, rect, text] of all(svg, /<rect([^>]*class="note"[^>]*)>[\s\S]*?<text[^>]*class="noteText"[^>]*>([\s\S]*?)<\/text>/g)) {
    const x = +attr(rect, "x"), w = +attr(rect, "width");
    const over = lifelines.filter(l => l.x >= x && l.x <= x + w).map(l => pid.get(l.id));
    const near = lifelines.reduce((a, b) => Math.abs(b.x - x - w / 2) < Math.abs(a.x - x - w / 2) ? b : a, lifelines[0]);
    events.push({ y: +attr(rect, "y"), line: `Note over ${(over.length ? [over[0], over[over.length - 1]] : [pid.get(near.id)]).filter((p, i, a) => a.indexOf(p) === i).join(",")}: ${seqText(decode(text.replace(/<\/tspan>/g, "\n")))}` });
  }
  for (const [g] of all(svg, /<g data-et="control-structure"[\s\S]*?<\/g>/g)) {
    const ys = all(g, /<line[^>]*class="loopLine"[^>]*>/g).map(([l]) => [+attr(l, "y1"), +attr(l, "y2"), /dasharray/.test(l)]);
    if (!ys.length) continue;
    const top = Math.min(...ys.flat().filter(v => typeof v === "number")), bottom = Math.max(...ys.flat().filter(v => typeof v === "number"));
    const kind = decode((g.match(/class="labelText"[^>]*>([\s\S]*?)<\/text>/) || [, "opt"])[1]);
    const cond = decode((g.match(/class="loopText"[^>]*>([\s\S]*?)<\/text>/) || [, ""])[1]).replace(/^\[|\]$/g, "");
    const sections = all(g, /<text[^>]*?\sy="([\d.-]+)"[^>]*class="sectionTitle"[^>]*>([\s\S]*?)<\/text>/g)
      .map(([, y, t]) => ({ y: +y, t: decode(t).replace(/^\[|\]$/g, "") }));
    // The dashed separator sits just above its section's title.
    const separators = ys.filter(([y1, y2, dashed]) => dashed && y1 === y2 && y1 > top && y1 < bottom).map(([y]) => y).sort((a, b) => a - b);
    events.push({ y: top, open: true, line: `${kind} ${seqText(cond)}`.trim() });
    separators.forEach((y, i) => events.push({ y, line: `${kind === "par" ? "and" : kind === "critical" ? "option" : "else"} ${seqText((sections[i] || {}).t || "")}`.trim(), section: true }));
    events.push({ y: bottom, close: true, line: "end" });
  }
  events.sort((a, b) => a.y - b.y || (b.open ? 1 : 0) - (a.open ? 1 : 0) || (a.close ? 1 : 0) - (b.close ? 1 : 0));
  let depth = 1;
  for (const e of events) {
    if (e.close || e.section) depth--;
    out.push("  ".repeat(depth) + e.line);
    if (e.open || e.section) depth++;
  }
  return out.join("\n");
}

// Class and state diagrams are drawn as graphs: each node a group whose id
// says what it is ("...-classId-Dog-4", "...-state-Idle-2") and whose
// transform is its centre; each edge a path listing its route as base64 JSON
// points (data-points) and its arrowheads as markers; edge labels refer to
// their edge's data-id. An edge joins the nodes nearest its first and last points.
function graph(svg, prefix) {
  svg = svg.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<defs>[\s\S]*?<\/defs>/g, "");
  const tags = all(svg, new RegExp(`<g class="node[^"]*" id="[^"]*-${prefix}-([^"]+)-\\d+"[^>]*transform="translate\\(([\\d.-]+),\\s*([\\d.-]+)\\)"[^>]*>`, "g"));
  const nodes = tags.map((t, i) => {
    const body = svg.slice(t.index + t[0].length, i + 1 < tags.length ? tags[i + 1].index : svg.indexOf('class="edgeLabels"', t.index) >>> 0);
    const texts = all(body, />([^<>]+)</g).map(([, x]) => decode(x)).filter(Boolean);
    return { name: t[1], x: +t[2], y: +t[3], texts };
  });
  const near = p => nodes.reduce((a, b) => Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a, nodes[0]);
  const labels = new Map();
  for (const [, id, body] of all(svg, /<g class="label" data-id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)) labels.set(id, decode(body.replace(/<\/tspan>/g, " ")).replace(/\s+/g, " "));
  const edges = all(svg, /<path[^>]*data-et="edge"[^>]*>/g).map(([tag]) => {
    const points = JSON.parse(Buffer.from(attr(tag, "data-points") || "W10=", "base64").toString());
    return { from: points.length && near(points[0]), to: points.length && near(points[points.length - 1]), label: labels.get(attr(tag, "data-id")) || "",
      start: attr(tag, "marker-start") || "", end: attr(tag, "marker-end") || "", dashed: /dashed|dotted/.test(attr(tag, "class") || "") };
  }).filter(e => e.from && e.to);
  return { nodes, edges };
}

const quoted = t => t.replace(/"/g, "#quot;");

function classes(svg) {
  const { nodes, edges } = graph(svg, "classId");
  if (!nodes.length) return null;
  const id = new Map(nodes.map((n, i) => [n, "c" + (i + 1)]));
  const out = ["classDiagram"];
  for (const n of nodes) {
    // The node's texts: an annotation like <<interface>>, the name, then the members.
    const members = n.texts.filter(t => t !== n.name && !/^<<.*>>$/.test(t)).map(t => t.replace(/[{}]/g, "").replace(/[<>]/g, "~"));
    const annotation = n.texts.find(t => /^<<.*>>$/.test(t));
    out.push(`  class ${id.get(n)}["${quoted(n.name)}"]${members.length || annotation ? " {" : ""}`);
    if (annotation) out.push(`    ${annotation}`);
    for (const m of members) out.push(`    ${m}`);
    if (members.length || annotation) out.push("  }");
  }
  const end = (marker, left) => /extension/.test(marker) ? (left ? "<|" : "|>") : /composition/.test(marker) ? "*"
    : /aggregation/.test(marker) ? "o" : /dependency|arrow/.test(marker) ? (left ? "<" : ">") : "";
  for (const e of edges)
    out.push(`  ${id.get(e.from)} ${end(e.start, true)}${e.dashed ? ".." : "--"}${end(e.end, false)} ${id.get(e.to)}${e.label ? " : " + quoted(e.label) : ""}`);
  return out.join("\n");
}

function states(svg) {
  const { nodes, edges } = graph(svg, "state");
  if (!nodes.length) return null;
  // Mermaid names the start and end pseudo-states <scope>_start / <scope>_end.
  const pseudo = n => /_(start|end)$/.test(n.name);
  const id = new Map(nodes.filter(n => !pseudo(n)).map((n, i) => [n, "s" + (i + 1)]));
  const out = ["stateDiagram-v2"];
  for (const n of nodes.filter(n => !pseudo(n))) {
    out.push(`  state "${quoted(n.texts[0] || n.name)}" as ${id.get(n)}`);
    if (n.texts.length > 1) out.push(`  ${id.get(n)} : ${quoted(n.texts.slice(1).join("<br>"))}`);
  }
  for (const e of edges) out.push(`  ${id.get(e.from) || "[*]"} --> ${id.get(e.to) || "[*]"}${e.label ? " : " + quoted(e.label) : ""}`);
  return out.join("\n");
}

module.exports = { pictureToMermaid };
