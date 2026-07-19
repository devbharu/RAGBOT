"""
pageindex_tree.py — Shared PageIndex tree utilities for reports and search.

Centralizes tree load/build, LLM serialization, agentic page routing (L1→L2→L3),
section→page mapping, and chunk collection so metall + multi-PDF reports stay consistent.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
REPORT_MAX_PAGES = int(os.getenv("PAGEINDEX_REPORT_MAX_PAGES", "30"))
ROUTING_MAX_NODES = int(os.getenv("PAGEINDEX_ROUTING_MAX_NODES", "3"))


# ── JSON / LLM response helpers ───────────────────────────────────────────────

def clean_llm_json_text(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    return text.strip()


def parse_llm_json(text: str) -> Any:
    cleaned = clean_llm_json_text(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                pass
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


# ── Tree serialization (agent-compatible) ─────────────────────────────────────

def serialize_tree_for_llm(
    nodes: List[Dict[str, Any]],
    depth: int = 0,
    include_summary: bool = False,
    max_depth: int = -1,
) -> str:
    if not nodes:
        return ""
    if max_depth != -1 and depth > max_depth:
        return ""
        
    lines: List[str] = []
    for node in nodes:
        indent = "  " * depth
        sp = int(node.get("start_page") or node.get("start_index") or 1)
        ep = int(node.get("end_page") or node.get("end_index") or sp)
        lines.append(
            f"{indent}- [{node.get('node_id', '')}] {node.get('title', '')} (pp. {sp}-{ep})"
        )
        if include_summary:
            summary = (node.get("summary") or "").strip()
            if summary:
                lines.append(f"{indent}  ↳ {summary[:160]}")
            tables = node.get("tables", [])
            if tables:
                lines.append(f"{indent}  ↳ Tables: {', '.join(tables)}")
            figures = node.get("figures", [])
            if figures:
                lines.append(f"{indent}  ↳ Figures: {', '.join(figures)}")
        child_lines = serialize_tree_for_llm(
            node.get("nodes") or [], depth + 1, include_summary=include_summary, max_depth=max_depth
        )
        if child_lines:
            lines.append(child_lines)
    return "\n".join(lines)


def iter_tree_nodes(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for node in nodes:
        out.append(node)
        out.extend(iter_tree_nodes(node.get("nodes") or []))
    return out


def expand_pages_in_range(start_page: int, end_page: int, cap: int = REPORT_MAX_PAGES) -> List[int]:
    sp, ep = int(start_page), int(end_page)
    if sp > ep:
        sp, ep = ep, sp
    pages = list(range(sp, ep + 1))
    return pages[:cap] if len(pages) > cap else pages


def pages_from_node(node: Dict[str, Any], cap: int = REPORT_MAX_PAGES) -> List[int]:
    sp = int(node.get("start_page") or node.get("start_index") or 1)
    ep = int(node.get("end_page") or node.get("end_index") or sp)
    return expand_pages_in_range(sp, ep, cap=cap)


def expand_seed_pages_to_node_ranges(
    tree: Dict[str, Any],
    seed_pages: List[int],
    cap: int = REPORT_MAX_PAGES,
) -> List[int]:
    """Expand isolated page picks to full section ranges (reduces retrieval gaps)."""
    if not seed_pages:
        return []
    seed_set = {int(p) for p in seed_pages}
    expanded: Set[int] = set()

    for node in iter_tree_nodes(tree.get("nodes") or []):
        sp = int(node.get("start_page") or node.get("start_index") or 0)
        ep = int(node.get("end_page") or node.get("end_index") or 0)
        node_pages = set(range(sp, ep + 1)) if sp and ep else set()
        if node_pages & seed_set:
            expanded.update(expand_pages_in_range(sp, ep, cap=cap))

    if not expanded:
        expanded = seed_set
    result = sorted(expanded)
    return result[:cap] if len(result) > cap else result


# ── Load / ensure tree on disk ────────────────────────────────────────────────

def load_tree(
    filename: str,
) -> Tuple[Dict[str, Any], str]:
    """
    Load premium tree. 
    Returns (tree_dict, resolved_path).
    """
    from services.pageindex_builder import _resolve_pageindex_path

    path = _resolve_pageindex_path(filename, suffix="_tree")

    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), path

    return {"document_name": filename, "total_pages": 0, "nodes": []}, ""


def resolve_chunks_path(filename: str) -> str:
    import glob

    for base in (UPLOAD_DIR, "rag_docs"):
        for name in (filename + ".chunks.json", filename + ".pdf.chunks.json"):
            path = os.path.join(base, name)
            if os.path.exists(path):
                return path

    def _norm(s: str) -> str:
        n = re.sub(r"[^a-z0-9]", "", s.lower())
        return re.sub(r"(pdf|txt|chunks|json)$", "", n)

    candidates = glob.glob(os.path.join(UPLOAD_DIR, "*.chunks.json")) + glob.glob(
        os.path.join("rag_docs", "*.chunks.json")
    )
    norm_target = _norm(filename)
    for cand in candidates:
        stem = os.path.basename(cand).replace(".chunks.json", "")
        if _norm(stem) == norm_target:
            return cand
    for cand in candidates:
        stem = os.path.basename(cand).replace(".chunks.json", "")
        nc = _norm(stem)
        if norm_target and nc and (norm_target in nc or nc in norm_target):
            return cand
    return ""


def load_chunks(filename: str) -> List[Dict[str, Any]]:
    path = resolve_chunks_path(filename)
    if not path:
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("chunks", [])


def chunk_identity(chunk: Dict[str, Any]) -> str:
    page = int(chunk.get("page") or 0)
    idx = int(chunk.get("chunk_index") or 0)
    return f"{page}:{idx}"


def collect_chunks_for_pages(
    chunks: List[Dict[str, Any]],
    pages: List[int],
    *,
    expand_ranges: bool = True,
    tree: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    if expand_ranges and tree:
        pages = expand_seed_pages_to_node_ranges(tree, pages)

    page_set = {int(p) for p in pages}
    seen: Set[str] = set()
    result: List[Dict[str, Any]] = []
    for chunk in chunks:
        p = int(chunk.get("page") or 0)
        if p not in page_set:
            continue
        cid = chunk_identity(chunk)
        if cid in seen:
            continue
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        seen.add(cid)
        result.append(chunk)
    result.sort(key=lambda c: (int(c.get("page") or 0), int(c.get("chunk_index") or 0)))
    return result


# ── Agentic routing prompts (aligned with pageindex/agent.py) ─────────────────

OUTLINE_PAGE_ROUTING_RULES = """
Rules for page routing (CRITICAL):
1. **THINK LIKE A METALLURGIST**: You are extracting data for a formal Material Specification. You MUST ignore sections that are not relevant to the user query (e.g., ignore "Welding" if the query is about "Chemical Composition").
2. **Explicit Page Requests**: If the query asks for specific page numbers or ranges, select those exact physical pages.
3. **Semantic/Keyword Requests**: Pick sections whose titles/summaries match the query. ONLY include pages from sections that likely hold material data tables, footnotes, or limits.
4. **Constraints**: Output integers only. DO NOT return more than the requested max pages. Quality over quantity.
"""


def analyze_tree_for_pages(
    query: str,
    tree: Dict[str, Any],
    llm_invoke: Callable[[str], str],
    *,
    max_pages: int = REPORT_MAX_PAGES,
    expand_ranges: bool = True,
) -> List[int]:
    # Use max_depth=1 to avoid dumping thousands of L3 leaf nodes into the LLM context.
    # The LLM will see L1 (Chapters) and L2 (Sections), which is perfect for semantic routing.
    serialized = serialize_tree_for_llm(tree.get("nodes", []), include_summary=True, max_depth=1)
    if not serialized:
        return []

    prompt = (
        "You are an Expert Document Outline Analyzer.\n"
        f"User Query: '{query}'\n\n"
        f"Document Outline Tree:\n{serialized}\n\n"
        "Task:\n"
        "Identify the exact physical page numbers that contain information needed to answer the query.\n"
        "Output ONLY a valid JSON object:\n"
        '{\n  "reasoning": "brief explanation",\n  "pages": [5, 6, 7]\n}\n'
        f"{OUTLINE_PAGE_ROUTING_RULES}\n"
        f"- Select between 1 and {max_pages} page numbers.\n"
        "- Do NOT output markdown fences or thinking blocks."
    )

    try:
        raw = llm_invoke(prompt)
        data = parse_llm_json(raw)
        pages: List[int] = []
        if isinstance(data, dict):
            pages = data.get("pages") or []
        elif isinstance(data, list):
            pages = data
        pages = sorted({int(p) for p in pages if isinstance(p, (int, float))})
        if expand_ranges:
            pages = expand_seed_pages_to_node_ranges(tree, pages, cap=max_pages)
        return pages[:max_pages]
    except Exception as e:
        print(f"[PAGEINDEX-TREE] analyze_tree_for_pages failed: {e}")
        return []


def _routing_prompt(query: str, node_type: str, nodes_list: List[Dict[str, Any]]) -> str:
    formatted = [
        {"node_id": n["node_id"], "title": n["title"], "summary": (n.get("summary") or "")[:200]}
        for n in nodes_list
    ]
    return (
        "You are an Advanced Reasoning-Based Document Navigator.\n"
        f"Query: '{query}'\n"
        f"Available Document {node_type}s:\n{json.dumps(formatted, indent=2)}\n\n"
        f"{OUTLINE_PAGE_ROUTING_RULES}\n"
        "- Select section(s) that contain precise answers for the query.\n"
        "- Output ONLY a JSON list of node_id strings, e.g. [\"0001\", \"0002\"].\n"
        f"- Select 1 to {ROUTING_MAX_NODES} node_ids. If none match, output [].\n"
        "- No markdown fences or explanations."
    )


def _parse_node_id_list(raw: str, valid_ids: Set[str]) -> List[str]:
    data = parse_llm_json(raw)
    if isinstance(data, list):
        return [str(nid) for nid in data if str(nid) in valid_ids]
    return []


def route_pages_hierarchical(
    query: str,
    tree: Dict[str, Any],
    llm_invoke: Callable[[str], str],
    *,
    max_pages: int = REPORT_MAX_PAGES,
) -> List[int]:
    """
    L1 → L2 → L3 agentic navigation (same strategy as pageindex_search / agent).
  Falls back to chapter/section page ranges when tree is shallow.
    """
    l1_nodes = tree.get("nodes") or []
    if not l1_nodes:
        return []

    def route_level(node_type: str, nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not nodes:
            return []
            
        batch_size = 30
        all_selected: List[Dict[str, Any]] = []
        
        # Batch nodes to avoid exceeding LLM context limits on massive trees
        for i in range(0, len(nodes), batch_size):
            batch = nodes[i:i + batch_size]
            valid = {n["node_id"] for n in batch}
            raw = llm_invoke(_routing_prompt(query, node_type, batch))
            ids = _parse_node_id_list(raw, valid)
            all_selected.extend([n for n in batch if n["node_id"] in ids])
            
        return all_selected or [nodes[0]]

    pages: List[int] = []

    selected_l1 = route_level("Chapter", l1_nodes)
    l2_pool: List[Dict[str, Any]] = []
    for n in selected_l1:
        l2_pool.extend(n.get("nodes") or [])

    if not l2_pool:
        for n in selected_l1:
            pages.extend(pages_from_node(n, cap=max_pages))
    else:
        selected_l2 = route_level("Section", l2_pool)
        l3_pool: List[Dict[str, Any]] = []
        for n in selected_l2:
            l3_pool.extend(n.get("nodes") or [])

        if not l3_pool:
            for n in selected_l2:
                pages.extend(pages_from_node(n, cap=max_pages))
        else:
            selected_l3 = route_level("Page", l3_pool)
            for n in selected_l3:
                pages.append(int(n.get("start_page") or 1))

    pages = sorted(set(pages))
    if len(pages) > max_pages:
        pages = pages[:max_pages]
    return pages


def map_sections_to_pages(
    tree: Dict[str, Any],
    section_catalog: str,
    llm_invoke: Callable[[str], str],
    *,
    max_pages_per_section: int = 15,
) -> Dict[str, List[int]]:
    """
    Map fixed report section keys to page lists using the document outline.
    Used by metall single-PDF report structure discovery.
    """
    serialized = serialize_tree_for_llm(tree.get("nodes", []), include_summary=True)
    if not serialized:
        return {}

    prompt = (
        "You are a Senior Metallurgical Document Analyst.\n"
        "Given the document structure tree (ToC), map each report section key to physical page numbers "
        "that contain relevant tables, limits, test results, or narrative for that section.\n\n"
        f"Sections to Map:\n{section_catalog}\n\n"
        f"Document Structure Tree:\n{serialized}\n\n"
        "Output ONLY a valid JSON object mapping section keys to page number lists:\n"
        '{\n  "chemical_composition": [5, 6],\n  "mechanical_properties": [7, 8, 9]\n}\n'
        "Rules:\n"
        "- Include ALL pages in a section range when tables may span multiple pages.\n"
        "- Map only keys clearly present; omit keys with no evidence.\n"
        f"- Max {max_pages_per_section} pages per section key.\n"
        "- Integers only. No markdown fences or thinking blocks."
    )

    try:
        raw = llm_invoke(prompt)
        data = parse_llm_json(raw)
        if not isinstance(data, dict):
            return {}
        out: Dict[str, List[int]] = {}
        for key, pages in data.items():
            if not isinstance(pages, list):
                continue
            expanded = expand_seed_pages_to_node_ranges(
                tree, [int(p) for p in pages if isinstance(p, (int, float))],
                cap=max_pages_per_section,
            )
            if expanded:
                out[str(key)] = expanded
        return out
    except Exception as e:
        print(f"[PAGEINDEX-TREE] map_sections_to_pages failed: {e}")
        return {}


def merge_section_chunks(
    section_map: Dict[str, List[Dict[str, Any]]],
    section_key: str,
    new_chunks: List[Dict[str, Any]],
) -> None:
    """Union chunks into a section without dropping duplicates by text alone."""
    if section_key not in section_map:
        section_map[section_key] = []
    existing_ids = {chunk_identity(c) for c in section_map[section_key]}
    for chunk in new_chunks:
        cid = chunk_identity(chunk)
        if cid not in existing_ids:
            section_map[section_key].append(chunk)
            existing_ids.add(cid)


def assign_orphan_chunks(
    section_map: Dict[str, List[Dict[str, Any]]],
    all_chunks: List[Dict[str, Any]],
    default_key: str = "scope_specification",
) -> int:
    """Ensure every chunk appears in at least one section (no silent data loss)."""
    assigned: Set[str] = set()
    for chunks in section_map.values():
        for c in chunks:
            assigned.add(chunk_identity(c))

    orphans = [c for c in all_chunks if chunk_identity(c) not in assigned]
    for c in orphans:
        merge_section_chunks(section_map, default_key, [c])
    return len(orphans)
