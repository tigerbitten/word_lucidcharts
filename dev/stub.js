// JS for the pane (cdp.js eval) that stands in for Lucid, so the Word and
// PowerPoint sides can be checked without a Lucid sign-in (e2e.js --stub,
// ppt-e2e.js --stub): the export is a drawn 16:9 picture with a one-line
// Mermaid, every export is a new Lucid version (so Update has something to
// bring in), the editor never loads, and the fake diagram stays out of the
// pane's recent list.
module.exports = `(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 900;
  window.stubVersion = 0;
  exportDiagram = async (ids, page, shownPt) => {
    const v = ++stubVersion, g = canvas.getContext("2d");
    g.fillStyle = ["#dbeafe", "#fde68a", "#bbf7d0", "#fecaca"][v % 4]; g.fillRect(0, 0, 1600, 900);
    g.fillStyle = "#1d4ed8"; g.font = "120px sans-serif"; g.fillText("Stub diagram v" + v, 200, 480);
    const naturalPt = 800, aspect = 900 / 1600;
    return { title: "Stub diagram", version: v, page: "p1", pageTitle: "Page 1", pageCount: 1, mermaid: "flowchart TD\\n  A[Start] --> B[End v" + v + "]",
      loose: { texts: [], arrows: 0 }, base64: canvas.toDataURL("image/png").split(",")[1], width: 1600, height: 900, naturalPt,
      shownPt: shownPt || Math.min(naturalPt, maxWidthPt, maxHeightPt / aspect) };
  };
  loadEditor = async () => {};
  remember = () => {};
  current = { documentId: "11111111-1111-4111-8111-111111111111", embedId: "22222222-2222-4222-8222-222222222222", title: "Stub diagram", page: "p1", pages: null };
  refreshButtons();
  return "stubbed";
})()`;
