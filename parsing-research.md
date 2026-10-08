# Making inserted diagrams AI-readable: findings (2026-10-08)

## The problem

Each inserted picture carries Mermaid in its alt text, translated from Lucid's
`GET /documents/{id}/contents`. That works when a diagram's labels are typed *on*
its arrows. People often draw labels as separate text boxes next to the arrows
instead, and then the Mermaid loses them: `/contents` has shapes, text and
connections but **no positions**, so nothing says which arrow a loose text box
belongs to. Today such texts become stray boxes (draw.io imports) or unordered
`%% note` comments (native Lucid), arrows with an unglued end are dropped, and
the order of steps is lost.

## What we tested

**1. With positions, does a fixed rule (no AI) put labels on the right arrows? Yes.**

Positions came from the editor's Export > Visio (VSDX), which holds the same
geometry an extension reads. Rule (`dev/lucid-probe/vsdx-labels.js`):
- A text box that nothing connects to goes on the nearest arrow within 0.5in,
  unless a box other than that arrow's own two ends is closer.
- Otherwise it's a note on the nearest box, or a free note.
- A text in a bigger font than every box's is the title.
- An arrow end left near a box but not glued to it is snapped to that box.
- A frame becomes a titled subgraph.

| Diagram | Rule with positions | Translator today |
|---|---|---|
| Expense approval (built: 5 loose labels, a box note, a free note, a title) | 9/9 | loose labels as stray boxes |
| Login flow (built to break the rule: labels hugging decision corners, on top of a line, 22pt off, on bent loop-backs, a box note with a line 12pt away) | 11/11 | not run |
| "Test 001", a real diagram (PKCE steps between two boxes, labels above arrows, notes inside a box, a frame, one half-glued arrow) | all 5 labels and both notes right | 7 unordered comments, one arrow dropped, step order lost |

All outputs parse with the pinned Mermaid. Samples and answers: `dev/lucid-probe/samples/`.

Positions also give order (arrows top to bottom), so a diagram like Test 001
could become a real Mermaid `sequenceDiagram`.

**2. Where can positions come from?**
- Lucid's REST API: nowhere. Export refuses Visio and SVG (406), PDF is 403 on
  our plan, and `/contents` has no geometry (Lucid: no plans to add it).
- The editor's Export > JSON is the same as `/contents`. Export > Visio has
  everything, but only by hand from the editor menu.
- A Lucid **editor extension** can read it all: boxes, classes, borders, fonts,
  line paths and connections.

**3. Can an extension hand it to the add-in? Probably yes.**
Page and shape "shape data" already come back in `/contents` as `customData`.
An extension writes the geometry there, and the add-in reads it with the call
it already makes: no server. Each write is an edit (the version moves, which
makes pictures look out of date), so it should write only on change.

**4. Does an extension run inside the add-in's embedded editor? Probably not.**
- The embed's menu has no Developer, File or Share.
- Developer mode is a localStorage flag (`<userId> editorextensiondevMode`).
  With it set inside the embed, the embed fetched developer shape libraries
  but never the extension manifest or code; the full editor fetched both.
- Not proven: Chrome 153 blocked lucid.app from reaching localhost (Local
  Network Access), so no stand-in extension actually ran.
- The definitive test: install the draft extension (`dev/lucid-probe/extension.ts`)
  and see whether its "ran at" stamp moves when a diagram is opened only in the add-in.

If it doesn't run in the embed, positions only update when the diagram is opened
on lucid.app, so pictures edited in Word would carry stale or missing geometry.

## Blockers met
- npm's registry is blocked on Broadcom's network ("per company policy"), so
  the Lucid SDK can't be installed there. Install it on another network:
  `npm install --prefix dev/lucid-probe lucid-extension-sdk lucid-package`.
- Developer mode on lucid.app needs Chrome's local-network permission for lucid.app.

## Options

| Route | Accuracy | Needs | Catch |
|---|---|---|---|
| A. Authoring nudge: the pane flags text boxes connected to nothing and asks for labels typed on arrows | exact, once fixed | nothing new | relies on people |
| B. Extension + the rule above | exact, deterministic | extension installed (per user or by an admin) | likely doesn't run in the embed |
| C. AI reads the picture: PNG + `/contents` facts to a vision model, checked (parses, every text and connection kept, nothing added), fallback to today's output | high, can guess wrong | a model API key: a server, or a key per user | diagrams leave Lucid/Word for the model provider: a company-policy question |
| D. Leave it to the reader: keep loose texts as clearly marked "position unknown" notes | partial | nothing | the reading LLM must have the picture |

## Recommendation
1. **Now, either way: do A (and keep D).** The pane already knows which shapes
   are text boxes connected to nothing (classes like `AutoGrowTextBlock`). On
   Insert/Update it can say "3 text boxes on this page aren't attached to
   anything: if they label arrows, type the text on the arrow (double-click it)".
   Labels on arrows already come through exactly, so this fixes the common case
   with no new infrastructure. Unattached texts stay in the Mermaid as notes.
2. **Settle B with the install test.** If extensions run in the embed, build B:
   deterministic, no keys, no data leaving Lucid and Word.
3. **If they don't, decide on C before building it.** Check whether diagrams may
   be sent to an external model, and whether the boss accepts a small server (or
   per-user keys). If yes, add C on top: positions-free, any diagram. If no, A
   plus D is the honest ceiling.

## Files
- `dev/lucid-probe/vsdx-labels.js`: the rule on a Visio export, with scoring.
- `dev/lucid-probe/samples/`: the three Visio exports and the answer files.
- `dev/lucid-probe/extension.ts`: the draft test extension (unbuilt; lines marked CHECK).
- `dev/fixtures/loose-labels-expense.*`, `dev/fixtures/pkce-test001.*`: what today's translator does.
- `notes.md`: the Lucid facts (Extension API, Export quirks).
