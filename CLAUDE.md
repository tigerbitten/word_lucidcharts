# Coding style for this project

## What this is

A Word add-in with an embedded Lucidchart diagram editor. Open the task pane,
sign in to your Lucid account, draw diagrams, and insert them into the
document as pictures. The same pane runs in PowerPoint (`inPpt`).

Two stages:

1. **Embedded editor.** Sign in, create/edit Lucidchart diagrams inside the
   task pane, insert them into Word as images.
2. **Lucid -> Mermaid.** The pane translates a Lucidchart diagram into
   Mermaid markdown, which is stored in the inserted image's alt-text. The
   idea: high-quality Lucid visuals for humans, LLM-readable Mermaid
   underneath. Sibling of the Mermaid Block Diagrams and Waveform Viewer
   add-ins (same alt-text trick).

## How it fits together

- Lucid API facts and limits (what embeds, export, contents, search and
  import can and can't do): `notes.md` at the git tag `dev-tools` (`git show
  dev-tools:notes.md`). Check it before designing a feature.
- The repo holds only what's deployed (static files on one HTTPS host, GitHub
  Pages today). Test tooling, fixtures and design notes live at the tag
  `dev-tools`; don't add them back to the tree.
- `taskpane.html` is the page (markup, styles, help, CSP); `taskpane.js` all of
  its logic (one flat classic script, so its top-level names are globals).
  The pane embeds Lucid with a **token-based editable
  embed**: `https://lucid.app/embeds?token=<embed session token>`. Without an
  embedId the iframe shows Lucid's document picker; when the user picks one,
  the iframe posts `{type: "LucidEmbedEvent", event: "EmbedCreated",
  documentId, embedId}` to the pane. Minting a token with that embedId reopens
  the same diagram. The pane keeps recent embeds (localStorage) and reads the
  embed ids in the document's alt texts, so its diagram menu reopens those
  with no picker; `newEmbed` makes a new edit embed over the API, which Lucid
  allows only for documents picked once in its picker.
- No backend. The pane is a **public OAuth client** (Lucid developer portal,
  client type Public, PKCE S256; `CLIENT_ID` in taskpane.js and signin.js isn't a secret)
  and calls api.lucid.co itself (Lucid's CORS allows any origin): tokens with
  refresh (kept in localStorage; a sign-in ends SESSION_HOURS = 8 after it
  was made, however often refreshed, and is then revoked at
  `/oauth2/token/revoke`, as **Sign out of Lucid** in the diagram menu does),
  `POST /embeds/token`, PNG export via
  `GET /documents/{id}` with `Accept: image/png` (`pageId=` picks the page;
  `lucidExport`), and `/documents/{id}/contents` for the Mermaid. Lucid's
  results are cached in memory per document version, as promises (a prefetch
  and the click after it share one request). Up to v46 a localhost
  `server.js` with a client secret did this: git tag `server-backend`.
- Lucid's editor and login pages refuse to be framed (`X-Frame-Options:
  SAMEORIGIN`); only `/embeds` can be. Sign-in therefore opens a window:
  Office's dialog in Word (`displayDialogAsync`; it must start on the add-in's
  own site), a popup in a plain browser. `signin.html` is both its first page
  (`?state&challenge`: `signin.js` builds Lucid's authorize URL itself, with
  its own client ID, redirect URI and scopes, so the page can't start another
  app's sign-in) and the redirect URI: it wipes the code from the address bar
  (through `History.prototype`: office.js nulls `history.replaceState`) and
  hands `code&state` back by `messageParent` (Word) or a BroadcastChannel
  (plain browser; in Word the pane's storage is partitioned under Word's site,
  so that can't reach it).
  That window also logs in to lucid.app in Word's own browser, which Lucid's
  editor needs (a cookie, apart from the API tokens). Without it the embed
  says so (`onLucidMessage`: a read-only "Viewer", or the picker's
  `logged_out`) and the pane shows its sign-in card, not Lucid's "Log in to
  edit", whose window is the default browser in desktop Word.
- Alt text format is in README.md: link lines, then a fenced Mermaid block.
  Pictures from older builds (no `lucid-page`, no Mermaid) must keep parsing
  (`parseAlt` in taskpane.js).
- Alt text comes from documents anyone may have written. The pane only looks
  up, and Update all only updates, diagrams opened in the editor on this
  computer (`knownIds`, localStorage); Update all lists what it will change and
  asks first. Ids from alt text, Lucid's messages and localStorage must be
  UUIDs (`isId`) before they go into an API path; Lucid's messages count only
  from the pane's own editor frame (`onLucidMessage`).
- `mermaid.js` (stage 2) turns one page of `GET /documents/{id}/contents` into
  Mermaid: a flowchart, or (`uml.js`) a sequence / ER / class / state diagram or
  mind map when the page is drawn with Lucid's library for that, recognised by
  shape class. Contents have shapes (class, textAreas, `contains` for
  containers), lines (endpoint1/2 `connectedTo` + end `style`) but **no
  positions**, so only structure survives; what positions alone would say
  (which lifeline an activation bar is on) is inferred or stated as unknown.
  Swimlane / pool lanes come from each step's `linkedData`
  (`SpreadsheetRowParentKey: "Primary_2"`). `svg.js` reads back Mermaid code Lucid keeps as a picture
  (`LucidNativeMermaidDiagramBlock`, its `image.url` is Mermaid's SVG).
  Text boxes attached to nothing become `%% note:` lines; when the page also has
  unlabelled arrows they're flagged (`UNPLACED`) as possible arrow labels, and the
  pane tells whoever inserts it to type labels on the arrows (`looseNote`).
  Placing them for real needs positions: `parsing-research.md` (tag `dev-tools`).
  Shapes' hyperlinks are left out (they aren't in the picture), and `pageToMermaid` defuses any `%%{`
  directive in the diagram's text. The translator fixtures and their checker
  (`dev/fixtures/`, `dev/test-mermaid.js`) are at the tag `dev-tools`.
- Flowcharts made from Mermaid code in Lucid can't be exported (notes.md, Export
  quirks). `lucidPages` flags them `fromCode` (not the one-picture kind above, which
  exports fine); the pane
  re-fetches the page list before every picture (`exportDiagram`; cached per version), and draws
  those pages from their Mermaid with Mermaid 11.17.2 (pinned, vendored:
  `vendor/mermaid-11.17.2/mermaid.min.js`, `securityLevel: "strict"`),
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
  8.5in (maxWidthPt / maxHeightPt), or the table cell they go
  in. The picture and caption paragraphs are set to Normal: made after a heading
  they would otherwise become headings too.
- Each picture records the Lucid document `version` it was exported from
  (`lucid-version:`); comparing it with `docInfo` is how the pane says a picture
  is out of date. The pane caches the PNG per document keyed on that
  version (and DPI), which is what makes repeat inserts fast. Export DPI adapts so a picture has ~400 ppi at its width in Word (BASE_DPI/TARGET_PPI); each diagram's last export size is kept in localStorage.
- Getting the Mermaid to an LLM: the pane's MD view writes the open document as
  Markdown with each diagram's Mermaid in place (Office.js paragraphs, tables,
  pictures). (`docx2md.py`, the same for a saved .docx, is at the tag `dev-tools`.)
- PowerPoint (the `ppt*` functions; each button branches on `inPpt`): a
  picture is a borderless rectangle filled with the PNG (`addGeometricShape`
  + `fill.setImage`, PowerPointApi 1.8), placed where Insert Picture would put
  it: into the slide's empty content placeholder (deleted), else below the
  title, else centred, fitting 90 x 85% of the slide (`pageSetup`, 1.10). Not
  `setSelectedDataAsync` (the Waveform Viewer's way): on the web it refuses
  while anything on the slide is selected, and nothing clears that
  (`setSelectedShapes([])`, `setSelectedSlides([])` or of the same slide; a
  different slide does). Shapes have no aspect lock: Update restores it. The
  alt text goes in a `LUCID` shape tag (read back to check it wasn't cut) and,
  with 1.10, in `altTextDescription` for LLMs; the `last` tag is the shape
  name. Update adds the new picture at the old one's place and width, then
  deletes the old. PowerPoint on the web quirks, found with `dev/ppt-e2e.js`:
  a run started the moment the last one ended (or alongside it) may never
  answer, notably the selection calls (`ppt()` runs them in turn, 100ms
  apart); `setSelectedShapes([id])` can hang (the pane never selects: the
  menu's "In this document" opens a picture's diagram without selecting it);
  the shape `addGeometricShape` returns can't be reached after the sync, and
  on some slides the new shape only appears in the slide's shapes ~250ms
  later (`pptPlace` polls for it by id). Shape ids repeat across slides; a new
  slide's id and placeholders settle a moment after `slides.add`. No captions.
- The pane also runs in a plain browser with the Word buttons disabled, which
  is how the Lucid side can be tested without Word.

## Security rules (keep them)

The pane holds a Lucid sign-in that can read every diagram the user can open,
and the diagrams are confidential. So:

- Every script is a file on the add-in's host. No CDN, no inline `<script>`, no
  `eval`: the CSP `<meta>` in `taskpane.html` and `signin.html` enforces it, and
  only allows connecting to `api.lucid.co` and framing `lucid.app`. A new
  dependency is vendored under `vendor/<name>-<version>/`; a new place the pane
  talks to needs a reason and a CSP change.
- Office.js is `vendor/office-js-<date>/`: the Word and PowerPoint files from
  `https://appsforoffice.microsoft.com/lib/1/hosted/` (README, Security, says
  how to refresh it). It tries to frame a Microsoft telemetry page; the CSP
  blocks that on purpose.
- Never log a diagram's content (titles, Mermaid, contents) or a token.

## Testing

The test tooling isn't in the tree (it isn't deployed): it's at the git tag
`dev-tools`. `git checkout dev-tools -- dev` brings it back for a session (then
`git rm -r --cached dev` / delete it before committing):

- `dev/chrome.ps1` starts a test Chrome (own profile, Microsoft + Lucid signed
  in, DevTools on :9222) on "Claude's test doc"; `node dev/serve.js` answers
  the pane's GitHub Pages URLs from the local files (vendor/ included), so a
  change is live on the next pane reload without a push.
- `dev/cdp.js` drives it (`eval` in the `taskpane.html` frame, `click`, `type`,
  `shot`...); `node dev/e2e.js` / `node dev/ppt-e2e.js` check the pane's flows
  in Word and PowerPoint on the web (`--stub`: no Lucid needed).
- `node dev/test-mermaid.js` regenerates the translator fixtures' `.mmd` files.
  At that tag it still compiles an inline pane script and loads Mermaid from
  jsDelivr: point it at `taskpane.js` and `vendor/` before relying on it.

Only ever use a personal test Lucid account there, never one holding
company diagrams: the tooling saves real diagram contents into the repo and
lets an agent drive the account.

The user allows: anything in Claude's test doc, any of their (test) Lucid
diagrams. The PowerPoint test deck was made by Claude for testing.
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

Every time the pane changes (`taskpane.html`, `taskpane.js`, or any file it
loads) and gets pushed, bump the `?v=N` query
param on `SourceLocation` in `manifest.xml` to the next number. Without a
new URL, Word keeps serving a stale cached copy of the taskpane even after
a fresh GitHub Pages deploy, and changes silently don't show up. This one
line has repeatedly cost more debugging time than everything else in the
sibling projects — always bump it, no exceptions.

Any separate `.js` files are separate requests and cache independently of the
taskpane, so they carry the same `?v=N`: `listen.js?v=N` and `taskpane.js?v=N`
in `taskpane.html`, `signin.js?v=N` in `signin.html`, `./mermaid.js?v=N` (the
dynamic import in `taskpane.js`), and `./uml.js?v=N` / `./svg.js?v=N` (the
imports at the top of `mermaid.js`; no import map: the CSP forbids inline
scripts). `vendor/` files aren't versioned that way: a new version gets a new
folder. Bump all of them to the same N in one go — a fresh `taskpane.html` paired with a stale
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
