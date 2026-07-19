"""
telemetry.py — Structured logging and timing telemetry for RAGBOT.
"""

import os
import time
import logging
from functools import wraps
from logging.handlers import RotatingFileHandler

# Create logs directory if not exists
os.makedirs("logs", exist_ok=True)

logger = logging.getLogger("ragbot")
logger.setLevel(logging.INFO)

# Setup file handler (Rotating)
file_handler = RotatingFileHandler("logs/app.log", maxBytes=10*1024*1024, backupCount=5)
file_handler.setFormatter(logging.Formatter(
    '[%(asctime)s] %(levelname)s [%(name)s:%(filename)s:%(lineno)d] - %(message)s'
))

# Setup console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter(
    '[%(levelname)s] (%(filename)s:%(lineno)d) - %(message)s'
))

logger.addHandler(file_handler)
logger.addHandler(console_handler)

def time_telemetry(name: str):
    """Decorator to measure and log the execution time of functions."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.time()
            logger.info(f"[TELEMETRY] Starting operation: {name}")
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start
                logger.info(f"[TELEMETRY] Finished operation: {name} in {duration:.4f}s")
                return result
            except Exception as e:
                duration = time.time() - start
                logger.error(f"[TELEMETRY] Failed operation: {name} after {duration:.4f}s with error: {e}")
                raise
        return wrapper
    return decorator
