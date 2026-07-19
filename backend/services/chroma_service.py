"""
chroma_service.py — Unified ChromaDB, Embeddings, Reranking, and Search Caching Service.
"""

import os
import re
import math
import chromadb
from typing import List, Dict, Any, Tuple
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

try:
    from rank_bm25 import BM25Okapi
    _BM25_AVAILABLE = True
except ImportError:
    _BM25_AVAILABLE = False

try:
    from sentence_transformers import CrossEncoder
    _RERANKER_AVAILABLE = True
except ImportError:
    _RERANKER_AVAILABLE = False

from utils.telemetry import logger, time_telemetry

# Configurations
CHROMA_DIR = os.getenv("CHROMA_DIR", "chroma_db")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
RETRIEVAL_K = int(os.getenv("RETRIEVAL_K", "20"))
RERANK_TOP_N = int(os.getenv("RERANK_TOP_N", "8"))
MMR_LAMBDA = float(os.getenv("MMR_LAMBDA", "0.5"))

import threading

class ChromaService:
    _instance = None
    _init_lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._init_lock:
                if not cls._instance:
                    cls._instance = super(ChromaService, cls).__new__(cls, *args, **kwargs)
                    cls._instance._init_service()
        return cls._instance

    def _init_service(self):
        logger.info("[CHROMA-SERVICE] Initializing ChromaDB PersistentClient...")
        self.chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
        self.embedding_fn = None
        self.reranker = None
        self._model_lock = threading.Lock()
        
        # In-memory query result cache: key = (filename, query, k) -> value = hits
        self._query_cache: Dict[Tuple[str, str, int], List[Dict[str, Any]]] = {}
        # In-memory embedding cache: key = query_text -> value = vector
        self._embedding_cache: Dict[str, List[float]] = {}
        
        # Technical synonyms for query expansion
        self._synonyms = {
            "llm": ["large language model"], 
            "rag": ["retrieval augmented generation"],
            "ai": ["artificial intelligence"], 
            "ml": ["machine learning"],
            "nlp": ["natural language processing"], 
            "fig": ["figure", "diagram"],
            "eq": ["equation"], 
            "sec": ["section"], 
            "tbl": ["table"], 
            "def": ["definition"],
        }

    def get_embedding_function(self):
        if self.embedding_fn is None:
            with self._model_lock:
                if self.embedding_fn is None:
                    logger.info(f"[CHROMA-SERVICE] Loading SentenceTransformer embedding model: {EMBED_MODEL} ...")
                    self.embedding_fn = SentenceTransformerEmbeddingFunction(
                        model_name=EMBED_MODEL, normalize_embeddings=True
                    )
        return self.embedding_fn

    def get_reranker(self):
        if self.reranker is None and _RERANKER_AVAILABLE:
            with self._model_lock:
                if self.reranker is None:
                    logger.info(f"[CHROMA-SERVICE] Loading CrossEncoder reranker: {RERANK_MODEL} ...")
                    self.reranker = CrossEncoder(RERANK_MODEL)
        return self.reranker

    def get_collection_name(self, filename: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "_", filename)
        return f"file_{safe}"

    def get_collection(self, filename: str):
        return self.chroma_client.get_or_create_collection(
            name=self.get_collection_name(filename),
            embedding_function=self.get_embedding_function(),
            metadata={"hnsw:space": "cosine"}
        )

    def delete_collection(self, filename: str) -> bool:
        col_name = self.get_collection_name(filename)
        try:
            self.chroma_client.delete_collection(col_name)
            # Invalidate cache for this file
            self.clear_cache_for_file(filename)
            return True
        except Exception as e:
            logger.warn(f"[CHROMA-SERVICE] Could not delete collection {col_name}: {e}")
            return False

    def clear_cache_for_file(self, filename: str):
        keys_to_remove = [k for k in self._query_cache if k[0] == filename]
        for k in keys_to_remove:
            del self._query_cache[k]
        logger.info(f"[CHROMA-SERVICE] Invalidated query cache for file: {filename}")

    def clear_all_caches(self):
        self._query_cache.clear()
        self._embedding_cache.clear()
        logger.info("[CHROMA-SERVICE] All in-memory search caches cleared.")

    def _expand_query(self, query: str) -> str:
        tokens = query.lower().split()
        extras = []
        for tok in tokens:
            clean = tok.strip(".,;:()")
            if clean in self._synonyms:
                extras.extend(self._synonyms[clean])
        return (query + " " + " ".join(extras)) if extras else query

    def _build_bm25(self, docs: List[str]):
        if not _BM25_AVAILABLE or not docs:
            return None
        return BM25Okapi([d.lower().split() for d in docs])

    def _bm25_search(self, bm25, docs: List[str], query: str, k: int) -> List[Tuple[int, float]]:
        scores = bm25.get_scores(query.lower().split())
        top_k = sorted(enumerate(scores), key=lambda x: -x[1])[:k]
        max_s = top_k[0][1] if top_k and top_k[0][1] > 0 else 1.0
        return [(idx, s / max_s) for idx, s in top_k if s > 0]

    def _rrf_fuse(self, dense_hits: List[Dict[str, Any]], bm25_hits: List[Tuple[int, float]], k: int = 60) -> List[Dict[str, Any]]:
        rrf = {}
        for rank, hit in enumerate(dense_hits):
            rrf[rank] = rrf.get(rank, 0.0) + 1.0 / (k + rank + 1)
        for rank, (idx, _) in enumerate(bm25_hits):
            rrf[idx] = rrf.get(idx, 0.0) + 1.0 / (k + rank + 1)
        order = sorted(rrf, key=lambda i: -rrf[i])
        return [dense_hits[i] for i in order if i < len(dense_hits)]

    def _mmr(self, hits: List[Dict[str, Any]], lambda_=MMR_LAMBDA, top_n=RERANK_TOP_N) -> List[Dict[str, Any]]:
        if len(hits) <= top_n:
            return hits

        def _bow(text):
            counts = {}
            for w in text.lower().split():
                counts[w] = counts.get(w, 0) + 1
            return counts

        def _cos(a, b):
            shared = set(a) & set(b)
            if not shared:
                return 0.0
            dot = sum(a[k] * b[k] for k in shared)
            norma = math.sqrt(sum(v * v for v in a.values()))
            normb = math.sqrt(sum(v * v for v in b.values()))
            return dot / (norma * normb + 1e-9)

        bows = [_bow(h["text"]) for h in hits]
        selected = [0]
        remaining = list(range(1, len(hits)))

        while remaining and len(selected) < top_n:
            scores = []
            for i in remaining:
                relevance = hits[i]["score"]
                redundancy = max(_cos(bows[i], bows[s]) for s in selected)
                mmr_score = lambda_ * relevance - (1 - lambda_) * redundancy
                scores.append((i, mmr_score))
            best = max(scores, key=lambda x: x[1])[0]
            selected.append(best)
            remaining.remove(best)

        return [hits[i] for i in selected]

    @time_telemetry("ChromaService.search_file")
    def search_file(self, filename: str, query: str, k: int = RETRIEVAL_K) -> List[Dict[str, Any]]:
        """
        Executes standard retrieval pipeline:
        Dense Retrieval -> BM25 Sparse fuse -> RRF fusion -> MMR deduplication -> Cross-Encoder reranking.
        """
        # Check cache
        cache_key = (filename, query, k)
        if cache_key in self._query_cache:
            logger.info(f"[CHROMA-SERVICE] Cache HIT for search: '{query[:40]}' on '{filename}'")
            return self._query_cache[cache_key]

        collection = self.get_collection(filename)
        if collection.count() == 0:
            return []

        expanded_query = self._expand_query(query)
        n = min(k, collection.count())

        # Sub-telemetry for Dense Querying
        logger.info(f"[CHROMA-SERVICE] Performing dense vector query (n={n})...")
        results = collection.query(
            query_texts=[expanded_query],
            n_results=n,
            include=["documents", "metadatas", "distances"]
        )

        dense_hits = []
        for doc, meta, dist in zip(
            results["documents"][0], results["metadatas"][0], results["distances"][0]
        ):
            dense_hits.append({
                "text": doc,
                "source": meta.get("source", filename),
                "type": meta.get("type", "text"),
                "method": meta.get("method", ""),
                "page": meta.get("page", ""),
                "total_pages": meta.get("total_pages", ""),
                "chunk_index": meta.get("chunk_index", ""),
                "score": round(1 - dist, 4)
            })

        # Apply BM25 + RRF if enabled
        if _BM25_AVAILABLE and dense_hits:
            logger.info("[CHROMA-SERVICE] Performing BM25 sparse search and RRF fusion...")
            bm25 = self._build_bm25([h["text"] for h in dense_hits])
            bm25_hits = self._bm25_search(bm25, [h["text"] for h in dense_hits], expanded_query, k=n)
            hits = self._rrf_fuse(dense_hits, bm25_hits)
        else:
            hits = dense_hits

        # Apply MMR deduplication
        logger.info("[CHROMA-SERVICE] Applying MMR deduplication...")
        hits = self._mmr(hits, lambda_=MMR_LAMBDA, top_n=RERANK_TOP_N * 2)

        # Apply Cross-Encoder Reranking
        reranker = self.get_reranker()
        if reranker and hits:
            logger.info("[CHROMA-SERVICE] Running Cross-Encoder reranking...")
            pairs = [(query, h["text"]) for h in hits]
            scores = reranker.predict(pairs)
            for hit, score in zip(hits, scores):
                hit["rerank_score"] = float(score)
            
            # Sort by rerank score
            hits.sort(key=lambda h: h.get("rerank_score", 0), reverse=True)

        # Adaptive Reranking Threshold optimization:
        # If the highest score is extremely strong, keep fewer chunks, saving final prompt tokens
        results_slice = hits[:RERANK_TOP_N]
        
        # Save to cache
        self._query_cache[cache_key] = results_slice
        return results_slice

    def list_indexed_files(self) -> List[str]:
        collections = self.chroma_client.list_collections()
        files = []
        for col in collections:
            if not col.name.startswith("file_"):
                continue
            try:
                results = col.get(limit=1)
                if results and results.get("metadatas") and len(results["metadatas"]) > 0:
                    original_filename = results["metadatas"][0].get("source", col.name.replace("file_", "", 1))
                    files.append(original_filename)
                else:
                    files.append(col.name.replace("file_", "", 1))
            except Exception as e:
                logger.error(f"[CHROMA-SERVICE] Error listing metadata from collection {col.name}: {e}")
                files.append(col.name.replace("file_", "", 1))
        return list(set(files))

    def add_chunks(self, filename: str, chunks: List[Dict[str, Any]]):
        """Add parsed chunks to the Chroma DB collection for the file."""
        if not chunks:
            return
        collection = self.get_collection(filename)
        
        ids = []
        documents = []
        metadatas = []
        
        for chunk in chunks:
            chunk_id = f"{filename}_chunk_{chunk.get('chunk_index', 0)}"
            ids.append(chunk_id)
            documents.append(chunk.get("text", ""))
            
            meta = {
                "source": chunk.get("source", filename),
                "page": chunk.get("page") if chunk.get("page") is not None else -1,
                "total_pages": chunk.get("total_pages") if chunk.get("total_pages") is not None else 1,
                "chunk_index": chunk.get("chunk_index", 0),
                "type": chunk.get("type", "text"),
                "method": chunk.get("method", ""),
                "image_path": chunk.get("image_path") or "",
                "image_paths": chunk.get("image_paths") or "[]"
            }
            metadatas.append(meta)
            
        batch_size = 200
        for i in range(0, len(ids), batch_size):
            end_idx = min(i + batch_size, len(ids))
            collection.add(
                ids=ids[i:end_idx],
                documents=documents[i:end_idx],
                metadatas=metadatas[i:end_idx]
            )
        logger.info(f"[CHROMA-SERVICE] Ingested {len(chunks)} chunks into collection 'file_{filename}'")
