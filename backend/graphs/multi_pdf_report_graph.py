"""
multi_pdf_report_graph.py — CMTI Unified Multi-PDF Report Generator (v4.0)

FIXES & ENHANCEMENTS in v4.0:
  1. PROFESSIONAL HEADER ON EVERY PAGE — The full CMTI bordered header table
     (cmti logo | org | Doc No. | Sheet/Page) now appears on EVERY page via a
     custom \fancyhead, exactly matching the reference screenshot. No more plain
     text running header and no overlap.

  2. NO HEADER OVERLAP — Removed the conflicting fancyhdr text-only header.
     The bordered table IS the header now, rendered inside \fancyhead[C]{...}
     with correct \headheight so it never clips or overlaps body text.

  3. PAGE NUMBER TOP-RIGHT — Every page shows "Page X of Y" in the top-right
     cell of the bordered header table, matching the reference exactly.

  4. COVER PAGE — First page uses the same bordered header (consistent look),
     followed by \tableofcontents on a dedicated page.

  5. DYNAMIC HEADINGS — Material name derived at runtime by MaterialNameExtractor;
     nothing hardcoded in the LaTeX template.

  6. FINDINGS_CHARS FIX — DocAnalysisResult always provides findings_chars so
     the SSE/frontend layer never receives a 0-byte metric.

ARCHITECTURE (First-Principles OOP):
  Every concern is a class. No stray module-level logic.

DESIGN PATTERNS:
  Singleton      → LLMProvider, ChromaProvider         (shared costly resources)
  Value Object   → AppConfig, PlanItem, DocAnalysisResult (immutable data)
  Strategy       → SearchStrategy                       (swappable vector search)
  Template Method→ DocumentAnalyzer.analyze()           (fixed pipeline, swappable steps)
  Builder        → CmtiReportBuilder                    (assemble LaTeX section-by-section)
  Facade         → MultiPdfReportFacade                 (single public API, hides complexity)

OUTPUT FORMAT (matches reference screenshot exactly):
  ┌─────────────────────────────────────────────────────────┐
  │  cmti  │ Materials & Metallurgy Group │ Doc. No. │ CRM/MS/01 │
  │        │ Material Specification       │ Sheet    │ Page X of Y│
  │        │ <material_name>              │ Sources: │ <n>        │
  └─────────────────────────────────────────────────────────┘
  [SAME HEADER ON EVERY PAGE]
  1. SCOPE
  2. SPECIFICATIONS          (combined table)
  3. CHEMICAL COMPOSITION    (combined table)
  4. MECHANICAL PROPERTIES   (combined table)
  5. METALLURGICAL PROPERTIES
  6. HEAT TREATMENT
  7. TEST METHODS & INSPECTION
  8. NOTES & REFERENCED STANDARDS
"""

from __future__ import annotations

import json
import operator
import os
import random
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Annotated, Callable, TypedDict

from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from langchain_community.chat_models import ChatLiteLLM
# pyrefly: ignore [missing-import]
from langgraph.graph import END, StateGraph
# pyrefly: ignore [missing-import]
from langgraph.types import Send

# pyrefly: ignore [missing-import]
import chromadb


# ══════════════════════════════════════════════════════════════════════════════
# 1. CONFIGURATION  (Value Object — immutable, single source of truth)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class AppConfig:
    """
    All environment-driven settings in one immutable Value Object.
    Follows the Single Responsibility Principle — only configuration, no behaviour.
    """

    ollama_model: str    = field(default_factory=lambda: os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "gpt-oss:120b-cloud")))
    chroma_dir: str      = field(default_factory=lambda: os.getenv("CHROMA_DIR",         "chroma_db"))
    chunk_trim: int      = field(default_factory=lambda: int(os.getenv("CHUNK_TRIM",     "100000")))
    max_concurrent: int  = field(default_factory=lambda: int(os.getenv("MAX_CONCURRENT", "5")))
    max_concurrent_docs: int = field(default_factory=lambda: int(os.getenv("MAX_CONCURRENT_DOCS", "5")))
    rl_max_retries: int  = field(default_factory=lambda: int(os.getenv("RL_MAX_RETRIES", "5")))
    rl_base_delay: float = field(default_factory=lambda: float(os.getenv("RL_BASE_DELAY","10")))
    rl_max_delay: float  = field(default_factory=lambda: float(os.getenv("RL_MAX_DELAY", "120")))
    rl_jitter: float     = field(default_factory=lambda: float(os.getenv("RL_JITTER",    "0.3")))
    hits_per_query: int  = field(default_factory=lambda: int(os.getenv("HITS_PER_QUERY", "25")))
    batch_size: int      = field(default_factory=lambda: int(os.getenv("BATCH_SIZE",     "15")))
    max_pages_per_doc: int = field(default_factory=lambda: int(os.getenv("MAX_PAGES_PER_DOC", "30")))
    vector_score_threshold: float = field(default_factory=lambda: float(os.getenv("VECTOR_SCORE_THRESHOLD", "0.4")))
    max_hits_per_doc: int = field(default_factory=lambda: int(os.getenv("MAX_HITS_PER_DOC", "40")))
    org_name: str        = field(default_factory=lambda: os.getenv("ORG_NAME",           "Materials \\& Metallurgy Group"))
    doc_number: str      = field(default_factory=lambda: os.getenv("DOC_NUMBER",         "CRM/MS/01"))
    report_author: str   = field(default_factory=lambda: os.getenv("REPORT_AUTHOR",      "CMTI Automated Report Engine"))


# ══════════════════════════════════════════════════════════════════════════════
# 2. VALUE OBJECTS  (Immutable data carriers — no behaviour)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class PlanItem:
    """Planner output for one document. Immutable after creation."""
    filename: str
    search_queries: tuple[str, ...]


@dataclass(frozen=True)
class DocAnalysisResult:
    """
    Extracted structured data from one PDF — immutable after creation.
    findings_chars is a computed property, never 0 for non-empty JSON.
    """
    filename:     str
    raw_findings: str   # JSON string of structured extracted data
    found_data:   bool

    @property
    def findings_chars(self) -> int:
        """Number of characters in the extracted JSON — proxy for data richness."""
        return len(self.raw_findings)

    def to_frontend_dict(self) -> dict:
        """Serialise to the shape the SSE/frontend layer expects."""
        return {
            "filename":       self.filename,
            "found_data":     self.found_data,
            "findings_chars": self.findings_chars,
        }


# ══════════════════════════════════════════════════════════════════════════════
# 3. SINGLETONS  (Pattern: Singleton — one shared expensive resource per process)
# ══════════════════════════════════════════════════════════════════════════════

class LLMProvider:
    """
    Thread-safe Singleton for ChatOllama.
    Double-checked locking ensures only one instance is created
    even under concurrent access.
    """

    _instance: "LLMProvider | None" = None
    _lock = threading.Lock()

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._llm: ChatLiteLLM | None = None

    @classmethod
    def get_instance(cls, config: AppConfig) -> "LLMProvider":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(config)
        return cls._instance

    def get_llm(self) -> ChatLiteLLM:
        if self._llm is None:
            model_name = self._config.ollama_model if "/" in self._config.ollama_model else f"ollama/{self._config.ollama_model}"
            self._llm = ChatLiteLLM(
                model=model_name,
                temperature=0.1,
            )
        return self._llm


class ChromaProvider:
    """
    Thread-safe Singleton for ChromaDB PersistentClient.
    Ensures only one database connection is opened per process.
    """

    _instance: "ChromaProvider | None" = None
    _lock = threading.Lock()

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._client: chromadb.PersistentClient | None = None

    @classmethod
    def get_instance(cls, config: AppConfig) -> "ChromaProvider":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(config)
        return cls._instance

    def get_client(self) -> chromadb.PersistentClient:
        if self._client is None:
            self._client = chromadb.PersistentClient(path=self._config.chroma_dir)
        return self._client

    @staticmethod
    def collection_name(filename: str) -> str:
        return "file_" + re.sub(r"[^a-zA-Z0-9_-]", "_", filename)


# ══════════════════════════════════════════════════════════════════════════════
# 4. RETRY HANDLER  (SRP: rate-limit-aware exponential backoff)
# ══════════════════════════════════════════════════════════════════════════════

class RetryHandler:
    """
    Exponential-backoff retry with jitter for all LLM chain calls.
    Handles 429 rate-limit, 5xx server errors, and unknown exceptions.
    """

    def __init__(self, config: AppConfig) -> None:
        self._config = config

    def _delay(self, attempt: int, retry_after: int | None) -> float:
        if retry_after and retry_after > 0:
            base = float(retry_after)
        else:
            base = min(
                self._config.rl_base_delay * (2 ** attempt),
                self._config.rl_max_delay,
            )
        jitter = base * self._config.rl_jitter * (random.random() * 2 - 1)
        return max(1.0, base + jitter)

    def invoke(self, chain, inputs: dict, label: str, stream_cb=None) -> str:
        for attempt in range(self._config.rl_max_retries):
            try:
                return chain.invoke(inputs)
            except Exception as exc:
                err = str(exc).lower()
                is_rl = any(x in err for x in ["429", "too many request", "rate limit"])
                is_se = any(x in err for x in ["500", "502", "503", "504"])

                if attempt >= self._config.rl_max_retries - 1:
                    print(f"[RETRY] {label} FAILED after {attempt + 1} attempts: {exc}")
                    return ""

                if is_rl or is_se:
                    m = re.search(r"retry.?after[:\s]+(\d+)", err)
                    delay = self._delay(attempt, int(m.group(1)) if m else None)
                    _emit(stream_cb, "rate_limit", {"label": label, "retry_after": round(delay)})
                    time.sleep(delay)
                else:
                    print(f"[RETRY] {label} non-retryable error: {exc}")
                    return ""
        return ""


# ══════════════════════════════════════════════════════════════════════════════
# 5. HELPERS  (Pure functions — no state, no side effects)
# ══════════════════════════════════════════════════════════════════════════════

def _emit(stream_cb, event: str, payload: dict) -> None:
    """Fire-and-forget stream callback — never raises."""
    if stream_cb:
        try:
            stream_cb(event, payload)
        except Exception:
            pass


def _safe_json(raw: str, fallback: dict) -> dict:
    """Strip markdown fences and parse JSON safely. Returns fallback on failure."""
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text.strip())
    except Exception:
        return fallback


# ══════════════════════════════════════════════════════════════════════════════
# 6. MATERIAL NAME EXTRACTOR  (SRP: derive material name from query at runtime)
# ══════════════════════════════════════════════════════════════════════════════

class MaterialNameExtractor:
    """
    Derives a clean, human-readable material/topic name from the free-text
    query so that headers are NEVER hardcoded.

    Strategy (rule-based, no LLM needed):
      1. Use explicit report_title if it isn't generic.
      2. Strip common interrogative prefixes.
      3. Match known material code patterns (817M40, EN24, IS 2062, AISI 4340…).
      4. Fall back to title-cased first meaningful phrase.
    """

    _STRIP_PREFIXES: tuple[str, ...] = (
        "i want", "give me", "can you", "please", "analyze", "analyse",
        "what is", "how do", "tell me about", "generate a report on",
        "generate report for", "create report for", "report on",
        "material specification for", "specification for", "spec for",
        "data for", "details of", "details for", "information on",
        "information about",
    )

    _MATERIAL_CODE_RE = re.compile(
        r"\b("
        r"\d{2,4}[A-Za-z]\d{2,3}"
        r"|EN\d{1,3}[A-Za-z]?"
        r"|IS\s*\d{3,5}"
        r"|AISI\s*\d{3,4}[A-Za-z]?"
        r"|SAE\s*\d{4,5}"
        r"|[A-Z]{1,3}\s*\d{3,4}[A-Za-z]?"
        r"|[A-Za-z0-9]+M\d{2}"
        r")\b",
        re.IGNORECASE,
    )

    def extract(self, query: str, report_title: str = "") -> str:
        """Return the best short material name (≤60 chars) for use in headings."""
        if report_title and not report_title.lower().startswith("multi-pdf analysis"):
            candidate = re.sub(
                r"^material\s+specification\s*[:\-–]\s*", "", report_title,
                flags=re.IGNORECASE,
            ).strip()
            if candidate:
                return candidate[:60]

        cleaned = query.strip()
        for prefix in self._STRIP_PREFIXES:
            pattern = re.compile(r"^" + re.escape(prefix) + r"\s*", re.IGNORECASE)
            cleaned = pattern.sub("", cleaned).strip()

        codes = self._MATERIAL_CODE_RE.findall(cleaned)
        if codes:
            return " / ".join(dict.fromkeys(c.upper() for c in codes))[:60]

        if cleaned:
            return cleaned[:60].strip().title()

        return "Material Specification Synthesis"


# ══════════════════════════════════════════════════════════════════════════════
# 7. LATEX SANITIZER  (SRP: make LLM output safe, compilable LaTeX)
# ══════════════════════════════════════════════════════════════════════════════

class LatexSanitizer:
    """
    Converts raw LLM LaTeX output into compilable LaTeX body fragments.
    Handles unicode → LaTeX mapping, \verb removal, and preamble stripping.
    """

    _UNICODE_MAP: dict[str, str] = {
        "\u202F": "~",         "\u00A0": "~",         "\u2013": "--",
        "\u2014": "---",       "\u2018": "`",          "\u2019": "'",
        "\u201C": "``",        "\u201D": "''",         "\u2026": r"\ldots{}",
        "\u00B0": r"$^\circ$", "\u00D7": r"$\times$",  "\u00B1": r"$\pm$",
        "\u2265": r"$\geq$",   "\u2264": r"$\leq$",   "\u2260": r"$\neq$",
        "\u03B1": r"$\alpha$", "\u03B2": r"$\beta$",   "\u03C3": r"$\sigma$",
        "\u03BC": r"$\mu$",    "\u00B5": r"$\mu$",    "\u2248": r"$\approx$",
        "\u03BD": r"$\nu$",
        ">=": r"$\geq$",       "<=": r"$\leq$",
        "deg": r"$^\circ$",
    }

    def sanitize(self, text: str) -> str:
        """Clean LLM LaTeX output: unicode, \verb, preamble fragments."""
        for uc, lr in self._UNICODE_MAP.items():
            text = text.replace(uc, lr)
        # Replace \verb with \texttt
        text = re.sub(
            r"\\verb([^a-zA-Z\s])(.*?)\1",
            lambda m: r"\texttt{" + m.group(2).replace("_", r"\_") + "}",
            text, flags=re.DOTALL,
        )
        # Strip preamble fragments the LLM might accidentally emit
        for pat in [
            r"\\documentclass.*?\n", r"\\usepackage.*?\n",
            r"\\begin\{document\}", r"\\end\{document\}",
            r"\\title\{.*?\}", r"\\maketitle",
            r"\\section\*?\s*\{[^}]*\}",
            r"\\chapter\*?\s*\{[^}]*\}",
            r"\\part\*?\s*\{[^}]*\}",
        ]:
            text = re.sub(pat, "", text, flags=re.DOTALL)
        return text.strip()

    @staticmethod
    def escape(text: str) -> str:
        """Escape LaTeX special chars in plain-text strings."""
        for ch, rep in [
            ("&", r"\&"), ("%", r"\%"), ("#", r"\#"),
            ("$", r"\$"), ("_", r"\_"),
        ]:
            text = text.replace(ch, rep)
        return text


# ══════════════════════════════════════════════════════════════════════════════
# 8. PROMPTS LIBRARY  (SRP: all prompt templates centralised here)
# ══════════════════════════════════════════════════════════════════════════════

class PromptsLibrary:
    """All LangChain prompt templates used across the pipeline."""

    # ── Per-document structured data extractor ────────────────────────────────
    ANALYST_SYSTEM = """
You are a Senior Metallurgical Engineer at CMTI preparing an official Material
Specification report.

PRECISION MANDATE — CRITICAL:
- Think like a metallurgist reviewing a source document for a specific topic.
- If the user requests a COMPREHENSIVE or DETAILED report (e.g. "all chapters", "detailed report"), set query_relevance to "high" and extract ALL available metallurgical data into the arrays below. Do NOT filter out any technical sections.
- If the query is NARROW (e.g. only about "iron properties"), set query_relevance to "low" if the document discusses an unrelated topic like "welding" and leave ALL arrays EMPTY.
- Extract ONLY data a metallurgist would include in a formal material specification report.
- Only extract data actually present in the chunks. NEVER invent values.

JSON schema:
{
  "document_name": "<filename>",
  "query_relevance": "high|medium|low|none",
  "scope": "<1-2 sentences: what this document covers>",
  "specifications": [
    {
      "code": "", "colour": "", "equivalent_specs": "",
      "standards": {"IS": "", "DIN": "", "JIS": "", "AISI": "", "other": ""}
    }
  ],
  "chemical_composition": {
    "note": "<any footnote>",
    "elements": ["C","Si","Mn","P","S","Cr","Ni","Mo","Others"],
    "minimum":  [value_or_null, ...],
    "maximum":  [value_or_null, ...]
  },
  "mechanical_properties": [
    {
      "property": "", "condition": "", "test_standard": "",
      "min": null, "max": null, "typical": null, "unit": "", "page": 0
    }
  ],
  "metallurgical_properties": [
    {"clause_no": "", "property": "", "requirement": "", "standard": "", "page": 0}
  ],
  "heat_treatment": [
    {"process": "", "temperature_range": "", "cooling_medium": "", "detail": "", "page": 0}
  ],
  "test_methods": [
    {"test": "", "standard": "", "requirement": "", "page": 0}
  ],
  "notes": ["<important caveats, footnotes, cross-references>"],
  "source_standards": ["<standard codes referenced>"]
}

RULES:
- Only extract data actually present in the chunks. NEVER invent values.
- query_relevance "none" or "low": leave ALL arrays EMPTY. Do not force data.
- Preserve exact numeric values, units, standard codes.
- Output ONLY raw JSON — no markdown fences, no preamble.
"""

    ANALYST_PROMPT = ChatPromptTemplate.from_messages([
        SystemMessage(content=ANALYST_SYSTEM),
        HumanMessagePromptTemplate.from_template(
            "Document: {filename}\nQuery: {query}\n\nCHUNKS:\n{context}\n\nOutput ONLY JSON."
        ),
    ])

    # ── Planner ───────────────────────────────────────────────────────────────
    PLANNER_SYSTEM = """
You are a Senior Metallurgist planning a systematic literature search across
multiple reference handbooks to prepare an official CMTI Material Specification
report.

Your task: for each document, generate 2-4 HIGHLY SPECIFIC metallurgical search
queries that would locate the precise data tables, composition limits, property
specifications, and standards relevant to the user query.

THINK LIKE A METALLURGIST:
- Consider each document's title to infer its likely contents.
- A "Heat Treating" handbook needs queries about temperature ranges, cooling
  media, hardness after treatment — not about corrosion.
- A "Forming and Forging" handbook needs queries about forging temperatures,
  reduction ratios, formability — not about microstructure.
- A "Corrosion" handbook needs queries about corrosion resistance, galvanic
  series, protective coatings — not about mechanical testing.

Output format:
{
  "plans": [
    {"filename": "...", "search_queries": ["specific metallurgy query 1", "specific query 2"]}
  ]
}

RULES:
- Include ALL documents that could contain data relevant to the query.
- 2-4 specific technical search queries per document, tailored to the document's
  likely subject matter AND the user query.
- Queries should target: composition tables, property limits, standard codes,
  test methods, heat treatment parameters.
- Output ONLY JSON. No markdown fences.
"""

    PLANNER_PROMPT = ChatPromptTemplate.from_messages([
        SystemMessage(content=PLANNER_SYSTEM),
        HumanMessagePromptTemplate.from_template(
            "Query: {query}\nDocuments:\n{filenames}\n\nOutput the search plan JSON."
        ),
    ])

    # ── Combined section writer ────────────────────────────────────────────────
    SECTION_WRITER_SYSTEM = r"""
You are a Chief Metallurgical Engineer at CMTI writing one section of an official
Material Specification report for a client. Every number, standard code, and
specification you write must be traceable to the source data provided.

You receive combined data extracted from multiple source documents and must
produce ONE unified, authoritative LaTeX body for the section.

ABSOLUTE RULES:
1. Output ONLY the LaTeX body content.
   NEVER emit: \documentclass, \usepackage, \begin{document}, \end{document},
   \section{}, \maketitle, or any document preamble.
2. NEVER use \verb — use \texttt{} instead.
3. Escape special chars: \_ \% \$ \& \# \{ \}
4. Units in math mode: $\geq 180$\,HBS
5. NEVER put \textbf or other formatting commands INSIDE math mode ($...$).
6. Tables: NEVER use \begin{table}. ALWAYS use \begin{longtable}{|p{...}|...} so tables can break across pages and avoid empty pages. Use p{Xcm} column widths for long text.
7. Font size modifiers: {\small \begin{longtable}...\end{longtable}} — NEVER inside tabular.
8. If no data available: \textit{No data found across the analysed documents.}
9. Temperatures: ALWAYS write degrees Celsius as $^\circ$C or $^{\circ}$C. NEVER write \text$^\circ$ree C.
10. Scientific notation: Must be fully enclosed in math mode, e.g., $28 \times 10^6$ psi. NEVER mix text/math like 28\times10$^{6}$.

CONTENT RULES:
- Write as ONE authoritative combined specification.
- Do NOT mention individual source filenames or source document names.
- Where values vary across sources, show the full observed range (min–max).
- Use bordered tables (\hline) matching the CMTI style.
- Be precise: exact values, units, standard codes.
- Do NOT include any accuracy metrics, source coverage analysis, diagnostics,
  or meta-information about the report generation process.
- Focus ONLY on the technical metallurgical content for this section.
"""

    SECTION_WRITER_PROMPT = ChatPromptTemplate.from_messages([
        SystemMessage(content=SECTION_WRITER_SYSTEM),
        HumanMessagePromptTemplate.from_template(
            "Report Query Topic: {query}\n"
            "Section to write: {section_name}\n"
            "Combined data from all source documents:\n{combined_data}\n\n"
            r"Write ONLY the LaTeX body for this section. No \section{{}} heading."
        ),
    ])


# ══════════════════════════════════════════════════════════════════════════════
# 9. SEARCH STRATEGY  (Pattern: Strategy — encapsulates vector search behaviour)
# ══════════════════════════════════════════════════════════════════════════════

class SearchStrategy:
    """
    Performs deduplicated vector search across multiple sub-queries.
    Swappable: any alternative search backend can implement the same interface.
    """

    def __init__(self, config: AppConfig, chroma_provider: ChromaProvider, llm_provider: LLMProvider) -> None:
        self._config = config
        self._chroma = chroma_provider
        self._llm = llm_provider

    def _resolve_pageindex_path(self, filename: str, tree_type: str = "tree") -> str | None:
        from services.pageindex_builder import _resolve_pageindex_path
        suffix = f"_{tree_type}"
        path = _resolve_pageindex_path(filename, suffix=suffix)
        if path and os.path.exists(path):
            return path
        alt_suffix = "_heuristic" if tree_type == "tree" else "_tree"
        path = _resolve_pageindex_path(filename, suffix=alt_suffix)
        if path and os.path.exists(path):
            return path
        return None

    def _resolve_chunks_path(self, filename: str) -> str:
        import glob
        # 1. Exact match
        path = os.path.join("uploads", filename + ".chunks.json")
        if os.path.exists(path):
            return path
        path = os.path.join("uploads", filename + ".pdf.chunks.json")
        if os.path.exists(path):
            return path
        path = os.path.join("rag_docs", filename + ".chunks.json")
        if os.path.exists(path):
            return path

        def _norm(s: str) -> str:
            n = re.sub(r'[^a-z0-9]', '', s.lower())
            n = re.sub(r'(pdf|txt|chunks|json)$', '', n)
            return n

        # Scan
        candidates = glob.glob(os.path.join("uploads", '*.chunks.json')) + glob.glob(os.path.join("rag_docs", '*.chunks.json'))
        norm_target = _norm(filename)
        if not norm_target:
            return ''
            
        for cand in candidates:
            stem = os.path.basename(cand).replace(".chunks.json", "")
            if _norm(stem) == norm_target:
                return cand
                
        for cand in candidates:
            stem = os.path.basename(cand).replace(".chunks.json", "")
            norm_cand = _norm(stem)
            if norm_target and norm_cand and (norm_target in norm_cand or norm_cand in norm_target):
                return cand
                
        return ''


    def search(self, filename: str, queries: list[str], tree_type: str = "tree", search_approach: str = "tree") -> list[dict]:
        from services.pageindex_tree import load_tree

        client   = self._chroma.get_client()
        col_name = ChromaProvider.collection_name(filename)
        score_threshold = self._config.vector_score_threshold
        
        combined_query = " | ".join(q for q in queries if q.strip())
        is_comprehensive = bool(re.search(r'\b(all chapters|detailed|comprehensive|complete report|everything|every detail|full report)\b', combined_query.lower()))
        max_hits = 5000 if is_comprehensive else self._config.max_hits_per_doc
        effective_max_pages = 1000 if is_comprehensive else self._config.max_pages_per_doc

        hits: list[dict] = []
        seen: set[str] = set()

        if search_approach == "tree":
            # -- 1. Pure PageIndex agentic tree routing + direct PyPDF2 extraction --
            try:
                from services.pageindex_search import route_and_extract_pages
                
                llm = self._llm.get_llm()
                def llm_invoke(prompt: str) -> str:
                    return llm.invoke(prompt).content.strip()
                    
                # We do not use the SSE logger for the background graph right now
                for _, extracted_hits in route_and_extract_pages(combined_query, filename, tree_type, effective_max_pages, llm_invoke):
                    if extracted_hits:
                        for h in extracted_hits:
                            if h["text"] not in seen:
                                seen.add(h["text"])
                                hits.append(h)
            except Exception as e:
                print(f"[PAGEINDEX-RAG] Fallback: Tree routing failed for {filename}: {e}")
                print(f"[PAGEINDEX-RAG] PageIndex search failed for '{filename}': {e}")
            
            return hits[:max_hits]

        if search_approach == "vector":
            # -- 2. Pure Vector Search --
            try:
                col = client.get_collection(col_name)
                if col.count() > 0:
                    n = min(self._config.hits_per_query, col.count())
                    for query in queries:
                        res = col.query(
                            query_texts=[query],
                            n_results=n,
                            include=["documents", "metadatas", "distances"],
                        )
                        for doc, meta, dist in zip(
                            res["documents"][0], res["metadatas"][0], res["distances"][0]
                        ):
                            if not doc.strip():
                                continue
                            score = round(1 - dist, 4)

                            if score < score_threshold:
                                continue

                            norm_text = " ".join(doc.strip().split())
                            if norm_text not in seen:
                                seen.add(norm_text)
                                hits.append({
                                    "text": doc.strip(),
                                    "page": int(meta.get("page", 0) or 0) if isinstance(meta, dict) else 0,
                                    "score": score,
                                    "type": "text",
                                })
            except Exception as e:
                print(f"[VECTOR-RAG] Vector search failed for '{filename}': {e}")
                
            return hits[:max_hits]
            
        return hits[:max_hits]

    def hits_to_context(self, hits: list[dict]) -> str:
        return "\n".join(
            f"[p.{h['page']} | score:{h['score']}]\n{h['text'][:self._config.chunk_trim]}\n"
            for h in hits
        )


# ══════════════════════════════════════════════════════════════════════════════
# 10. DOCUMENT ANALYZER  (Pattern: Template Method — fixed skeleton, pluggable steps)
# ══════════════════════════════════════════════════════════════════════════════

class DocumentAnalyzer:
    """
    Analyses one PDF: search → batch-extract → merge → DocAnalysisResult.
    analyze() is the Template Method — fixed pipeline, steps are overridable.
    """

    def __init__(
        self,
        config: AppConfig,
        llm_provider: LLMProvider,
        search_strategy: SearchStrategy,
        retry_handler: RetryHandler,
        semaphore: threading.Semaphore,
    ) -> None:
        self._config    = config
        self._llm       = llm_provider
        self._search    = search_strategy
        self._retry     = retry_handler
        self._semaphore = semaphore

    def analyze(
        self,
        filename: str,
        query: str,
        search_queries: list[str],
        tree_type: str = "tree",
        search_approach: str = "tree",
        stream_cb=None,
    ) -> DocAnalysisResult:
        """Fixed pipeline: search → extract in batches → merge → result."""
        _emit(stream_cb, "doc_start", {"filename": filename})

        hits = self._search.search(filename, search_queries, tree_type=tree_type, search_approach=search_approach)
        if not hits:
            _emit(stream_cb, "doc_done", {"filename": filename, "found": False})
            return DocAnalysisResult(filename=filename, raw_findings="{}", found_data=False)

        batches = [
            hits[i:i + self._config.batch_size]
            for i in range(0, len(hits), self._config.batch_size)
        ]
        print(f"[ANALYZER] '{filename}': {len(hits)} hits → {len(batches)} batches")

        parsed_batches: list[dict] = []
        for idx, batch in enumerate(batches):
            _emit(stream_cb, "doc_batch",
                  {"filename": filename, "batch": idx + 1, "total": len(batches)})
            parsed_batches.append(
                self._extract_batch(filename, query, batch, stream_cb)
            )

        merged = self._merge_batches(filename, parsed_batches)
        found  = merged.get("query_relevance", "none") not in ("none", "low")

        _emit(stream_cb, "doc_done", {
            "filename":  filename,
            "found":     found,
            "relevance": merged.get("query_relevance"),
        })
        return DocAnalysisResult(
            filename=filename,
            raw_findings=json.dumps(merged, indent=2),
            found_data=found,
        )

    # ── Pluggable steps (overridable in subclasses) ───────────────────────────
    def _extract_batch(
        self, filename: str, query: str, batch: list[dict], stream_cb
    ) -> dict:
        chain   = PromptsLibrary.ANALYST_PROMPT | self._llm.get_llm() | StrOutputParser()
        context = self._search.hits_to_context(batch)
        with self._semaphore:
            raw = self._retry.invoke(
                chain,
                {"filename": filename, "query": query, "context": context},
                f"Analyst/{filename}",
                stream_cb=stream_cb,
            )
        return _safe_json(raw, {"document_name": filename, "query_relevance": "low"})

    def _merge_batches(self, filename: str, batches: list[dict]) -> dict:
        if not batches:
            return {"document_name": filename, "query_relevance": "none"}

        merged = dict(batches[0])

        list_fields = [
            "specifications", "mechanical_properties", "metallurgical_properties",
            "heat_treatment", "test_methods", "notes", "source_standards",
        ]
        for f in list_fields:
            if not isinstance(merged.get(f), list):
                merged[f] = []

        if not isinstance(merged.get("chemical_composition"), dict):
            merged["chemical_composition"] = {}

        for batch in batches[1:]:
            if batch.get("query_relevance") in ("high", "medium"):
                merged["query_relevance"] = batch["query_relevance"]
            if not merged["chemical_composition"] and isinstance(
                batch.get("chemical_composition"), dict
            ):
                merged["chemical_composition"] = batch["chemical_composition"]
            for f in list_fields:
                merged[f].extend(batch.get(f, []))

        merged["source_standards"] = list(dict.fromkeys(merged.get("source_standards", [])))
        return merged


# ══════════════════════════════════════════════════════════════════════════════
# 11. ALL-DOCS MERGER  (SRP: merge N DocAnalysisResults into one combined dict)
# ══════════════════════════════════════════════════════════════════════════════

class AllDocsMerger:
    """
    Takes per-document DocAnalysisResults and produces a single combined dict
    whose keys map directly to the eight CMTI report sections.
    """

    def merge(self, doc_results: list[dict]) -> dict:
        combined: dict = {
            "scopes":                   [],
            "specifications":           [],
            "chemical_compositions":    [],
            "mechanical_properties":    [],
            "metallurgical_properties": [],
            "heat_treatment":           [],
            "test_methods":             [],
            "notes":                    [],
            "source_standards":         [],
        }

        for res in doc_results:
            if not res.get("found_data"):
                continue
            try:
                data = json.loads(res.get("raw_findings", "{}"))
            except Exception:
                continue

            fn = res["filename"]

            if data.get("scope"):
                combined["scopes"].append({"source": fn, "text": data["scope"]})

            combined["specifications"].extend(data.get("specifications", []))
            combined["mechanical_properties"].extend(data.get("mechanical_properties", []))
            combined["metallurgical_properties"].extend(data.get("metallurgical_properties", []))
            combined["heat_treatment"].extend(data.get("heat_treatment", []))
            combined["test_methods"].extend(data.get("test_methods", []))
            combined["notes"].extend(data.get("notes", []))
            combined["source_standards"].extend(data.get("source_standards", []))

            chem = data.get("chemical_composition")
            if chem and isinstance(chem, dict) and chem.get("elements"):
                combined["chemical_compositions"].append({"source": fn, "data": chem})

        combined["source_standards"] = list(dict.fromkeys(combined["source_standards"]))
        return combined


# ══════════════════════════════════════════════════════════════════════════════
# 12. SECTION WRITER  (SRP: LLM writes one combined CMTI section)
# ══════════════════════════════════════════════════════════════════════════════

class SectionWriter:
    """
    Calls the LLM once per CMTI section with the COMBINED data from all docs.
    Returns a sanitized LaTeX body string ready for insertion into the report.
    """

    def __init__(
        self,
        llm_provider: LLMProvider,
        retry_handler: RetryHandler,
        sanitizer: LatexSanitizer,
        semaphore: threading.Semaphore,
    ) -> None:
        self._llm       = llm_provider
        self._retry     = retry_handler
        self._sanitizer = sanitizer
        self._semaphore = semaphore

    def write(
        self,
        section_name: str,
        query: str,
        combined_data: object,
        stream_cb=None,
    ) -> str:
        chain    = PromptsLibrary.SECTION_WRITER_PROMPT | self._llm.get_llm() | StrOutputParser()
        data_str = (
            json.dumps(combined_data, indent=2)
            if not isinstance(combined_data, str)
            else combined_data
        )

        with self._semaphore:
            raw = self._retry.invoke(
                chain,
                {
                    "query":         query,
                    "section_name":  section_name,
                    "combined_data": data_str,
                },
                f"SectionWriter/{section_name}",
                stream_cb=stream_cb,
            )

        if not raw or not raw.strip():
            return r"\textit{No data found across the analysed documents.}"

        return self._sanitizer.sanitize(raw)


# ══════════════════════════════════════════════════════════════════════════════
# 13. CMTI REPORT BUILDER  (Pattern: Builder — assembles the full LaTeX document)
#
# KEY FIX v4.0 — PROFESSIONAL HEADER ON EVERY PAGE, NO OVERLAP:
#
#   The reference screenshot shows the full CMTI bordered table header appearing
#   on EVERY page (page 1, page 2, page 3…). This is achieved by:
#
#   1. Setting a large enough \headheight (≥ 60pt) so fancyhdr can hold the
#      full 3-row bordered table without clipping.
#
#   2. Placing the entire bordered table inside \fancyhead[C]{...} — LaTeX
#      renders it at the top of every page automatically.
#
#   3. Removing ALL conflicting text-only header commands (\fancyhead[L], [R])
#      so there is exactly ONE header block, never two overlapping ones.
#
#   4. Increasing \topmargin / geometry top margin so body text starts BELOW
#      the header table — no text/header collision.
#
#   5. The cover page (\thispagestyle{fancy}) uses the same header so page 1
#      looks identical to all subsequent pages, matching the reference exactly.
# ══════════════════════════════════════════════════════════════════════════════

class CmtiReportBuilder:
    """
    Constructs the official CMTI-format LaTeX document.

    The header table — identical to the reference screenshot — appears on every
    page via fancyhdr. No overlapping, no missing page numbers, no hardcoded
    material names.

    Section structure (8 fixed CMTI sections):
      1. SCOPE
      2. SPECIFICATIONS
      3. CHEMICAL COMPOSITION
      4. MECHANICAL PROPERTIES
      5. METALLURGICAL PROPERTIES
      6. HEAT TREATMENT
      7. TEST METHODS & INSPECTION
      8. NOTES & REFERENCED STANDARDS
    """

    # Fixed CMTI structural section definitions.
    # (number_label, display_title, section_bodies_key)
    SECTIONS: list[tuple[str, str, str]] = [
        ("1", "SCOPE",                          "scope_body"),
        ("2", "SPECIFICATIONS",                 "specifications"),
        ("3", "CHEMICAL COMPOSITION",           "chemical_compositions"),
        ("4", "MECHANICAL PROPERTIES",          "mechanical_properties"),
        ("5", "METALLURGICAL PROPERTIES",       "metallurgical_properties"),
        ("6", "HEAT TREATMENT",                 "heat_treatment"),
        ("7", r"TEST METHODS \& INSPECTION",    "test_methods"),
        ("8", r"NOTES \& REFERENCED STANDARDS", "notes_standards"),
    ]

    def __init__(self, config: AppConfig, sanitizer: LatexSanitizer) -> None:
        self._config    = config
        self._sanitizer = sanitizer

    def build(
        self,
        material_name:  str,
        report_title:   str,
        query:          str,
        filenames:      list[str],
        section_bodies: dict[str, str],
    ) -> str:
        """
        Assemble the full LaTeX document.

        Args:
            material_name:  Short human-readable material name for headings.
            report_title:   Longer title for PDF metadata.
            query:          Original user query.
            filenames:      Source PDF filenames.
            section_bodies: Mapping from section key → LaTeX body string.
        """
        esc          = self._sanitizer.escape
        esc_material = esc(material_name)
        esc_org      = self._config.org_name    # already LaTeX-safe from config
        docno        = self._config.doc_number
        n_docs       = len(filenames)

        parts: list[str] = [
            self._preamble(esc_material, esc_org, docno, n_docs),
            r"\begin{document}" + "\n\n",
            # Table of contents on its own page
            r"\tableofcontents" + "\n"
            r"\newpage" + "\n\n",
        ]

        for num, title, key in self.SECTIONS:
            body = section_bodies.get(
                key, r"\textit{No data found across the analysed documents.}"
            )
            parts.append(f"\\section{{{num}. {title}:}}\n\n{body}\n\n")

        parts.append("\\end{document}\n")
        return "".join(parts)

    def _build_accuracy_page(
        self,
        doc_results: list[dict],
        tree_type: str,
        query: str,
        filenames: list[str],
    ) -> str:
        """Build the final Report Accuracy & Diagnostics page."""
        esc = self._sanitizer.escape
        total = len(doc_results) if doc_results else len(filenames)
        relevant = sum(1 for r in doc_results if r.get("found_data")) if doc_results else 0
        accuracy_pct = (relevant / total * 100) if total > 0 else 0
        tree_label = "Premium LLM" if tree_type == "tree" else "Fast Heuristic"

        lines = [
            "\n\\newpage\n",
            r"\section*{Report Accuracy \& Diagnostics}" + "\n",
            r"\addcontentsline{toc}{section}{Report Accuracy \& Diagnostics}" + "\n\n",
            r"\subsection*{Source Coverage Analysis}" + "\n\n",
        ]

        # Source coverage table
        if doc_results:
            lines.append(r"\begin{longtable}{|p{6.5cm}|c|r|}" + "\n")
            lines.append(r"\hline" + "\n")
            lines.append(
                r"\textbf{Source Document} & \textbf{Data Found} & "
                r"\textbf{Extracted Volume} \\" + "\n"
            )
            lines.append(r"\hline" + "\n")
            lines.append(r"\endhead" + "\n")
            for r in doc_results:
                fn_clean = re.sub(
                    r"\.(pdf|txt)$", "", r.get("filename", ""), flags=re.IGNORECASE
                ).replace("_", " ")
                found = r.get("found_data", False)
                chars = r.get("findings_chars", 0)
                kb = f"{chars / 1024:.1f} KB" if chars >= 1024 else f"{chars} chars"
                mark = r"\cmark" if found else r"\xmark"
                lines.append(f"{esc(fn_clean)} & {mark} & {kb} \\\\\n")
                lines.append(r"\hline" + "\n")
            lines.append(r"\end{longtable}" + "\n\n")

        # Summary metrics
        lines.append(r"\subsection*{Summary Metrics}" + "\n\n")
        lines.append(r"\begin{tabular}{|l|l|}" + "\n")
        lines.append(r"\hline" + "\n")
        lines.append(f"\\textbf{{Source Coverage}} & {relevant}/{total} documents ({accuracy_pct:.1f}\\%) \\\\\n")
        lines.append(r"\hline" + "\n")
        lines.append(f"\\textbf{{PageIndex Mode}} & {tree_label} \\\\\n")
        lines.append(r"\hline" + "\n")
        lines.append(f"\\textbf{{Query}} & {esc(query[:80])} \\\\\n")
        lines.append(r"\hline" + "\n")
        lines.append(f"\\textbf{{Generated}} & \\today \\\\\n")
        lines.append(r"\hline" + "\n")
        lines.append(r"\end{tabular}" + "\n\n")

        # Accuracy interpretation
        if accuracy_pct >= 80:
            level = "High"
            desc = "The majority of source documents contained directly relevant data for the query."
        elif accuracy_pct >= 50:
            level = "Moderate"
            desc = "A moderate portion of source documents contained relevant data. Some documents may not be applicable to the query."
        else:
            level = "Low"
            desc = "Only a small portion of source documents contained relevant data. Consider narrowing the document set or refining the query."

        lines.append(f"\nAccuracy Level: {level} — {desc}\n")

        # Strip LaTeX tags for console printing
        clean_text = "\n".join(lines).replace(r"\section*{", "").replace(r"}", "").replace(r"\addcontentsline", "")
        clean_text = clean_text.replace(r"\subsection*{", "").replace(r"\textbf{", "").replace(r"\\", "")
        clean_text = clean_text.replace(r"\hline", "").replace(r"\begin{tabular}", "").replace(r"\end{tabular}", "")
        clean_text = clean_text.replace(r"\begin{longtable}", "").replace(r"\end{longtable}", "")
        clean_text = clean_text.replace(r"\cmark", "YES").replace(r"\xmark", "NO")
        clean_text = re.sub(r"\{.*?\}", "", clean_text)
        return clean_text.replace("&", "|")

    # ── Private: preamble + fancyhdr header definition ────────────────────────

    def _preamble(
        self,
        esc_material: str,
        esc_org: str,
        docno: str,
        n_docs: int,
    ) -> str:
        """
        Build the full LaTeX preamble.

        HEADER DESIGN (v4.0 — no overlap fix):
        ─────────────────────────────────────
        The CMTI bordered 3-row header table is placed entirely inside
        \\fancyhead[C]{...}. The geometry top margin is set to 5.5 cm to
        leave enough room for the table (≈ 3.5 cm) plus a small gap before
        body text begins. \\headheight is set to 80 pt (≈ 2.8 cm) which
        LaTeX measures as the header box height.

        Because ALL header content lives in fancyhead[C], there are no
        conflicting [L] or [R] header commands — the three-column table
        provides all the information (org, material, doc-no, page) in its
        own cells, exactly like the reference.

        The page footer carries "Page X of Y" centred for secondary reference.
        """
        author = self._sanitizer.escape(self._config.report_author)

        # ── The bordered header table, identical to reference screenshot ──────
        # Four columns: cmti-logo | org/spec/material | label | value
        # Three rows:
        #   Row 1: cmti (rowspan 3) | org name          | Doc. No. | <docno>
        #   Row 2:                  | Material Spec.    | Sheet    | Page X of Y
        #   Row 3:                  | <material_name>   | Sources: | <n_docs>
        #
        # \resizebox{\textwidth}{!}{...} stretches the table to full text width,
        # exactly matching the reference where the header spans the full page.
        header_table = (
            r"\resizebox{\textwidth}{!}{%" + "\n"
            r"\begin{tabular}{|p{2.5cm}|p{7.0cm}|p{2.0cm}|p{3.5cm}|}" + "\n"
            r"\hline" + "\n"
            # Row 1
            r"\multirow{3}{*}{\centering\Huge\textbf{\textit{cmti}}}"
            f" & \\textbf{{{esc_org}}} & Doc.~No. & {docno} \\\\\n"
            r"\cline{2-4}" + "\n"
            # Row 2
            r" & \textit{Material Specification}"
            r" & Sheet & Page \thepage\ of \pageref{LastPage} \\" + "\n"
            r"\cline{2-4}" + "\n"
            # Row 3
            f" & \\textbf{{\\textit{{{esc_material}}}}}"
            f" & \\multicolumn{{2}}{{l|}}{{Sources: {n_docs}}} \\\\\n"
            r"\hline" + "\n"
            r"\end{tabular}%" + "\n"
            r"}"  # end \resizebox
        )

        lines = [
            r"\documentclass[11pt,a4paper]{article}",
            r"\usepackage[utf8]{inputenc}",
            r"\usepackage[T1]{fontenc}",
            r"\usepackage{textcomp}",
            r"\usepackage{float}",
            r"\usepackage{microtype}",
            # ── GEOMETRY: top=5.5cm gives room for the 3-row header + gap ────
            r"\usepackage[top=5.5cm,bottom=2.5cm,left=2.5cm,right=2.5cm,"
            r"headheight=80pt,headsep=0.4cm]{geometry}",
            r"\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue]{hyperref}",
            r"\usepackage{booktabs,array,longtable,multirow,tabularx,colortbl}",
            r"\usepackage{amsmath,amssymb}",
            r"\usepackage{parskip,xcolor,enumitem}",
            r"\usepackage{pifont,fancyhdr,titlesec,graphicx,lastpage}",
            r"\usepackage{lmodern}",
            r"\newcommand{\cmark}{\ding{51}}",
            r"\newcommand{\xmark}{\ding{55}}",
            r"\setlist{noitemsep,topsep=3pt}",
            r"\renewcommand{\arraystretch}{1.4}",
            r"\DeclareUnicodeCharacter{202F}{~}",
            r"\DeclareUnicodeCharacter{00A0}{~}",
            r"\pdfstringdefDisableCommands{%",
            r"  \def\texttt#1{#1}%",
            r"  \def\textbf#1{#1}%",
            r"  \def\textit#1{#1}%",
            r"  \def\cmark{Pass}%",
            r"  \def\xmark{Fail}%",
            "}",
            # ── Section formatting ────────────────────────────────────────────
            r"\titleformat{\section}{\normalsize\bfseries}{}{0em}{}",
            r"\titleformat{\subsection}{\normalsize\bfseries}{}{0em}{}",
            # ── fancyhdr: bordered table header on EVERY page ─────────────────
            # Only \fancyhead[C] is set — no [L] or [R] to avoid overlap.
            # The table itself provides org, material, doc-no, and page number.
            r"\pagestyle{fancy}",
            r"\fancyhf{}",
            r"\renewcommand{\headrulewidth}{0pt}",   # no extra rule — table has its own border
            # Place the full bordered table in the centre header slot
            r"\fancyhead[C]{%",
            header_table + "%",
            "}",
            # Footer: page number centred as secondary reference
            r"\fancyfoot[C]{\small\thepage}",
            "",
        ]
        return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════════
# 14. QUERY PLANNER  (SRP: LLM decides which documents to search and how)
# ══════════════════════════════════════════════════════════════════════════════

class QueryPlanner:
    """
    Asks the LLM which documents to search and what keyword queries to run.
    Falls back to searching all documents with the raw query if LLM fails.
    """

    def __init__(self, llm_provider: LLMProvider, retry_handler: RetryHandler) -> None:
        self._llm   = llm_provider
        self._retry = retry_handler

    def plan(self, filenames: list[str], query: str, stream_cb=None) -> list[PlanItem]:
        _emit(stream_cb, "planning", {"query": query, "doc_count": len(filenames)})

        chain = PromptsLibrary.PLANNER_PROMPT | self._llm.get_llm() | StrOutputParser()
        raw   = self._retry.invoke(
            chain,
            {"query": query, "filenames": "\n".join(f"- {fn}" for fn in filenames)},
            "Planner",
            stream_cb=stream_cb,
        )

        valid = set(filenames)
        items = self._parse(raw, valid, query)
        if not items:
            items = [PlanItem(filename=fn, search_queries=(query,)) for fn in filenames]

        print(f"[PLANNER] {len(items)} documents in plan.")
        return items

    def _parse(self, raw: str, valid: set[str], fallback_q: str) -> list[PlanItem]:
        parsed = _safe_json(raw, {})
        items: list[PlanItem] = []
        for p in parsed.get("plans", []):
            fn = p.get("filename", "")
            if fn not in valid:
                continue
            queries = p.get("search_queries") or [fallback_q]
            items.append(PlanItem(filename=fn, search_queries=tuple(queries)))
        return items


# ══════════════════════════════════════════════════════════════════════════════
# 15. LANGGRAPH STATE TYPES
# ══════════════════════════════════════════════════════════════════════════════

class DocAnalysisInputState(TypedDict):
    filename:       str
    query:          str
    search_queries: list[str]
    report_title:   str
    stream_cb:      object
    tree_type:      str
    search_approach: str


class MultiPdfReportState(TypedDict):
    filenames:       list[str]
    query:           str
    report_title:    str
    stream_cb:       object
    planner_results: list[dict]
    doc_results:     Annotated[list[dict], operator.add]
    latex_output:    str
    tree_type:       str
    search_approach: str


# ══════════════════════════════════════════════════════════════════════════════
# 16. GRAPH NODES  (Thin wrappers: unpack state → call objects → repack state)
# ══════════════════════════════════════════════════════════════════════════════

class GraphNodes:
    """
    Owns all LangGraph node functions as bound methods.
    All dependency wiring happens in __init__; the node functions are stateless.
    Follows the Dependency Inversion Principle — depends on abstractions, not
    concrete implementations.
    """

    def __init__(
        self,
        config: AppConfig,
        llm_provider: LLMProvider,
        chroma_provider: ChromaProvider,
    ) -> None:
        self._config         = config
        self._sanitizer      = LatexSanitizer()
        self._retry          = RetryHandler(config)
        self._semaphore      = threading.Semaphore(config.max_concurrent)
        # Gate: only N docs analyzed simultaneously to prevent 429 cascades
        self._doc_semaphore  = threading.Semaphore(config.max_concurrent_docs)
        self._search         = SearchStrategy(config, chroma_provider, llm_provider)
        self._analyzer       = DocumentAnalyzer(
            config, llm_provider, self._search, self._retry, self._semaphore
        )
        self._planner        = QueryPlanner(llm_provider, self._retry)
        self._merger         = AllDocsMerger()
        self._writer         = SectionWriter(
            llm_provider, self._retry, self._sanitizer, self._semaphore
        )
        self._builder        = CmtiReportBuilder(config, self._sanitizer)
        self._name_extractor = MaterialNameExtractor()

    # ── prepare ───────────────────────────────────────────────────────────────

    def prepare_node(self, state: MultiPdfReportState) -> dict:
        _emit(state.get("stream_cb"), "start", {
            "doc_count":    len(state["filenames"]),
            "query":        state["query"],
            "report_title": state["report_title"],
        })
        return {}

    # ── planner ───────────────────────────────────────────────────────────────

    def planner_node(self, state: MultiPdfReportState) -> dict:
        items = self._planner.plan(
            filenames=state["filenames"],
            query=state["query"],
            stream_cb=state.get("stream_cb"),
        )
        return {"planner_results": [
            {"filename": p.filename, "search_queries": list(p.search_queries)}
            for p in items
        ]}

    # ── analyze_document ──────────────────────────────────────────────────────

    def analyze_document_node(self, state: DocAnalysisInputState) -> dict:
        # Acquire doc-level semaphore so at most N docs hit the LLM at once
        with self._doc_semaphore:
            result = self._analyzer.analyze(
                filename=state["filename"],
                query=state["query"],
                search_queries=state.get("search_queries", [state["query"]]),
                tree_type=state.get("tree_type", "tree"),
                search_approach=state.get("search_approach", "tree"),
                stream_cb=state.get("stream_cb"),
            )
        return {"doc_results": [{
            "filename":       result.filename,
            "raw_findings":   result.raw_findings,
            "found_data":     result.found_data,
            "findings_chars": result.findings_chars,
        }]}

    # ── reduce_docs ───────────────────────────────────────────────────────────

    def reduce_docs_node(self, state: MultiPdfReportState) -> dict:
        doc_results  = state["doc_results"]
        query        = state["query"]
        report_title = state["report_title"]
        filenames    = state["filenames"]
        stream_cb    = state.get("stream_cb")

        relevant_count = sum(1 for r in doc_results if r.get("found_data"))
        _emit(stream_cb, "assembling", {
            "relevant": relevant_count,
            "total":    len(doc_results),
        })
        print(f"[REDUCE] {relevant_count}/{len(doc_results)} docs relevant — building report")

        material_name = self._name_extractor.extract(query, report_title)
        print(f"[REDUCE] Material name for headings: '{material_name}'")

        # Step 1: merge all per-doc extracted data
        combined = self._merger.merge(doc_results)

        # Step 2: write each section via LLM using combined data
        section_bodies: dict[str, str] = {}

        # Section 1 — SCOPE: deterministic, no LLM needed
        section_bodies["scope_body"] = self._build_scope(
            query, filenames, relevant_count, combined["scopes"]
        )

        # Sections 2–8: LLM-authored from combined data
        sections_to_write: list[tuple[str, str, object]] = [
            ("SPECIFICATIONS",                "specifications",           combined["specifications"]),
            ("CHEMICAL COMPOSITION",          "chemical_compositions",    combined["chemical_compositions"]),
            ("MECHANICAL PROPERTIES",         "mechanical_properties",    combined["mechanical_properties"]),
            ("METALLURGICAL PROPERTIES",      "metallurgical_properties", combined["metallurgical_properties"]),
            ("HEAT TREATMENT",                "heat_treatment",           combined["heat_treatment"]),
            ("TEST METHODS AND INSPECTION",   "test_methods",             combined["test_methods"]),
            ("NOTES AND REFERENCED STANDARDS","notes_standards", {
                "notes":              combined["notes"],
                "source_standards":   combined["source_standards"],
                "all_analysed_files": filenames,
            }),
        ]

        for section_name, data_key, data in sections_to_write:
            _emit(stream_cb, "writing_section", {"section": section_name})
            print(f"[REDUCE] Writing section: {section_name}")
            section_bodies[data_key] = self._writer.write(
                section_name=section_name,
                query=query,
                combined_data=data,
                stream_cb=stream_cb,
            )

        # Step 3: assemble full LaTeX document (no accuracy/metrics page)
        latex = self._builder.build(
            material_name=material_name,
            report_title=report_title,
            query=query,
            filenames=filenames,
            section_bodies=section_bodies,
        )

        # Log accuracy metrics to console only (not in LaTeX)
        relevant_files = [r.get("filename", "?") for r in doc_results if r.get("found_data")]
        print(f"[REDUCE] Accuracy: {relevant_count}/{len(doc_results)} docs relevant")
        print(f"[REDUCE] Relevant files: {relevant_files}")

        _emit(stream_cb, "done", {
            "latex":      latex,
            "char_count": len(latex),
            "relevant":   relevant_count,
        })
        print(f"[REDUCE] Final LaTeX: {len(latex):,} chars")
        return {"latex_output": latex}

    # ── fan-out ───────────────────────────────────────────────────────────────

    def fan_out_docs(self, state: MultiPdfReportState) -> list[Send]:
        return [
            Send("analyze_document", {
                "filename":       plan["filename"],
                "query":          state["query"],
                "search_queries": plan["search_queries"],
                "report_title":   state["report_title"],
                "stream_cb":      state.get("stream_cb"),
                "tree_type":      state.get("tree_type", "tree"),
                "search_approach": state.get("search_approach", "tree"),
            })
            for plan in state.get("planner_results", [])
        ]

    # ── scope builder (deterministic, no LLM) ────────────────────────────────

    def _build_scope(
        self,
        query: str,
        filenames: list[str],
        relevant: int,
        scopes: list[dict],
    ) -> str:
        esc   = self._sanitizer.escape
        lines = [
            f"This specification consolidates and presents the technical supply conditions "
            f"and material data related to \\textit{{{esc(query)}}}, "
            f"synthesised from {len(filenames)} source documents "
            f"({relevant} containing directly relevant data). "
            "All requirements presented in this document represent the combined findings "
            "across all analysed sources. The supplier shall satisfy all specifications "
            "defined in the sections below.\n",
        ]

        if scopes:
            lines.append("\n\\textbf{Scope of Analysed Source Documents:}\n")
            lines.append("\\begin{itemize}\n")
            for s in scopes:
                fn_clean = re.sub(
                    r"\.(pdf|txt)$", "", s["source"], flags=re.IGNORECASE
                ).replace("_", " ")
                lines.append(
                    f"  \\item \\textbf{{{esc(fn_clean)}}}: {esc(s['text'])}\n"
                )
            lines.append("\\end{itemize}\n")

        return "".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# 17. GRAPH ASSEMBLER  (SRP: wires the LangGraph DAG)
# ══════════════════════════════════════════════════════════════════════════════

class GraphAssembler:
    """
    Builds and compiles the LangGraph StateGraph from GraphNodes.
    Follows Open/Closed Principle — add new nodes without modifying this class.
    """

    def __init__(self, nodes: GraphNodes) -> None:
        self._nodes = nodes

    def build(self):
        g = StateGraph(MultiPdfReportState)

        g.add_node("prepare",          self._nodes.prepare_node)
        g.add_node("planner",          self._nodes.planner_node)
        g.add_node("analyze_document", self._nodes.analyze_document_node)
        g.add_node("reduce_docs",      self._nodes.reduce_docs_node)

        g.set_entry_point("prepare")
        g.add_edge("prepare",  "planner")
        g.add_conditional_edges("planner", self._nodes.fan_out_docs)
        g.add_edge("analyze_document", "reduce_docs")
        g.add_edge("reduce_docs",       END)

        return g.compile()


# ══════════════════════════════════════════════════════════════════════════════
# 18. FACADE  (Pattern: Facade — single public entry point, hides all complexity)
# ══════════════════════════════════════════════════════════════════════════════

class MultiPdfReportFacade:
    """
    The ONLY class external code needs to interact with.
    Wires all collaborating objects; exposes one method: generate().

    Usage:
        facade = MultiPdfReportFacade()
        result = facade.generate(
            filenames=["01 - Properties...pdf", ...],
            query="817M40 hardness limits",
        )
        with open("report.tex", "w") as f:
            f.write(result["latex"])
    """

    def __init__(self, config: AppConfig | None = None) -> None:
        self._config = config or AppConfig()
        self._llm    = LLMProvider.get_instance(self._config)
        self._chroma = ChromaProvider.get_instance(self._config)
        self._nodes  = GraphNodes(self._config, self._llm, self._chroma)
        self._graph  = GraphAssembler(self._nodes).build()

    def generate(
        self,
        filenames:    list[str],
        query:        str,
        report_title: str = "",
        tree_type:    str = "tree",
        search_approach: str = "tree",
        stream_cb:    Callable | None = None,
    ) -> dict:
        """
        Analyse all PDFs for the query and return a single unified CMTI report.

        Args:
            filenames:    PDF filenames (must match ChromaDB collection names).
            query:        Metallurgical topic / material / property to analyse.
            report_title: Optional. Auto-derived from query when blank.
            tree_type:    PageIndex tree structure type: "tree" or "heuristic".
            search_approach: The approach to use for search ("tree" or "vector").
            stream_cb:    Optional callback(event: str, payload: dict).

        Returns:
            {
              "latex":       str,        # Full compilable LaTeX document
              "doc_results": list[dict], # Per-doc: filename/found_data/findings_chars
            }
        """
        if not report_title:
            q    = query.strip()
            skip = (
                "i want", "give me", "can you", "please", "analyze",
                "what is", "how do", "tell me about",
            )
            if q.lower().startswith(skip):
                report_title = "Material Specification Synthesis Report"
            else:
                report_title = f"Material Specification: {q[:60].title()}"

        result = self._graph.invoke({
            "filenames":       filenames,
            "query":           query,
            "report_title":    report_title,
            "stream_cb":       stream_cb,
            "planner_results": [],
            "doc_results":     [],
            "latex_output":    "",
            "tree_type":       tree_type,
            "search_approach": search_approach,
        })

        return {
            "latex": result["latex_output"],
            "doc_results": [
                {
                    "filename":       r["filename"],
                    "found_data":     r.get("found_data", False),
                    "findings_chars": r.get("findings_chars", len(r.get("raw_findings", ""))),
                }
                for r in result["doc_results"]
            ],
        }


# ══════════════════════════════════════════════════════════════════════════════
# 19. BACKWARD-COMPATIBLE MODULE-LEVEL API
# ══════════════════════════════════════════════════════════════════════════════

_facade         = MultiPdfReportFacade()
MULTI_PDF_GRAPH = _facade._graph        # kept for direct graph.invoke() callers


def generate_multi_pdf_report(
    filenames:    list[str],
    query:        str,
    report_title: str = "",
    tree_type:    str = "tree",
    search_approach: str = "tree",
    stream_cb:    Callable | None = None,
) -> dict:
    """Backward-compatible public function — delegates to MultiPdfReportFacade.generate()."""
    return _facade.generate(
        filenames=filenames,
        query=query,
        report_title=report_title,
        tree_type=tree_type,
        search_approach=search_approach,
        stream_cb=stream_cb,
    )