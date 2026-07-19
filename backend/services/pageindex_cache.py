"""
pageindex_cache.py — In-Memory Memoization and Cache Layer for PageIndex Search and Trees.
"""

import os
import json
import hashlib
from typing import Dict, Any, List, Optional, Tuple
from utils.telemetry import logger

class PageIndexCache:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(PageIndexCache, cls).__new__(cls, *args, **kwargs)
            cls._instance._init_cache()
        return cls._instance

    def _init_cache(self):
        # In-memory page tree cache: filename -> tree dict
        self._tree_cache: Dict[str, Dict[str, Any]] = {}
        # In-memory chunk map cache: filename -> chunks list
        self._chunks_cache: Dict[str, List[Dict[str, Any]]] = {}
        # In-memory LLM routing memoization cache: (query_hash, node_type, nodes_hash) -> selected_node_ids list
        self._routing_cache: Dict[Tuple[str, str, str], List[str]] = {}
        logger.info("[PAGEINDEX-CACHE] In-memory PageIndex visual cache successfully initialized.")

    def get_tree(self, filename: str) -> Optional[Dict[str, Any]]:
        """Fetch tree from cache if exists."""
        return self._tree_cache.get(filename)

    def set_tree(self, filename: str, tree: Dict[str, Any]):
        """Store tree in cache."""
        self._tree_cache[filename] = tree
        logger.info(f"[PAGEINDEX-CACHE] Tree cached for file: {filename}")

    def get_chunks(self, filename: str) -> Optional[List[Dict[str, Any]]]:
        """Fetch chunks from cache if exists."""
        return self._chunks_cache.get(filename)

    def set_chunks(self, filename: str, chunks: List[Dict[str, Any]]):
        """Store chunks in cache."""
        self._chunks_cache[filename] = chunks
        logger.info(f"[PAGEINDEX-CACHE] Chunks cached for file: {filename} ({len(chunks)} items)")

    def clear_cache_for_file(self, filename: str):
        """Evict tree and chunk items for a deleted or reindexed file."""
        if filename in self._tree_cache:
            del self._tree_cache[filename]
        if filename in self._chunks_cache:
            del self._chunks_cache[filename]
        
        # Evict related routing caches
        keys_to_remove = []
        for k in self._routing_cache:
            # We don't store filename inside routing cache key, but we can clear all routing when a file updates
            # or keep it as is. Let's clear all routing just to be safe.
            pass
        self._routing_cache.clear()
        logger.info(f"[PAGEINDEX-CACHE] Evicted caching registry for: {filename}")

    def _compute_nodes_hash(self, nodes_list: List[Dict[str, Any]]) -> str:
        """Helper to create a deterministic hash of available navigation node IDs."""
        node_ids = sorted([n["node_id"] for n in nodes_list])
        serial = ",".join(node_ids)
        return hashlib.md5(serial.encode("utf-8")).hexdigest()

    def get_routing(self, query: str, node_type: str, nodes_list: List[Dict[str, Any]]) -> Optional[List[str]]:
        """Retrieve memoized routing decision."""
        query_hash = hashlib.md5(query.strip().lower().encode("utf-8")).hexdigest()
        nodes_hash = self._compute_nodes_hash(nodes_list)
        key = (query_hash, node_type, nodes_hash)
        
        selected = self._routing_cache.get(key)
        if selected is not None:
            logger.info(f"[PAGEINDEX-CACHE] Memoized routing HIT for type '{node_type}' with query: '{query[:30]}'")
        return selected

    def set_routing(self, query: str, node_type: str, nodes_list: List[Dict[str, Any]], selected_ids: List[str]):
        """Memoize a routing decision."""
        query_hash = hashlib.md5(query.strip().lower().encode("utf-8")).hexdigest()
        nodes_hash = self._compute_nodes_hash(nodes_list)
        key = (query_hash, node_type, nodes_hash)
        self._routing_cache[key] = selected_ids
        logger.info(f"[PAGEINDEX-CACHE] Memoized routing cached: '{query[:30]}' -> {selected_ids}")
