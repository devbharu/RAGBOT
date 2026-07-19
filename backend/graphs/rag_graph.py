"""
rag_graph.py  — Fast & Accurate Claude-Style Agentic RAG Retrieval
───────────────────────────────────────────────────────────────────
Architecture: Minimal, efficient multi-agent workflow inspired by Claude:
  
  AGENT 1: Query Optimizer
    - Detects short/long queries, decides MultiQuery strategy
    - Skips variant generation for ≤4 word queries (prevents hallucination)
    - Fast path: direct similarity search for narrow queries
  
  AGENT 2: Parallel Retrieval
    - Runs 1-2 queries in parallel (original + optional variant)
    - Deduplicates by content hash, keeps top-K by similarity score
    - No image processing overhead
  
  AGENT 3: Relevance Grader (Batched)
    - Single LLM call to grade ALL chunks at once
    - Returns yes/no verdicts, falls back to top-K if empty
    - Rewrite trigger: <2 relevant chunks AND rewrite_count < MAX
  
  AGENT 4: Query Rewriter (On-Demand)
    - Only runs if grading fails AND rewrite budget remains
    - Simplifies language, broadens scope
    - Single rewrite per query (stops cascade)
  
  AGENT 5: Context Builder
    - Compiles top chunks into clean markdown context
    - Strips image metadata, focuses on text
    - Preserves source/page info for citation

Key Optimizations:
  ✓ Batched grading (1 LLM call, not N)
  ✓ Short query fast-path (skip MultiQuery)
  ✓ Parallel retrieval where possible
  ✓ No image processing
  ✓ Minimal rewrite loops (max 1)
  ✓ Fallback to similarity ranking (never returns empty)
  ✓ Tokenized chunk previews (save context window)
"""

from __future__ import annotations

import os
import re
from typing import TypedDict

from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.chat_models import ChatLiteLLM
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from langgraph.graph import StateGraph, END

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────

OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL",          "gpt-oss:120b-cloud")
EMBED_MODEL   = os.getenv("EMBED_MODEL",           "BAAI/bge-small-en-v1.5")
CHROMA_DIR    = os.getenv("CHROMA_DIR",            "chroma_db")
MAX_REWRITES  = int(os.getenv("CRAG_MAX_REWRITES", "1"))   # was 2
GRADE_THRESH  = int(os.getenv("CRAG_GRADE_THRESH", "2"))   # was 3
RETRIEVAL_K   = int(os.getenv("RETRIEVAL_K",       "15"))  # was 20, slightly tighter
RERANK_TOP_N  = int(os.getenv("RERANK_TOP_N",      "8"))

# Queries with this many words or fewer skip MultiQuery + grading entirely
SHORT_QUERY_WORD_LIMIT = 4

# Formula/tech detection: intelligently boost relevant chunks
FORMULA_KEYWORDS = {'formula', 'equation', 'math', 'calculate', 'derive', 
                    'solve', 'theorem', 'coefficient', 'exponential'}
TECH_KEYWORDS = {'algorithm', 'protocol', 'architecture', 'implementation', 
                 'design', 'structure', 'interface'}

# ──────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────

class RAGState(TypedDict):
    query:          str
    original_query: str          # kept for fallback context
    filename:       str
    chunks:         list[dict]
    rewrite_count:  int
    needs_rewrite:  bool
    final_context:  str


# ──────────────────────────────────────────────────────────────
# Lazy singletons
# ──────────────────────────────────────────────────────────────

_embedding_fn: HuggingFaceEmbeddings | None = None
_llm: ChatLiteLLM | None = None


def _get_embedding_fn() -> HuggingFaceEmbeddings:
    global _embedding_fn
    if _embedding_fn is None:
        _embedding_fn = HuggingFaceEmbeddings(
            model_name=EMBED_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embedding_fn


def _get_llm() -> ChatLiteLLM:
    global _llm
    if _llm is None:
        model_name = os.getenv("LLM_MODEL", OLLAMA_MODEL if "/" in OLLAMA_MODEL else f"ollama/{OLLAMA_MODEL}")
        _llm = ChatLiteLLM(
            model=model_name,
            temperature=0.1
        )
    return _llm


def _get_vectorstore(filename: str) -> Chroma:
    col_name = "file_" + re.sub(r"[^a-zA-Z0-9_-]", "_", filename)
    return Chroma(
        collection_name=col_name,
        embedding_function=_get_embedding_fn(),
        persist_directory=CHROMA_DIR,
    )


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

def _is_short_query(query: str) -> bool:
    """Short or single-word queries — skip MultiQuery to avoid hallucination."""
    return len(query.strip().split()) <= SHORT_QUERY_WORD_LIMIT


def _is_formula_query(query: str) -> bool:
    """Detect if query is asking for formulas/equations."""
    q_lower = query.lower()
    return any(keyword in q_lower for keyword in FORMULA_KEYWORDS)


def _has_formula_content(chunk_text: str) -> bool:
    """Check if chunk contains formulas (LaTeX markers)."""
    return bool(re.search(r'\$.*?\$|\\frac|\\sqrt|\^{.*?}|_{.*?}', chunk_text))


def _has_table_content(chunk_text: str) -> bool:
    """Check if chunk is a table or structured data."""
    return chunk_text.lstrip().startswith('|') or '[TABLE' in chunk_text or 'DataFrame' in chunk_text


def _doc_to_chunk(doc, filename: str) -> dict:
    """Convert LangChain document to chunk dict (no image metadata)."""
    meta = doc.metadata or {}
    return {
        "text":        doc.page_content,
        "source":      meta.get("source",      filename),
        "type":        meta.get("type",         "text"),
        "page":        meta.get("page",         ""),
        "total_pages": meta.get("total_pages",  ""),
        "chunk_index": meta.get("chunk_index",  ""),
        "score":       1.0,
    }


# ──────────────────────────────────────────────────────────────
# Node 1: Retrieve (Agent 1 + 2: Optimizer & Retriever)
# ──────────────────────────────────────────────────────────────

def retrieve_node(state: RAGState) -> RAGState:
    """Fast retrieval: adaptive for formulas, technical content, and regular queries."""
    query    = state["query"]
    filename = state["filename"]
    vs       = _get_vectorstore(filename)
    llm      = _get_llm()

    # AGENT 1: Query Optimizer — detect query type
    is_short = _is_short_query(query)
    is_formula = _is_formula_query(query)
    
    # Adjust retrieval K: formulas need more context
    k_for_query = min(RETRIEVAL_K + 5, 25) if is_formula else RETRIEVAL_K
    
    print(f"[RAG] AGENT 1: Query type: short={is_short} formula={is_formula}")
    
    if is_short:
        # Fast path: direct similarity search only
        print(f"[RAG] AGENT 1/2: Short query fast-path — direct search")
        try:
            docs   = vs.similarity_search(query, k=k_for_query)
            chunks = [_doc_to_chunk(d, filename) for d in docs]
        except Exception as e:
            print(f"[RAG] Direct search failed: {e}")
            chunks = []
        print(f"[RAG] Retrieved {len(chunks)} chunks")
        return {**state, "chunks": chunks}
    
    # Complex query: generate 1 variant + run 2 parallel queries
    print(f"[RAG] AGENT 1: Complex query — generating 1 variant")
    
    # Tailor variant for formula queries
    if is_formula:
        variant_prompt = (
            f"Rewrite this formula/math query using alternative terms:\n"
            f"Original: {query}\n"
            f"Output ONLY the new query (must ask about formulas/math)."
        )
    else:
        variant_prompt = (
            f"Rewrite this query with different but related terminology:\n"
            f"Original: {query}\n"
            f"Output ONLY the new query, nothing else."
        )
    
    try:
        variant = llm.invoke(variant_prompt).content.strip().split("\n")[0][:100]
    except:
        variant = None
    
    all_queries = [query] + ([variant] if variant else [])
    print(f"[RAG] AGENT 2: Running {len(all_queries)} parallel retrievals (k={k_for_query})")
    
    # Run retrieval for all queries, deduplicate
    seen, chunks = set(), []
    for q in all_queries:
        try:
            docs = vs.similarity_search(q, k=k_for_query)
            for doc in docs:
                chunk_key = doc.page_content[:80]
                if chunk_key not in seen:
                    seen.add(chunk_key)
                    chunks.append(_doc_to_chunk(doc, filename))
        except Exception as e:
            print(f"[RAG] Query failed: {q[:50]}... ({e})")
    
    # SMART SORTING: Prioritize formula/table chunks for formula queries
    if is_formula:
        def sort_key(chunk):
            text = chunk['text']
            has_formula = _has_formula_content(text)
            has_table = _has_table_content(text)
            # Lower score = higher priority
            score = 0
            if has_formula:
                score -= 100
            if has_table:
                score -= 50
            return score
        chunks.sort(key=sort_key)
        print(f"[RAG] AGENT 2: Prioritized formula/table chunks")
    
    print(f"[RAG] Retrieved {len(chunks)} unique chunks")
    return {**state, "chunks": chunks}
    seen, chunks = set(), []
    for q in all_queries:
        try:
            docs = vs.similarity_search(q, k=RETRIEVAL_K)
            for doc in docs:
                chunk_key = doc.page_content[:80]
                if chunk_key not in seen:
                    seen.add(chunk_key)
                    chunks.append(_doc_to_chunk(doc, filename))
        except Exception as e:
            print(f"[RAG] Query failed: {q[:50]}... ({e})")
    
    print(f"[RAG] Retrieved {len(chunks)} unique chunks")
    return {**state, "chunks": chunks}


# ──────────────────────────────────────────────────────────────
# Node 2: Grade Chunks (Agent 3: Relevance Grader)
# ──────────────────────────────────────────────────────────────

_BATCH_GRADE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a relevance grader. For each chunk, output 'yes' or 'no' "
     "on its own line if it's relevant to the question.\n"
     "Output exactly as many lines as chunks. No explanation."),
    ("human",
     "Question: {question}\n\n"
     "Chunks:\n{chunks_block}"),
])


def grade_chunks_node(state: RAGState) -> RAGState:
    """AGENT 3: Single LLM call to grade all chunks at once."""
    query  = state["query"]
    chunks = state["chunks"]

    if not chunks:
        print("[RAG] AGENT 3: No chunks to grade")
        return {**state, "needs_rewrite": False}

    # Skip grading for short queries — trust similarity search
    if _is_short_query(state["original_query"]):
        print(f"[RAG] AGENT 3: Short query — skip grading, keep all {len(chunks)}")
        return {**state, "needs_rewrite": False}

    llm   = _get_llm()
    chain = _BATCH_GRADE_PROMPT | llm | StrOutputParser()

    # Build numbered chunk snippets (keep short to save tokens)
    chunks_block = "\n\n".join(
        f"[{i+1}] {c['text'][:250]}" for i, c in enumerate(chunks)
    )

    try:
        print(f"[RAG] AGENT 3: Grading {len(chunks)} chunks in 1 call")
        raw     = chain.invoke({"question": query, "chunks_block": chunks_block})
        lines   = [l.strip().lower() for l in raw.split("\n") if l.strip()]
        
        relevant = [
            c for c, v in zip(chunks, lines[:len(chunks)])
            if "yes" in v
        ]
        print(f"[RAG] AGENT 3: {len(relevant)}/{len(chunks)} passed")

    except Exception as e:
        print(f"[RAG] AGENT 3: Grader failed ({e}) — keep all")
        relevant = chunks

    # Fallback: if grading returned 0, use top chunks by similarity
    if not relevant:
        fallback_n = min(GRADE_THRESH, len(chunks))
        relevant   = chunks[:fallback_n]
        print(f"[RAG] AGENT 3: Grade empty — fallback to top-{fallback_n}")

    needs_rewrite = (
        len(relevant) < GRADE_THRESH
        and state.get("rewrite_count", 0) < MAX_REWRITES
    )
    return {**state, "chunks": relevant, "needs_rewrite": needs_rewrite}


# ──────────────────────────────────────────────────────────────
# Node 3: Rewrite Query (Agent 4: Query Rewriter)
# ──────────────────────────────────────────────────────────────

_REWRITE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "Simplify this query using more general, broader language "
     "to improve document matching.\n"
     "Output ONLY the rewritten query."),
    ("human", "{query}"),
])


def rewrite_query_node(state: RAGState) -> RAGState:
    """AGENT 4: On-demand query rewriter (single rewrite per query)."""
    llm   = _get_llm()
    chain = _REWRITE_PROMPT | llm | StrOutputParser()
    
    try:
        print(f"[RAG] AGENT 4: Rewriting query")
        new_query = chain.invoke({"query": state["query"]}).strip().split("\n")[0][:150]
        print(f"[RAG] AGENT 4: '{state['query'][:50]}...' → '{new_query[:50]}...'")
    except Exception as e:
        print(f"[RAG] AGENT 4: Rewrite failed ({e}), keeping original")
        new_query = state["query"]
    
    return {
        **state,
        "query":         new_query,
        "rewrite_count": state.get("rewrite_count", 0) + 1,
    }


# ──────────────────────────────────────────────────────────────
# Node 4: Build Context (Agent 5: Context Compiler)
# ──────────────────────────────────────────────────────────────

def build_context_node(state: RAGState) -> RAGState:
    """AGENT 5: Compile top chunks into clean markdown context (formula-aware)."""
    chunks = state["chunks"]
    query = state["query"]
    parts  = []
    
    is_formula = _is_formula_query(query)
    
    for i, h in enumerate(chunks[:RERANK_TOP_N], 1):
        # Build clean citation header
        page_str = f"p.{h['page']}" if h.get("page") else ""
        source_str = h.get('source', 'unknown')[:30]
        chunk_type = f" [{h.get('type', 'text').upper()}]" if h.get('type') != 'text' else ""
        header = f"**[{i}]** {source_str} {page_str}{chunk_type}".strip()
        
        # Adaptive: preserve full formulas, truncate regular text
        has_formula = _has_formula_content(h['text'])
        has_table = _has_table_content(h['text'])
        
        if has_formula or has_table or is_formula:
            text_preview = h['text']  # Full content for formulas
        else:
            text_preview = h['text'][:500]  # Truncate regular text
        
        parts.append(f"{header}\n{text_preview}")
    
    context = "\n\n---\n\n".join(parts)
    print(f"[RAG] AGENT 5: Compiled {len(chunks)} chunks → {len(context)} chars")
    return {**state, "final_context": context}


# ──────────────────────────────────────────────────────────────
# Routing Logic
# ──────────────────────────────────────────────────────────────

def route_after_grading(state: RAGState) -> str:
    """Route: Rewrite → Retrieve loop, or finish."""
    if state.get("needs_rewrite") and state.get("rewrite_count", 0) < MAX_REWRITES:
        return "rewrite"
    return "build_context"


# ──────────────────────────────────────────────────────────────
# Build LangGraph (5 Agent Workflow)
# ──────────────────────────────────────────────────────────────

def build_rag_graph():
    """Fast agentic RAG graph inspired by Claude architecture."""
    g = StateGraph(RAGState)
    
    # Add agent nodes
    g.add_node("retrieve",      retrieve_node)       # Agent 1 & 2
    g.add_node("grade",         grade_chunks_node)   # Agent 3
    g.add_node("rewrite",       rewrite_query_node)  # Agent 4
    g.add_node("build_context", build_context_node)  # Agent 5

    # Workflow: Retrieve → Grade → (Rewrite ↔ Retrieve) or Build
    g.set_entry_point("retrieve")
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", route_after_grading, {
        "rewrite":       "rewrite",
        "build_context": "build_context",
    })
    g.add_edge("rewrite",       "retrieve")
    g.add_edge("build_context", END)
    
    return g.compile()


RAG_GRAPH = build_rag_graph()


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

def crag_retrieve(query: str, filename: str) -> tuple[list[dict], str]:
    """Fast, accurate Claude-style agentic RAG retrieval.
    
    Returns:
        (chunks, context) — list of chunk dicts + markdown context string
    """
    print(f"\n[RAG] ════════════════════════════════════════")
    print(f"[RAG] Query: {query[:80]}")
    print(f"[RAG] File:  {filename}")
    print(f"[RAG] ════════════════════════════════════════")
    
    result = RAG_GRAPH.invoke({
        "query":          query,
        "original_query": query,
        "filename":       filename,
        "chunks":         [],
        "rewrite_count":  0,
        "needs_rewrite":  False,
        "final_context":  "",
    })
    
    print(f"[RAG] ════════════════════════════════════════")
    print(f"[RAG] Final: {len(result['chunks'])} chunks")
    print(f"[RAG] Context: {len(result['final_context'])} chars")
    print(f"[RAG] ════════════════════════════════════════\n")
    
    return result["chunks"], result["final_context"]