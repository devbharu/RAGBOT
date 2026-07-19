"""
report.py — Blueprint for generating single & multi-PDF reports and LaTeX PDF compilation.
"""

from flask import Blueprint, request, jsonify, Response, stream_with_context, send_file, g
# pyrefly: ignore [missing-import]
from flask_jwt_extended import jwt_required

from streaming.report_streamer import stream_single_pdf_report, stream_multi_pdf_report
from utils.latex import compile_latex_source
from services.chroma_service import ChromaService
from graphs.metall_report_graph import METALL_SECTION_KEYWORDS
from middleware.auth_middleware import jwt_and_user_required, validate_file_ownership
from utils.telemetry import logger

report_bp = Blueprint('report', __name__)

@report_bp.route("/report-sections", methods=["GET"])
@jwt_and_user_required()
def report_sections():
    """Fetch structured sections registry for LaTeX reports."""
    return jsonify({"sections": list(METALL_SECTION_KEYWORDS.keys())}), 200

from repositories.report_repository import ReportRepository

@report_bp.route("/reports", methods=["GET"])
@jwt_and_user_required()
def get_reports():
    """Fetch all reports for the current user."""
    reports = ReportRepository.get_user_reports(g.user_id)
    return jsonify({"reports": [r.to_dict() for r in reports]}), 200

@report_bp.route("/reports/<int:report_id>", methods=["DELETE"])
@jwt_and_user_required()
def delete_report(report_id):
    """Delete a report."""
    success = ReportRepository.delete_report(report_id, g.user_id)
    if success:
        return jsonify({"message": "Report deleted"}), 200
    return jsonify({"error": "Report not found or unauthorized"}), 404

@report_bp.route("/api/metall-report/stream", methods=["POST"])
@report_bp.route("/generate-report", methods=["POST"])
@jwt_and_user_required()
def generate_metall_report_stream():
    """
    POST /generate-report
    Spawns Single-PDF engineering/materials analysis report generator (SSE stream).
    """
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "filename is required"}), 400
        
    # Enforce file access checks
    if not validate_file_ownership(filename, g.user_id):
        return jsonify({"error": "Forbidden: You do not own this file"}), 403

    standard_hint = data.get("standard_hint", "") or data.get("query_hint", "")
    material_name = data.get("material_name", "")
    heat_number   = data.get("heat_number", "")
    document_no   = data.get("document_no", "")
    search_approach = data.get("search_approach", "tree").strip()

    stream = stream_single_pdf_report(
        filename=filename,
        standard_hint=standard_hint,
        material_name=material_name,
        heat_number=heat_number,
        document_no=document_no,
        user_id=g.user_id,
        search_approach=search_approach
    )
    
    return Response(
        stream_with_context(stream),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

@report_bp.route("/generate-multi-report", methods=["POST"])
@jwt_and_user_required()
def generate_multi_report_stream():
    """
    POST /generate-multi-report
    Spawns Multi-PDF cross-document analysis report generator (SSE stream).
    """
    data = request.get_json(silent=True) or {}
    filenames = data.get("filenames", [])
    
    chroma_service = ChromaService()
    if not filenames:
        filenames = chroma_service.list_indexed_files()
        
    # Filter only accessible files
    filenames = [f for f in filenames if validate_file_ownership(f, g.user_id)]
    if not filenames:
        return jsonify({"error": "No accessible indexed files found. Upload PDFs first."}), 400
 
    query = (data.get("query") or data.get("topic") or "").strip()
    if not query:
        return jsonify({"error": "query or topic is required"}), 400
 
    report_title = data.get("report_title", "").strip()
    if not report_title:
        report_title = query[:60]

    search_approach = data.get("search_approach", "tree").strip()

    stream = stream_multi_pdf_report(
        filenames=filenames,
        query=query,
        report_title=report_title,
        user_id=g.user_id,
        search_approach=search_approach
    )
    
    return Response(
        stream_with_context(stream),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

@report_bp.route("/compile-latex", methods=["POST"])
@jwt_and_user_required()
def compile_latex():
    """
    POST /compile-latex
    Compiles raw LaTeX source markup directly into a PDF download attachment.
    """
    data = request.get_json(silent=True) or {}
    latex_source = data.get("latex", "").strip()
    if not latex_source:
        return jsonify({"error": "No LaTeX source provided"}), 400

    try:
        pdf_path = compile_latex_source(latex_source)
        return send_file(
            pdf_path,
            mimetype="application/pdf",
            as_attachment=False,
            download_name="report.pdf"
        )
    except TimeoutError:
        return jsonify({"error": "LaTeX compilation timed out"}), 500
    except Exception as e:
        logger.error(f"[REPORT-ROUTES] LaTeX compile failed: {e}")
        return jsonify({"error": str(e)}), 500

@report_bp.route("/last-report", methods=["GET"])
@jwt_and_user_required()
def get_last_report():
    """Fetch the last generated report from disk cache."""
    import os
    import json
    cache_path = f"reports/last_report_{g.user_id}.json"
    if not os.path.exists(cache_path):
        return jsonify({"message": "No last report found"}), 404
        
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data), 200
    except Exception as e:
        logger.error(f"[REPORT-ROUTES] Failed to read last report cache: {e}")
        return jsonify({"error": "Failed to read cache"}), 500

@report_bp.route("/active-report", methods=["GET"])
@jwt_and_user_required()
def get_active_report():
    """Fetch the active report generation state from the server."""
    from streaming.report_streamer import active_reports, active_report_lock
    with active_report_lock:
        state_copy = dict(active_reports.get(g.user_id, {"status": "idle"}))
    return jsonify(state_copy), 200
