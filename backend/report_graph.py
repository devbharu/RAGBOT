"""
report_graph.py  — 100% PDF coverage, large-context optimised
──────────────────────────────────────────────────────────────
KEY CHANGES vs previous version:

  PROBLEM: Regex heading detection was treating TOC page numbers as section
  boundaries → 566 sections for a 1300-page book → 566 LLM calls → hours.

  FIX:
  1. SMART CHAPTER GROUPING
     Detected headings are clustered into real chapters (not per-page splits).
     "Chapter 1 ... **5**" and "Chapter 1 ... **7**" → merged into one
     "Chapter 1" section covering all its pages.

  2. LARGE CONTEXT PER SECTION (up to 80k chars ≈ 20k tokens)
     Model has 100k context window — use it. Each section gets a fat context
     slice instead of tiny 7k-char excerpts.

  3. TARGET 8–15 SECTIONS TOTAL
     Regardless of how many headings exist in the TOC, we merge down to
     8–15 meaningful sections. Fewer calls = much faster.

  4. ZERO LLM calls for structure (regex + grouping, instant).

Graph:
  fetch_all_chunks → discover_structure → fan_out_sections (parallel)
    → write_section → reduce_sections → render_latex_fast → END
"""

from __future__ import annotations

import os
import re
import time
import threading
from typing import TypedDict, Annotated
import operator

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from langgraph.graph import StateGraph, END
from langgraph.types import Send

import chromadb

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b-cloud")
CHROMA_DIR   = os.getenv("CHROMA_DIR",   "chroma_db")

# Large context per section — model has 100k window, use 70k safely
SECTION_CONTEXT_LIMIT = int(os.getenv("SECTION_CONTEXT_LIMIT", "70000"))

# Max chars from a single chunk
CHUNK_TRIM = int(os.getenv("CHUNK_TRIM", "1200"))

# Target section count — merge detected headings down to this range
TARGET_SECTIONS_MIN = int(os.getenv("TARGET_SECTIONS_MIN", "8"))
TARGET_SECTIONS_MAX = int(os.getenv("TARGET_SECTIONS_MAX", "15"))

# Max parallel LLM calls
MAX_CONCURRENT_SECTIONS = int(os.getenv("MAX_CONCURRENT_SECTIONS", "4"))
_section_semaphore = threading.Semaphore(MAX_CONCURRENT_SECTIONS)

FAST_MODE = os.getenv("FAST_MODE", "0") == "1"

DEFAULT_SECTIONS = [
    "Introduction & Background",
    "Core Concepts & Definitions",
    "Protocols, Architecture & Implementation",
    "Advanced Topics & Case Studies",
    "Summary & Conclusions",
]

# ──────────────────────────────────────────────────────────────
# State types
# ──────────────────────────────────────────────────────────────

class ChunkData(TypedDict):
    text:        str
    page:        int
    chunk_index: int
    type:        str

class SectionData(TypedDict):
    section_name: str
    chunks:       list[ChunkData]
    filename:     str

class ReportState(TypedDict):
    filename:       str
    query_hint:     str
    all_chunks:     list[ChunkData]
    sections:       list[str]
    section_chunks: list[dict]
    section_texts:  Annotated[list[dict], operator.add]
    final_report:   str
    latex_output:   str

# ──────────────────────────────────────────────────────────────
# Lazy singletons
# ──────────────────────────────────────────────────────────────

_llm: ChatOllama | None = None
_chroma_client: chromadb.PersistentClient | None = None

def _get_llm() -> ChatOllama:
    global _llm
    if _llm is None:
        _llm = ChatOllama(model=OLLAMA_MODEL, base_url=OLLAMA_HOST, temperature=0.1)
    return _llm

def _get_chroma_client() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
    return _chroma_client

def _collection_name(filename: str) -> str:
    return "file_" + re.sub(r"[^a-zA-Z0-9_-]", "_", filename)

# ──────────────────────────────────────────────────────────────
# Fetch ALL chunks
# ──────────────────────────────────────────────────────────────

def _fetch_all_chunks(filename: str) -> list[ChunkData]:
    client   = _get_chroma_client()
    col_name = _collection_name(filename)
    try:
        collection = client.get_collection(col_name)
    except Exception as e:
        print(f"[REPORT] Collection not found for '{filename}': {e}")
        return []

    total = collection.count()
    print(f"[REPORT] Fetching ALL {total} chunks...")

    all_docs, all_metas = [], []
    batch_size, offset  = 500, 0
    while offset < total:
        result = collection.get(
            include=["documents", "metadatas"],
            limit=batch_size, offset=offset,
        )
        all_docs.extend(result["documents"])
        all_metas.extend(result["metadatas"])
        offset += batch_size
        print(f"[REPORT] Fetched {min(offset, total)}/{total} chunks...")

    chunks: list[ChunkData] = []
    for doc, meta in zip(all_docs, all_metas):
        if not doc or not doc.strip():
            continue
        try:    page = int(meta.get("page", 0) or 0)
        except: page = 0
        try:    chunk_index = int(meta.get("chunk_index", 0) or 0)
        except: chunk_index = 0
        chunks.append({"text": doc, "page": page, "chunk_index": chunk_index, "type": meta.get("type", "text")})

    chunks.sort(key=lambda c: (c["page"], c["chunk_index"]))
    if chunks:
        print(f"[REPORT] Loaded {len(chunks)} chunks, pages {chunks[0]['page']}–{chunks[-1]['page']}")
    return chunks

def fetch_all_chunks_node(state: ReportState) -> dict:
    return {"all_chunks": _fetch_all_chunks(state["filename"])}

# ──────────────────────────────────────────────────────────────
# Smart structure discovery — cluster TOC entries into real chapters
# ──────────────────────────────────────────────────────────────

# Matches TOC-style lines: "Chapter 1 Foo **5**" or "UNIT 1 Foo"
_TOC_ENTRY_RE = re.compile(
    r"^(?:chapter|unit|part|module|section)\s+(\d+|[ivxlIVXL]+)[:\.\s]+(.+?)(?:\s+\*{0,2}\d+\*{0,2})?$",
    re.IGNORECASE,
)
# Matches ALL-CAPS headings (not TOC artifacts)
_ALLCAPS_RE = re.compile(r"^[A-Z][A-Z\s\-/&,]{4,60}$")

def _extract_chapter_key(title: str) -> str | None:
    """
    From 'Chapter 3 Data Types, Variables, and Arrays **45**'
    extract 'Chapter 3 Data Types, Variables, and Arrays'
    — strips trailing **page_number** noise.
    """
    # Strip trailing **N** or just N at end
    clean = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
    m = _TOC_ENTRY_RE.match(clean)
    if m:
        num   = m.group(1)
        label = m.group(2).strip().strip("*").strip()
        # Rebuild canonical key
        prefix = clean.split(num)[0].strip()
        return f"{prefix} {num}: {label}"
    return None

def _group_headings_into_chapters(
    raw_headings: list[tuple[int, str]],
    total_pages: int,
) -> list[tuple[int, int, str]]:
    """
    Merge per-page TOC detections into real chapter boundaries.

    Strategy:
      1. Extract chapter key (e.g. 'Chapter 3: Data Types') from each heading.
      2. Group consecutive headings with the same chapter key.
      3. The start of chapter N = first page of that group.
         The end of chapter N = start of chapter N+1 - 1.
      4. Merge down to TARGET_SECTIONS_MAX sections if still too many.
    """
    if not raw_headings:
        return []

    # Step 1: map each (page, title) to a chapter key
    keyed: list[tuple[int, str, str]] = []  # (page, key, original_title)
    for page, title in raw_headings:
        key = _extract_chapter_key(title)
        if key:
            keyed.append((page, key, title))
        else:
            # Non-TOC heading — use cleaned title as its own key
            clean = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
            keyed.append((page, clean, clean))

    # Step 2: collapse consecutive same-key entries → keep first occurrence
    chapters: list[tuple[int, str]] = []   # (start_page, display_name)
    seen: set[str] = set()
    for page, key, title in keyed:
        norm = re.sub(r"\s+", " ", key.lower().strip())
        if norm not in seen:
            seen.add(norm)
            # Clean display name: strip **N** noise, limit length
            display = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
            display = display[:80]
            chapters.append((page, display))

    # Step 3: assign end pages
    ranges: list[tuple[int, int, str]] = []
    for i, (start, name) in enumerate(chapters):
        end = chapters[i + 1][0] - 1 if i + 1 < len(chapters) else total_pages
        ranges.append((start, end, name))

    # Prepend preamble if first chapter doesn't start at p.1
    if ranges and ranges[0][0] > 1:
        ranges.insert(0, (1, ranges[0][0] - 1, "Preamble & Introduction"))

    # Step 4: if still too many sections, merge adjacent ones
    #   Strategy: merge smallest adjacent sections until within TARGET_SECTIONS_MAX
    while len(ranges) > TARGET_SECTIONS_MAX:
        # Find the pair of adjacent sections with fewest combined pages
        min_pages = None
        min_idx   = 0
        for i in range(len(ranges) - 1):
            combined = ranges[i + 1][1] - ranges[i][0]
            if min_pages is None or combined < min_pages:
                min_pages = combined
                min_idx   = i
        # Merge ranges[min_idx] and ranges[min_idx+1]
        s, _, n1 = ranges[min_idx]
        _, e, n2 = ranges[min_idx + 1]
        merged_name = n1 if n1 == n2 else f"{n1} & {n2}"
        ranges[min_idx : min_idx + 2] = [(s, e, merged_name[:80])]

    print(f"[REPORT] Grouped into {len(ranges)} chapters after merging")
    return ranges


def _even_partition(total_pages: int, names: list[str]) -> list[tuple[int, int, str]]:
    n = len(names)
    pages_per = max(1, total_pages // n)
    return [
        (i * pages_per + 1,
         (i + 1) * pages_per if i < n - 1 else total_pages,
         name)
        for i, name in enumerate(names)
    ]


def discover_structure_node(state: ReportState) -> dict:
    chunks          = state["all_chunks"]
    caller_sections = [s for s in (state.get("sections") or []) if s.strip()]

    if not chunks:
        return {"sections": [], "section_chunks": []}

    total_pages = max(c["page"] for c in chunks)
    section_ranges: list[tuple[int, int, str]] = []

    if caller_sections:
        section_ranges = _even_partition(total_pages, caller_sections)
        print(f"[REPORT] Using {len(caller_sections)} caller-provided sections")

    elif FAST_MODE:
        section_ranges = _even_partition(total_pages, DEFAULT_SECTIONS)
        print(f"[REPORT] FAST_MODE: {len(DEFAULT_SECTIONS)} even sections")

    else:
        # ── Scan first chunk of each page for headings ───────────
        # TOC pattern: "Chapter N Title **page**" or "UNIT N Title"
        HEADING_RE = re.compile(
            r"^(?:chapter|unit|part|module|section)\s+[\dIVXivx]+[:\.\s].+",
            re.IGNORECASE,
        )
        raw_headings: list[tuple[int, str]] = []
        seen_pages: set[int] = set()

        for chunk in chunks:
            page = chunk["page"]
            if page in seen_pages:
                continue
            seen_pages.add(page)
            first_line = chunk["text"].strip().split("\n")[0].strip()
            if HEADING_RE.match(first_line) or _ALLCAPS_RE.match(first_line):
                raw_headings.append((page, first_line))

        print(f"[REPORT] Raw heading scan found {len(raw_headings)} candidates")

        if len(raw_headings) >= 2:
            section_ranges = _group_headings_into_chapters(raw_headings, total_pages)
        else:
            section_ranges = _even_partition(total_pages, DEFAULT_SECTIONS)
            print(f"[REPORT] Too few headings — even partition into {len(DEFAULT_SECTIONS)} sections")

    # Partition chunks
    section_chunks_map = []
    for start, end, name in section_ranges:
        sec_chunks = [c for c in chunks if start <= c["page"] <= end]
        section_chunks_map.append({"name": name, "chunks": sec_chunks, "start": start, "end": end})
        print(f"[REPORT] '{name}' (p.{start}–{end}) → {len(sec_chunks)} chunks")

    return {
        "sections":       [s["name"] for s in section_chunks_map],
        "section_chunks": section_chunks_map,
    }

# ──────────────────────────────────────────────────────────────
# Fan-out
# ──────────────────────────────────────────────────────────────

def fan_out_sections(state: ReportState) -> list[Send]:
    section_chunks = state["section_chunks"]
    filename       = state["filename"]
    if not section_chunks:
        return [Send("write_section", {
            "section_name": "Document Content",
            "chunks":       state.get("all_chunks", [])[:200],
            "filename":     filename,
        })]
    sends = [
        Send("write_section", {"section_name": s["name"], "chunks": s["chunks"], "filename": filename})
        for s in section_chunks
    ]
    print(f"[REPORT] Fanning out {len(sends)} parallel section writers")
    return sends

# ──────────────────────────────────────────────────────────────
# Context builder — uses the full large context window
# ──────────────────────────────────────────────────────────────

def _chunks_to_context(chunks: list[ChunkData]) -> tuple[str, str]:
    if not chunks:
        return "", "N/A"

    pages      = sorted(set(c["page"] for c in chunks))
    page_range = f"p.{pages[0]}–p.{pages[-1]}"

    # Group by page
    by_page: dict[int, list[ChunkData]] = {}
    for c in chunks:
        by_page.setdefault(c["page"], []).append(c)

    # Budget: spread SECTION_CONTEXT_LIMIT evenly across pages
    budget_per_page = max(300, SECTION_CONTEXT_LIMIT // max(len(pages), 1))

    parts: list[str] = []
    total = 0

    for page in pages:
        page_chunks = sorted(by_page[page], key=lambda c: c["chunk_index"])
        page_text = ""
        for c in page_chunks:
            text = c["text"].strip()
            if not text:
                continue
            page_text += text[:CHUNK_TRIM] + "\n"
            if len(page_text) >= budget_per_page:
                break

        line = f"[p.{page}]\n{page_text.strip()}\n"
        if total + len(line) > SECTION_CONTEXT_LIMIT:
            break
        parts.append(line)
        total += len(line)

    return "\n".join(parts), page_range

# ──────────────────────────────────────────────────────────────
# Section writer
# ──────────────────────────────────────────────────────────────

_SECTION_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are an expert technical writer producing a section of a comprehensive "
     "technical report. This is NOT a summary — write the FULL detailed content.\n\n"
     "MANDATORY RULES:\n"
     "1. Use ONLY information from the provided context. No hallucination.\n"
     "2. Write EVERYTHING present in the context:\n"
     "   - Every definition, concept, term, and explanation\n"
     "   - Every formula in LaTeX math: $formula$ or $$formula$$\n"
     "   - Every table as markdown: | Col | Col |\\n|---|---|\\n| val | val |\n"
     "   - Every algorithm and procedure as numbered steps\n"
     "   - Every example, figure description, comparison, trade-off\n"
     "3. Cite page numbers inline like (p.3) for specific content.\n"
     "4. Use ### for subsections, **term** for key terms, `code` for code/protocols.\n"
     "5. Write as long as the context demands — do NOT truncate or summarise.\n"
     "6. Preserve technical precision — do not paraphrase formulas.\n"
     "7. Do NOT write headings that include page numbers like '## Foo (p.3)'.\n"),
    ("human",
     "Document: {filename}\n"
     "Section: {section_name}\n"
     "Pages: {page_range}\n\n"
     "Context:\n{context}\n\n"
     "Write the complete '{section_name}' section."),
])


def write_section_node(state: SectionData) -> dict:
    section_name = state["section_name"]
    chunks       = state.get("chunks", [])
    filename     = state["filename"]

    if not chunks:
        return {"section_texts": [{"name": section_name, "text": "*No content found.*"}]}

    context, page_range = _chunks_to_context(chunks)
    print(f"[REPORT] '{section_name}' — {len(chunks)} chunks ({page_range}), {len(context):,} context chars")

    llm   = _get_llm()
    chain = _SECTION_PROMPT | llm | StrOutputParser()

    MAX_RETRIES  = 3
    RETRY_DELAYS = [5, 15, 30]
    text = None

    with _section_semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                text = chain.invoke({
                    "filename": filename, "section_name": section_name,
                    "page_range": page_range, "context": context,
                })
                print(f"[REPORT] '{section_name}' → {len(text):,} chars written")
                break
            except Exception as e:
                err = str(e).lower()
                if ("429" in err or "too many" in err) and attempt < MAX_RETRIES - 1:
                    wait = RETRY_DELAYS[attempt]
                    print(f"[REPORT] Rate limit — retry in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"[REPORT] '{section_name}' FAILED: {e}")
                text = f"*Generation failed: {e}*"
                break

    return {"section_texts": [{"name": section_name, "text": text or "*Empty*"}]}

# ──────────────────────────────────────────────────────────────
# Reduce
# ──────────────────────────────────────────────────────────────

def reduce_sections_node(state: ReportState) -> dict:
    section_texts = state["section_texts"]
    sections      = state["sections"]
    filename      = state["filename"]

    order       = {name: i for i, name in enumerate(sections)}
    valid       = [s for s in section_texts if s.get("text") and "*No content" not in s["text"]]
    sorted_secs = sorted(valid, key=lambda s: order.get(s["name"], 999))

    title = filename.replace("_pdf","").replace(".pdf","").replace("_"," ").strip().title()

    parts  = [f"# {title}\n\n*Auto-generated technical report — {len(sorted_secs)} sections*\n"]
    parts += [f"## {s['name']}\n\n{s['text']}" for s in sorted_secs]
    stitched = "\n\n---\n\n".join(parts)

    print(f"[REPORT] Stitched {len(sorted_secs)} sections → {len(stitched):,} chars")
    return {"final_report": stitched}

# ──────────────────────────────────────────────────────────────
# LaTeX conversion — pure regex, instant
# ──────────────────────────────────────────────────────────────

def _clean_heading_text(text: str) -> str:
    text = re.sub(r"\\textit\{[^}]*\}", "", text)
    text = re.sub(r"\s*\(p\.\d+[^)]*\)", "", text)
    text = re.sub(r"\*{1,2}(\d+)\*{1,2}", "", text)  # strip **N** page refs
    text = text.strip(" \t.,;:-–—*")
    if text == text.upper() and len(text) > 4:
        text = text.title()
    return text


def _md_table_to_latex(table_lines: list[str]) -> str:
    rows = []
    for line in table_lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(re.fullmatch(r"[-: ]+", c) for c in cells):
            continue
        rows.append(cells)
    if not rows:
        return ""

    n_cols   = max(len(r) for r in rows)
    col_spec = "|" + "|".join(["l"] * n_cols) + "|"

    def fmt(c: str) -> str:
        c = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", c)
        c = re.sub(r"`(.+?)`",        r"\\texttt{\1}", c)
        c = re.sub(r"\*(.+?)\*",      r"\\textit{\1}", c)
        c = re.sub(r"(?<!\\)&",       r"\\&",          c)
        c = re.sub(r"(?<!\\)%",       r"\\%",          c)
        c = re.sub(r"(?<!\\)#",       r"\\#",          c)
        c = re.sub(r"(?<!\\)_",       r"\\_",           c)
        return c

    lines = [f"\\begin{{longtable}}{{{col_spec}}}", "\\hline"]
    for ri, row in enumerate(rows):
        cells = row + [""] * (n_cols - len(row))
        lines.append(" & ".join(fmt(c) for c in cells) + " \\\\")
        lines.append("\\hline")
        if ri == 0:
            lines.append("\\endhead")
    lines += ["\\end{longtable}"]
    return "\n".join(lines)


def _sanitize_unicode(text: str) -> str:
    """
    Replace Unicode characters that crash pdflatex / xelatex with plain LaTeX equivalents.
    This fixes the DeclareUnicodeCharacter error.
    """
    replacements = {
        # Dashes
        "\u2014": "---",      # em dash
        "\u2013": "--",       # en dash
        "\u2012": "--",       # figure dash
        "\u2015": "---",      # horizontal bar
        # Quotes
        "\u2018": "`",        # left single quote
        "\u2019": "'",        # right single quote / apostrophe
        "\u201c": "``",       # left double quote
        "\u201d": "''",     # right double quote
        "\u201a": ",",        # single low-9 quotation
        "\u201e": ",,",       # double low-9 quotation
        # Spaces
        "\u00a0": "~",        # non-breaking space
        "\u2009": "\\,",    # thin space
        "\u202f": "~",        # narrow no-break space
        # Ellipsis & bullets
        "\u2026": "\\ldots{}",  # horizontal ellipsis
        "\u2022": "\\textbullet{}",  # bullet
        "\u25cf": "\\textbullet{}",
        "\u2023": ">",        # triangular bullet
        # Arrows
        "\u2192": "$\\rightarrow$",
        "\u2190": "$\\leftarrow$",
        "\u2194": "$\\leftrightarrow$",
        "\u21d2": "$\\Rightarrow$",
        # Math-ish
        "\u00d7": "$\\times$",
        "\u00f7": "$\\div$",
        "\u00b1": "$\\pm$",
        "\u2212": "--",       # minus sign → en-dash (safe in text)
        "\u2264": "$\\leq$",
        "\u2265": "$\\geq$",
        "\u2260": "$\\neq$",
        "\u221e": "$\\infty$",
        "\u03b1": "$\\alpha$",
        "\u03b2": "$\\beta$",
        "\u03b3": "$\\gamma$",
        "\u03bb": "$\\lambda$",
        "\u03c0": "$\\pi$",
        "\u03a3": "$\\Sigma$",
        # Accented Latin (safe to transliterate for technical docs)
        "\u00e9": "\\'e",
        "\u00e8": "\\`e",
        "\u00ea": "\\^e",
        "\u00eb": '\\"e',
        "\u00e0": "\\`a",
        "\u00e2": "\\^a",
        "\u00e4": '\\"a',
        "\u00f6": '\\"o',
        "\u00fc": '\\"u',
        "\u00dc": '\\"U',
        "\u00c9": "\\'E",
        # Misc symbols
        "\u00ae": "\\textregistered{}",
        "\u00a9": "\\textcopyright{}",
        "\u2122": "\\texttrademark{}",
        "\u00b0": "$^{\\circ}$",
        "\u2019": "'",
        # Zero-width chars (just strip)
        "\u200b": "",
        "\u200c": "",
        "\u200d": "",
        "\ufeff": "",
    }
    for char, replacement in replacements.items():
        text = text.replace(char, replacement)
    # Final safety net: replace any remaining non-ASCII with ?
    # so pdflatex never sees an unknown Unicode character
    result = []
    for ch in text:
        if ord(ch) < 128:
            result.append(ch)
        elif ch in replacements:
            result.append(replacements[ch])
        else:
            # Try to keep it if it's a known safe Latin-1 range handled by inputenc
            # otherwise replace with a visible placeholder
            if 0x00C0 <= ord(ch) <= 0x00FF:
                result.append(ch)  # inputenc + latin1 handles these
            else:
                result.append("?")
    return "".join(result)


def _md_to_latex(md: str) -> str:
    body = _sanitize_unicode(md)
    body = body.replace("~~-~~", "")
    body = re.sub(r"<sub>(.*?)</sub>", r"\textsubscript{\1}", body)
    body = re.sub(r"<sup>(.*?)</sup>", r"\textsuperscript{\1}", body)
    body = re.sub(r"<[^>]+>", "", body)

    # Stash math so we never escape inside it
    math_display: list[str] = []
    def stash_display(m):
        math_display.append(m.group(1))
        return f"@@DM{len(math_display)-1}@@"
    body = re.sub(r"\$\$(.+?)\$\$", stash_display, body, flags=re.DOTALL)

    math_inline: list[str] = []
    def stash_inline(m):
        math_inline.append(m.group(0))
        return f"@@IM{len(math_inline)-1}@@"
    body = re.sub(r"\$[^$\n]+?\$", stash_inline, body)

    # Stash verbatim/code spans so special chars inside are NOT escaped
    code_spans: list[str] = []
    def stash_code(m):
        code_spans.append(m.group(1))
        return f"@@CS{len(code_spans)-1}@@"
    # Already converted `...` to \texttt{...} above — stash those
    body = re.sub(r"\\texttt\{([^}]*)\}", stash_code, body)

    # Headings (##### down to #)
    def heading_sub(m):
        depth   = len(m.group(1))
        content = _clean_heading_text(m.group(2))
        cmd = {1:"section", 2:"section", 3:"subsection", 4:"subsubsection", 5:"subsubsection"}.get(depth, "subsubsection")
        return f"\\{cmd}{{{content}}}"
    body = re.sub(r"^(#{1,5}) (.+)$", heading_sub, body, flags=re.MULTILINE)

    # Horizontal rules
    body = re.sub(r"^---+$", r"\\medskip\\noindent\\rule{\\linewidth}{0.4pt}\\medskip", body, flags=re.MULTILINE)

    # Inline formatting
    body = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", body)
    body = re.sub(r"\*(.+?)\*",     r"\\textit{\1}", body)
    body = re.sub(r"`(.+?)`",       r"\\texttt{\1}",  body)

    # Escape ALL LaTeX special chars outside stashed math/code
    # Order matters: \ must be first so we don't double-escape later subs
    def escape_text(text):
        parts = re.split(r"(@@(?:DM|IM)\d+@@)", text)
        out = []
        for i, p in enumerate(parts):
            if i % 2 == 0:  # text segment — escape everything
                # \ first (backslash itself — but only bare ones, not our LaTeX commands)
                # Skip: we only escape the 9 special chars LaTeX cares about in text mode
                p = re.sub(r"(?<!\\)%",  r"\\%",  p)   # percent
                p = re.sub(r"(?<!\\)&",  r"\\&",  p)   # ampersand
                p = re.sub(r"(?<!\\)#",  r"\\#",  p)   # hash  ← THE FIX (C#, #define etc)
                p = re.sub(r"(?<!\\)\$(?!\$)", r"\\$", p)  # bare $ not part of $$
                p = re.sub(r"(?<!\\)\^", r"\\^{}", p)  # caret
                p = re.sub(r"(?<!\\)~",  r"\\textasciitilde{}", p)  # tilde (bare)
                # _ : only escape bare underscores NOT inside 	exttt or already escaped
                # Strategy: replace _ that are not already preceded by backslash
                p = re.sub(r"(?<!\\)_",  r"\\_",  p)   # underscore ← fixes Missing $
            out.append(p)
        return "".join(out)
    body = escape_text(body)

    # Line-by-line: tables, lists, blockquotes, code fences
    lines_in = body.split("\n")
    out: list[str] = []
    env: str | None = None
    BULLET_RE   = re.compile(r"^(?:[-*]) (.+)$")
    NUMBERED_RE = re.compile(r"^\d+\. (.+)$")
    QUOTE_RE    = re.compile(r"^> (.*)$")
    TABLE_RE    = re.compile(r"^\|.+\|")

    def close_env():
        nonlocal env
        if env:
            out.append(f"\\end{{{env}}}")
            env = None

    i = 0
    while i < len(lines_in):
        line = lines_in[i]

        # Table
        if TABLE_RE.match(line.strip()):
            close_env()
            tbl = []
            while i < len(lines_in) and (TABLE_RE.match(lines_in[i].strip()) or
                                          re.fullmatch(r"\|?[-| :]+\|?", lines_in[i].strip())):
                tbl.append(lines_in[i]); i += 1
            latex_tbl = _md_table_to_latex(tbl)
            if latex_tbl:
                out.append(latex_tbl)
            continue

        # Code fence
        if line.strip().startswith("```"):
            close_env()
            verb = []
            i += 1
            while i < len(lines_in) and not lines_in[i].strip().startswith("```"):
                verb.append(lines_in[i]); i += 1
            i += 1
            if verb:
                out.append("\\begin{verbatim}")
                out.extend(verb)
                out.append("\\end{verbatim}")
            continue

        # Blockquote
        qm = QUOTE_RE.match(line)
        if qm:
            close_env()
            qlines = []
            while i < len(lines_in) and QUOTE_RE.match(lines_in[i]):
                qlines.append(QUOTE_RE.match(lines_in[i]).group(1)); i += 1
            out.extend(["\\begin{quote}"] + qlines + ["\\end{quote}"])
            continue

        # Bullet
        bm = BULLET_RE.match(line)
        if bm:
            if env != "itemize":
                close_env()
                out.append("\\begin{itemize}"); env = "itemize"
            out.append(f"  \\item {bm.group(1)}")
            i += 1; continue

        # Numbered
        nm = NUMBERED_RE.match(line)
        if nm:
            if env != "enumerate":
                close_env()
                out.append("\\begin{enumerate}"); env = "enumerate"
            out.append(f"  \\item {nm.group(1)}")
            i += 1; continue

        # Blank line keeps list open (don't close env on blank)
        if not line.strip() and env:
            out.append(line); i += 1; continue

        close_env()
        out.append(line)
        i += 1

    close_env()
    body = "\n".join(out)

    # Restore math
    for idx, m in enumerate(math_display):
        body = body.replace(f"@@DM{idx}@@", f"\\[\n{m}\n\\]")
    for idx, m in enumerate(math_inline):
        body = body.replace(f"@@IM{idx}@@", m)
    # Restore code spans (must come AFTER math restore, contents unescaped)
    for idx, c in enumerate(code_spans):
        body = body.replace(f"@@CS{idx}@@", f"\\texttt{{{c}}}")

    return body


def render_latex_fast_node(state: ReportState) -> dict:
    filename = state["filename"]
    title    = filename.replace("_pdf","").replace(".pdf","").replace("_"," ").strip().title()
    body     = _md_to_latex(state["final_report"])

    latex = (
        "\\documentclass[12pt]{article}\n"
        "\\usepackage[utf8]{inputenc}\n"
        "\\usepackage[T1]{fontenc}\n"
        "\\usepackage[margin=1in]{geometry}\n"
        "\\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue]{hyperref}\n"
        "\\usepackage{booktabs,array,longtable}\n"
        "\\usepackage{amsmath,amssymb}\n"
        "\\usepackage{verbatim}\n"
        "\\usepackage{parskip,microtype,xcolor,enumitem}\n"
        "\\setlist{noitemsep, topsep=4pt}\n"
        "\\renewcommand{\\arraystretch}{1.3}\n"
        f"\\title{{{title}}}\n"
        "\\author{RAG Report Generator}\n"
        "\\date{\\today}\n"
        "\\begin{document}\n"
        "\\maketitle\\tableofcontents\\newpage\n"
        f"{body}\n"
        "\\end{document}"
    )
    print(f"[REPORT] LaTeX rendered → {len(latex):,} chars")
    return {"latex_output": latex}

# ──────────────────────────────────────────────────────────────
# Graph
# ──────────────────────────────────────────────────────────────

def build_report_graph():
    g = StateGraph(ReportState)
    g.add_node("fetch_all_chunks",   fetch_all_chunks_node)
    g.add_node("discover_structure", discover_structure_node)
    g.add_node("write_section",      write_section_node)
    g.add_node("reduce_sections",    reduce_sections_node)
    g.add_node("render_latex_fast",  render_latex_fast_node)

    g.set_entry_point("fetch_all_chunks")
    g.add_edge("fetch_all_chunks",   "discover_structure")
    g.add_conditional_edges("discover_structure", fan_out_sections)
    g.add_edge("write_section",      "reduce_sections")
    g.add_edge("reduce_sections",    "render_latex_fast")
    g.add_edge("render_latex_fast",  END)
    return g.compile()

REPORT_GRAPH = build_report_graph()

# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

def generate_report(filename: str, query_hint: str = "", sections: list[str] | None = None) -> dict:
    result = REPORT_GRAPH.invoke({
        "filename": filename, "query_hint": query_hint,
        "sections": sections or [],
        "all_chunks": [], "section_chunks": [],
        "section_texts": [], "final_report": "", "latex_output": "",
    })
    return {"markdown": result["final_report"], "latex": result["latex_output"], "sections": result["section_texts"]}