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
- Create: `POST /documents/{docId}/embeds` `{embedVersion: "latest-version", accessLevel: "edit"}` → `{embedId}` (also takes `pages`, `viewerType`). Without `accessLevel` the embed is a read-only viewer. With our `app.picker` scope it works only for documents picked in the picker at some point (403 otherwise); `…content.share.embed` would allow any document.
- Editable embed also needs the user logged in to lucid.app in the same browser (cookie); otherwise "only signed in users…".
- Cookie-based alternative: `https://lucid.app/embeds/link?clientId=…&document=<url>`. View-only, no picker, needs 3rd-party cookies.

## Document picker (standalone, not used yet)
- `https://lucid.app/documents/picker?token=…` + `allowDocumentCreation`, `autoSelectCreatedDocument`, `newDocumenbtTitleSuggestion` (sic), `hideCancelButton`, `onErrorRedirectUrl`. Token comes from a separate "document picker token" endpoint. Scopes `lucid.document.app.picker[:readonly]`.

## Documents
- `GET /documents/{id}` (JSON) → title, `version` (bumps on every saved edit; viewing doesn't), pageCount, editUrl, viewUrl, canEdit, lastModified, owner…
- Export: same path, `Accept: image/png;dpi=N` (or jpeg). Params `crop=content`, `page=<1-based>` or `pageId=<id>`. Caps around 10 MP; 600 dpi ≈ 5 s. No SVG (406). PDF 403 on our plan.
- Contents: `GET /documents/{id}/contents` (~1–4 s even for small docs, 100 req/5 s). Pages → shapes (class, textAreas, `contains`, image, linkUrl), lines (endpoint1/2 style + connectedTo), groups (members), layers, customData, linkedData. **No geometry or styles** (Lucid confirmed, Feb 2026: no plans). Output may vary over time.
  - A line end can be connected to another *line* (UML sequence messages end on lifelines).
  - Text areas are labelled by role: `Text`, `Title`, `FrameTitle`, `State`/`Action`, `Name` + `Key1`/`Field1`/`Type1`... (ERD), `Title` + `Text1`/`Text2` (class), `uml0`/`uml1` (multiplicities), `Primary_0`... (swimlane / pool lanes), `Placeholder` (the empty-box hint, not content).
  - Shape classes seen: `ProcessBlock`, `DecisionBlock`, `TerminatorBlockV2`, `UMLObjectBlock`/`UMLActorBlock`/`UMLActivationBlock`/`UMLOptionLoopBlock`/`UMLAlternativeBlock2`, `UMLClassBlock`, `UMLStateBlock`/`UMLStartBlock`/`UMLEndBlock`, `ERDEntityBlock4`, `AdvancedSwimLaneBlock`, `BPMNActivity`/`BPMNEvent`/`BPMNGateway`/`BPMNAdvancedPoolBlock`, `TreeNodeBlock` (org chart), `IntelligentMindMap(Root)NodeBlock`, icons `<Name>AWS2024` (`Res`/`Arch` prefix), `<Name>Azure2024`, `GCP2021<Name>Icon`, `NET_<Device>`, `SparkFrameBlock` (frames). Line end styles: `Arrow`, `Open Arrow`, `Generalization`, `Composition`, `CFN ERD … Arrow`, `BPMN Conditional`/`Default`, `Centered Hollow Circle`. Examples: `dev/fixtures/`.
- Search: `POST /documents/search` {keywords, product[], lastModifiedAfter, documentIds…}. Paginated, 300 req/5 s. Scope `…document.content:readonly` (works with ours: lists every document). Opening one in the editor still needs an embed, so documents never picked can't be opened from a list without the wider scope above.
- Create: `POST /documents` with a Standard Import `.lucid` zip (`document.json`: pages, shapes, lines, groups, layers, containers, **bounding boxes and styles**). 50 MB zip / 2 MB JSON. Only way to write diagrams via REST: a Mermaid → Lucid round trip would mean translating Mermaid to Standard Import ourselves. No REST update of an existing doc's content.

## Other routes
- **Extension API**: plug-ins that run inside Lucid's editor, with read/write access to the document, geometry and styles. The way to get positions/styles, or an in-editor "send to Word" button.
- **Lucid MCP server**: Lucid support's suggested route for creating diagrams from code (Mermaid).
- AI ("Create with AI") does nothing inside the embed; works on lucid.app.

## Export quirks
- Export PNGs are palette PNGs with extra chunks, which Word on the web rejects (we re-encode them).
- Flowcharts built from Mermaid in Lucid (`LucidNativeMermaid*`) export with all shapes piled up, with or without crop; their subgraph shapes list only connectors, not shapes.
- Other Mermaid code (sequence, class, state, ...) imported or pasted into Lucid becomes one `LucidNativeMermaidDiagramBlock`: no text areas, its `image.url` a data URL of Mermaid's SVG. It exports fine.
- Framing, OAuth/mkcert and Word gotchas, and how the code handles each: CLAUDE.md.

## Lucid AI and import (for making test diagrams)
- "Generate with AI" on the lucid.app home page or in an editor's AI panel draws real diagrams with Lucid's libraries (sequence, ER, class, state, BPMN, org chart, mind map, cloud and network icons). A few minutes each.
- New > Import documents takes Visio, draw.io, Gliffy, OmniGraffle, BPMN and Mermaid (`.mmd`) files; each opens once to finish. The template gallery shows nothing on this (Personal) account.
