r"""
metall_report_graph.py — CMTI Unified Single-PDF Report Generator (v5.0)

FIXES & ENHANCEMENTS in v5.0:
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

  5. DYNAMIC HEADINGS — Material name derived at runtime by MaterialNameExtractor or
     auto-detected from early chunks; nothing hardcoded in the LaTeX template.

  6. IMITATES MULTI-PDF ARCHITECTURE — Uses the exact same 8-section layout and
     pipeline (Query Planner -> Search -> Analyst JSON Extraction -> Section Writer -> Compliance -> LaTeX Builder).
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
import chromadb


# ══════════════════════════════════════════════════════════════════════════════
# 1. CONFIGURATION (Value Object — immutable, single source of truth)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class AppConfig:
    """
    All environment-driven settings in one immutable Value Object.
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
# 2. KEYWORD TAXONOMY (For backward compatibility / routing)
# ══════════════════════════════════════════════════════════════════════════════

METALL_SECTION_KEYWORDS: dict[str, list[str]] = {
    "scope": [
        "scope", "introduction", "purpose", "general", "document scope", "coverage",
        "background", "applicability",
    ],
    "specifications": [
        "specification", "material specification", "standard", "applicable", "requirements",
        "code", "colour", "color", "equivalent", "as per standard", "supply condition",
        "applicable standard", "material grade", "grade designation", "product description",
        "material class", "classification", "material type", "alloy designation",
        "nominal composition", "material category", "applicable norm",
        "procurement specification", "purchase order", "order requirement",
        "certificate", "certification", "doc no", "document number", "issue date",
        "inspection certificate", "en 10204", "3.1", "3.2", "mill test", "mtr",
        "mill certificate", "test report", "inspection report", "manufacturer name",
        "third party", "tpi", "authorized inspector", "signatory", "stamp",
        "compliance declaration", "mercury free", "radiation free", "weld repair",
        "test certificate ref", "certificate number", "certificate date",
        "issuing authority", "inspection body", "nabl", "a2la", "ilac",
        "lab accreditation", "conformance", "compliance statement",
    ],
    "chemical_composition": [
        "chemical composition", "chemical analysis", "heat analysis", "product analysis",
        "ladle analysis", "wt%", "weight percent", "element", "carbon", "manganese",
        "phosphorus", "sulfur", "sulphur", "silicon", "chromium", "nickel", "molybdenum",
        "vanadium", "copper", "aluminium", "aluminum", "nitrogen", "heat number",
        "min", "max", "minimum", "maximum", "boron", "titanium", "niobium", "columbium",
        "cobalt", "tungsten", "tin", "arsenic", "antimony", "lead", "bismuth",
        "carbon equivalent", "ceq", "pcm", "chemical requirement", "composition limit",
        "check analysis", "product check", "ladle check", "melt analysis",
        "spectrometric analysis", "oes", "xrf", "spark test", "combustion analysis",
        "tramp element", "residual element",
    ],
    "mechanical_properties": [
        "mechanical properties", "mechanical test", "tensile", "yield strength",
        "ultimate tensile", "elongation", "reduction", "impact", "charpy",
        "hardness", "hbs", "hrc", "hrb", "hv", "brinell", "rockwell", "vickers",
        "proof stress", "0.2%", "ksi", "mpa", "n/mm", "hardness as supplied",
        "bend test", "flattening test", "guided bend", "nick break",
        "fracture toughness", "fatigue", "creep", "stress rupture",
        "drop weight", "dynamic tear", "ductility", "tensile test",
        "transverse", "longitudinal", "direction", "specimen", "gauge length",
        "proof load", "breaking load", "rupture", "fracture", "notch",
        "lateral expansion", "shear area", "crystallinity", "fibrous",
        "cvn", "charpy v-notch", "impact energy", "absorbed energy",
        "room temperature", "sub-zero", "low temperature impact",
    ],
    "metallurgical_properties": [
        "microstructure", "micro structure", "metallurgical", "grain size", "grain",
        "astm grain", "austenite", "martensite", "ferrite", "pearlite", "bainite",
        "carbide", "inclusion", "segregation", "phase", "metallography", "etching",
        "nital", "decarburization", "decarburisation", "depth of decarb",
        "band", "harmful band", "inclusion rating", "freedom from defects",
        "is 2853", "astm e112", "is 4163", "astm e45", "is astm e407",
        "thin series", "thick series", "macro etch", "macro-etch",
        "sulphur print", "sulfur print", "baumann test", "solidification",
        "dendritic", "columnar", "equiaxed", "porosity", "shrinkage",
        "hot tear", "cold shut", "laps", "seams", "piping", "segregation band",
        "banding", "microstructural banding", "duplex", "mixed", "tempered",
        "untempered", "retained austenite", "delta ferrite",
    ],
    "heat_treatment": [
        "heat treatment", "annealing", "normalizing", "normalised", "normalized",
        "quenching", "tempering", "hardening", "carburizing", "nitriding",
        "induction", "flame", "soaking", "cooling", "furnace", "temperature",
        "austenitizing", "annealed", "hot rolled", "forged", "condition as supplied",
        "stress relief", "subcritical anneal", "full anneal", "process anneal",
        "solution anneal", "solution treat", "age hardening", "precipitation hardening",
        "solutionising", "ageing", "double temper", "intercritical", "dual phase",
        "thermomechanical", "controlled rolling", "accelerated cooling",
        "direct quench", "lamellar", "spheroidize", "spheroidising",
        "heating rate", "cooling rate", "quench medium", "water quench",
        "oil quench", "polymer quench", "air cool", "furnace cool",
        "soaking time", "holding time", "batch", "continuous", "bell furnace",
    ],
    "test_methods": [
        "surface", "surface condition", "surface quality", "defect", "crack",
        "seam", "lap", "porosity", "slag", "inclusion", "visual inspection",
        "non-destructive", "ndt", "ultrasonic", "magnetic particle", "dye penetrant",
        "is 11371", "physical method", "macro etch", "black", "pickled", "descaled",
        "shot blasted", "ground", "turned", "peeled", "bright drawn",
        "flux indication", "linear indication", "planar defect", "volumetric",
        "radiographic", "x-ray", "eddy current", "acoustic emission",
        "leak test", "pressure test", "hydrostatic", "pneumatic",
        "surface roughness", "ra", "rz", "finish", "coating", "plating",
        "nace", "hic", "ssc", "sohic", "szc", "hydrogen induced",
        "sulfide stress", "sulphide stress", "sour service", "h2s", "hydrogen sulfide",
        "nace mr0175", "iso 15156", "nace tm0284", "nace tm0177",
        "clr", "csr", "ctr", "crack length ratio", "crack sensitivity ratio",
        "crack thickness ratio", "bent beam", "c-ring", "four point bend",
        "stress corrosion cracking", "scc", "pitting", "crevice",
        "intergranular", "igc", "sensitization", "chloride", "stress corrosion",
        "galvanic", "electrochemical", "polarization", "passivation",
        "corrosion rate", "weight loss", "immersion test", "salt spray",
        "maximum hardness", "22 hrc", "250 hv", "hardness limit sour",
        "mercury content", "radiation", "haz hardness", "weld hardness",
        "weld", "welding", "weld repair", "weld procedure", "wps", "pqr",
        "pwht", "post weld heat treatment", "preheat", "interpass",
        "heat input", "weld metal", "haz", "heat affected zone",
        "filler metal", "consumable", "electrode", "wire", "flux",
        "shielding gas", "backing", "root pass", "cap pass", "fill pass",
        "weld joint", "butt weld", "fillet weld", "groove", "bevel",
        "weld inspection", "weld ndt", "radiograph", "ut weld",
        "mt weld", "pt weld", "weld hardness", "weld toughness",
        "repair weld", "weld overlay", "clad", "cladding",
    ],
    "notes_standards": [
        "traceability", "heat number", "lot number", "batch number", "cast number",
        "melt number", "order number", "purchase order", "po number",
        "marking", "stamping", "stencil", "colour marking", "paint marking",
        "chain of custody", "material identity", "pmr", "positive material",
        "xrf verification", "pmi", "material verification", "identity test",
        "authorized signatory", "inspector", "witness", "third party",
        "customer approval", "hold point", "witness point", "review point",
        "itp", "inspection test plan", "qap", "quality assurance plan",
        "material certificate", "test report number", "lab report",
        "dimension", "tolerance", "size", "diameter", "thickness", "width",
        "length", "weight", "cross section", "ovality", "straightness",
        "roundness", "finish", "bar", "rod", "billet", "plate", "pipe",
        "tube", "forging", "casting", "section", "profile", "flat",
        "outer diameter", "od", "inner diameter", "id", "wall thickness",
        "wt", "bore", "flange", "fitting", "nominal size", "dn",
        "schedule", "class", "rating", "pressure rating", "bore",
        "angular", "linear", "geometric", "gdt", "flatness", "perpendicularity",
        "concentricity", "runout", "total runout", "profile", "weight per meter",
        "theoretical weight", "actual weight", "piece weight",
        "test certificate", "mill certificate", "certificate", "certification",
        "test report", "inspection", "compliance", "conformance", "witness",
        "third party", "chemical composition parameters", "guarantee",
        "en 10204", "3.1 certificate", "3.2 certificate", "2.2 certificate",
        "declaration of compliance", "declaration of conformity",
        "inspection document", "test document", "supplementary requirement",
        "additional test", "special test", "customer specification", "notes",
        "caveats", "footnotes", "cross-references",
    ]
}

METALL_SECTIONS_ORDERED = [
    "scope",
    "specifications",
    "chemical_composition",
    "mechanical_properties",
    "metallurgical_properties",
    "heat_treatment",
    "test_methods",
    "notes_standards"
]

SECTION_DISPLAY_NAMES = {
    "scope":                    "Scope",
    "specifications":           "Specifications",
    "chemical_composition":     "Chemical Composition",
    "mechanical_properties":    "Mechanical Properties",
    "metallurgical_properties": "Metallurgical Properties",
    "heat_treatment":           "Heat Treatment",
    "test_methods":             "Test Methods and Inspection",
    "notes_standards":          "Notes and Referenced Standards"
}


# ══════════════════════════════════════════════════════════════════════════════
# 3. SINGLETONS (Pattern: Singleton)
# ══════════════════════════════════════════════════════════════════════════════

class LLMProvider:
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
# 4. RETRY & RATE-LIMIT HANDLER
# ══════════════════════════════════════════════════════════════════════════════

class RetryHandler:
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
                is_rl = any(x in err for x in ["429", "too many request", "rate limit", "ratelimit"])
                is_se = any(x in err for x in ["500", "502", "503", "504"])

                if attempt >= self._config.rl_max_retries - 1:
                    print(f"[RETRY] {label} FAILED after {attempt + 1} attempts: {exc}")
                    return ""

                if is_rl or is_se:
                    m = re.search(r"retry.?after[:\s]+(\d+)", err)
                    delay = self._delay(attempt, int(m.group(1)) if m else None)
                    _emit(stream_cb, "rate_limit", {
                        "label": label,
                        "attempt": attempt + 1,
                        "max": self._config.rl_max_retries - 1,
                        "retry_after": round(delay),
                        "is_rate_limit": is_rl
                    })
                    time.sleep(delay)
                else:
                    print(f"[RETRY] {label} non-retryable error: {exc}")
                    return ""
        return ""


# ══════════════════════════════════════════════════════════════════════════════
# 5. HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _emit(stream_cb, event: str, payload: dict) -> None:
    if stream_cb:
        try:
            stream_cb(event, payload)
        except Exception:
            pass


def _safe_json(raw: str, fallback: dict) -> dict:
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text.strip())
    except Exception:
        return fallback


# ══════════════════════════════════════════════════════════════════════════════
# 6. LATEX SANITIZER
# ══════════════════════════════════════════════════════════════════════════════

class LatexSanitizer:
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
        for ch, rep in [
            ("&", r"\&"), ("%", r"\%"), ("#", r"\#"),
            ("$", r"\$"), ("_", r"\_"),
        ]:
            text = text.replace(ch, rep)
        return text


# ══════════════════════════════════════════════════════════════════════════════
# 7. PROMPTS LIBRARY
# ══════════════════════════════════════════════════════════════════════════════

class PromptsLibrary:
    ANALYST_SYSTEM = """
You are a Senior Metallurgical Engineer at CMTI preparing an official Material
Specification report.

PRECISION MANDATE — CRITICAL:
- Think like a metallurgist reviewing a source document for a specific topic.
- Extract ALL available metallurgical data into the arrays below. Do NOT filter out any technical sections.
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
- Preserve exact numeric values, units, standard codes.
- Output ONLY raw JSON — no markdown fences, no preamble.
"""

    ANALYST_PROMPT = ChatPromptTemplate.from_messages([
        SystemMessage(content=ANALYST_SYSTEM),
        HumanMessagePromptTemplate.from_template(
            "Document: {filename}\nQuery Focus: {query}\n\nCHUNKS:\n{context}\n\nOutput ONLY JSON."
        ),
    ])

    PLANNER_SYSTEM = """
You are a Senior Metallurgist planning a literature search across the reference handbook
to prepare an official CMTI Material Specification report.

Your task: generate 2-4 HIGHLY SPECIFIC metallurgical search queries that would locate
the precise data tables, composition limits, property specifications, and standards
relevant to the query in the document.

THINK LIKE A METALLURGIST:
- Queries should target: composition tables, property limits, standard codes,
  test methods, heat treatment parameters.

Output format:
{
  "search_queries": ["specific metallurgy query 1", "specific query 2", ...]
}

RULES:
- Output ONLY JSON. No markdown fences.
"""

    PLANNER_PROMPT = ChatPromptTemplate.from_messages([
        SystemMessage(content=PLANNER_SYSTEM),
        HumanMessagePromptTemplate.from_template(
            "Query Topic: {query}\nDocument: {filename}\n\nOutput the search plan JSON."
        ),
    ])

    SECTION_WRITER_SYSTEM = r"""
You are a Chief Metallurgical Engineer at CMTI writing one section of an official
Material Specification report for a client. Every number, standard code, and
specification you write must be traceable to the source data provided.

You receive structured data extracted from the source document and must
produce the authoritative LaTeX body for the section.

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
8. If no data available: \textit{No data found in the analysed document.}
9. Temperatures: ALWAYS write degrees Celsius as $^\circ$C or $^{\circ}$C. NEVER write \text$^\circ$ree C.
10. Scientific notation: Must be fully enclosed in math mode, e.g., $28 \times 10^6$ psi. NEVER mix text/math like 28\times10$^{6}$.

CONTENT RULES:
- Write as an authoritative specification.
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
            "Source Data:\n{combined_data}\n\n"
            r"Write ONLY the LaTeX body for this section. No \section{{}} heading."
        ),
    ])


# ══════════════════════════════════════════════════════════════════════════════
# 8. SEARCH STRATEGY
# ══════════════════════════════════════════════════════════════════════════════

class SearchStrategy:
    def __init__(self, config: AppConfig, chroma_provider: ChromaProvider, llm_provider: LLMProvider) -> None:
        self._config = config
        self._chroma = chroma_provider
        self._llm = llm_provider

    def search(self, filename: str, queries: list[str], tree_type: str = "tree", search_approach: str = "tree") -> list[dict]:
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
            try:
                from services.pageindex_search import route_and_extract_pages
                
                llm = self._llm.get_llm()
                def llm_invoke(prompt: str) -> str:
                    return llm.invoke(prompt).content.strip()
                    
                for _, extracted_hits in route_and_extract_pages(combined_query, filename, tree_type, effective_max_pages, llm_invoke):
                    if extracted_hits:
                        for h in extracted_hits:
                            if h["text"] not in seen:
                                seen.add(h["text"])
                                hits.append(h)
            except Exception as e:
                print(f"[PAGEINDEX-RAG] Fallback: Tree routing failed for {filename}: {e}")
            
            if hits:
                return hits[:max_hits]

        # Vector search fallback or direct approach
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

    def hits_to_context(self, hits: list[dict]) -> str:
        return "\n".join(
            f"[p.{h['page']} | score:{h.get('score', 1.0)}]\n{h['text'][:self._config.chunk_trim]}\n"
            for h in hits
        )


# ══════════════════════════════════════════════════════════════════════════════
# 9. DOCUMENT ANALYZER (PageIndex / Vector extraction pipeline)
# ══════════════════════════════════════════════════════════════════════════════

class DocumentAnalyzer:
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
    ) -> dict:
        hits = self._search.search(filename, search_queries, tree_type=tree_type, search_approach=search_approach)
        
        # Fallback to fetching all chunks if search returns empty
        if not hits:
            print(f"[ANALYZER] Search returned empty hits. Fetching all chunks for '{filename}'.")
            all_chunks = _fetch_all_chunks(filename)
            hits = [{
                "text": c["text"],
                "page": c["page"],
                "score": 1.0,
                "type": c["type"]
            } for c in all_chunks]

        if not hits:
            return {"document_name": filename, "query_relevance": "none"}

        batches = [
            hits[i:i + self._config.batch_size]
            for i in range(0, len(hits), self._config.batch_size)
        ]
        print(f"[ANALYZER] '{filename}': {len(hits)} hits → {len(batches)} batches")

        parsed_batches: list[dict] = []
        for idx, batch in enumerate(batches):
            _emit(stream_cb, "heartbeat", {"tick": idx + 1})
            parsed_batches.append(
                self._extract_batch(filename, query, batch, stream_cb)
            )

        merged = self._merge_batches(filename, parsed_batches)
        return merged

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
# 10. SECTION WRITER
# ══════════════════════════════════════════════════════════════════════════════

class SectionWriter:
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
            return r"\textit{No data found in the analysed document.}"

        return self._sanitizer.sanitize(raw)


# ══════════════════════════════════════════════════════════════════════════════
# 11. LATEX BUILDER
# ══════════════════════════════════════════════════════════════════════════════

class CmtiReportBuilder:
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
        query:          str,
        filename:       str,
        org_name:       str,
        document_no:    str,
        section_bodies: dict[str, str],
    ) -> str:
        esc          = self._sanitizer.escape
        esc_material = esc(material_name)
        esc_org      = org_name if "\\" in org_name else esc(org_name) if org_name else self._config.org_name
        docno        = document_no if document_no else self._config.doc_number

        parts: list[str] = [
            self._preamble(esc_material, esc_org, docno),
            r"\begin{document}" + "\n\n",
            r"\tableofcontents" + "\n"
            r"\newpage" + "\n\n",
        ]

        for num, title, key in self.SECTIONS:
            body = section_bodies.get(
                key, r"\textit{No data found in the analysed document.}"
            )
            parts.append(f"\\section{{{num}. {title}:}}\n\n{body}\n\n")

        parts.append("\\end{document}\n")
        return "".join(parts)

    def _preamble(
        self,
        esc_material: str,
        esc_org: str,
        docno: str,
    ) -> str:
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
            f" & \\multicolumn{{2}}{{l|}}{{Sources: 1}} \\\\\n"
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
            r"\titleformat{\section}{\normalsize\bfseries}{}{0em}{}",
            r"\titleformat{\subsection}{\normalsize\bfseries}{}{0em}{}",
            r"\pagestyle{fancy}",
            r"\fancyhf{}",
            r"\renewcommand{\headrulewidth}{0pt}",
            r"\fancyhead[C]{%",
            header_table + "%",
            "}",
            r"\fancyfoot[C]{\small\thepage}",
            "",
        ]
        return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════════
# 13. CHROMA DB AND ON-DISK CHUNK FETCH
# ══════════════════════════════════════════════════════════════════════════════

class ChunkData(TypedDict):
    text: str
    page: int
    chunk_index: int
    type: str

def _get_llm() -> ChatLiteLLM:
    return LLMProvider.get_instance(AppConfig()).get_llm()

def _get_chroma_client() -> chromadb.PersistentClient:
    return ChromaProvider.get_instance(AppConfig()).get_client()

def _collection_name(filename: str) -> str:
    return ChromaProvider.collection_name(filename)

def _fetch_all_chunks(filename: str) -> list[ChunkData]:
    chunks_map: dict[tuple[int, int], ChunkData] = {}
    
    # Locate chunks.json
    chunks_path = ""
    for folder in ("uploads", "rag_docs"):
        for suffix in (".chunks.json", ".pdf.chunks.json"):
            p = os.path.join(folder, filename + suffix)
            if os.path.exists(p):
                chunks_path = p
                break
        if chunks_path:
            break
            
    if not chunks_path:
        import glob
        def _norm(s: str) -> str:
            return re.sub(r'[^a-z0-9]', '', s.lower()).replace("pdf", "").replace("txt", "").replace("chunks", "").replace("json", "")
        norm_target = _norm(filename)
        if norm_target:
            candidates = glob.glob(os.path.join("uploads", "*.chunks.json")) + glob.glob(os.path.join("rag_docs", "*.chunks.json"))
            for cand in candidates:
                stem = os.path.basename(cand).replace(".chunks.json", "")
                if _norm(stem) == norm_target:
                    chunks_path = cand
                    break
                    
    if chunks_path and os.path.exists(chunks_path):
        try:
            print(f"[METALL] Loading chunks from on-disk JSON cache: {chunks_path}")
            with open(chunks_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            json_chunks = data.get("chunks", [])
            for c in json_chunks:
                try:    page = int(c.get("page", 0) or 0)
                except: page = 0
                try:    chunk_index = int(c.get("chunk_index", 0) or 0)
                except: chunk_index = 0
                text = c.get("text", "").strip()
                if not text:
                    continue
                norm_key = (page, chunk_index)
                chunks_map[norm_key] = {
                    "text":        text,
                    "page":        page,
                    "chunk_index": chunk_index,
                    "type":        c.get("type", "text"),
                }
        except Exception as e:
            print(f"[METALL] Failed to load chunks.json: {e}")

    client   = _get_chroma_client()
    col_name = _collection_name(filename)
    chroma_chunks_count = 0
    try:
        collection = client.get_collection(col_name)
        total = collection.count()
        print(f"[METALL] Fetching Chroma DB collection '{col_name}' ({total} chunks)...")
        
        batch_size, offset  = 500, 0
        while offset < total:
            result = collection.get(
                include=["documents", "metadatas"],
                limit=batch_size, offset=offset,
            )
            for doc, meta in zip(result["documents"], result["metadatas"]):
                if not doc or not doc.strip():
                    continue
                try:    page = int(meta.get("page", 0) or 0)
                except: page = 0
                try:    chunk_index = int(meta.get("chunk_index", 0) or 0)
                except: chunk_index = 0
                
                key = (page, chunk_index)
                if key not in chunks_map:
                    chunks_map[key] = {
                        "text":        doc,
                        "page":        page,
                        "chunk_index": chunk_index,
                        "type":        meta.get("type", "text"),
                    }
                    chroma_chunks_count += 1
            offset += batch_size
    except Exception as e:
        print(f"[METALL] Collection not found or error loading from Chroma DB: {e}")

    chunks = list(chunks_map.values())
    chunks.sort(key=lambda c: (c["page"], c["chunk_index"]))
    print(f"[METALL] Total unique combined chunks loaded: {len(chunks)} (JSON: {len(chunks_map) - chroma_chunks_count}, Chroma: {chroma_chunks_count})")
    return chunks

def _auto_detect_metadata(chunks: list[ChunkData]) -> tuple[str, str, str, str, str]:
    early_text = "\n".join(c["text"] for c in chunks[:40])[:8000]

    mat_patterns = [
        r"\b(817[Mm]40(?:\s*\([Ee][Nn]\s*24\))?)\b",
        r"\b([Ee][Nn]\s*\d{1,3}[A-Za-z]?\d*\b)",
        r"\b(AISI\s*\d{4}[A-Z]?)\b",
        r"\b(ASTM\s*[A-Z]\d+(?:[/\-][A-Z]?\d*)?(?:\s*Gr\.?\s*[A-Z0-9]+)?)\b",
        r"\b(IS\s*:?\s*\d{4,5}(?:\s*(?:Grade|Gr\.?)\s*[A-Z0-9]+)?)\b",
        r"\b(DIN\s*\d{4,6}[A-Za-z]*)\b",
        r"\b(API\s*5[A-Z]\s*[A-Z]\d+(?:\s*[A-Z0-9]+)?)\b",
        r"\b(ASME\s*SA?\s*\d+(?:\s*Gr\.?\s*[A-Z0-9]+)?)\b",
        r"\b(BS\s*EN\s*\d{4,5}(?:[:\-]\d+)?)\b",
        r"[Mm]aterial\s+[Ss]pecification\s+([A-Z0-9]+(?:[/(][A-Za-z0-9 ]+[)])?)",
        r"[Ss]teel\s+([A-Z0-9]{4,12}(?:\s*\([A-Za-z0-9 ]+\))?)",
        r"[Gg]rade[:\s]+([A-Za-z0-9\-/() ]{3,30})",
        r"[Mm]aterial[:\s]+([A-Za-z0-9\-/() ]{3,30})",
    ]
    material_name = ""
    for pat in mat_patterns:
        m = re.search(pat, early_text, re.IGNORECASE)
        if m:
            material_name = m.group(1).strip()
            break
    if not material_name:
        material_name = "Unknown Material"

    doc_patterns = [
        r"[Dd]oc(?:ument)?\.?\s*[Nn]o\.?\s*[:\-]?\s*([A-Za-z0-9/\-\.]{3,25})",
        r"[Ss]pec(?:ification)?\.?\s*[Nn]o\.?\s*[:\-]?\s*([A-Za-z0-9/\-\.]{3,25})",
        r"[Cc]ert(?:ificate)?\.?\s*[Nn]o\.?\s*[:\-]?\s*([A-Za-z0-9/\-\.]{3,25})",
        r"\b([A-Z]{2,6}/[A-Z]{1,6}/\d{2,6}(?:/[A-Z0-9]+)?)\b",
    ]
    document_no = "N/A"
    for pat in doc_patterns:
        m = re.search(pat, early_text, re.IGNORECASE)
        if m:
            document_no = m.group(1).strip()
            break

    heat_patterns = [
        r"[Hh]eat\s*(?:[Nn]o|[Nn]umber|#|:)[:\s.]*([A-Za-z0-9\-]{3,20})",
        r"[Cc]ast\s*(?:[Nn]o|[Nn]umber|#|:)[:\s.]*([A-Za-z0-9\-]{3,20})",
        r"[Ll]ot\s*(?:[Nn]o|[Nn]umber|#|:)[:\s.]*([A-Za-z0-9\-]{3,20})",
        r"\bHeat[:\s]+([A-Z0-9]{4,15})\b",
    ]
    heat_number = "N/A"
    for pat in heat_patterns:
        m = re.search(pat, early_text, re.IGNORECASE)
        if m:
            heat_number = m.group(1).strip().upper()
            break

    std_patterns = [
        r"(IS\s*:?\s*\d{4,5}(?:[:\-]\d+)?)",
        r"(ASTM\s*[A-Z]\d+(?:[/\-][A-Z]?\d*)?)",
        r"(ASME\s*SA?\s*\d+)",
        r"(ISO\s*\d{4,5}(?:[:\-]\d+)?)",
        r"(EN\s*\d{4,5}(?:[:\-]\d+)?)",
        r"(DIN\s*\d{4,6})",
        r"(API\s*5[A-Z])",
        r"(NACE\s*MR\s*\d{4})",
    ]
    standard = "N/A"
    for pat in std_patterns:
        m = re.search(pat, early_text, re.IGNORECASE)
        if m:
            standard = m.group(1).strip().upper()
            break

    org_patterns = [
        r"([A-Z][A-Za-z\s&\-\.]{5,40}(?:Group|Institute|Ltd|Pvt|Inc|Corp|Dept|Division|Centre|Center))",
        r"(?:prepared by|issued by|organization)[:\s]+([A-Za-z\s&\-\.]{5,40})",
    ]
    org_name = ""
    for pat in org_patterns:
        m = re.search(pat, early_text[:2000], re.IGNORECASE)
        if m:
            org_name = m.group(1).strip()
            break

    print(f"[METALL] Detected: material='{material_name}', doc='{document_no}', "
          f"heat='{heat_number}', std='{standard}', org='{org_name}'")
    return material_name, heat_number, document_no, standard, org_name


# ══════════════════════════════════════════════════════════════════════════════
# 14. LANGGRAPH STATE DEFINITION
# ══════════════════════════════════════════════════════════════════════════════

class MetallReportState(TypedDict):
    filename:        str
    standard_hint:   str
    material_name:   str
    heat_number:     str
    document_no:     str
    org_name:        str
    tree_type:       str
    search_approach: str
    stream_cb:       object
    
    all_chunks:      list[ChunkData]
    planner_results: list[str]
    findings_json:   str
    section_texts:   Annotated[list[dict], operator.add]
    latex_output:    str


# ══════════════════════════════════════════════════════════════════════════════
# 15. GRAPH NODES (Stateless DIP bound methods)
# ══════════════════════════════════════════════════════════════════════════════

class GraphNodes:
    def __init__(self, config: AppConfig, llm_provider: LLMProvider, chroma_provider: ChromaProvider) -> None:
        self._config = config
        self._sanitizer = LatexSanitizer()
        self._retry = RetryHandler(config)
        self._semaphore = threading.Semaphore(config.max_concurrent)
        self._search = SearchStrategy(config, chroma_provider, llm_provider)
        self._analyzer = DocumentAnalyzer(config, llm_provider, self._search, self._retry, self._semaphore)
        self._writer = SectionWriter(llm_provider, self._retry, self._sanitizer, self._semaphore)
        self._builder = CmtiReportBuilder(config, self._sanitizer)
        self._name_extractor = MaterialNameExtractor()

    def prepare_node(self, state: MetallReportState) -> dict:
        _emit(state.get("stream_cb"), "start", {"filename": state["filename"]})
        
        all_chunks = _fetch_all_chunks(state["filename"])
        material_name, heat_number, document_no, detected_std, org_name = _auto_detect_metadata(all_chunks)
        
        return {
            "all_chunks": all_chunks,
            "material_name": state.get("material_name") or material_name,
            "heat_number": state.get("heat_number") or heat_number,
            "document_no": state.get("document_no") or document_no,
            "org_name": state.get("org_name") or org_name,
            "standard_hint": state.get("standard_hint") or detected_std
        }

    def planner_node(self, state: MetallReportState) -> dict:
        filename = state["filename"]
        query_topic = state.get("standard_hint") or "materials specification"
        
        _emit(state.get("stream_cb"), "heartbeat", {"tick": 1})
        
        llm = LLMProvider.get_instance(self._config).get_llm()
        chain = PromptsLibrary.PLANNER_PROMPT | llm | StrOutputParser()
        raw = self._retry.invoke(
            chain,
            {"filename": filename, "query": query_topic},
            "Planner",
            stream_cb=state.get("stream_cb")
        )
        
        parsed = _safe_json(raw, {})
        queries = parsed.get("search_queries") or [query_topic]
        
        # Fire structure event once sections and total chunks are known
        _emit(state.get("stream_cb"), "structure", {
            "sections_found": METALL_SECTIONS_ORDERED,
            "total_chunks": len(state["all_chunks"]),
            "material": state["material_name"],
            "heat": state["heat_number"]
        })
        
        return {"planner_results": queries}

    def search_and_analyze_node(self, state: MetallReportState) -> dict:
        filename = state["filename"]
        query_topic = state.get("standard_hint") or "materials specification"
        
        merged_findings = self._analyzer.analyze(
            filename=filename,
            query=query_topic,
            search_queries=state["planner_results"],
            tree_type=state.get("tree_type", "tree"),
            search_approach=state.get("search_approach", "tree"),
            stream_cb=state.get("stream_cb")
        )
        
        return {"findings_json": json.dumps(merged_findings, indent=2)}

    def write_sections_node(self, state: MetallReportState) -> dict:
        findings = json.loads(state["findings_json"])
        query_topic = state.get("standard_hint") or "materials specification"
        filename = state["filename"]
        stream_cb = state.get("stream_cb")

        # Deterministic Section 1: SCOPE
        scope_text = findings.get("scope", "")
        scope_body = self._build_scope(query_topic, filename, scope_text)
        
        _emit(stream_cb, "section_start", {"section_key": "scope", "display_name": "Scope"})
        _emit(stream_cb, "section_extracted", {"section_key": "scope", "display_name": "Scope"})
        _emit(stream_cb, "section_done", {"section_key": "scope", "display_name": "Scope"})
        _emit(stream_cb, "section_ready", {
            "section_key": "scope",
            "display_name": "Scope",
            "latex_chars": len(scope_body),
            "latex_body": scope_body,
            "latex_preview": scope_body[:600],
            "raw_json": json.dumps({"scope": scope_text})
        })

        results = [{
            "section_key": "scope",
            "raw_json": json.dumps({"scope": scope_text}),
            "latex_body": scope_body
        }]

        # Sequential LLM writing for sections 2-7
        sections_to_write = [
            ("specifications", "Specifications", findings.get("specifications", [])),
            ("chemical_composition", "Chemical Composition", findings.get("chemical_composition", {})),
            ("mechanical_properties", "Mechanical Properties", findings.get("mechanical_properties", [])),
            ("metallurgical_properties", "Metallurgical Properties", findings.get("metallurgical_properties", [])),
            ("heat_treatment", "Heat Treatment", findings.get("heat_treatment", [])),
            ("test_methods", "Test Methods and Inspection", findings.get("test_methods", [])),
        ]

        for s_key, s_display, s_data in sections_to_write:
            _emit(stream_cb, "section_start", {"section_key": s_key, "display_name": s_display})
            _emit(stream_cb, "section_extracted", {"section_key": s_key, "display_name": s_display})
            
            body = self._writer.write(
                section_name=s_display.upper(),
                query=query_topic,
                combined_data=s_data,
                stream_cb=stream_cb
            )
            
            _emit(stream_cb, "section_done", {"section_key": s_key, "display_name": s_display})
            _emit(stream_cb, "section_ready", {
                "section_key": s_key,
                "display_name": s_display,
                "latex_chars": len(body),
                "latex_body": body,
                "latex_preview": body[:600],
                "raw_json": json.dumps(s_data)
            })
            
            results.append({
                "section_key": s_key,
                "raw_json": json.dumps(s_data),
                "latex_body": body
            })

        # Deterministic Section 8: NOTES & REFERENCED STANDARDS
        notes_data = {
            "notes": findings.get("notes", []),
            "source_standards": findings.get("source_standards", [])
        }
        
        _emit(stream_cb, "section_start", {"section_key": "notes_standards", "display_name": "Notes and Referenced Standards"})
        _emit(stream_cb, "section_extracted", {"section_key": "notes_standards", "display_name": "Notes and Referenced Standards"})
        
        notes_body = self._writer.write(
            section_name="NOTES AND REFERENCED STANDARDS",
            query=query_topic,
            combined_data=notes_data,
            stream_cb=stream_cb
        )
        
        _emit(stream_cb, "section_done", {"section_key": "notes_standards", "display_name": "Notes and Referenced Standards"})
        _emit(stream_cb, "section_ready", {
            "section_key": "notes_standards",
            "display_name": "Notes and Referenced Standards",
            "latex_chars": len(notes_body),
            "latex_body": notes_body,
            "latex_preview": notes_body[:600],
            "raw_json": json.dumps(notes_data)
        })
        
        results.append({
            "section_key": "notes_standards",
            "raw_json": json.dumps(notes_data),
            "latex_body": notes_body
        })

        return {"section_texts": results}

    def reduce_node(self, state: MetallReportState) -> dict:
        filename = state["filename"]
        material_name = state["material_name"]
        heat_number = state["heat_number"]
        document_no = state["document_no"]
        org_name = state.get("org_name", "")
        standard_hint = state["standard_hint"]
        
        # Derive material name dynamically from query if the passed one is generic/empty
        if not material_name or material_name.strip().lower() in ("company", "unknown", "unknown material", "n/a", ""):
            material_name = self._name_extractor.extract(standard_hint or "")

        stream_cb = state.get("stream_cb")
        section_texts = state["section_texts"]

        _emit(stream_cb, "assembling", {"section_count": len(section_texts)})

        section_bodies = {
            "scope_body": next((s["latex_body"] for s in section_texts if s["section_key"] == "scope"), ""),
            "specifications": next((s["latex_body"] for s in section_texts if s["section_key"] == "specifications"), ""),
            "chemical_compositions": next((s["latex_body"] for s in section_texts if s["section_key"] == "chemical_composition"), ""),
            "mechanical_properties": next((s["latex_body"] for s in section_texts if s["section_key"] == "mechanical_properties"), ""),
            "metallurgical_properties": next((s["latex_body"] for s in section_texts if s["section_key"] == "metallurgical_properties"), ""),
            "heat_treatment": next((s["latex_body"] for s in section_texts if s["section_key"] == "heat_treatment"), ""),
            "test_methods": next((s["latex_body"] for s in section_texts if s["section_key"] == "test_methods"), ""),
            "notes_standards": next((s["latex_body"] for s in section_texts if s["section_key"] == "notes_standards"), ""),
        }

        latex = self._builder.build(
            material_name=material_name,
            query=standard_hint,
            filename=filename,
            org_name=org_name,
            document_no=document_no,
            section_bodies=section_bodies,
        )

        _emit(stream_cb, "done", {
            "latex":       latex,
            "char_count":  len(latex),
            "latex_chars": len(latex),
            "sections":    len(section_texts)
        })

        return {"latex_output": latex}

    def _build_scope(self, query: str, filename: str, scope_text: str) -> str:
        esc = self._sanitizer.escape
        lines = [
            f"This specification consolidates and presents the technical supply conditions "
            f"and material data related to \\textit{{{esc(query)}}}, "
            f"synthesised from the source document \\textbf{{{esc(filename.replace('_', ' ').replace('.pdf', ''))}}}. "
            "All requirements presented in this document represent the findings "
            "extracted from the analysed source. The supplier shall satisfy all specifications "
            "defined in the sections below.\n\n",
        ]
        if scope_text and scope_text.strip():
            lines.append(f"\\textbf{{Scope of Analysed Document:}}\n\n{self._sanitizer.sanitize(scope_text.strip())}\n")
        return "".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# 16. MATERIAL NAME EXTRACTOR
# ══════════════════════════════════════════════════════════════════════════════

class MaterialNameExtractor:
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
# 17. GRAPH ASSEMBLER
# ══════════════════════════════════════════════════════════════════════════════

class GraphAssembler:
    def __init__(self, nodes: GraphNodes) -> None:
        self._nodes = nodes

    def build(self):
        g = StateGraph(MetallReportState)

        g.add_node("prepare",             self._nodes.prepare_node)
        g.add_node("planner",             self._nodes.planner_node)
        g.add_node("search_and_analyze", self._nodes.search_and_analyze_node)
        g.add_node("write_sections",      self._nodes.write_sections_node)
        g.add_node("reduce",              self._nodes.reduce_node)

        g.set_entry_point("prepare")
        g.add_edge("prepare",             "planner")
        g.add_edge("planner",             "search_and_analyze")
        g.add_edge("search_and_analyze", "write_sections")
        g.add_edge("write_sections",      "reduce")
        g.add_edge("reduce",              END)

        return g.compile()


# ══════════════════════════════════════════════════════════════════════════════
# 18. FACADE
# ══════════════════════════════════════════════════════════════════════════════

class MetallReportFacade:
    def __init__(self, config: AppConfig | None = None) -> None:
        self._config = config or AppConfig()
        self._llm    = LLMProvider.get_instance(self._config)
        self._chroma = ChromaProvider.get_instance(self._config)
        self._nodes  = GraphNodes(self._config, self._llm, self._chroma)
        self._graph  = GraphAssembler(self._nodes).build()

    def generate(
        self,
        filename:      str,
        standard_hint: str = "",
        material_name: str = "",
        heat_number:   str = "",
        document_no:   str = "",
        org_name:      str = "",
        tree_type:     str = "tree",
        search_approach: str = "tree",
        stream_cb:     Callable | None = None,
    ) -> dict:
        result = self._graph.invoke({
            "filename":        filename,
            "standard_hint":   standard_hint,
            "material_name":   material_name,
            "heat_number":     heat_number,
            "document_no":     document_no,
            "org_name":        org_name,
            "tree_type":       tree_type,
            "search_approach": search_approach,
            "stream_cb":       stream_cb,
            "all_chunks":      [],
            "planner_results": [],
            "findings_json":   "",
            "section_texts":   [],
            "latex_output":    ""
        })

        return {
            "latex": result["latex_output"],
            "extracted": result["section_texts"]
        }


# ══════════════════════════════════════════════════════════════════════════════
# 19. PUBLIC API & BACKWARD COMPATIBLE API
# ══════════════════════════════════════════════════════════════════════════════

_facade = MetallReportFacade()
METALL_GRAPH = _facade._graph

def generate_report(
    filename:      str,
    standard_hint: str = "",
    material_name: str = "",
    heat_number:   str = "",
    document_no:   str = "",
    org_name:      str = "",
    tree_type:     str = "tree",
    search_approach: str = "tree",
    stream_cb:     Callable | None = None,
) -> dict:
    res = _facade.generate(
        filename=filename,
        standard_hint=standard_hint,
        material_name=material_name,
        heat_number=heat_number,
        document_no=document_no,
        org_name=org_name,
        tree_type=tree_type,
        search_approach=search_approach,
        stream_cb=stream_cb
    )
    return {
        "latex": res["latex"],
        "sections": res["extracted"]
    }


# ══════════════════════════════════════════════════════════════════════════════
# 20. CLI ENTRYPOINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Metallurgy Report Generator v5.0")
    parser.add_argument("filename",    help="PDF filename key in ChromaDB")
    parser.add_argument("--standard",  default="", help="Standard e.g. 'IS 11185'")
    parser.add_argument("--material",  default="", help="Material e.g. '817M40 (EN24)'")
    parser.add_argument("--heat",      default="", help="Heat number")
    parser.add_argument("--docno",     default="", help="Document number e.g. CRM/MS/01")
    parser.add_argument("--org",       default="", help="Organisation name e.g. 'CMTI'")
    parser.add_argument("--output",    default="metall_report.tex", help="Output .tex file")
    args = parser.parse_args()

    def cli_cb(event: str, data: dict):
        print(f"  [{event}] {data}")

    print(f"[METALL] Generating report for: {args.filename}")
    result = generate_report(
        filename      = args.filename,
        standard_hint = args.standard,
        material_name = args.material,
        heat_number   = args.heat,
        document_no   = args.docno,
        org_name      = args.org,
        stream_cb     = cli_cb,
    )

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(result["latex"])
    print(f"[METALL] LaTeX saved to: {args.output}")