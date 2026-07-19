"""
pageindex_search.py - PageIndex Vectorless Reasoning-based Tree Search
Navigates the PageIndex tree index hierarchically using local Ollama.
"""

import os
import re
import json
import time
import requests
from typing import List, Dict, Any, Tuple, Generator

from services.llm_service import LLMService

UPLOAD_DIR = "uploads"

# ── Token Budget Safety ──────────────────────────────────────────────
# Approximate: 1 token ≈ 4 characters for English text.
# For a 120k-token model, we reserve ~20k tokens for system prompt,
# reasoning (<think> block), and response generation.
# That leaves ~100k tokens ≈ 400k chars for context.
MAX_CONTEXT_CHARS = 400_000  # ~100k tokens

def _enforce_token_budget(context_parts: List[str], max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """
    Joins context_parts into a single string, truncating page-by-page
    from the end if the total exceeds max_chars. This ensures the LLM
    never receives a prompt that blows up the context window.
    """
    result = []
    total = 0
    for part in context_parts:
        if total + len(part) > max_chars:
            # Add as much of this part as we can fit
            remaining = max_chars - total
            if remaining > 200:  # Only add if we can fit something meaningful
                result.append(part[:remaining] + "\n\n[... page truncated to fit context window ...]")
            result.append(f"\n\n[Context truncated: {len(context_parts) - len(result)} more page(s) omitted to fit within model context window.]")
            break
        result.append(part)
        total += len(part) + 2  # +2 for the \n\n join separator
    return "\n\n".join(result)


# ── Intent Classification ────────────────────────────────────────────
STRUCTURAL_PATTERNS = re.compile(
    r'\b('
    r'list.*(chapter|section|topic|heading|part|content)'
    r'|table of contents|toc'
    r'|all chapters|every chapter'
    r'|overview|outline|structure'
    r'|what.*(chapters|sections|topics|parts).*(are|does|in|cover)'
    r'|how many.*(chapters|sections|parts)'
    r'|summarize.*(whole|entire|full|complete|all|each chapter|every)'
    r'|complete summary|full summary|book summary'
    r'|what is.*(this|the).*(book|document|pdf|handbook).*(about)'
    r')\b',
    re.IGNORECASE
)

def _is_structural_query(query: str) -> bool:
    """
    Detect if a query can be answered from the tree outline + summaries
    alone (without needing raw page text extraction).
    """
    return bool(STRUCTURAL_PATTERNS.search(query))


def _serialize_tree_with_summaries(nodes: List[Dict[str, Any]], depth: int = 0) -> str:
    """
    Serialize tree nodes into a compact text representation including
    full summaries. Used as LLM context for structural queries.
    This is ~2-5k tokens vs. ~300k+ tokens for raw page text.
    """
    if not nodes:
        return ""
    lines = []
    for node in nodes:
        indent = "  " * depth
        title = node.get("title", "Untitled")
        sp = node.get("start_page", "?")
        ep = node.get("end_page", "?")
        lines.append(f"{indent}## {title} (pp. {sp}–{ep})")
        
        summary = (node.get("summary") or "").strip()
        if summary:
            lines.append(f"{indent}   {summary}")
        
        children = node.get("nodes", [])
        if children:
            child_text = _serialize_tree_with_summaries(children, depth + 1)
            if child_text:
                lines.append(child_text)
    return "\n".join(lines)

def _load_tree(filename: str) -> Dict[str, Any]:
    from services.pageindex_builder import _resolve_pageindex_path
    index_path = _resolve_pageindex_path(filename, suffix="_tree")
    if not index_path or not os.path.exists(index_path):
        return {"nodes": []}
    
    with open(index_path, "r", encoding="utf-8") as f:
        return json.load(f)

def _load_chunks(filename: str) -> List[Dict[str, Any]]:
    chunks_path = os.path.join(UPLOAD_DIR, filename + ".chunks.json")
    if not os.path.exists(chunks_path):
        chunks_path = os.path.join("rag_docs", filename + ".chunks.json")
    with open(chunks_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("chunks", [])

def _query_llm_for_routing(query: str, node_type: str, nodes_list: List[Dict[str, Any]]) -> List[str]:
    """Uses Ollama to select which node IDs are relevant to the query (with batching)."""
    if not nodes_list:
        return []
        
    batch_size = 30
    all_selected_ids = []
    
    for i in range(0, len(nodes_list), batch_size):
        batch = nodes_list[i:i + batch_size]
        formatted_nodes = []
        for n in batch:
            formatted_nodes.append({
                "node_id": n["node_id"],
                "title": n["title"],
                "summary": n.get("summary", "")
            })

        prompt = (
            f"You are an Advanced Reasoning-Based Document Navigator.\n"
            f"Your task is to select the most relevant section/page range to answer the query by deeply analyzing the user's underlying intent.\n\n"
            f"Query: '{query}'\n"
            f"Available Document {node_type}s:\n"
            f"{json.dumps(formatted_nodes, indent=2)}\n\n"
            f"Rules:\n"
            f"- Step 1: Analyze the core technical topic and user intent behind the query.\n"
            f"- Step 2: Evaluate which section(s) contain the precise answers for that intent.\n"
            f"- Output ONLY a valid JSON object in the exact format: {{\"intent_analysis\": \"your analysis here\", \"selected_node_ids\": [\"0001\", \"0002\"]}}\n"
            f"- Select between 1 to 3 most relevant node_ids. If none are relevant, output an empty list for selected_node_ids.\n"
            f"- Do NOT output markdown fences (e.g. ```json), explanation, or other text outside the JSON object."
        )

        max_retries = 3
        batch_selected = []
        llm = LLMService()
        for attempt in range(max_retries):
            try:
                r = llm.generate({
                    "model": llm.default_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1}
                }, max_retries=1)
                
                if r and hasattr(r, "choices") and r.choices and hasattr(r.choices[0].message, "content"):
                    resp_text = (r.choices[0].message.content or "").strip()
                    # Strip <think>...</think> blocks from Qwen-style models
                    resp_text = re.sub(r"<think>.*?</think>", "", resp_text, flags=re.DOTALL).strip()
                    # Clean possible markdown fences
                    resp_text = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.MULTILINE)
                    resp_text = re.sub(r"\s*```$", "", resp_text, flags=re.MULTILINE)
                    try:
                        parsed_json = json.loads(resp_text.strip())
                        
                        # Support both the new dict format and fallback to old list format if the LLM hallucinated
                        if isinstance(parsed_json, dict) and "selected_node_ids" in parsed_json:
                            selected_ids = parsed_json["selected_node_ids"]
                        elif isinstance(parsed_json, list):
                            selected_ids = parsed_json
                        else:
                            selected_ids = []
                            
                        if isinstance(selected_ids, list):
                            valid_ids = {n["node_id"] for n in batch}
                            batch_selected = [str(nid) for nid in selected_ids if str(nid) in valid_ids]
                    except Exception:
                        pass
                    break  # Got a response but couldn't parse, don't retry
            except Exception:
                pass
                
        all_selected_ids.extend(batch_selected)
    
    # Fallback: if LLM fails across all batches, select the first node
    if not all_selected_ids and nodes_list:
        return [nodes_list[0]["node_id"]]
        
    return all_selected_ids

def execute_reasoning_tree_search(query: str, filename: str) -> Generator[str, None, None]:
    """
    Executes a vectorless reasoning-based tree search over a document
    and streams back routing logs and final RAG response tokens.
    Handles routing in a single efficient LLM call.
    """
    yield f"data: {json.dumps({'type': 'log', 'icon': '⬡', 'message': 'PageIndex Search initiated...'})}\n\n"
    
    try:
        tree = _load_tree(filename)
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to load document tree: {e}'})}\n\n"
        return

    yield f"data: {json.dumps({'type': 'log', 'icon': '🧠', 'message': 'Analyzing full document structure...'})}\n\n"

    from pageindex.client import PageIndexClient
    pi_client = PageIndexClient(model="dummy")
    
    llm = LLMService()
    
    def _invoke(prompt: str) -> str:
        r = llm.generate({
            "model": llm.default_model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 100000}
        })
        return r.choices[0].message.content.strip() if hasattr(r, "choices") else ""

    # ────────────────────────────────────────────────────────
    # STRUCTURAL QUERY SHORTCUT
    # For queries about chapters, outlines, overviews — answer
    # from the tree summaries alone (no page extraction needed).
    # ────────────────────────────────────────────────────────
    top_nodes = tree.get("nodes", [])
    if _is_structural_query(query) and top_nodes:
        yield f"data: {json.dumps({'type': 'log', 'icon': '🌲', 'message': 'Structural query detected — answering from document outline (no page extraction needed).'})}\n\n"
        
        context_text = _serialize_tree_with_summaries(top_nodes)
        yield f"data: {json.dumps({'type': 'context_compiled', 'pages': [], 'char_count': len(context_text)})}\n\n"
    else:
        # ────────────────────────────────────────────────────────
        # CONTENT QUERY: Route to specific pages via LLM
        # ────────────────────────────────────────────────────────
        pages = pi_client.route_query(query, tree, max_pages=15, llm_invoke=_invoke)

        if not pages:
            pages = [1]
            yield f"data: {json.dumps({'type': 'log', 'icon': '⚠', 'message': 'Fuzzy fallback applied (Page 1)'})}\n\n"
        else:
            pages_str = ", ".join(map(str, sorted(pages)))
            msg = f"Agent directly routed to precise pages: {pages_str}"
            payload = {'type': 'routing', 'level': 3, 'selected': [], 'titles': [f"Pages {pages_str}"], 'message': msg}
            yield f"data: {json.dumps(payload)}\n\n"

        # ────────────────────────────────────────────────────────
        # COMPILE CONTEXT
        # ────────────────────────────────────────────────────────
        yield f"data: {json.dumps({'type': 'log', 'icon': '⊟', 'message': 'Compiling text context from target pages...'})}\n\n"
        
        # Cap compiled pages to avoid context window explosion
        if len(pages) > 15:
            yield f"data: {json.dumps({'type': 'log', 'icon': '⚠', 'message': f'Capping target pages to first 15 (out of {len(pages)}) to optimize reasoning speed.'})}\n\n"
            pages = pages[:15]

        try:
            chunks = _load_chunks(filename)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to load document text chunks: {e}'})}\n\n"
            return

        context_parts = []
        for page in pages:
            page_chunks = [c for c in chunks if int(c.get("page") or 0) == page]
            page_text = "\n".join(c.get("text", "") for c in page_chunks)
            context_parts.append(f"--- [Page {page} of {filename}] ---\n{page_text}")
            
        context_text = _enforce_token_budget(context_parts)
        yield f"data: {json.dumps({'type': 'context_compiled', 'pages': pages, 'char_count': len(context_text)})}\n\n"

    # ────────────────────────────────────────────────────────
    # GENERATE FINAL RESPONSE
    # ────────────────────────────────────────────────────────
    yield f"data: {json.dumps({'type': 'log', 'icon': '✦', 'message': 'Generating reasoning-native response...'})}\n\n"
    
    payload = {
        "model": llm.default_model,
        "stream": True,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a highly precise document expert (like Claude Code).\n"
                    "Analyze the provided context and answer the user query clearly and accurately.\n"
                    "CRITICAL RULES:\n"
                    "1. You MUST ALWAYS write out your reasoning in a `<think>...</think>` block before answering.\n"
                    "2. Your final answer MUST be in clean Markdown (use bullet points and bold headers). NEVER output raw JSON.\n"
                    "3. Refer to the specific pages (e.g. 'p. 125') when detailing your answer."
                )
            },
            {
                "role": "user",
                "content": f"Context from target pages of '{filename}':\n\n{context_text}\n\nQuestion: {query}"
            }
        ],
        "options": {"temperature": 0.4}
    }

    # Small cooldown to let LLM release resources from routing calls
    time.sleep(1)

    resp = None
    for attempt in range(4):
        try:
            resp = llm.chat(payload, max_retries=1)
            break
        except Exception as e:
            if attempt == 3:
                yield f"data: {json.dumps({'token': 'Error: LLM server is overloaded. Please wait a moment and try again.'})}\n\n"
                yield "data: [DONE]\n\n"
                return
            wait = 3 * (attempt + 1)
            yield f"data: {json.dumps({'type': 'log', 'icon': '⏳', 'message': f'LLM busy, retrying in {wait}s (attempt {attempt+1}/4)...'})}\n\n"
            time.sleep(wait)
            continue
    else:
        yield f"data: {json.dumps({'token': 'Error: LLM server is busy after 4 retries. Please wait and try again.'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    try:
        in_think = False
        text_buf = ""
        for chunk in resp:
            token = chunk.choices[0].delta.content or ""
            if not token:
                continue
                
            text_buf += token
            
            # Simple buffering to strip <think> tokens cleanly
            if "<think>" in text_buf:
                in_think = True
                text_buf = text_buf.replace("<think>", "")
                
            if "</think>" in text_buf:
                in_think = False
                text_buf = text_buf.split("</think>")[-1]
                
            if in_think:
                continue
                
            if len(text_buf) > 3 or token.isspace():
                yield f"data: {json.dumps({'token': text_buf})}\n\n"
                text_buf = ""
                
        if text_buf and not in_think:
            yield f"data: {json.dumps({'token': text_buf})}\n\n"
            
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Stream interrupted: {e}'})}\n\n"
    
    yield "data: [DONE]\n\n"

def route_and_extract_pages(query: str, filename: str, tree_type: str, max_pages: int, llm_invoke) -> Generator[Tuple[str, List[Dict[str, Any]]], None, None]:
    """
    Unified generator to load a PageIndex tree, route a query using an LLM, 
    and extract the target pages directly via PyPDF2.
    Yields (log_msg, None) during routing, and finally (None, hits).
    """
    from services.pageindex_tree import load_tree
    from pageindex.client import PageIndexClient
    import PyPDF2
    
    hits = []
    
    yield f"Loading PageIndex workspaces and parsing `{tree_type}` trees...\n", None
        
    try:
        tree, tree_path = load_tree(filename)
    except Exception as e:
        print(f"[PAGEINDEX-RAG] Failed to build/load tree for {filename}: {e}")
        yield None, hits
        return
        
    if not tree or not tree.get("nodes"):
        print(f"[PAGEINDEX-RAG] Loaded tree is empty for {filename}")
        yield None, hits
        return

    # ── STRUCTURAL QUERY SHORTCUT ──
    if _is_structural_query(query):
        yield f"Structural query detected — returning outline structure and summaries for `{filename}` (no page extraction needed).\n", None
        
        outline_text = _serialize_tree_with_summaries(tree.get("nodes", []))
        total_pages = tree.get("total_pages") or 1
        
        hits.append({
            "text": f"=== Document Outline and Chapter Summaries ===\n\n{outline_text}",
            "page": 1,
            "score": 1.0,
            "type": "tree",
            "source": filename,
            "total_pages": total_pages
        })
        yield None, hits
        return
        
    yield f"Invoking PageIndex routing agent for `{filename}`...\n", None
        
    # Instantiate client opaquely without a workspace to prevent legacy logs
    pi_client = PageIndexClient(model="dummy")
    
    target_pages = pi_client.route_query(query, tree, max_pages=max_pages, llm_invoke=llm_invoke)
    
    if not target_pages:
        yield None, hits
        return
        
    yield f"Agent routed query to pages: {target_pages}\nExtracting full text content...\n", None
        
    pdf_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(pdf_path):
        pdf_path = os.path.join("rag_docs", filename)
        
    if os.path.exists(pdf_path):
        try:
            with open(pdf_path, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)
                total_pages = len(pdf_reader.pages)
                seen = set()
                for p in target_pages:
                    if 1 <= p <= total_pages:
                        text = pdf_reader.pages[p - 1].extract_text() or ""
                        if text.strip():
                            norm_text = " ".join(text.strip().split())
                            if norm_text not in seen:
                                seen.add(norm_text)
                                hits.append({
                                    "text": text.strip(),
                                    "page": p,
                                    "score": 1.0,
                                    "type": "tree",
                                    "source": filename,
                                    "total_pages": total_pages
                                })
        except Exception as e:
            print(f"[PAGEINDEX-RAG] Failed to extract pages from {filename}: {e}")
            
    yield None, hits
