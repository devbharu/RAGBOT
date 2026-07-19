import os
import json
import re
from typing import List, Dict, Any, Generator

from services.llm_service import LLMService
from services.pageindex_cache import PageIndexCache
from utils.sse import format_sse
from utils.telemetry import logger
from pageindex.retrieve import get_document, get_document_structure, get_page_content

UPLOAD_DIR = "uploads"

class PageIndexAgent:
    def __init__(self, query: str, filenames: List[str], tree_type: str = "tree"):
        self.query = query
        self.filenames = [filenames] if isinstance(filenames, str) else filenames
        self.llm = LLMService()
        self.cache = PageIndexCache()
        self.documents = {}
        self.tree_type = tree_type

    def _resolve_chunks_path(self, filename: str) -> str:
        """
        Fuzzy resolver for chunks JSON file.
        Matches sanitized filenames back to their actual on-disk .chunks.json file.
        """
        import glob
        
        # 1. Exact match
        path = os.path.join(UPLOAD_DIR, filename + ".chunks.json")
        if os.path.exists(path):
            return path
        path = os.path.join(UPLOAD_DIR, filename + ".pdf.chunks.json")
        if os.path.exists(path):
            return path
        path = os.path.join("rag_docs", filename + ".chunks.json")
        if os.path.exists(path):
            return path

        def _norm(s: str) -> str:
            n = re.sub(r'[^a-z0-9]', '', s.lower())
            n = re.sub(r'(pdf|txt|chunks|json)$', '', n)
            return n

        # Scan
        candidates = glob.glob(os.path.join(UPLOAD_DIR, '*.chunks.json')) + glob.glob(os.path.join("rag_docs", '*.chunks.json'))
        norm_target = _norm(filename)
        if not norm_target:
            return ''
            
        for cand in candidates:
            stem = os.path.basename(cand).replace(".chunks.json", "")
            if _norm(stem) == norm_target:
                return cand
                
        for cand in candidates:
            stem = os.path.basename(cand).replace(".chunks.json", "")
            norm_cand = _norm(stem)
            if norm_target and norm_cand and (norm_target in norm_cand or norm_cand in norm_target):
                return cand
                
        return ''

    def _prepare_documents(self):
        """Prepare the document context mapping for retrieve.py tools."""
        for fn in self.filenames:
            try:
                # 1. Load outline tree
                from streaming.pageindex_streamer import _load_tree_memoized
                tree = _load_tree_memoized(fn, self.cache, tree_type=self.tree_type)
            except Exception as e:
                logger.error(f"[AGENT] Failed to load tree for {fn}: {e}")
                continue
                
            # 2. Load text chunks and group by physical page
            try:
                chunks_path = self._resolve_chunks_path(fn)
                if chunks_path and os.path.exists(chunks_path):
                    with open(chunks_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    chunks = data.get("chunks", [])
                else:
                    chunks = []
                    
                page_map = {}
                for c in chunks:
                    p = int(c.get("page") or 0)
                    if p > 0:
                        page_map[p] = page_map.get(p, "") + "\n" + c.get("text", "")
                pages_list = [{"page": p, "content": text.strip()} for p, text in page_map.items()]
            except Exception as e:
                logger.error(f"[AGENT] Failed to load chunks for {fn}: {e}")
                pages_list = []
                
            # 3. Fuzzy resolve the physical file path for the retrieve fallback
            from routes.file import _resolve_physical_file_path
            resolved_path = _resolve_physical_file_path(fn)

            self.documents[fn] = {
                'doc_name': fn,
                'doc_description': tree.get("description", "Handbook PDF document"),
                'path': resolved_path or os.path.join(UPLOAD_DIR, fn),
                'type': 'pdf',
                'structure': tree.get("nodes", []),
                'pages': pages_list,
                'total_pages': tree.get("total_pages") or 1
            }

    def run(self) -> Generator[str, None, None]:
        yield format_sse("log", {"icon": "⬡", "message": "Agentic PageIndex Search initiated..."})
        
        # 1. Prepare context documents
        self._prepare_documents()
        if not self.documents:
            yield format_sse("log", {"icon": "⚠", "message": "No valid document contexts could be prepared."})
            yield format_sse("DONE", None)
            return

        # 2. Planning Step: Determine Intent
        yield format_sse("log", {"icon": "🎯", "message": "Planning reasoning path..."})
        intent_prompt = (
            f"You are an Advanced Agentic Document Assistant.\n"
            f"User Query: '{self.query}'\n"
            f"Selected Documents: {self.filenames}\n\n"
            f"Output a highly concise 1-sentence description of your search intent and planning strategy "
            f"to locate the exact answers for this query. "
            f"Keep it very brief (under 15 words) and professional. "
            f"Do not use markdown formatting, code blocks, or preamble."
        )
        try:
            r = self.llm.generate({
                "model": self.llm.default_model,
                "prompt": intent_prompt,
                "stream": False,
                "options": {"temperature": 0.2, "num_ctx": 100000}
            })
            intent = r.choices[0].message.content.strip() if hasattr(r, "choices") else ""
            intent = re.sub(r"^```(?:json)?\s*", "", intent, flags=re.MULTILINE)
            intent = re.sub(r"\s*```$", "", intent, flags=re.MULTILINE)
            intent = intent.strip('"\'')
        except Exception as e:
            intent = f"Analyze selected document structure outlines to retrieve page answers."
            
        yield format_sse("log", {"icon": "🎯", "message": f"Intent: {intent}"})

        # ── STRUCTURAL QUERY SHORTCUT ──
        from services.pageindex_search import _is_structural_query, _serialize_tree_with_summaries
        if _is_structural_query(self.query):
            yield format_sse("log", {"icon": "🌲", "message": "Structural query detected — answering from document outline (no page extraction needed)."})
            
            context_parts = []
            all_pages_flat = []
            for fn in self.filenames:
                if fn not in self.documents:
                    continue
                structure = self.documents[fn].get('structure', [])
                outline_text = _serialize_tree_with_summaries(structure)
                if outline_text:
                    context_parts.append(f"=== Document Outline: {fn} ===\n\n{outline_text}")
            
            if context_parts:
                from services.pageindex_search import _enforce_token_budget
                context_text = _enforce_token_budget(context_parts)
                yield format_sse("context_compiled", {"pages": all_pages_flat, "char_count": len(context_text)})
                
                # Skip directly to synthesis (no page extraction needed)
                # We need to set structures for the synthesis prompt
                structures_serialized = []
                for fn, doc in self.documents.items():
                    from streaming.pageindex_streamer import _serialize_tree_for_llm
                    serialized = _serialize_tree_for_llm(doc.get("structure", []))
                    structures_serialized.append(f"Document Outline for {fn}:\n{serialized}")
                structure_context = "\n\n".join(structures_serialized)
                
                # Jump to synthesis section below
                # (We need to break out of this block and jump to the synthesis)
                yield format_sse("log", {"icon": "✦", "message": "Synthesizing agentic expert citations answer..."})
                
                payload = {
                    "model": self.llm.default_model,
                    "stream": True,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are an Advanced Agentic Document Expert (like Claude Code). "
                                "Synthesize a precise, well-structured final answer to the user query based on the document outline with summaries.\n\n"
                                f"Complete Document Structure Outline:\n{structure_context}\n\n"
                                "CRITICAL RULES:\n"
                                "1. You MUST ALWAYS write out your reasoning in a `<think>...</think>` block before writing your final answer.\n"
                                "2. Format your answer using clean markdown, bold headers, and bullet points. NEVER output raw JSON to the user.\n"
                                "3. Always cite the exact document and page range (e.g. '1_12 - Fractography.pdf, pp. 5-9') when detailing your answer."
                            )
                        },
                        {
                            "role": "user",
                            "content": f"Document Outline with Full Summaries:\n\n{context_text}\n\nQuestion: {self.query}"
                        }
                    ],
                    "options": {"temperature": 0.3, "num_ctx": 100000}
                }
                
                try:
                    resp = self.llm.stream_chat(payload)
                    in_think = False
                    text_buf = ""
                    for chunk in resp:
                        try:
                            token = ""
                            if hasattr(chunk, "choices") and chunk.choices:
                                token = getattr(chunk.choices[0].delta, "content", "") or ""
                            
                            if token:
                                text_buf += token
                                while text_buf:
                                    if in_think:
                                        end = text_buf.find("</think>")
                                        if end == -1:
                                            safe = text_buf[:-8] if len(text_buf) > 8 else ""
                                            if safe:
                                                text_buf = text_buf[len(safe):]
                                            break
                                        else:
                                            text_buf = text_buf[end + 8:]
                                            in_think = False
                                    else:
                                        start = text_buf.find("<think>")
                                        if start == -1:
                                            if len(text_buf) > 7:
                                                safe = text_buf[:-7]
                                                text_buf = text_buf[len(safe):]
                                                yield format_sse("token", {"token": safe})
                                            break
                                        else:
                                            if start > 0:
                                                yield format_sse("token", {"token": text_buf[:start]})
                                            text_buf = text_buf[start + 7:]
                                            in_think = True
                        except Exception:
                            continue
                    if text_buf and not in_think:
                        yield format_sse("token", {"token": text_buf})
                except Exception as e:
                    yield format_sse("error", {"message": f"LLM streaming failed: {e}"})
                
                yield format_sse("DONE", None)
                return
        
        # ── CONTENT QUERY: Full page extraction path ──
        # 3. Tool Call 1: get_document_structure
        pages_by_file = {}
        for fn in self.filenames:
            if fn not in self.documents:
                continue
                
            yield format_sse("log", {"icon": "⚙", "message": f"Calling tool: get_document_structure(doc_id='{fn}')"})
            
            # Retrieve outline tree using the official retrieve.py tool
            structure_json = get_document_structure(self.documents, fn)
            structure = json.loads(structure_json)
            total_pages = self.documents[fn]['total_pages']
            
            yield format_sse("structure_retrieved", {"structure": structure, "filename": fn, "total_pages": total_pages})
            yield format_sse("log", {"icon": "🌲", "message": f"Successfully retrieved outline structure tree for {fn}"})
            
            # 4. Tool Call 2: get_page_content based on structure analysis
            yield format_sse("log", {"icon": "🧠", "message": f"Analyzing structure tree outline via LLM to locate target pages..."})
            
            # Serialize the tree in a token-saving format
            from streaming.pageindex_streamer import _serialize_tree_for_llm
            serialized_tree = _serialize_tree_for_llm(structure)
            
            analysis_prompt = (
                f"You are an Expert Document Outline Analyzer.\n"
                f"User Query: '{self.query}'\n\n"
                f"Document Outline Tree:\n"
                f"{serialized_tree}\n\n"
                f"Task:\n"
                f"Identify the exact physical page numbers that specifically contain the answers or resources the user is asking for.\n"
                f"Output ONLY a valid JSON object containing your reasoning and the selected page numbers, like this:\n"
                f"{{\n"
                f"  \"reasoning\": \"The heading 'Materials' on pages 5-7 directly addresses the query.\",\n"
                f"  \"pages\": [5, 6, 7]\n"
                f"}}\n"
                f"Rules for page routing (CRITICAL):\n"
                f"1. **Explicit Page Requests**: If the user query asks for specific page numbers or page ranges (e.g., 'page 12', 'pages 15-20', 'pp. 120-130', 'p. 50'), you MUST extract and select those exact physical page numbers directly!\n"
                f"2. **Explicit Chapter/Section Requests**: If the user asks for a specific chapter, section, or heading (e.g. 'Chapter 3', 'Photography section', 'Visual Examination'), find the matching nodes in the Document Outline Tree and select all pages in their start_page to end_page range!\n"
                f"3. **Broad Overview/Summary Requests**: If the user asks for a complete summary, outline, or overview of the entire PDF, select a distributed sample of pages representing the starting page of each main Chapter (Level 1 node) in the tree so the user gets a comprehensive review of the full document content!\n"
                f"4. **Semantic/Keyword Requests**: If the query is a direct question, locate the most semantically relevant sections from the tree and pick the pages that contain the precise answers.\n"
                f"5. **Tables and Figures Requests**: If the query explicitly asks for tables or figures (e.g. 'How many tables are there?', 'Extract Figure 2'), look closely at the 'Tables' and 'Figures' metadata in the tree nodes. Select the pages for the nodes that contain the requested tables/figures.\n"
                f"6. **Constraints**: Select between 1 to 20 page numbers (as integers). Do not include markdown fences, thinking block tags, or extra text."
            )
            
            selected_pages = []
            try:
                r = self.llm.generate({
                    "model": self.llm.default_model,
                    "prompt": analysis_prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_ctx": 100000}
                })
                resp_text = r.choices[0].message.content.strip() if hasattr(r, "choices") else ""
                resp_text = re.sub(r"<think>.*?</think>", "", resp_text, flags=re.DOTALL).strip()
                resp_text = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.MULTILINE)
                resp_text = re.sub(r"\s*```$", "", resp_text, flags=re.MULTILINE)
                
                analysis_data = json.loads(resp_text)
                reasoning = analysis_data.get("reasoning", "Outline analysis completed.")
                selected_pages = analysis_data.get("pages", [])
                yield format_sse("pages_selected", {"filename": fn, "pages": selected_pages})
                yield format_sse("log", {"icon": "🧠", "message": f"Outline Decision: {reasoning}"})
            except Exception as e:
                # Heuristic fallback if LLM or parsing fails
                selected_pages = [1, 2, 3]
                yield format_sse("log", {"icon": "⚠", "message": "Fuzzy fallback outline selection applied (pages 1-3)."})
                
            if not selected_pages:
                selected_pages = [1]
                
            selected_pages = sorted(list(set(int(p) for p in selected_pages if isinstance(p, (int, float)))))
            pages_by_file[fn] = selected_pages
            
        # 5. Tool Call 3: get_page_content
        context_parts = []
        all_pages_flat = []
        
        for fn, pages in pages_by_file.items():
            pages_str = ",".join(map(str, pages))
            yield format_sse("log", {"icon": "⚙", "message": f"Calling tool: get_page_content(doc_id='{fn}', pages='{pages_str}')"})
            
            # Fetch page content text using official retrieve.py tool
            content_json = get_page_content(self.documents, fn, pages_str)
            contents = json.loads(content_json)
            
            if isinstance(contents, dict) and "error" in contents:
                yield format_sse("log", {"icon": "⚠", "message": f"Error calling get_page_content: {contents['error']}"})
                continue
            
            page_text_accum = ""
            for item in contents:
                page_text_accum += f"\n--- [Page {item['page']} of {fn}] ---\n{item['content']}"
                all_pages_flat.append(f"{fn} p.{item['page']}")
                
            context_parts.append(page_text_accum)
            yield format_sse("log", {"icon": "📄", "message": f"Retrieved text content from selected page(s): {pages_str}"})

        # Compile total context with token budget enforcement
        from services.pageindex_search import _enforce_token_budget
        context_text = _enforce_token_budget(context_parts)
        yield format_sse("context_compiled", {"pages": all_pages_flat, "char_count": len(context_text)})

        # Compile document structure serialized outlines to help the LLM answer structural/complete summary queries
        structures_serialized = []
        for fn, doc in self.documents.items():
            from streaming.pageindex_streamer import _serialize_tree_for_llm
            serialized = _serialize_tree_for_llm(doc.get("structure", []))
            structures_serialized.append(f"Document Outline for {fn}:\n{serialized}")
        structure_context = "\n\n".join(structures_serialized)

        # 6. Stream final expert citations answer
        yield format_sse("log", {"icon": "✦", "message": "Synthesizing agentic expert citations answer..."})
        
        payload = {
            "model": self.llm.default_model,
            "stream": True,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an Advanced Agentic Document Expert (like Claude Code). "
                        "Synthesize a precise, well-structured final answer to the user query based on the retrieved page contents and the complete document's structure outline.\n\n"
                        f"Complete Document Structure Outline:\n{structure_context}\n\n"
                        "CRITICAL RULES:\n"
                        "1. You MUST ALWAYS write out your reasoning in a `<think>...</think>` block before writing your final answer.\n"
                        "2. Format your answer using clean markdown, bold headers, and bullet points. NEVER output raw JSON to the user.\n"
                        "3. Always cite the exact document and page number (e.g. '1_12 - Fractography.pdf, p. 125') when detailing your answer."
                    )
                },
                {
                    "role": "user",
                    "content": f"Retrieved Page Contexts:\n\n{context_text}\n\nQuestion: {self.query}"
                }
            ],
            "options": {"temperature": 0.3, "num_ctx": 100000}
        }
        
        try:
            resp = self.llm.stream_chat(payload)
            in_think = False
            text_buf = ""
            for chunk in resp:
                try:
                    token = ""
                    if hasattr(chunk, "choices") and chunk.choices:
                        token = getattr(chunk.choices[0].delta, "content", "") or ""
                    
                    if token:
                        text_buf += token
                        while text_buf:
                            if in_think:
                                end = text_buf.find("</think>")
                                if end == -1:
                                    safe = text_buf[:-8] if len(text_buf) > 8 else ""
                                    if safe:
                                        text_buf = text_buf[len(safe):]
                                    break
                                else:
                                    in_think = False
                                    text_buf = text_buf[end + 8:]
                            else:
                                start = text_buf.find("<think>")
                                if start == -1:
                                    safe = text_buf[:-7] if len(text_buf) > 7 else ""
                                    if safe:
                                        yield format_sse("token", safe)
                                        text_buf = text_buf[len(safe):]
                                    break
                                else:
                                    if start > 0:
                                        yield format_sse("token", text_buf[:start])
                                    in_think = True
                                    text_buf = text_buf[start + 7:]
                                    
                    if hasattr(chunk, "choices") and chunk.choices and chunk.choices[0].finish_reason:
                        if text_buf and not in_think:
                            yield format_sse("token", text_buf)
                        break
                except Exception:
                    continue
        except Exception as e:
            yield format_sse("token", f"\nError streaming response: {e}")
            
        yield format_sse("DONE", None)
