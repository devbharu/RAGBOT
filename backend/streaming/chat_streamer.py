"""
chat_streamer.py — Server-Sent Events (SSE) streaming generator for standard RAG chat.
"""

import re
import json
import time
import requests
from typing import Generator, Dict, Any, Optional

from services.chroma_service import ChromaService
from services.llm_service import LLMService
from repositories.chat_repository import ChatRepository
from graphs.rag_graph import crag_retrieve
from utils.sse import format_claude_sse
from utils.telemetry import logger, time_telemetry

def generate_chat_title(query: str) -> str:
    """Generate a short 3-5 word title from a query using Ollama."""
    llm_service = LLMService()
    try:
        prompt = f"Summarize this query into a 3-5 word title for a chat history sidebar. Query: '{query}'. Output ONLY the title text, no quotes."
        payload = {"model": llm_service.default_model, "prompt": prompt, "stream": False}
        r = llm_service.generate(payload, max_retries=2)
        title = r.choices[0].message.content.strip() if hasattr(r, "choices") else ""
        title = re.sub(r'^["\']|["\']$', '', title).strip()
        return title[:100] if title else query[:80]
    except Exception:
        pass
    return query[:80]

@time_telemetry("chat_streamer.stream_chat_response")
def stream_chat_response(query: str, filename: str, chat_id: Optional[int], user_id: Optional[int], params: Dict[str, Any], message_id: int = None) -> Generator[str, None, None]:
    """
    RAG Chat SSE Streamer (Claude UI Compatible).
    Retrieves semantic context and yields formatted tokens using OOP UI schema.
    """
    chroma_service = ChromaService()
    llm_service = LLMService()
    
    search_mode = params.get("search_mode", "vector")
    scope = params.get("scope", "active")
    tree_mode = params.get("tree_mode", "tree")
    
    files_to_search = [filename] if filename else []
    if scope == "all":
        files_to_search = chroma_service.list_indexed_files()

    logger.info(f"[CHAT-STREAMER] Retrieving context. Mode: {search_mode}, Scope: {scope}, Files: {len(files_to_search)}")
    
    # Start the message stream
    yield format_claude_sse("message_start", {"message": {"id": f"msg_{int(time.time())}", "role": "assistant"}})
    
    hits = []
    crag_context = ""
    
    def emit_tool_step(name: str):
        step_id = f"step_{time.time()}"
        yield format_claude_sse("content_block_start", {"content_block": {"type": "tool_use", "id": step_id, "name": name}})
        yield format_claude_sse("content_block_stop", {})

    if search_mode == "tree":
        from services.pageindex_search import route_and_extract_pages
        
        def llm_invoke(prompt: str) -> str:
            payload = {"model": llm_service.default_model, "prompt": prompt, "stream": False}
            r = llm_service.generate(payload)
            if hasattr(r, "choices") and r.choices and hasattr(r.choices[0].message, "content"):
                return (r.choices[0].message.content or "").strip()
            return ""
            
        for f in files_to_search:
            for log_msg, extracted_hits in route_and_extract_pages(query, f, tree_mode, 15, llm_invoke):
                if log_msg:
                    yield from emit_tool_step(log_msg)
                if extracted_hits is not None:
                    hits.extend(extracted_hits)
    else:
        # Standard Vector Search
        if scope == "all":
            yield from emit_tool_step(f"Executing semantic vector search across {len(files_to_search)} documents...")
            for f in files_to_search:
                f_hits = chroma_service.search_file(f, query, k=10)
                hits.extend(f_hits)
            
            if hits:
                hits.sort(key=lambda h: h.get("rerank_score", h.get("score", 0)), reverse=True)
                hits = hits[:15]
        else:
            yield from emit_tool_step(f"Executing hybrid CRAG vector search on `{filename}`...")
            try:
                hits, crag_context = crag_retrieve(query, filename)
                if crag_context:
                    yield from emit_tool_step("Synthesized comprehensive CRAG context.")
            except Exception as e:
                logger.warn(f"[CHAT-STREAMER] CRAG retrieval failed, falling back to standard search: {e}")
                
            if not hits and not crag_context:
                yield from emit_tool_step("Falling back to standard semantic search & cross-encoder reranking...")
                hits = chroma_service.search_file(filename, query)
                
    yield from emit_tool_step(f"Context gathering complete. Found {len(hits)} text chunks.")
        
    if not hits and not crag_context:
        yield format_claude_sse("content_block_start", {"content_block": {"type": "text"}})
        yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": "No relevant content found in this document."}})
        yield format_claude_sse("content_block_stop", {})
        yield format_claude_sse("message_stop", {})
        return

    # Compile context block
    if crag_context:
        context_text = crag_context
    else:
        context_parts = []
        for h in hits:
            page_info = f"p.{h['page']}/{h['total_pages']}" if h.get("page") else ""
            rerank_info = f" | rerank:{h['rerank_score']:.3f}" if "rerank_score" in h else ""
            label = f"[{h['type'].upper()} | {h['source']} {page_info} | score:{h['score']}{rerank_info}]"
            context_parts.append(f"{label}\n{h['text']}")
        context_text = "\n\n".join(context_parts)

    payload = {
        "model": llm_service.default_model,
        "stream": True,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a highly precise academic assistant and an Advanced Document Expert (like Claude Code).\n"
                    "Analyze the provided context and answer the user query clearly and accurately.\n"
                    "CRITICAL RULES:\n"
                    "1. You MUST ALWAYS write out your reasoning in a `<think>...</think>` block before writing your final answer.\n"
                    "2. Your final answer MUST be in clean Markdown (use bullet points and bold headers). NEVER output raw JSON.\n"
                    "3. Refer to the specific pages or page ranges (e.g. 'p. 125' or 'pp. 45-50') when detailing your answer."
                )
            },
            {
                "role": "user",
                "content": f"Context from '{filename}':\n\n{context_text}\n\nQuestion: {query}"
            }
        ],
        "options": {
            "temperature": float(params.get("temperature", 0.4)),
            "max_tokens": int(params.get("max_output_tokens", 1024)),
            "top_p": float(params.get("top_p", 0.9))
        }
    }

    assistant_text = ""
    yield format_claude_sse("content_block_start", {"content_block": {"type": "text"}})
    
    try:
        resp = llm_service.stream_chat(payload)
        
        in_think = False
        text_buf = ""
        last_heartbeat = time.time()
        
        for chunk in resp:
            if time.time() - last_heartbeat > 15:
                yield ": heartbeat\n\n"
                last_heartbeat = time.time()
                
            try:
                # Support litellm chunk objects
                token = ""
                if hasattr(chunk, "choices") and chunk.choices:
                    delta = chunk.choices[0].delta
                    token = getattr(delta, "content", "") or ""
                    
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
                                    assistant_text += safe
                                    yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": safe}})
                                    text_buf = text_buf[len(safe):]
                                break
                            else:
                                if start > 0:
                                    assistant_text += text_buf[:start]
                                    yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": text_buf[:start]}})
                                in_think = True
                                text_buf = text_buf[start + 7:]
                                
                # check if stream done
                if hasattr(chunk, "choices") and chunk.choices and chunk.choices[0].finish_reason:
                    if text_buf and not in_think:
                        assistant_text += text_buf
                        yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": text_buf}})
                        text_buf = ""
                    break
            except Exception as ex:
                logger.error(f"[CHAT-STREAMER] Chunk parsing exception: {ex}")
                continue
                
        if text_buf and not in_think:
            assistant_text += text_buf
            yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": text_buf}})
            
        if not assistant_text.strip():
            fallback = "I'm sorry, I couldn't find enough information in the document to answer your question."
            assistant_text = fallback
            yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": fallback}})
                
    except Exception as e:
        logger.error(f"[CHAT-STREAMER] Stream error: {e}")
        yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": f"Error: {e}"}})
    except GeneratorExit:
        logger.warn(f"[CHAT-STREAMER] SSE client disconnected abruptly. Stopping stream.")
        raise
    except Exception as e:
        logger.error(f"[CHAT-STREAMER] Stream error: {e}")
        yield format_claude_sse("content_block_delta", {"delta": {"type": "text_delta", "text": f"Error: {e}"}})
    finally:
        yield format_claude_sse("content_block_stop", {})
        yield format_claude_sse("message_stop", {})
        
        if user_id and chat_id:
            status_to_save = "done" if assistant_text.strip() else "error"
            extra_data = json.dumps({"status": status_to_save})
            try:
                if message_id:
                    ChatRepository.update_message(message_id, assistant_text or "Error: Generation failed.", extra_data)
                    logger.info(f"[CHAT-STREAMER] Updated assistant placeholder message {message_id}")
                else:
                    ChatRepository.save_message(chat_id, "assistant", assistant_text or "Error: Generation failed.", extra_data=extra_data)
                    logger.info(f"[CHAT-STREAMER] Saved assistant response to DB under chat {chat_id}")
            except Exception as ex:
                logger.error(f"[CHAT-STREAMER] Failed to save assistant message: {ex}")
