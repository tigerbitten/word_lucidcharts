# Lucidchart Diagrams for Word

A Word add-in with Lucidchart's editor inside the task pane. Sign in to your
Lucid account, draw, and insert the diagram into the document as a picture.
Each picture's alt text links back to its Lucid diagram, so it can be reopened
and updated later.

Prototype, stage 1 of 2. Stage 2 will translate each diagram into Mermaid and
store that in the alt text too, so an LLM reading the `.docx` understands the
diagram instead of guessing from pixels.

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
4. **Insert into document** puts the diagram below the cursor, centred and
   scaled to fit the page width.
5. Later: click the picture in Word, **Open selected** to reopen it in the
   editor, edit, then **Update in document**. Update replaces every picture of
   that diagram in the document.

**New / other diagram** goes back to the picker. If the editor ever doesn't
pick up which diagram you opened (the Insert buttons stay grey), open
**Diagram not detected?** and paste the diagram's lucid.app URL.

Only the first page of a multi-page Lucid document is exported.

## Alt text

```
Lucidchart diagram: <title>
https://lucid.app/lucidchart/<document id>/edit
lucid-embed: <embed id>
```

The embed id is what lets **Open selected** jump straight back into the
editor. It's missing if the diagram was inserted from a pasted URL. Alt text
lands in `word/document.xml` as `wp:docPr/@descr`; it's dropped on PDF export.

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
| Lucid refused the request (403) | A scope is missing on the OAuth client. Add it, then sign in again. |
| Word didn't respond | Retry. If it repeats, reload the add-in. In Word on the web, this one is still being chased. |
| The build marker isn't the latest | Word cached the old pane. Re-download and re-upload the manifest, or use a private window. |

The browser console (F12) logs every status message, Lucid event and export.
The backend console logs every Lucid API call.

## Files

| File | What's in it |
|---|---|
| `taskpane.html` | The whole pane: UI, Lucid embed, every Office.js call |
| `server.js` | Local backend: OAuth, token refresh, embed tokens, PNG export |
| `manifest.xml` | Points Word at the pane on GitHub Pages |
| `icon.svg` | The icon; `icon-32.png` / `icon-64.png` are it at manifest sizes |

No build step: the pane is served straight from GitHub Pages off the repo
root. On every push that changes the pane, bump the version markers (see
`CLAUDE.md`).
