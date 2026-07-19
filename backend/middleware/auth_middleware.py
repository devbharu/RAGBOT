"""
auth_middleware.py — Decoupled authentication and ownership validation middleware.
"""

from functools import wraps
from typing import Optional
from flask import g, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from repositories.chat_repository import ChatRepository
from repositories.user_repository import UserRepository
from utils.telemetry import logger

def _normalize_user_id(raw_identity) -> Optional[int]:
    if raw_identity is None:
        return None
    try:
        return int(raw_identity)
    except Exception:
        return None

def jwt_and_user_required():
    """
    Decorator to enforce valid JWT authentication,
    populating Flask's globals `g.user_id` and `g.user`.
    """
    def decorator(func):
        @wraps(func)
        @jwt_required()
        def wrapper(*args, **kwargs):
            try:
                identity = get_jwt_identity()
                user_id = _normalize_user_id(identity)
                if not user_id:
                    return jsonify({"error": "Invalid user identity in token"}), 401
                
                # Fetch user
                user = UserRepository.get_by_id(user_id)
                if not user:
                    return jsonify({"error": "User no longer exists"}), 401
                
                # Store in context globals
                g.user_id = user_id
                g.user = user
                
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(f"[AUTH-MIDDLEWARE] JWT validation exception: {e}")
                return jsonify({"error": f"Authentication validation failed: {e}"}), 401
        return wrapper
    return decorator

def chat_owner_required():
    """
    Decorator that checks chat ownership.
    Assumes `jwt_and_user_required` has already been run or is run in tandem.
    Looks for `chat_id` in route arguments.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user_id = getattr(g, 'user_id', None)
            if not user_id:
                return jsonify({"error": "Authentication context missing"}), 401
            
            chat_id = kwargs.get('chat_id')
            if not chat_id:
                # Check request JSON if not in route
                data = request.get_json(silent=True) or {}
                chat_id = data.get('chat_id')
            
            if chat_id:
                try:
                    chat = ChatRepository.get_chat_by_id(int(chat_id), user_id)
                    if not chat:
                        logger.warn(f"[AUTH-MIDDLEWARE] User {user_id} denied access to chat {chat_id} (Forbidden)")
                        return jsonify({"error": "Access to chat is forbidden"}), 403
                    g.chat = chat
                except ValueError:
                    return jsonify({"error": "Invalid chat_id format"}), 400
                except Exception as e:
                    logger.error(f"[AUTH-MIDDLEWARE] Ownership check crashed: {e}")
                    return jsonify({"error": "Ownership validation error"}), 500
                    
            return func(*args, **kwargs)
        return wrapper
    return decorator

def validate_file_ownership(filename: str, user_id: int) -> bool:
    """
    Determines if the active user owns the given filename.
    User-uploaded files are prefixed with '<user_id>_'.
    Public default documents in `rag_docs/` do not have user prefixes and are readable by all.
    """
    # Verify prefix
    parts = filename.split('_', 1)
    if len(parts) > 1 and parts[0].isdigit():
        file_owner_id = int(parts[0])
        return file_owner_id == user_id
        
    # If no numeric prefix, it is treated as a public system file
    return True
