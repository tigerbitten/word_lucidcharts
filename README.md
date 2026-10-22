# Lucidchart Diagrams for Word

A Word add-in (it also works in PowerPoint: see below) with Lucidchart's editor inside the task pane. Sign in to your
Lucid account, draw, and insert the diagram into the document as a picture.
Each picture's alt text links back to its Lucid diagram, so it can be reopened
and updated later, and carries the diagram as Mermaid, so an LLM reading the
`.docx` understands the diagram instead of guessing from pixels. A Word figure
caption ("Figure 3: Login flow") goes under each picture, unless **Caption**
(next to Insert) is unticked.

Prototype.

No backend: the pane signs in to Lucid itself, as a public OAuth client with
PKCE (no client secret), and calls Lucid's API straight from Word. It's all
static files on GitHub Pages. (Up to build v46 a local `server.js` held a
client secret; it's at the git tag `server-backend`.)

## Using it

1. Open the add-in. If you're not signed in, click **Sign in to Lucid** and
   sign in (and approve access) in the window that opens; it closes by itself
   and the pane carries on. Sign-in lasts across restarts (the pane refreshes
   the token).
2. The first time, Lucid's document picker appears. Pick a document or create
   one, click **Continue**, keep **Edit** and click Lucid's **Insert**. That
   opens it in the editor (it doesn't touch Word yet). After that the pane
   opens straight on the last diagram you used.
3. Draw. Lucid saves as you go.
4. **Insert** puts the diagram below the cursor, centred and scaled to fit the
   page, with a figure caption under it (untick **Caption** for none), and
   leaves the cursor below the figure.

### In PowerPoint

The same manifest loads in PowerPoint, and the pane works the same way, with these differences:
- **Insert** puts the diagram on the slide in view where PowerPoint's own Insert
  Picture would: into the slide's empty content box (replacing it), else below the
  title, else in the middle, sized to fit. No caption.
- **Update** keeps the picture where you moved it and at the width you gave it,
  and puts its proportions back if it was stretched.
- **Update all** covers every slide.
- **MD** writes the presentation slide by slide: the text boxes' text and each diagram's Mermaid.

The diagram's source (the alt text below) is kept in a shape tag named `LUCID`,
which every PowerPoint has. It's also written to the picture's alt text where
PowerPoint allows that (PowerPointApi 1.10; PowerPoint on the web does), so an
LLM reading the `.pptx` finds the Mermaid in `p:cNvPr/@descr`. The tag for
finding a picture again is in the shape's name, shown in the Selection Pane.

The picture is a borderless rectangle filled with the diagram, not a plain
picture. PowerPoint's add-in API has no call that inserts a picture. The
common call the Waveform Viewer add-in uses (`setSelectedDataAsync`) refuses
whenever anything on the slide is selected, and on the web the add-in can't
clear the selection. Filling a shape needs PowerPointApi 1.8: PowerPoint on the
web, or a recent Microsoft 365 desktop. Older desktop versions say so when you
click Insert. Unlike a picture, the shape doesn't keep its proportions when a
side handle is dragged: drag a corner with Shift held, or click Update to put
them back.

### How editing works

There's one copy of each diagram, in your Lucid account. The editor in the
pane and lucid.app are two windows onto that same diagram, and every edit in
either saves to Lucid by itself. The pictures in Word are snapshots: each
records the Lucid version it was made from, and changes only when you update
it.

The bar above the editor has:

- **The diagram menu**, showing the diagram in the editor. It opens others:
  the diagrams already in this document (choosing one also selects its
  picture), the ones you used recently, or **Browse or create in Lucid...**
  (Lucid's picker). Diagrams from the document and recent ones open straight
  in the editor; one whose picture is out of date says so.
- **↗** opens the diagram on lucid.app (more room, and Lucid features that don't
  work inside Word, like Create with AI); **↻** reloads the editor so it shows
  changes made elsewhere (the pane also says when the diagram changed there);
  **?** explains all this.
- **MD** shows the whole document as Markdown with each diagram's Mermaid in
  place, to select and copy into an LLM, or download as a `.md` file.
- **Page to insert**, for a document with several pages: which page Insert uses.

The buttons at the bottom act on whatever is selected in Word, and the line
above them says what that is and whether it's up to date with Lucid:

- **Insert** puts the editor's diagram below the cursor (below the caption, if
  the cursor is on a figure; inside a table cell, sized to fit the cell).
- **Update** brings the selected picture up to date with the editor's diagram.
  It turns blue when the picture is out of date. It keeps the picture's width,
  so resizing in Word sticks.
- When the selected picture is a *different* diagram, the same button reads
  **Replace** and turns that picture into the editor's diagram.
- With nothing selected, it targets the picture you last inserted or opened,
  so open → edit → update needs no trip back to the document. It never touches
  a picture that isn't one of these diagrams.
- **Update all** appears when diagram pictures in the document are out of
  date: it brings each one up to date with *its own* diagram, keeping its width,
  page and caption.
- **Edit selected** opens the selected picture's diagram in the editor, and
  sets the page chooser to the page the picture shows. Updating a picture keeps
  its page; replacing one with another diagram uses the chooser's page.

Renaming a diagram in Lucid shows up in the bar within about 10 seconds (the
pane asks Lucid; the embed doesn't announce renames). A picture made before the
rename shows as out of date, and **Update** brings its name in line, along with
its caption, unless you've reworded the caption by hand: only a caption whose
title still matches the old name changes. Update never adds or removes
captions. A picture inserted before Mermaid support also shows as out of date,
and Update adds the Mermaid.

A caption names the diagram, and for a document with several pages also the
page when it has a real title ("Figure 2: Order system – Checkout"; Lucid's
"Page 2" doesn't count). Captions are real Word captions (Caption style, numbered by a field that Word
renumbers and lists in a Table of Figures) where Word allows. Word on the web
has neither, so there they look the same but are typed: small italic text,
numbered in document order, and renumbered whenever a figure is inserted
above others.

### Image quality

Lucid only exports PNG (no SVG), so pictures are made sharp by pixel count:
each export is sized for about 400 pixels per inch at the width the picture
has in Word. The DPI comes from the diagram's last known size, so one export
is usually enough (a diagram's very first one exports twice, to learn the size,
which the pane keeps in the browser's storage across restarts); a big
changed diagram still takes several seconds, which is Lucid's rendering. Anything far sharper
than 600 ppi is scaled down in the pane with high-quality resampling.
**Update** always re-exports for the picture's current width, so after
enlarging a picture in Word, Update makes it sharp again. New pictures fit
the page both ways: at most 6.5in wide and 8.5in tall.

Desktop Word can throw those pixels away when it saves: unless File > Options >
Advanced > Image Size and Quality has **Do not compress images in file** ticked
or **Default resolution** set to High fidelity, it downsamples every picture to
that default (often 220 ppi). That's Word's setting, per document; the add-in
can't change it.

**Flowcharts made from Mermaid code in Lucid** ("diagram as code") are the exception: Lucid's export piles their shapes on top of each other, so the add-in draws those pages itself from their Mermaid, at the same ~400 ppi, in Mermaid's own style (which is how Lucid draws them too). The page chooser marks them "(Mermaid code)". Other Mermaid code (sequence, class, state...) is a single picture in Lucid and exports normally.

A big diagram squeezed onto the page has physically small text, which no
resolution fixes at 100% zoom; the status line says when a picture is shown
at under 60% of its Lucid size.

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

The embed id is what lets **Edit selected** jump straight back into the
editor (if it's missing, as in pictures linked by pasted URL in older builds, the pane makes one when Lucid allows); the
version is how the pane tells a picture is out of date; the page is which page
of the Lucid document the picture shows.

### The Mermaid

`mermaid.js` translates the picture's Lucid page into Mermaid. Most pages
become a flowchart: every shape with text becomes a node (decision,
terminator, database, BPMN and other shapes map to Mermaid's matching node
shapes), every connector an arrow with its label and direction (BPMN message
flows dashed), and containers (frames, swimlanes, pools, cloud groups)
subgraphs. A cloud or network icon is named after its Lucid class when it has
no text, and keeps that service name next to its own when its title doesn't
say it ("S3 Static Website (Amazon Simple Storage Service Bucket With
Objects)"). Free-standing text and connectors with a loose end become `%%`
comments. Lucid's API gives no positions, so it's the structure that's
preserved; nodes are listed in the order the arrows flow, and Mermaid lays them
out itself. A swimlane's or BPMN pool's lanes are subgraphs too, each step in
its own lane (Lucid records the lane with the step).

Pages drawn with Lucid's own libraries for other kinds of diagram get
Mermaid's matching form (`uml.js`):

| Lucid page | Mermaid |
|---|---|
| UML sequence (lifelines, activations, alt/opt/loop) | `sequenceDiagram`, with replies and async messages; which lifeline an activation bar is on is inferred |
| Entity relationship (ERD entities, crow's foot) | `erDiagram` with keys, types and cardinality |
| UML class | `classDiagram` with members, inheritance, composition, multiplicities |
| UML state machine | `stateDiagram-v2` with guards, composite states |
| Mind map | `mindmap` |
| Timeline (roadmap) | `timeline`, milestones under their period by date |
| UML component (provided / required interfaces) | a flowchart of the components with a dashed "uses" arrow per interface connection |

Mermaid code pasted or imported into Lucid that isn't a flowchart is kept by
Lucid as a picture of Mermaid's drawing, without the code; `svg.js` reads it
back (sequence, class and state diagrams fully, anything else as its text).
Custom shape data isn't included.

### Pointing an LLM at the diagrams

The simplest way: **MD** in the pane. Without Word: `python docx2md.py report.docx > report.md` (standard library
only) writes the document as Markdown, with each diagram picture replaced by its
title, its Lucid link and its Mermaid. Hand the LLM the `.md`.

Otherwise, plain text extraction from a `.docx` skips alt text (the captions do come
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

At [lucid.app/developer](https://lucid.app/developer) (Team or Enterprise plan,
with the developer role), create an app with an OAuth 2.0 **public** client
("For applications that cannot securely store a client secret. Uses
Authorization Code with PKCE (S256)"; the type can't be changed later):

- Redirect URI: `https://tigerbitten.github.io/word_lucidcharts/signin.html`
- Embed domain: `tigerbitten.github.io`

Put its client ID in `CLIENT_ID` in `taskpane.html` (it isn't a secret). The
scopes are asked for at sign-in: `offline_access`,
`lucidchart.document.app.picker.share.embed`, `lucidchart.document.content:readonly`.
Editable embeds also have to be allowed in your Lucid account's admin settings.

### 2. Sideload the manifest

Download `manifest.xml` with GitHub's **Download raw file** button (not Save
Page As).

- **Word or PowerPoint on the web:** Home → Add-ins → More Add-ins → My Add-ins →
  Manage My Add-ins → **Upload My Add-in** → choose `manifest.xml`.
- **Windows desktop:** same shared-folder catalog steps as the sibling add-ins:
  put the manifest in a shared folder, add its `\\<pc>\<share>` path under
  File → Options → Trust Center → Trust Center Settings → Trusted Add-in
  Catalogs (tick Show in Menu), restart Word, then Home → Add-ins → Advanced →
  Shared Folder.

### Sign-in

**Sign in to Lucid** opens `signin.html` in a window of its own (Office's
dialog; Lucid's login refuses to load inside the pane). It goes on to Lucid's
login (which hands company accounts to their SSO), comes back to
`signin.html` with a one-time code, and passes that to the pane, which trades
it for tokens using the PKCE proof it made for this sign-in. No secret is
involved anywhere.

The tokens (an hour-long access token and a refresh token) are kept in the
browser's storage for the pane, on the user's machine; GitHub never sees them.
Anything else served from `tigerbitten.github.io` (other GitHub Pages sites of
that account) runs on the same site and could read them, so for real use the
pane should have an address of its own. Lucid accepts an old refresh token
for a while after it's been swapped. To sign out, clear the site data for
`tigerbitten.github.io` (or revoke the app in Lucid's account settings).

## Troubleshooting

| The pane says | Do this |
|---|---|
| Lucid refused the request (403) | Either your account can't open that diagram, or a scope is missing on the OAuth client (add it, then sign in again). |
| The browser blocked the sign-in window | Allow pop-ups for the page (Word on the web asks first: allow it), then click Sign in again. |
| Lucid's editor needs you logged in to Lucid here in Word | Click **Sign in to Lucid**. Lucid's editor needs a lucid.app login in Word's own browser; Lucid's "Log in to edit" button opens your web browser instead (desktop Word), which never reaches Word. The pane's sign-in window does. |
| Lucid still opens this diagram read-only after signing in | The diagram's embed is view-only, or the browser blocks Lucid's cookies inside Word (third-party cookies). Edit with **↗** (Open in Lucid), then **Update**. |
| "For LLMs, type arrow labels on the arrow..." | Some text boxes on the page aren't attached to anything. Lucid doesn't say where shapes sit, so the Mermaid can't tell which arrow a text box beside it labels. Double-click the arrow in Lucid and type the label there (delete the loose text box), drag loose arrow ends onto their boxes, then **Update**. |
| A Lucid button in the editor does nothing (e.g. Create with AI) | Use **↗** (Open in Lucid); the full editor has everything. Same diagram, so **Update** picks the result up. |
| A diagram made on lucid.app (e.g. with Create with AI) won't open in the editor here | Pick it once with the menu's **Browse or create in Lucid...**: Lucid only lets the add-in open diagrams that have been picked there. After that it opens straight from the menu. |
| Update put in an older version | Lucid saves edits a second or two after you make them. Wait a moment and update again; the status line shows when a picture is out of date. |
| Word didn't respond | Retry. If it repeats, reload the add-in. In Word on the web, this one is still being chased. |
| The build marker isn't the latest | Word cached the old pane. Re-download and re-upload the manifest, or use a private window. |

The browser console (F12) logs every status message, Lucid event, Lucid API
call, export and Mermaid translation.

## Files

| File | What's in it |
|---|---|
| `taskpane.html` | The whole pane: UI, Lucid sign-in and API calls (tokens, embeds, PNG export, contents), the embed, every Office.js call |
| `signin.html` | The sign-in window's start and end (the OAuth redirect URI): hands Lucid's answer back to the pane |
| `mermaid.js` | Lucid page contents → Mermaid: flowcharts, and the dispatch to the next two (ES modules, imported by the pane) |
| `uml.js` | Sequence, ER, class, state and mind-map pages → their own Mermaid forms |
| `svg.js` | Mermaid code Lucid keeps as a picture → Mermaid again |
| `docx2md.py` | A `.docx` as Markdown with the diagrams' Mermaid in place, for LLMs |
| `dev/` | Testing without a person: drive Word on the web in a test Chrome, translator fixtures from real Lucid diagrams checked against Mermaid's parser (see `CLAUDE.md`) |
| `notes.md` | What Lucid's embed and REST APIs can and can't do, for planning features |
| `manifest.xml` | Points Word and PowerPoint at the pane on GitHub Pages |
| `icon.svg` | The icon; `icon-32.png` / `icon-64.png` are it at manifest sizes |

No build step: the pane is served straight from GitHub Pages off the repo
root. On every push that changes the pane, bump the version markers (see
`CLAUDE.md`).
