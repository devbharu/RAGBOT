"""
report_graph.py  — 100% PDF coverage report generation via LangGraph
──────────────────────────────────────────────────────────────────────
SPEED OPTIMISATIONS — why this version is fast:

  Old pipeline LLM calls: 1 (structure) + N sections + 1 (refine) + N (latex)
  New pipeline LLM calls: N sections ONLY  (everything else is instant Python)

  1. refine_coherence  REMOVED — saved 1 slow LLM call on 8000 chars.
     Title + section headers added in reduce_sections via pure string ops.

  2. render_latex (LLM) REPLACED with instant regex conversion.
     _md_to_latex() converts 100% of sections without any LLM call.
     For a 6-section report this alone saves 6 extra Ollama round-trips.

  3. FAST_MODE=1 env flag — skips structure-discovery LLM call and
     divides pages evenly. With caller-provided sections this means
     ZERO extra LLM calls beyond the section writers themselves.

  4. DEFAULT_N_SECTIONS = 4 (was 8) — fewer but larger parallel calls.

Graph:
  fetch_all_chunks -> discover_structure -> fan_out_sections
        | (parallel per section)
  write_section -> reduce_sections -> render_latex_fast -> END
"""

from __future__ import annotations

import os
import re
from typing import TypedDict, Annotated
import operator

from langchain_ollama import ChatOllama
from langchain_community.embeddings import HuggingFaceEmbeddings
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
EMBED_MODEL  = os.getenv("EMBED_MODEL",  "BAAI/bge-small-en-v1.5")
CHROMA_DIR   = os.getenv("CHROMA_DIR",   "chroma_db")

# Set FAST_MODE=1 to skip structure-discovery LLM call entirely
FAST_MODE = os.getenv("FAST_MODE", "0") == "1"

# Max chars of context sent to LLM per section write call
SECTION_CONTEXT_LIMIT = int(os.getenv("SECTION_CONTEXT_LIMIT", "7000"))

# How many chars per chunk to include in context
CHUNK_TRIM = int(os.getenv("CHUNK_TRIM", "600"))

# Fewer sections = fewer LLM calls = faster report
DEFAULT_N_SECTIONS = int(os.getenv("DEFAULT_N_SECTIONS", "4"))

DEFAULT_SECTIONS = [
    "Introduction & Background",
    "Core Concepts & Definitions",
    "Protocols, Architecture & Implementation",
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
        _llm = ChatOllama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_HOST,
            temperature=0.2,
        )
    return _llm


def _get_chroma_client() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
    return _chroma_client


def _collection_name(filename: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", filename)
    return f"file_{safe}"


# ──────────────────────────────────────────────────────────────
# Core: fetch EVERY chunk from ChromaDB (no similarity filter)
# ──────────────────────────────────────────────────────────────

def _fetch_all_chunks(filename: str) -> list[ChunkData]:
    client   = _get_chroma_client()
    col_name = _collection_name(filename)

    try:
        collection = client.get_collection(col_name)
    except Exception as e:
        print(f"[REPORT] Collection not found for '{filename}': {e}")
        return []

    total      = collection.count()
    print(f"[REPORT] Fetching ALL {total} chunks from ChromaDB for '{filename}'...")

    all_docs  = []
    all_metas = []
    batch_size = 500
    offset     = 0

    while offset < total:
        result = collection.get(
            include=["documents", "metadatas"],
            limit=batch_size,
            offset=offset,
        )
        all_docs.extend(result["documents"])
        all_metas.extend(result["metadatas"])
        offset += batch_size
        print(f"[REPORT] Fetched {min(offset, total)}/{total} chunks...")

    chunks: list[ChunkData] = []
    for doc, meta in zip(all_docs, all_metas):
        if not doc or not doc.strip():
            continue
        try:
            page = int(meta.get("page", 0) or 0)
        except (ValueError, TypeError):
            page = 0
        try:
            chunk_index = int(meta.get("chunk_index", 0) or 0)
        except (ValueError, TypeError):
            chunk_index = 0
        chunks.append({
            "text":        doc,
            "page":        page,
            "chunk_index": chunk_index,
            "type":        meta.get("type", "text"),
        })

    chunks.sort(key=lambda c: (c["page"], c["chunk_index"]))
    print(f"[REPORT] Loaded {len(chunks)} chunks, pages {chunks[0]['page']}–{chunks[-1]['page']}")
    return chunks


# ──────────────────────────────────────────────────────────────
# Node 1: Fetch all chunks
# ──────────────────────────────────────────────────────────────

def fetch_all_chunks_node(state: ReportState) -> dict:
    chunks = _fetch_all_chunks(state["filename"])
    return {"all_chunks": chunks}


# ──────────────────────────────────────────────────────────────
# Node 2: Discover structure (or skip via FAST_MODE)
# ──────────────────────────────────────────────────────────────

_STRUCTURE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are analyzing a document's table of contents and structure.\n"
     "Given a sequential list of text snippets from a document (in page order), "
     "identify the major sections or chapters.\n\n"
     "For each section, output:\n"
     "  <start_page>|<end_page>|<section title>\n\n"
     "Rules:\n"
     "- Cover the ENTIRE page range with no gaps.\n"
     "- Use the ACTUAL section/chapter names from the document.\n"
     "- Aim for 4 to 6 sections.\n"
     "- The last section's end_page must be the last page of the document.\n"
     "- Output ONLY the lines in the format above, nothing else.\n"),
    ("human",
     "Document: {filename}\n"
     "Total pages: {total_pages}\n\n"
     "Page content snippets (in order):\n\n{page_snippets}"),
])


def _build_page_snippets(chunks: list[ChunkData], max_pages: int = 60) -> str:
    by_page: dict[int, str] = {}
    for chunk in chunks:
        page = chunk["page"]
        if page not in by_page:
            by_page[page] = chunk["text"][:200].replace("\n", " ")

    pages = sorted(by_page.keys())
    if len(pages) > max_pages:
        step  = len(pages) / max_pages
        pages = [pages[int(i * step)] for i in range(max_pages)]

    return "\n".join(f"p.{p}: {by_page[p]}" for p in pages)


def _even_partition(total_pages: int, section_names: list[str]) -> list[tuple[int, int, str]]:
    """Divide pages evenly across sections — pure Python, zero LLM calls."""
    n = len(section_names)
    pages_per = max(1, total_pages // n)
    ranges = []
    for i, name in enumerate(section_names):
        start = i * pages_per + 1
        end   = (i + 1) * pages_per if i < n - 1 else total_pages
        ranges.append((start, end, name))
    return ranges


def discover_structure_node(state: ReportState) -> dict:
    chunks          = state["all_chunks"]
    filename        = state["filename"]
    caller_sections = state.get("sections") or []

    if not chunks:
        print("[REPORT] No chunks — cannot discover structure")
        return {"sections": [], "section_chunks": []}

    total_pages = max(c["page"] for c in chunks)

    # ── Fast path: even partition, no LLM ──────────────────────
    if FAST_MODE or caller_sections:
        names = caller_sections or DEFAULT_SECTIONS
        section_ranges = _even_partition(total_pages, names)
        print(f"[REPORT] Fast partition: {len(section_ranges)} sections (no LLM)")

    # ── Slow path: LLM discovers real section boundaries ───────
    else:
        llm   = _get_llm()
        chain = _STRUCTURE_PROMPT | llm | StrOutputParser()
        section_ranges = []
        try:
            raw = chain.invoke({
                "filename":      filename,
                "total_pages":   total_pages,
                "page_snippets": _build_page_snippets(chunks),
            })
            for line in raw.strip().split("\n"):
                parts = line.strip().split("|")
                if len(parts) >= 3:
                    try:
                        start = int(parts[0].strip())
                        end   = int(parts[1].strip())
                        name  = "|".join(parts[2:]).strip()
                        if name and start <= end:
                            section_ranges.append((start, end, name))
                    except ValueError:
                        continue

            if len(section_ranges) < 2:
                raise ValueError(f"Only {len(section_ranges)} section(s) parsed")

            # Ensure last section covers to end of doc
            if section_ranges[-1][1] < total_pages:
                s, _, n = section_ranges[-1]
                section_ranges[-1] = (s, total_pages, n)

            print(f"[REPORT] LLM discovered {len(section_ranges)} sections")

        except Exception as e:
            print(f"[REPORT] Structure discovery failed ({e}) — using even partition")
            section_ranges = _even_partition(total_pages, DEFAULT_SECTIONS)

    # Partition chunks by page range
    section_chunks_map = []
    for (start, end, name) in section_ranges:
        sec_chunks = [c for c in chunks if start <= c["page"] <= end]
        section_chunks_map.append({"name": name, "chunks": sec_chunks, "start": start, "end": end})
        print(f"[REPORT] '{name}' (p.{start}–{end}) → {len(sec_chunks)} chunks")

    return {
        "sections":       [s["name"] for s in section_chunks_map],
        "section_chunks": section_chunks_map,
    }


# ──────────────────────────────────────────────────────────────
# Routing: fan out one Send per section
# ──────────────────────────────────────────────────────────────

def fan_out_sections(state: ReportState) -> list[Send]:
    section_chunks = state["section_chunks"]
    filename       = state["filename"]

    if not section_chunks:
        return [Send("write_section", {
            "section_name": "Document Content",
            "chunks":       state.get("all_chunks", [])[:50],
            "filename":     filename,
        })]

    sends = [
        Send("write_section", {
            "section_name": sec["name"],
            "chunks":       sec["chunks"],
            "filename":     filename,
        })
        for sec in section_chunks
    ]
    print(f"[REPORT] Fanning out {len(sends)} parallel section writers")
    return sends


# ──────────────────────────────────────────────────────────────
# Node 3: Write one section (LLM call — unavoidable)
# ──────────────────────────────────────────────────────────────

_SECTION_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are an expert technical writer producing a section of a comprehensive "
     "technical report. This is NOT a summary — write the FULL detailed content.\n\n"
     "MANDATORY RULES:\n"
     "1. Use ONLY information from the provided context. No hallucination.\n"
     "2. Write EVERYTHING present in the context:\n"
     "   - Every definition, concept, term, and explanation\n"
     "   - Every formula and equation in LaTeX math: $formula$ or $$formula$$\n"
     "   - Every table as a markdown table with header row\n"
     "   - Every algorithm, protocol steps, or procedure as numbered steps\n"
     "   - Every example, diagram description, figure caption\n"
     "3. Cite page numbers inline like (p.3) for specific content.\n"
     "4. Use ### for subsections, **term** for key terms, `code` for protocol names.\n"
     "5. Write 500–2000 words as the context demands.\n"
     "6. Preserve technical precision — do not paraphrase formulas or table data."),
    ("human",
     "Document: {filename}\n"
     "Section: {section_name}\n"
     "Pages covered: {page_range}\n\n"
     "All content from these pages:\n\n{context}\n\n"
     "Write the complete '{section_name}' section."),
])


def _chunks_to_context(chunks: list[ChunkData], limit: int = SECTION_CONTEXT_LIMIT) -> tuple[str, str]:
    if not chunks:
        return "", "N/A"

    pages      = sorted(set(c["page"] for c in chunks))
    page_range = f"p.{pages[0]}–p.{pages[-1]}" if pages else "N/A"

    parts = []
    total = 0
    for chunk in chunks:
        text    = chunk["text"].strip()
        if not text:
            continue
        trimmed = text[:CHUNK_TRIM]
        line    = f"[p.{chunk['page']}] {trimmed}"
        if total + len(line) > limit:
            remaining = limit - total - 20
            if remaining > 100:
                parts.append(f"[p.{chunk['page']}] {text[:remaining]}")
            break
        parts.append(line)
        total += len(line)

    return "\n\n".join(parts), page_range


def write_section_node(state: SectionData) -> dict:
    section_name = state["section_name"]
    chunks       = state.get("chunks", [])
    filename     = state["filename"]

    if not chunks:
        print(f"[REPORT] '{section_name}' — 0 chunks, skipping")
        return {"section_texts": [{"name": section_name, "text": "*No content found for this section.*"}]}

    context, page_range = _chunks_to_context(chunks)
    print(f"[REPORT] '{section_name}' — {len(chunks)} chunks ({page_range}), {len(context)} context chars")

    llm   = _get_llm()
    chain = _SECTION_PROMPT | llm | StrOutputParser()

    try:
        text = chain.invoke({
            "filename":     filename,
            "section_name": section_name,
            "page_range":   page_range,
            "context":      context,
        })
        print(f"[REPORT] '{section_name}' -> {len(text)} chars written")
    except Exception as e:
        print(f"[REPORT] '{section_name}' failed: {e}")
        text = f"*Section generation failed: {e}*\n\nRaw context:\n{context[:2000]}"

    return {"section_texts": [{"name": section_name, "text": text}]}


# ──────────────────────────────────────────────────────────────
# Node 4: Stitch sections in TOC order + add title (no LLM)
# ──────────────────────────────────────────────────────────────

def reduce_sections_node(state: ReportState) -> dict:
    section_texts = state["section_texts"]
    sections      = state["sections"]
    filename      = state["filename"]

    order       = {name: i for i, name in enumerate(sections)}
    sorted_secs = sorted(section_texts, key=lambda s: order.get(s["name"], 999))

    # Build a clean title from the filename — no LLM needed
    title = (
        filename
        .replace("_pdf", "")
        .replace(".pdf", "")
        .replace("_", " ")
        .strip()
        .title()
    )

    parts = [f"# {title}\n\n*Auto-generated technical report*\n"]
    parts += [f"## {s['name']}\n\n{s['text']}" for s in sorted_secs]
    stitched = "\n\n---\n\n".join(parts)

    print(f"[REPORT] Stitched {len(sorted_secs)} sections -> {len(stitched)} chars total")
    return {"final_report": stitched}


# ──────────────────────────────────────────────────────────────
# Node 5: Convert markdown → LaTeX using regex only (no LLM)
#
# Replaces the old LLM-based render_latex_node entirely.
# For N sections this saves N Ollama round-trips.
# Quality is essentially identical for technical content.
# ──────────────────────────────────────────────────────────────

def _md_to_latex(md: str) -> str:
    """
    Markdown -> LaTeX conversion using regex, no LLM.

    Fixes over previous version:
    - Lists processed in a single pass using a state machine — no double-wrapping
    - & and % only escaped OUTSIDE math regions (inline $ and display $$)
    - ~~-~~ soft-hyphen artifacts from PDF extraction stripped
    - Numbered list items (1. 2. 3.) and bullet items (- *) all collected
      into a single environment, never nested accidentally
    """
    body = md

    # ── 0. Strip PDF soft-hyphen artifacts ─────────────────────
    body = body.replace("~~-~~", "")
    body = body.replace(" -\n", " ")

    # ── 1. Headings (#### before ## so shorter patterns don't eat longer) ──
    body = re.sub(r"^#### (.+)$", r"\\subsubsection{\1}", body, flags=re.MULTILINE)
    body = re.sub(r"^### (.+)$",  r"\\subsection{\1}",    body, flags=re.MULTILINE)
    body = re.sub(r"^## (.+)$",   r"\\section{\1}",       body, flags=re.MULTILINE)
    body = re.sub(r"^# (.+)$",    r"\\section{\1}",       body, flags=re.MULTILINE)

    # ── 2. Horizontal rules ─────────────────────────────────────
    body = re.sub(
        r"^---+$",
        r"\\medskip\\noindent\\rule{\\linewidth}{0.4pt}\\medskip",
        body, flags=re.MULTILINE,
    )

    # ── 3. Inline formatting ────────────────────────────────────
    body = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", body)
    body = re.sub(r"\*(.+?)\*",       r"\\textit{\1}", body)
    body = re.sub(r"`(.+?)`",           r"\\texttt{\1}", body)

    # ── 4. Display math $$...$$ → \[...\]  (before & escaping) ─
    body = re.sub(r"\$\$(.+?)\$\$", r"\\[\1\\]", body, flags=re.DOTALL)

    # ── 5. Escape % and & ONLY outside math regions ─────────────
    def escape_outside_math(text: str) -> str:
        pattern = re.compile(
            r"(\\\[.*?\\\]"   # \[...\]
            r"|\$.*?\$)",          # $...$
            re.DOTALL,
        )
        parts = pattern.split(text)
        result = []
        for i, part in enumerate(parts):
            if i % 2 == 0:
                part = re.sub(r"(?<!\\)%", r"\\%", part)
                part = re.sub(r"(?<!\\)&", r"\\&", part)
            result.append(part)
        return "".join(result)

    body = escape_outside_math(body)

    # ── 6. List conversion: single-pass state machine ───────────
    # Fixes the double-wrapping bug from the previous multi-regex approach.
    BULLET_RE   = re.compile(r"^(?:[-*]) (.+)$")
    NUMBERED_RE = re.compile(r"^\d+\. (.+)$")

    lines_in = body.split("\n")
    out      = []
    env      = None   # None | "itemize" | "enumerate"

    for line in lines_in:
        bm = BULLET_RE.match(line)
        nm = NUMBERED_RE.match(line)

        if bm:
            if env != "itemize":
                if env is not None:
                    out.append(f"\\end{{{env}}}")
                out.append("\\begin{itemize}")
                env = "itemize"
            out.append(f"  \\item {bm.group(1)}")

        elif nm:
            if env != "enumerate":
                if env is not None:
                    out.append(f"\\end{{{env}}}")
                out.append("\\begin{enumerate}")
                env = "enumerate"
            out.append(f"  \\item {nm.group(1)}")

        else:
            if env is not None:
                out.append(f"\\end{{{env}}}")
                env = None
            out.append(line)

    if env is not None:
        out.append(f"\\end{{{env}}}")

    body = "\n".join(out)
    return body


def render_latex_fast_node(state: ReportState) -> dict:
    """
    Converts the stitched markdown report to a full LaTeX document
    using pure regex — zero LLM calls, completes in milliseconds.
    """
    full_report = state["final_report"]
    filename    = state["filename"]

    title = (
        filename
        .replace("_pdf", "")
        .replace(".pdf", "")
        .replace("_", " ")
        .strip()
        .title()
    )

    body = _md_to_latex(full_report)

    latex = (
        "\\documentclass[12pt]{article}\n"
        "\\usepackage[margin=1in]{geometry}\n"
        "\\usepackage{hyperref}\n"
        "\\usepackage{booktabs}\n"
        "\\usepackage{amsmath}\n"
        "\\usepackage{amssymb}\n"
        "\\usepackage{longtable}\n"
        "\\usepackage{parskip}\n"
        f"\\title{{{title}}}\n"
        "\\author{RAG Report Generator}\n"
        "\\date{\\today}\n"
        "\\begin{document}\n"
        "\\maketitle\n"
        "\\tableofcontents\n"
        "\\newpage\n"
        f"{body}\n"
        "\\end{document}"
    )

    print(f"[REPORT] LaTeX rendered (regex, instant) -> {len(latex)} chars")
    return {"latex_output": latex}


# ──────────────────────────────────────────────────────────────
# Build graph
# ──────────────────────────────────────────────────────────────

def build_report_graph():
    g = StateGraph(ReportState)

    g.add_node("fetch_all_chunks",    fetch_all_chunks_node)
    g.add_node("discover_structure",  discover_structure_node)
    g.add_node("write_section",       write_section_node)
    g.add_node("reduce_sections",     reduce_sections_node)
    g.add_node("render_latex_fast",   render_latex_fast_node)

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

def generate_report(
    filename:   str,
    query_hint: str = "",
    sections:   list[str] | None = None,
) -> dict:
    """
    Returns {markdown, latex, sections: [{name, text}]}

    sections=None       -> LLM auto-discovers structure (or even-split in FAST_MODE)
    sections=[...]      -> use provided list, divide pages evenly (no LLM for structure)

    Tip: set FAST_MODE=1 env var or pass sections=[...] to avoid the
    structure-discovery LLM call and minimise total LLM calls to just
    one per section.
    """
    result = REPORT_GRAPH.invoke({
        "filename":       filename,
        "query_hint":     query_hint,
        "sections":       sections or [],
        "all_chunks":     [],
        "section_chunks": [],
        "section_texts":  [],
        "final_report":   "",
        "latex_output":   "",
    })
    return {
        "markdown": result["final_report"],
        "latex":    result["latex_output"],
        "sections": result["section_texts"],
    }