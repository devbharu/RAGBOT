"""
llm_service.py — Configurable LLM Registry, Retry Policies, and Concurrency Controls using LiteLLM.
"""

import os
import time
import threading
from typing import Dict, Any, Generator, Optional
import litellm
from utils.telemetry import logger

# Prefer LiteLLM's provider-qualified name, but honor the legacy OLLAMA_MODEL
# setting used by older local configs.
DEFAULT_MODEL = os.getenv("LLM_MODEL") or os.getenv("OLLAMA_MODEL") or "ollama/qwen3:4b"

class LLMService:
    _instance = None
    _report_semaphore = threading.Semaphore(1)

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(LLMService, cls).__new__(cls, *args, **kwargs)
            cls._instance._init_service()
        return cls._instance

    def _init_service(self):
        self.default_model = DEFAULT_MODEL
        self._token_lock = threading.Lock()
        self._usage: Dict[str, int] = {
            "prompt_tokens": 0,
            "eval_tokens": 0,
            "total_calls": 0,
        }
        
        # Configure LiteLLM globals
        litellm.drop_params = True # Ignore params that the provider doesn't support
        litellm.success_callback = [self._litellm_success_callback]
        
        logger.info(f"[LLM-SERVICE] Model registry initialized. Default Model: {self.default_model}")
        
    def _litellm_success_callback(self, kwargs, completion_response, start_time, end_time):
        """Callback to automatically record token usage from litellm responses"""
        try:
            if hasattr(completion_response, 'usage') and completion_response.usage:
                prompt_tokens = completion_response.usage.prompt_tokens
                eval_tokens = completion_response.usage.completion_tokens
                self.record_usage(prompt_tokens, eval_tokens)
        except Exception:
            pass
        
    def acquire_report_lock(self, timeout: float = 300.0) -> bool:
        """Acquire semaphore lock for running a heavy report generation."""
        logger.info("[LLM-SERVICE] Requesting lock for heavy report generation...")
        success = self._report_semaphore.acquire(timeout=timeout)
        if success:
            logger.info("[LLM-SERVICE] Lock acquired successfully for report.")
        else:
            logger.warn("[LLM-SERVICE] Failed to acquire lock for report generation (timed out).")
        return success

    def release_report_lock(self):
        """Release semaphore lock after report generation concludes."""
        self._report_semaphore.release()
        logger.info("[LLM-SERVICE] Lock released for report generation.")

    def record_usage(self, prompt_tokens: int = 0, eval_tokens: int = 0):
        """Thread-safely record token consumption."""
        with self._token_lock:
            self._usage["prompt_tokens"] += prompt_tokens
            self._usage["eval_tokens"] += eval_tokens
            self._usage["total_calls"] += 1

    def get_usage(self) -> Dict[str, int]:
        """Return a snapshot of cumulative token usage since server start."""
        with self._token_lock:
            return {
                **self._usage,
                "total_tokens": self._usage["prompt_tokens"] + self._usage["eval_tokens"],
            }

    def reset_usage(self):
        """Reset all token counters."""
        with self._token_lock:
            self._usage = {"prompt_tokens": 0, "eval_tokens": 0, "total_calls": 0}

    def chat(self, payload: Dict[str, Any], max_retries: int = 4, initial_backoff: float = 3.0):
        """
        Executes a blocking chat request using LiteLLM.
        """
        model = payload.get("model", self.default_model)
        messages = payload.get("messages", [])
        
        # Extract options
        kwargs = {}
        if "options" in payload:
            kwargs.update(payload["options"])
            
        if "tools" in payload:
            kwargs["tools"] = payload["tools"]
            
        logger.info(f"[LLM-SERVICE] Sending litellm chat request (model: {model})")
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key

        nvidia_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_NIM_API_KEY")
        if nvidia_key and ("nvidia" in model or "deepseek" in model):
            os.environ["NVIDIA_NIM_API_KEY"] = nvidia_key
            if not model.startswith("nvidia_nim/"):
                model = f"nvidia_nim/{model.replace('openai/', '')}"


        kwargs.setdefault("max_tokens", 4096)
        
        try:
            # Note: litellm natively handles retries with num_retries
            response = litellm.completion(
                model=model,
                messages=messages,
                num_retries=max_retries,
                **kwargs
            )
            return response
        except Exception as e:
            logger.error(f"[LLM-SERVICE] Chat failed: {e}")
            raise

    def generate(self, payload: Dict[str, Any], max_retries: int = 4, initial_backoff: float = 3.0):
        """
        Executes a blocking generate request.
        Translates a prompt payload into messages for LiteLLM.
        """
        model = payload.get("model", self.default_model)
        
        messages = []
        if "prompt" in payload:
            messages = [{"role": "user", "content": payload["prompt"]}]
        elif "messages" in payload:
            messages = payload["messages"]
            
        kwargs = {}
        if "options" in payload:
            kwargs.update(payload["options"])
            
        logger.info(f"[LLM-SERVICE] Sending litellm generate request (model: {model})")
        
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key

        nvidia_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_NIM_API_KEY")
        if nvidia_key and ("nvidia" in model or "deepseek" in model):
            os.environ["NVIDIA_NIM_API_KEY"] = nvidia_key
            if not model.startswith("nvidia_nim/"):
                model = f"nvidia_nim/{model.replace('openai/', '')}"


        kwargs.setdefault("max_tokens", 4096)
        
        try:
            response = litellm.completion(
                model=model,
                messages=messages,
                num_retries=max_retries,
                **kwargs
            )
            return response
        except Exception as e:
            logger.error(f"[LLM-SERVICE] Generate failed: {e}")
            raise

    def stream_chat(self, payload: Dict[str, Any], max_retries: int = 4, initial_backoff: float = 3.0):
        """
        Starts a streaming request for LLM chat completions using LiteLLM.
        Returns a Generator yielding litellm ModelResponse chunks.
        """
        model = payload.get("model", self.default_model)
        messages = payload.get("messages", [])
        
        kwargs = {}
        if "options" in payload:
            kwargs.update(payload["options"])
            
        logger.info(f"[LLM-SERVICE] Initiating litellm streaming chat (model: {model})...")
        
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key
        api_base = os.getenv("OLLAMA_API_BASE") or os.getenv("OLLAMA_HOST")
        api_key = os.getenv("OLLAMA_API_KEY")

        if api_base and model.startswith("ollama/"):
            kwargs["api_base"] = api_base
        if api_key and model.startswith("ollama/"):
            kwargs["api_key"] = api_key

        nvidia_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_NIM_API_KEY")
        if nvidia_key and ("nvidia" in model or "deepseek" in model):
            os.environ["NVIDIA_NIM_API_KEY"] = nvidia_key
            if not model.startswith("nvidia_nim/"):
                model = f"nvidia_nim/{model.replace('openai/', '')}"


        kwargs.setdefault("max_tokens", 4096)
        
        try:
            response_stream = litellm.completion(
                model=model,
                messages=messages,
                stream=True,
                num_retries=max_retries,
                **kwargs
            )
            return response_stream
        except Exception as e:
            logger.error(f"[LLM-SERVICE] Streaming request failed: {e}")
            raise
