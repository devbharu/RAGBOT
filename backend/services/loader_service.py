"""
loader_service.py — Coordinate document ingestion, caching, and resumable loader checkpoints.
"""

import os
import json
import asyncio
from typing import List, Dict, Any, Optional
from services.docling_loader import load_single_file_async
from services.pageindex_cache import PageIndexCache
from utils.telemetry import logger, time_telemetry

class LoaderService:
    _instance = None
    
    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(LoaderService, cls).__new__(cls, *args, **kwargs)
            cls._instance._init_service()
        return cls._instance

    def _init_service(self):
        self.cache_service = PageIndexCache()
        # Ingestion progress registry: filename -> dict(status, progress)
        self._checkpoints: Dict[str, Dict[str, Any]] = {}
        logger.info("[LOADER-SERVICE] Loader Ingestion Service initialized.")

    def set_checkpoint(self, filename: str, status: str, progress: float, error: str = ""):
        self._checkpoints[filename] = {
            "status": status,
            "progress": progress,
            "error": error
        }
        logger.info(f"[LOADER-SERVICE] Checkpoint updated for '{filename}': status={status}, progress={progress:.2f}")

    def get_checkpoint(self, filename: str) -> Optional[Dict[str, Any]]:
        return self._checkpoints.get(filename)

    @time_telemetry("LoaderService.load_file")
    async def load_file(self, filepath: str, filename: str, force: bool = False) -> List[Dict[str, Any]]:
        """
        Ingests a PDF or TXT document using the fast thread-based fitz loader.
        Leverages memoized PageIndexCache to bypass repetitive JSON disk reading.
        """
        # Check in-memory chunks cache first
        if not force:
            cached_chunks = self.cache_service.get_chunks(filename)
            if cached_chunks:
                logger.info(f"[LOADER-SERVICE] Memory-cache HIT for chunks of '{filename}'")
                return cached_chunks

        # Resumable ingestion check: if cache on disk exists, we skip processing
        cache_path = filepath + ".chunks.json"
        if not force and os.path.exists(cache_path):
            logger.info(f"[LOADER-SERVICE] Found on-disk chunks cache for '{filename}'. Loading...")
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                chunks = data.get("chunks", [])
                if chunks:
                    self.cache_service.set_chunks(filename, chunks)
                    # Sync to Chroma if empty
                    from services.chroma_service import ChromaService
                    chroma_service = ChromaService()
                    try:
                        col = chroma_service.get_collection(filename)
                        if col.count() == 0:
                            logger.info(f"[LOADER-SERVICE] Chroma collection empty for '{filename}'. Populating from cache...")
                            chroma_service.add_chunks(filename, chunks)
                    except Exception as ce:
                        logger.warn(f"[LOADER-SERVICE] Chroma cache loading verification failed: {ce}")
                    return chunks
            except Exception as e:
                logger.warn(f"[LOADER-SERVICE] Failed to read disk cache for '{filename}': {e}. Re-ingesting...")

        self.set_checkpoint(filename, "indexing", 0.1)
        
        try:
            logger.info(f"[LOADER-SERVICE] Starting full parallel text ingestion on '{filepath}'...")
            chunks = await load_single_file_async(filepath, filename)
            
            # Cache in memory
            if chunks:
                self.cache_service.set_chunks(filename, chunks)
                
                # Ingest to Chroma DB collection
                from services.chroma_service import ChromaService
                chroma_service = ChromaService()
                try:
                    chroma_service.delete_collection(filename)
                    chroma_service.add_chunks(filename, chunks)
                except Exception as ce:
                    logger.error(f"[LOADER-SERVICE] Chroma indexing failed: {ce}")
            
            self.set_checkpoint(filename, "ready", 1.0)
            return chunks
        except Exception as e:
            logger.error(f"[LOADER-SERVICE] Ingestion failed for '{filename}': {e}")
            self.set_checkpoint(filename, "error", 0.0, str(e))
            raise
