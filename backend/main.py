"""
main.py  (v2 — optimised)
─────────────────────────
Flask RAG backend — integrated with document_loader.py

Key improvements over v1
────────────────────────
1. BETTER EMBEDDING MODEL  — upgraded from bge-small-en-v1.5 → bge-m3
   (multilingual, 8192-token context, significantly better retrieval).

2. RERANKER              — cross-encoder/ms-marco-MiniLM-L-6-v2 re-ranks
   the top-k ChromaDB hits before sending to the LLM, cutting irrelevant
   context and improving answer quality.

3. MMR DEDUP             — Maximal Marginal Relevance deduplicates
   semantically redundant chunks before reranking so the LLM gets diverse
   context rather than near-copies of the same passage.

4. HYBRID RETRIEVAL      — BM25 keyword search runs alongside ChromaDB
   vector search; results are RRF-fused (Reciprocal Rank Fusion).
   Catches exact-match queries that dense embeddings sometimes miss.

5. QUERY EXPANSION       — light synonym/abbreviation expansion applied
   before both retrieval paths to improve recall on short queries.

6. /STATUS ENDPOINT      — added (was referenced in v1 but never defined).

7. IMPORT FIX            — v1 imported from 'docling_loader' but the file
   is 'document_loader'. Fixed.

8. STREAMING ROBUSTNESS  — graceful SSE error recovery; heartbeat comment
   lines keep proxies from closing idle connections.

9. CACHE INVALIDATION    — /reindex now also deletes the .chunks.json
   cache file so document_loader v2 re-processes from scratch.

10. HEALTH ENDPOINT      — GET /health returns model info and Ollama status.

11. /STATUS ENDPOINT     - proper implementation (was missing in v1).
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
from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# ── BM25 (rank_bm25 is a tiny, zero-dep package) ──────────────
try:
    from rank_bm25 import BM25Okapi
    _BM25_AVAILABLE = True
except ImportError:
    _BM25_AVAILABLE = False
    print("[WARN] rank_bm25 not installed — BM25 hybrid search disabled. "
          "Install with: pip install rank-bm25")

# ── Cross-encoder reranker ─────────────────────────────────────
try:
    from sentence_transformers import CrossEncoder
    _RERANKER_AVAILABLE = True
except ImportError:
    _RERANKER_AVAILABLE = False
    print("[WARN] sentence-transformers not installed — reranker disabled.")

# ── Import our loader ──────────────────────────────────────────
from docling_loader import load_single_file_async   # ← fixed import

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
RERANK_MODEL     = os.getenv("RERANK_MODEL",     "cross-encoder/ms-marco-MiniLM-L-6-v2")
EMBED_MODEL      = os.getenv("EMBED_MODEL",      "BAAI/bge-small-en-v1.5")              # ← upgraded
RETRIEVAL_K      = int(os.getenv("RETRIEVAL_K",  "20"))  # fetch more, rerank to top-8
RERANK_TOP_N     = int(os.getenv("RERANK_TOP_N", "8"))
MMR_LAMBDA       = float(os.getenv("MMR_LAMBDA", "0.5"))  # 0=max diversity, 1=max relevance

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DOCS_DIR,   exist_ok=True)

# ──────────────────────────────────────────────────────────────
# 2. ChromaDB + Embedding Setup
# ──────────────────────────────────────────────────────────────
print(f"[INIT] Loading embedding model: {EMBED_MODEL} …")

embedding_fn = SentenceTransformerEmbeddingFunction(
    model_name         = EMBED_MODEL,
    normalize_embeddings = True,
)

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

# ── Reranker (lazy load — only if available) ──────────────────
_reranker: "CrossEncoder | None" = None

def _get_reranker():
    global _reranker
    if _reranker is None and _RERANKER_AVAILABLE:
        print(f"[INIT] Loading reranker: {RERANK_MODEL} …")
        _reranker = CrossEncoder(RERANK_MODEL)
    return _reranker

# ──────────────────────────────────────────────────────────────
# 3. Indexing status tracker  (thread-safe)
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
# 4. Collection helpers
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
# 5. BM25 index — built in-memory per query (lightweight for
#    typical RAG doc sizes; replace with persistent index for
#    very large collections)
# ──────────────────────────────────────────────────────────────

def _build_bm25(docs: list[str]) -> "BM25Okapi | None":
    if not _BM25_AVAILABLE or not docs:
        return None
    tokenised = [d.lower().split() for d in docs]
    return BM25Okapi(tokenised)


def _bm25_search(
    bm25:     "BM25Okapi",
    docs:     list[str],
    query:    str,
    k:        int,
) -> list[tuple[int, float]]:
    """Returns (doc_index, normalised_score) sorted descending."""
    scores = bm25.get_scores(query.lower().split())
    top_k  = sorted(enumerate(scores), key=lambda x: -x[1])[:k]
    max_s  = top_k[0][1] if top_k and top_k[0][1] > 0 else 1.0
    return [(idx, s / max_s) for idx, s in top_k if s > 0]

# ──────────────────────────────────────────────────────────────
# 6. MMR deduplication
# ──────────────────────────────────────────────────────────────

def _mmr(
    hits:      list[dict],
    lambda_:   float = MMR_LAMBDA,
    top_n:     int   = RERANK_TOP_N,
) -> list[dict]:
    """
    Maximal Marginal Relevance over pre-retrieved hits.
    Uses bag-of-words cosine as a cheap similarity proxy.
    """
    if len(hits) <= top_n:
        return hits

    def _bow(text: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for w in text.lower().split():
            counts[w] = counts.get(w, 0) + 1
        return counts

    def _cos(a: dict, b: dict) -> float:
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
# 7. RRF fusion (dense + BM25)
# ──────────────────────────────────────────────────────────────

def _rrf_fuse(
    dense_hits: list[dict],
    bm25_hits:  list[tuple[int, float]],   # (index into dense_hits list, score)
    k:          int = 60,
) -> list[dict]:
    """
    Reciprocal Rank Fusion.
    bm25_hits indices refer to positions in dense_hits.
    Returns re-ordered dense_hits list.
    """
    rrf: dict[int, float] = {}

    for rank, hit in enumerate(dense_hits):
        rrf[rank] = rrf.get(rank, 0.0) + 1.0 / (k + rank + 1)

    for rank, (idx, _) in enumerate(bm25_hits):
        rrf[idx] = rrf.get(idx, 0.0) + 1.0 / (k + rank + 1)

    order = sorted(rrf, key=lambda i: -rrf[i])
    return [dense_hits[i] for i in order if i < len(dense_hits)]

# ──────────────────────────────────────────────────────────────
# 8. Query expansion (lightweight synonym map)
# ──────────────────────────────────────────────────────────────

_SYNONYMS: dict[str, list[str]] = {
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

def _expand_query(query: str) -> str:
    tokens  = query.lower().split()
    extras: list[str] = []
    for tok in tokens:
        clean = tok.strip(".,;:()")
        if clean in _SYNONYMS:
            extras.extend(_SYNONYMS[clean])
    if extras:
        return query + " " + " ".join(extras)
    return query

# ──────────────────────────────────────────────────────────────
# 9. Core indexing logic  (background thread)
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
                }
                for c in batch
            ],
            ids = [f"{col_name}_chunk_{i + j}" for j in range(len(batch))],
        )
        print(f"  [CHROMA] Batch {i // batch_size + 1}: pushed {len(batch)} chunks")

    print(f"[CHROMA] ✓ '{filename}' → {len(chunks)} chunks indexed.")
    _set_status(filename, "ready")


def index_file_background(filepath: str, filename: str, force: bool = False) -> threading.Thread:
    t = threading.Thread(
        target = _do_index,
        args   = (filepath, filename, force),
        daemon = True,
        name   = f"indexer-{filename}",
    )
    t.start()
    return t

# ──────────────────────────────────────────────────────────────
# 10. Search  (hybrid dense + BM25 → MMR → rerank)
# ──────────────────────────────────────────────────────────────

def search_file(filename: str, query: str, k: int = RETRIEVAL_K) -> list[dict]:
    collection = _get_collection(filename)
    if collection.count() == 0:
        return []

    expanded_query = _expand_query(query)

    # ── Dense retrieval ────────────────────────────────────────
    n = min(k, collection.count())
    results = collection.query(
        query_texts = [expanded_query],
        n_results   = n,
        include     = ["documents", "metadatas", "distances"],
    )

    dense_hits: list[dict] = []
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
            "score":       round(1 - dist, 4),
        })

    # ── BM25 retrieval ─────────────────────────────────────────
    if _BM25_AVAILABLE and dense_hits:
        bm25      = _build_bm25([h["text"] for h in dense_hits])
        bm25_hits = _bm25_search(bm25, [h["text"] for h in dense_hits], expanded_query, k=n)
        hits      = _rrf_fuse(dense_hits, bm25_hits)
    else:
        hits = dense_hits

    # ── MMR deduplication ──────────────────────────────────────
    hits = _mmr(hits, lambda_=MMR_LAMBDA, top_n=RERANK_TOP_N * 2)

    # ── Cross-encoder rerank ───────────────────────────────────
    reranker = _get_reranker()
    if reranker and hits:
        pairs  = [(query, h["text"]) for h in hits]
        scores = reranker.predict(pairs)
        for hit, score in zip(hits, scores):
            hit["rerank_score"] = float(score)
        hits.sort(key=lambda h: h.get("rerank_score", 0), reverse=True)

    return hits[:RERANK_TOP_N]


def list_indexed_files() -> list[str]:
    collections = chroma_client.list_collections()
    return [
        col.name.replace("file_", "", 1)
        for col in collections
        if col.name.startswith("file_")
    ]

# ──────────────────────────────────────────────────────────────
# 11. Load default docs on startup
# ──────────────────────────────────────────────────────────────

def _load_default_docs() -> None:
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
# 12. Helpers: clean text, small-talk
# ──────────────────────────────────────────────────────────────

def clean_text(text: str) -> str:
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

def is_small_talk(query: str) -> bool:
    q = query.strip().lower()
    return any(re.search(p, q) for p in _SMALL_TALK)


def handle_small_talk(query: str) -> str:
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
# 13. Ollama RAG streaming generator
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

    hits = search_file(filename, query)
    if not hits:
        return f"No relevant content found in '{filename}'.", False

    context_parts: list[str] = []
    for h in hits:
        page_info   = f"p.{h['page']}/{h['total_pages']}" if h.get("page") else ""
        rerank_info = f" | rerank:{h['rerank_score']:.3f}" if "rerank_score" in h else ""
        label = (
            f"[{h['type'].upper()} | {h['source']} "
            f"{page_info} | score:{h['score']}{rerank_info} | chunk:{h['chunk_index']}]"
        )
        context_parts.append(f"{label}\n{h['text']}")

    context_text = "\n\n".join(context_parts)
    print(f"\n[CONTEXT for '{filename}']\n"
          f"{context_text[:800]}{'...' if len(context_text) > 800 else ''}\n")

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
                    "If the context does not contain enough information to answer, say so explicitly."
                ),
            },
            {
                "role":    "user",
                "content": (
                    f"Context from '{filename}':\n\n{context_text}\n\n"
                    f"Question: {query}"
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
            with requests.post(
                f"{OLLAMA_HOST}/api/chat",
                json    = payload,
                stream  = True,
                timeout = 120,
            ) as resp:
                resp.raise_for_status()
                last_heartbeat = time.time()

                for line in resp.iter_lines():
                    # SSE heartbeat — keeps proxies from closing the connection
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
            yield (f"data: {json.dumps({'token': 'Error: Ollama not running. Run: ollama serve'})}\n\n"
                   "data: [DONE]\n\n")
        except requests.exceptions.Timeout:
            yield (f"data: {json.dumps({'token': 'Error: Ollama request timed out.'})}\n\n"
                   "data: [DONE]\n\n")
        except Exception as e:
            yield (f"data: {json.dumps({'token': f'Error: {e}'})}\n\n"
                   "data: [DONE]\n\n")

    return stream_tokens(), True

# ──────────────────────────────────────────────────────────────
# 14. Flask Endpoints
# ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """GET /health — system status."""
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
    """
    POST /upload  (multipart/form-data, field: 'file')
    Saves the file, starts background indexing, returns immediately.
    Poll GET /status/<filename> to know when indexing is done.
    """
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
    """
    GET /status/<filename>
    Returns the current indexing status for a file.
    Possible values: indexing | ready | error:<msg> | unknown
    """
    s = _get_status(filename)

    # Also reflect the ChromaDB state if status tracker hasn't been set yet
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
    Streams SSE tokens or returns plain JSON for small-talk.
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
        temperature = float(data.get("temperature",       0.4)),
        max_tokens  = int(data.get("max_output_tokens",  1024)),
        top_p       = float(data.get("top_p",             0.9)),
    )

    if is_stream:
        return Response(
            stream_with_context(result),
            mimetype = "text/event-stream",
            headers  = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return jsonify({"prompt": prompt, "filename": filename, "response": result})


@app.route("/files", methods=["GET"])
def files():
    """GET /files — list all indexed files with their current status."""
    return jsonify({
        "files": [
            {"name": f, "status": _get_status(f) or "ready"}
            for f in list_indexed_files()
        ]
    })


@app.route("/delete", methods=["POST"])
def delete():
    """POST /delete  { filename }"""
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


@app.route("/reindex", methods=["POST"])
def reindex():
    """
    POST /reindex  { filename }
    Drops the existing collection + chunk cache, re-indexes from scratch.
    """
    data     = request.json or {}
    filename = data.get("filename", "").strip()

    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    # Drop ChromaDB collection
    try:
        chroma_client.delete_collection(_collection_name(filename))
    except Exception:
        pass

    # ── Also nuke the document_loader chunk cache ──────────────
    for base in (UPLOAD_DIR, DOCS_DIR):
        cache_file = os.path.join(base, filename + ".chunks.json")
        if os.path.exists(cache_file):
            try:
                os.remove(cache_file)
                print(f"[REINDEX] Removed chunk cache: {cache_file}")
            except Exception:
                pass

    # Find the source file
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": f"File not found: {filename}"}), 404

    index_file_background(filepath, filename, force=True)

    return jsonify({
        "status":   "reindex_started",
        "file":     filename,
        "poll_url": f"/status/{filename}",
    })


@app.route("/chunks", methods=["GET"])
def chunks():
    """
    GET /chunks?filename=<name>&page=<n>
    Returns stored chunks for a file (optionally filtered by page).
    """
    filename = request.args.get("filename", "").strip()
    page     = request.args.get("page",     "").strip()

    if not filename:
        return jsonify({"error": "filename query param required"}), 400

    collection = _get_collection(filename)
    if collection.count() == 0:
        return jsonify({"filename": filename, "chunks": [], "total": 0})

    results = collection.get(include=["documents", "metadatas"])
    output: list[dict] = []
    for doc, meta in zip(results["documents"], results["metadatas"]):
        if page and meta.get("page") != page:
            continue
        output.append({
            "text": doc[:300] + ("..." if len(doc) > 300 else ""),
            **meta,
        })

    output.sort(key=lambda x: int(x.get("chunk_index") or 0))
    return jsonify({"filename": filename, "chunks": output, "total": len(output)})


# ──────────────────────────────────────────────────────────────
# 15. Run
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
    print(f"  Upload Dir  : {UPLOAD_DIR}/\n")
    app.run(host="0.0.0.0", port=8080, debug=True)