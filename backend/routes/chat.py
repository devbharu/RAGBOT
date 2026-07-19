"""
chat.py — Blueprint for chat sessions, message histories, and standard RAG chat streaming.
"""

import json
from flask import Blueprint, request, jsonify, Response, stream_with_context, g, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from repositories.chat_repository import ChatRepository
from middleware.auth_middleware import jwt_and_user_required, chat_owner_required, _normalize_user_id
from streaming.chat_streamer import stream_chat_response, generate_chat_title
from streaming.task_manager import task_manager, run_generator_in_background
from utils.telemetry import logger

chat_bp = Blueprint('chat', __name__)

def _parse_sse_payload(chunk: str):
    """Extract a JSON data payload from either plain or event-named SSE chunks."""
    if not chunk:
        return None
    for line in chunk.splitlines():
        if not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if not data or data == "[DONE]":
            return None
        try:
            return json.loads(data)
        except Exception:
            return None
    return None

@chat_bp.route("/chat", methods=["POST"])
@jwt_and_user_required()
def create_chat():
    """Create a new empty chat history record."""
    try:
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "New Chat").strip()[:255] or "New Chat"
        chat = ChatRepository.create_chat(g.user_id, title)
        return jsonify({"chat": chat.to_dict()}), 201
    except Exception as e:
        logger.error(f"[CHAT-ROUTES] Failed to create chat: {e}")
        return jsonify({"error": "Failed to create chat"}), 500

@chat_bp.route("/chats", methods=["GET"])
@jwt_and_user_required()
def list_chats():
    """List all chat history records for the current user."""
    try:
        chats = ChatRepository.get_user_chats(g.user_id)
        return jsonify({"chats": [c.to_dict() for c in chats]}), 200
    except Exception as e:
        logger.error(f"[CHAT-ROUTES] Failed to list chats: {e}")
        return jsonify({"error": "Failed to retrieve chat histories"}), 500

@chat_bp.route("/chat/<int:chat_id>", methods=["GET"])
@jwt_and_user_required()
@chat_owner_required()
def get_chat(chat_id: int):
    """Fetch all messages for an owned chat session."""
    try:
        messages = ChatRepository.get_chat_messages(chat_id)
        msg_dicts = []
        for m in messages:
            m_dict = m.to_dict()
            if m_dict.get("extra_data"):
                try:
                    extra = json.loads(m_dict["extra_data"]) if isinstance(m_dict["extra_data"], str) else m_dict["extra_data"]
                    if extra.get("status") == "running" and "task_id" in extra:
                        task = task_manager.get_task(extra["task_id"])
                        if task:
                            live_events = []
                            with task["lock"]:
                                for chunk in task["chunks"]:
                                    event_data = _parse_sse_payload(chunk)
                                    if event_data:
                                        live_events.append(event_data)
                            extra["events"] = live_events
                            m_dict["extra_data"] = json.dumps(extra)
                except Exception as ex:
                    logger.error(f"[CHAT-ROUTES] Error hydrating live events: {ex}")
            msg_dicts.append(m_dict)
            
        return jsonify({
            "chat": g.chat.to_dict(),
            "messages": msg_dicts
        }), 200
    except Exception as e:
        logger.error(f"[CHAT-ROUTES] Failed to fetch chat {chat_id}: {e}")
        return jsonify({"error": "Failed to retrieve chat session"}), 500

@chat_bp.route("/chat/<int:chat_id>", methods=["DELETE"])
@jwt_and_user_required()
@chat_owner_required()
def delete_chat(chat_id: int):
    """Permanently delete an owned chat session."""
    try:
        ChatRepository.delete_chat(g.chat)
        return jsonify({"status": "deleted", "chat_id": chat_id}), 200
    except Exception as e:
        logger.error(f"[CHAT-ROUTES] Failed to delete chat {chat_id}: {e}")
        return jsonify({"error": "Failed to delete chat"}), 500

@chat_bp.route("/generate", methods=["POST"])
@jwt_and_user_required()
def chat_generate():
    """
    POST /generate
    RAG chat generation and token streaming (SSE).
    Generates dynamic sidebar title on the first message sent.
    """
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    data = request.json or {}
    prompt = data.get("prompt", "")
    filename = data.get("filename", None)
    chat_id = data.get("chat_id", None)
    
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400
        
    scope = data.get("scope", "active")
    if scope == "active" and not filename:
        scope = "all"
        data["scope"] = "all"
        
    user_id = getattr(g, "user_id", None)
    
    resolved_chat_id = chat_id
    new_title_to_send = None

    if user_id:
        if resolved_chat_id:
            # Verify chat ownership
            chat = ChatRepository.get_chat_by_id(resolved_chat_id, user_id)
            if not chat:
                return jsonify({"error": "Chat not found"}), 404
            
            messages = ChatRepository.get_chat_messages(resolved_chat_id)
            if not messages:
                ai_title = generate_chat_title(prompt)
                ChatRepository.update_chat_title(resolved_chat_id, user_id, ai_title)
                new_title_to_send = ai_title
        else:
            ai_title = generate_chat_title(prompt)
            new_chat = ChatRepository.create_chat(user_id, ai_title)
            resolved_chat_id = new_chat.id
            new_title_to_send = ai_title
            
        # Store user query message first
        ChatRepository.save_message(resolved_chat_id, "user", prompt)

    task_id = task_manager.create_task()
    
    # Create placeholder for reconnection
    placeholder_msg_id = None
    if user_id and resolved_chat_id:
        extra_data = json.dumps({"status": "running", "task_id": task_id})
        placeholder_msg = ChatRepository.save_message(resolved_chat_id, "assistant", "", extra_data=extra_data)
        if placeholder_msg:
            placeholder_msg_id = placeholder_msg.id

    def sse_stream_wrapper():
        if user_id and new_title_to_send:
            rename_payload = {
                'type': 'chat_renamed',
                'chat_id': resolved_chat_id,
                'new_title': new_title_to_send
            }
            yield f"data: {json.dumps(rename_payload)}\n\n"
            
        stream = stream_chat_response(
            query=prompt,
            filename=filename,
            chat_id=resolved_chat_id,
            user_id=user_id,
            params={
                "temperature": data.get("temperature", 0.4),
                "max_output_tokens": data.get("max_output_tokens", 1024),
                "top_p": data.get("top_p", 0.9),
                "search_mode": data.get("search_mode", "vector"),
                "scope": data.get("scope", "active"),
                "tree_mode": data.get("tree_mode", "tree"),
            },
            message_id=placeholder_msg_id
        )
        for chunk in stream:
            yield chunk

    run_generator_in_background(current_app._get_current_object(), task_id, sse_stream_wrapper)

    return jsonify({
        "status": "running",
        "task_id": task_id
    }), 201

@chat_bp.route("/chat/stream/<task_id>", methods=["GET"])
def chat_stream(task_id):
    task = task_manager.get_task(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
        
    def generate():
        # Yield an 8KB comment to guarantee Nginx/WSGI buffers flush immediately
        yield f": {' ' * 8192}\n\n"
        try:
            for chunk in task_manager.iter_chunks(task_id):
                if chunk.startswith("ERROR:"):
                    yield f"data: {json.dumps({'type': 'error', 'message': chunk[6:]})}\n\n"
                    continue
                yield chunk
            yield "data: [DONE]\n\n"
        finally:
            t = task_manager.get_task(task_id)
            if t and t.get("done"):
                task_manager.cleanup_task(task_id)
            
    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )
