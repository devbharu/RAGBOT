"""
auth.py — Authentication routes (signup, login, logout, refresh, current user)
"""

import os
from flask import Blueprint, request, jsonify, make_response
# pyrefly: ignore [missing-import]
from flask_jwt_extended import create_access_token, create_refresh_token, get_jwt_identity
from datetime import timedelta

from repositories.user_repository import UserRepository
from middleware.auth_middleware import jwt_and_user_required
from utils.telemetry import logger

auth_bp = Blueprint('auth', __name__)

def _allowed_origin():
    allowed = {
        item.strip()
        for item in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if item.strip()
    }
    origin = request.headers.get("Origin")
    return origin if origin in allowed else None

ACCESS_TOKEN_EXPIRES = timedelta(hours=24)
REFRESH_TOKEN_EXPIRES = timedelta(days=30)

@auth_bp.before_request
def handle_preflight():
    """Handle CORS preflight requests"""
    if request.method == "OPTIONS":
        response = make_response()
        origin = _allowed_origin()
        if origin:
            response.headers.add("Access-Control-Allow-Origin", origin)
            response.headers.add("Access-Control-Allow-Credentials", "true")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
        return response

@auth_bp.route('/signup', methods=['POST'])
def signup():
    """Register a new user"""
    try:
        data = request.get_json(silent=True) or {}
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not username or len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        
        if not email or '@' not in email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        if not password or len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        # Check if user exists
        if UserRepository.get_by_username(username):
            return jsonify({'error': 'Username already exists'}), 409
        
        if UserRepository.get_by_email(email):
            return jsonify({'error': 'Email already registered'}), 409
        
        # Create user
        user = UserRepository.create_user(username, email, password)
        logger.info(f"[AUTH] Created user {user.username} successfully")
        
        # Generate tokens
        access_token = create_access_token(identity=str(user.id), expires_delta=ACCESS_TOKEN_EXPIRES)
        refresh_token = create_refresh_token(identity=str(user.id), expires_delta=REFRESH_TOKEN_EXPIRES)
        
        return jsonify({
            'message': 'User created successfully',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token,
        }), 201
    
    except Exception as e:
        logger.error(f"[AUTH] Signup failed: {e}")
        return jsonify({'error': f'Signup failed: {str(e)}'}), 500

@auth_bp.route('/login', methods=['POST'])
def login():
    """Login an existing user"""
    try:
        data = request.get_json(silent=True) or {}
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        user = None
        if email:
            user = UserRepository.get_by_email(email)
        elif username:
            user = UserRepository.get_by_username(username)
            
        if not user or not user.check_password(password):
            return jsonify({'error': 'Invalid email/username or password'}), 401
            
        access_token = create_access_token(identity=str(user.id), expires_delta=ACCESS_TOKEN_EXPIRES)
        refresh_token = create_refresh_token(identity=str(user.id), expires_delta=REFRESH_TOKEN_EXPIRES)
        
        logger.info(f"[AUTH] User {user.username} logged in successfully")
        return jsonify({
            'message': 'Login successful',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token,
        }), 200
        
    except Exception as e:
        logger.error(f"[AUTH] Login failed: {e}")
        return jsonify({'error': f'Login failed: {str(e)}'}), 500

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Log out a user"""
    # Stateless JWT logout simply acknowledges
    return jsonify({'message': 'Logout successful'}), 200

# pyrefly: ignore [missing-import]
from flask_jwt_extended import jwt_required

@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Refresh an access token using a refresh token"""
    try:
        user_id = get_jwt_identity()
        access_token = create_access_token(identity=str(user_id), expires_delta=ACCESS_TOKEN_EXPIRES)
        return jsonify({'access_token': access_token}), 200
    except Exception as e:
        logger.error(f"[AUTH] Token refresh failed: {e}")
        return jsonify({'error': 'Refresh failed'}), 401

@auth_bp.route('/me', methods=['GET'])
@jwt_and_user_required()
def me():
    """Fetch current user credentials"""
    from flask import g
    return jsonify({'user': g.user.to_dict()}), 200

@auth_bp.route('/preferences', methods=['PUT', 'OPTIONS'])
@jwt_and_user_required()
def update_preferences():
    """Update user UI preferences/state"""
    from flask import g
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        user = UserRepository.update_preferences(g.user.id, data)
        return jsonify({'message': 'Preferences updated', 'preferences': user.to_dict().get('preferences', {})}), 200
    except Exception as e:
        logger.error(f"[AUTH] Failed to update preferences: {e}")
        return jsonify({'error': 'Failed to update preferences'}), 500
