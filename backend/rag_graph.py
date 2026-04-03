"""
rag_graph.py  — Lean CRAG retrieval via LangGraph
──────────────────────────────────────────────────
Fixes over previous version:
  FIX 1 — Short/ambiguous queries (≤4 words) skip MultiQuery entirely.
           The LLM was hallucinating variants like "HLO in TensorFlow XLA"
           for a Computer Networks doc that has nothing about TensorFlow.
           Now we just do a direct similarity search for short queries.

  FIX 2 — MultiQuery cut from 3 variants → 1 variant (2 total queries).
           3 variants × grading every chunk × possible 2 rewrites = very slow.
           1 variant keeps diversity without the latency explosion.

  FIX 3 — Chunk grading is now BATCHED into a single LLM call instead of
           one LLM call per chunk. Grading 51 chunks one-by-one was the
           main speed killer. Now it's 1 call that returns a yes/no list.

  FIX 4 — Rewrite loop capped at 1 (was 2). If the document genuinely
           doesn't cover a topic, a second rewrite just wastes 30+ seconds.

  FIX 5 — If grading returns 0 relevant chunks on ANY query (including
           after rewrite), we fall back to top-K by similarity score rather
           than returning nothing. This prevents the "no context" blank answer.

  FIX 6 — GRADE_THRESH lowered: only rewrite if < 2 chunks pass (was 3).
           For narrow queries a single good chunk is enough to answer.
"""

from __future__ import annotations

import os
import re
from typing import TypedDict

from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from langgraph.graph import StateGraph, END

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────

OLLAMA_HOST   = os.getenv("OLLAMA_HOST",          "http://localhost:11434")
OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL",          "gpt-oss:120b-cloud")
EMBED_MODEL   = os.getenv("EMBED_MODEL",           "BAAI/bge-small-en-v1.5")
CHROMA_DIR    = os.getenv("CHROMA_DIR",            "chroma_db")
MAX_REWRITES  = int(os.getenv("CRAG_MAX_REWRITES", "1"))   # was 2
GRADE_THRESH  = int(os.getenv("CRAG_GRADE_THRESH", "2"))   # was 3
RETRIEVAL_K   = int(os.getenv("RETRIEVAL_K",       "15"))  # was 20, slightly tighter
RERANK_TOP_N  = int(os.getenv("RERANK_TOP_N",      "8"))

# Queries with this many words or fewer skip MultiQuery + grading entirely
SHORT_QUERY_WORD_LIMIT = 4


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
_llm: ChatOllama | None = None


def _get_embedding_fn() -> HuggingFaceEmbeddings:
    global _embedding_fn
    if _embedding_fn is None:
        _embedding_fn = HuggingFaceEmbeddings(
            model_name=EMBED_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embedding_fn


def _get_llm() -> ChatOllama:
    global _llm
    if _llm is None:
        _llm = ChatOllama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_HOST,
            temperature=0.1,
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


def _doc_to_chunk(doc, filename: str) -> dict:
    meta = doc.metadata or {}
    return {
        "text":        doc.page_content,
        "source":      meta.get("source",      filename),
        "type":        meta.get("type",         "text"),
        "method":      meta.get("method",       ""),
        "page":        meta.get("page",         ""),
        "total_pages": meta.get("total_pages",  ""),
        "chunk_index": meta.get("chunk_index",  ""),
        "image_path":  meta.get("image_path",   ""),
        "score":       1.0,
    }


# ──────────────────────────────────────────────────────────────
# Node 1: Retrieve
# ──────────────────────────────────────────────────────────────

def retrieve_node(state: RAGState) -> RAGState:
    query    = state["query"]
    filename = state["filename"]
    vs       = _get_vectorstore(filename)

    # Short queries: direct similarity search, no MultiQuery
    if _is_short_query(query):
        print(f"[CRAG] Short query detected — skipping MultiQuery, direct search: '{query}'")
        try:
            docs   = vs.similarity_search(query, k=RETRIEVAL_K)
            chunks = [_doc_to_chunk(d, filename) for d in docs]
        except Exception as e:
            print(f"[CRAG] Direct search failed ({e})")
            chunks = []
        print(f"[CRAG] Retrieved {len(chunks)} chunks (direct)")
        return {**state, "chunks": chunks}

    # Longer queries: generate exactly 1 variant (2 total queries)
    llm = _get_llm()
    variant_prompt = (
        f"Generate exactly 1 alternative search query for the following, "
        f"using different but related terminology. "
        f"Output only the query text, nothing else.\n\nQuery: {query}"
    )
    try:
        variant_raw = llm.invoke(variant_prompt).content.strip()
        # Take only the first line in case model outputs extra text
        variant     = variant_raw.split("\n")[0].strip()
        variants    = [variant] if variant else []
    except Exception as e:
        print(f"[CRAG] Variant generation failed ({e}), using original only")
        variants = []

    all_queries = [query] + variants
    print(f"[CRAG] Running {len(all_queries)} queries: {all_queries}")

    seen, chunks = set(), []
    retriever = vs.as_retriever(search_kwargs={"k": RETRIEVAL_K})
    for q in all_queries:
        try:
            docs = retriever.invoke(q)
            for doc in docs:
                key = doc.page_content[:100]
                if key in seen:
                    continue
                seen.add(key)
                chunks.append(_doc_to_chunk(doc, filename))
        except Exception as e:
            print(f"[CRAG] Query '{q}' failed ({e}), skipping")

    print(f"[CRAG] Retrieved {len(chunks)} unique chunks across {len(all_queries)} queries")
    return {**state, "chunks": chunks}


# ──────────────────────────────────────────────────────────────
# Node 2: Grade chunks — BATCHED (1 LLM call, not N calls)
# ──────────────────────────────────────────────────────────────

_BATCH_GRADE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a relevance grader for a document QA system.\n"
     "You will receive a user question and a numbered list of document chunks.\n"
     "For EACH chunk, output ONLY 'yes' or 'no' on its own line — "
     "yes if the chunk is relevant to the question, no if not.\n"
     "Output exactly as many lines as there are chunks. No explanation. No numbering."),
    ("human",
     "Question: {question}\n\n"
     "Chunks:\n{chunks_block}"),
])


def grade_chunks_node(state: RAGState) -> RAGState:
    query  = state["query"]
    chunks = state["chunks"]

    if not chunks:
        return {**state, "needs_rewrite": False}

    # Skip grading for short queries — trust similarity search
    if _is_short_query(state["original_query"]):
        print(f"[CRAG] Short query — skipping grading, keeping all {len(chunks)} chunks")
        return {**state, "needs_rewrite": False}

    llm   = _get_llm()
    chain = _BATCH_GRADE_PROMPT | llm | StrOutputParser()

    # Build a numbered block of chunk snippets (keep each short to save tokens)
    chunks_block = "\n\n".join(
        f"[{i+1}] {c['text'][:300]}" for i, c in enumerate(chunks)
    )

    try:
        raw     = chain.invoke({"question": query, "chunks_block": chunks_block})
        lines   = [l.strip().lower() for l in raw.strip().split("\n") if l.strip()]
        verdicts = lines[:len(chunks)]   # guard against extra output

        relevant = [
            c for c, v in zip(chunks, verdicts)
            if "yes" in v
        ]
        print(f"[CRAG] Batched grade: {len(relevant)}/{len(chunks)} chunks passed")

    except Exception as e:
        print(f"[CRAG] Batch grader error ({e}) — keeping all chunks")
        relevant = chunks

    # If grading wiped everything out, fall back to top chunks by position
    # (similarity-ranked order from Chroma) rather than returning nothing
    if len(relevant) == 0:
        fallback_n = min(GRADE_THRESH, len(chunks))
        relevant   = chunks[:fallback_n]
        print(f"[CRAG] Grade returned 0 — fallback to top-{fallback_n} by similarity")

    needs_rewrite = (
        len(relevant) < GRADE_THRESH
        and state.get("rewrite_count", 0) < MAX_REWRITES
    )
    return {**state, "chunks": relevant, "needs_rewrite": needs_rewrite}


# ──────────────────────────────────────────────────────────────
# Node 3: Rewrite query
# ──────────────────────────────────────────────────────────────

_REWRITE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a query rewriter for a RAG system backed by a specific document.\n"
     "The current query returned too few relevant chunks from that document.\n"
     "Rewrite the query to use simpler, more general language that is more "
     "likely to match content in the document.\n"
     "Output ONLY the rewritten query — nothing else."),
    ("human", "Original query: {query}"),
])


def rewrite_query_node(state: RAGState) -> RAGState:
    llm   = _get_llm()
    chain = _REWRITE_PROMPT | llm | StrOutputParser()
    try:
        new_query = chain.invoke({"query": state["query"]}).strip().split("\n")[0]
        print(f"[CRAG] Rewrote: '{state['query']}' → '{new_query}'")
    except Exception as e:
        print(f"[CRAG] Rewrite failed ({e}), keeping original")
        new_query = state["query"]
    return {
        **state,
        "query":         new_query,
        "rewrite_count": state.get("rewrite_count", 0) + 1,
    }


# ──────────────────────────────────────────────────────────────
# Node 4: Build context string
# ──────────────────────────────────────────────────────────────

def build_context_node(state: RAGState) -> RAGState:
    chunks = state["chunks"]
    parts  = []
    for h in chunks[:RERANK_TOP_N]:
        page_info = f"p.{h['page']}/{h['total_pages']}" if h.get("page") else ""
        label     = (
            f"[{h.get('type','text').upper()} | {h['source']} "
            f"{page_info} | chunk:{h['chunk_index']}]"
        )
        parts.append(f"{label}\n{h['text']}")
    return {**state, "final_context": "\n\n".join(parts)}


# ──────────────────────────────────────────────────────────────
# Routing
# ──────────────────────────────────────────────────────────────

def route_after_grading(state: RAGState) -> str:
    if state.get("needs_rewrite") and state.get("rewrite_count", 0) < MAX_REWRITES:
        return "rewrite"
    return "build_context"


# ──────────────────────────────────────────────────────────────
# Build graph
# ──────────────────────────────────────────────────────────────

def build_rag_graph():
    g = StateGraph(RAGState)
    g.add_node("retrieve",      retrieve_node)
    g.add_node("grade",         grade_chunks_node)
    g.add_node("rewrite",       rewrite_query_node)
    g.add_node("build_context", build_context_node)

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
    result = RAG_GRAPH.invoke({
        "query":          query,
        "original_query": query,   # keep original for short-query checks
        "filename":       filename,
        "chunks":         [],
        "rewrite_count":  0,
        "needs_rewrite":  False,
        "final_context":  "",
    })
    return result["chunks"], result["final_context"]