# Coding style for this project

## What this is

A Word add-in with an embedded Lucidchart diagram editor. Open the task pane,
sign in to your Lucid account, draw diagrams, and insert them into the
document as pictures.

Two stages:

1. **Embedded editor.** Sign in, create/edit Lucidchart diagrams inside the
   task pane, insert them into Word as images.
2. **Lucid -> Mermaid.** A backend translates a Lucidchart diagram into
   Mermaid markdown, which is stored in the inserted image's alt-text. The
   idea: high-quality Lucid visuals for humans, LLM-readable Mermaid
   underneath. Sibling of the Mermaid Block Diagrams and Waveform Viewer
   add-ins (same alt-text trick).

## How it fits together

- Lucid API facts and limits (what embeds, export, contents, search and
  import can and can't do): `notes.md`. Check it before designing a feature.
- `taskpane.html` (GitHub Pages) embeds Lucid with a **token-based editable
  embed**: `https://lucid.app/embeds?token=<embed session token>`. Without an
  embedId the iframe shows Lucid's document picker; when the user picks one,
  the iframe posts `{type: "LucidEmbedEvent", event: "EmbedCreated",
  documentId, embedId}` to the pane. Minting a token with that embedId reopens
  the same diagram. The pane keeps recent embeds (localStorage) and reads the
  embed ids in the document's alt texts, so its diagram menu reopens those
  with no picker; `/embed` makes a new edit embed over the API, which Lucid
  allows only for documents picked once in its picker.
- `server.js` runs on localhost (https via mkcert, because Lucid requires an
  https redirect URI) and holds the client secret: OAuth with refresh tokens,
  `POST /embeds/token`, PNG export via `GET /documents/{id}` with
  `Accept: image/png` (`pageId=` picks the page), and `/documents/{id}/contents`
  for the Mermaid. Single-machine prototype; it moves to Azure
  Functions / AWS Lambda later.
- Lucid's editor and login pages refuse to be framed (`X-Frame-Options:
  SAMEORIGIN`); only `/embeds` can be. Sign-in therefore opens a browser tab.
- Alt text format is in README.md: link lines, then a fenced Mermaid block.
  Pictures from older builds (no `lucid-page`, no Mermaid) must keep parsing
  (`parseAlt` in taskpane.html).
- `mermaid.js` (stage 2) turns one page of `GET /documents/{id}/contents` into
  Mermaid: a flowchart, or (`uml.js`) a sequence / ER / class / state diagram or
  mind map when the page is drawn with Lucid's library for that, recognised by
  shape class. Contents have shapes (class, textAreas, `contains` for
  containers), lines (endpoint1/2 `connectedTo` + end `style`) but **no
  positions**, so only structure survives; what positions alone would say
  (swimlane membership, which lifeline an activation bar is on) is inferred or
  stated as unknown. `svg.js` reads back Mermaid code Lucid keeps as a picture
  (`LucidNativeMermaidDiagramBlock`, its `image.url` is Mermaid's SVG).
  `dev/fixtures/` holds real Lucid pages (mostly made by Lucid AI) and their
  output; `node dev/test-mermaid.js` regenerates the `.mmd` files and checks
  them with the pinned Mermaid parser, so a change shows up in `git diff`.
- Flowcharts made from Mermaid code in Lucid can't be exported (notes.md, Export
  quirks). `/pages` flags them `fromCode` (not the one-picture kind above, which
  exports fine); the pane
  re-fetches the page list before every picture (`freshPages`; cached per version), and draws
  those pages from their Mermaid with Mermaid 11.17.2 (pinned) from jsDelivr,
  with plain SVG labels so the canvas isn't tainted, capped to WebKit's canvas
  limits. `mermaid.js` gives each shape at the end of a code subgraph's connectors
  to the subgraph listing most of its connectors.
- Captions (unless the Caption box by Insert is unticked; remembered in
  localStorage): added after the picture is committed, so they can't cost an
  insert. Caption style and SEQ Figure field where Word allows; Word on the web
  accepts `styleBuiltIn = Caption` without error but ignores it (so it's read
  back) and refuses fields, so there the caption is hand formatted (after its
  text is in: earlier formatting doesn't carry) and every typed "Figure N:"
  caption is renumbered in document order. Update only rewrites a caption whose
  text is still "Figure N: <old title>". Insert goes below a figure's caption
  when the cursor is on its picture, and leaves the cursor below the new figure
  (in a fresh paragraph at the end of the document). New pictures fit 6.5 x
  8.5in (MAX_WIDTH_PT / MAX_HEIGHT_PT in server.js), or the table cell they go
  in. The picture and caption paragraphs are set to Normal: made after a heading
  they would otherwise become headings too.
- Each picture records the Lucid document `version` it was exported from
  (`lucid-version:`); comparing it with `/info` is how the pane says a picture
  is out of date. The backend caches the last PNG per document keyed on that
  version (and DPI), which is what makes repeat inserts fast. Export DPI adapts so a picture has ~400 ppi at its width in Word (BASE_DPI/TARGET_PPI in server.js).
- Getting the Mermaid to an LLM: the pane's MD view writes the open document as
  Markdown with each diagram's Mermaid in place (Office.js paragraphs, tables,
  pictures); `docx2md.py` does the same for a saved .docx. Keep the two alike.
- The pane also runs in a plain browser with the Word buttons disabled, which
  is how the Lucid side can be tested without Word.

## Testing in real Word (no human needed)

Claude drives Word on the web in a dedicated Chrome over the DevTools protocol:

- `dev/chrome.ps1` starts it (own profile, Microsoft + Lucid signed in, opens
  "Claude's test doc"). Keep the window un-minimised or screenshots hang.
- `node dev/serve.js` (keep it running in the background) answers the pane's
  GitHub Pages URLs from the local files, so a change is live on the next pane
  reload (`node dev/cdp.js eval taskpane.html "location.reload()"`): no push and
  no `?v=N` bump needed while testing. It only holds Word's frames: holding
  Lucid's pages too made them fail to load.
- Background commands stop after their timeout (max 2h): restart `server.js`
  and `serve.js` when they do.
- `node server.js` in the background too; restart it after editing `server.js`
  or `mermaid.js`.
- `dev/cdp.js`: `eval` (Office.js runs in the `taskpane.html` frame, so
  `Word.run` reads the document), `click` (trusted mouse click, works in Lucid's
  frames too; use `css:#id` for buttons, text matches hidden help too), `type`,
  `key`, `mouse`, `file`, `shot`, `open`/`close` (tabs). Chrome doesn't render a
  background tab: Lucid tabs sit on their loading screen until `shot` brings
  them to the front.
- `node dev/e2e.js`: the pane's main flows in the test Word, PASS/FAIL per
  check (insert, captions, headings, table cells, update, MD view). Run it after
  pane changes; `node dev/test-mermaid.js` after translator changes (it also
  checks the pane's script compiles).
- `dev/word.js`: `doc` (pictures and paragraphs), `clear`, `end`, `open <docId>`
  (a diagram straight into the pane's editor). `dev/contents.js <doc> <name>`
  saves a document's contents as a fixture.
- New realistic diagrams: Lucid AI (lucid.app home, "Generate with AI", or the
  AI panel in an editor: type, then click Send; a prompt typed on the home page
  can be lost if its tab reloads). Lucid's import dialog takes Mermaid,
  draw.io, Visio... files (the documents page, New > Import documents; `file`
  fills its input). Templates don't load on this account.

The user allows: anything in Claude's test doc, any of their Lucid diagrams.
Commit locally; the user pushes.

## Style

Goal: minimalistic, short, code that works. Not clever, not complete, not
future-proof — just correct and as small as it can be.

Optimize for one thing: a reader can go top to bottom and understand the whole
pipeline without jumping through indirection. This is a prototype, not a
platform — code like it.

- Prefer one flat script over a package with modules, until a file is
  genuinely too long to hold in your head (>300-400 lines is the rough
  trigger, not a hard rule).
- No class where a function will do. No framework where a function will do.
  No config system (YAML/JSON/env-driven settings) until there's a second
  real use case that needs it — hardcode the value and leave a comment.
- No abstraction for a single call site. If something is called once,
  inline it. Don't build for imagined future flexibility.
- Prefer explicit, boring code over clever code. If you have to explain a
  trick, don't use the trick.
- Write it so it fails loudly. Assertions and explicit checks over silent
  fallbacks or broad try/except. A crash with a clear message beats a
  quietly wrong result.
- Comments explain *why*, not *what*. If a line needs a "what" comment, the
  line should be rewritten to not need it.
- Delete code aggressively. Dead branches, unused params, speculative
  hooks — remove them the moment they're unused, don't leave them "just in
  case."
- No premature error handling for inputs that can't occur here. Validate
  only at real boundaries (user input, file I/O, network, the Word API, the
  Lucid API).
- Print/log state at the boundaries you're least sure about (Lucid auth and
  API responses, Lucid -> Mermaid translation, image generation, Office.js
  calls) rather than wrapping everything in logging.

When in doubt: fewer files, fewer layers, fewer knobs.

## Word caches the taskpane aggressively

Every time `taskpane.html` changes and gets pushed, bump the `?v=N` query
param on `SourceLocation` in `manifest.xml` to the next number. Without a
new URL, Word keeps serving a stale cached copy of the taskpane even after
a fresh GitHub Pages deploy, and changes silently don't show up. This one
line has repeatedly cost more debugging time than everything else in the
sibling projects — always bump it, no exceptions.

Any separate `.js` files are separate requests and cache independently of the
taskpane, so they carry the same `?v=N` on their `<script src>` tags. Bump all
of them to the same N in one go — a fresh `taskpane.html` paired with a stale
script is the worst version of this bug, because the build marker updates and
everything still looks fine.

The taskpane also shows a `build vN` marker at the top of the page (bump it
alongside `?v=N`) so a stale load is visually obvious instead of silently
misleading. The manifest's `<ProviderName>` is the same `build vN` text, so
the Add-ins dialog says which manifest is installed; bump it too.

If bumping `?v=N` still doesn't work and the build marker won't update no
matter what, that's a deeper cache (browser HTTP cache or a Word-session
cache tied to your profile), not a stale URL. Fastest fix: sideload in a
fresh private/incognito browser window instead of debugging the cache
layers.
