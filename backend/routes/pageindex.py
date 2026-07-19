"""
pageindex.py — Blueprint for PageIndex Visualizer tree builders and reasoning-based RAG search streams.
"""

import os
import json
from flask import Blueprint, request, jsonify, Response, stream_with_context, g
from flask_jwt_extended import jwt_required

from services.pageindex_builder import start_pageindex_build, get_build_status
from services.pageindex_cache import PageIndexCache
from streaming.pageindex_streamer import execute_reasoning_tree_search
from middleware.auth_middleware import jwt_and_user_required, validate_file_ownership
from utils.telemetry import logger

# Technical Note: PageIndex blueprint handles visual trees and reasoning search streams.
pageindex_bp = Blueprint("pageindex", __name__)

UPLOAD_DIR = "uploads"

@pageindex_bp.route("/build", methods=["POST"])
@jwt_and_user_required()
def build_tree():
    """Start semantic page index construction in background."""
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "No filename provided"}), 400
        
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden: You do not own this file"}), 403
        
    try:
        start_pageindex_build(filename)
        return jsonify({
            "status": "started",
            "message": f"Tree index build started for {filename}.",
            "poll_url": f"/pageindex/status/{filename}"
        }), 202
    except Exception as e:
        logger.error(f"[PAGEINDEX-ROUTES] Failed to start tree build: {e}")
        return jsonify({"error": str(e)}), 500

@pageindex_bp.route("/status/<path:filename>", methods=["GET"])
@jwt_and_user_required()
def build_status(filename: str):
    """Check background index builder progress."""
    filename = filename.strip()
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden"}), 403
        
    status = get_build_status(filename)
    return jsonify(status), 200

@pageindex_bp.route("/tree/<path:filename>", methods=["GET"])
@jwt_and_user_required()
def get_tree(filename: str):
    """
    Retrieve document tree structure.
    Uses in-memory PageIndexCache to bypass repetitious disk I/O.
    """
    filename = filename.strip()
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden"}), 403
        
    cache_key = f"{filename}_tree"
    cache = PageIndexCache()
    tree = cache.get_tree(cache_key)
    
    from services.pageindex_builder import _resolve_pageindex_path
    
    # Premium tree path resolution
    index_path = _resolve_pageindex_path(filename, suffix="_tree")
    
    # If cached tree exists
    if tree:
        return jsonify(tree), 200
            
    # If premium file exists on disk
    if index_path and os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                tree = json.load(f)
            cache.set_tree(cache_key, tree)
            return jsonify(tree), 200
        except Exception as e:
            logger.error(f"[PAGEINDEX-ROUTES] Failed to read premium tree disk JSON: {e}")
            return jsonify({"error": "Failed to read document index tree"}), 500
    else:
        # Premium tree not built yet, return 404 to trigger frontend CTA
        return jsonify({"error": "Premium PageIndex Tree not built yet"}), 404

@pageindex_bp.route("/chat", methods=["POST"])
@jwt_and_user_required()
def pageindex_chat():
    """
    POST /chat
    Visual PageIndex chat search and reasoning generation (SSE stream).
    Supports single or multiple file RAG.
    """
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    filenames = data.get("filenames", [])
    
    # Backward compatibility: if single filename is provided
    if not filenames:
        filename = data.get("filename", "").strip()
        if filename:
            filenames = [filename]
            
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    if not filenames:
        return jsonify({"error": "No handbooks selected"}), 400

    # Filter and validate access to all requested files
    valid_filenames = []
    for fname in filenames:
        fname = fname.strip()
        if fname and validate_file_ownership(fname, g.user_id):
            valid_filenames.append(fname)
            
    if not valid_filenames:
        return jsonify({"error": "Forbidden: You do not own the selected files"}), 403

    def stream_search():
        generator = execute_reasoning_tree_search(prompt, valid_filenames)
        for chunk in generator:
            yield chunk

    return Response(
        stream_with_context(stream_search()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )
