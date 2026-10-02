// One page of Lucid's document contents (GET /documents/{id}/contents) -> a
// Mermaid flowchart. Lucid's contents have shapes, connectors and containment
// but no positions, so this describes structure and leaves layout to Mermaid.
// Containers (frames, swimlanes) become subgraphs; everything else a node.
// Sequence, ER, class and state diagrams get their own Mermaid forms (uml.js).
const { umlToMermaid } = require("./uml.js");
const { pictureToMermaid } = require("./svg.js");

// Lucid shape class -> Mermaid node brackets. First match wins; default is a box.
const SHAPES = [
  [/decision|diamond/i, '{"', '"}'],
  [/terminator|stadium|pill/i, '(["', '"])'],
  [/database|cylinder|datastore/i, '[("', '")]'],
  [/circle|ellipse|oval/i, '(("', '"))'],
  [/hexagon|preparation/i, '{{"', '"}}'],
  [/predefined|subroutine/i, '[["', '"]]'],
  [/parallelogram|inputoutput|dataio/i, '[/"', '"/]'],
  [/rounded/i, '("', '")'],
  // BPMN: gateways are diamonds, events circles, tasks rounded boxes.
  [/BPMNGateway/, '{"', '"}'],
  [/BPMNEvent/, '(("', '"))'],
  [/BPMNActivity/, '("', '")'],
];

// Mermaid labels are quoted, so quotes become entities and line breaks <br>.
// A container or connector with no text still needs a label, so it gets a space.
function label(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).join("<br>").replace(/"/g, "#quot;") || " ";
}

// A "Placeholder" text area holds the hint Lucid shows in an empty text box
// ("Type something"), not the diagram's text; "Add title" is a frame's title
// never filled in.
const textOf = item => (item.textAreas || []).filter(t => t.label !== "Placeholder" && !(t.label === "FrameTitle" && t.text === "Add title"))
  .map(t => t.text || "").join("\n").trim();

// A Lucid table keeps each cell as a text area labelled by row and column.
// Mermaid has no table, so a table is written out as one, in comments.
function tableRows(s) {
  const rows = [];
  for (const t of s.textAreas || []) {
    const m = (t.label || "").match(/^Cell_(\d+)[,_](\d+)$/); // "Cell_1,2"; UI mockup tables write "Cell_1_2"
    if (m) (rows[+m[1]] = rows[+m[1]] || [])[+m[2]] = (t.text || "").replace(/\s+/g, " ").trim();
  }
  return rows.length ? rows.filter(Boolean).map(r => Array.from(r, c => c || "")) : null;
}

// A shape with no text (mostly an icon whose title was cleared) is named after
// its class, so the meaning survives: "AzureCosmosDBAzure2024" -> "Azure Cosmos
// DB", "AECloudBlock" -> "AE Cloud", "ResAmazonRoute53HostedZoneAWS2024" ->
// "Amazon Route53 Hosted Zone" (AWS 2024 icons start Res/Arch),
// "GCP2021BigqueryIcon" -> "Bigquery" (GCP's library comes first), "NET_Switch" -> "Switch".
const ICON = /(AWS|Azure|GCP)\d*$|^GCP\d+|^NET_/;
function className(cls) {
  const base = cls.replace(/Block$/, "");
  const name = base.replace(/(AWS|Azure|GCP)\d*$/, "").replace(/^GCP\d+|^NET_|Icon$/g, "").replace(/^(Res|Arch)(?=[A-Z])/, "") || base;
  return name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

// A cloud icon whose title doesn't name its service ("Orders store" on an S3
// bucket) also gets the service, which is what a reader needs to know.
function nodeLabel(s) {
  const text = textOf(s), type = className(s.class);
  if (!text) return type;
  if (!ICON.test(s.class)) return text;
  // Matched against the class name run together: class names split badly
  // ("ElastiCacheforRedis" -> "Elasti Cachefor Redis").
  const compact = type.toLowerCase().replace(/[^a-z0-9]/g, "");
  const named = text.toLowerCase().split(/[^a-z0-9]+/).some(w => w.length >= 3 && compact.includes(w));
  return named ? text : `${text}\n(${type})`;
}

function pageToMermaid(page) {
  const shapes = (page.items && page.items.shapes) || [];
  const lines = (page.items && page.items.lines) || [];
  // Mermaid code other than a flowchart is one picture in Lucid (svg.js).
  const picture = shapes.find(s => s.class === "LucidNativeMermaidDiagramBlock");
  // Anything else with text on that page is said in comments, so nothing on it goes unmentioned.
  if (picture) return [pictureToMermaid(picture), ...shapes.filter(s => s !== picture && textOf(s))
    .map(s => `  %% also on this page: ${textOf(s).replace(/\s+/g, " ")}`)].join("\n");
  const uml = umlToMermaid(shapes, lines);
  if (uml) return uml;
  const byId = new Map(shapes.map(s => [s.id, s]));
  const linesById = new Map(lines.map(l => [l.id, l]));
  // A container's members are the shapes it lists.
  const isCodeSubgraph = s => /^LucidNativeMermaid.*Subgraph/.test(s.class);
  const members = new Map();
  for (const s of shapes) {
    if (s.contains && !isCodeSubgraph(s) && (s.contains.shapes || []).length) members.set(s.id, [...s.contains.shapes]);
  }
  // Lucid's Mermaid subgraph shapes ("diagram as code") list only connectors.
  // Each shape at the end of those connectors goes to the subgraph listing the
  // most of its connectors (ties: the first), so a connector crossing between
  // subgraphs can't drag a shape out of its own. Subgraph shapes are never
  // members of each other: Mermaid-code nesting isn't recoverable.
  const votes = new Map(); // shape id -> Map(subgraph id -> connectors)
  for (const s of shapes.filter(s => isCodeSubgraph(s) && s.contains)) {
    for (const lid of s.contains.lines || []) {
      const l = linesById.get(lid);
      if (!l) continue;
      for (const end of [l.endpoint1.connectedTo, l.endpoint2.connectedTo]) {
        if (!byId.has(end) || isCodeSubgraph(byId.get(end))) continue;
        const v = votes.get(end) || new Map();
        v.set(s.id, (v.get(s.id) || 0) + 1);
        votes.set(end, v);
      }
    }
  }
  for (const [id, v] of votes) {
    const [best] = [...v].reduce((a, b) => (b[1] > a[1] ? b : a));
    members.set(best, [...(members.get(best) || []), id]);
  }
  const isContainer = s => members.has(s.id);

  // Each shape belongs to its innermost container: of the containers listing it,
  // the one listing the fewest shapes (Lucid lists nested members at every level).
  // A container never ends up inside itself or its own descendants: a cycle
  // would drop both containers from the output.
  const parent = new Map();
  const isAncestor = (a, b) => { for (let p = parent.get(b); p; p = parent.get(p)) if (p === a) return true; return false; };
  for (const [cid, ids] of members) {
    for (const id of ids) {
      const p = parent.get(id);
      if (id !== cid && !isAncestor(id, cid) && (!p || members.get(p).length > ids.length)) parent.set(id, cid);
    }
  }

  // Normalise connectors to "from -> to" with the arrowhead at `to`.
  const connected = new Set();
  const edges = [], loose = [];
  // Not every end style is an arrowhead: BPMN marks a conditional or default
  // flow, and a message flow's start, on the source end.
  const head = style => !!style && style !== "None" && !/conditional|default|circle|diamond|bar|dot/i.test(style);
  // A connector can end on another connector (joining a flow part-way); it
  // then leads where that one leads: its arrowhead end, else its second end.
  const resolve = (id, seen = new Set()) => {
    const l = linesById.get(id);
    if (!l || seen.has(id)) return id;
    seen.add(id);
    return resolve(head(l.endpoint1.style) && !head(l.endpoint2.style) ? l.endpoint1.connectedTo : l.endpoint2.connectedTo, seen);
  };
  for (const l of lines) {
    let a = resolve(l.endpoint1.connectedTo), b = resolve(l.endpoint2.connectedTo);
    if (!byId.has(a) || !byId.has(b)) { loose.push(l); continue; }
    let arrowA = head(l.endpoint1.style), arrowB = head(l.endpoint2.style);
    // A plain line ending on another line feeds into that line's flow.
    if (!arrowA && !arrowB) [arrowA, arrowB] = [linesById.has(l.endpoint1.connectedTo), linesById.has(l.endpoint2.connectedTo)];
    // A BPMN message flow (hollow circle at its start) is dashed.
    const message = /hollow circle/i.test(l.endpoint1.style + " " + l.endpoint2.style);
    if (arrowA && !arrowB) [a, b] = [b, a];
    edges.push({ from: a, to: b, kind: message ? "-.->" : arrowA && arrowB ? "<-->" : arrowA || arrowB ? "-->" : "---", text: textOf(l) });
    connected.add(a); connected.add(b);
  }

  // Unconnected plain text (titles, notes) is a comment, not a box pretending to
  // be a step; so is a group that doesn't say what's in it (Lucid's Mermaid
  // subgraph shapes don't).
  const notes = [];
  // A table is a node only when connected (named by its header row); it's written out in comments either way.
  const isNode = s => !isContainer(s) && (connected.has(s.id) || (textOf(s) && !/text|subgraph/i.test(s.class) && !tableRows(s)));
  // A container is only a subgraph if something it holds is a node, or a
  // connector ends on it; one holding only freehand strokes, pictures or
  // untitled scraps would be an empty box, so it's a note too.
  const kept = new Set();
  const keep = id => { for (let p = id; p && !kept.has(p); p = parent.get(p)) kept.add(p); };
  for (const s of shapes) if (isNode(s)) keep(parent.get(s.id));
  for (const id of connected) if (isContainer(byId.get(id))) keep(id);
  const isGroup = s => isContainer(s) && kept.has(s.id);
  for (const s of shapes) if (!isGroup(s) && !isNode(s) && textOf(s) && !tableRows(s)) notes.push(textOf(s));

  // Reading order: follow the arrows from the sources (topological order),
  // ties and cycles falling back to Lucid's own order. Mermaid lays out in
  // declaration order, so this also keeps the drawing's flow.
  const order = topoOrder(shapes.filter(s => isNode(s) || isGroup(s)).map(s => s.id), edges);
  const ids = new Map();
  let n = 0, g = 0;
  for (const id of order) ids.set(id, isGroup(byId.get(id)) ? "g" + ++g : "n" + ++n);

  const out = ["flowchart TD"];
  // A container sits where its first member sits in reading order.
  const rank = new Map(order.map((id, i) => [id, i]));
  const firstRank = id => Math.min(rank.get(id), ...childrenOf(id).map(firstRank));
  function childrenOf(id) { return order.filter(c => parent.get(c) === id); }
  function emit(id, indent) {
    const s = byId.get(id), pad = "  ".repeat(indent);
    if (isGroup(s)) {
      // Lucid's swimlane is one shape: the lanes' titles are its text areas
      // (Primary_0, Primary_1, ...) and it lists every step at once. Which lane
      // a step is in only shows in the drawing (the API has no positions), so
      // the lanes are named and that's said.
      const lanes = (s.textAreas || []).filter(t => /^(Primary|Secondary)_\d+$/.test(t.label) && (t.text || "").trim());
      const title = lanes.length ? (s.textAreas.find(t => /Title/.test(t.label)) || {}).text : textOf(s);
      const name = [title, lanes.length && `lanes: ${lanes.map(t => t.text.trim()).join(", ")}`].filter(t => t && t.trim()).join(" - ");
      out.push(`${pad}subgraph ${ids.get(id)}["${label(name || "")}"]`);
      // Without this, Mermaid lays a subgraph's contents out left to right.
      out.push(`${pad}  direction TB`);
      if (lanes.length) out.push(`${pad}  %% Lucid's API doesn't say which lane each step below is in`);
      for (const c of childrenOf(id).sort((x, y) => firstRank(x) - firstRank(y))) emit(c, indent + 1);
      out.push(`${pad}end`);
    } else {
      const [open, close] = (SHAPES.find(([re]) => re.test(s.class)) || [null, '["', '"]']).slice(1);
      out.push(`${pad}${ids.get(id)}${open}${label(tableRows(s) ? tableRows(s)[0].join(" | ") : nodeLabel(s))}${close}`);
    }
  }
  for (const id of order.filter(id => !parent.has(id) || !ids.has(parent.get(id))).sort((x, y) => firstRank(x) - firstRank(y))) emit(id, 1);

  edges.sort((x, y) => rank.get(x.from) - rank.get(y.from) || rank.get(x.to) - rank.get(y.to));
  for (const e of edges) out.push(`  ${ids.get(e.from)} ${e.kind}${e.text ? `|"${label(e.text)}"|` : ""} ${ids.get(e.to)}`);
  // A shape's hyperlink (a runbook, a ticket): Mermaid can attach one to a node;
  // one on a group or a note is said in a comment.
  for (const s of shapes.filter(s => /^https?:\/\//.test(s.linkUrl || ""))) {
    const url = s.linkUrl.replace(/"/g, "%22");
    if (ids.has(s.id) && !isGroup(s)) out.push(`  click ${ids.get(s.id)} href "${url}" _blank`);
    else out.push(`  %% link${textOf(s) ? ` on "${textOf(s).replace(/\s+/g, " ")}"` : ""}: ${url}`);
  }
  for (const t of notes) out.push(`  %% note: ${t.replace(/\s+/g, " ")}`);
  for (const rows of shapes.map(tableRows).filter(Boolean)) {
    out.push("  %% table:");
    for (const r of rows) out.push(`  %% | ${r.join(" | ")} |`);
  }
  for (const l of loose) out.push(`  %% connector with a loose end${textOf(l) ? `: ${textOf(l).replace(/\s+/g, " ")}` : ""}`);
  return out.join("\n");
}

// Kahn's algorithm. Of the nodes ready next, the one heading the longest chain
// goes first, so the main flow reads top to bottom and a side input lands just
// before the step it feeds; on a tie, the step that continues from the node
// just placed, then `ids` order.
function topoOrder(ids, edges) {
  const inDegree = new Map(ids.map(id => [id, 0]));
  for (const e of edges) if (inDegree.has(e.to) && inDegree.has(e.from)) inDegree.set(e.to, inDegree.get(e.to) + 1);
  const chain = new Map(), visiting = new Set();
  const chainLength = id => {
    if (chain.has(id)) return chain.get(id);
    if (visiting.has(id)) return 0; // cycle
    visiting.add(id);
    const len = 1 + Math.max(0, ...edges.filter(e => e.from === id && inDegree.has(e.to)).map(e => chainLength(e.to)));
    visiting.delete(id);
    chain.set(id, len);
    return len;
  };
  const done = new Set(), order = [];
  const follows = id => edges.some(e => e.from === order[order.length - 1] && e.to === id);
  const score = id => chainLength(id) * 2 + (follows(id) ? 1 : 0);
  const best = candidates => candidates.reduce((a, b) => (score(b) > score(a) ? b : a), candidates[0]);
  while (order.length < ids.length) {
    const ready = ids.filter(id => !done.has(id) && inDegree.get(id) === 0);
    // Stuck in a loop (a "fix it and resubmit" arrow back): carry on with a
    // step something already placed points to, rather than jumping to
    // whichever shape Lucid happens to list first.
    const reached = ids.filter(id => !done.has(id) && edges.some(e => e.to === id && done.has(e.from)));
    const next = ready.length ? best(ready) : reached.length ? best(reached) : ids.find(id => !done.has(id));
    done.add(next); order.push(next);
    for (const e of edges) if (e.from === next && !done.has(e.to) && inDegree.has(e.to)) inDegree.set(e.to, inDegree.get(e.to) - 1);
  }
  return order;
}

module.exports = { pageToMermaid };
