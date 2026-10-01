// One page of Lucid's document contents (GET /documents/{id}/contents) -> a
// Mermaid flowchart. Lucid's contents have shapes, connectors and containment
// but no positions, so this describes structure and leaves layout to Mermaid.
// Containers (frames, swimlanes) become subgraphs; everything else a node.

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
];

// Mermaid labels are quoted, so quotes become entities and line breaks <br>.
// A shape with no text still needs a label, so it gets a space.
function label(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).join("<br>").replace(/"/g, "#quot;") || " ";
}

const textOf = item => (item.textAreas || []).map(t => t.text || "").join("\n").trim();

function pageToMermaid(page) {
  const shapes = (page.items && page.items.shapes) || [];
  const lines = (page.items && page.items.lines) || [];
  const byId = new Map(shapes.map(s => [s.id, s]));
  const isContainer = s => s.contains && (s.contains.shapes || []).length > 0;

  // Each shape belongs to its innermost container: of the containers listing it,
  // the one listing the fewest shapes (Lucid lists nested members at every level).
  const parent = new Map();
  for (const c of shapes.filter(isContainer)) {
    for (const id of c.contains.shapes) {
      const p = parent.get(id);
      if (!p || byId.get(p).contains.shapes.length > c.contains.shapes.length) parent.set(id, c.id);
    }
  }

  // Normalise connectors to "from -> to" with the arrowhead at `to`.
  const connected = new Set();
  const edges = [], loose = [];
  for (const l of lines) {
    let a = l.endpoint1.connectedTo, b = l.endpoint2.connectedTo;
    if (!byId.has(a) || !byId.has(b)) { loose.push(l); continue; }
    const arrowA = l.endpoint1.style && l.endpoint1.style !== "None";
    const arrowB = l.endpoint2.style && l.endpoint2.style !== "None";
    if (arrowA && !arrowB) [a, b] = [b, a];
    edges.push({ from: a, to: b, kind: arrowA && arrowB ? "<-->" : arrowA || arrowB ? "-->" : "---", text: textOf(l) });
    connected.add(a); connected.add(b);
  }

  // Unconnected plain text (titles, notes) is a comment, not a box pretending to
  // be a step; so is a group that doesn't say what's in it (Lucid's Mermaid
  // subgraph shapes don't).
  const notes = [];
  const isNode = s => !isContainer(s) && (connected.has(s.id) || (textOf(s) && !/text|subgraph/i.test(s.class)));
  for (const s of shapes) if (!isContainer(s) && !isNode(s) && textOf(s)) notes.push(textOf(s));

  // Reading order: follow the arrows from the sources (topological order),
  // ties and cycles falling back to Lucid's own order. Mermaid lays out in
  // declaration order, so this also keeps the drawing's flow.
  const order = topoOrder(shapes.filter(s => isNode(s) || isContainer(s)).map(s => s.id), edges);
  const ids = new Map();
  let n = 0, g = 0;
  for (const id of order) ids.set(id, isContainer(byId.get(id)) ? "g" + ++g : "n" + ++n);

  const out = ["flowchart TD"];
  // A container sits where its first member sits in reading order.
  const rank = new Map(order.map((id, i) => [id, i]));
  const firstRank = id => Math.min(rank.get(id), ...childrenOf(id).map(firstRank));
  function childrenOf(id) { return order.filter(c => parent.get(c) === id); }
  function emit(id, indent) {
    const s = byId.get(id), pad = "  ".repeat(indent);
    if (isContainer(s)) {
      out.push(`${pad}subgraph ${ids.get(id)}["${label(textOf(s))}"]`);
      // Without this, Mermaid lays a subgraph's contents out left to right.
      out.push(`${pad}  direction TB`);
      for (const c of childrenOf(id).sort((x, y) => firstRank(x) - firstRank(y))) emit(c, indent + 1);
      out.push(`${pad}end`);
    } else {
      const [open, close] = (SHAPES.find(([re]) => re.test(s.class)) || [null, '["', '"]']).slice(1);
      out.push(`${pad}${ids.get(id)}${open}${label(textOf(s))}${close}`);
    }
  }
  for (const id of order.filter(id => !parent.has(id) || !ids.has(parent.get(id))).sort((x, y) => firstRank(x) - firstRank(y))) emit(id, 1);

  edges.sort((x, y) => rank.get(x.from) - rank.get(y.from) || rank.get(x.to) - rank.get(y.to));
  for (const e of edges) out.push(`  ${ids.get(e.from)} ${e.kind}${e.text ? `|"${label(e.text)}"|` : ""} ${ids.get(e.to)}`);
  for (const t of notes) out.push(`  %% note: ${t.replace(/\s+/g, " ")}`);
  for (const l of loose) out.push(`  %% connector with a loose end${textOf(l) ? `: ${textOf(l).replace(/\s+/g, " ")}` : ""}`);
  return out.join("\n");
}

// Kahn's algorithm. Of the nodes ready next, the one heading the longest chain
// goes first, so the main flow reads top to bottom and a side input lands just
// before the step it feeds; on a tie, the step that continues from the node
// just placed, then `ids` order. Whatever a cycle leaves behind follows in `ids` order.
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
    const next = ready.length ? best(ready) : ids.find(id => !done.has(id));
    done.add(next); order.push(next);
    for (const e of edges) if (e.from === next && !done.has(e.to) && inDegree.has(e.to)) inDegree.set(e.to, inDegree.get(e.to) - 1);
  }
  return order;
}

module.exports = { pageToMermaid };
