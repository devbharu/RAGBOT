"""
file.py — Blueprint for secure multi-user document ingestion, reindexing, deletions, and chunk queries.
"""

import os
import re
import json
import asyncio
from flask import Blueprint, request, jsonify, make_response, send_file, g
from flask_jwt_extended import jwt_required

from services.chroma_service import ChromaService
from services.loader_service import LoaderService
from middleware.auth_middleware import jwt_and_user_required, validate_file_ownership
from utils.telemetry import logger


def _sanitize_upload_filename(raw_name: str) -> str:
    """
    Normalize an uploaded filename so the on-disk PDF name always matches
    the Chroma collection key and chunks file name.
    Rules:
      - Strip leading/trailing whitespace
      - Collapse any whitespace runs to a single space
      - Remove characters that are problematic on most filesystems
      - Preserve the original extension (.pdf / .txt)
    """
    # Split off extension
    root, ext = os.path.splitext(raw_name.strip())
    # Collapse internal whitespace
    root = re.sub(r'\s+', ' ', root)
    # Remove characters unsafe for filenames (keep alphanumeric, spaces, dashes, underscores, dots, parentheses)
    root = re.sub(r'[^\w .\-()\[\]]+', '', root, flags=re.UNICODE)
    root = root.strip('. ')
    if not root:
        root = "document"
    return root + ext.lower()


def _allowed_cors_origin() -> str:
    allowed = {
        item.strip()
        for item in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if item.strip()
    }
    origin = request.headers.get("Origin")
    return origin if origin in allowed else ""


def _resolve_physical_file_path(filename: str) -> str:
    """
    Fuzzy resolver for physical files on disk.
    Handles space/underscore mismatches and missing extensions.
    """
    import glob
    import re
    
    # 1. Try exact match in UPLOAD_DIR
    path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(path):
        return path
        
    # 2. Try exact match in DOCS_DIR
    path = os.path.join(DOCS_DIR, filename)
    if os.path.exists(path):
        return path

    def _norm(s: str) -> str:
        # Keep only alphanumeric characters, strip trailing 'pdf' or 'txt'
        n = re.sub(r'[^a-z0-9]', '', s.lower())
        n = re.sub(r'(pdf|txt)$', '', n)
        return n

    # Scan for candidates in both upload and docs dirs
    candidates = []
    for folder in [UPLOAD_DIR, DOCS_DIR]:
        candidates.extend(glob.glob(os.path.join(folder, '*')))
        
    norm_target = _norm(os.path.splitext(filename)[0])
    if not norm_target:
        return ''
        
    # Exact normalized match
    for cand in candidates:
        stem = os.path.splitext(os.path.basename(cand))[0]
        if _norm(stem) == norm_target:
            return cand
            
    # Substring match
    for cand in candidates:
        stem = os.path.splitext(os.path.basename(cand))[0]
        norm_cand = _norm(stem)
        if norm_target and norm_cand and (norm_target in norm_cand or norm_cand in norm_target):
            return cand
            
    return ''


file_bp = Blueprint('file', __name__)

UPLOAD_DIR = "uploads"
DOCS_DIR = "rag_docs"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)

@file_bp.route("/upload", methods=["POST"])
@jwt_and_user_required()
def upload_file():
    """Upload a new PDF/TXT file, saving it with a user-prefix for isolation."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
        
    file = request.files["file"]
    raw_filename = file.filename or ""
    if not raw_filename.lower().endswith((".pdf", ".txt")):
        return jsonify({"error": "Only PDF and TXT files are supported"}), 400
    
    # Sanitize the filename so the on-disk name is consistent with the Chroma collection key
    clean_name = _sanitize_upload_filename(raw_filename)
    
    # Prefix with user_id to enforce secure multi-user isolation
    isolated_filename = f"{g.user_id}_{clean_name}"
    save_path = os.path.join(UPLOAD_DIR, isolated_filename)
    file.save(save_path)
    logger.info(f"[FILE-ROUTES] Saved upload: raw='{raw_filename}' -> isolated='{isolated_filename}'")
    
    loader_service = LoaderService()

    def run_ingest():
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(loader_service.load_file(save_path, isolated_filename, force=False))
        except Exception as e:
            logger.error(f"[FILE-ROUTES] Ingestion background thread error: {e}")

    import threading
    threading.Thread(target=run_ingest, daemon=True, name=f"loader-{isolated_filename}").start()
    
    return jsonify({
        "status": "upload_received",
        "file": isolated_filename,
        "display_name": clean_name,
        "message": "File saved successfully. Ingestion initiated.",
        "poll_url": f"/status/{isolated_filename}"
    }), 200

@file_bp.route("/status/<path:filename>", methods=["GET"])
@jwt_and_user_required()
def file_status(filename: str):
    """Check loading/indexing status of a specific document."""
    filename = filename.strip()
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Access to document status is forbidden"}), 403
        
    loader_service = LoaderService()
    chk = loader_service.get_checkpoint(filename)
    
    # Fallback to verify Chroma collection count
    status_str = "unknown"
    if chk:
        status_str = chk["status"]
    else:
        try:
            chroma_service = ChromaService()
            col = chroma_service.get_collection(filename)
            if col.count() > 0:
                status_str = "ready"
        except Exception:
            pass
            
    return jsonify({"filename": filename, "status": status_str}), 200

@file_bp.route("/files", methods=["GET"])
@jwt_and_user_required()
def list_files():
    """List all indexed documents accessible by the active user (owned + public)."""
    try:
        user_id = g.user_id
        
        chroma_service = ChromaService()
        loader_service = LoaderService()
        raw_list = chroma_service.list_indexed_files()
        
        result = []
        seen = set()
        for f in raw_list:
            if f in seen:
                continue
            seen.add(f)
            # Enforce access criteria: belongs to user or is public
            if user_id and not validate_file_ownership(f, user_id):
                continue
                
            status_str = "ready"
            chk = loader_service.get_checkpoint(f)
            if chk:
                status_str = chk["status"]
                
            # Strip user-prefix for clean UI displays
            display_name = f
            parts = f.split('_', 1)
            if len(parts) > 1 and parts[0].isdigit():
                display_name = parts[1]
                
            result.append({
                "name": f,
                "display_name": display_name,
                "status": status_str
            })
            
        return jsonify({"files": result}), 200
    except Exception as e:
        logger.error(f"[FILE-ROUTES] Error listing files: {e}")
        return jsonify({"error": "Failed to list files"}), 500

@file_bp.route("/delete", methods=["POST"])
@jwt_and_user_required()
def delete_file():
    """Delete a document collection from both vector storage and filesystem (owner only)."""
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "No filename provided"}), 400
        
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden: You do not own this file"}), 403
        
    results = {"database": "not_found", "files": "not_found"}
    
    try:
        chroma_service = ChromaService()
        deleted = chroma_service.delete_collection(filename)
        if deleted:
            results["database"] = "deleted"
            
        # Remove physical file assets
        for folder in [UPLOAD_DIR, DOCS_DIR]:
            file_path = os.path.join(folder, filename)
            if os.path.exists(file_path):
                os.remove(file_path)
                results["files"] = "deleted"
            
            # Remove chunk cache on disk
            cache_file = file_path + ".chunks.json"
            if os.path.exists(cache_file):
                os.remove(cache_file)
                
            # Remove PageIndex indexes on disk
            for suffix in (".pageindex.json", "_tree.pageindex.json", "_heuristic.pageindex.json"):
                pageindex_file = file_path + suffix
                if os.path.exists(pageindex_file):
                    os.remove(pageindex_file)
                
        loader_service = LoaderService()
        loader_service.set_checkpoint(filename, "unknown", 0.0)
        
        return jsonify({"status": "success", "file": filename, "details": results}), 200
    except Exception as e:
        logger.error(f"[FILE-ROUTES] Ingestion cleanup failed: {e}")
        return jsonify({"error": f"Cleanup failed: {str(e)}"}), 500

@file_bp.route("/reindex", methods=["POST"])
@jwt_and_user_required()
def reindex_file():
    """Wipes vector storage and schedules fresh, full load of an owned document."""
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "No filename provided"}), 400
        
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden: You do not own this file"}), 403
        
    try:
        chroma_service = ChromaService()
        chroma_service.delete_collection(filename)
    except Exception:
        pass
        
    # Delete chunks and trees from disk
    for base in (UPLOAD_DIR, DOCS_DIR):
        file_base = os.path.join(base, filename)
        for suffix in (".chunks.json", ".pageindex.json", "_tree.pageindex.json", "_heuristic.pageindex.json"):
            tgt = file_base + suffix
            if os.path.exists(tgt):
                try:
                    os.remove(tgt)
                except Exception:
                    pass
                    
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": f"Physical source file not found: {filename}"}), 404
        
    loader_service = LoaderService()
    
    # Run ingestion thread
    def run_reingest():
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(loader_service.load_file(filepath, filename, force=True))
        except Exception as e:
            logger.error(f"[FILE-ROUTES] Ingestion background thread error: {e}")
            
    import threading
    threading.Thread(target=run_reingest, daemon=True).start()
    
    return jsonify({
        "status": "reindex_started",
        "file": filename,
        "poll_url": f"/status/{filename}"
    }), 200

@file_bp.route("/chunks", methods=["GET"])
@jwt_and_user_required()
def get_chunks():
    """Inspect stored text chunks (owned + public documents)."""
    filename = request.args.get("filename", "").strip()
    page = request.args.get("page", "").strip()
    if not filename:
        return jsonify({"error": "filename query param required"}), 400
        
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden"}), 403
        
    chroma_service = ChromaService()
    collection = chroma_service.get_collection(filename)
    if collection.count() == 0:
        return jsonify({"filename": filename, "chunks": [], "total": 0})
        
    results = collection.get(include=["documents", "metadatas"])
    output = []
    for doc, meta in zip(results["documents"], results["metadatas"]):
        if page and meta.get("page") != page:
            continue
        output.append({"text": doc[:300] + ("..." if len(doc) > 300 else ""), **meta})
        
    output.sort(key=lambda x: int(x.get("chunk_index") or 0))
    return jsonify({"filename": filename, "chunks": output, "total": len(output)}), 200

@file_bp.route("/file/<path:filename>", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)  # Fallback optional to let PDF displays render via standard HTTP src bindings
def serve_file(filename: str):
    """Secure PDF/TXT download link server (owner only)."""
    if request.method == "OPTIONS":
        resp = make_response("", 204)
        origin = _allowed_cors_origin()
        if origin:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Max-Age"] = "3600"
        return resp
        
    # Exclude public default files from strict auth checks
    parts = filename.split('_', 1)
    is_isolated = len(parts) > 1 and parts[0].isdigit()
    
    if is_isolated:
        # Check active session token from header or query parameter
        from flask_jwt_extended import verify_jwt_in_request, decode_token
        try:
            token_param = request.args.get("token")
            if token_param:
                decoded = decode_token(token_param)
                user_id = decoded.get("sub")
                if user_id is not None:
                    try:
                        user_id = int(user_id)
                    except ValueError:
                        user_id = None
                if not user_id or int(parts[0]) != user_id:
                    return jsonify({"error": "Forbidden"}), 403
            else:
                verify_jwt_in_request()
                from flask_jwt_extended import get_jwt_identity
                from middleware.auth_middleware import _normalize_user_id
                user_id = _normalize_user_id(get_jwt_identity())
                if not user_id or int(parts[0]) != user_id:
                    return jsonify({"error": "Forbidden"}), 403
        except Exception:
            return jsonify({"error": "Unauthorized"}), 401
            
    try:
        file_path = _resolve_physical_file_path(filename)
        if not file_path or not os.path.exists(file_path):
            file_path = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(DOCS_DIR, filename)
        if not os.path.exists(file_path):
            return jsonify({"error": f"File not found: {filename}"}), 404
            
        ext = os.path.splitext(file_path)[1].lower()
        mime_map = {".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8"}
        mimetype = mime_map.get(ext, "application/octet-stream")
        
        response = send_file(file_path, mimetype=mimetype, as_attachment=False, conditional=True)
        origin = _allowed_cors_origin()
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "public, max-age=3600"
        return response
    except Exception as e:
        logger.error(f"[FILE-ROUTES] Serving file {filename} crashed: {e}")
        return jsonify({"error": str(e)}), 500
