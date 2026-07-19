"""
user_repository.py — Database repository for User actions and queries.
"""

from typing import Optional
from models import db, User
from utils.telemetry import logger

class UserRepository:
    @staticmethod
    def get_by_username(username: str) -> Optional[User]:
        """Look up a user by username."""
        try:
            return User.query.filter_by(username=username).first()
        except Exception as e:
            logger.error(f"[DB] Error querying user by username {username}: {e}")
            raise

    @staticmethod
    def get_by_email(email: str) -> Optional[User]:
        """Look up a user by email."""
        try:
            return User.query.filter_by(email=email).first()
        except Exception as e:
            logger.error(f"[DB] Error querying user by email {email}: {e}")
            raise

    @staticmethod
    def get_by_id(user_id: int) -> Optional[User]:
        """Look up a user by unique numeric ID."""
        try:
            return User.query.get(user_id)
        except Exception as e:
            logger.error(f"[DB] Error querying user by id {user_id}: {e}")
            raise

    @staticmethod
    def create_user(username: str, email: str, password_raw: str) -> User:
        """Register and commit a new user to database."""
        try:
            user = User(username=username, email=email)
            user.set_password(password_raw)
            db.session.add(user)
            db.session.commit()
            return user
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error creating user {username}: {e}")
            raise

    @staticmethod
    def update_preferences(user_id: int, new_prefs: dict) -> User:
        """Merge new preferences into the existing preferences JSON."""
        import json
        try:
            user = User.query.get(user_id)
            if not user:
                raise ValueError("User not found")
                
            current_prefs = {}
            if user.preferences:
                try:
                    current_prefs = json.loads(user.preferences)
                except json.JSONDecodeError:
                    current_prefs = {}
            
            # Merge dictionary
            current_prefs.update(new_prefs)
            user.preferences = json.dumps(current_prefs)
            
            db.session.commit()
            return user
        except Exception as e:
            db.session.rollback()
            logger.error(f"[DB] Error updating preferences for user {user_id}: {e}")
            raise
