// Pages of a kind Mermaid has its own diagram for, rather than a flowchart:
// UML sequence, class and state diagrams, ER diagrams, mind maps and timelines. Lucid draws
// each from its own shape library, so a page is recognised by its shape
// classes. The flowchart translator (mermaid.js) takes everything else.

// Same as mermaid.js: a "Placeholder" text area is Lucid's hint in an empty box,
// "Add title" an unfilled frame title.
const textOf = item => (item.textAreas || []).filter(t => t.label !== "Placeholder" && !(t.label === "FrameTitle" && t.text === "Add title"))
  .map(t => t.text || "").join("\n").trim();
const area = (s, label) => ((s.textAreas || []).find(t => t.label === label) || {}).text || "";

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
  // inferred. Rules: a bar isn't on a lifeline it exchanges messages with (a
  // message from a bar to itself is a self call); every participant takes part
  // in something; and, in Lucid's listing of the bars, each participant's first
  // bar comes in left-to-right order. That last one holds both for Lucid AI
  // (bars listed lifeline by lifeline) and for a person drawing as they go
  // (bars listed as the calls happen, lifelines placed in order of first
  // involvement); it's dropped if nothing keeps it. Of the placements left, the
  // cheapest by `cost` wins. Found by branch and bound, which gives up after a
  // while on a huge diagram and keeps its best so far.
  const others = id => messages.flatMap(m => m.endpoint1.connectedTo === id && m.endpoint2.connectedTo !== id ? [m.endpoint2.connectedTo]
    : m.endpoint2.connectedTo === id && m.endpoint1.connectedTo !== id ? [m.endpoint1.connectedTo] : []);
  const direct = new Set(messages.flatMap(m => [m.endpoint1.connectedTo, m.endpoint2.connectedTo]).filter(id => owner.has(id)).map(id => owner.get(id)));
  const at = (id, placed) => owner.has(id) ? owner.get(id) : placed.get(id);
  const fits = (a, p, placed) => others(a).every(o => at(o, placed) !== p);
  // A message often names its receiver or sender ("reviewCart()" to Cart
  // Service, "paymentApproved" from the Payment Gateway): words of 4+ letters
  // shared by its text and a participant's name.
  const words = t => (t || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4);
  const nameWords = participants.map(p => words(p.name));
  const names = (m, p) => words(textOf(m)).some(w => nameWords[p].some(n => n.startsWith(w) || w.startsWith(n)));
  // Cost of the bars placed so far: 3000 per pair of participants that talk
  // (a conversation keeps to a few pairs), 3000 more per pair that talks only
  // one way (calls get answers: whoever a participant calls answers it), 1000
  // per lifeline a message crosses (lifelines that talk are drawn side by side),
  // less 1500 for a message with an end on a participant its text names (once
  // per message). `bound` is the least any completion could cost: a message
  // not fully placed may still earn the bonus or answer a one-way pair.
  const cost = placed => {
    let c = 0, open = 0;
    const ways = new Set();
    for (const m of messages) {
      const a = at(m.endpoint1.connectedTo, placed), b = at(m.endpoint2.connectedTo, placed);
      if (a != null && b != null) {
        c += Math.abs(a - b) * 1000;
        if (a !== b) ways.add(a + ">" + b);
      }
      if ((a != null && names(m, a)) || (b != null && names(m, b))) c -= 1500;
      else if (a == null || b == null) open++;
    }
    const pairs = new Set([...ways].map(w => w.split(">").map(Number).sort((x, y) => x - y).join("-")));
    const oneWay = [...ways].filter(w => !ways.has(w.split(">").reverse().join(">"))).length;
    c += pairs.size * 3000;
    return { c: c + oneWay * 3000, bound: c - 1500 * open };
  };
  let best = null, bestCost = Infinity, steps = 0;
  // `newest`: the rightmost participant whose first bar is placed (-1: none yet).
  const place = (i, placed, newest, inOrder) => {
    if (++steps > 20000 || cost(placed).bound >= bestCost) return;
    if (i === activations.length) {
      const used = new Set([...direct, ...placed.values()]);
      if (participants.every((_, p) => used.has(p))) { best = placed; bestCost = cost(placed).c; }
      return;
    }
    const had = new Set(placed.values());
    for (let p = 0; p < participants.length; p++) {
      if (!fits(activations[i], p, placed) || (inOrder && !had.has(p) && p < newest)) continue;
      place(i + 1, new Map(placed).set(activations[i], p), had.has(p) ? newest : Math.max(newest, p), inOrder);
    }
  };
  place(0, new Map(), -1, true);
  if (!best) { steps = 0; place(0, new Map(), -1, false); }
  // Nothing keeps both rules (an odd drawing): each bar on the first lifeline it doesn't talk to.
  const placed = best || new Map();
  if (!best) for (const a of activations) placed.set(a, Math.max(0, participants.findIndex((_, p) => fits(a, p, placed))));
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
  // One Mermaid word: no spaces or odd characters, and not starting with a digit (ER's grammar refuses that).
  const word = t => t.trim().replace(/\s+/g, "_").replace(/[^\w\-()[\],.]/g, "").replace(/^(?=\d)/, "_") || "_";
  const out = ["erDiagram"];
  for (const s of entities) {
    const areas = s.textAreas || [];
    const name = (areas.find(t => t.label === "Name") || {}).text || textOf(s).split("\n")[0] || "entity";
    out.push(`  ${ids.get(s.id)}[${quote(name)}] {`);
    const rows = new Map(); // row number -> { Key, Field, Type }
    for (const t of areas) {
      const m = (t.label || "").match(/^(Key|Field|Type)(\d+)$/);
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

// Labels after a ":" in class and state diagrams: one line, quotes as entities.
const inline = text => text.split("\n").map(l => l.trim()).filter(Boolean).join("<br>").replace(/"/g, "#quot;").replace(/#(?!quot;)/g, "#35;");

// A UML class diagram: UMLClassBlock (and interface / enumeration blocks) with
// a Title and compartments Text1 (attributes), Text2 (methods)... Lines say the
// relationship with their end styles (Generalization, Composition,
// Aggregation, arrows) and carry multiplicities in text areas uml0 (at
// endpoint1) and uml1 (at endpoint2). Returns null without classes.
function classToMermaid(shapes, lines) {
  const classes = shapes.filter(s => /^UML(Class|Interface|Enum)/.test(s.class));
  if (!classes.length) return null;
  const ids = new Map(classes.map((s, i) => [s.id, "c" + (i + 1)]));
  const out = ["classDiagram"];
  for (const s of classes) {
    const title = area(s, "Title") || textOf(s).split("\n")[0] || "class";
    // Mermaid writes generics with ~ and opens a member block with {.
    const members = (s.textAreas || []).filter(t => /^Text\d+$/.test(t.label)).flatMap(t => (t.text || "").split("\n"))
      .map(l => l.trim().replace(/[<>]/g, "~").replace(/[{}]/g, "")).filter(Boolean);
    const kind = /Interface/.test(s.class) ? "<<interface>>" : /Enum/.test(s.class) ? "<<enumeration>>" : "";
    out.push(`  class ${ids.get(s.id)}["${inline(title)}"]${members.length || kind ? " {" : ""}`);
    if (kind) out.push(`    ${kind}`);
    for (const m of members) out.push(`    ${m}`);
    if (members.length || kind) out.push("  }");
  }
  // The end marker on each side of the line, as Mermaid writes it left / right.
  const marker = (style, left) => {
    const s = (style || "").toLowerCase();
    return /generali[sz]ation|inherit|realization|hollow triangle/.test(s) ? (left ? "<|" : "|>")
      : /composition/.test(s) ? "*" : /aggregation/.test(s) ? "o" : /arrow/.test(s) ? (left ? "<" : ">") : "";
  };
  for (const l of lines) {
    const a = ids.get(l.endpoint1.connectedTo), b = ids.get(l.endpoint2.connectedTo);
    if (!a || !b) continue;
    const many = label => { const t = area(l, label).trim(); return t ? ` "${inline(t)}"` : ""; };
    const text = (l.textAreas || []).filter(t => !/^uml\d$/.test(t.label)).map(t => t.text || "").join(" ").trim();
    out.push(`  ${a}${many("uml0")} ${marker(l.endpoint1.style, true)}--${marker(l.endpoint2.style, false)}${many("uml1")} ${b}${text ? " : " + inline(text) : ""}`);
  }
  for (const s of shapes) if (!ids.has(s.id) && textOf(s) && !/Frame/.test(s.class)) out.push(`  %% note: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

// A UML state machine: UMLStateBlock (text areas State and Action), with
// UMLStartBlock / UMLEndBlock for the initial and final pseudo-states, which
// Mermaid writes [*]. Transitions are lines labelled "event [guard]". A state
// listing others (contains) is a composite state. Returns null without states.
function stateToMermaid(shapes, lines) {
  if (!shapes.some(s => /^UMLState/.test(s.class))) return null;
  const byId = new Map(shapes.map(s => [s.id, s]));
  const isPseudo = s => /^UML(Start|End|Initial|Final)/.test(s.class);
  const connected = new Set(lines.flatMap(l => [l.endpoint1.connectedTo, l.endpoint2.connectedTo]));
  // In the order the machine runs through them (breadth first from the
  // initial state), which is also the order Mermaid lays them out in.
  const reach = [...shapes.filter(s => /^UML(Start|Initial)/.test(s.class)).map(s => s.id)];
  for (let i = 0; i < reach.length; i++)
    for (const l of lines) if (l.endpoint1.connectedTo === reach[i] && !reach.includes(l.endpoint2.connectedTo)) reach.push(l.endpoint2.connectedTo);
  const rank = s => reach.includes(s.id) ? reach.indexOf(s.id) : reach.length + shapes.indexOf(s);
  const states = shapes.filter(s => !isPseudo(s) && (/^UMLState/.test(s.class) || (connected.has(s.id) && textOf(s))))
    .sort((x, y) => rank(x) - rank(y));
  lines = [...lines].sort((x, y) => (rank(byId.get(x.endpoint1.connectedTo) || {}) || 0) - (rank(byId.get(y.endpoint1.connectedTo) || {}) || 0));
  const ids = new Map(states.map((s, i) => [s.id, "s" + (i + 1)]));
  // Each state or pseudo-state belongs to the smallest composite state listing it.
  const parent = new Map();
  for (const c of states.filter(s => s.contains && s.contains.shapes.length))
    for (const id of c.contains.shapes)
      if (byId.has(id) && id !== c.id && (!parent.has(id) || byId.get(parent.get(id)).contains.shapes.length > c.contains.shapes.length)) parent.set(id, c.id);
  const out = ["stateDiagram-v2"];
  // [*] means the start or the end of the scope it's written in, so a
  // transition touching one is written inside that pseudo-state's composite.
  const scopeOf = l => [l.endpoint1.connectedTo, l.endpoint2.connectedTo].map(id => byId.get(id)).filter(s => s && isPseudo(s)).map(s => parent.get(s.id))[0];
  const name = id => ids.get(id) || "[*]";
  const emit = (scope, pad) => {
    for (const s of states.filter(s => parent.get(s.id) === scope)) {
      const title = area(s, "State") || area(s, "Title") || textOf(s).split("\n")[0] || " ";
      const inner = states.some(x => parent.get(x.id) === s.id) || lines.some(l => scopeOf(l) === s.id);
      out.push(`${pad}state "${inline(title)}" as ${ids.get(s.id)}${inner ? " {" : ""}`);
      if (inner) { emit(s.id, pad + "  "); out.push(`${pad}}`); }
      const action = area(s, "Action").trim();
      if (action) out.push(`${pad}${ids.get(s.id)} : ${inline(action)}`);
    }
    for (const l of lines) {
      const a = l.endpoint1.connectedTo, b = l.endpoint2.connectedTo;
      if (!byId.has(a) || !byId.has(b) || (scopeOf(l) || undefined) !== scope) continue;
      if (![a, b].every(id => ids.has(id) || isPseudo(byId.get(id)))) continue;
      // The arrowhead marks the target; Lucid draws most transitions endpoint1 -> endpoint2.
      const back = l.endpoint1.style && l.endpoint1.style !== "None" && (!l.endpoint2.style || l.endpoint2.style === "None");
      const [from, to] = back ? [b, a] : [a, b];
      const text = textOf(l);
      out.push(`${pad}${name(from)} --> ${name(to)}${text ? " : " + inline(text) : ""}`);
    }
  };
  emit(undefined, "  ");
  for (const l of lines) if (!byId.has(l.endpoint1.connectedTo) || !byId.has(l.endpoint2.connectedTo))
    out.push(`  %% transition with a loose end${textOf(l) ? ": " + textOf(l).replace(/\s+/g, " ") : ""}`);
  for (const s of shapes) if (!ids.has(s.id) && !isPseudo(s) && textOf(s)) out.push(`  %% note: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

// A mind map: Lucid's IntelligentMindMapRootNodeBlock and its
// IntelligentMindMapNodeBlock branches, joined by plain lines. Mermaid's mindmap
// is the same tree, written by indentation, so it's walked out from the root.
function mindmapToMermaid(shapes, lines) {
  const root = shapes.find(s => /MindMapRoot/.test(s.class));
  if (!root) return null;
  const byId = new Map(shapes.map(s => [s.id, s]));
  const next = id => lines.flatMap(l => l.endpoint1.connectedTo === id ? [l.endpoint2.connectedTo] : l.endpoint2.connectedTo === id ? [l.endpoint1.connectedTo] : []);
  const out = ["mindmap", `  root(("${inline(textOf(root) || "mind map")}"))`];
  const seen = new Set([root.id]);
  let n = 0;
  const walk = (id, pad) => {
    for (const c of next(id)) {
      if (seen.has(c) || !byId.has(c)) continue;
      seen.add(c);
      out.push(`${pad}m${++n}["${inline(textOf(byId.get(c)) || " ")}"]`);
      walk(c, pad + "  ");
    }
  };
  walk(root.id, "    ");
  for (const s of shapes) if (!seen.has(s.id) && textOf(s) && !/Frame/.test(s.class)) out.push(`  %% not connected to the map: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

// A Lucid timeline: TimelineContainerBlock columns (a period's name, and its
// months in t___MonthRange__) and TimelineVizMilestoneBlock milestones, whose
// dates are in their linked data (the API gives no positions). Mermaid's
// timeline: a section per period, each milestone under the period its month is in.
function timelineToMermaid(shapes) {
  const milestones = shapes.filter(s => /^TimelineVizMilestone/.test(s.class));
  const periods = shapes.filter(s => /^TimelineContainer/.test(s.class) && textOf(s));
  if (!milestones.length && !periods.length) return null;
  const text = t => inline(t).replace(/:/g, "#58;");
  const dated = milestones.map(s => {
    const date = ((s.linkedData || []).flatMap(l => l.data || []).find(d => d.key === "Date") || {}).value || "";
    return { name: area(s, "t___Name__") || textOf(s), date, time: Date.parse(date) };
  }).sort((a, b) => (a.time || Infinity) - (b.time || Infinity));
  const month = m => new Date(m.time).toLocaleString("en-US", { month: "long" });
  const year = m => String(new Date(m.time).getFullYear());
  const out = ["timeline"];
  const frame = shapes.find(s => /Frame/.test(s.class) && textOf(s));
  if (frame) out.push(`  title ${text(textOf(frame))}`);
  const placed = new Set();
  for (const p of periods) {
    const name = area(p, "t___Name__"), months = area(p, "t___MonthRange__");
    // "Q1 2027" + "January, February, and March": a milestone dated in one of those months (and that year, if named).
    const inside = dated.filter(m => !placed.has(m) && m.time && months.includes(month(m)) && (!/\d{4}/.test(name) || name.includes(year(m))));
    out.push(`  section ${text(name || months || "period")}`);
    for (const m of inside) { placed.add(m); out.push(`    ${text(m.date)} : ${text(m.name || "milestone")}`); }
  }
  const rest = dated.filter(m => !placed.has(m));
  if (rest.length && periods.length) out.push("  section Other dates");
  for (const m of rest) out.push(`    ${text(m.date || "no date")} : ${text(m.name || "milestone")}`);
  return out.join("\n");
}

// A UML component diagram: UMLComponentBlock components, each joined by a line
// to its provided (lollipop) and required (socket) interface shapes; a line
// from a required interface to a provided one says the first component uses
// the second. Mermaid has no component diagram, so it's a flowchart of the
// components with a dashed "uses" arrow per such line, the interfaces folded
// into their owners (named on the arrow when they have a name).
function componentToMermaid(shapes, lines) {
  const components = shapes.filter(s => /^UMLComponent/.test(s.class));
  if (!components.length) return null;
  const byId = new Map(shapes.map(s => [s.id, s]));
  const isInterface = id => byId.has(id) && /Interface/.test(byId.get(id).class);
  const ids = new Map(components.map((s, i) => [s.id, "c" + (i + 1)]));
  // An interface belongs to the component a line joins it to.
  const ownerOf = new Map();
  for (const l of lines) {
    const [a, b] = [l.endpoint1.connectedTo, l.endpoint2.connectedTo];
    if (ids.has(a) && isInterface(b)) ownerOf.set(b, a);
    if (ids.has(b) && isInterface(a)) ownerOf.set(a, b);
  }
  const out = ["flowchart TD"];
  for (const s of components) out.push(`  ${ids.get(s.id)}["${inline(area(s, "Title") || textOf(s) || "component")}"]`);
  const seen = new Set();
  for (const l of lines) {
    let [a, b] = [l.endpoint1.connectedTo, l.endpoint2.connectedTo];
    if (ids.has(a) && ids.has(b)) {
      // Towards the arrowhead; Lucid draws most lines endpoint1 -> endpoint2.
      const head = st => !!st && st !== "None";
      if (head(l.endpoint1.style) && !head(l.endpoint2.style)) [a, b] = [b, a];
      out.push(`  ${ids.get(a)} -->${textOf(l) ? `|"${inline(textOf(l))}"|` : ""} ${ids.get(b)}`);
      continue;
    }
    if (!isInterface(a) || !isInterface(b)) continue;
    // From the requiring side to the providing one.
    if (/Provided/.test(byId.get(a).class)) [a, b] = [b, a];
    const from = ownerOf.get(a), to = ownerOf.get(b);
    if (!from || !to || from === to) continue;
    const name = [textOf(byId.get(a)), textOf(byId.get(b)), textOf(l)].find(Boolean);
    const edge = `  ${ids.get(from)} -.->|"${inline(name ? "uses " + name : "uses")}"| ${ids.get(to)}`;
    if (!seen.has(edge)) out.push(edge);
    seen.add(edge);
  }
  for (const s of shapes) if (!ids.has(s.id) && !isInterface(s.id) && textOf(s) && !/Frame/.test(s.class)) out.push(`  %% note: ${textOf(s).replace(/\s+/g, " ")}`);
  return out.join("\n");
}

function umlToMermaid(shapes, lines) {
  return sequenceToMermaid(shapes, lines) || erToMermaid(shapes, lines) || classToMermaid(shapes, lines)
    || stateToMermaid(shapes, lines) || mindmapToMermaid(shapes, lines) || timelineToMermaid(shapes) || componentToMermaid(shapes, lines);
}

module.exports = { umlToMermaid };
