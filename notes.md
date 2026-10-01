# Lucid API notes (for future features)

Docs: developer.lucid.co (mirror: lucid.readme.io). All REST calls: `https://api.lucid.co`, header `Lucid-Api-Version: 1`, `Authorization: Bearer <token>`.

## Embeds (what we use)
- Token: `POST /embeds/token` `{origin, embedId?, sessionConfig?}` → JWT. Scope `lucidchart.document.app.picker.share.embed`.
  - `sessionConfig`: `products[]`, `viewerType.default` (`rich`|`simple`, view-only), `ui` (`viewer`|`settings` = open on embed settings), `customSettings` (`postMessage`|`none`).
  - No page / start-page option. `&page=` on the iframe URL is ignored (tested): editor always opens on page 1.
- Iframe: `https://lucid.app/embeds?token=…`. No embedId → picker; with embedId → viewer / editor / settings per embed's settings.
- Access level (edit / comment / view), viewer type, snapshot mode (view-only) are chosen by the user in Lucid's embed UI, not via API.
- Iframe → parent `postMessage` (`type: "LucidEmbedEvent"`):
  - `EmbedCreated` {documentId, embedId, signature}
  - `SettingsClosed` {settingsUpdated}
  - `OpenCustomSettings` (only with `customSettings: "postMessage"`)
  - Nothing documented for page switches or edits. Parent → iframe: nothing documented.
- `GET /documents/{docId}/embeds/{embedId}/document` → {embedId, documentId, pageCount, title}. Scope `…share.embed:readonly`.
- Editable embed also needs the user logged in to lucid.app in the same browser (cookie); otherwise "only signed in users…".
- Cookie-based alternative: `https://lucid.app/embeds/link?clientId=…&document=<url>`. View-only, no picker, needs 3rd-party cookies.

## Document picker (standalone, not used yet)
- `https://lucid.app/documents/picker?token=…` + `allowDocumentCreation`, `autoSelectCreatedDocument`, `newDocumenbtTitleSuggestion` (sic), `hideCancelButton`, `onErrorRedirectUrl`. Token comes from a separate "document picker token" endpoint. Scopes `lucid.document.app.picker[:readonly]`.

## Documents
- `GET /documents/{id}` (JSON) → title, `version` (bumps on every saved edit; viewing doesn't), pageCount, editUrl, viewUrl, canEdit, lastModified, owner…
- Export: same path, `Accept: image/png;dpi=N` (or jpeg). Params `crop=content`, `page=<1-based>` or `pageId=<id>`. Caps around 10 MP; 600 dpi ≈ 5 s. No SVG (406). PDF 403 on our plan.
- Contents: `GET /documents/{id}/contents` (~1–4 s, 100 req/5 s). Pages → shapes (class, textAreas, `contains`, image, linkUrl), lines (endpoint1/2 style + connectedTo), groups (members), layers, customData, linkedData. **No geometry or styles.** Output may vary over time.
- Search: `POST /documents/search` {keywords, product[], lastModifiedAfter, documentIds…}. Paginated, 300 req/5 s. Scope `…document.content:readonly`. Could replace the picker / give a recent-diagrams list.
- Create: `POST /documents` with a Standard Import `.lucid` zip (`document.json`: pages, shapes, lines, groups, layers, containers, **bounding boxes and styles**). 50 MB zip / 2 MB JSON. Only way to write diagrams via REST: a Mermaid → Lucid round trip would mean translating Mermaid to Standard Import ourselves. No REST update of an existing doc's content.

## Other routes
- **Extension API**: plug-ins that run inside Lucid's editor, with read/write access to the document, geometry and styles. The way to get positions/styles, or an in-editor "send to Word" button.
- **Lucid MCP server**: Lucid support's suggested route for creating diagrams from code (Mermaid).
- AI ("Create with AI") does nothing inside the embed; works on lucid.app.

## Gotchas we hit
- lucid.app editor/login send `X-Frame-Options: SAMEORIGIN`; only `/embeds` frames.
- OAuth redirect URI must be https (hence mkcert).
- Export PNGs are palette + extra chunks; Word on the web rejects them → re-encode via canvas.
- Pages built from Mermaid in Lucid (`LucidNativeMermaid*` classes) export with all shapes piled up; their subgraph shapes list only connectors. We draw those pages ourselves.
- Word on the web refuses `styleBuiltIn = Caption`.
