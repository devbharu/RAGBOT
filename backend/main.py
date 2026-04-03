"""
main.py  (v4.1 — image-always fix for ambiguous / visual queries)
──────────────────────────────────────────────────────────────────
Changes over v4
───────────────
FIX 1 → _hits_have_visual_content()
  Checks chunk type, image_path field, AND actual disk existence.
  Previously only checked chunk metadata → missed most visual pages.

FIX 2 → _ask_llm_which_pages() — ambiguous intent shortcut
  Ambiguous + images exist → return up to 2 pages directly.
  No LLM call for ambiguous intent anymore (LLM was too conservative).

FIX 3 → LLM system prompt
  Loosened rules: "when in doubt and images exist, show them".
  Visual intent override: if LLM says no but intent=visual + images on
  disk, we override and show them anyway.

FIX 4 → Visual intent LLM fallback
  If the LLM call throws an exception and intent is visual, we fall back
  to showing the first 2 available pages rather than showing nothing.

All v4 features retained.
"""

from __future__ import annotations

import glob
import json
import math
import os
import re
import threading
import time
import warnings
import asyncio
from typing import Generator

import requests
from flask import Flask, jsonify, request, Response, stream_with_context, send_file
from flask_cors import CORS
from dotenv import load_dotenv

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

from rag_graph    import crag_retrieve
from report_graph import FAST_MODE, generate_report, DEFAULT_SECTIONS

try:
    from rank_bm25 import BM25Okapi
    _BM25_AVAILABLE = True
except ImportError:
    _BM25_AVAILABLE = False
    print("[WARN] rank_bm25 not installed — BM25 hybrid search disabled.")

try:
    from sentence_transformers import CrossEncoder
    _RERANKER_AVAILABLE = True
except ImportError:
    _RERANKER_AVAILABLE = False
    print("[WARN] sentence-transformers not installed — reranker disabled.")

from docling_loader import load_single_file_async

VLM_MAX_CONCURRENT = int(os.getenv("VLM_MAX_CONCURRENT", "5"))
print(f"[INIT] VLM max concurrency: {VLM_MAX_CONCURRENT}")

# ──────────────────────────────────────────────────────────────
# 1. Environment & App Init
# ──────────────────────────────────────────────────────────────
load_dotenv()
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"]   = "1"
warnings.filterwarnings("ignore")

app  = Flask(__name__)
CORS(app)

OLLAMA_HOST      = os.getenv("OLLAMA_HOST",      "http://localhost:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL",     "gpt-oss:120b-cloud")
DOCS_DIR         = "rag_docs"
CHROMA_DIR       = "chroma_db"
UPLOAD_DIR       = "uploads"
PAGE_IMAGE_DIR   = os.path.abspath(os.getenv("PAGE_IMAGE_DIR",   "./page_images"))
RERANK_MODEL     = os.getenv("RERANK_MODEL",     "cross-encoder/ms-marco-MiniLM-L-6-v2")
EMBED_MODEL      = os.getenv("EMBED_MODEL",      "BAAI/bge-small-en-v1.5")
RETRIEVAL_K      = int(os.getenv("RETRIEVAL_K",  "20"))
RERANK_TOP_N     = int(os.getenv("RERANK_TOP_N", "8"))
MMR_LAMBDA       = float(os.getenv("MMR_LAMBDA", "0.5"))

os.makedirs(UPLOAD_DIR,      exist_ok=True)
os.makedirs(DOCS_DIR,        exist_ok=True)
os.makedirs(PAGE_IMAGE_DIR,  exist_ok=True)


# ──────────────────────────────────────────────────────────────
# 2. ChromaDB + Embedding Setup
# ──────────────────────────────────────────────────────────────
print(f"[INIT] Loading embedding model: {EMBED_MODEL} …")

embedding_fn = SentenceTransformerEmbeddingFunction(
    model_name           = EMBED_MODEL,
    normalize_embeddings = True,
)

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

_reranker: "CrossEncoder | None" = None

def _get_reranker():
    global _reranker
    if _reranker is None and _RERANKER_AVAILABLE:
        print(f"[INIT] Loading reranker: {RERANK_MODEL} …")
        _reranker = CrossEncoder(RERANK_MODEL)
    return _reranker


# ──────────────────────────────────────────────────────────────
# 3. Consistent file/image naming  ← SINGLE SOURCE OF TRUTH
# ──────────────────────────────────────────────────────────────

def _safe_filename(filename: str) -> str:
    """
    Sanitise a filename into a safe directory stem.
    Rule: strip extension, replace every non-alphanumeric char with '_'.
    Example: "My Doc (v2).pdf" → "My_Doc__v2_"

    IMPORTANT: docling_loader must use the same rule when it saves page images.
    """
    stem = os.path.splitext(filename)[0]
    return re.sub(r"[^a-zA-Z0-9]", "_", stem)


def _image_dir_for_file(filename: str) -> str:
    """Absolute path to the directory holding page PNGs for *filename*."""
    return os.path.join(PAGE_IMAGE_DIR, _safe_filename(filename))


def _page_image_path(filename: str, page_num: int | str) -> str | None:
    """
    Return the absolute path to page_<N>.png if it exists on disk, else None.
    Always resolves to absolute path so os.path.isfile() works regardless
    of Flask working directory.
    """
    path = os.path.abspath(
        os.path.join(_image_dir_for_file(filename), f"page_{page_num}.png")
    )
    return path if os.path.isfile(path) else None


def _image_url(filename: str, page_num: int | str) -> str:
    """Frontend-accessible URL for a page image."""
    return f"/page-image/{filename}/{page_num}"


# ──────────────────────────────────────────────────────────────
# 4. Indexing status tracker
# ──────────────────────────────────────────────────────────────
_index_status: dict[str, str] = {}
_status_lock                  = threading.Lock()

def _set_status(filename: str, status: str) -> None:
    with _status_lock:
        _index_status[filename] = status

def _get_status(filename: str) -> str:
    with _status_lock:
        return _index_status.get(filename, "unknown")


# ──────────────────────────────────────────────────────────────
# 5. Collection helpers
# ──────────────────────────────────────────────────────────────

def _collection_name(filename: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", filename)
    return f"file_{safe}"


def _get_collection(filename: str):
    return chroma_client.get_or_create_collection(
        name               = _collection_name(filename),
        embedding_function = embedding_fn,
        metadata           = {"hnsw:space": "cosine"},
    )


# ──────────────────────────────────────────────────────────────
# 6. BM25
# ──────────────────────────────────────────────────────────────

def _build_bm25(docs: list[str]) -> "BM25Okapi | None":
    if not _BM25_AVAILABLE or not docs:
        return None
    tokenised = [d.lower().split() for d in docs]
    return BM25Okapi(tokenised)


def _bm25_search(bm25, docs, query, k):
    scores = bm25.get_scores(query.lower().split())
    top_k  = sorted(enumerate(scores), key=lambda x: -x[1])[:k]
    max_s  = top_k[0][1] if top_k and top_k[0][1] > 0 else 1.0
    return [(idx, s / max_s) for idx, s in top_k if s > 0]


# ──────────────────────────────────────────────────────────────
# 7. MMR deduplication
# ──────────────────────────────────────────────────────────────

def _mmr(hits, lambda_=MMR_LAMBDA, top_n=RERANK_TOP_N):
    if len(hits) <= top_n:
        return hits

    def _bow(text):
        counts = {}
        for w in text.lower().split():
            counts[w] = counts.get(w, 0) + 1
        return counts

    def _cos(a, b):
        shared = set(a) & set(b)
        if not shared:
            return 0.0
        dot   = sum(a[k] * b[k] for k in shared)
        norma = math.sqrt(sum(v * v for v in a.values()))
        normb = math.sqrt(sum(v * v for v in b.values()))
        return dot / (norma * normb + 1e-9)

    bows      = [_bow(h["text"]) for h in hits]
    selected  = [0]
    remaining = list(range(1, len(hits)))

    while remaining and len(selected) < top_n:
        scores = []
        for i in remaining:
            relevance  = hits[i]["score"]
            redundancy = max(_cos(bows[i], bows[s]) for s in selected)
            mmr_score  = lambda_ * relevance - (1 - lambda_) * redundancy
            scores.append((i, mmr_score))
        best = max(scores, key=lambda x: x[1])[0]
        selected.append(best)
        remaining.remove(best)

    return [hits[i] for i in selected]


# ──────────────────────────────────────────────────────────────
# 8. RRF fusion
# ──────────────────────────────────────────────────────────────

def _rrf_fuse(dense_hits, bm25_hits, k=60):
    rrf = {}
    for rank, hit in enumerate(dense_hits):
        rrf[rank] = rrf.get(rank, 0.0) + 1.0 / (k + rank + 1)
    for rank, (idx, _) in enumerate(bm25_hits):
        rrf[idx] = rrf.get(idx, 0.0) + 1.0 / (k + rank + 1)
    order = sorted(rrf, key=lambda i: -rrf[i])
    return [dense_hits[i] for i in order if i < len(dense_hits)]


# ──────────────────────────────────────────────────────────────
# 9. Query expansion
# ──────────────────────────────────────────────────────────────

_SYNONYMS = {
    "llm":   ["large language model", "language model"],
    "rag":   ["retrieval augmented generation", "retrieval-augmented"],
    "ai":    ["artificial intelligence"],
    "ml":    ["machine learning"],
    "nlp":   ["natural language processing"],
    "fig":   ["figure", "diagram"],
    "eq":    ["equation"],
    "sec":   ["section"],
    "tbl":   ["table"],
    "def":   ["definition"],
}

def _expand_query(query):
    tokens = query.lower().split()
    extras = []
    for tok in tokens:
        clean = tok.strip(".,;:()")
        if clean in _SYNONYMS:
            extras.extend(_SYNONYMS[clean])
    return (query + " " + " ".join(extras)) if extras else query


# ──────────────────────────────────────────────────────────────
# 10. Core indexing logic
# ──────────────────────────────────────────────────────────────

def _do_index(filepath: str, filename: str, force: bool = False) -> None:
    collection = _get_collection(filename)

    if not force and collection.count() > 0:
        print(f"[CHROMA] '{filename}' already indexed ({collection.count()} chunks). Skipping.")
        _set_status(filename, "ready")
        return

    _set_status(filename, "indexing")
    print(f"\n[CHROMA] ── Indexing: {filename} ──")

    try:
        chunks: list[dict] = asyncio.run(load_single_file_async(filepath, filename))
    except Exception as e:
        msg = f"Loader error: {e}"
        print(f"[CHROMA] ✗ {msg}")
        _set_status(filename, f"error:{msg}")
        return

    if not chunks:
        msg = "No chunks produced"
        print(f"[CHROMA] ✗ {msg} for {filename}")
        _set_status(filename, f"error:{msg}")
        return

    col_name   = _collection_name(filename)
    batch_size = 100

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i: i + batch_size]
        collection.add(
            documents = [c["text"] for c in batch],
            metadatas = [
                {
                    "source":      c.get("source",      filename),
                    "type":        c.get("type",         "text"),
                    "method":      c.get("method",       ""),
                    "page":        str(c.get("page")        or ""),
                    "total_pages": str(c.get("total_pages") or ""),
                    "chunk_index": str(c.get("chunk_index") or i + batch.index(c)),
                    "image_path":  c.get("image_path",   ""),
                }
                for c in batch
            ],
            ids = [f"{col_name}_chunk_{i + j}" for j in range(len(batch))],
        )
        print(f"  [CHROMA] Batch {i // batch_size + 1}: pushed {len(batch)} chunks")

    print(f"[CHROMA] ✓ '{filename}' → {len(chunks)} chunks indexed.")
    _set_status(filename, "ready")


def index_file_background(filepath, filename, force=False):
    t = threading.Thread(
        target=_do_index, args=(filepath, filename, force),
        daemon=True, name=f"indexer-{filename}",
    )
    t.start()
    return t


# ──────────────────────────────────────────────────────────────
# 11. Search
# ──────────────────────────────────────────────────────────────

def search_file(filename: str, query: str, k: int = RETRIEVAL_K) -> list[dict]:
    collection = _get_collection(filename)
    if collection.count() == 0:
        return []

    expanded_query = _expand_query(query)
    n = min(k, collection.count())
    results = collection.query(
        query_texts = [expanded_query],
        n_results   = n,
        include     = ["documents", "metadatas", "distances"],
    )

    dense_hits = []
    for doc, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        dense_hits.append({
            "text":        doc,
            "source":      meta.get("source",      filename),
            "type":        meta.get("type",         "text"),
            "method":      meta.get("method",       ""),
            "page":        meta.get("page",         ""),
            "total_pages": meta.get("total_pages",  ""),
            "chunk_index": meta.get("chunk_index",  ""),
            "image_path":  meta.get("image_path",   ""),
            "score":       round(1 - dist, 4),
        })

    if _BM25_AVAILABLE and dense_hits:
        bm25      = _build_bm25([h["text"] for h in dense_hits])
        bm25_hits = _bm25_search(bm25, [h["text"] for h in dense_hits], expanded_query, k=n)
        hits      = _rrf_fuse(dense_hits, bm25_hits)
    else:
        hits = dense_hits

    hits = _mmr(hits, lambda_=MMR_LAMBDA, top_n=RERANK_TOP_N * 2)

    reranker = _get_reranker()
    if reranker and hits:
        pairs  = [(query, h["text"]) for h in hits]
        scores = reranker.predict(pairs)
        for hit, score in zip(hits, scores):
            hit["rerank_score"] = float(score)
        hits.sort(key=lambda h: h.get("rerank_score", 0), reverse=True)

    return hits[:RERANK_TOP_N]


def list_indexed_files():
    collections = chroma_client.list_collections()
    return [
        col.name.replace("file_", "", 1)
        for col in collections
        if col.name.startswith("file_")
    ]


# ──────────────────────────────────────────────────────────────
# 12. Load default docs on startup
# ──────────────────────────────────────────────────────────────

def _load_default_docs():
    all_files = (
        glob.glob(f"{DOCS_DIR}/**/*.pdf", recursive=True) +
        glob.glob(f"{DOCS_DIR}/**/*.txt", recursive=True)
    )
    if not all_files:
        print("[STARTUP] No default docs found in rag_docs/")
        return
    for filepath in all_files:
        index_file_background(filepath, os.path.basename(filepath))

_load_default_docs()


# ──────────────────────────────────────────────────────────────
# 13. Helpers: clean text, small-talk
# ──────────────────────────────────────────────────────────────

def clean_text(text):
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ",  text)
    return text


_SMALL_TALK = [
    r"^(hi|hello|hey|howdy|hiya|sup|yo)\b",
    r"^how are you",
    r"^what('s| is) up",
    r"^good (morning|afternoon|evening|night)",
    r"^(thanks|thank you|thx|ty)\b",
    r"^(bye|goodbye|see you|cya)\b",
    r"^who are you",
    r"^what (are|can) you do",
    r"^help$",
]

def is_small_talk(query):
    q = query.strip().lower()
    return any(re.search(p, q) for p in _SMALL_TALK)


def handle_small_talk(query):
    q = query.strip().lower()
    if re.search(r"^(hi|hello|hey|howdy|hiya|sup|yo)\b", q):
        return "Hello! Ask me anything about your uploaded document."
    if re.search(r"^how are you", q):
        return "Running great! Ready to answer questions from your documents."
    if re.search(r"^(thanks|thank you|thx|ty)\b", q):
        return "You're welcome! Let me know if you have more questions."
    if re.search(r"^(bye|goodbye|see you|cya)\b", q):
        return "Goodbye! Come back anytime."
    if re.search(r"^who are you", q):
        return "I'm a RAG-powered assistant. Upload a document and ask away!"
    if re.search(r"^what (are|can) you do", q):
        return ("I can answer questions based on the content of your PDFs or text files. "
                "Upload a document and start asking!")
    if re.search(r"^help$", q):
        return "Upload a PDF or TXT, select it, then type your question."
    return "I'm here to help with your documents! Ask me anything."


# ──────────────────────────────────────────────────────────────
# 14. Query intent classification
# ──────────────────────────────────────────────────────────────

_VISUAL_INTENT_PATTERNS = [
    r"\b(show|display|render|visuali[sz]e)\b",
    r"\b(diagram|chart|graph|figure|fig\.?|image|photo|picture|illustration|screenshot)\b",
    r"\b(table|matrix|grid)\b",
    r"\b(slide|page|p\.)\s*\d+",
    r"\bwhat does .+ look like\b",
    r"\bhow does .+ look\b",
    r"\bcan you show\b",
]

_TEXT_INTENT_PATTERNS = [
    r"^(what is|what are|define|explain|describe|summarize|list|tell me about)\b",
    r"\b(steps|procedure|algorithm|method|formula|equation)\b",
    r"\bhow (do|does|can|should|would)\b",
    r"\b(compare|difference|advantage|disadvantage|pros|cons)\b",
    r"\b(when|where|who|why)\b",
]

def _classify_query_intent(query: str) -> str:
    """Returns 'visual' | 'text' | 'ambiguous'."""
    q = query.lower()
    visual_score = sum(1 for p in _VISUAL_INTENT_PATTERNS if re.search(p, q))
    text_score   = sum(1 for p in _TEXT_INTENT_PATTERNS   if re.search(p, q))

    if visual_score > 0 and visual_score >= text_score:
        return "visual"
    if text_score > 0 and text_score > visual_score:
        return "text"
    return "ambiguous"


def _extract_explicit_pages(query: str) -> list[int]:
    """Extract explicitly mentioned page/slide numbers from the query."""
    matches = re.findall(r"(?:page|slide|p\.?)\s*(\d+)", query.lower())
    return [int(m) for m in matches]


def _hits_have_visual_content(hits: list[dict]) -> bool:
    """
    v4.1 FIX: Three-layer check — chunk type, image_path field, and disk existence.
    Previously only checked chunk metadata, missing most visual pages.
    """
    for h in hits:
        # Layer 1: chunk declared as a visual type
        if h.get("type", "").lower() in ("figure", "table", "image", "vlm"):
            return True
        # Layer 2: loader stored an image_path on the chunk
        if h.get("image_path", ""):
            return True
        # Layer 3: the page image actually exists on disk (ground truth)
        page = h.get("page", "")
        src  = h.get("source", "")
        if page and src and _page_image_path(src, page):
            return True
    return False


# ──────────────────────────────────────────────────────────────
# 15. Intent-aware LLM image page selector  (v4.1 — fixed)
# ──────────────────────────────────────────────────────────────

def _ask_llm_which_pages(
    query:       str,
    hits:        list[dict],
    filename:    str,
    temperature: float = 0.1,
) -> list[int]:
    """
    Decide which pages to show images for:
      1. Explicit page mentions → return those directly
      2. Text-intent + no disk images → return [] immediately
      3. Ambiguous intent + images exist → return top-2 directly (no LLM)
      4. Visual intent → ask LLM; override if LLM wrongly says no
    """

    # ── Step 1: explicit page numbers in query ─────────────────
    explicit = _extract_explicit_pages(query)
    if explicit:
        valid = [p for p in explicit if _page_image_path(filename, p)]
        print(f"[IMAGE] Explicit pages: {explicit} → available: {valid}")
        return valid

    # ── Step 2: classify intent ────────────────────────────────
    intent = _classify_query_intent(query)
    print(f"[IMAGE] Query intent: {intent}")

    # ── Step 3: build page list + find which have disk images ──
    pages_with_images: list[int] = []
    seen_pages: set[str]         = set()
    page_summaries: list[str]    = []

    for h in hits:
        page = h.get("page", "")
        if not page or page in seen_pages:
            continue
        seen_pages.add(page)

        img_exists   = bool(_page_image_path(filename, page))
        content_type = h.get("type", "text")
        has_image    = "YES" if img_exists else "NO"
        snippet      = h["text"][:150].replace("\n", " ")
        page_summaries.append(
            f"Page {page} | type:{content_type} | image_on_disk:{has_image} | {snippet}"
        )
        if img_exists and page.isdigit():
            pages_with_images.append(int(page))

    has_visual_hits = bool(pages_with_images)

    # ── Step 4: short-circuit decisions ───────────────────────

    # Pure text query AND no images at all → skip
    if intent == "text" and not has_visual_hits:
        print("[IMAGE] Text-intent + no disk images → skipping images")
        return []

    # Ambiguous + images exist → show top-2 without calling LLM
    # (LLM is too conservative for ambiguous queries)
    if intent == "ambiguous" and has_visual_hits:
        chosen = sorted(pages_with_images)[:2]
        print(f"[IMAGE] Ambiguous intent + images on disk → auto-showing pages {chosen}")
        return chosen

    # No images at all on disk → nothing to show
    if not has_visual_hits:
        print("[IMAGE] No images on disk for any retrieved page → skipping")
        return []

    if not page_summaries:
        return []

    # ── Step 5: LLM call for visual-intent queries ────────────
    pages_block = "\n".join(page_summaries)
    available   = sorted(pages_with_images)

    system_prompt = (
        "You decide which page images to show alongside the RAG answer.\n"
        "Return STRICT JSON ONLY — no explanation, no markdown fences.\n\n"
        "Format:\n"
        '{ "show_images": true, "pages": [1, 2] }\n'
        "OR\n"
        '{ "show_images": false, "pages": [] }\n\n'
        "Rules:\n"
        "- show_images=true when the query asks about something visual "
        "(diagram, figure, table, chart, image, specific page)\n"
        "- show_images=true also when retrieved pages have images and query is ambiguous\n"
        "- show_images=false ONLY for pure definition/explanation/summary queries "
        "where no image adds value AND the page has no figures or tables\n"
        "- Only include pages where image_on_disk=YES\n"
        "- Prefer pages with type=vlm, table, or figure over plain text pages\n"
        "- Return at most 3 pages\n"
        "- When in doubt and images exist, prefer showing them\n"
    )

    user_prompt = (
        f"User query: {query}\n"
        f"Query intent: {intent}\n\n"
        f"Retrieved pages:\n{pages_block}\n\n"
        f"Pages with images on disk: {available}"
    )

    def _call_llm(messages: list[dict]) -> str:
        r = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model":    OLLAMA_MODEL,
                "stream":   False,
                "messages": messages,
                "options":  {"temperature": temperature, "num_predict": 200},
            },
            timeout=20,
        )
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "").strip()

    try:
        raw = _call_llm([
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ])
        print("[IMAGE_LLM RAW]:", raw)

        cleaned = re.sub(r"```json|```", "", raw).strip()
        match   = re.search(r"\{.*", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(0)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            print("[IMAGE_LLM] JSON broken, attempting self-repair…")
            fixed = _call_llm([
                {"role": "system", "content": "Fix the JSON. Return valid JSON only. No explanation."},
                {"role": "user",   "content": f"Broken JSON:\n{cleaned}"},
            ])
            fixed = re.sub(r"```json|```", "", fixed).strip()
            data  = json.loads(fixed)

        if not data.get("show_images", False):
            # LLM said no — but override for visual intent when images exist
            if intent == "visual" and available:
                print("[IMAGE_LLM] LLM said no but intent=visual + images exist → overriding")
                return available[:2]
            print("[IMAGE_LLM] LLM decided: no images")
            return []

        valid_pages = {int(p) for p in seen_pages if p.isdigit()}
        result = [
            int(p) for p in data.get("pages", [])
            if isinstance(p, (int, float))
            and int(p) in valid_pages
            and _page_image_path(filename, int(p))
        ]
        print(f"[IMAGE_LLM] Pages chosen: {result}")
        return result

    except Exception as e:
        print(f"[IMAGE_LLM ERROR]: {e}")
        # Safe fallback: show first 2 available if intent was visual
        if available and intent == "visual":
            print(f"[IMAGE_LLM] Fallback → returning: {available[:2]}")
            return available[:2]
        return []


# ──────────────────────────────────────────────────────────────
# 16. Ollama RAG streaming generator
# ──────────────────────────────────────────────────────────────

def generate_ollama_response(
    query:       str,
    filename:    str,
    temperature: float = 0.4,
    max_tokens:  int   = 1024,
    top_p:       float = 0.9,
) -> tuple[str | Generator, bool]:
    if is_small_talk(query):
        return handle_small_talk(query), False

    status = _get_status(filename)
    if status == "indexing":
        return f"'{filename}' is still being indexed. Please wait a moment.", False
    if status.startswith("error:"):
        return f"Indexing failed for '{filename}': {status[6:]}", False

    hits, crag_context = crag_retrieve(query, filename)
    if not hits:
        # fallback to original search if CRAG returns nothing
        hits = search_file(filename, query)
        crag_context = ""
    if not hits:
        return f"No relevant content found in '{filename}'.", Falsee

    # v4.1: intent-aware image selection (fixed)
    pages_to_show = _ask_llm_which_pages(query, hits, filename)
    image_items   = []
    for page_num in pages_to_show:
        img_path = _page_image_path(filename, page_num)
        if img_path:
            image_items.append({
                "page": page_num,
                "url":  _image_url(filename, page_num),
            })
    print(f"[GENERATE] Images to send: {len(image_items)}")

    # Build context
    if crag_context:
        context_text = crag_context
    else:
        context_parts = []
        for h in hits:
            page_info   = f"p.{h['page']}/{h['total_pages']}" if h.get("page") else ""
            rerank_info = f" | rerank:{h['rerank_score']:.3f}" if "rerank_score" in h else ""
            label       = (
                f"[{h['type'].upper()} | {h['source']} "
                f"{page_info} | score:{h['score']}{rerank_info} | chunk:{h['chunk_index']}]"
            )
            context_parts.append(f"{label}\n{h['text']}")
        context_text = "\n\n".join(context_parts)

    # If pages are being shown to the user, tell the LLM which ones
    # so it explains from those pages' text context instead of saying "no image found"
    page_ref_note = ""
    if image_items:
        page_nums = ", ".join(f"p.{item['page']}" for item in image_items)
        page_ref_note = (
            f"\n\nNOTE: The user is currently viewing page image(s): {page_nums}. "
            f"Use the context from those pages above to explain what is shown on them. "
            f"Do NOT say you cannot see images — explain based on the text context extracted from those pages."
        )

    payload = {
        "model":  OLLAMA_MODEL,
        "stream": True,
        "messages": [
            {
                "role":    "system",
                "content": (
                    "You are a precise academic assistant. "
                    "Answer clearly and in detail using ONLY the provided context. "
                    "Use markdown — bold key terms, tables, bullet points where helpful. "
                    "Always cite the page number (e.g. 'p.3') when referencing specific content. "
                    "When the user asks about an image or page, explain its content using the "
                    "text context extracted from that page — do NOT say you cannot see images. "
                    "If the context does not contain enough information to answer, say so explicitly."
                ),
            },
            {
                "role":    "user",
                "content": (
                    f"Context from '{filename}':\n\n{context_text}\n\n"
                    f"Question: {query}"
                    f"{page_ref_note}"
                ),
            },
        ],
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "top_p":       top_p,
        },
    }

    def stream_tokens() -> Generator:
        try:
            if image_items:
                yield f"data: {json.dumps({'images': image_items})}\n\n"

            with requests.post(
                f"{OLLAMA_HOST}/api/chat",
                json    = payload,
                stream  = True,
                timeout = 120,
            ) as resp:
                resp.raise_for_status()
                last_heartbeat = time.time()

                for line in resp.iter_lines():
                    if time.time() - last_heartbeat > 15:
                        yield ": heartbeat\n\n"
                        last_heartbeat = time.time()

                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            yield f"data: {json.dumps({'token': token})}\n\n"
                        if chunk.get("done"):
                            yield "data: [DONE]\n\n"
                            break
                    except Exception:
                        continue

        except requests.exceptions.ConnectionError:
            yield (f"data: {json.dumps({'token': 'Error: Ollama not running.'})}\n\n"
                   "data: [DONE]\n\n")
        except requests.exceptions.Timeout:
            yield (f"data: {json.dumps({'token': 'Error: Ollama request timed out.'})}\n\n"
                   "data: [DONE]\n\n")
        except Exception as e:
            yield (f"data: {json.dumps({'token': f'Error: {e}'})}\n\n"
                   "data: [DONE]\n\n")

    return stream_tokens(), True


# ──────────────────────────────────────────────────────────────
# 17. Flask Endpoints
# ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    ollama_ok = False
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except Exception:
        pass
    return jsonify({
        "status":       "ok",
        "ollama":       "up" if ollama_ok else "down",
        "ollama_model": OLLAMA_MODEL,
        "embed_model":  EMBED_MODEL,
        "reranker":     RERANK_MODEL if _RERANKER_AVAILABLE else "disabled",
        "bm25":         "enabled" if _BM25_AVAILABLE else "disabled",
    })


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file     = request.files["file"]
    filename = file.filename or ""
    if not filename.lower().endswith((".pdf", ".txt")):
        return jsonify({"error": "Only PDF and TXT files are supported"}), 400
    save_path = os.path.join(UPLOAD_DIR, filename)
    file.save(save_path)
    index_file_background(save_path, filename)
    return jsonify({
        "status":   "upload_received",
        "file":     filename,
        "message":  "File saved. Indexing started in background.",
        "poll_url": f"/status/{filename}",
    })


@app.route("/status/<path:filename>", methods=["GET"])
def status(filename: str):
    s = _get_status(filename)
    if s == "unknown":
        try:
            col = _get_collection(filename)
            if col.count() > 0:
                s = "ready"
                _set_status(filename, s)
        except Exception:
            pass
    return jsonify({"filename": filename, "status": s})


@app.route("/generate", methods=["POST"])
def chat():
    """
    POST /generate  { prompt, filename, temperature?, max_output_tokens?, top_p? }

    SSE stream format:
      data: {"images": [{"page": N, "url": "/page-image/..."}]}   ← first event (only if visual)
      data: {"token": "..."}                                        ← text tokens
      data: [DONE]
    """
    data     = request.json or {}
    prompt   = data.get("prompt",   "").strip()
    filename = data.get("filename", "").strip()
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    result, is_stream = generate_ollama_response(
        query       = prompt,
        filename    = filename,
        temperature = float(data.get("temperature",      0.4)),
        max_tokens  = int(data.get("max_output_tokens", 1024)),
        top_p       = float(data.get("top_p",            0.9)),
    )

    if is_stream:
        return Response(
            stream_with_context(result),
            mimetype = "text/event-stream",
            headers  = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return jsonify({"prompt": prompt, "filename": filename, "response": result})


@app.route("/page-image/<path:filename>/<int:page_num>", methods=["GET"])
def page_image(filename: str, page_num: int):
    img_path = _page_image_path(filename, page_num)
    if not img_path:
        return jsonify({"error": f"Image not found for {filename} p.{page_num}"}), 404
    return send_file(img_path, mimetype="image/png")


@app.route("/page-images/<path:filename>", methods=["GET"])
def page_images_list(filename: str):
    img_dir = _image_dir_for_file(filename)
    if not os.path.isdir(img_dir):
        return jsonify({"filename": filename, "images": []})

    pattern = os.path.join(img_dir, "page_*.png")
    files   = sorted(glob.glob(pattern))

    images = []
    for f in files:
        basename = os.path.basename(f)
        match    = re.match(r"page_(\d+)\.png", basename)
        if match:
            page_num = int(match.group(1))
            images.append({
                "page": page_num,
                "url":  _image_url(filename, page_num),
            })

    return jsonify({"filename": filename, "images": images, "total": len(images)})


@app.route("/images-for-query", methods=["POST"])
def images_for_query():
    data     = request.json or {}
    prompt   = data.get("prompt",   "").strip()
    filename = data.get("filename", "").strip()

    if not prompt or not filename:
        return jsonify({"error": "prompt and filename required"}), 400

    status = _get_status(filename)
    if status == "indexing":
        return jsonify({"error": "File is still being indexed"}), 202
    if status.startswith("error:"):
        return jsonify({"error": status}), 500

    hits = search_file(filename, prompt)
    if not hits:
        return jsonify({"images": [], "pages_considered": [], "intent": "unknown"})

    intent           = _classify_query_intent(prompt)
    pages_to_show    = _ask_llm_which_pages(prompt, hits, filename)
    pages_considered = sorted(
        int(h["page"]) for h in hits
        if h.get("page") and str(h["page"]).isdigit()
    )

    image_items = []
    for page_num in pages_to_show:
        img_path = _page_image_path(filename, page_num)
        if img_path:
            image_items.append({
                "page": page_num,
                "url":  _image_url(filename, page_num),
            })

    return jsonify({
        "images":           image_items,
        "pages_considered": pages_considered,
        "intent":           intent,
    })


@app.route("/files", methods=["GET"])
def files():
    return jsonify({
        "files": [
            {"name": f, "status": _get_status(f) or "ready"}
            for f in list_indexed_files()
        ]
    })


@app.route("/delete", methods=["POST"])
def delete():
    data     = request.json or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "No filename provided"}), 400
    try:
        chroma_client.delete_collection(_collection_name(filename))
        _set_status(filename, "unknown")
        return jsonify({"status": "deleted", "file": filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/debug-images/<path:filename>", methods=["GET"])
def debug_images(filename: str):
    """
    GET /debug-images/<filename>
    Diagnoses why images are not found for a file.
    Shows safe_stem, expected dir, actual disk contents,
    and sample image_path values from ChromaDB.
    """
    safe_stem    = _safe_filename(filename)
    expected_dir = _image_dir_for_file(filename)
    dir_exists   = os.path.isdir(expected_dir)

    # All subdirs under page_images/ root
    root_contents = []
    if os.path.isdir(PAGE_IMAGE_DIR):
        for entry in sorted(os.listdir(PAGE_IMAGE_DIR)):
            full   = os.path.join(PAGE_IMAGE_DIR, entry)
            n_pngs = len(glob.glob(os.path.join(full, "*.png"))) if os.path.isdir(full) else 0
            root_contents.append({"dir": entry, "png_count": n_pngs})

    # PNGs inside expected dir
    found_pngs = []
    if dir_exists:
        found_pngs = sorted(
            os.path.basename(p)
            for p in glob.glob(os.path.join(expected_dir, "page_*.png"))
        )

    # Sample image_path values in ChromaDB
    chroma_paths: list[str] = []
    try:
        col     = _get_collection(filename)
        results = col.get(include=["metadatas"], limit=20)
        chroma_paths = list({
            m.get("image_path", "") for m in results["metadatas"]
            if m.get("image_path", "")
        })
    except Exception as e:
        chroma_paths = [f"error: {e}"]

    return jsonify({
        "filename":                  filename,
        "safe_stem":                 safe_stem,
        "page_image_dir":            PAGE_IMAGE_DIR,
        "expected_dir":              expected_dir,
        "expected_dir_exists":       dir_exists,
        "pngs_found":                found_pngs,
        "png_count":                 len(found_pngs),
        "page_images_root_contents": root_contents,
        "chroma_image_paths_sample": chroma_paths,
        "diagnosis": (
            "OK — images on disk and path matches"
            if found_pngs else
            "NO IMAGES — loader did not save them, or safe_stem mismatch. "
            "Compare safe_stem with page_images_root_contents dir names."
        ),
    })


@app.route("/reindex", methods=["POST"])
def reindex():
    data     = request.json or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    try:
        chroma_client.delete_collection(_collection_name(filename))
    except Exception:
        pass

    for base in (UPLOAD_DIR, DOCS_DIR):
        cache_file = os.path.join(base, filename + ".chunks.json")
        if os.path.exists(cache_file):
            try:
                os.remove(cache_file)
            except Exception:
                pass

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": f"File not found: {filename}"}), 404

    index_file_background(filepath, filename, force=True)
    return jsonify({"status": "reindex_started", "file": filename, "poll_url": f"/status/{filename}"})


@app.route("/chunks", methods=["GET"])
def chunks():
    filename = request.args.get("filename", "").strip()
    page     = request.args.get("page",     "").strip()
    if not filename:
        return jsonify({"error": "filename query param required"}), 400

    collection = _get_collection(filename)
    if collection.count() == 0:
        return jsonify({"filename": filename, "chunks": [], "total": 0})

    results = collection.get(include=["documents", "metadatas"])
    output  = []
    for doc, meta in zip(results["documents"], results["metadatas"]):
        if page and meta.get("page") != page:
            continue
        page_num = meta.get("page", "")
        output.append({
            "text":      doc[:300] + ("..." if len(doc) > 300 else ""),
            "image_url": _image_url(filename, page_num) if page_num else None,
            **meta,
        })

    output.sort(key=lambda x: int(x.get("chunk_index") or 0))
    return jsonify({"filename": filename, "chunks": output, "total": len(output)})


@app.route("/generate-report", methods=["POST"])
def generate_report_endpoint():
    """
    POST /generate-report
    Body: {
        filename:   str,           required
        query_hint: str,           optional — report focus/topic
        sections:   list[str],     optional — custom section names ([] = auto-discover)
    }

    Response: {
        latex:    str,
        sections: [{name, text}, ...],
        filename: str
    }

    This is a blocking endpoint (report gen takes 30-120s).
    Parallel section generation via LangGraph Send() API.
    """
    data     = request.json or {}
    filename = data.get("filename", "").strip()

    if not filename:
        return jsonify({"error": "filename required"}), 400

    status = _get_status(filename)
    if status == "indexing":
        return jsonify({"error": f"'{filename}' is still being indexed"}), 202
    if status.startswith("error:"):
        return jsonify({"error": f"Indexing failed: {status[6:]}"}), 500

    # Check collection has content
    try:
        col = _get_collection(filename)
        if col.count() == 0:
            return jsonify({"error": f"No indexed content found for '{filename}'"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    query_hint = data.get("query_hint", "").strip()

    # FIX: treat missing, null, and [] all as "auto-discover from PDF"
    raw_secs    = data.get("sections") or []
    custom_secs = [s.strip() for s in raw_secs if isinstance(s, str) and s.strip()]
    sections_arg = custom_secs if custom_secs else None

    print(f"\n[REPORT] Starting report for '{filename}' | focus: '{query_hint or 'auto'}' | "
          f"sections: {'auto-discover' if sections_arg is None else len(sections_arg)}")

    try:
        result = generate_report(
            filename   = filename,
            query_hint = query_hint,
            sections   = sections_arg,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Report generation failed: {e}"}), 500

    return jsonify({
        "filename": filename,
        "latex":    result["latex"],
        "sections": result["sections"],
    })

@app.route("/report-sections", methods=["GET"])
def report_sections():
    """GET /report-sections — returns default section list."""
    return jsonify({"sections": DEFAULT_SECTIONS})

# ──────────────────────────────────────────────────────────────
# 18. Run
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n[READY] RAG Backend  →  http://127.0.0.1:8080")
    print(f"  Embeddings  : {EMBED_MODEL}")
    print(f"  Reranker    : {RERANK_MODEL if _RERANKER_AVAILABLE else 'disabled'}")
    print(f"  BM25        : {'enabled' if _BM25_AVAILABLE else 'disabled (pip install rank-bm25)'}")
    print(f"  Vector DB   : ChromaDB  ({CHROMA_DIR}/)")
    print(f"  LLM Model   : {OLLAMA_MODEL}")
    print(f"  Ollama Host : {OLLAMA_HOST}")
    print(f"  Docs Dir    : {DOCS_DIR}/")
    print(f"  Upload Dir  : {UPLOAD_DIR}/")
    print(f"  Image Dir   : {PAGE_IMAGE_DIR}/\n")
    app.run(host="0.0.0.0", port=8080, debug=True)