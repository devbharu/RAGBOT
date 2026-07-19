import os
import glob
from flask import Blueprint, jsonify, g
from services.chroma_service import ChromaService
from services.pageindex_builder import get_build_status
from middleware.auth_middleware import jwt_and_user_required, validate_file_ownership

analytics_bp = Blueprint("analytics", __name__)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")

@analytics_bp.route("/index", methods=["GET"])
@jwt_and_user_required()
def get_index_analytics():
    """
    Returns index status for all uploaded documents.
    Determines if a document exists in ChromaDB (Vector), 
    and if it has a _heuristic or _premium PageIndex tree.
    """
    try:
        # Get all uploaded documents visible to the active user.
        uploaded_files = (
            glob.glob(os.path.join(UPLOAD_DIR, "*.pdf")) +
            glob.glob(os.path.join(UPLOAD_DIR, "*.txt"))
        )
        
        # Get all files indexed in ChromaDB
        chroma = ChromaService()
        vector_files = {
            filename
            for filename in chroma.list_indexed_files()
            if validate_file_ownership(filename, g.user_id)
        }
        
        analytics_data = []
        for file_path in uploaded_files:
            filename = os.path.basename(file_path)
            if not validate_file_ownership(filename, g.user_id):
                continue

            base_name = os.path.splitext(filename)[0]
            
            # Check for heuristic tree
            heuristic_path = os.path.join(UPLOAD_DIR, f"{base_name}_heuristic.pageindex.json")
            has_heuristic = os.path.exists(heuristic_path)
            
            # Check for premium tree
            premium_path = os.path.join(UPLOAD_DIR, f"{filename}_tree.pageindex.json")
            has_premium = os.path.exists(premium_path)
            
            has_vector = filename in vector_files
            
            build_info = get_build_status(filename)
            
            analytics_data.append({
                "filename": filename,
                "has_vector": has_vector,
                "has_heuristic": has_heuristic,
                "has_premium": has_premium,
                "build_status": build_info,
                "size_bytes": os.path.getsize(file_path)
            })
            
        # Sort by filename
        analytics_data.sort(key=lambda x: x["filename"])
        
        return jsonify({"status": "success", "data": analytics_data}), 200
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
