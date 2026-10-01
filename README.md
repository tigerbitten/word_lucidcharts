# Lucidchart Diagrams for Word

A Word add-in with Lucidchart's editor inside the task pane. Sign in to your
Lucid account, draw, and insert the diagram into the document as a picture.
Each picture's alt text links back to its Lucid diagram, so it can be reopened
and updated later, and carries the diagram as Mermaid, so an LLM reading the
`.docx` understands the diagram instead of guessing from pixels. A Word figure
caption ("Figure 3: Login flow") goes under each picture.

Prototype.

Runs on one machine: a small local backend (`server.js`) holds the Lucid
client secret. Moving that to Azure Functions / AWS Lambda comes later.

## Using it

1. Open the add-in. If you're not signed in, click **Sign in to Lucid**,
   approve access in the tab that opens, and come back. The pane notices on its
   own. Sign-in lasts across restarts (the backend refreshes the token).
2. Lucid's document picker appears. Pick a document or create one, choose
   **Edit**, and click Lucid's **Insert**. That opens it in the editor. It
   doesn't touch Word yet.
3. Draw. Lucid saves as you go.
4. **Insert new** puts the diagram below the cursor, centred and scaled to fit
   the page width, with a figure caption under it.

### How editing works

There's one copy of each diagram, in your Lucid account. The editor in the
pane and lucid.app are two windows onto that same diagram, and every edit in
either saves to Lucid by itself. The pictures in Word are snapshots: each
records the Lucid version it was made from, and changes only when you update
it.

The bar above the editor names the diagram in it, with **Open in Lucid ↗**
(more room, and Lucid features that don't work inside Word, like Create with
AI), **Switch diagram** (back to Lucid's picker) and **?** (this explanation).

The buttons at the bottom act on whatever is selected in Word, and the line
above them says what that is and whether it's up to date with Lucid:

- **Insert new** puts the editor's diagram below the cursor, centred and
  scaled to fit the page width, with a caption. For a document with several
  pages, the page chooser in the bar picks which one.
- **Update selected** brings the selected picture up to date with the editor's
  diagram. It turns blue when the picture is out of date. It keeps the
  picture's width, so resizing in Word sticks.
- When the selected picture is a *different* diagram, the same button reads
  **Replace selected** and turns that picture into the editor's diagram.
- With nothing selected, it targets the picture you last inserted or loaded,
  so load → edit → update needs no trip back to the document. It never touches
  a picture that isn't one of these diagrams.
- **Load selected** opens the selected picture's diagram in the editor, and
  sets the page chooser to the page the picture shows. Updating a picture keeps
  its page; replacing one with another diagram uses the chooser's page.

Renaming a diagram in Lucid shows up in the bar within about 10 seconds (the
pane asks Lucid; the embed doesn't announce renames). A picture made before the
rename shows as out of date, and **Update selected** brings its name in line,
along with its caption, unless you've reworded the caption by hand: only a
caption whose title still matches the old name changes. Update never adds or
removes captions. A picture inserted before Mermaid support also shows as out
of date, and Update adds the Mermaid.

### Image quality

Lucid only exports PNG (no SVG), so pictures are made sharp by pixel count:
each export is sized for about 400 pixels per inch at the width the picture
has in Word. That's a re-export at a higher DPI when needed, so the first
export of a changed diagram can take a few seconds. Anything far sharper
than 600 ppi is scaled down in the pane with high-quality resampling.
**Update selected** always re-exports for the picture's current width, so
after enlarging a picture in Word, Update makes it sharp again.

**Pages made from Mermaid code in Lucid** ("diagram as code") are the exception: Lucid's export piles their shapes on top of each other, so the add-in draws those pages itself from their Mermaid, at the same ~400 ppi, in Mermaid's own style (which is how Lucid draws them too). The page chooser marks them "(Mermaid code)".

A big diagram squeezed onto the page has physically small text, which no
resolution fixes at 100% zoom; the status line says when a picture is shown
at under 60% of its Lucid size.

If the editor ever doesn't pick up which diagram you opened (Insert stays
grey), open **Diagram not detected?** and paste the diagram's lucid.app URL.

The export is cached per Lucid version and starts when the pointer reaches the buttons, so
inserting an unchanged diagram is quick.

## Alt text

    Lucidchart diagram: Spoof Hound
    https://lucid.app/lucidchart/<document id>/edit
    lucid-embed: <embed id>
    lucid-version: 992
    lucid-page: 0_0
    ```mermaid
    flowchart TD
      subgraph g1["Spoof Hound"]
        direction TB
        n1["Waveform input (.fsdb or .trn)"]
        n2["EDA converters (fsdb2vcd or simvisdbutils)"]
        ...
      end
      n1 --> n2
      ...
    ```

The embed id is what lets **Load selected** jump straight back into the
editor (it's missing if the diagram was inserted from a pasted URL); the
version is how the pane tells a picture is out of date; the page is which page
of the Lucid document the picture shows.

### The Mermaid

`mermaid.js` translates the picture's Lucid page into a Mermaid flowchart:
every shape with text becomes a node (decision, terminator, database and other
shapes map to Mermaid's matching node shapes), every connector an arrow with
its label and direction, and containers (frames, swimlanes) subgraphs.
Free-standing text and connectors with a loose end become `%%` comments.
Lucid's API gives no positions, so it's the structure that's preserved; nodes
are listed in the order the arrows flow, and Mermaid lays them out itself.
Custom shape data isn't included. Sequence and ER diagrams currently come out
as flowcharts too (readable, not idiomatic); they get `sequenceDiagram` /
`erDiagram` forms once there are real examples to build them from.

### Pointing an LLM at the diagrams

Plain text extraction from a `.docx` skips alt text (the captions do come
through), so tell the LLM where to look:

> Diagrams in this document are pictures whose alt text (`wp:docPr/@descr` in
> `word/document.xml`) holds the diagram as Mermaid. Read those.

With `python-docx`: `inline_shape._inline.docPr.get("descr")`. Alt text is
dropped on PDF export, so keep the `.docx`. The alt
text *title* holds a short tag (`Lucidchart diagram #k3x9a1`) so the add-in
can find "the picture you last inserted or loaded". Alt text lands in
`word/document.xml` as `wp:docPr/@descr`; it's dropped on PDF export.

## One-time setup

### 1. Lucid app

At [lucid.app/developer](https://lucid.app/developer), create an app with an
OAuth 2.0 **confidential** client:

- Redirect URI: `https://localhost:3000/callback`
- Embed domain: `tigerbitten.github.io`
- Scopes: `offline_access`, `lucidchart.document.app.picker.share.embed`,
  `lucidchart.document.content:readonly`

Editable embeds also have to be allowed in your Lucid account's admin settings.

### 2. Local backend

Lucid requires an https redirect URI, so the backend serves https on localhost
with a locally trusted certificate from [mkcert](https://github.com/FiloSottile/mkcert):

```
scoop bucket add extras
scoop install mkcert
mkcert -install        # adds a local root CA to Windows' trust store
mkcert localhost       # run in this folder: localhost.pem + localhost-key.pem
```

Copy `.env.example` to `.env` and fill in the client ID and secret, without
quotes. Then:

```
node server.js
```

It must be running whenever you use the add-in. It listens on 127.0.0.1 only.
`.env`, the certificates and `.lucid-token.json` (your saved sign-in) are
gitignored. Delete `.lucid-token.json` to sign out.

To undo mkcert later: `mkcert -uninstall`, delete the folder `mkcert -CAROOT`
prints, then `scoop uninstall mkcert`.

### 3. Sideload the manifest

Download `manifest.xml` with GitHub's **Download raw file** button (not Save
Page As).

- **Word on the web:** Insert → Add-ins → **Upload My Add-in** → choose
  `manifest.xml`. If the browser asks whether the page may reach devices on
  your local network, allow it. That's how the pane talks to the backend.
- **Windows desktop:** same shared-folder catalog steps as the sibling add-ins:
  put the manifest in a shared folder, add its `\\<pc>\<share>` path under
  File → Options → Trust Center → Trust Center Settings → Trusted Add-in
  Catalogs (tick Show in Menu), restart Word, then Home → Add-ins → Advanced →
  Shared Folder.

## Troubleshooting

| The pane says | Do this |
|---|---|
| Can't reach the add-in's backend | Start `node server.js`. If it's running, allow local network access for tigerbitten.github.io in the browser's site settings. |
| Lucid refused the request (403) | Either your account can't open that diagram, or a scope is missing on the OAuth client (add it, then sign in again). |
| The editor says "only signed in users… can access" | Log in to lucid.app in a browser tab (the embed uses that session), then **Switch diagram**. |
| A Lucid button in the editor does nothing (e.g. Create with AI) | Use **Open in Lucid ↗**; the full editor has everything. Same diagram, so **Update selected** picks the result up. |
| Update put in an older version | Lucid saves edits a second or two after you make them. Wait a moment and update again; the status line shows when a picture is out of date. |
| Word didn't respond | Retry. If it repeats, reload the add-in. In Word on the web, this one is still being chased. |
| The build marker isn't the latest | Word cached the old pane. Re-download and re-upload the manifest, or use a private window. |

The browser console (F12) logs every status message, Lucid event and export.
The backend console logs every Lucid API call.

## Files

| File | What's in it |
|---|---|
| `taskpane.html` | The whole pane: UI, Lucid embed, every Office.js call |
| `server.js` | Local backend: OAuth, token refresh, embed tokens, PNG export, Lucid contents |
| `mermaid.js` | Lucid page contents → Mermaid flowchart (used by `server.js`) |
| `manifest.xml` | Points Word at the pane on GitHub Pages |
| `icon.svg` | The icon; `icon-32.png` / `icon-64.png` are it at manifest sizes |

No build step: the pane is served straight from GitHub Pages off the repo
root. On every push that changes the pane, bump the version markers (see
`CLAUDE.md`).
