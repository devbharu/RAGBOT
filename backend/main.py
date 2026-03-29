"""
main.py
───────
Flask RAG backend — integrated with document_loader.py
  • Async VLM loader (Qwen via Ollama) runs in a background thread per upload
  • ChromaDB stores full metadata: page, chunk_index, total_pages, method, type
  • /status/<filename> endpoint so frontend knows when indexing is done
  • Streaming Ollama responses for chat
  • Full CRUD: upload, delete, reindex, list files
"""

import glob
import json
import os
import re
import threading
import warnings
import asyncio

import requests
from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# ── Import our new loader (async-capable) ──────────────────────
from docling_loader import load_single_file_async, load_documents_async

# ──────────────────────────────────────────────────────────────
# 1. Environment & App Init
# ──────────────────────────────────────────────────────────────
load_dotenv()
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"]   = "1"
warnings.filterwarnings("ignore")

app  = Flask(__name__)
CORS(app)

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b-cloud")
DOCS_DIR     = "rag_docs"
CHROMA_DIR   = "chroma_db"
UPLOAD_DIR   = "uploads"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DOCS_DIR,   exist_ok=True)

# ──────────────────────────────────────────────────────────────
# 2. ChromaDB + Embedding Setup
# ──────────────────────────────────────────────────────────────
print("[INIT] Setting up ChromaDB...")

embedding_fn = SentenceTransformerEmbeddingFunction(
    model_name="BAAI/bge-small-en-v1.5",
    normalize_embeddings=True
)

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

# ──────────────────────────────────────────────────────────────
# 3. Indexing status tracker  (thread-safe dict)
#    States: "indexing" | "ready" | "error:<msg>"
# ──────────────────────────────────────────────────────────────
_index_status: dict[str, str] = {}
_status_lock                  = threading.Lock()

def _set_status(filename: str, status: str):
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
        name             = _collection_name(filename),
        embedding_function = embedding_fn,
        metadata         = {"hnsw:space": "cosine"},
    )

# ──────────────────────────────────────────────────────────────
# 5. Core indexing logic  (runs in a background thread)
# ──────────────────────────────────────────────────────────────

def _do_index(filepath: str, filename: str, force: bool = False):
    """
    Background worker:
      1. Loads & chunks the file using the async loader (runs via asyncio.run)
      2. Pushes chunks into ChromaDB with full metadata
    Sets _index_status[filename] to "ready" or "error:<msg>" when done.
    """
    collection = _get_collection(filename)

    if not force and collection.count() > 0:
        print(f"[CHROMA] '{filename}' already indexed ({collection.count()} chunks). Skipping.")
        _set_status(filename, "ready")
        return

    _set_status(filename, "indexing")
    print(f"\n[CHROMA] ── Indexing: {filename} ──")

    try:
        # Run the async loader synchronously inside this thread
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

    # Push to ChromaDB in batches of 100
    batch_size = 100
    col_name   = _collection_name(filename)

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]

        collection.add(
            documents = [c["text"] for c in batch],
            metadatas = [
                {
                    # ── Core ──────────────────────────────────
                    "source":      c.get("source",      filename),
                    "type":        c.get("type",         "text"),
                    "method":      c.get("method",       ""),
                    # ── Page tracking ─────────────────────────
                    "page":        str(c.get("page")   or ""),
                    "total_pages": str(c.get("total_pages") or ""),
                    # ── Chunk ordering ────────────────────────
                    "chunk_index": str(c.get("chunk_index") or i + batch.index(c)),
                }
                for c in batch
            ],
            ids = [
                f"{col_name}_chunk_{i + j}"
                for j in range(len(batch))
            ],
        )
        print(f"  [CHROMA] Batch {i // batch_size + 1}: pushed {len(batch)} chunks")

    print(f"[CHROMA] ✓ '{filename}' → {len(chunks)} chunks indexed.")
    _set_status(filename, "ready")


def index_file_background(filepath: str, filename: str, force: bool = False):
    """Spawn a daemon thread so the upload endpoint returns immediately."""
    t = threading.Thread(
        target   = _do_index,
        args     = (filepath, filename, force),
        daemon   = True,
        name     = f"indexer-{filename}",
    )
    t.start()
    return t

# ──────────────────────────────────────────────────────────────
# 6. Search helper
# ──────────────────────────────────────────────────────────────

def search_file(filename: str, query: str, k: int = 8) -> list[dict]:
    collection = _get_collection(filename)

    if collection.count() == 0:
        return []

    results = collection.query(
        query_texts = [query],
        n_results   = min(k, collection.count()),
        include     = ["documents", "metadatas", "distances"],
    )

    hits = []
    for doc, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        hits.append({
            "text":        doc,
            "source":      meta.get("source",      filename),
            "type":        meta.get("type",         "text"),
            "method":      meta.get("method",       ""),
            "page":        meta.get("page",         ""),
            "total_pages": meta.get("total_pages",  ""),
            "chunk_index": meta.get("chunk_index",  ""),
            "score":       round(1 - dist, 4),
        })

    return hits


def list_indexed_files() -> list[str]:
    collections = chroma_client.list_collections()
    return [
        col.name.replace("file_", "", 1)
        for col in collections
        if col.name.startswith("file_")
    ]

# ──────────────────────────────────────────────────────────────
# 7. Load default docs on startup  (background, non-blocking)
# ──────────────────────────────────────────────────────────────

def _load_default_docs():
    pdf_files = glob.glob(f"{DOCS_DIR}/**/*.pdf", recursive=True)
    txt_files = glob.glob(f"{DOCS_DIR}/**/*.txt", recursive=True)
    all_files = pdf_files + txt_files

    if not all_files:
        print("[STARTUP] No default docs found in rag_docs/")
        return

    for filepath in all_files:
        filename = os.path.basename(filepath)
        index_file_background(filepath, filename)   # non-blocking

_load_default_docs()

# ──────────────────────────────────────────────────────────────
# 8. Helpers: clean text, small-talk detection
# ──────────────────────────────────────────────────────────────

def clean_text(text: str) -> str:
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ",   text)
    return text


SMALL_TALK_PATTERNS = [
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
    return any(re.search(p, q) for p in SMALL_TALK_PATTERNS)


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
        return (
            "I can answer questions based on the content of your PDFs or text files. "
            "Upload a document and start asking!"
        )
    if re.search(r"^help$", q):
        return "Upload a PDF or TXT, select it, then type your question."
    return "I'm here to help with your documents! Ask me anything."

# ──────────────────────────────────────────────────────────────
# 9. Ollama RAG streaming generator
# ──────────────────────────────────────────────────────────────

def generate_ollama_response(
    query:       str,
    filename:    str,
    temperature: float = 0.4,
    max_tokens:  int   = 1024,
    top_p:       float = 0.9,
):
    """
    Returns (result, is_stream):
      - is_stream=False → result is a plain string (small talk / no hits)
      - is_stream=True  → result is a generator yielding SSE data lines
    """
    # ── Small talk short-circuit ──
    if is_small_talk(query):
        return handle_small_talk(query), False

    # ── Check indexing status ──
    status = _get_status(filename)
    if status == "indexing":
        return f"'{filename}' is still being indexed. Please wait a moment and try again.", False
    if status.startswith("error:"):
        return f"Indexing failed for '{filename}': {status[6:]}", False

    # ── Retrieve relevant chunks ──
    hits = search_file(filename, query)
    if not hits:
        return f"No relevant content found in '{filename}'.", False

    # Build context with rich metadata labels
    context_parts = []
    for h in hits:
        page_info = f"p.{h['page']}/{h['total_pages']}" if h.get("page") else ""
        label = (
            f"[{h['type'].upper()} | {h['source']} "
            f"{page_info} | method:{h['method']} | chunk:{h['chunk_index']} | score:{h['score']}]"
        )
        context_parts.append(f"{label}\n{h['text']}")

    context_text = "\n\n".join(context_parts)
    print(f"\n[CONTEXT for '{filename}']\n{context_text[:800]}{'...' if len(context_text) > 800 else ''}\n")

    payload = {
        "model":   OLLAMA_MODEL,
        "stream":  True,
        "messages": [
            {
                "role":    "system",
                "content": (
                    "You are a helpful academic assistant. "
                    "Answer clearly and in detail based only on the provided context. "
                    "Use markdown formatting — bold, tables, bullet points where appropriate. "
                    "If the context contains relevant information, always use it to answer. "
                    "Cite the page number when you reference specific content."
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

    def stream_tokens():
        try:
            with requests.post(
                f"{OLLAMA_HOST}/api/chat",
                json    = payload,
                stream  = True,
                timeout = 120,
            ) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
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
            yield (
                f"data: {json.dumps({'token': 'Error: Ollama not running. Run: ollama serve'})}\n\n"
                "data: [DONE]\n\n"
            )
        except requests.exceptions.Timeout:
            yield f"data: {json.dumps({'token': 'Error: Ollama request timed out.'})}\n\ndata: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'token': f'Error: {e}'})}\n\ndata: [DONE]\n\n"

    return stream_tokens(), True

# ──────────────────────────────────────────────────────────────
# 10. Flask Endpoints
# ──────────────────────────────────────────────────────────────

@app.route("/upload", methods=["POST"])
def upload():
    """
    POST /upload  (multipart/form-data, field: 'file')
    Saves the file, kicks off background indexing, returns immediately.
    Poll /status/<filename> to know when indexing is done.
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




@app.route("/generate", methods=["POST"])
def chat():
    """
    POST /generate  { prompt, filename, temperature?, max_output_tokens?, top_p? }
    Streams SSE tokens or returns a plain JSON response for small talk.
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
        temperature = float(data.get("temperature",        0.4)),
        max_tokens  = int(data.get("max_output_tokens",   1024)),
        top_p       = float(data.get("top_p",              0.9)),
    )

    if is_stream:
        return Response(
            stream_with_context(result),
            mimetype = "text/event-stream",
            headers  = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        return jsonify({"prompt": prompt, "filename": filename, "response": result})


@app.route("/files", methods=["GET"])
def files():
    """GET /files — list all indexed file names with their status."""
    all_files = list_indexed_files()
    return jsonify({
        "files": [
            {"name": f, "status": _get_status(f) or "ready"}
            for f in all_files
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
    Drops the existing collection and re-indexes from scratch (background).
    """
    data     = request.json or {}
    filename = data.get("filename", "").strip()

    if not filename:
        return jsonify({"error": "No filename provided"}), 400

    try:
        chroma_client.delete_collection(_collection_name(filename))
    except Exception:
        pass  # Collection might not exist yet — that's fine

    # Find the file
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
    Returns all stored chunks for a file (optionally filtered by page).
    Useful for debugging the loader output.
    """
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
        output.append({"text": doc[:300] + ("..." if len(doc) > 300 else ""), **meta})

    output.sort(key=lambda x: int(x.get("chunk_index") or 0))
    return jsonify({"filename": filename, "chunks": output, "total": len(output)})


# ──────────────────────────────────────────────────────────────
# 11. Run
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n[READY] RAG Backend  →  http://127.0.0.1:8080")
    print(f"  Embeddings  : BAAI/bge-small-en-v1.5")
    print(f"  Vector DB   : ChromaDB  ({CHROMA_DIR}/)")
    print(f"  LLM Model   : {OLLAMA_MODEL}")
    print(f"  Ollama Host : {OLLAMA_HOST}")
    print(f"  VLM Loader  : document_loader.py  (Qwen via Ollama)")
    print(f"  Docs Dir    : {DOCS_DIR}/")
    print(f"  Upload Dir  : {UPLOAD_DIR}/\n")
    app.run(host="0.0.0.0", port=8080, debug=True)