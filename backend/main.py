"""
main.py  (v5.0 — image logic removed, report endpoint integrated)
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
import queue

import requests
from flask import Flask, jsonify, request, Response, stream_with_context, send_file, make_response
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

from models import db
from auth import auth_bp
from rag_graph import crag_retrieve
from metall_report_graph import generate_report, METALL_SECTION_KEYWORDS

try:
    from rank_bm25 import BM25Okapi
    _BM25_AVAILABLE = True
except ImportError:
    _BM25_AVAILABLE = False
    print("[WARN] rank_bm25 not installed -- BM25 hybrid search disabled.")

try:
    from sentence_transformers import CrossEncoder
    _RERANKER_AVAILABLE = True
except ImportError:
    _RERANKER_AVAILABLE = False
    print("[WARN] sentence-transformers not installed -- reranker disabled.")

from docling_loader import load_single_file_async

# ──────────────────────────────────────────────────────────────
# 1. Environment & App Init
# ──────────────────────────────────────────────────────────────
load_dotenv()
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"]   = "1"
warnings.filterwarnings("ignore")

app  = Flask(__name__)
CORS(app, supports_credentials=True, expose_headers=['Content-Type'], allow_headers=['Content-Type', 'Authorization'])

# ──────────────────────────────────────────────────────────────
# Database & JWT Setup
# ──────────────────────────────────────────────────────────────
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///ragbot.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'your-secret-key-change-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = 86400  # 24 hours
app.config['JWT_ALGORITHM'] = 'HS256'  # Explicitly set algorithm
app.config['JWT_TOKEN_LOCATION'] = ['headers']  # Only accept tokens in headers
app.config['JWT_HEADER_NAME'] = 'Authorization'  # Standard header name
app.config['JWT_HEADER_TYPE'] = 'Bearer'  # Standard "Bearer" prefix

db.init_app(app)
jwt = JWTManager(app)

# ──────────────────────────────────────────────────────────────
# JWT Error Handlers (CRITICAL FOR 422 FIX)
# ──────────────────────────────────────────────────────────────
@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_data):
    print(f"[JWT ERROR] Token expired")
    return jsonify({'error': 'Token has expired'}), 401

@jwt.invalid_token_loader
def invalid_token_callback(error):
    print(f"[JWT ERROR] Invalid token: {error}")
    return jsonify({'error': f'Invalid token: {error}'}), 401

@jwt.unauthorized_loader
def missing_token_callback(error):
    print(f"[JWT ERROR] Missing token: {error}")
    return jsonify({'error': f'Missing authorization token: {error}'}), 401

@jwt.token_verification_failed_loader
def token_verification_failed_callback(jwt_header, jwt_data):
    print(f"[JWT ERROR] Token verification failed")
    return jsonify({'error': 'Token verification failed'}), 401

# Register auth blueprint
app.register_blueprint(auth_bp)

# Create database tables
with app.app_context():
    db.create_all()
    print("[INIT] Database initialized.")

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")
DOCS_DIR     = "rag_docs"
CHROMA_DIR   = "chroma_db"
UPLOAD_DIR   = "uploads"
RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
EMBED_MODEL  = os.getenv("EMBED_MODEL",  "BAAI/bge-small-en-v1.5")
RETRIEVAL_K  = int(os.getenv("RETRIEVAL_K",  "20"))
RERANK_TOP_N = int(os.getenv("RERANK_TOP_N", "8"))
MMR_LAMBDA   = float(os.getenv("MMR_LAMBDA", "0.5"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DOCS_DIR,   exist_ok=True)


# ──────────────────────────────────────────────────────────────
# 2. ChromaDB + Embedding Setup (LAZY LOADED)
# ──────────────────────────────────────────────────────────────
embedding_fn: "SentenceTransformerEmbeddingFunction | None" = None
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

def _get_embedding_fn() -> "SentenceTransformerEmbeddingFunction":
    global embedding_fn
    if embedding_fn is None:
        print(f"[INIT] Loading embedding model: {EMBED_MODEL} ...")
        embedding_fn = SentenceTransformerEmbeddingFunction(
            model_name           = EMBED_MODEL,
            normalize_embeddings = True,
        )
    return embedding_fn

_reranker: "CrossEncoder | None" = None

def _get_reranker():
    global _reranker
    if _reranker is None and _RERANKER_AVAILABLE:
        print(f"[INIT] Loading reranker: {RERANK_MODEL} ...")
        _reranker = CrossEncoder(RERANK_MODEL)
    return _reranker


# ──────────────────────────────────────────────────────────────
# 3. Indexing status tracker
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
        embedding_function = _get_embedding_fn(),
        metadata           = {"hnsw:space": "cosine"},
    )


# ──────────────────────────────────────────────────────────────
# 5. BM25
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
# 6. MMR deduplication
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
# 7. RRF fusion
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
# 8. Query expansion
# ──────────────────────────────────────────────────────────────

_SYNONYMS = {
    "llm": ["large language model", "language model"],
    "rag": ["retrieval augmented generation", "retrieval-augmented"],
    "ai":  ["artificial intelligence"],
    "ml":  ["machine learning"],
    "nlp": ["natural language processing"],
    "fig": ["figure", "diagram"],
    "eq":  ["equation"],
    "sec": ["section"],
    "tbl": ["table"],
    "def": ["definition"],
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
# 9. Core indexing logic
# ──────────────────────────────────────────────────────────────

def _do_index(filepath: str, filename: str, force: bool = False) -> None:
    collection = _get_collection(filename)

    if not force and collection.count() > 0:
        print(f"[CHROMA] '{filename}' already indexed ({collection.count()} chunks). Skipping.")
        _set_status(filename, "ready")
        return

    _set_status(filename, "indexing")
    print(f"\n[CHROMA] -- Indexing: {filename} --")

    try:
        chunks: list[dict] = asyncio.run(load_single_file_async(filepath, filename))
    except Exception as e:
        msg = f"Loader error: {e}"
        print(f"[CHROMA] x {msg}")
        _set_status(filename, f"error:{msg}")
        return

    if not chunks:
        msg = "No chunks produced"
        print(f"[CHROMA] x {msg} for {filename}")
        _set_status(filename, f"error:{msg}")
        return

    col_name   = _collection_name(filename)
    batch_size = 1000

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

    print(f"[CHROMA] ok '{filename}' -> {len(chunks)} chunks indexed.")
    _set_status(filename, "ready")


def index_file_background(filepath, filename, force=False):
    t = threading.Thread(
        target=_do_index, args=(filepath, filename, force),
        daemon=True, name=f"indexer-{filename}",
    )
    t.start()
    return t


# ──────────────────────────────────────────────────────────────
# 10. Search
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
    """List all indexed files by reading original filenames from collection metadata."""
    collections = chroma_client.list_collections()
    files = []
    
    for col in collections:
        if not col.name.startswith("file_"):
            continue
        
        try:
            # Get first document to extract original filename from metadata
            results = col.get(limit=1)
            if results and results.get("metadatas") and len(results["metadatas"]) > 0:
                original_filename = results["metadatas"][0].get("source", col.name.replace("file_", "", 1))
                files.append(original_filename)
            else:
                # Fallback: use collection name if no metadata found
                files.append(col.name.replace("file_", "", 1))
        except Exception as e:
            print(f"[WARN] Error reading metadata from {col.name}: {e}")
            files.append(col.name.replace("file_", "", 1))
    
    return files


# ──────────────────────────────────────────────────────────────
# 11. Load default docs on startup
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
# 12. Helpers: clean text, small-talk
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

    hits, crag_context = crag_retrieve(query, filename)
    if not hits:
        hits = search_file(filename, query)
        crag_context = ""
    if not hits:
        return f"No relevant content found in '{filename}'.", False

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

                in_think  = False
                think_buf = ""
                text_buf  = ""

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
                            text_buf += token

                            while text_buf:
                                if in_think:
                                    end = text_buf.find("</think>")
                                    if end == -1:
                                        safe = text_buf[:-8] if len(text_buf) > 8 else ""
                                        if safe:
                                            think_buf += safe
                                            yield f"data: {json.dumps({'think_token': safe})}\n\n"
                                            text_buf = text_buf[len(safe):]
                                        break
                                    else:
                                        think_buf += text_buf[:end]
                                        yield f"data: {json.dumps({'think_token': text_buf[:end]})}\n\n"
                                        yield f"data: {json.dumps({'think_end': True})}\n\n"
                                        in_think  = False
                                        think_buf = ""
                                        text_buf  = text_buf[end + 8:]
                                else:
                                    start = text_buf.find("<think>")
                                    if start == -1:
                                        safe = text_buf[:-7] if len(text_buf) > 7 else ""
                                        if safe:
                                            yield f"data: {json.dumps({'token': safe})}\n\n"
                                            text_buf = text_buf[len(safe):]
                                        break
                                    else:
                                        if start > 0:
                                            yield f"data: {json.dumps({'token': text_buf[:start]})}\n\n"
                                        in_think = True
                                        text_buf = text_buf[start + 7:]

                        if chunk.get("done"):
                            if text_buf:
                                if in_think:
                                    yield f"data: {json.dumps({'think_token': text_buf})}\n\n"
                                    yield f"data: {json.dumps({'think_end': True})}\n\n"
                                else:
                                    yield f"data: {json.dumps({'token': text_buf})}\n\n"
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
# 14. Flask Endpoints
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

    results = {"database": "not_found", "files": "not_found"}

    try:
        try:
            chroma_client.delete_collection(_collection_name(filename))
            results["database"] = "deleted"
        except Exception as e:
            results["database"] = f"error or already gone: {str(e)}"

        for folder in [UPLOAD_DIR, DOCS_DIR]:
            file_path = os.path.join(folder, filename)
            if os.path.exists(file_path):
                os.remove(file_path)
                results["files"] = "deleted"

        with _status_lock:
            if filename in _index_status:
                del _index_status[filename]

        return jsonify({"status": "success", "file": filename, "details": results}), 200

    except Exception as e:
        return jsonify({"error": f"Cleanup failed: {str(e)}"}), 500


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
        output.append({
            "text": doc[:300] + ("..." if len(doc) > 300 else ""),
            **meta,
        })

    output.sort(key=lambda x: int(x.get("chunk_index") or 0))
    return jsonify({"filename": filename, "chunks": output, "total": len(output)})


@app.route("/report-sections", methods=["GET"])
def report_sections():
    return jsonify({"sections": list(METALL_SECTION_KEYWORDS.keys())})


# ──────────────────────────────────────────────────────────────
# SSE helper
# ──────────────────────────────────────────────────────────────

def _sse(event_type: str, data: dict) -> str:
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"


# ──────────────────────────────────────────────────────────────
# Blocking report endpoint
# ──────────────────────────────────────────────────────────────

@app.route("/api/metall-report", methods=["POST"])
def generate_metall_report_endpoint():
    data = request.get_json(silent=True) or {}
    if not data.get("filename"):
        return jsonify({"error": "filename is required"}), 400

    try:
        result = generate_report(
            filename      = data["filename"],
            standard_hint = data.get("standard_hint", ""),
            material_name = data.get("material_name", ""),
            heat_number   = data.get("heat_number", ""),
            document_no   = data.get("document_no", ""),
        )
        return jsonify({
            "latex":      result["latex"],
            "sections":   result["sections"],
            "char_count": len(result["latex"]),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────────────────────────────────
# SSE streaming report endpoint
# ──────────────────────────────────────────────────────────────

def _run_report_with_stream(
    filename:      str,
    standard_hint: str,
    material_name: str,
    heat_number:   str,
    document_no:   str,
    event_queue:   "queue.Queue[tuple[str, dict]]",
):
    def stream_cb(event_type: str, data: dict):
        event_queue.put((event_type, data))

    try:
        result = generate_report(
            filename      = filename,
            standard_hint = standard_hint,
            material_name = material_name,
            heat_number   = heat_number,
            document_no   = document_no,
            stream_cb     = stream_cb,
        )
        event_queue.put(("final", {
            "latex":    result["latex"],
            "sections": [
                {
                    "section_key":   s["section_key"],
                    "latex_preview": s["latex_body"][:600],
                    "latex_chars":   len(s["latex_body"]),
                    "raw_json":      s.get("raw_json", "{}"),
                }
                for s in result["sections"]
            ],
        }))
    except Exception as e:
        event_queue.put(("error", {"message": str(e)}))


@app.route("/api/metall-report/stream", methods=["POST"])
@app.route("/generate-report", methods=["POST"])
def generate_metall_report_stream():
    data = request.get_json(silent=True) or {}
    if not data.get("filename"):
        return jsonify({"error": "filename is required"}), 400

    filename      = data["filename"]
    standard_hint = data.get("standard_hint", "") or data.get("query_hint", "")
    material_name = data.get("material_name", "")
    heat_number   = data.get("heat_number", "")
    document_no   = data.get("document_no", "")

    event_queue: "queue.Queue[tuple[str, dict]]" = queue.Queue()

    thread = threading.Thread(
        target=_run_report_with_stream,
        args=(filename, standard_hint, material_name, heat_number, document_no, event_queue),
        daemon=True,
    )
    thread.start()

    def _sse_generator():
        yield _sse("start", {
            "filename": filename,
            "message":  "Metallurgy report generation started",
        })

        done = False
        heartbeat_interval = 0
        while not done:
            try:
                event_type, payload = event_queue.get(timeout=15)

                if event_type == "final":
                    for sec in payload.get("sections", []):
                        yield _sse("section_ready", sec)

                    yield _sse("done", {
                        "latex":         payload["latex"],
                        "section_count": len(payload.get("sections", [])),
                        "char_count":    len(payload["latex"]),
                    })
                    done = True

                elif event_type == "error":
                    yield _sse("error", {"message": payload.get("message", "Unknown error")})
                    done = True

                else:
                    yield _sse(event_type, payload)

            except queue.Empty:
                heartbeat_interval += 1
                yield _sse("heartbeat", {"tick": heartbeat_interval})

                if heartbeat_interval > 40:
                    yield _sse("error", {"message": "Generation timed out after 10 minutes"})
                    done = True

    return Response(
        stream_with_context(_sse_generator()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Connection":                  "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
    )

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "*")
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response
 
@app.route("/file/<path:filename>", methods=["GET", "OPTIONS"])
def serve_file(filename):
    if request.method == "OPTIONS":
        # Preflight — return with proper CORS headers
        resp = make_response("", 204)
        resp.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Max-Age"] = "3600"
        return resp
 
    try:
        # 1. Try uploads dir first
        file_path = os.path.join(UPLOAD_DIR, filename)
 
        # 2. Fall back to docs dir
        if not os.path.exists(file_path):
            file_path = os.path.join(DOCS_DIR, filename)
 
        if not os.path.exists(file_path):
            return jsonify({"error": f"File not found: {filename}"}), 404
 
        # Detect mimetype — critical for PDF inline rendering
        ext = os.path.splitext(filename)[1].lower()
        mime_map = {
            ".pdf": "application/pdf",
            ".txt": "text/plain; charset=utf-8",
        }
        mimetype = mime_map.get(ext, "application/octet-stream")
 
        response = send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False,        # inline, not download
            conditional=True,           # supports range requests (PDF page seek)
        )
        
        # Add CORS headers explicitly to file response
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "public, max-age=3600"
        
        return response
 
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ──────────────────────────────────────────────────────────────
# 15. Run
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n[READY] RAG Backend  ->  http://127.0.0.1:8080")
    print(f"  Embeddings  : {EMBED_MODEL}")
    print(f"  Reranker    : {RERANK_MODEL if _RERANKER_AVAILABLE else 'disabled'}")
    print(f"  BM25        : {'enabled' if _BM25_AVAILABLE else 'disabled (pip install rank-bm25)'}")
    print(f"  Vector DB   : ChromaDB  ({CHROMA_DIR}/)")
    print(f"  LLM Model   : {OLLAMA_MODEL}")
    print(f"  Ollama Host : {OLLAMA_HOST}")
    print(f"  Docs Dir    : {DOCS_DIR}/")
    print(f"  Upload Dir  : {UPLOAD_DIR}/\n")
    app.run(host="0.0.0.0", port=8080, debug=True)