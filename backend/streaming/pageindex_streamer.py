"""
pageindex_streamer.py — Server-Sent Events (SSE) reasoning-based tree search streamer.
"""

import os
import re
import json
import time
import requests
from typing import Generator, Dict, Any, List, Optional

from services.llm_service import LLMService
from services.pageindex_cache import PageIndexCache
from utils.sse import format_sse
from utils.telemetry import logger, time_telemetry

UPLOAD_DIR = "uploads"

def _load_tree_memoized(filename: str, cache: PageIndexCache, tree_type: str = "tree") -> Dict[str, Any]:
    cache_key = f"{filename}_{tree_type}"
    # Try cache
    tree = cache.get_tree(cache_key)
    
    from services.pageindex_builder import _resolve_pageindex_path
    
    # Premium tree path resolution
    index_path = _resolve_pageindex_path(filename, suffix="_tree")
    
    # If cached tree exists, let's see if we should invalidate it because a premium disk file has since been created
    if tree:
        if tree_type == "tree":
            is_heuristic_cache = "Hierarchical Tree structure" in tree.get("description", "")
            if is_heuristic_cache and index_path and os.path.exists(index_path):
                logger.info(f"[PAGEINDEX-STREAMER] Invaliding cached heuristic tree to load fresh premium tree from disk for: {filename}")
                tree = None
            else:
                return tree
        else:
            return tree
            
    # If premium is requested and premium file exists on disk
    if index_path and os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                tree = json.load(f)
            cache.set_tree(cache_key, tree)
            return tree
        except Exception as e:
            logger.error(f"[PAGEINDEX-STREAMER] Failed to read premium tree disk JSON: {e}")

    logger.info(f"[PAGEINDEX-STREAMER] Premium tree not found for {filename}")
    return {"description": "Empty Document structure fallback", "nodes": []}

def _load_chunks_memoized(filename: str, cache: PageIndexCache) -> List[Dict[str, Any]]:
    # Try cache
    chunks = cache.get_chunks(filename)
    if chunks:
        return chunks
        
    chunks_path = os.path.join(UPLOAD_DIR, filename + ".chunks.json")
    if not os.path.exists(chunks_path):
        chunks_path = os.path.join("rag_docs", filename + ".chunks.json")
        
    with open(chunks_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    chunks_list = data.get("chunks", [])
    cache.set_chunks(filename, chunks_list)
    return chunks_list

def _query_llm_for_routing(query: str, node_type: str, nodes_list: List[Dict[str, Any]], cache: PageIndexCache, llm_service: LLMService) -> List[str]:
    """Uses Ollama to select which node IDs are relevant, with in-memory memoized caching."""
    # Check cache
    cached_ids = cache.get_routing(query, node_type, nodes_list)
    if cached_ids is not None:
        return cached_ids

    formatted_nodes = []
    for n in nodes_list:
        formatted_nodes.append({
            "node_id": n["node_id"],
            "title": n["title"],
            "summary": n.get("summary", "")
        })

    prompt = (
        f"You are an Advanced Reasoning-Based Document Navigator.\n"
        f"Your task is to select the most relevant section/page range to answer the query.\n\n"
        f"Query: '{query}'\n"
        f"Available Document {node_type}s:\n"
        f"{json.dumps(formatted_nodes, indent=2)}\n\n"
        f"Rules:\n"
        f"- Analyze which section(s) contain the precise answers for the query.\n"
        f"- Output ONLY a valid JSON list of selected 'node_id' strings, like: [\"0001\", \"0002\"].\n"
        f"- Select between 1 to 3 most relevant node_ids. If none are relevant, output [].\n"
        f"- Do NOT output markdown fences (e.g. ```json), explanation, or other text."
    )

    payload = {
        "model": llm_service.default_model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1}
    }

    try:
        r = llm_service.generate(payload, max_retries=3)
        resp_text = r.choices[0].message.content.strip() if hasattr(r, "choices") else ""
        
        # Clean think tags and fences
        resp_text = re.sub(r"<think>.*?</think>", "", resp_text, flags=re.DOTALL).strip()
        resp_text = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.MULTILINE)
        resp_text = re.sub(r"\s*```$", "", resp_text, flags=re.MULTILINE)
        
        selected_ids = json.loads(resp_text)
        if isinstance(selected_ids, list):
            valid_ids = {n["node_id"] for n in nodes_list}
            result_ids = [str(nid) for nid in selected_ids if str(nid) in valid_ids]
            
            # Cache it
            cache.set_routing(query, node_type, nodes_list, result_ids)
            return result_ids
    except Exception as e:
        logger.warn(f"[PAGEINDEX-STREAMER] Routing LLM parsing failed: {e}")
        
    # Fallback to the first node
    fallback = [nodes_list[0]["node_id"]] if nodes_list else []
    if nodes_list:
        cache.set_routing(query, node_type, nodes_list, fallback)
    return fallback

def _query_llm_for_document_routing(query: str, documents: List[Dict[str, Any]], cache: PageIndexCache, llm_service: LLMService) -> List[str]:
    """Uses Ollama to select which files are relevant to the query from the checked handbooks."""
    formatted_docs = []
    for doc in documents:
        formatted_docs.append({
            "filename": doc["filename"],
            "description": doc.get("description", "")
        })

    prompt = (
        f"You are an Advanced Reasoning Document Selector.\n"
        f"Your task is to select the most relevant document(s) from the available files to answer the user query.\n\n"
        f"Query: '{query}'\n"
        f"Available Documents:\n"
        f"{json.dumps(formatted_docs, indent=2)}\n\n"
        f"Rules:\n"
        f"- Analyze which document(s) are relevant and necessary to compose a complete answer for the query.\n"
        f"- Output ONLY a valid JSON list of selected 'filename' strings, like: [\"12 - Fractography.pdf\"].\n"
        f"- Select between 1 to 3 most relevant filenames. If none are relevant, output [].\n"
        f"- Do NOT output markdown fences (e.g. ```json), explanations, or extra text."
    )

    payload = {
        "model": llm_service.default_model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1}
    }

    try:
        r = llm_service.generate(payload, max_retries=3)
        resp_text = r.choices[0].message.content.strip() if hasattr(r, "choices") else ""
        resp_text = re.sub(r"<think>.*?</think>", "", resp_text, flags=re.DOTALL).strip()
        resp_text = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.MULTILINE)
        resp_text = re.sub(r"\s*```$", "", resp_text, flags=re.MULTILINE)
        
        selected_files = json.loads(resp_text)
        if isinstance(selected_files, list):
            valid_names = {d["filename"] for d in documents}
            return [str(fn) for fn in selected_files if str(fn) in valid_names]
    except Exception as e:
        logger.warn(f"[PAGEINDEX-STREAMER] Document routing LLM parsing failed: {e}")
        
    return [documents[0]["filename"]]  # Fallback to first

def _serialize_tree_for_llm(nodes: List[Dict[str, Any]], depth: int = 0) -> str:
    from services.pageindex_tree import serialize_tree_for_llm
    return serialize_tree_for_llm(nodes, depth=depth, include_summary=True)


def _analyze_tree_structure_for_pages(query: str, tree: Dict[str, Any], llm_service: LLMService) -> List[int]:
    from services.pageindex_tree import analyze_tree_for_pages

    def llm_invoke(prompt: str) -> str:
        r = llm_service.generate(
            {
                "model": llm_service.default_model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1},
            },
            max_retries=3,
        )
        return r.choices[0].message.content.strip() if hasattr(r, "choices") else ""

    return analyze_tree_for_pages(query, tree, llm_invoke, max_pages=10, expand_ranges=True)

@time_telemetry("pageindex_streamer.execute_reasoning_tree_search")
def execute_reasoning_tree_search(query: str, filenames: Any, tree_type: str = "tree") -> Generator[str, None, None]:
    """
    PageIndex Vectorless Reasoning RAG SSE streamer.
    Delegates to the new PageIndexAgent for a clean, modular agentic workflow.
    """
    from pageindex.agent import PageIndexAgent
    agent = PageIndexAgent(query, filenames, tree_type=tree_type)
    for event in agent.run():
        yield event
