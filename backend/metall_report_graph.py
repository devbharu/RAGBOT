"""
metall_report_graph.py  -- Multi-Agent Metallurgy Report Generator (v4)
Improvements over v3:
  - RATE-LIMIT AWARE: exponential back-off with SSE notification to frontend
  - SSE streaming callback extended: emits 'rate_limit' event with retry_after
  - Report format matches CMTI standard: header block with Doc.No, Sheet, Page
  - LaTeX preamble generates CMTI-style title block (logo placeholder + table)
  - Compliance table with proper \\cmark / \\xmark
  - MAX_CONCURRENT_SECTIONS lowered default to avoid hammering rate limits
  - Jitter added to retry delays to avoid thundering herd
"""

from __future__ import annotations

import os, re, json, time, threading, random
from typing import TypedDict, Annotated, Callable
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

SECTION_CONTEXT_LIMIT   = int(os.getenv("SECTION_CONTEXT_LIMIT",   "300000"))
CHUNK_TRIM              = int(os.getenv("CHUNK_TRIM",              "8000"))
MAX_CONCURRENT_SECTIONS = int(os.getenv("MAX_CONCURRENT_SECTIONS", "5"))

# Rate-limit retry config
RL_MAX_RETRIES  = int(os.getenv("RL_MAX_RETRIES",  "5"))
RL_BASE_DELAY   = float(os.getenv("RL_BASE_DELAY",  "10"))
RL_MAX_DELAY    = float(os.getenv("RL_MAX_DELAY",   "120"))
RL_JITTER       = float(os.getenv("RL_JITTER",      "0.3"))

_section_semaphore = threading.Semaphore(MAX_CONCURRENT_SECTIONS)

# ──────────────────────────────────────────────────────────────
# Metallurgy section taxonomy
# ──────────────────────────────────────────────────────────────

METALL_SECTION_KEYWORDS: dict[str, list[str]] = {
    "scope_specification": [
        "scope", "specification", "material specification", "standard", "applicable",
        "introduction", "purpose", "general", "requirements", "code", "colour", "color",
        "equivalent", "as per standard", "supply condition", "applicable standard",
        "material grade", "grade designation", "product description", "material class",
        "classification", "material type", "alloy designation", "nominal composition",
        "material category", "applicable norm", "procurement specification",
        "purchase order", "order requirement", "document scope", "coverage",
    ],
    "certification_metadata": [
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
    "microstructure": [
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
    "surface_quality": [
        "surface", "surface condition", "surface quality", "defect", "crack",
        "seam", "lap", "porosity", "slag", "inclusion", "visual inspection",
        "non-destructive", "ndt", "ultrasonic", "magnetic particle", "dye penetrant",
        "is 11371", "physical method", "macro etch", "black", "pickled", "descaled",
        "shot blasted", "ground", "turned", "peeled", "bright drawn",
        "flux indication", "linear indication", "planar defect", "volumetric",
        "radiographic", "x-ray", "eddy current", "acoustic emission",
        "leak test", "pressure test", "hydrostatic", "pneumatic",
        "surface roughness", "ra", "rz", "finish", "coating", "plating",
    ],
    "corrosion_sour_service": [
        "corrosion", "nace", "hic", "ssc", "sohic", "szc", "hydrogen induced",
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
    ],
    "welding_related": [
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
    "traceability_compliance": [
        "traceability", "heat number", "lot number", "batch number", "cast number",
        "melt number", "order number", "purchase order", "po number",
        "marking", "stamping", "stencil", "colour marking", "paint marking",
        "chain of custody", "material identity", "pmr", "positive material",
        "xrf verification", "pmi", "material verification", "identity test",
        "authorized signatory", "inspector", "witness", "third party",
        "customer approval", "hold point", "witness point", "review point",
        "itp", "inspection test plan", "qap", "quality assurance plan",
        "material certificate", "test report number", "lab report",
    ],
    "dimensions_tolerances": [
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
    ],
    "test_certificate": [
        "test certificate", "mill certificate", "certificate", "certification",
        "test report", "inspection", "compliance", "conformance", "witness",
        "third party", "chemical composition parameters", "guarantee",
        "en 10204", "3.1 certificate", "3.2 certificate", "2.2 certificate",
        "declaration of compliance", "declaration of conformity",
        "inspection document", "test document", "supplementary requirement",
        "additional test", "special test", "customer specification",
    ],
}

METALL_SECTIONS_ORDERED = [
    "scope_specification",
    "certification_metadata",
    "chemical_composition",
    "mechanical_properties",
    "microstructure",
    "heat_treatment",
    "surface_quality",
    "corrosion_sour_service",
    "welding_related",
    "traceability_compliance",
    "dimensions_tolerances",
    "test_certificate",
]

SECTION_DISPLAY_NAMES = {
    "scope_specification":    "Scope and Specification",
    "certification_metadata": "Certification Metadata",
    "chemical_composition":   "Chemical Composition",
    "mechanical_properties":  "Mechanical Properties",
    "microstructure":         "Microstructure and Metallurgical Properties",
    "heat_treatment":         "Heat Treatment",
    "surface_quality":        "Surface Quality and NDT Inspection",
    "corrosion_sour_service": "Corrosion Testing and Sour Service Compliance",
    "welding_related":        "Welding and Post-Weld Heat Treatment",
    "traceability_compliance":"Traceability and Compliance",
    "dimensions_tolerances":  "Dimensions and Tolerances",
    "test_certificate":       "Test Certificate and Conformance",
}

# ──────────────────────────────────────────────────────────────
# State types
# ──────────────────────────────────────────────────────────────

class ChunkData(TypedDict):
    text: str
    page: int
    chunk_index: int
    type: str

class MetallSectionInput(TypedDict):
    section_key:   str
    chunks:        list[ChunkData]
    filename:      str
    standard_hint: str
    stream_cb:     object

class ExtractedData(TypedDict):
    section_key: str
    raw_json:    str
    latex_body:  str

class MetallReportState(TypedDict):
    filename:      str
    standard_hint: str
    material_name: str
    heat_number:   str
    document_no:   str
    org_name:      str
    all_chunks:    list[ChunkData]
    section_map:   list[dict]
    extracted:     Annotated[list[ExtractedData], operator.add]
    latex_output:  str
    stream_cb:     object

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
# Rate-limit aware retry with SSE notification
# ──────────────────────────────────────────────────────────────

def _calc_delay(attempt: int, retry_after: int | None = None) -> float:
    if retry_after and retry_after > 0:
        base = float(retry_after)
    else:
        base = min(RL_BASE_DELAY * (2 ** attempt), RL_MAX_DELAY)
    jitter = base * RL_JITTER * (random.random() * 2 - 1)
    return max(1.0, base + jitter)


def _invoke_with_retry(
    chain,
    inputs: dict,
    label: str,
    max_retries: int = RL_MAX_RETRIES,
    stream_cb=None,
) -> str:
    for attempt in range(max_retries):
        try:
            result = chain.invoke(inputs)
            return result
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = any(x in err_str for x in ["429", "too many request", "rate limit", "ratelimit"])
            is_server_err = any(x in err_str for x in ["500", "502", "503", "504"])

            if attempt >= max_retries - 1:
                print(f"[METALL] {label} FAILED after {max_retries} attempts: {e}")
                return ""

            if is_rate_limit or is_server_err:
                retry_after = None
                m = re.search(r"retry.?after[:\s]+(\d+)", err_str)
                if m:
                    retry_after = int(m.group(1))

                delay = _calc_delay(attempt, retry_after)
                print(f"[METALL] {label} {'rate-limited' if is_rate_limit else 'server error'} "
                      f"-- retry {attempt + 1}/{max_retries - 1} in {delay:.1f}s")

                if stream_cb:
                    try:
                        stream_cb("rate_limit", {
                            "label":         label,
                            "attempt":       attempt + 1,
                            "max":           max_retries - 1,
                            "retry_after":   round(delay),
                            "is_rate_limit": is_rate_limit,
                        })
                    except Exception:
                        pass

                time.sleep(delay)
                continue
            else:
                print(f"[METALL] {label} non-retryable error: {e}")
                return ""

    return ""

# ──────────────────────────────────────────────────────────────
# ChromaDB fetch
# ──────────────────────────────────────────────────────────────

def _fetch_all_chunks(filename: str) -> list[ChunkData]:
    client   = _get_chroma_client()
    col_name = _collection_name(filename)
    try:
        collection = client.get_collection(col_name)
    except Exception as e:
        print(f"[METALL] Collection not found for '{filename}': {e}")
        return []

    total = collection.count()
    print(f"[METALL] Fetching ALL {total} chunks...")

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
    print(f"[METALL] Loaded {len(chunks)} chunks")
    return chunks

def fetch_all_chunks_node(state: MetallReportState) -> dict:
    return {"all_chunks": _fetch_all_chunks(state["filename"])}

# ──────────────────────────────────────────────────────────────
# Chunk classifier
# ──────────────────────────────────────────────────────────────

def _score_chunk(text: str) -> dict[str, float]:
    text_lower = text.lower()
    scores: dict[str, float] = {k: 0.0 for k in METALL_SECTION_KEYWORDS}
    for section, keywords in METALL_SECTION_KEYWORDS.items():
        for kw in keywords:
            count = text_lower.count(kw)
            if count:
                weight = 1.0 + len(kw) * 0.1
                scores[section] += weight * (1.0 + 0.3 * (count - 1))
    return scores


def _classify_chunks(chunks: list[ChunkData]) -> dict[str, list[ChunkData]]:
    section_map: dict[str, list[ChunkData]] = {k: [] for k in METALL_SECTION_KEYWORDS}
    for chunk in chunks:
        scores = _score_chunk(chunk["text"])
        best_score = max(scores.values())
        if best_score == 0:
            section_map["scope_specification"].append(chunk)
            continue
        threshold = best_score * 0.75
        assigned  = [k for k, v in scores.items() if v >= threshold]
        for key in assigned:
            section_map[key].append(chunk)
    for key, clist in section_map.items():
        print(f"[METALL] '{key}' -> {len(clist)} chunks")
    return section_map


def _auto_detect_metadata(chunks: list[ChunkData]) -> tuple[str, str, str, str, str]:
    """Returns: (material_name, heat_number, document_no, standard, org_name)"""
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


def discover_metall_structure_node(state: MetallReportState) -> dict:
    chunks = state["all_chunks"]
    if not chunks:
        return {"section_map": [], "material_name": "Unknown", "heat_number": "N/A",
                "document_no": "N/A", "org_name": ""}

    material_name, heat_number, document_no, detected_std, org_name = _auto_detect_metadata(chunks)
    standard_hint = state.get("standard_hint") or detected_std

    section_map_raw = _classify_chunks(chunks)
    section_map = [
        {"key": key, "chunks": section_map_raw[key]}
        for key in METALL_SECTIONS_ORDERED
        if section_map_raw.get(key)
    ]

    cb = state.get("stream_cb")
    if cb:
        try:
            cb("structure", {
                "sections_found": [s["key"] for s in section_map],
                "total_chunks":   len(chunks),
                "material":       state.get("material_name") or material_name,
                "heat":           state.get("heat_number") or heat_number,
            })
        except Exception:
            pass

    return {
        "section_map":   section_map,
        "material_name": state.get("material_name") or material_name,
        "heat_number":   state.get("heat_number")   or heat_number,
        "document_no":   document_no,
        "standard_hint": standard_hint,
        "org_name":      org_name,
    }

# ──────────────────────────────────────────────────────────────
# Fan-out
# ──────────────────────────────────────────────────────────────

def fan_out_metall_sections(state: MetallReportState) -> list[Send]:
    section_map   = state["section_map"]
    filename      = state["filename"]
    standard_hint = state.get("standard_hint", "")
    stream_cb     = state.get("stream_cb")

    if not section_map:
        return [Send("extract_and_write_section", {
            "section_key":   "scope_specification",
            "chunks":        state.get("all_chunks", [])[:100],
            "filename":      filename,
            "standard_hint": standard_hint,
            "stream_cb":     stream_cb,
        })]

    sends = [
        Send("extract_and_write_section", {
            "section_key":   s["key"],
            "chunks":        s["chunks"],
            "filename":      filename,
            "standard_hint": standard_hint,
            "stream_cb":     stream_cb,
        })
        for s in section_map
    ]
    print(f"[METALL] Fan-out -> {len(sends)} section agents")
    return sends

# ──────────────────────────────────────────────────────────────
# AGENT 1: Extractor
# ──────────────────────────────────────────────────────────────

_EXTRACTOR_SYSTEM = """
You are a Senior Metallurgical Data Extraction Agent.
Your task is to parse raw text from ANY type of metallurgy document:
  - Material Test Reports (MTR / Mill Test Certificates)
  - Material Specifications / Procurement Specifications
  - EN 10204 3.1 / 3.2 Inspection Certificates
  - Foundry / Forging / Casting Reports
  - NACE/Sour-Service Test Reports
  - Weld Procedure / PWHT Records
  - NDT Inspection Certificates
  - Dimensional / Weight Certificates

OUTPUT: A single valid JSON object. No markdown fences. No preamble. No explanation.

FLEXIBLE SCHEMA -- include ONLY keys for which you found data. Never invent values.

{
  "certification_metadata": {
    "manufacturer_name":    {"value": "...", "page": 0},
    "doc_no":               {"value": "...", "page": 0},
    "inspection_type":      {"value": "EN 10204 3.1 / 3.2 / 2.2", "page": 0},
    "issue_date":           {"value": "DD-MM-YYYY", "page": 0},
    "test_certificate_ref": {"value": "...", "status": "Provided/Guaranteed", "page": 0},
    "lab_name":             {"value": "...", "page": 0},
    "lab_accreditation":    {"value": "NABL / A2LA / ILAC / None", "page": 0},
    "authorized_signatory": {"name": "...", "designation": "...", "page": 0},
    "third_party_inspector":{"name": "...", "agency": "...", "stamp_ref": "...", "page": 0},
    "purchase_order_ref":   {"value": "...", "page": 0},
    "customer_name":        {"value": "...", "page": 0},
    "compliance_statements": {
      "mercury_free":       {"status": "Yes/No/Not Stated", "page": 0},
      "radiation_free":     {"status": "Yes/No/Not Stated", "page": 0},
      "weld_repair_status": {"value": "...", "page": 0},
      "pmi_verified":       {"status": "Yes/No/Not Stated", "method": "XRF/OES", "page": 0}
    }
  },
  "material_identification": {
    "material_name":   {"value": "...", "page": 0},
    "colour_code":     {"value": "...", "page": 0},
    "equivalent_standards": [
      {"standard": "IS 11185", "grade": "40Ni6Cr4Mo3", "page": 0}
    ],
    "heat_number":     {"value": "...", "page": 0},
    "lot_batch_number":{"value": "...", "page": 0},
    "product_form":    {"value": "Plate/Pipe/Bar/Forging/Casting/Fitting", "page": 0},
    "supply_condition":{"value": "Annealed/Normalized/Q+T/As-Rolled/As-Forged", "page": 0},
    "dimensions": {
      "nominal_size":   {"value": null, "unit": "mm/inch", "page": 0},
      "outer_diameter": {"value": null, "unit": "mm", "page": 0},
      "wall_thickness":  {"value": null, "unit": "mm", "page": 0},
      "length":         {"value": null, "unit": "mm", "page": 0},
      "weight_per_m":   {"value": null, "unit": "kg/m", "page": 0},
      "total_weight":   {"value": null, "unit": "kg", "page": 0},
      "quantity":       {"value": null, "unit": "nos", "page": 0}
    }
  },
  "chemical_composition": {
    "analysis_type": "Ladle / Product / Check / Spectrometric",
    "elements": [
      {"element": "C",  "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "Si", "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "Mn", "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "P",  "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "S",  "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "Cr", "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "Ni", "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0},
      {"element": "Mo", "min": null, "max": null, "actual": null, "unit": "wt%", "page": 0}
    ],
    "carbon_equivalent": {"value": null, "formula": "IIW / Pcm", "page": 0},
    "pcm_value":         {"value": null, "page": 0}
  },
  "mechanical_properties": {
    "hardness_as_supplied": {"min": null, "max": null, "actual": null, "unit": "HBS/HRC/HV", "page": 0},
    "tensile_tests": [
      {
        "direction":        "L/T/Radial",
        "test_temp":        {"value": null, "unit": "degC"},
        "yield_strength":   {"actual": null, "min": null, "unit": "MPa", "page": 0},
        "tensile_strength": {"actual": null, "min": null, "unit": "MPa", "page": 0},
        "elongation":       {"actual": null, "min": null, "unit": "%",   "page": 0},
        "reduction_of_area":{"actual": null, "min": null, "unit": "%",   "page": 0}
      }
    ],
    "impact_tests": [
      {
        "type":             "Charpy V-Notch / Izod",
        "direction":        "L/T",
        "temp":             {"value": null, "unit": "degC", "page": 0},
        "individual":       [null, null, null],
        "average":          {"value": null, "unit": "J",  "page": 0},
        "minimum_single":   {"value": null, "unit": "J",  "page": 0},
        "lateral_expansion":{"value": null, "unit": "mm", "page": 0},
        "shear_area":       {"value": null, "unit": "%",  "page": 0}
      }
    ],
    "bend_test":      {"result": "Pass/Fail", "angle": null, "mandrel": null, "standard": "...", "page": 0},
    "flattening_test":{"result": "Pass/Fail", "page": 0}
  },
  "metallurgical_properties": {
    "austenite_grain_size":  {"value": "...", "standard": "ASTM E112 / IS 2853", "page": 0},
    "inclusion_rating": {
      "thin_series":  {"A": null, "B": null, "C": null, "D": null},
      "thick_series": {"A": null, "B": null, "C": null, "D": null},
      "standard_ref": "IS 4163 / ASTM E45", "page": 0
    },
    "microstructure": {
      "phases":              "e.g. Ferrite & Pearlite / Tempered Martensite",
      "banding_limit":       {"value": null, "unit": "mm"},
      "condition":           "Uniformly distributed / Mixed / Banded",
      "freedom_from_defects":{"value": "...", "standard": "IS 11371"},
      "retained_austenite":  {"value": null, "unit": "%"},
      "delta_ferrite":       {"value": null, "unit": "%"},
      "page": 0
    },
    "macro_etch_test":  {"result": "Satisfactory/Unsatisfactory", "method": "Macro-etch", "page": 0},
    "sulphur_print":    {"result": "...", "page": 0},
    "decarburization":  {"depth": null, "unit": "mm", "standard": "IS 6396", "page": 0}
  },
  "heat_treatment": [
    {
      "process":         "Annealing/Normalizing/Quenching/Tempering/PWHT/Solution Anneal",
      "temp":            {"value": null, "unit": "degC"},
      "holding_time":    "...",
      "cooling_medium":  "Water/Air/Oil/Polymer/Furnace",
      "heating_rate":    {"value": null, "unit": "degC/hr"},
      "cooling_rate":    {"value": null, "unit": "degC/hr"},
      "page": 0
    }
  ],
  "ndt_inspection": [
    {
      "method":     "UT/MT/RT/PT/ET/VT",
      "result":     "Satisfactory/Unsatisfactory/Acceptable",
      "standard":   "IS 11371 / ASME V / EN 10228 / ASTM",
      "coverage":   "100% / Spot",
      "acceptance_level": "...",
      "page": 0
    }
  ],
  "corrosion_sour_service": {
    "nace_compliance": {"status": "Yes/No/N/A", "standard": "NACE MR0175 / ISO 15156", "page": 0},
    "hic_test": {
      "result":   "Pass/Fail",
      "standard": "NACE TM0284",
      "solution": "A/B",
      "clr":      {"value": null, "unit": "%"},
      "csr":      {"value": null, "unit": "%"},
      "ctr":      {"value": null, "unit": "%"},
      "page": 0
    },
    "ssc_test": {
      "result":   "Pass/Fail",
      "standard": "NACE TM0177",
      "method":   "A/B/C/D",
      "stress_level": {"value": null, "unit": "% SMYS"},
      "duration": {"value": null, "unit": "hrs"},
      "page": 0
    },
    "max_hardness_sour": {"value": null, "unit": "HRC/HV", "limit": "22 HRC per NACE MR0175", "page": 0},
    "h2s_partial_pressure": {"value": null, "unit": "kPa", "page": 0}
  },
  "welding": {
    "weld_repair_performed": {"status": "Yes/No", "page": 0},
    "wps_reference":         {"value": "...", "page": 0},
    "pqr_reference":         {"value": "...", "page": 0},
    "pwht": {
      "performed":       "Yes/No",
      "temp":            {"value": null, "unit": "degC"},
      "holding_time":    "...",
      "cooling_medium":  "...",
      "page": 0
    },
    "preheat_temp":     {"value": null, "unit": "degC", "page": 0},
    "interpass_temp":   {"value": null, "unit": "degC", "page": 0},
    "heat_input":       {"value": null, "unit": "kJ/mm", "page": 0},
    "filler_material":  {"value": "...", "classification": "...", "page": 0}
  },
  "traceability": {
    "marking_on_material":  {"value": "Heat stamp / stencil / paint", "matches_cert": null, "page": 0},
    "colour_marking":       {"value": "...", "page": 0},
    "chain_of_custody":     {"value": "...", "page": 0},
    "witness_hold_points":  [{"point": "...", "status": "...", "page": 0}]
  },
  "notes": ["Capture any supplementary requirements, deviations, or special conditions"]
}

EXTRACTION RULES:
1. ONLY output keys where data is found -- skip keys with no data entirely.
2. PRESERVE UNITS exactly as found (HBS, MPa, wt%, mm, J, %). Never convert.
3. Page numbers appear as [p.N] in the context -- use the actual integer N.
4. For chemical composition, list EVERY element found in the document.
5. TARGET vs ACTUAL: spec min/max -> "min"/"max"; batch test results -> "actual".
6. HARDNESS: always include scale (HBS / HRC / HV / HV10).
7. NEVER hallucinate or invent metallurgical data.
8. Output ONLY the raw JSON object -- nothing else.
"""

_EXTRACTOR_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(content=_EXTRACTOR_SYSTEM),
    HumanMessagePromptTemplate.from_template(
        "Document: {filename}\n"
        "Section focus: {section_key}\n"
        "Standard hint: {standard_hint}\n\n"
        "SOURCE TEXT (with page markers):\n{context}\n\n"
        "Extract ALL metallurgy data relevant to section '{section_key}'.\n"
        "Output ONLY the JSON object."
    ),
])

# ──────────────────────────────────────────────────────────────
# AGENT 2: LaTeX Writer
# ──────────────────────────────────────────────────────────────

_WRITER_SYSTEM = r"""You are an expert LaTeX typesetter for metallurgy technical reports.
Style matches CMTI Materials & Metallurgy Group standard (as seen in CRM/MS/01 817M40 (EN24)).

ABSOLUTE PROHIBITIONS:
1. NEVER emit \documentclass, \usepackage, \begin{document}, \end{document}
2. NEVER emit \section{} or \chapter{} -- caller inserts heading
3. NEVER repeat the section heading inside the body
4. NEVER use \verb -- use \texttt{} instead
5. NEVER use raw Unicode -- use LaTeX equivalents
6. NEVER put \caption{} inside a tabular environment
7. NEVER invent data not present in the JSON
8. If JSON has no data, write \textit{No data extracted for this section.} only

FORMATTING RULES:
- Escape special chars outside math: \_ \% \$ \& \# \{ \}
- Units/math: wrap in $...$, e.g. $\geq 180$\,HBS
- Page citations: \textit{(p.\,N)} inline
- \toprule, \midrule, \bottomrule require booktabs (already loaded)
- Use longtable for tables that might overflow a page
- For N/A or null values: write \textemdash{}

CMTI REPORT STYLE:
- Tables must have \hline borders to match CMTI format
- Two-column key|value tables for metadata: left cell \textbf{Key}, right cell value
- Chemical composition: full table with Elements | Min | Max | Others columns
- Hardness: include HBS/HRC/HV scale; show Min and Max in separate columns
- Inclusion rating: thin/thick series in rows 3A 3B 3C 3D / 2A 2B 2C 2D format
- Microstructure: match CMTI bullet-point style with sub-conditions
- Heat treatment: state as "Annealed / Normalized as hot rolled or forged"
- Surface condition: state as "Black" or actual value
- Test certificate: match CMTI guarantee language style

OUTPUT: ONLY LaTeX body content. No headings. No preamble."""

_WRITER_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(content=_WRITER_SYSTEM),
    HumanMessagePromptTemplate.from_template(
        "Document: {filename}\n"
        "Section type: {section_key}\n"
        "Section display name: {section_display_name}\n"
        "Standard: {standard_hint}\n\n"
        "Extracted JSON:\n{extracted_json}\n\n"
        "Write the LaTeX body for this section in CMTI report style.\n"
        r"Do NOT emit a \section{{}} heading. Output ONLY the LaTeX body."
    ),
])

# ──────────────────────────────────────────────────────────────
# Context builder
# ──────────────────────────────────────────────────────────────

def _chunks_to_context(chunks: list[ChunkData]) -> str:
    if not chunks:
        return ""
    by_page: dict[int, list[ChunkData]] = {}
    for c in chunks:
        by_page.setdefault(c["page"], []).append(c)

    parts: list[str] = []
    total = 0
    for page in sorted(by_page.keys()):
        page_chunks = sorted(by_page[page], key=lambda c: c["chunk_index"])
        page_text   = ""
        for c in page_chunks:
            txt = c["text"].strip()
            if txt:
                page_text += txt[:CHUNK_TRIM] + "\n"
        line = f"[p.{page}]\n{page_text.strip()}\n"
        if total + len(line) > SECTION_CONTEXT_LIMIT:
            break
        parts.append(line)
        total += len(line)
    return "\n".join(parts)

# ──────────────────────────────────────────────────────────────
# JSON cleanup helper
# ──────────────────────────────────────────────────────────────

def _parse_json_safe(raw: str, label: str) -> dict:
    text = raw.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\s*```$',          '', text, flags=re.MULTILINE)
    text = text.strip()
    try:
        parsed = json.loads(text)
        print(f"[METALL] {label} JSON ok, keys: {list(parsed.keys())}")
        return parsed
    except json.JSONDecodeError as e:
        print(f"[METALL] {label} JSON error: {e}")
        return {"extraction_note": text[:300]}

# ──────────────────────────────────────────────────────────────
# LaTeX sanitisers
# ──────────────────────────────────────────────────────────────

UNICODE_MAP = {
    "\u202F": "~",       "\u00A0": "~",
    "\u2013": "--",      "\u2014": "---",
    "\u2018": "`",       "\u2019": "'",
    "\u201C": "``",      "\u201D": "''",
    "\u2026": r"\ldots{}",
    "\u00B0": r"$^\circ$",
    "\u00D7": r"$\times$",
    "\u00B1": r"$\pm$",
    "\u2265": r"$\geq$",
    "\u2264": r"$\leq$",
    "\u2260": r"$\neq$",
    "\u03B1": r"$\alpha$",
    "\u03B2": r"$\beta$",
    "\u03C3": r"$\sigma$",
    "\u03BC": r"$\mu$",
    "\u00B5": r"$\mu$",
}

_OPAQUE_RE = re.compile(
    r"(\$\$.*?\$\$|\$[^$\n]*?\$|\\texttt\{[^{}]*\}|\\begin\{[^}]+\}.*?\\end\{[^}]+\})",
    re.DOTALL,
)
_OUTSIDE_MATH_ESCAPES = [("&", r"\&"), ("%", r"\%"), ("#", r"\#")]
_FRAGILE_CMD_RE = re.compile(
    r"\\(?:textbf|textit|texttt|emph|underline|textsc|textsf|mbox|hbox)"
    r"\s*\{((?:[^{}]|\{[^{}]*\})*)\}"
)
_COLOR_CMD_RE = re.compile(r"\\textcolor\s*\{[^{}]*\}\s*\{([^{}]*)\}")
_CAPTION_RE   = re.compile(
    r"\\caption\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}"
)
_SECTION_RE   = re.compile(
    r"(\\(?:sub){0,2}section\*?\s*)\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}"
)

def _apply_outside_opaques(text: str, fn) -> str:
    result, last = [], 0
    for m in _OPAQUE_RE.finditer(text):
        result.append(fn(text[last:m.start()]))
        result.append(m.group(0))
        last = m.end()
    result.append(fn(text[last:]))
    return "".join(result)

def _strip_fragile(inner: str) -> str:
    inner = _COLOR_CMD_RE.sub(lambda m: m.group(1), inner)
    for _ in range(5):
        inner = _FRAGILE_CMD_RE.sub(lambda m: m.group(1), inner)
    inner = re.sub(r"\$[^$]*\$", "", inner)
    inner = re.sub(r"\\(?:cite|ref|eqref|pageref|footnote|label)\s*\{[^{}]*\}", "", inner)
    inner = re.sub(r"\\\\|\n", " ", inner)
    inner = re.sub(r"\\[a-zA-Z]+\{[^{}]*\}", "", inner)
    return re.sub(r"  +", " ", inner).strip()

def _remove_spurious_section_headings(text: str, section_key: str) -> str:
    display = SECTION_DISPLAY_NAMES.get(section_key, "")
    def _heading_matches(heading_text: str) -> bool:
        h = heading_text.lower().strip()
        d = display.lower().replace("\\&", "&").replace("&", "and")
        return h == d or h == d.replace(" and ", " & ") or h == d.replace(" & ", " and ")
    lines     = text.split("\n")
    out_lines = []
    for line in lines:
        m = re.match(r"^\\section\*?\s*\{(.+)\}\s*$", line.strip())
        if m and _heading_matches(m.group(1)):
            continue
        out_lines.append(line)
    result = re.sub(r"\n{3,}", "\n\n", "\n".join(out_lines))
    return result.strip()

def _sanitize_latex(text: str, section_key: str = "") -> str:
    for u, r in UNICODE_MAP.items():
        text = text.replace(u, r)
    def _verb_to_texttt(m: re.Match) -> str:
        content = m.group(2)
        for c, e in [("_", r"\_"), ("{", r"\{"), ("}", r"\}"), ("&", r"\&"),
                     ("%", r"\%"), ("#", r"\#"), ("$", r"\$")]:
            content = content.replace(c, e)
        return r"\texttt{" + content + "}"
    text = re.sub(r"\\verb([^a-zA-Z\s])(.*?)\1", _verb_to_texttt, text, flags=re.DOTALL)
    text = re.sub(r"\\chapter\*?\s*\{", r"\\section{", text)
    text = re.sub(r"\\part\*?\s*\{",    r"\\section{", text)
    text = _apply_outside_opaques(text, lambda c: re.sub(r"(?<!\\)_", r"\\_", c))
    for ch, esc in _OUTSIDE_MATH_ESCAPES:
        pat = r"(?<!\\)" + re.escape(ch)
        text = _apply_outside_opaques(text, lambda c, p=pat, e=esc: re.sub(p, e, c))
    text = _CAPTION_RE.sub(
        lambda m: r"\caption{" + _strip_fragile(m.group(1)) + "}", text
    )
    text = _SECTION_RE.sub(
        lambda m: m.group(1) + "{" + _strip_fragile(m.group(2)) + "}", text
    )
    if section_key:
        text = _remove_spurious_section_headings(text, section_key)
    return text

def _escape_title(text: str) -> str:
    for c, r in [("&", "\\&"), ("%", "\\%"), ("#", "\\#"), ("$", "\\$"), ("_", "\\_")]:
        text = text.replace(c, r)
    return text

# ──────────────────────────────────────────────────────────────
# Two-agent section node
# ──────────────────────────────────────────────────────────────

def extract_and_write_section_node(state: MetallSectionInput) -> dict:
    section_key   = state["section_key"]
    chunks        = state.get("chunks", [])
    filename      = state["filename"]
    standard_hint = state.get("standard_hint", "")
    display_name  = SECTION_DISPLAY_NAMES.get(section_key, section_key.replace("_", " ").title())
    stream_cb     = state.get("stream_cb")

    if not chunks:
        return {"extracted": []}

    context = _chunks_to_context(chunks)
    llm     = _get_llm()

    if stream_cb:
        try:
            stream_cb("section_start", {
                "section_key":  section_key,
                "display_name": display_name,
                "chunk_count":  len(chunks),
            })
        except Exception:
            pass

    print(f"[METALL] AGENT-1 Extractor: '{section_key}' | {len(chunks)} chunks | {len(context):,} chars")
    extractor_chain = _EXTRACTOR_PROMPT | llm | StrOutputParser()

    with _section_semaphore:
        raw_json = _invoke_with_retry(
            extractor_chain,
            {"filename": filename, "section_key": section_key,
             "standard_hint": standard_hint, "context": context},
            f"Extractor/{section_key}",
            stream_cb=stream_cb,
        )

    parsed = _parse_json_safe(raw_json, f"AGENT-1/{section_key}")

    if stream_cb:
        try:
            stream_cb("section_extracted", {
                "section_key":  section_key,
                "display_name": display_name,
                "json_keys":    list(parsed.keys()),
            })
        except Exception:
            pass

    print(f"[METALL] AGENT-2 Writer: '{section_key}'")
    writer_chain = _WRITER_PROMPT | llm | StrOutputParser()

    with _section_semaphore:
        latex_body = _invoke_with_retry(
            writer_chain,
            {
                "filename":             filename,
                "section_key":          section_key,
                "section_display_name": display_name,
                "standard_hint":        standard_hint,
                "extracted_json":       json.dumps(parsed, indent=2),
            },
            f"Writer/{section_key}",
            stream_cb=stream_cb,
        )

    if not latex_body or not latex_body.strip():
        latex_body = r"\textit{No data extracted for this section.}"

    latex_body = _sanitize_latex(latex_body, section_key)
    print(f"[METALL] '{section_key}' done -- {len(latex_body):,} chars LaTeX")

    if stream_cb:
        try:
            stream_cb("section_done", {
                "section_key":   section_key,
                "display_name":  display_name,
                "latex_chars":   len(latex_body),
                "latex_preview": latex_body[:400],
            })
            stream_cb("section_ready", {
                "section_key":   section_key,
                "display_name":  display_name,
                "latex_chars":   len(latex_body),
                "latex_preview": latex_body[:200],
            })
        except Exception:
            pass

    return {"extracted": [{
        "section_key": section_key,
        "raw_json":    json.dumps(parsed, indent=2),
        "latex_body":  latex_body,
    }]}

# ──────────────────────────────────────────────────────────────
# Compliance summary (Agent 3)
# ──────────────────────────────────────────────────────────────

_COMPLIANCE_SYSTEM = r"""You are a senior Metallurgical Engineer writing a compliance summary in CMTI report style.
You receive the combined JSON extracted from ALL sections.

Produce a LaTeX subsection body (NO headings, no \section{}) containing:
1. A compliance table with \hline borders:
   Property | Extracted Value | Standard Requirement | Status
   Status: \cmark{} (Pass) or \xmark{} (Fail) or \textemdash{} (N/A)
2. Two to four concise engineering commentary paragraphs covering:
   - Overall material suitability
   - Critical deviations or concerns
   - Recommended actions if gaps found
   - Traceability chain completeness

RULES:
- Use ONLY data from the JSON -- never invent values.
- Table uses \begin{longtable}{|l|p{3.5cm}|p{3.5cm}|c|} with \hline separators
- Column headers in \textbf{}
- Hardness: specify scale (HBS/HRC/HV) explicitly
- Output ONLY the LaTeX body."""

_COMPLIANCE_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(content=_COMPLIANCE_SYSTEM),
    HumanMessagePromptTemplate.from_template(
        "Material: {material_name}\n"
        "Heat Number: {heat_number}\n"
        "Standard: {standard_hint}\n\n"
        "All extracted JSON:\n{all_json}\n\n"
        "Write the compliance summary LaTeX body."
    ),
])

# ──────────────────────────────────────────────────────────────
# Reduce -- assemble CMTI-style LaTeX document
# ──────────────────────────────────────────────────────────────

def reduce_metall_sections_node(state: MetallReportState) -> dict:
    extracted     = state["extracted"]
    filename      = state["filename"]
    material_name = state.get("material_name", "Unknown Material")
    heat_number   = state.get("heat_number",   "N/A")
    document_no   = state.get("document_no",   "N/A")
    standard_hint = state.get("standard_hint", "N/A")
    org_name      = state.get("org_name",      "Materials \\& Metallurgy Group")
    stream_cb     = state.get("stream_cb")

    order            = {k: i for i, k in enumerate(METALL_SECTIONS_ORDERED)}
    extracted_sorted = sorted(extracted, key=lambda e: order.get(e["section_key"], 99))

    print(f"[METALL] Assembling {len(extracted_sorted)} sections...")

    if stream_cb:
        try:
            stream_cb("assembling", {"section_count": len(extracted_sorted)})
        except Exception:
            pass

    # Build section blocks (numbered like CMTI)
    section_blocks: list[str] = []
    for i, e in enumerate(extracted_sorted, start=1):
        key     = e["section_key"]
        display = SECTION_DISPLAY_NAMES.get(key, key.replace("_", " ").title())
        body    = e["latex_body"].strip()
        display_escaped = _escape_title(display.upper())
        label   = key.replace("_", "-")
        section_blocks.append(
            f"\\section{{{i}.\\enspace {display_escaped}}}\\label{{sec:{label}}}\n\n{body}"
        )

    # Compliance summary
    all_json_combined = json.dumps(
        {e["section_key"]: _parse_json_safe(e["raw_json"], "reduce")
         for e in extracted_sorted if e.get("raw_json")},
        indent=2,
    )[:20000]

    llm = _get_llm()
    compliance_chain = _COMPLIANCE_PROMPT | llm | StrOutputParser()
    try:
        compliance_latex = _invoke_with_retry(
            compliance_chain,
            {"material_name": material_name, "heat_number": heat_number,
             "standard_hint": standard_hint, "all_json": all_json_combined},
            "ComplianceSummary",
            stream_cb=stream_cb,
        )
        compliance_latex = _sanitize_latex(compliance_latex, "")
    except Exception as e:
        compliance_latex = r"\textit{Compliance summary generation failed.}"

    # Escape for LaTeX
    mat_esc  = _escape_title(material_name)
    heat_esc = _escape_title(heat_number)
    doc_esc  = _escape_title(document_no)
    std_esc  = _escape_title(standard_hint)
    org_esc  = (org_name if "\\" in org_name
                else _escape_title(org_name) if org_name
                else "Materials \\& Metallurgy Group")

    body = "\n\n".join(section_blocks)

    # Build preamble as a list of strings (NO bare % lines)
    preamble_lines = [
        "\\documentclass[11pt,a4paper]{article}\n",
        "\\usepackage[utf8]{inputenc}\n",
        "\\usepackage[T1]{fontenc}\n",
        "\\usepackage{textcomp}\n",
        "\\usepackage{caption}\n",
        "\\usepackage[top=2cm,bottom=2.5cm,left=2cm,right=2cm]{geometry}\n",
        "\\usepackage[colorlinks=true,linkcolor=blue,urlcolor=blue,"
        "bookmarksopen=true,pdfborder={0 0 0}]{hyperref}\n",
        "\\usepackage{booktabs,array,longtable,multirow,tabularx,colortbl}\n",
        "\\usepackage{amsmath,amssymb,wasysym}\n",
        "\\usepackage{parskip,xcolor,enumitem}\n",
        "\\usepackage{pifont}\n",
        "\\usepackage{fancyhdr}\n",
        "\\usepackage{titlesec}\n",
        "\\usepackage{graphicx}\n",
        "\\usepackage{bold-extra}\n",
        "\\newcommand{\\cmark}{\\ding{51}}\n",
        "\\newcommand{\\xmark}{\\ding{55}}\n",
        "\\setlist{noitemsep,topsep=3pt}\n",
        "\\renewcommand{\\arraystretch}{1.4}\n",
        "\\DeclareUnicodeCharacter{202F}{~}\n",
        "\\DeclareUnicodeCharacter{00A0}{~}\n\n",
        "\\pdfstringdefDisableCommands{%\n",
        "  \\def\\texttt#1{#1}%\n",
        "  \\def\\textbf#1{#1}%\n",
        "  \\def\\textit#1{#1}%\n",
        "  \\def\\emph#1{#1}%\n",
        "  \\def\\cmark{Pass}%\n",
        "  \\def\\xmark{Fail}%\n",
        "}\n\n",
        # Section style: CMTI bold numbered headings
        "\\titleformat{\\section}{\\normalsize\\bfseries}{}{0em}{}\n",
        "\\titlespacing{\\section}{0pt}{10pt}{4pt}\n",
        "\\titleformat{\\subsection}{\\normalsize\\bfseries}{}{0em}{}\n",
        "\\titlespacing{\\subsection}{0pt}{6pt}{2pt}\n\n",
        # CMTI-style page header
        "\\pagestyle{fancy}\n",
        "\\fancyhf{}\n",
        "\\renewcommand{\\headrulewidth}{0pt}\n",
        "\\fancyhead[L]{\n",
        "  \\setlength{\\tabcolsep}{0pt}%\n",
        "  \\begin{tabular}{|p{2.5cm}|p{6cm}|p{2.5cm}|p{3.5cm}|}\\hline\n",
        "  \\multirow{2}{*}{\\textit{[logo]}} &\n",
        f"  \\centering\\textbf{{{org_esc}}} &\n",
        "  Doc.~No. & " + f"{doc_esc}" + " \\\\\\cline{2-4}\n",
        "  & \\centering\\textit{Material Specification} &\n",
        "  Sheet & \\thepage{} of \\pageref{LastPage} \\\\\\hline\n",
        f"  & \\centering\\textbf{{{mat_esc}}} & & \\\\\\hline\n",
        "  \\end{tabular}%\n",
        "}\n",
        "\\setlength{\\headheight}{52pt}\n",
        "\\addtolength{\\topmargin}{-20pt}\n\n",
        "\\usepackage{lastpage}\n\n",
    ]

    preamble = "".join(preamble_lines)

    latex = (
        preamble
        + "\\begin{document}\n"
        + "\\tableofcontents\n"
        + "\\newpage\n\n"
        + body + "\n\n"
        + f"\\section{{{len(extracted_sorted) + 1}.\\enspace SUMMARY OF COMPLIANCE}}"
        + f"\\label{{sec:compliance}}\n\n"
        + compliance_latex + "\n\n"
        + "\\end{document}"
    )

    if stream_cb:
        try:
            stream_cb("done", {
                "latex":       latex,
                "latex_chars": len(latex),
                "char_count":  len(latex),
                "sections":    len(extracted_sorted),
            })
        except Exception:
            pass

    print(f"[METALL] Final LaTeX -> {len(latex):,} chars")
    return {"latex_output": latex}

# ──────────────────────────────────────────────────────────────
# Build graph
# ──────────────────────────────────────────────────────────────

def build_metall_graph():
    g = StateGraph(MetallReportState)
    g.add_node("fetch_all_chunks",          fetch_all_chunks_node)
    g.add_node("discover_metall_structure", discover_metall_structure_node)
    g.add_node("extract_and_write_section", extract_and_write_section_node)
    g.add_node("reduce_metall_sections",    reduce_metall_sections_node)

    g.set_entry_point("fetch_all_chunks")
    g.add_edge("fetch_all_chunks",          "discover_metall_structure")
    g.add_conditional_edges("discover_metall_structure", fan_out_metall_sections)
    g.add_edge("extract_and_write_section", "reduce_metall_sections")
    g.add_edge("reduce_metall_sections",    END)
    return g.compile()

METALL_GRAPH = build_metall_graph()

# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

def generate_report(
    filename:      str,
    standard_hint: str = "",
    material_name: str = "",
    heat_number:   str = "",
    document_no:   str = "",
    org_name:      str = "",
    stream_cb:     Callable | None = None,
) -> dict:
    """
    Generate a full metallurgy LaTeX report from a ChromaDB-indexed PDF.
    Rate-limit aware with exponential backoff and SSE notifications.
    """
    result = METALL_GRAPH.invoke({
        "filename":      filename,
        "standard_hint": standard_hint,
        "material_name": material_name,
        "heat_number":   heat_number,
        "document_no":   document_no,
        "org_name":      org_name,
        "all_chunks":    [],
        "section_map":   [],
        "extracted":     [],
        "latex_output":  "",
        "stream_cb":     stream_cb,
    })
    return {
        "latex":    result["latex_output"],
        "sections": result["extracted"],
    }

# ──────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Metallurgy Report Generator v4")
    parser.add_argument("filename",    help="PDF filename key in ChromaDB")
    parser.add_argument("--standard",  default="", help="Standard e.g. 'IS 11185'")
    parser.add_argument("--material",  default="", help="Material e.g. '817M40 (EN24)'")
    parser.add_argument("--heat",      default="", help="Heat number")
    parser.add_argument("--docno",     default="", help="Document number e.g. CRM/MS/01")
    parser.add_argument("--org",       default="", help="Organisation name e.g. 'CMTI'")
    parser.add_argument("--output",    default="metall_report.tex", help="Output .tex file")
    parser.add_argument("--max-concurrent", type=int, default=2)
    args = parser.parse_args()

    if args.max_concurrent != MAX_CONCURRENT_SECTIONS:
        import metall_report_graph as _self
        _self._section_semaphore = threading.Semaphore(args.max_concurrent)

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
    print(f"[METALL] Sections generated: {len(result['sections'])}")
    for s in result["sections"]:
        print(f"  - {s['section_key']}: {len(s['latex_body'])} chars LaTeX")