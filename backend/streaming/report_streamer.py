"""
report_streamer.py — Server-Sent Events (SSE) streaming generators for Single & Multi-PDF Reports.
"""

import queue
import threading
import os
import json
import time
from typing import Generator, Dict, Any, List

from services.llm_service import LLMService
from graphs.metall_report_graph import generate_report
from graphs.multi_pdf_report_graph import generate_multi_pdf_report
from utils.sse import format_sse
from utils.telemetry import logger, time_telemetry

# ─── ACTIVE REPORT GENERATION STATE TRACKER ────────────────────
active_report_lock = threading.Lock()
active_reports: Dict[int, Dict[str, Any]] = {}

def init_active_report(user_id: int, mode: str, filename: str = None, filenames: list = None, query: str = ""):
    with active_report_lock:
        active_reports[user_id] = {
            "status": "running",
            "mode": mode,
            "filename": filename,
            "filenames": filenames or [],
            "query": query or "",
            "events": [],
            "timestamp": time.time()
        }
        logger.info(f"[REPORT-STREAMER] Initialized active report tracking. User: {user_id}, Mode: {mode}, Query: '{query}'")

def update_active_report_event(user_id: int, event_type: str, data: dict):
    with active_report_lock:
        if user_id not in active_reports or active_reports[user_id]["status"] != "running":
            return
        active_reports[user_id]["events"].append({
            "type": event_type,
            "data": data,
            "timestamp": time.time()
        })
        logger.debug(f"[REPORT-STREAMER] Logged event to active state for User {user_id}: {event_type}")

def set_active_report_status(user_id: int, status: str):
    with active_report_lock:
        if user_id in active_reports:
            active_reports[user_id]["status"] = status
        logger.info(f"[REPORT-STREAMER] Active report status transitioned for User {user_id} to: {status}")

def _save_report_to_disk(user_id: int, report_data: dict):
    try:
        os.makedirs("reports", exist_ok=True)
        report_data["timestamp"] = time.time()
        with open(f"reports/last_report_{user_id}.json", "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
        logger.info(f"[REPORT-STREAMER] Successfully saved last report to disk cache for User {user_id}.")
    except Exception as e:
        logger.error(f"[REPORT-STREAMER] Failed to save last report to disk for User {user_id}: {e}")

def _run_single_report_thread(user_id: int, filename: str, standard_hint: str, material_name: str, heat_number: str, document_no: str, tree_type: str, search_approach: str, event_queue: queue.Queue):
    def stream_cb(event_type, data):
        update_active_report_event(user_id, event_type, data)
        event_queue.put((event_type, data))
    try:
        result = generate_report(
            filename=filename, standard_hint=standard_hint,
            material_name=material_name, heat_number=heat_number,
            document_no=document_no, tree_type=tree_type,
            search_approach=search_approach,
            stream_cb=stream_cb,
        )
        sections = [
            {"section_key": s["section_key"], "latex_preview": s["latex_body"][:600],
             "latex_chars": len(s["latex_body"]), "raw_json": s.get("raw_json", "{}")}
            for s in result["sections"]
        ]
        
        # Cache completed single PDF report on disk
        _save_report_to_disk(user_id, {
            "mode": "single",
            "filename": filename,
            "query": standard_hint,
            "latex": result["latex"],
            "sections": sections,
        })

        for sec in sections:
            update_active_report_event(user_id, "section_ready", sec)

        update_active_report_event(user_id, "done", {
            "latex": result["latex"],
            "section_count": len(sections),
            "char_count": len(result["latex"]),
        })
        set_active_report_status(user_id, "completed")

        event_queue.put(("final", {
            "latex": result["latex"],
            "sections": sections,
        }))
    except Exception as e:
        logger.error(f"[REPORT-STREAMER] Single-PDF generation thread crashed: {e}")
        update_active_report_event(user_id, "error", {"message": str(e)})
        set_active_report_status(user_id, "failed")
        event_queue.put(("error", {"message": str(e)}))

@time_telemetry("report_streamer.stream_single_pdf_report")
def stream_single_pdf_report(
    filename: str, 
    standard_hint: str = "", 
    material_name: str = "", 
    heat_number: str = "", 
    document_no: str = "",
    user_id: int = 1,
    tree_type: str = "tree",
    search_approach: str = "tree"
) -> Generator[str, None, None]:
    """
    SSE stream generator for Single-PDF metal reports.
    Protects local resources via LLMService's report semaphore lock.
    """
    llm_service = LLMService()
    
    # Try to acquire lock to prevent concurrency exhaustion
    locked = llm_service.acquire_report_lock(timeout=10.0)
    if not locked:
        yield format_sse("error", {"message": "LLM server is currently busy compiling another report. Please wait."})
        yield format_sse("DONE", None)
        return
        
    event_queue = queue.Queue()
    init_active_report(user_id, "single", filename=filename, query=standard_hint)
    thread = threading.Thread(
        target=_run_single_report_thread,
        args=(user_id, filename, standard_hint, material_name, heat_number, document_no, tree_type, search_approach, event_queue),
        daemon=True,
        name=f"single-report-{filename}"
    )
    thread.start()
    
    try:
        yield format_sse("start", {"filename": filename, "message": "Report generation started"})
        done = False
        heartbeat_interval = 0
        
        while not done:
            try:
                event_type, payload = event_queue.get(timeout=15)
                if event_type == "final":
                    for sec in payload.get("sections", []):
                        yield format_sse("section_ready", sec)
                        
                    # Save to Database
                    try:
                        from repositories.report_repository import ReportRepository
                        import json
                        ReportRepository.create_report(
                            user_id=user_id,
                            title=f"Single-PDF Report: {filename}",
                            query=f"Standard: {standard_hint} | Material: {material_name}",
                            content=payload["latex"],
                            files=json.dumps([filename])
                        )
                    except Exception as e:
                        logger.error(f"[REPORT-STREAMER] Failed to persist single report to DB: {e}")
                        
                    yield format_sse("done", {
                        "latex": payload["latex"],
                        "section_count": len(payload.get("sections", [])),
                        "char_count": len(payload["latex"]),
                    })
                    done = True
                elif event_type == "error":
                    yield format_sse("error", {"message": payload.get("message", "Unknown error")})
                    done = True
                else:
                    yield format_sse(event_type, payload)
            except queue.Empty:
                heartbeat_interval += 1
                yield format_sse("heartbeat", {"tick": heartbeat_interval})
                if heartbeat_interval > 40: # 10 min timeout
                    yield format_sse("error", {"message": "Generation timed out"})
                    done = True
                    
    except GeneratorExit:
        logger.warn("[REPORT-STREAMER] Client disconnected from single report stream.")
        raise
    finally:
        llm_service.release_report_lock()


def _run_multi_report_thread(user_id: int, filenames: List[str], query: str, report_title: str, tree_type: str, search_approach: str, event_queue: queue.Queue):
    def stream_cb(event_type, data):
        update_active_report_event(user_id, event_type, data)
        event_queue.put((event_type, data))
    try:
        result = generate_multi_pdf_report(
            filenames=filenames,
            query=query,
            report_title=report_title,
            tree_type=tree_type,
            search_approach=search_approach,
            stream_cb=stream_cb,
        )
        doc_results = [
            {
                "filename": r["filename"],
                "found_data": r.get("found_data", False),
                "findings_chars": r.get("findings_chars", 0),
            }
            for r in result["doc_results"]
        ]

        # Cache completed multi-PDF report on disk
        _save_report_to_disk(user_id, {
            "mode": "multi",
            "query": query,
            "latex": result["latex"],
            "doc_results": doc_results,
            "report_title": report_title,
        })

        update_active_report_event(user_id, "done", {
            "latex": result["latex"],
            "char_count": len(result["latex"]),
            "doc_results": doc_results,
            "doc_count": len(doc_results),
        })
        set_active_report_status(user_id, "completed")

        event_queue.put(("final", {
            "latex": result["latex"],
            "doc_results": doc_results,
        }))
    except Exception as e:
        logger.error(f"[REPORT-STREAMER] Multi-PDF generation thread crashed: {e}")
        update_active_report_event(user_id, "error", {"message": str(e)})
        set_active_report_status(user_id, "failed")
        event_queue.put(("error", {"message": str(e)}))

@time_telemetry("report_streamer.stream_multi_pdf_report")
def stream_multi_pdf_report(filenames: List[str], query: str, report_title: str, user_id: int, tree_type: str = "tree", search_approach: str = "tree") -> Generator[str, None, None]:
    """
    SSE stream generator for Multi-PDF cross-document analysis reports.
    Protects local resources via LLMService's report semaphore lock.
    """
    llm_service = LLMService()
    
    # Try to acquire lock to prevent concurrency exhaustion
    locked = llm_service.acquire_report_lock(timeout=10.0)
    if not locked:
        yield format_sse("error", {"message": "LLM server is currently busy compiling another report. Please wait."})
        yield format_sse("DONE", None)
        return
        
    event_queue = queue.Queue()
    init_active_report(user_id, "multi", filenames=filenames, query=query)
    thread = threading.Thread(
        target=_run_multi_report_thread,
        args=(user_id, filenames, query, report_title, tree_type, search_approach, event_queue),
        daemon=True,
        name=f"multi-report-{user_id}"
    )
    thread.start()
    
    try:
        yield format_sse("start", {
            "filename": "multi",
            "message": f"Analyzing {len(filenames)} documents for: {query}",
            "doc_count": len(filenames),
            "filenames": filenames,
            "query": query,
        })
        
        done = False
        heartbeat_interval = 0
        
        while not done:
            try:
                event_type, payload = event_queue.get(timeout=15)
                
                if event_type == "final":
                    doc_results = payload.get("doc_results", [])
                    latex = payload["latex"]
                    
                    relevant = [r for r in doc_results if r.get("found_data")]
                    if not relevant:
                        yield format_sse("warning", {
                            "message": (
                                "None of the analysed documents contained data "
                                "relevant to the query. The generated report may "
                                "contain placeholder text only."
                            )
                        })
                        
                    # Save to Database
                    try:
                        from repositories.report_repository import ReportRepository
                        import json
                        ReportRepository.create_report(
                            user_id=user_id,
                            title=report_title,
                            query=query,
                            content=latex,
                            files=json.dumps(filenames)
                        )
                    except Exception as e:
                        logger.error(f"[REPORT-STREAMER] Failed to persist report to DB: {e}")
                        
                    yield format_sse("done", {
                        "latex": latex,
                        "char_count": len(latex),
                        "doc_results": [
                            {
                                "filename": r["filename"],
                                "found_data": r.get("found_data", False),
                                "findings_chars": r.get("findings_chars", 0),
                            }
                            for r in doc_results
                        ],
                        "doc_count": len(doc_results),
                    })
                    done = True
                    
                elif event_type == "error":
                    yield format_sse("error", {"message": payload.get("message", "Unknown error")})
                    done = True
                    
                else:
                    yield format_sse(event_type, payload)
                    
            except queue.Empty:
                heartbeat_interval += 1
                yield format_sse("heartbeat", {"tick": heartbeat_interval})
                if heartbeat_interval > 80: # 20 min hard cap
                    yield format_sse("error", {"message": "Multi-PDF generation timed out"})
                    done = True
                    
    except GeneratorExit:
        logger.warn("[REPORT-STREAMER] Client disconnected from multi report stream.")
        raise
    finally:
        llm_service.release_report_lock()
