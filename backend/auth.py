"""
auth.py — Authentication routes (signup, login, logout, current user)
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from models import db, User
from datetime import timedelta

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

# Config — adjust based on your needs
ACCESS_TOKEN_EXPIRES = timedelta(hours=24)
REFRESH_TOKEN_EXPIRES = timedelta(days=30)

# ─────────────────────────────────────────────────────────────
# POST /auth/signup
# ─────────────────────────────────────────────────────────────
@auth_bp.route('/signup', methods=['POST'])
def signup():
    """
    Register a new user
    
    Request body:
    {
        "username": "john_doe",
        "email": "john@example.com",
        "password": "secure_password_123"
    }
    """
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
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
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already exists'}), 409
        
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already registered'}), 409
        
        # Create user
        user = User(username=username, email=email)
        user.set_password(password)
        
        db.session.add(user)
        db.session.commit()
        
        # Generate tokens
        access_token = create_access_token(
            identity=user.id,
            expires_delta=ACCESS_TOKEN_EXPIRES
        )
        refresh_token = create_refresh_token(
            identity=user.id,
            expires_delta=REFRESH_TOKEN_EXPIRES
        )
        
        return jsonify({
            'message': 'User created successfully',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token,
        }), 201
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Signup failed: {str(e)}'}), 500


# ─────────────────────────────────────────────────────────────
# POST /auth/login
# ─────────────────────────────────────────────────────────────
@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Login user and return JWT tokens
    
    Request body:
    {
        "email": "john@example.com",
        "password": "secure_password_123"
    }
    or
    {
        "username": "john_doe",
        "password": "secure_password_123"
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Accept either email or username
        email_or_username = data.get('email') or data.get('username')
        password = data.get('password', '')
        
        if not email_or_username or not password:
            return jsonify({'error': 'Email/username and password required'}), 400
        
        # Find user
        user = User.query.filter(
            (User.email == email_or_username) | (User.username == email_or_username)
        ).first()
        
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Verify password
        if not user.check_password(password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate tokens
        access_token = create_access_token(
            identity=user.id,
            expires_delta=ACCESS_TOKEN_EXPIRES
        )
        refresh_token = create_refresh_token(
            identity=user.id,
            expires_delta=REFRESH_TOKEN_EXPIRES
        )
        
        return jsonify({
            'message': 'Login successful',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token,
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Login failed: {str(e)}'}), 500


# ─────────────────────────────────────────────────────────────
# POST /auth/refresh
# ─────────────────────────────────────────────────────────────
@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """
    Refresh access token using refresh token
    
    Headers:
    Authorization: Bearer <refresh_token>
    """
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        access_token = create_access_token(
            identity=user.id,
            expires_delta=ACCESS_TOKEN_EXPIRES
        )
        
        return jsonify({
            'access_token': access_token,
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Token refresh failed: {str(e)}'}), 500


# ─────────────────────────────────────────────────────────────
# GET /auth/me
# ─────────────────────────────────────────────────────────────
@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """
    Get current authenticated user info
    
    Headers:
    Authorization: Bearer <access_token>
    """
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'user': user.to_dict(),
        }), 200
    
    except Exception as e:
        return jsonify({'error': f'Failed to get user: {str(e)}'}), 500


# ─────────────────────────────────────────────────────────────
# POST /auth/logout
# ─────────────────────────────────────────────────────────────
@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """
    Logout user (client-side: just delete the token)
    
    Headers:
    Authorization: Bearer <access_token>
    """
    # JWT is stateless, so logout is just client-side JWT deletion
    # In production, you could add token to blacklist here
    return jsonify({'message': 'Logout successful'}), 200
