"""
sse.py — Centralized Server-Sent Events (SSE) utility for RAGBOT.
"""

import json
from typing import Any, Dict

def format_sse(event_type: str, data: Any) -> str:
    """
    Format standard data elements into SSE compatible chunks.
    Maintains 100% compatibility with legacy token/think_token/DONE and routing formats.
    """
    if event_type == "DONE":
        return "data: [DONE]\n\n"
    
    if isinstance(data, dict):
        # Enforce that dict data has a type field matching event_type (if applicable)
        if "type" not in data and event_type not in ("token", "think_token"):
            data = {"type": event_type, **data}
        return f"data: {json.dumps(data)}\n\n"
    
    # If standard text tokens, format cleanly
    if event_type in ("token", "think_token"):
        return f"data: {json.dumps({event_type: data})}\n\n"
    
    return f"data: {json.dumps({'type': event_type, 'data': data})}\n\n"

def format_claude_sse(event_type: str, data: Any = None) -> str:
    """
    Format SSE streams matching Claude's standard:
    event: message_start
    data: {"type": "message_start", ...}
    """
    if data is None:
        data = {}
        
    if isinstance(data, dict) and "type" not in data:
        data["type"] = event_type
        
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
