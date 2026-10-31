# Lucidchart Diagrams

Word add-in: draw diagrams in Lucidchart's own editor inside the taskpane,
insert them as pictures, and update them later. Each picture's alt-text links
back to its Lucid diagram and holds the diagram as Mermaid, so an LLM reading
the document understands it. No server: static files, and the taskpane talks
to Lucid's API directly.

Also works in PowerPoint (same manifest), where the source is stored in a shape tag (and in the alt-text where PowerPoint allows it).

## One-time Lucid setup (centralized, done once)

The add-in signs in to Lucid as an OAuth app registered in Lucid's developer
portal. Someone with a Lucid Team or Enterprise plan and the developer role
does this once, ideally under the company's Lucid admin rather than a
personal account.

1. At [lucid.app/developer](https://lucid.app/developer), create an app with an
   OAuth 2.0 **Public** client ("Uses Authorization Code with PKCE"; the type
   can't be changed later). There is no client secret.
2. Add the redirect URI `https://<host>/<path>/signin.html` and the embed
   domain `<host>`, where `<host>/<path>` is where the add-in is served.
3. Put the client ID in `CLIENT_ID` in both `taskpane.js` and `signin.js`.
4. In Lucid's admin settings, allow editable embeds.

Host the add-in on a hostname of its own, with nothing else served there:
the sign-in is kept in browser storage, which every page on the same hostname
can read, whatever its path. The code works out its own address, so moving
it only means updating the two portal entries above and the URLs in
`manifest.xml`.

## Desktop Word setup (per-person, not centralized)

This is a one-time setup per machine; each person
who wants to use this add-in on desktop Word repeats it themselves.

### Windows

1. Make a local folder, e.g. `C:\AddinCatalog`.
2. Download `manifest.xml` from this repo into that folder. MAKE SURE TO USE THE GITHUB 'Download Raw File' BUTTON. The manifest file should be ~1KB. If it still downloads as HTML (much bigger, starts with `<!DOCTYPE html>`), open the raw file in your browser and copy-paste its text into an empty `manifest.xml` instead.
3. In Word: **File → Options → Trust Center → Trust Center Settings →
   Trusted Add-in Catalogs**. As the Catalog Url, use
   `\\localhost\c$\AddinCatalog` (swap in your actual folder path), check
   **Show in Menu**, OK, OK, then fully restart Word.
4. Inside a Document, **Home → Add-ins → Advanced Settings → Shared Folder** — select the
   add-in there.

### Mac

1. Download `manifest.xml` from this repo. MAKE SURE TO USE THE GITHUB 'Download Raw File' BUTTON. The manifest file should be ~1KB. If it still downloads as HTML (much bigger, starts with `<!DOCTYPE html>`), open the raw file in your browser and copy-paste its text into an empty `manifest.xml` instead.
2. Run `mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef`
3. Move `manifest.xml` into that `wef` folder.
4. Quit Word completely, then reopen it.
5. Inside a Document, **Home → Add-ins → Developer Add-ins** — select the add-in there. It may have a GitHub logo.

### Word or PowerPoint on the web

**Home → Add-ins → More Add-ins → My Add-ins → Manage My Add-ins → Upload My
Add-in**, then choose `manifest.xml`. Word on the web forgets an uploaded
add-in once its pane is closed; upload it again.

## How it works

### The core loop

1. **Sign in to Lucid** — a window opens on Lucid's login, which hands
   company accounts to the company SSO. It closes by itself. The sign-in
   lasts 8 hours, across restarts.
2. The first time, Lucid's document picker shows in the taskpane. Pick or
   create a diagram, click **Continue**, keep **Edit** and click Lucid's
   **Insert**: that opens it in the editor (it doesn't touch Word yet). After
   that the pane opens straight on the last diagram you used.
3. Draw. Lucid saves as you go; the editor and lucid.app are two windows onto
   the same diagram.
4. **Insert** — puts the diagram below the cursor as a picture, sized to fit
   the page (or the table cell), with a "Figure N: title" caption under it
   unless **Caption** is unticked.
5. Edit the diagram, then **Update** — brings the selected picture up to date,
   keeping its width, page and caption. With nothing selected it updates the
   picture you last inserted or opened. When the selected picture is a
   different diagram, the button reads **Replace** and swaps it for the
   editor's.
6. Click a picture, then **Edit selected** — reopens its diagram in the editor.

Pictures are snapshots: each records the Lucid version it was made from, and
the line above the buttons says when Lucid has a newer one (or a new name).

### The bar

- **The diagram menu** — the diagram in the editor. Opens the diagrams already
  in this document, your recent ones, or **Browse or create in Lucid...**
  (Lucid's picker). **Sign out of Lucid** is at the bottom.
- **↗** — opens the diagram on lucid.app, for more room and the Lucid features
  that don't work in the embedded editor (like Create with AI). Update picks
  the changes up.
- **↻** — reloads the editor, to show changes made on lucid.app.
- **MD** — the whole document as Markdown, each diagram as its Mermaid, to copy
  into an LLM or download as a `.md` file.
- **?** — help.
- **Page to insert** — for a diagram with several pages: which page Insert
  uses. Lucid's editor doesn't say which page you're looking at.

### Update all

Shows when diagram pictures in the document are out of date. It lists them
with their versions and, once you confirm, brings each up to date with *its
own* diagram. It only covers diagrams you've opened in the add-in on this
computer: a picture in a document someone sent you is left alone until you
open it with **Edit selected**.

### Pictures

Lucid only exports PNG, so pictures are sized for about 400 pixels per inch at
their width in Word; Update re-exports for the current width, so enlarging a
picture and clicking Update makes it sharp again. Desktop Word may downsample
pictures on save unless **File → Options → Advanced → Do not compress images
in file** is ticked. Flowcharts drawn from Mermaid code in Lucid can't be
exported by Lucid, so the add-in draws those itself from their Mermaid.

In PowerPoint, Insert puts the diagram on the slide in view: in its empty
content box, else below the title, else in the middle. There are no captions.
Update keeps the picture where you moved it and puts its proportions back if
it was stretched. Filling a shape with the picture needs PowerPointApi 1.8
(PowerPoint on the web, or a recent Microsoft 365 desktop).

### When something's off

- **Lucid's editor asks you to log in** — use the pane's **Sign in to Lucid**,
  not Lucid's own button: in desktop Word that opens your web browser, which
  never reaches Word.
- **A diagram made on lucid.app won't open in the editor** — pick it once with
  **Browse or create in Lucid...**; Lucid only lets the add-in open diagrams
  picked there.
- **Text boxes beside arrows** — Lucid doesn't say where shapes sit, so the
  Mermaid can't tell which arrow a loose text box labels; Insert and Update
  say so. Type the label on the arrow in Lucid instead, then Update.
- **The build marker at the top isn't the latest** — Word cached the old
  taskpane. Upload the manifest again, or use a private window.

## Files

- `taskpane.html` — the taskpane page: layout, styles, help text and the
  Content-Security-Policy. Also opens in a plain browser, which is enough to
  try the Lucid side without Word (Insert and Update stay disabled).
- `taskpane.js` — all the taskpane's logic: Lucid sign-in and API calls, the
  embedded editor, PNG export, every Office.js call. It's a separate file only
  because the CSP forbids inline script.
- `listen.js` — takes Lucid's editor messages before Office.js sees them, so
  it's loaded first.
- `signin.html`, `signin.js` — the sign-in window's first and last page (the
  OAuth redirect URI): builds Lucid's sign-in URL and hands Lucid's answer
  back to the taskpane.
- `mermaid.js`, `uml.js`, `svg.js` — turn a Lucid page into Mermaid:
  flowcharts; sequence, ER, class, state, mind map and timeline pages; and
  Mermaid code Lucid keeps as a picture.
- `manifest.xml` — points Word and PowerPoint at the hosted taskpane, sideload
  this file.
- `assets/` — the manifest's icons.
- `vendor/mermaid.min.js` — Mermaid 11.17.2 (MIT, `vendor/mermaid.LICENSE`),
  vendored into the repo instead of pulled from jsDelivr. Used only for pages
  drawn from Mermaid code.
- `vendor/office/` — Microsoft's Office.js, vendored so the taskpane only
  talks to its own host and Lucid. Fetched from Microsoft's CDN by
  `vendor/fetch-office-js.sh`. Re-run it every few months and commit the
  result: Microsoft ships host fixes on the CDN that a frozen copy misses. Self-hosting is fine for an internally deployed add-in;
  only Microsoft Marketplace (AppSource) listings must use the CDN.

The test tooling and design notes aren't deployed and live at the git tag
`dev-tools`.

## Security notes

- **The sign-in can read every diagram the user can open.** The Lucid scopes
  are `offline_access`, `lucidchart.document.app.picker.share.embed` and
  `lucidchart.document.content:readonly` (read and export, never change or
  delete). Its tokens are kept in the taskpane's browser storage on the user's
  PC, which is why the add-in needs a hostname of its own (above).
- **A sign-in ends after 8 hours.** The taskpane then revokes it at Lucid and
  asks again; **Sign out of Lucid** revokes it at once. The limit is enforced
  by the taskpane: Lucid itself honours a refresh token for 180 days unless it's
  revoked, so a token copied off a PC works until the taskpane next opens
  there, or until it's revoked in Lucid's account settings.
- **Only this host's code runs.** The CSP allows script only from the host
  (no inline or eval'd script), connections only to `api.lucid.co`, and frames
  only from `lucid.app`. Office.js tries to frame a Microsoft telemetry page;
  the CSP blocks that on purpose. Don't loosen the CSP to fix something
  without checking what it re-enables. If the host can send headers, also send
  the CSP as a header, with `frame-ancestors`, and `X-Content-Type-Options:
  nosniff`.
- **The sign-in page only starts this add-in's sign-in.** It builds Lucid's
  sign-in URL itself, so its address can't be used to start another app's
  sign-in, and it wipes Lucid's one-time code from the address bar.
- **Alt-text from other documents is untrusted.** The taskpane only looks up,
  and Update all only updates, diagrams opened in the add-in on this computer,
  and Update all asks first, so a document can't pull your diagrams into itself
  by naming them. Lucid ids must be UUIDs before they reach an API call, and
  Lucid's messages only count from the taskpane's own editor frame.
- **No diagram text becomes HTML in the taskpane.** It's shown as text only;
  Mermaid draws with `securityLevel: "strict"` into a picture, and a
  `%%{...}%%` directive in a diagram's text is defused.
- **The alt-text is hidden data.** It holds all the text on the diagram's page.
  Cropping or covering a picture leaves it all in the alt-text (and in
  `<img alt>` on HTML export).
- **The SSO password is typed into Office's sign-in window, which shows no
  address bar.** Phishing-resistant MFA (FIDO2 / passkeys) on the SSO covers
  that. Lucid's own login in Office's browser ("Remember me" is ticked by
  default) outlasts signing out of the add-in.
- **The console never logs a diagram's content or a token.**

## LLM-readability

A diagram inserted by this add-in is a PNG, so an LLM reading the document
would have to interpret pixels. The diagram's structure is in the picture's
alt-text as Mermaid instead:

    Lucidchart diagram: Login flow
    https://lucid.app/lucidchart/<document id>/edit
    lucid-embed: <embed id>
    lucid-version: 992
    lucid-page: 0_0
    ```mermaid
    flowchart TD
      n1["Sign in"] --> n2{"Valid?"}
      ...
    ```

Lucid's API gives no positions, so the Mermaid keeps the structure (shapes,
labelled arrows, containers, swimlanes, UML and ER notation) and Mermaid lays
it out itself.

- **MD** in the taskpane — the simplest route: the whole document as
  Markdown, each diagram as its title, link and Mermaid.
- **.docx** — the alt-text is the `descr` attribute of `wp:docPr` in
  `document.xml`. Naive text extraction skips it; parse the .docx directly
  (e.g. `python-docx`: `inline_shape._inline.docPr.get("descr")`).
- **.pptx** — the alt-text is `p:cNvPr/@descr`.
- **HTML** — Word's HTML export keeps alt-text verbatim as `<img alt="...">`.
- **PDF** — alt-text is dropped on export.

Tell the LLM where to look: *"diagrams in this document are pictures; each
one's structure is in its alt-text as Mermaid"*. Only give a document to an
LLM approved for what's in it. Text in a diagram reaches the LLM as written,
so anyone who can edit a diagram can also put instructions to the LLM in it.
