"""
chat_repository.py — Database repository for Chats and Messages database mutations.
"""

from typing import List, Optional
from models import db, Chat, Message
from utils.telemetry import logger

class ChatRepository:
    @staticmethod
    def get_user_chats(user_id: int) -> List[Chat]:
        """Fetch all chats belonging to a user, ordered by creation date desc."""
        try:
            return Chat.query.filter_by(user_id=user_id).order_by(Chat.created_at.desc()).all()
        except Exception as e:
            logger.error(f"[DB] Error fetching user chats for {user_id}: {e}")
            raise

    @staticmethod
    def get_chat_by_id(chat_id: int, user_id: int) -> Optional[Chat]:
        """Fetch a specific chat, validating it belongs to the given user."""
        try:
            return Chat.query.filter_by(id=chat_id, user_id=user_id).first()
        except Exception as e:
            logger.error(f"[DB] Error fetching chat {chat_id} for {user_id}: {e}")
            raise

    @staticmethod
    def create_chat(user_id: int, title: str) -> Chat:
        """Create a new chat session."""
        try:
            chat = Chat(user_id=user_id, title=title)
            db.session.add(chat)
            db.session.commit()
            return chat
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error creating chat for {user_id} with title {title}: {e}")
            raise

    @staticmethod
    def delete_chat(chat: Chat) -> None:
        """Permanently delete a chat and all its nested messages."""
        try:
            db.session.delete(chat)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error deleting chat {chat.id}: {e}")
            raise

    @staticmethod
    def get_chat_messages(chat_id: int) -> List[Message]:
        """Fetch all messages for a chat, sorted chronologically."""
        try:
            return Message.query.filter_by(chat_id=chat_id).order_by(Message.timestamp.asc()).all()
        except Exception as e:
            logger.error(f"[DB] Error fetching messages for chat {chat_id}: {e}")
            raise

    @staticmethod
    def save_message(chat_id: int, role: str, content: str, extra_data: str = None) -> Optional[Message]:
        """Save a new chat message under the active chat session."""
        if not chat_id or (not content.strip() and not extra_data):
            return None
        try:
            message = Message(chat_id=chat_id, role=role, content=content.strip(), extra_data=extra_data)
            db.session.add(message)
            db.session.commit()
            return message
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error saving message to chat {chat_id} (role={role}): {e}")
            raise

    @staticmethod
    def update_chat_title(chat_id: int, user_id: int, new_title: str) -> Optional[Chat]:
        """Update a chat's sidebar title."""
        chat = ChatRepository.get_chat_by_id(chat_id, user_id)
        if not chat:
            return None
        try:
            chat.title = new_title[:255]
            db.session.commit()
            return chat
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error updating title for chat {chat_id}: {e}")
            raise

    @staticmethod
    def update_message(message_id: int, content: str, extra_data: str = None) -> Optional[Message]:
        """Update an existing message (used for placeholders)."""
        try:
            message = Message.query.get(message_id)
            if not message:
                return None
            if content is not None:
                message.content = content
            if extra_data is not None:
                message.extra_data = extra_data
            db.session.commit()
            return message
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error updating message {message_id}: {e}")
            raise
