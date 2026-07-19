"""
pageindex_builder.py  –  PageIndex Tree Builder (chunk-driven)
==============================================================
Builds a hierarchical semantic index using the full page_index pipeline
but sourcing page text from pre-extracted chunks.json instead of the raw PDF.

chunks_path is passed directly into page_index() → page_index_main() →
get_page_tokens(), which skips PDF parsing and builds page_list from chunks.
Everything else in the pipeline runs unchanged.
"""

from __future__ import annotations

import glob
import json
import os
import re
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


UPLOAD_DIR = "uploads"


# ─────────────────────────────────────────────────────────────────────────────
# Build status
# ─────────────────────────────────────────────────────────────────────────────

class BuildPhase:
    NOT_STARTED = "not_started"
    BUILDING    = "building"
    OPTIMIZING  = "optimizing"
    READY       = "ready"
    ERROR       = "error"


@dataclass(frozen=True)
class BuildStatus:
    status:   str   = BuildPhase.NOT_STARTED
    progress: float = 0.0
    error:    str   = ""


class BuildStatusRegistry:
    """Thread-safe singleton — tracks build phase + progress per document."""

    _instance: Optional["BuildStatusRegistry"] = None
    _class_lock = threading.Lock()

    def __new__(cls) -> "BuildStatusRegistry":
        with cls._class_lock:
            if cls._instance is None:
                obj = super().__new__(cls)
                obj._store: Dict[str, BuildStatus] = {}
                obj._lock  = threading.Lock()
                cls._instance = obj
        return cls._instance

    def set(self, filename: str, status: str, progress: float = 0.0, error: str = "") -> None:
        with self._lock:
            self._store[filename] = BuildStatus(status=status, progress=progress, error=error)

    def get(self, filename: str) -> BuildStatus:
        with self._lock:
            if filename in self._store:
                return self._store[filename]
        if os.path.exists(PathResolver.output_tree_path(filename)):
            return BuildStatus(status=BuildPhase.READY, progress=1.0)
        return BuildStatus(status=BuildPhase.NOT_STARTED, progress=0.0)

    def is_running(self, filename: str) -> bool:
        return self.get(filename).status in (BuildPhase.BUILDING, BuildPhase.OPTIMIZING)


# ─────────────────────────────────────────────────────────────────────────────
# Path utilities
# ─────────────────────────────────────────────────────────────────────────────

class PathResolver:

    @staticmethod
    def _norm(s: str) -> str:
        n = re.sub(r"[^a-z0-9]", "", s.lower())
        return re.sub(r"(pdf|json|pageindex|tree|heuristic)$", "", n)

    @staticmethod
    def resolve_pageindex_path(filename: str, suffix: str = "_tree") -> str:
        for stem in (filename, filename.replace(".pdf", "")):
            p = os.path.join(UPLOAD_DIR, f"{stem}{suffix}.pageindex.json")
            if os.path.exists(p):
                return p

        candidates = glob.glob(os.path.join(UPLOAD_DIR, f"*{suffix}.pageindex.json"))
        norm_target = PathResolver._norm(filename)
        if not norm_target:
            return ""

        for cand in candidates:
            stem = os.path.basename(cand).replace(f"{suffix}.pageindex.json", "")
            if PathResolver._norm(stem) == norm_target:
                return cand
        for cand in candidates:
            stem = os.path.basename(cand).replace(f"{suffix}.pageindex.json", "")
            nc = PathResolver._norm(stem)
            if norm_target in nc or nc in norm_target:
                return cand
        return ""

    @staticmethod
    def output_tree_path(filename: str) -> str:
        return os.path.join(UPLOAD_DIR, f"{filename}_tree.pageindex.json")

    @staticmethod
    def resolve_chunks_path(filename: str) -> str:
        try:
            from services.pageindex_tree import resolve_chunks_path
            p = resolve_chunks_path(filename)
            if p:
                return p
        except ImportError:
            pass
        for p in (
            os.path.join(UPLOAD_DIR, f"{filename}.chunks.json"),
            os.path.join(UPLOAD_DIR, f"{filename}_chunks.json"),
        ):
            if os.path.exists(p):
                return p
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# PageIndexTreeBuilder
# ─────────────────────────────────────────────────────────────────────────────

class PageIndexTreeBuilder:
    """
    Runs the full page_index pipeline using chunks as the page source.
    chunks_path is passed directly to page_index() so get_page_tokens()
    skips PDF parsing and builds page_list from chunks.json instead.
    """

    def __init__(self, filename: str, model_name: Optional[str] = None) -> None:
        self._filename   = filename
        self._model_name = model_name or self._resolve_model()
        self._registry   = BuildStatusRegistry()

    @staticmethod
    def _resolve_model() -> str:
        try:
            from services.llm_service import LLMService
            return LLMService().default_model
        except Exception:
            return "gpt-4.1"

    def _phase(self, phase: str, progress: float, error: str = "") -> None:
        self._registry.set(self._filename, phase, progress, error)

    def build(self) -> None:
        filename = self._filename
        try:
            # ── 1. resolve chunks path ────────────────────────────────────
            self._phase(BuildPhase.BUILDING, 0.05)
            chunks_path = PathResolver.resolve_chunks_path(filename)
            if not chunks_path:
                raise FileNotFoundError(
                    f"Chunks file not found for '{filename}'. Ingest the document first."
                )
            print(f"[PAGEINDEX] Using chunks file: {chunks_path}")

            # ── 2. call page_index with chunks_path ───────────────────────
            self._phase(BuildPhase.BUILDING, 0.30)
            from pageindex.page_index import page_index
            result = page_index(
                doc                    = filename,
                model                  = self._model_name,
                if_add_node_id         = "yes",
                if_add_node_summary    = "yes",
                if_add_doc_description = "yes",
                if_add_node_text       = "yes",
                chunks_path            = chunks_path,
            )

            # ── 3. persist ────────────────────────────────────────────────
            self._phase(BuildPhase.OPTIMIZING, 0.92)
            self._persist(result, chunks_path)

            self._phase(BuildPhase.READY, 1.0)
            print(f"[PAGEINDEX] ✓ Completed tree for '{filename}'")

        except Exception as exc:
            import traceback
            traceback.print_exc()
            print(f"[PAGEINDEX] ✗ Error building tree for '{filename}': {exc}")
            self._phase(BuildPhase.ERROR, 0.0, str(exc))

    def _normalise_nodes(self, nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for node in nodes:
            n: Dict[str, Any] = {
                "node_id":    node.get("node_id"),
                "title":      node.get("title"),
                "start_page": node.get("start_index", node.get("start_page", 1)),
                "end_page":   node.get("end_index",   node.get("end_page",   1)),
                "summary":    node.get("summary", ""),
                "nodes":      self._normalise_nodes(node.get("nodes", [])),
            }
            if "text" in node:
                n["text"] = node["text"]
            out.append(n)
        return out

    def _persist(self, result: Dict[str, Any], chunks_path: str) -> None:
        with open(chunks_path, "r", encoding="utf-8") as fh:
            chunks_data = json.load(fh)
        chunks      = chunks_data.get("chunks", [])
        total_pages = max(
            (int(c.get("total_pages") or 1) for c in chunks),
            default=1,
        )

        raw_nodes    = result.get("structure", [])
        mapped_nodes = self._normalise_nodes(raw_nodes)

        tree = {
            "document_name": self._filename,
            "total_pages":   total_pages,
            "description":   result.get("doc_description") or f"PageIndex Tree for {self._filename}",
            "nodes":         mapped_nodes,
        }

        out_path = PathResolver.output_tree_path(self._filename)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(tree, fh, indent=2, ensure_ascii=False)

        print(f"[PAGEINDEX] Tree written → {out_path} ({len(mapped_nodes)} root nodes)")


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def run_background_index_builder(filename: str, model_name: Optional[str] = None) -> None:
    PageIndexTreeBuilder(filename, model_name).build()


def start_pageindex_build(filename: str, model_name: Optional[str] = None) -> bool:
    registry = BuildStatusRegistry()
    if registry.is_running(filename):
        print(f"[PAGEINDEX] Build already running for '{filename}'")
        return True

    threading.Thread(
        target = run_background_index_builder,
        args   = (filename, model_name),
        daemon = True,
        name   = f"pageindex-builder-{filename}",
    ).start()
    return True


def get_build_status(filename: str) -> Dict[str, Any]:
    s = BuildStatusRegistry().get(filename)
    return {"status": s.status, "progress": s.progress, "error": s.error}


# ── backward-compat shims ────────────────────────────────────────────────────

def set_build_status(filename: str, status: str, progress: float = 0.0, error: str = "") -> None:
    BuildStatusRegistry().set(filename, status, progress, error)

def _resolve_pageindex_path(filename: str, suffix: str = "_tree") -> str:
    return PathResolver.resolve_pageindex_path(filename, suffix)