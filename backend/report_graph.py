"""
report_graph.py  — Direct LaTeX output, large-context optimised, Overleaf-Ready
──────────────────────────────────────────────────────────────
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

# OPTIMIZED FOR 131k CONTEXT (~500,000 chars)
SECTION_CONTEXT_LIMIT   = int(os.getenv("SECTION_CONTEXT_LIMIT",   "400000"))
CHUNK_TRIM              = int(os.getenv("CHUNK_TRIM",              "10000"))
TARGET_SECTIONS_MIN     = int(os.getenv("TARGET_SECTIONS_MIN",     "10"))
TARGET_SECTIONS_MAX     = int(os.getenv("TARGET_SECTIONS_MAX",     "15"))
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

_SKIP_SECTION_PATTERNS = re.compile(
    r"^(index|bibliography|references|further reading|glossary|appendix|"
    r"table of contents|contents|acknowledgements?|preface|foreword|"
    r"about the authors?|copyright|colophon)\s*$",
    re.IGNORECASE,
)

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
        chunks.append({
            "text":        doc,
            "page":        page,
            "chunk_index": chunk_index,
            "type":        meta.get("type", "text"),
        })

    chunks.sort(key=lambda c: (c["page"], c["chunk_index"]))
    if chunks:
        print(f"[REPORT] Loaded {len(chunks)} chunks, pages {chunks[0]['page']}–{chunks[-1]['page']}")
    return chunks

def fetch_all_chunks_node(state: ReportState) -> dict:
    return {"all_chunks": _fetch_all_chunks(state["filename"])}

# ──────────────────────────────────────────────────────────────
# Smart structure discovery
# ──────────────────────────────────────────────────────────────

_TOC_ENTRY_RE = re.compile(
    r"^(?:chapter|unit|part|module|section)\s+(\d+|[ivxlIVXL]+)[:\.\s]+(.+?)(?:\s+\*{0,2}\d+\*{0,2})?$",
    re.IGNORECASE,
)
_ALLCAPS_RE = re.compile(r"^[A-Z][A-Z\s\-/&,]{4,60}$")


def _extract_chapter_key(title: str) -> str | None:
    clean = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
    m = _TOC_ENTRY_RE.match(clean)
    if m:
        num   = m.group(1)
        label = m.group(2).strip().strip("*").strip()
        prefix = clean.split(num)[0].strip()
        return f"{prefix} {num}: {label}"
    return None


def _group_headings_into_chapters(
    raw_headings: list[tuple[int, str]],
    total_pages: int,
) -> list[tuple[int, int, str]]:
    keyed: list[tuple[int, str, str]] = []
    for page, title in raw_headings:
        key = _extract_chapter_key(title)
        if key:
            keyed.append((page, key, title))
        else:
            clean = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
            keyed.append((page, clean, clean))

    chapters: list[tuple[int, str]] = []
    seen: set[str] = set()
    for page, key, title in keyed:
        norm = re.sub(r"\s+", " ", key.lower().strip())
        if norm not in seen:
            seen.add(norm)
            display = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()[:80]
            chapters.append((page, display))

    ranges: list[tuple[int, int, str]] = []
    for i, (start, name) in enumerate(chapters):
        end = chapters[i + 1][0] - 1 if i + 1 < len(chapters) else total_pages
        ranges.append((start, end, name))

    if ranges and ranges[0][0] > 1:
        ranges.insert(0, (1, ranges[0][0] - 1, "Preamble & Introduction"))

    while len(ranges) > TARGET_SECTIONS_MAX:
        min_pages, min_idx = None, 0
        for i in range(len(ranges) - 1):
            combined = ranges[i + 1][1] - ranges[i][0]
            if min_pages is None or combined < min_pages:
                min_pages, min_idx = combined, i
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

    total_pages    = max(c["page"] for c in chunks)
    section_ranges: list[tuple[int, int, str]] = []

    if caller_sections:
        section_ranges = _even_partition(total_pages, caller_sections)
        print(f"[REPORT] Using {len(caller_sections)} caller-provided sections")

    elif FAST_MODE:
        section_ranges = _even_partition(total_pages, DEFAULT_SECTIONS)
        print(f"[REPORT] FAST_MODE: {len(DEFAULT_SECTIONS)} even sections")

    else:
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

    section_ranges = [
        (s, e, n) for s, e, n in section_ranges
        if not _SKIP_SECTION_PATTERNS.match(n.strip())
    ]

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
        Send("write_section", {
            "section_name": s["name"],
            "chunks":       s["chunks"],
            "filename":     filename,
        })
        for s in section_chunks
    ]
    print(f"[REPORT] Fanning out {len(sends)} parallel section writers")
    return sends

# ──────────────────────────────────────────────────────────────
# Context builder
# ──────────────────────────────────────────────────────────────

def _chunks_to_context(chunks: list[ChunkData]) -> tuple[str, str]:
    if not chunks:
        return "", "N/A"

    pages      = sorted(set(c["page"] for c in chunks))
    page_range = f"p.{pages[0]}--p.{pages[-1]}"

    by_page: dict[int, list[ChunkData]] = {}
    for c in chunks:
        by_page.setdefault(c["page"], []).append(c)

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
# Section writer — STRONGLY TYPED PROMPT FOR MAXIMUM LENGTH & SAFETY
# ──────────────────────────────────────────────────────────────

_SECTION_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are an expert technical writer producing a section of a comprehensive "
     "technical report. Output ONLY valid LaTeX body content.\n\n"
     "CRITICAL LATEX COMPILATION RULES (FAILURE TO FOLLOW CRASHES THE COMPILER):\n"
     "1. UNDERSCORES IN TEXT/TABLES: Java variables (e.g., MAX_VALUE) contain underscores. You MUST escape them as \\_ (e.g., MAX\\_VALUE) or use \\verb|MAX_VALUE|. An unescaped _ outside of math mode will CRASH LaTeX.\n"
     "2. TABLES (LONGTABLE): Tables are the #1 source of crashes. \n"
     "   - Always define columns (e.g., \\begin{{longtable}}{{|p{{4cm}}|p{{10cm}}|}}).\n"
     "   - Always end every row with \\\\.\n"
     "   - NEVER put unescaped _, $, %, &, or # inside a table cell.\n"
     "   - NEVER use \\begin{{itemize}} inside a table cell unless wrapped in a \\parbox.\n"
     "   - Close the table properly with \\end{{longtable}}.\n"
     "3. ANGLE BRACKETS (GENERICS): For Java generics like List<T>, use \\verb|List<T>| or List\\textless{{}}T\\textgreater{{}}. NEVER use raw < or > in text.\n"
     "4. MATH MODE: Ensure all inline math ($...$) and display math (\\[...\\]) are properly closed.\n"
     "5. ESCAPE ALL SPECIAL CHARACTERS: &, %, $, # must become \\&, \\%, \\$, \\# in normal text.\n"
     "6. NO FORMATTING IN TITLES: Use plain text for \\subsection{{}} titles. No \\texttt{{}} or $ $ inside titles.\n"
     "7. BE EXHAUSTIVE AND VERBOSE: Write as much detail as physically possible. Expand on every concept, paragraph, and explanation found in the context. NEVER summarize, NEVER compress, and NEVER omit information.\n"
     "8. Do NOT wrap the output in \\begin{{document}} or \\section{{}}. Just output the body content.\n"),
    ("human",
     "Document: {filename}\n"
     "Section: {section_name}\n"
     "Pages: {page_range}\n\n"
     "Context:\n{context}\n\n"
     "Write the complete, highly detailed, unabridged LaTeX body for the '{section_name}' section. Ensure zero compilation errors."),
])

def write_section_node(state: SectionData) -> dict:
    section_name = state["section_name"]
    chunks       = state.get("chunks", [])
    filename     = state["filename"]

    if _SKIP_SECTION_PATTERNS.match(section_name.strip()):
        print(f"[REPORT] '{section_name}' — skipped (back-matter)")
        return {"section_texts": []}

    if not chunks:
        return {"section_texts": [{"name": section_name, "text": "\\textit{No content found.}"}]}

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
                    "filename":     filename,
                    "section_name": section_name,
                    "page_range":   page_range,
                    "context":      context,
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
                text = f"\\textit{{Generation failed: {e}}}"
                break

    return {"section_texts": [{"name": section_name, "text": text or "\\textit{Empty}"}]}

# ──────────────────────────────────────────────────────────────
# Reduce — stitch LaTeX sections into a complete document
# ──────────────────────────────────────────────────────────────

def _escape_latex_title(text: str) -> str:
    """Escape special characters in the document title."""
    for char, rep in [("&", "\\&"), ("%", "\\%"), ("#", "\\#"), ("$", "\\$"), ("_", "\\_")]:
        text = text.replace(char, rep)
    return text

def _sanitize_latex_text(text: str) -> str:
    """Pre-compilation cleanup to strip nasty hidden PDF unicode characters."""
    text = text.replace('\u202F', '~')  # Narrow No-Break Space
    text = text.replace('\u00A0', '~')  # Non-Breaking Space
    text = text.replace('\u2003', ' ')  # Em Space (NEW)
    text = text.replace('\u2002', ' ')  # En Space (NEW)
    text = text.replace('\u2009', ' ')  # Thin Space (NEW)
    return text

def reduce_sections_node(state: ReportState) -> dict:
    section_texts = state["section_texts"]
    sections      = state["sections"]
    filename      = state["filename"]

    order       = {name: i for i, name in enumerate(sections)}
    valid       = [
        s for s in section_texts
        if s.get("text") and "\\textit{No content" not in s["text"]
    ]
    sorted_secs = sorted(valid, key=lambda s: order.get(s["name"], 999))

    raw_title = (
        filename.replace("_pdf", "").replace(".pdf", "")
        .replace("_", " ").strip().title()
    )
    title = _escape_latex_title(raw_title)

    print(f"[REPORT] Assembling {len(sorted_secs)} sections into final LaTeX document...")

    # Build section blocks: \section{name}\n\n<body>
    section_blocks: list[str] = []
    for s in sorted_secs:
        sec_name  = _escape_latex_title(s["name"])
        sec_body  = _sanitize_latex_text(s["text"].strip())
        section_blocks.append(f"\\section{{{sec_name}}}\n\n{sec_body}")

    body = "\n\n".join(section_blocks)

    latex = (
        "\\documentclass[12pt]{article}\n"
        "\\usepackage[utf8]{inputenc}\n"
        "\\usepackage[T1]{fontenc}\n"
        "\\usepackage{lmodern}\n"
        "\\usepackage{textcomp}\n"
        "\\usepackage[margin=1in]{geometry}\n"
        "\\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue,bookmarksopen=true]{hyperref}\n"
        "\\usepackage{booktabs,array,longtable}\n"
        "\\usepackage{amsmath,amssymb}\n"
        "\\usepackage{verbatim,listings}\n"
        "\\usepackage{parskip,microtype,xcolor,enumitem}\n"
        "\\setlist{noitemsep, topsep=4pt}\n"
        "\\renewcommand{\\arraystretch}{1.3}\n\n"
        "% Fallback for stubborn unicode characters\n"
        "\\DeclareUnicodeCharacter{202F}{~}\n"
        "\\DeclareUnicodeCharacter{00A0}{~}\n"
        "\\DeclareUnicodeCharacter{2003}{\\space}\n"
        "\\DeclareUnicodeCharacter{2002}{\\space}\n"
        "\\DeclareUnicodeCharacter{2009}{\\space}\n\n"
        "% Prevent hyperref from choking on math/formatting in titles\n"
        "\\pdfstringdefDisableCommands{%\n"
        "  \\def\\texttt#1{<#1>}%\n"
        "  \\def\\textbf#1{#1}%\n"
        "}\n\n"
        f"\\title{{{title}}}\n"
        "\\author{RAG Report Generator}\n"
        "\\date{\\today}\n"
        "\\begin{document}\n"
        "\\maketitle\n"
        "\\tableofcontents\n"
        "\\newpage\n\n"
        f"{body}\n\n"
        "\\end{document}"
    )

    print(f"[REPORT] Final LaTeX document → {len(latex):,} chars")
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

    g.set_entry_point("fetch_all_chunks")
    g.add_edge("fetch_all_chunks",   "discover_structure")
    g.add_conditional_edges("discover_structure", fan_out_sections)
    g.add_edge("write_section",      "reduce_sections")
    g.add_edge("reduce_sections",    END)
    return g.compile()

REPORT_GRAPH = build_report_graph()

# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

def generate_report(
    filename:   str,
    query_hint: str = "",
    sections:   list[str] | None = None,
) -> dict:
    result = REPORT_GRAPH.invoke({
        "filename":       filename,
        "query_hint":     query_hint,
        "sections":       sections or [],
        "all_chunks":     [],
        "section_chunks": [],
        "section_texts":  [],
        "latex_output":   "",
    })
    return {
        "latex":    result["latex_output"],
        "sections": result["section_texts"],
    }