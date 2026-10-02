"""A .docx as Markdown, for handing a document to an LLM: text, headings, lists
and tables as they read, and each Lucid diagram picture replaced by the Mermaid
in its alt text, which most .docx-to-text tools drop. Standard library only.

    python docx2md.py report.docx > report.md
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"


def text_of(el):
    """The visible text of a paragraph or cell: text runs, tabs and breaks;
    field codes (w:instrText) are left out, their results kept."""
    out = []
    for node in el.iter():
        if node.tag == W + "t":
            out.append(node.text or "")
        elif node.tag == W + "tab":
            out.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            out.append("\n")
    return "".join(out)


def picture(doc_pr):
    """A picture by its alt text: a Lucid diagram's title and Mermaid, or
    another picture's description."""
    alt = doc_pr.get("descr", "")
    mermaid = re.search(r"^```mermaid\n(.*?)\n```", alt, re.S | re.M)
    if mermaid:
        title = re.search(r"^Lucidchart diagram: (.*)$", alt, re.M)
        link = re.search(r"https://lucid\.app/lucidchart/\S+", alt)
        head = f"Diagram: {title.group(1) if title else 'untitled'}" + (f" ({link.group(0)})" if link else "")
        return f"{head}\n\n```mermaid\n{mermaid.group(1)}\n```"
    return f"[image: {alt.strip() or doc_pr.get('name', 'picture')}]"


def paragraph(p):
    style = p.find(f"{W}pPr/{W}pStyle")
    style = style.get(W + "val") if style is not None else ""
    blocks = [picture(d) for d in p.iter(WP + "docPr")]
    text = text_of(p).strip()
    if text:
        heading = re.match(r"(?i)heading\s*(\d)", style)
        if heading:
            text = "#" * int(heading.group(1)) + " " + text
        elif re.match(r"(?i)title$", style):
            text = "# " + text
        elif p.find(f"{W}pPr/{W}numPr") is not None or re.match(r"(?i)list", style):
            text = "- " + text
        elif re.match(r"(?i)caption", style):
            text = f"*{text}*"
        blocks.append(text)
    return "\n\n".join(blocks)


def table(tbl):
    rows = [[" ".join(paragraph(p) for p in tc.iter(W + "p")).strip().replace("\n", " ").replace("|", "\\|")
             for tc in tr.findall(W + "tc")] for tr in tbl.findall(W + "tr")]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def convert(path):
    with zipfile.ZipFile(path) as z:
        body = ET.fromstring(z.read("word/document.xml")).find(W + "body")
    # Content controls (w:sdt) wrap ordinary paragraphs and tables; read through them.
    def walk(parent):
        for el in parent:
            if el.tag == W + "sdt":
                content = el.find(W + "sdtContent")
                if content is not None:
                    yield from walk(content)
            else:
                yield el

    blocks = []
    for el in walk(body):
        block = paragraph(el) if el.tag == W + "p" else table(el) if el.tag == W + "tbl" else ""
        if not block:
            continue
        # A list's items go on consecutive lines.
        if blocks and block.startswith("- ") and blocks[-1].split("\n")[-1].startswith("- "):
            blocks[-1] += "\n" + block
        else:
            blocks.append(block)
    return "\n\n".join(blocks) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(convert(sys.argv[1]))
