// Lucid editor extension, test build: does an extension run inside the add-in's
// embedded editor, and can it hand the add-in the positions /contents leaves out?
//
// When the editor loads it (and from its menu item), it writes the current page's
// geometry into the page's shape data under "wordGeometry": every block's box, class,
// text and border, every line's sampled path, ends and connections. The add-in reads
// it back with the call it already makes: GET /documents/{id}/contents returns page
// shape data as the page's customData.
//
// Read the marker's "ranAt" after opening a diagram only in the add-in: if it moved,
// extensions run in the embed. vsdx-labels.js shows what the geometry is for.
//
// Not built yet (npm is blocked on the work network). Tonight: `npx lucid-package create`
// (package "lucid-probe"), put this file at editorextensions/probe/src/extension.ts,
// then `npx lucid-package test-editor-extension probe` and Developer > Enter developer
// mode in a lucid.app editor. Lines marked CHECK use calls the docs didn't spell out:
// confirm them against node_modules/lucid-extension-sdk's .d.ts files.
import { BlockProxy, EditorClient, LineProxy, Menu, MenuType, Viewport } from "lucid-extension-sdk";

const client = new EditorClient();
const viewport = new Viewport(client);
const menu = new Menu(client);

const round = (n: number) => Math.round(n * 10) / 10;

function pageGeometry() {
  const page = viewport.getCurrentPage();
  if (!page) throw new Error("no current page");
  const blocks = [...page.allBlocks.values()].map((b: BlockProxy) => {
    const box = b.getBoundingBox();
    return {
      id: b.id, cls: b.getClassName(), box: [box.x, box.y, box.w, box.h].map(round),
      text: Object.fromEntries(b.textAreas.keys().map((k: string) => [k, b.textAreas.get(k)])),
      border: b.getLineWidth(), // 0 for text boxes
      font: Object.fromEntries(b.textStyles.keys().map((k: string) => [k, b.textStyles.get(k)?.size])),
    };
  });
  const lines = [...page.allLines.values()].map((l: LineProxy) => {
    const e1 = l.getEndpoint1(), e2 = l.getEndpoint2();
    // The path, sampled: bends and curves without depending on how Lucid stores them.
    const path = Array.from({ length: 17 }, (_, i) => l.getRelativePosition(i / 16)).map(p => [round(p.x), round(p.y)]);
    return {
      id: l.id, path,
      from: l.getUpstreamConnection()?.id ?? null, to: l.getDownstreamConnection()?.id ?? null,
      ends: [e1, e2].map(e => ({ x: round(e.x), y: round(e.y), style: (e as any).style ?? null })), // CHECK: arrowhead field name
      text: Object.fromEntries(l.textAreas.keys().map((k: string) => [k, l.textAreas.get(k)])),
    };
  });
  return { page, geometry: { blocks, lines } };
}

function save(trigger: string) {
  const { page, geometry } = pageGeometry();
  const value = JSON.stringify(geometry);
  const old = page.shapeData.get("wordGeometry");
  // Every write is an edit (the document's version moves, which the add-in reads as
  // "picture out of date"), so only write when the geometry changed.
  if (old !== value) page.shapeData.set("wordGeometry", value); // CHECK: ShapeDataProxy.set signature
  page.shapeData.set("wordProbe", JSON.stringify({ ranAt: new Date().toISOString(), trigger, changed: old !== value }));
  console.log("word probe:", trigger, geometry.blocks.length, "blocks", geometry.lines.length, "lines", value.length, "chars", old !== value ? "(written)" : "(unchanged)");
}

client.registerAction("wordSaveGeometry", () => save("menu"));
menu.addMenuItem({ label: "Word: save geometry", action: "wordSaveGeometry", menuType: MenuType.Main }); // CHECK: menu call

// Runs when the editor loads the extension, with no click: the question is whether
// the embedded editor ever gets here.
save("load");
