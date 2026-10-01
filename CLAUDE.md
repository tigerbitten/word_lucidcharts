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

- `taskpane.html` (GitHub Pages) embeds Lucid with a **token-based editable
  embed**: `https://lucid.app/embeds?token=<embed session token>`. Without an
  embedId the iframe shows Lucid's document picker; when the user picks one,
  the iframe posts `{type: "LucidEmbedEvent", event: "EmbedCreated",
  documentId, embedId}` to the pane. Minting a token with that embedId reopens
  the same diagram.
- `server.js` runs on localhost (https via mkcert, because Lucid requires an
  https redirect URI) and holds the client secret: OAuth with refresh tokens,
  `POST /embeds/token`, and PNG export via `GET /documents/{id}` with
  `Accept: image/png`. Single-machine prototype; it moves to Azure
  Functions / AWS Lambda later.
- Lucid's editor and login pages refuse to be framed (`X-Frame-Options:
  SAMEORIGIN`); only `/embeds` can be. Sign-in therefore opens a browser tab.
- Alt text format is in README.md. Stage 2 adds Mermaid below those lines,
  and existing lines must keep parsing (`parseAlt` in taskpane.html).
- Each picture records the Lucid document `version` it was exported from
  (`lucid-version:`); comparing it with `/info` is how the pane says a picture
  is out of date. The backend caches the last PNG per document keyed on that
  version (and DPI), which is what makes repeat inserts fast. Export DPI adapts so a picture has ~400 ppi at its width in Word (BASE_DPI/TARGET_PPI in server.js).
- The editable embed also needs the user logged in to lucid.app in the same
  browser (cookie session), on top of the OAuth token.
- The pane also runs in a plain browser with the Word buttons disabled, which
  is how the Lucid side can be tested without Word.

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
