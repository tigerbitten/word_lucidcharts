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
// A container or connector with no text still needs a label, so it gets a space.
function label(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).join("<br>").replace(/"/g, "#quot;") || " ";
}

// A "Placeholder" text area holds the hint Lucid shows in an empty text box
// ("Type something"), not the diagram's text.
const textOf = item => (item.textAreas || []).filter(t => t.label !== "Placeholder").map(t => t.text || "").join("\n").trim();

// A shape with no text (mostly an icon whose title was cleared) is named after
// its class, so the meaning survives: "AzureCosmosDBAzure2024" -> "Azure Cosmos
// DB", "AECloudBlock" -> "AE Cloud", "ResAmazonRoute53HostedZoneAWS2024" ->
// "Amazon Route53 Hosted Zone" (AWS 2024 icons start Res/Arch).
const ICON = /(AWS|Azure|GCP)\d*$/;
function className(cls) {
  const base = cls.replace(/Block$/, "");
  const name = base.replace(ICON, "").replace(/^(Res|Arch)(?=[A-Z])/, "") || base;
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

// Sequence-diagram text: no line breaks, and ";" / "#" are statement and
// entity syntax there, so they become entities too.
const seqText = text => text.split("\n").map(l => l.trim()).filter(Boolean).join("<br>")
  .replace(/#/g, "#35;").replace(/;/g, "#59;").replace(/"/g, "#quot;");

// A UML sequence diagram, as Lucid draws one: each participant is a pair of
// heads (UMLObjectBlock, or UMLActorBlock for an actor) joined by an arrowless
// line, the lifeline. Messages are lines from a lifeline or an activation bar
// (UMLActivationBlock) to another. Fragments (UMLOptionLoopBlock: loop, opt...;
// UMLAlternativeBlock2: alt) list the messages inside them. Lucid lists lines
// in the order they were drawn, which is the order the messages happen.
// Returns null when the page has no lifelines.
function sequenceToMermaid(shapes, lines) {
  const byId = new Map(shapes.map(s => [s.id, s]));
  const isHead = id => byId.has(id) && /^UML(Object|Actor)/.test(byId.get(id).class);
  const lifelines = lines.filter(l => isHead(l.endpoint1.connectedTo) && isHead(l.endpoint2.connectedTo)
    && textOf(byId.get(l.endpoint1.connectedTo)) === textOf(byId.get(l.endpoint2.connectedTo)));
  if (!lifelines.length) return null;
  // Participants in the order Lucid lists their heads (left to right, as drawn).
  const owner = new Map(); // lifeline, head or activation id -> participant index
  const participants = [];
  for (const s of shapes.filter(s => isHead(s.id))) {
    const l = lifelines.find(l => l.endpoint1.connectedTo === s.id || l.endpoint2.connectedTo === s.id);
    if (!l || owner.has(l.id)) continue;
    owner.set(l.id, participants.length);
    owner.set(l.endpoint1.connectedTo, participants.length);
    owner.set(l.endpoint2.connectedTo, participants.length);
    participants.push({ name: textOf(s), actor: /Actor/.test(s.class) });
  }
  const activations = shapes.filter(s => /^UMLActivation/.test(s.class)).map(s => s.id);
  const isEnd = id => owner.has(id) || activations.includes(id);
  const messages = lines.filter(l => !lifelines.includes(l) && isEnd(l.endpoint1.connectedTo) && isEnd(l.endpoint2.connectedTo));

  // Which lifeline an activation bar sits on is only in the drawing, so it's
  // inferred: a bar isn't on the lifeline it exchanges messages with (a
  // message from a bar to itself is a self call), every participant takes
  // part in something, and Lucid lists bars lifeline by lifeline, left to
  // right. The first placement (leftmost first) meeting all three wins; if
  // none does, each bar goes on the first lifeline that's not at the other
  // end of its messages.
  const others = id => messages.flatMap(m => m.endpoint1.connectedTo === id && m.endpoint2.connectedTo !== id ? [m.endpoint2.connectedTo]
    : m.endpoint2.connectedTo === id && m.endpoint1.connectedTo !== id ? [m.endpoint1.connectedTo] : []);
  const direct = new Set(messages.flatMap(m => [m.endpoint1.connectedTo, m.endpoint2.connectedTo]).filter(id => owner.has(id)).map(id => owner.get(id)));
  const fits = (a, p, placed) => others(a).every(o => (owner.has(o) ? owner.get(o) : placed.get(o)) !== p);
  const place = (i, from, placed) => {
    if (i === activations.length) {
      const used = new Set([...direct, ...placed.values()]);
      return participants.every((_, p) => used.has(p)) ? placed : null;
    }
    for (let p = from; p < participants.length; p++) {
      if (!fits(activations[i], p, placed)) continue;
      const done = place(i + 1, p, new Map(placed).set(activations[i], p));
      if (done) return done;
    }
    return null;
  };
  let placed = activations.length <= 40 && place(0, 0, new Map());
  if (!placed) {
    placed = new Map();
    for (const a of activations) placed.set(a, Math.max(0, participants.findIndex((_, p) => fits(a, p, placed))));
  }
  const who = id => owner.has(id) ? owner.get(id) : placed.get(id);

  // A message back to a participant whose call is still unanswered is the
  // reply to it (Lucid draws those dashed, but the API doesn't say so). An
  // open arrowhead is an asynchronous message.
  const fragments = shapes.filter(s => /^UML(OptionLoop|Alternative)/.test(s.class) && s.contains)
    .map(s => ({ s, msgs: messages.filter(m => s.contains.lines.includes(m.id)) })).filter(f => f.msgs.length);
  const out = ["sequenceDiagram"];
  const titles = [...new Set(shapes.filter(s => /Frame|Text/.test(s.class) && textOf(s)).map(textOf))];
  if (titles.length === 1) out.push(`  title ${seqText(titles[0])}`);
  participants.forEach((p, i) => out.push(`  ${p.actor ? "actor" : "participant"} p${i + 1} as ${seqText(p.name)}`));

  // Messages in drawing order; a fragment opens at its first message and
  // holds all of its own, a fragment inside it being one whose messages are a
  // subset. An alt's branches aren't recorded either: a branch starts where a
  // message repeats the sender and receiver of the alt's first one.
  function emit(msgs, frags, pad, calls) {
    const done = new Set();
    for (const m of msgs) {
      if (done.has(m)) continue;
      const f = frags.find(f => f.msgs.includes(m) && !frags.some(g => g !== f && g.msgs.length > f.msgs.length && f.msgs.every(x => g.msgs.includes(x))));
      if (f) {
        const inner = frags.filter(g => g !== f && g.msgs.every(x => f.msgs.includes(x)));
        const areas = f.s.textAreas || [];
        const title = (areas.find(t => t.label === "Title") || {}).text || "";
        const cond = t => (t || "").replace(/^\s*\[|\]\s*$/g, "").trim();
        if (/^UMLAlternative/.test(f.s.class)) {
          const conds = areas.filter(t => /^(Condition|Else\d+)$/.test(t.label)).map(t => cond(t.text));
          const first = f.msgs[0];
          const branches = [[]];
          for (const x of f.msgs) {
            if (x !== first && branches.length < conds.length && who(x.endpoint1.connectedTo) === who(first.endpoint1.connectedTo)
              && who(x.endpoint2.connectedTo) === who(first.endpoint2.connectedTo)) branches.push([]);
            branches[branches.length - 1].push(x);
          }
          conds.forEach((c, i) => {
            out.push(`${pad}${i ? "else" : "alt"} ${seqText(c)}`);
            emit(branches[i] || [], inner, pad + "  ", [...calls]);
          });
        } else {
          const kind = (title.match(/^\s*(loop|opt|par|break|critical)/i) || [, "opt"])[1].toLowerCase();
          const text = (areas.find(t => t.label === "Text") || {}).text;
          out.push(`${pad}${kind} ${seqText(cond(text) || (kind === "opt" && !/^\s*opt/i.test(title) ? title : ""))}`);
          emit(f.msgs, inner, pad + "  ", calls);
        }
        out.push(`${pad}end`);
        f.msgs.forEach(x => done.add(x));
        continue;
      }
      let [a, b] = [m.endpoint1, m.endpoint2];
      if (a.style && a.style !== "None" && (!b.style || b.style === "None")) [a, b] = [b, a];
      const from = who(a.connectedTo), to = who(b.connectedTo);
      const open = calls.lastIndexOf(`${to}>${from}`);
      const async = /open/i.test(b.style || "");
      const arrow = from !== to && open >= 0 && !async ? "-->>" : async ? "-)" : "->>";
      if (arrow === "-->>") calls.splice(open, 1);
      else if (from !== to) calls.push(`${from}>${to}`);
      out.push(`${pad}p${from + 1}${arrow}p${to + 1}: ${seqText(textOf(m))}`);
      done.add(m);
    }
  }
  emit(messages, fragments, "  ", []);
  for (const s of shapes) if (/Text|Note/.test(s.class) && textOf(s) && !titles.includes(textOf(s))) out.push(`  %% note: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

// An entity-relationship diagram: Lucid's entity shapes (ERDEntityBlock4 and
// kin) hold a Name text area and numbered rows, Key1/Field1/Type1 and so on;
// relationships are lines whose ends are crow's-foot styles ("CFN ERD Zero Or
// More Arrow"). Returns null when the page has no entities.
function erToMermaid(shapes, lines) {
  const entities = shapes.filter(s => /^ERDEntity/.test(s.class));
  if (!entities.length) return null;
  const ids = new Map(entities.map((s, i) => [s.id, "e" + (i + 1)]));
  const quote = t => `"${t.replace(/\s+/g, " ").trim().replace(/"/g, "#quot;")}"`;
  const word = t => t.trim().replace(/\s+/g, "_").replace(/[^\w\-()[\],.]/g, "") || "_";
  const out = ["erDiagram"];
  for (const s of entities) {
    const areas = s.textAreas || [];
    const name = (areas.find(t => t.label === "Name") || {}).text || textOf(s).split("\n")[0] || "entity";
    out.push(`  ${ids.get(s.id)}[${quote(name)}] {`);
    const rows = new Map(); // row number -> { Key, Field, Type }
    for (const t of areas) {
      const m = t.label.match(/^(Key|Field|Type)(\d+)$/);
      if (m) rows.set(+m[2], { ...rows.get(+m[2]), [m[1]]: (t.text || "").trim() });
    }
    for (const [, r] of [...rows].sort((a, b) => a[0] - b[0])) {
      if (!r.Field) continue;
      // "VARCHAR(255) NOT NULL": Mermaid's type is one word, the rest is a comment.
      const [type, ...more] = (r.Type || "").split(/\s+/);
      // Lucid's alternate key (AK) is what Mermaid calls a unique key (UK).
      const keys = (r.Key || "").toUpperCase().split(/[\s,/]+/).map(k => k === "AK" ? "UK" : k).filter(k => /^(PK|FK|UK)$/.test(k));
      out.push(`    ${word(type || "_")} ${word(r.Field)}${keys.length ? " " + keys.join(", ") : ""}${more.length ? " " + quote(more.join(" ")) : ""}`);
    }
    out.push("  }");
  }
  // Crow's-foot ends, as Mermaid writes them on the left / right of "--".
  const end = (style, left) => {
    const s = (style || "").toLowerCase();
    const [l, r] = /zero or one/.test(s) ? ["|o", "o|"] : /one or more/.test(s) ? ["}|", "|{"]
      : /zero or more|many/.test(s) ? ["}o", "o{"] : ["||", "||"];
    return left ? l : r;
  };
  for (const l of lines) {
    const a = ids.get(l.endpoint1.connectedTo), b = ids.get(l.endpoint2.connectedTo);
    if (a && b) out.push(`  ${a} ${end(l.endpoint1.style, true)}--${end(l.endpoint2.style, false)} ${b} : ${quote(textOf(l))}`);
  }
  for (const s of shapes) if (!ids.has(s.id) && textOf(s)) out.push(`  %% note: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

function pageToMermaid(page) {
  const shapes = (page.items && page.items.shapes) || [];
  const lines = (page.items && page.items.lines) || [];
  const special = sequenceToMermaid(shapes, lines) || erToMermaid(shapes, lines);
  if (special) return special;
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
  // A container is only a subgraph if something it holds is a node, or a
  // connector ends on it; one holding only freehand strokes, pictures or
  // untitled scraps would be an empty box, so it's a note too.
  const kept = new Set();
  const keep = id => { for (let p = id; p && !kept.has(p); p = parent.get(p)) kept.add(p); };
  for (const s of shapes) if (isNode(s)) keep(parent.get(s.id));
  for (const id of connected) if (isContainer(byId.get(id))) keep(id);
  const isGroup = s => isContainer(s) && kept.has(s.id);
  for (const s of shapes) if (!isGroup(s) && !isNode(s) && textOf(s)) notes.push(textOf(s));

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
      out.push(`${pad}${ids.get(id)}${open}${label(nodeLabel(s))}${close}`);
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
