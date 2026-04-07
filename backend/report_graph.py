"""
report_graph.py  -- Direct LaTeX output, large-context optimised, Overleaf-Ready
"""

from __future__ import annotations

import os
import re
import time
import threading
from typing import TypedDict, Annotated
import operator

from langchain_core.messages import SystemMessage
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from langchain_ollama import ChatOllama
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
        print(f"[REPORT] Loaded {len(chunks)} chunks, pages {chunks[0]['page']}--{chunks[-1]['page']}")
    return chunks

def fetch_all_chunks_node(state: ReportState) -> dict:
    return {"all_chunks": _fetch_all_chunks(state["filename"])}

# ──────────────────────────────────────────────────────────────
# Robust multi-strategy heading / TOC scanner
# ──────────────────────────────────────────────────────────────

_KEYWORD_HEADING_RE = re.compile(
    r"^(?:chapter|unit|part|module|section)\s+[\dIVXivx]+[:\.\-\s].+",
    re.IGNORECASE,
)
_NUMBERED_HEADING_RE = re.compile(
    r"^(\d{1,2})(?:\.(\d{1,2}))?\s*[\.\:\-]?\s+([A-Z][^\n]{2,60})$"
)
_ALLCAPS_RE = re.compile(r"^[A-Z][A-Z\s\-/&,]{4,60}$")
_TITLECASE_RE = re.compile(r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,8})$")
_TOC_LINE_DOTTED_RE = re.compile(
    r"^(?:(\d{1,2})[\.\s]+)?([A-Z][^\n]{3,60}?)\s*\.{2,}\s*(\d+)\s*$"
)
_TOC_LINE_SPACED_RE = re.compile(
    r"^(?:(\d{1,2})[\.\s]+)?([A-Z][^\n]{3,60}?)\s{3,}(\d+)\s*$"
)


def _is_toc_page(text: str) -> bool:
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    if not lines:
        return False
    first_lower = lines[0].lower()
    has_toc_header = any(k in first_lower for k in ["contents", "table of content"])
    matches = sum(
        1 for l in lines
        if _TOC_LINE_DOTTED_RE.match(l) or _TOC_LINE_SPACED_RE.match(l)
    )
    return has_toc_header or (len(lines) >= 3 and matches / len(lines) >= 0.4)


def _parse_toc_page(text: str, total_pages: int) -> list[tuple[int, str]]:
    entries: list[tuple[int, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for pattern in (_TOC_LINE_DOTTED_RE, _TOC_LINE_SPACED_RE):
            m = pattern.match(line)
            if m:
                title = m.group(2).strip().rstrip(".")
                try:
                    page = int(m.group(3))
                except (ValueError, TypeError):
                    continue
                if 1 <= page <= total_pages and len(title) >= 3:
                    if not _SKIP_SECTION_PATTERNS.match(title):
                        entries.append((page, title))
                break

    seen: set[int] = set()
    result = []
    for page, title in sorted(entries, key=lambda x: x[0]):
        if page not in seen:
            seen.add(page)
            result.append((page, title))
    return result


def _scan_headings(chunks: list[ChunkData]) -> list[tuple[int, str]]:
    if not chunks:
        return []

    total_pages = max(c["page"] for c in chunks)

    toc_scan_limit = max(5, int(total_pages * 0.15))
    pages_text: dict[int, str] = {}
    for c in chunks:
        if c["page"] <= toc_scan_limit:
            pages_text.setdefault(c["page"], "")
            pages_text[c["page"]] += "\n" + c["text"]

    for page_num in sorted(pages_text.keys()):
        if _is_toc_page(pages_text[page_num]):
            entries = _parse_toc_page(pages_text[page_num], total_pages)
            if len(entries) >= 3:
                print(f"[REPORT] TOC found on page {page_num} -> {len(entries)} entries")
                return entries
            print(f"[REPORT] Possible TOC on page {page_num} but only {len(entries)} entries -- continuing scan")

    print("[REPORT] No explicit TOC -- scanning content for inline headings")

    keyword_hits:   list[tuple[int, str]] = []
    numbered_hits:  list[tuple[int, str]] = []
    allcaps_hits:   list[tuple[int, str]] = []
    titlecase_hits: list[tuple[int, str]] = []
    seen_pages: set[int] = set()

    for chunk in chunks:
        page  = chunk["page"]
        lines = [l.strip() for l in chunk["text"].strip().splitlines() if l.strip()]
        if not lines:
            continue

        for line in lines[:5]:
            clean = re.sub(r"[\s\.]+\d+\s*$", "", line).strip()
            if len(clean) < 3 or len(clean) > 80:
                continue

            if _KEYWORD_HEADING_RE.match(clean) and page not in seen_pages:
                keyword_hits.append((page, clean))
                seen_pages.add(page)
                break

            if _NUMBERED_HEADING_RE.match(clean) and page not in seen_pages:
                numbered_hits.append((page, clean))
                seen_pages.add(page)
                break

        if page not in seen_pages:
            first = lines[0].strip()
            clean = re.sub(r"[\s\.]+\d+\s*$", "", first).strip()
            if _ALLCAPS_RE.match(clean):
                allcaps_hits.append((page, clean))
                seen_pages.add(page)
            elif _TITLECASE_RE.match(clean) and 10 <= len(clean) <= 60:
                titlecase_hits.append((page, clean))
                seen_pages.add(page)

    for strategy, hits in [
        ("keyword",   keyword_hits),
        ("numbered",  numbered_hits),
        ("allcaps",   allcaps_hits),
        ("titlecase", titlecase_hits),
    ]:
        if len(hits) >= 2:
            print(f"[REPORT] '{strategy}' strategy -> {len(hits)} headings found")
            return sorted(hits, key=lambda x: x[0])

    print("[REPORT] No reliable headings found in any strategy")
    return []

# ──────────────────────────────────────────────────────────────
# Smart structure discovery
# ──────────────────────────────────────────────────────────────

_TOC_ENTRY_RE = re.compile(
    r"^(?:chapter|unit|part|module|section)\s+(\d+|[ivxlIVXL]+)[:\.\s]+(.+?)(?:\s+\*{0,2}\d+\*{0,2})?$",
    re.IGNORECASE,
)


def _extract_chapter_key(title: str) -> str | None:
    clean = re.sub(r"\s*\*{0,2}\d+\*{0,2}\s*$", "", title).strip()
    m = _TOC_ENTRY_RE.match(clean)
    if m:
        num    = m.group(1)
        label  = m.group(2).strip().strip("*").strip()
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
        raw_headings = _scan_headings(chunks)

        if len(raw_headings) >= 2:
            section_ranges = _group_headings_into_chapters(raw_headings, total_pages)
        else:
            print(f"[REPORT] No structure found -- falling back to even partition")
            section_ranges = _even_partition(total_pages, DEFAULT_SECTIONS)

    section_ranges = [
        (s, e, n) for s, e, n in section_ranges
        if not _SKIP_SECTION_PATTERNS.match(n.strip())
    ]

    section_chunks_map = []
    for start, end, name in section_ranges:
        sec_chunks = [c for c in chunks if start <= c["page"] <= end]
        section_chunks_map.append({"name": name, "chunks": sec_chunks, "start": start, "end": end})
        print(f"[REPORT] '{name}' (p.{start}--{end}) -> {len(sec_chunks)} chunks")

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
# System prompt
# KEY DESIGN: "RULE ZERO" at the very top so the LLM sees it first.
# Moving-argument rules are repeated twice — at top and bottom.
# ──────────────────────────────────────────────────────────────
_SYSTEM_TEXT = r"""You are an expert LaTeX typesetter. Your ONLY job is to emit valid LaTeX
body content for a pdflatex-compiled article-class document hosted on Overleaf.
 
NO preamble. NO \documentclass. NO \begin{document}. NO \usepackage.
NO \maketitle. NO \tableofcontents. NO \end{document}.
Output ONLY the body content that goes INSIDE an existing document.
No Markdown. No explanation. No apologies. When in doubt write plain text.
 
════════════════════════════════════════════════════════════════
PART 1 — THE 10 LATEX RESERVED CHARACTERS (escape in ALL text)
════════════════════════════════════════════════════════════════
 
Outside math mode, ALWAYS escape these with a backslash:
 
  %  ->  \%              (raw % silently kills rest of line as comment)
  $  ->  \$              (raw $ opens math mode)
  &  ->  \&              (raw & is table column separator)
  #  ->  \#              (raw # is macro parameter)
  _  ->  \_              (raw _ is math subscript — MOST COMMON LLM ERROR)
  ^  ->  \^{}            (raw ^ is math superscript)
  {  ->  \{              (raw { opens a group)
  }  ->  \}              (raw } closes a group)
  ~  ->  \textasciitilde{}  (raw ~ is non-breaking space)
  \  ->  \textbackslash{}   (raw \\ is a line-break, NOT a backslash!)
 
Wrong vs Right examples:
  50% discount        ->  50\% discount
  price is $50        ->  price is \$50
  AT&T                ->  AT\&T
  file_name.py        ->  file\_name.py  OR  \texttt{file\_name.py}
  item #3             ->  item \#3
  {key: value}        ->  \{key: value\}
  2^10 in text        ->  $2^{10}$
  path\to\file        ->  path\textbackslash{}to\textbackslash{}file
 
════════════════════════════════════════════════════════════════
PART 2 — UNICODE CHARACTERS (convert ALL — pdflatex cannot handle them)
════════════════════════════════════════════════════════════════
 
Any raw Unicode not declared in preamble causes:
  "Unicode character U+XXXX not set up for use with LaTeX"
 
ARROWS & BULLETS
  ▶  ->  $\blacktriangleright$     ◀  ->  $\blacktriangleleft$
  ▲  ->  $\blacktriangle$          ▼  ->  $\blacktriangledown$
  →  ->  $\rightarrow$             ←  ->  $\leftarrow$
  ↑  ->  $\uparrow$                ↓  ->  $\downarrow$
  ↔  ->  $\leftrightarrow$         ⇒  ->  $\Rightarrow$
  ⇐  ->  $\Leftarrow$              ⇔  ->  $\Leftrightarrow$
  •  ->  \textbullet{}             ·  ->  \textperiodcentered{}
  ★  ->  $\star$
 
DASHES & SPACES
  -   ->  -          (hyphen, keep as-is)
  –   ->  --         (en-dash, e.g. pages 10--20)
  —   ->  ---        (em-dash, e.g. text---more text)
  non-breaking space U+00A0   ->  ~
  narrow no-break space U+202F ->  ~
  em space U+2003              ->  \quad
  thin space U+2009            ->  \,
 
QUOTES — NEVER use Unicode curly quotes, they break compilation
  '  (U+2018) ->  `       (opening single quote)
  '  (U+2019) ->  '       (closing single quote / apostrophe)
  "  (U+201C) ->  ``      (opening double quote)
  "  (U+201D) ->  ''      (closing double quote)
 
MATH SYMBOLS
  ×  ->  $\times$      ÷  ->  $\div$       ±  ->  $\pm$
  ≤  ->  $\leq$        ≥  ->  $\geq$       ≠  ->  $\neq$
  ≈  ->  $\approx$     ≡  ->  $\equiv$     ∞  ->  $\infty$
  ∑  ->  $\sum$        ∏  ->  $\prod$      ∫  ->  $\int$
  ∂  ->  $\partial$    √  ->  $\sqrt{}$    ∝  ->  $\propto$
  ∈  ->  $\in$         ∉  ->  $\notin$     ∅  ->  $\emptyset$
  ∩  ->  $\cap$        ∪  ->  $\cup$       ∇  ->  $\nabla$
  ⊥  ->  $\perp$       ∥  ->  $\parallel$
  ℝ  ->  $\mathbb{R}$  ℕ  ->  $\mathbb{N}$  ℤ  ->  $\mathbb{Z}$
 
GREEK LETTERS — always wrap in $ $
  α->$\alpha$   β->$\beta$    γ->$\gamma$   δ->$\delta$   ε->$\epsilon$
  θ->$\theta$   λ->$\lambda$  μ->$\mu$      π->$\pi$      σ->$\sigma$
  τ->$\tau$     φ->$\phi$     χ->$\chi$     ψ->$\psi$     ω->$\omega$
  Γ->$\Gamma$   Δ->$\Delta$   Λ->$\Lambda$  Σ->$\Sigma$   Ω->$\Omega$
 
ACCENTED LATIN — use LaTeX accent commands
  e-acute  ->  \'e       e-grave  ->  \`e       e-circ   ->  \^e
  e-umlaut ->  \"e       n-tilde  ->  \~n       u-umlaut ->  \"u
  a-umlaut ->  \"a       c-cedil  ->  \c{c}     eszett   ->  \ss{}
 
OTHER SYMBOLS
  …  ->  \ldots{}           ©  ->  \textcopyright{}
  ®  ->  \textregistered{}  ™  ->  \texttrademark{}
  °  ->  $^\circ$           §  ->  \S{}     ¶  ->  \P{}
  £  ->  \textsterling{}    €  ->  \texteuro{}
  ½  ->  $\frac{1}{2}$      ²  ->  $^2$      ³  ->  $^3$
  µ  ->  $\mu$              |  ->  \textbar{}
  ‖  ->  $\|$  (ONLY inside math mode)
 
════════════════════════════════════════════════════════════════
PART 3 — MATH MODE RULES
════════════════════════════════════════════════════════════════
 
Inline:   $E = mc^2$   or   \(E = mc^2\)
Display:  \[ E = mc^2 \]           <- preferred, always use this
Numbered: \begin{equation} E=mc^2 \end{equation}
 
NEVER use $$ ... $$ — deprecated, causes spacing bugs in pdflatex.
 
Inside math: _ ^ & are allowed without escaping.
Outside math: _ ^ & MUST be escaped.
 
Every opening $ MUST have a closing $. Never leave math mode open.
 
Useful math constructs:
  Fraction:    $\frac{a}{b}$
  Square root: $\sqrt{x}$
  Nth root:    $\sqrt[n]{x}$
  Subscript:   $a_{bc}$          (braces required if more than 1 char)
  Superscript: $a^{bc}$
  Sum:         $\sum_{i=0}^{n} i$
  Integral:    $\int_{0}^{1} f(x)\,dx$
  Limit:       $\lim_{x \to 0} f(x)$
  Matrix:      \begin{pmatrix} a & b \\ c & d \end{pmatrix}
  Aligned equations (amsmath already loaded):
    \begin{align}
      x &= a + b \\
      y &= c + d
    \end{align}
 
════════════════════════════════════════════════════════════════
PART 4 — DOCUMENT STRUCTURE (article class ONLY)
════════════════════════════════════════════════════════════════
 
ALLOWED structuring commands:
  \section{Title}
  \subsection{Title}
  \subsubsection{Title}
  \paragraph{Title}
  \subparagraph{Title}
  Starred unnumbered versions: \section*{Title}  \subsection*{Title}
 
FORBIDDEN — causes "Undefined control sequence" fatal error:
  \chapter{}     <- book/report class only, NOT article
  \part{}        <- book/report class only, NOT article
  \frontmatter   <- book class only
  \mainmatter    <- book class only
  \backmatter    <- book class only
 
Paragraph rules:
  New paragraph  = blank line between text blocks
  Line break     = \\  or  \newline  (stays in same paragraph)
  Vertical space = \vspace{1em}  (do NOT stack multiple \\)
  NEVER put a blank line inside \caption{} or \footnote{} — fatal error!
 
════════════════════════════════════════════════════════════════
PART 5 — TEXT FORMATTING
════════════════════════════════════════════════════════════════
 
  \textbf{text}              bold
  \textit{text}              italic
  \textbf{\textit{text}}     bold-italic
  \underline{text}           underline
  \emph{text}                emphasis (auto-reverses inside italic)
  \texttt{text}              monospace / code  <- ALWAYS use this, NEVER \verb
  \textsc{text}              small caps
  \textsf{text}              sans-serif
  {\large text}              larger text
  {\small text}              smaller text
  \textcolor{red}{text}      coloured text (xcolor already loaded)
 
\verb IS COMPLETELY BANNED — it causes errors in many contexts:
  WRONG: \verb|myfile.py|
  WRONG: \verb+some code+
  WRONG: \verb!text!
  RIGHT: \texttt{myfile.py}
 
Inside \texttt{} you STILL must escape the 10 reserved chars:
  \texttt{file\_name.py}
  \texttt{\$50}
  \texttt{100\%}
  \texttt{key\&value}
 
Quotes — NEVER use Unicode curly quotes:
  Opening double quote:  ``   (two backticks)
  Closing double quote:  ''   (two apostrophes)
  Opening single quote:  `
  Closing single quote:  '
 
NEVER place '' or "" immediately after \texttt{...}:
  WRONG: \texttt{foo}'' bar
  RIGHT: \texttt{foo} bar
 
════════════════════════════════════════════════════════════════
PART 6 — LISTS
════════════════════════════════════════════════════════════════
 
Unordered (bullet) list:
  \begin{itemize}
    \item First item
    \item Second item
    \item Third item
  \end{itemize}
 
Ordered (numbered) list:
  \begin{enumerate}
    \item First step
    \item Second step
    \item Third step
  \end{enumerate}
 
Description list:
  \begin{description}
    \item[Term one] Definition of term one.
    \item[Term two] Definition of term two.
  \end{description}
 
Nested list:
  \begin{itemize}
    \item Outer item
    \begin{itemize}
      \item Inner item
    \end{itemize}
  \end{itemize}
 
List rules:
  Every entry MUST start with \item
  No blank line between \begin{itemize} and the first \item
  No blank lines between \item entries
 
════════════════════════════════════════════════════════════════
PART 7 — TABLES
════════════════════════════════════════════════════════════════
 
Standard table:
  \begin{table}[h!]
  \centering
  \begin{tabular}{|l|c|r|}
    \hline
    Left col & Centre col & Right col \\
    \hline
    cell1    & cell2      & cell3     \\
    cell4    & cell5      & cell6     \\
    \hline
  \end{tabular}
  \caption{Your caption here.}
  \label{tab:yourlabel}
  \end{table}
 
Column alignment specifiers:
  l = left aligned
  c = centre aligned
  r = right aligned
  | = single vertical line
  || = double vertical line
  p{3cm} = fixed width column with text wrapping
 
Row rules:
  \hline         = single horizontal line
  \hline\hline   = double horizontal line
  \cline{2-4}   = partial line across columns 2 to 4
 
Every table row that is NOT the last row ends with \\
Cells are separated by &
Number of & per row = number of columns minus 1
ALL special characters inside cells must be escaped (\%, \$, \&, \_, \# etc.)
No blank lines inside a tabular environment
NEVER use & outside tabular/array/align environment — fatal error
 
Professional booktabs style (package already loaded):
  \begin{tabular}{lll}
    \toprule
    Col1 & Col2 & Col3 \\
    \midrule
    val1 & val2 & val3 \\
    val4 & val5 & val6 \\
    \bottomrule
  \end{tabular}
 
════════════════════════════════════════════════════════════════
PART 8 — FIGURES
════════════════════════════════════════════════════════════════
 
  \begin{figure}[h]
    \centering
    \includegraphics[width=0.75\textwidth]{imagename}
    \caption{A descriptive caption.}
    \label{fig:yourlabel}
  \end{figure}
 
Float placement options:
  h = here (approximately)
  t = top of page
  b = bottom of page
  p = separate float page
  ! = override LaTeX restrictions
  H = exactly here (requires float package)
 
Do NOT overuse [H] placement — it can cause compile timeout infinite loops.
 
════════════════════════════════════════════════════════════════
PART 9 — CROSS-REFERENCES AND LABELS
════════════════════════════════════════════════════════════════
 
  \label{sec:intro}       place right after \section{}
  \ref{sec:intro}         reference a section, figure, or table
  \pageref{sec:intro}     reference a page number
  \eqref{eq:einstein}     reference an equation (amsmath)
 
Label naming rules:
  Labels must be unique — duplicates cause "Label XXX multiply defined"
  Use only letters, digits, colon, hyphen, underscore in label names
  Best practice prefixes:  sec:  fig:  tab:  eq:  lst:
 
════════════════════════════════════════════════════════════════
PART 10 — EVERY FATAL ERROR AND HOW TO AVOID IT
════════════════════════════════════════════════════════════════
 
"Undefined control sequence"
  Cause: typo in command name; \chapter in article class; \verb used;
         \| used outside math as a visual separator
  Fix:   correct spelling; use \section not \chapter;
         use \texttt not \verb; use -- or : instead of \|
 
"Missing $ inserted"
  Cause: raw _ or ^ or math symbol used outside math mode
  Fix:   wrap in $...$  or escape: \_
 
"Extra alignment tab has been changed to \cr"
  Cause: too many & in a table row, or & used outside table/align
  Fix:   count carefully — need exactly (columns - 1) & per row
 
"Runaway argument"
  Cause: missing closing } brace for a command
         OR blank line inside \caption{} or \footnote{}
  Fix:   balance every { with }; remove blank lines from captions
 
"File ended while scanning use of..."
  Cause: \begin{X} with no matching \end{X}
  Fix:   close every environment you open
 
"Unicode character U+XXXX not set up for use with LaTeX"
  Cause: raw Unicode character in the output (▶ -- — ' " × α ° etc.)
  Fix:   convert using the table in Part 2
 
"LaTeX Error: \verb ended by end of line"
  Cause: \verb used anywhere in the document
  Fix:   replace every \verb with \texttt{}
 
"Missing \endcsname inserted"
  Cause: unbalanced braces inside a command argument
  Fix:   count { and } — they must match inside every command
 
"No positions in optional float specifier"
  Cause: invalid float placement option e.g. \begin{figure}[x]
  Fix:   use only h t b p ! H
 
"Label XXX multiply defined"
  Cause: same \label{} name used more than once
  Fix:   make every label unique across the document
 
"Double subscript" or "Double superscript"
  Cause: $a_b_c$ or $a^b^c$
  Fix:   use braces: $a_{bc}$ or $a^{b^c}$
 
"\| illegal in text mode"
  Cause: \| used outside math as a visual separator
  Fix:   replace with -- or : or plain descriptive text
 
"Option clash for package"
  Cause: same package loaded twice with different options
  Fix:   do not output any \usepackage commands (preamble is external)
 
Blank line inside \title{} \author{} \date{} causes compile timeout
  Fix:   no blank lines inside these commands
 
Too many [H] float placements causes infinite loop and timeout
  Fix:   use [h!] or [htbp] instead
 
════════════════════════════════════════════════════════════════
PART 11 — ALLOWED vs FORBIDDEN QUICK REFERENCE
════════════════════════════════════════════════════════════════
 
  ALLOWED                        FORBIDDEN and replacement
  ─────────────────────────────  ──────────────────────────────────────
  \section{}                     \chapter{}  -> use \section
  \subsection{}                  \part{}     -> use \section
  \subsubsection{}               \frontmatter \mainmatter \backmatter
  \paragraph{}                   \verb|...|  -> use \texttt{}
  \texttt{}                      Raw Unicode -> convert per Part 2
  \textbf{}  \textit{}           Raw _ outside $ -> escape as \_
  \emph{}  \underline{}          Raw & outside table -> escape as \&
  \textbackslash{}               Raw % in text -> escape as \%
  \textasciitilde{}              Raw $ in text -> escape as \$
  \textasciicircum{}             Raw # in text -> escape as \#
  \textless{} \textgreater{}     Raw < > in text -> use \textless \textgreater
  \textbar{}                     \| in text mode -> use \textbar{}
  $\blacktriangleright$          ▶ symbol -> $\blacktriangleright$
  \ldots{}                       ... ellipsis -> \ldots{}
  -- (en-dash)                   -- Unicode en-dash character
  --- (em-dash)                  --- Unicode em-dash character
  `` and '' for quotes           Unicode curly quotes " " ' '
  \begin{itemize}                Markdown bullet points - or *
  \begin{enumerate}              Markdown numbered lists 1. 2.
  \begin{tabular}                Markdown pipe tables
  \[ ... \]                      $$ ... $$ deprecated display math
  \hline \toprule \midrule       (no equivalent, always use these)
 
════════════════════════════════════════════════════════════════
PART 12 — PRE-OUTPUT CHECKLIST (mentally run this on every line)
════════════════════════════════════════════════════════════════
 
1.  Any _ % $ & # { } ~ ^ \ outside math or LaTeX commands?   -> Escape them.
2.  Any non-ASCII or Unicode character?                        -> Convert per Part 2.
3.  Any \verb in any form whatsoever?                          -> Replace with \texttt{}.
4.  Any \chapter, \part, \frontmatter, \mainmatter?            -> Replace with \section.
5.  Any \|, $$, Unicode dashes, Unicode curly quotes?          -> Fix them.
6.  Every \begin{X} matched by a \end{X}?                      -> Verify.
7.  Every { matched by a }?                                    -> Count them.
8.  Every $ in inline math paired with a closing $?            -> Count them.
9.  Every table row has exactly (columns - 1) & separators?    -> Count them.
10. Any \documentclass \usepackage \begin{document}
    \maketitle \tableofcontents \end{document} in output?      -> Delete them.
 
If any check fails: FIX IT before writing that line.
When truly unsure about a LaTeX construct: write plain prose.
Plain text NEVER breaks LaTeX compilation.
"""

_SECTION_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(content=_SYSTEM_TEXT),
    HumanMessagePromptTemplate.from_template(
        "Document: {filename}\n"
        "Section: {section_name}\n"
        "Pages: {page_range}\n\n"
        "Context:\n{context}\n\n"
        "don't loss any information from the context and use it to write the section content in latex format. "
        "make the heading left arangemnt not center "
        "explain each and every section in detail and also format the genrating style it well"
        "Write a complete, well-structured LaTeX section body covering all the "
        "content above. Use \\subsection, \\subsubsection, itemize/enumerate "
        "lists, tables, and math environments where appropriate.\n\n"
        "CRITICAL REMINDERS:\n"
        "1. \\caption{{}} and \\section{{}} MUST contain plain text ONLY.\n"
        "   NO \\textbf, \\textit, \\texttt, \\emph, math, \\cite, \\ref inside them.\n"
        "   WRONG: \\caption{{\\textbf{{Results}}}}\n"
        "   RIGHT: \\caption{{Results of the experiment}}\n"
        "2. NEVER use \\chapter or \\verb anywhere.\n"
        "3. Escape all special chars outside math: \\_ \\% \\$ \\& \\#\n"
        "4. No raw Unicode -- convert all symbols.\n\n"
        "Output ONLY the LaTeX body -- no preamble, no \\begin{{document}}."
    ),
])

# ──────────────────────────────────────────────────────────────
# Section writer
# ──────────────────────────────────────────────────────────────

def write_section_node(state: SectionData) -> dict:
    section_name = state["section_name"]
    chunks       = state.get("chunks", [])
    filename     = state["filename"]

    if _SKIP_SECTION_PATTERNS.match(section_name.strip()):
        print(f"[REPORT] '{section_name}' -- skipped (back-matter)")
        return {"section_texts": []}

    if not chunks:
        return {"section_texts": [{"name": section_name, "text": r"\textit{No content found.}"}]}

    context, page_range = _chunks_to_context(chunks)
    print(f"[REPORT] '{section_name}' -- {len(chunks)} chunks ({page_range}), {len(context):,} context chars")

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
                print(f"[REPORT] '{section_name}' -> {len(text):,} chars written")
                break
            except Exception as e:
                err = str(e).lower()
                if ("429" in err or "too many" in err) and attempt < MAX_RETRIES - 1:
                    wait = RETRY_DELAYS[attempt]
                    print(f"[REPORT] Rate limit -- retry in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"[REPORT] '{section_name}' FAILED: {e}")
                text = f"\\textit{{Generation failed: {e}}}"
                break

    return {"section_texts": [{"name": section_name, "text": text or r"\textit{Empty}"}]}

# ──────────────────────────────────────────────────────────────
# Moving-argument sanitizer
# ──────────────────────────────────────────────────────────────
# Root cause of the \protect / Missing \endcsname error:
#   hyperref writes \caption{} and \section{} text into the .aux
#   file. Any fragile command (\textbf, \texttt etc.) gets wrapped
#   with \protect. When hyperref converts that to a bookmark string
#   it expands \csname...\endcsname around the protected command
#   which crashes with:
#       ! Missing \endcsname inserted. <to be read again> \protect
#   Fix: strip every fragile command from moving arguments AFTER
#   LLM output is received, before assembly.
# ──────────────────────────────────────────────────────────────

# FIX 1: Allow 1 level of nested braces so \texttt{file\_name} matches
_FRAGILE_ONE_ARG_RE = re.compile(
    r'\\(?:textbf|textit|texttt|emph|underline|textsc|textsf|mbox|hbox)\s*'
    r'\{((?:[^{}]|\{[^{}]*\})*)\}'
)
_FRAGILE_TWO_ARG_RE = re.compile(
    r'\\textcolor\s*\{[^{}]*\}\s*\{([^{}]*)\}'
)
_MATH_IN_MOVING_RE = re.compile(
    r'\$[^$]*\$'
    r'|\\\([^)]*\\\)'
    r'|\\\[[^\]]*\\\]'
)
_CITE_IN_MOVING_RE = re.compile(
    r'\\(?:cite|ref|eqref|pageref|footnote|label)\s*\{[^{}]*\}'
)
_NEWLINE_IN_MOVING_RE = re.compile(r'\\\\|\n')


def _clean_moving_arg(inner: str) -> str:
    """Strip all fragile content from a moving argument (caption / section title)."""
    # Two-arg color command first e.g. \textcolor{red}{word} -> word
    inner = _FRAGILE_TWO_ARG_RE.sub(lambda m: m.group(1), inner)
    # Single-arg formatting commands e.g. \textbf{word} -> word
    # Run 5x to handle nesting: \textbf{\textit{x}} -> \textit{x} -> x
    for _ in range(5):
        inner = _FRAGILE_ONE_ARG_RE.sub(lambda m: m.group(1), inner)
    # Math, citations, footnotes, labels -- drop entirely
    inner = _MATH_IN_MOVING_RE.sub('', inner)
    inner = _CITE_IN_MOVING_RE.sub('', inner)
    # Line breaks inside moving args cause "Runaway argument"
    inner = _NEWLINE_IN_MOVING_RE.sub(' ', inner)
    # Nuclear: kill any remaining \cmd{...} that slipped through
    inner = re.sub(r'\\[a-zA-Z]+\{[^{}]*\}', '', inner)
    # Collapse extra whitespace
    inner = re.sub(r'  +', ' ', inner).strip()
    return inner


# FIX 2: Allow 2 levels of nested braces in caption/section regexes
_CAPTION_RE = re.compile(
    r'\\caption\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}'
)
_SECTION_CMDS_RE = re.compile(
    r'(\\(?:sub){0,2}section\*?\s*)\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}'
)


def _sanitize_moving_arguments(text: str) -> str:
    r"""
    Post-process LLM output to strip fragile commands from every
    \caption{} and \section{}/\subsection{}/\subsubsection{} argument.
    Prevents the hyperref \protect / Missing \endcsname crash.
    """
    def _fix_caption(m: re.Match) -> str:
        return r'\caption{' + _clean_moving_arg(m.group(1)) + '}'

    text = _CAPTION_RE.sub(_fix_caption, text)

    def _fix_section(m: re.Match) -> str:
        cmd   = m.group(1)
        inner = m.group(2)
        return cmd + '{' + _clean_moving_arg(inner) + '}'

    text = _SECTION_CMDS_RE.sub(_fix_section, text)
    return text


# ──────────────────────────────────────────────────────────────
# LaTeX sanitisation -- post-process LLM output before assembly
# ──────────────────────────────────────────────────────────────

def _sanitize_latex_text(text: str) -> str:
    # ── 1. Unicode -> LaTeX equivalents ───────────────────────
    UNICODE_MAP = {
        '\u202F': '~',   '\u00A0': '~',
        '\u2003': ' ',   '\u2002': ' ',   '\u2009': ' ',
        '\u2011': '-',   '\u2010': '-',
        '\u2012': '--',  '\u2013': '--',  '\u2014': '---',
        '\u2018': '`',   '\u2019': "'",
        '\u201C': '``',  '\u201D': "''",
        '\u2026': r'\ldots{}',
        '\u00B7': r'\textperiodcentered{}',
        '\u2022': r'\textbullet{}',
        '\u00D7': r'$\times$',
        '\u00F7': r'$\div$',
        '\u03B1': r'$\alpha$',
        '\u03B2': r'$\beta$',
        '\u03B3': r'$\gamma$',
        '\u03C0': r'$\pi$',
        '\u221E': r'$\infty$',
        '\u2264': r'$\leq$',
        '\u2265': r'$\geq$',
        '\u2260': r'$\neq$',
        '\u25B6': r'$\blacktriangleright$',
        '\u25C0': r'$\blacktriangleleft$',
        '\u25B2': r'$\blacktriangle$',
        '\u25BC': r'$\blacktriangledown$',
        '\u2192': r'$\rightarrow$',
        '\u2190': r'$\leftarrow$',
        '\u2194': r'$\leftrightarrow$',
        '\u21D2': r'$\Rightarrow$',
        '\u21D0': r'$\Leftarrow$',
        '\u21D4': r'$\Leftrightarrow$',
        '\u00B0': r'$^\circ$',
        '\u00A9': r'\textcopyright{}',
        '\u00AE': r'\textregistered{}',
        '\u2122': r'\texttrademark{}',
        '\u00B1': r'$\pm$',
        '\u2248': r'$\approx$',
        '\u2261': r'$\equiv$',
        '\u2202': r'$\partial$',
        '\u2211': r'$\sum$',
        '\u220F': r'$\prod$',
        '\u222B': r'$\int$',
        '\u2207': r'$\nabla$',
        '\u2208': r'$\in$',
        '\u2209': r'$\notin$',
        '\u2205': r'$\emptyset$',
        '\u2229': r'$\cap$',
        '\u222A': r'$\cup$',
        '\u22A5': r'$\perp$',
        '\u03B4': r'$\delta$',
        '\u03B5': r'$\epsilon$',
        '\u03B8': r'$\theta$',
        '\u03BB': r'$\lambda$',
        '\u03BC': r'$\mu$',
        '\u03C3': r'$\sigma$',
        '\u03C4': r'$\tau$',
        '\u03C6': r'$\phi$',
        '\u03C8': r'$\psi$',
        '\u03C9': r'$\omega$',
        '\u0393': r'$\Gamma$',
        '\u0394': r'$\Delta$',
        '\u039B': r'$\Lambda$',
        '\u03A3': r'$\Sigma$',
        '\u03A9': r'$\Omega$',
    }
    for u, r in UNICODE_MAP.items():
        text = text.replace(u, r)

    # ── 2. Kill ALL \verb variants -> \texttt{} ───────────────
    def _verb_to_texttt(m):
        content = m.group(2)
        content = content.replace('_', r'\_')
        content = content.replace('{', r'\{')
        content = content.replace('}', r'\}')
        content = content.replace('&', r'\&')
        content = content.replace('%', r'\%')
        content = content.replace('#', r'\#')
        content = content.replace('$', r'\$')
        return r'\texttt{' + content + '}'

    text = re.sub(r'\\verb([^a-zA-Z\s])(.*?)\1', _verb_to_texttt, text, flags=re.DOTALL)
    if r'\verb' in text:
        text = re.sub(r'\\verb[^\\{}\s]*', '', text)

    # ── 3. Fix \| used outside math as separator ──────────────
    text = re.sub(r'\s*\\_\\\|\\_\s*', ' -- ', text)
    text = re.sub(r'(?<!\\)\\\|', ' ', text)

    # ── 4. Convert article-incompatible structure commands ────
    text = re.sub(r'\\chapter\*?\s*\{',      r'\\section{',       text)
    text = re.sub(r'\\part\*?\s*\{',         r'\\section{',       text)
    text = re.sub(r'\\subparagraph\*?\s*\{', r'\\subsubsection{', text)
    text = re.sub(r'\\(frontmatter|mainmatter|backmatter)\b', '', text)

    # ── 5. Helper: apply fn only outside opaque LaTeX blocks ──
    _OPAQUE_RE = re.compile(
        r'(\$\$.*?\$\$'
        r'|\$[^$\n]*?\$'
        r'|\\[\(\[].*?\\[\)\]]'
        r'|\\texttt\{[^{}]*\}'
        r'|\\begin\{[^}]+\}.*?\\end\{[^}]+\}'
        r')',
        re.DOTALL,
    )

    def _process_outside_opaque(s, fn):
        result, last = [], 0
        for m in _OPAQUE_RE.finditer(s):
            result.append(fn(s[last:m.start()]))
            result.append(m.group(0))
            last = m.end()
        result.append(fn(s[last:]))
        return ''.join(result)

    # ── 6. Escape underscores outside opaque blocks ───────────
    text = _process_outside_opaque(
        text,
        lambda chunk: re.sub(r'(?<!\\)_', r'\\_', chunk),
    )

    # ── 7. Escape stray & % # outside opaque blocks ───────────
    for char, escaped in [('&', r'\&'), ('%', r'\%'), ('#', r'\#')]:
        text = _process_outside_opaque(
            text,
            lambda chunk, c=char, e=escaped: re.sub(r'(?<!\\)' + re.escape(c), e, chunk),
        )

    # ── 8. Fix stray quotes after \texttt{...} ────────────────
    text = re.sub(r"(\\texttt\{[^{}]*\})\s*['\u2019\u201d\"]{1,2}", r'\1', text)

    # ── 9. Fix unbalanced $ signs ─────────────────────────────
    dollar_count = len(re.findall(r'(?<!\\)\$', text))
    if dollar_count % 2 != 0:
        text += '$'

    # ── 10. Strip fragile commands from all moving arguments ──
    #   MUST run last -- after underscore/special char escaping --
    #   so the cleaned caption text is already properly escaped.
    text = _sanitize_moving_arguments(text)

    return text


def _escape_latex_title(text: str) -> str:
    r"""Escape the five characters that break \title{} / \section{} plain text."""
    for char, rep in [("&", "\\&"), ("%", "\\%"), ("#", "\\#"), ("$", "\\$"), ("_", "\\_")]:
        text = text.replace(char, rep)
    return text


def _safe_section_name(name: str) -> str:
    r"""
    Produce a plain-text section name safe for \section{} moving arguments.
    1. Escape reserved chars.
    2. Strip any residual fragile commands (defensive).
    """
    name = _escape_latex_title(name)
    name = _clean_moving_arg(name)
    return name

# ──────────────────────────────────────────────────────────────
# Reduce -- stitch LaTeX sections into a complete document
# ──────────────────────────────────────────────────────────────

def reduce_sections_node(state: ReportState) -> dict:
    section_texts = state["section_texts"]
    sections      = state["sections"]
    filename      = state["filename"]

    order       = {name: i for i, name in enumerate(sections)}
    valid       = [
        s for s in section_texts
        if s.get("text") and r"\textit{No content" not in s["text"]
    ]
    sorted_secs = sorted(valid, key=lambda s: order.get(s["name"], 999))

    raw_title = (
        filename.replace("_pdf", "").replace(".pdf", "")
        .replace("_", " ").strip().title()
    )
    title = _escape_latex_title(raw_title)

    print(f"[REPORT] Assembling {len(sorted_secs)} sections into final LaTeX document...")

    section_blocks: list[str] = []
    for s in sorted_secs:
        sec_name = _safe_section_name(s["name"])
        sec_body = _sanitize_latex_text(s["text"].strip())
        section_blocks.append(f"\\section{{{sec_name}}}\n\n{sec_body}")

    body = "\n\n".join(section_blocks)

    latex = (
        "\\documentclass[12pt]{article}\n"
        "\\usepackage[utf8]{inputenc}\n"
        "\\usepackage[T1]{fontenc}\n"
        "\\usepackage{textcomp}\n"
        "\\usepackage{caption}\n"
        "\\usepackage[margin=1in]{geometry}\n"
        "\\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue,bookmarksopen=true]{hyperref}\n"
        "\\usepackage{booktabs,array,longtable}\n"
        "\\usepackage{amsmath,amssymb}\n"
        "\\usepackage{listings}\n"
        "\\usepackage{parskip,xcolor,enumitem}\n"
        "\\setlist{noitemsep, topsep=4pt}\n"
        "\\renewcommand{\\arraystretch}{1.3}\n\n"
        "% Unicode fallbacks\n"
        "\\DeclareUnicodeCharacter{202F}{~}\n"
        "\\DeclareUnicodeCharacter{00A0}{~}\n"
        "\\DeclareUnicodeCharacter{2003}{\\space}\n"
        "\\DeclareUnicodeCharacter{2002}{\\space}\n"
        "\\DeclareUnicodeCharacter{2009}{\\space}\n\n"
        "% Belt-and-suspenders: disable fragile commands in PDF bookmarks.\n"
        "% Catches anything the Python sanitizer misses.\n"
        "\\pdfstringdefDisableCommands{%\n"
        "  \\def\\texttt#1{#1}%\n"
        "  \\def\\textbf#1{#1}%\n"
        "  \\def\\textit#1{#1}%\n"
        "  \\def\\emph#1{#1}%\n"
        "  \\def\\underline#1{#1}%\n"
        "  \\def\\textsc#1{#1}%\n"
        "  \\def\\textsf#1{#1}%\n"
        "  \\def\\mbox#1{#1}%\n"
        "  \\def\\hbox#1{#1}%\n"
        "  \\def\\textcolor#1#2{#2}%\n"
        "  \\def\\cite#1{}%\n"
        "  \\def\\ref#1{}%\n"
        "  \\def\\eqref#1{}%\n"
        "  \\def\\footnote#1{}%\n"
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

    print(f"[REPORT] Final LaTeX document -> {len(latex):,} chars")
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