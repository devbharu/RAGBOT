# 🔐 Authentication System - Complete Implementation Guide

## Overview

Your RAGBOT now has **full JWT-based authentication** with signup, login, and logout functionality. Here's how everything works:

---

## 📋 What Was Added

### **Backend (Flask)**

#### 1. **Database Layer** - `models.py`
- SQLAlchemy User model with password hashing
- Fields: id, username, email, password_hash, created_at, updated_at
- Password hashing using werkzeug `pbkdf2:sha256`

#### 2. **Authentication Routes** - `auth.py` 
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/signup` | POST | Register new user |
| `/auth/login` | POST | Login & get JWT tokens |
| `/auth/refresh` | POST | Refresh access token |
| `/auth/me` | GET | Get current user info |
| `/auth/logout` | POST | Logout (client-side) |

#### 3. **Integration** - `main.py`
- SQLAlchemy initialized with Flask app
- JWT-Extended for token management
- Database tables auto-created on startup
- Auth blueprint registered

#### 4. **Dependencies** - `requirements.txt`
Added:
- `flask-sqlalchemy` - ORM for database
- `flask-jwt-extended` - JWT token handling
- `werkzeug` - Password hashing

---

### **Frontend (React)**

#### 1. **AuthContext** - `context/AuthContext.jsx`
Global state management for authentication:
```javascript
const {
  user,              // Current logged-in user
  token,             // JWT access token
  isAuthenticated,   // Boolean flag
  loading,           // Loading state
  error,             // Error messages
  signup(),          // Function to register
  login(),           // Function to login
  logout(),          // Function to logout
  refreshToken(),    // Function to refresh token
} = useAuth();
```

**Features:**
- Auto-attaches JWT to all axios requests
- Persists token in localStorage
- Validates token on app load
- Automatic token refresh

#### 2. **Login Page** - `pages/Login.jsx`
- Clean form with email/username + password
- Real-time validation
- Redirect to home if already logged in
- Error/success notifications

#### 3. **Signup Page** - `pages/Signup.jsx`
- Registration form with validation
- Username, email, password confirmation
- Password matching validation
- Auto-redirect after successful signup

#### 4. **PrivateRoute Component** - `components/PrivateRoute.jsx`
- Protects routes that require authentication
- Redirects unauthenticated users to login
- Shows loading state while checking auth

#### 5. **Updated App.jsx**
- AuthProvider wraps everything
- Protected routes using PrivateRoute
- Auth routes: `/auth/login`, `/auth/signup`
- Main routes: `/`, `/report` (protected)

#### 6. **User Menu** - Added to `components/Chatbot.jsx`
- Displays current username
- Dropdown with email and logout button
- Integrated into top navigation bar

---

## 🚀 How to Use

### **For Users - Signup**
1. Navigate to `http://localhost:5173/auth/signup`
2. Fill in: username (3+ chars), email, password (6+ chars)
3. Confirm password
4. Click "Create Account"
5. Automatically redirected to chatbot

### **For Users - Login**
1. Navigate to `http://localhost:5173/auth/login`
2. Enter email OR username
3. Enter password
4. Click "Sign In"
5. Automatically redirected to chatbot

### **For Users - Logout**
1. Click your username in top-right corner of chatbot
2. Click "Logout"
3. Redirected to login page
4. Token deleted from localStorage

---

## 🔄 How It Works - Frontend Flow

```
User visits app
    ↓
AuthProvider checks localStorage for token
    ↓
If token exists → validate via /auth/me
    ↓
If valid → user is logged in ✓
If invalid → token deleted, redirect to login
    ↓
User can access protected routes (/, /report)
    ↓
All API calls automatically include Authorization header
```

---

## 🔌 How It Works - Backend Flow

### **Signup**
```
POST /auth/signup
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "secure123"
}
↓
- Validate input (length, format)
- Check if username/email already exists
- Hash password
- Create user in database
- Generate JWT tokens
↓
Response:
{
  "user": { id, username, email, created_at },
  "access_token": "jwt_token_here",
  "refresh_token": "jwt_token_here"
}
```

### **Login**
```
POST /auth/login
{
  "email": "john@example.com",
  "password": "secure123"
}
↓
- Find user by email or username
- Verify password hash
- Generate JWT tokens
↓
Response: Same as signup
```

### **Protected Endpoints**
```
GET /auth/me
Headers: Authorization: Bearer <access_token>
↓
- JWT verified by @jwt_required() decorator
- User ID extracted from token
- User data returned
```

---

## 🔐 Token Details

### **Access Token**
- Expires in 24 hours
- Used for all authenticated API requests
- Stored in `Authorization` header as `Bearer <token>`
- Sent to backend on every request via axios interceptor

### **Refresh Token**
- Expires in 30 days
- Used to get new access token when it expires
- Endpoint: `POST /auth/refresh`
- Called automatically when access token is close to expiry (optional implementation)

---

## 📁 File Structure

```
backend/
  ├── models.py              (User model + SQLAlchemy init)
  ├── auth.py                (Auth routes: signup, login, refresh, me, logout)
  ├── main.py                (Updated with JWT + DB integration)
  ├── ragbot.db              (SQLite database - created automatically)
  ├── requirements.txt       (Added flask-sqlalchemy, flask-jwt-extended)
  └── .env                   (JWT_SECRET_KEY added)

frontend/
  ├── src/
  │   ├── context/
  │   │   ├── AuthContext.jsx       (Auth state management)
  │   │   └── AppContext.jsx        (Existing - still works)
  │   ├── pages/
  │   │   ├── Login.jsx             (Login form)
  │   │   └── Signup.jsx            (Signup form)
  │   ├── components/
  │   │   ├── Chatbot.jsx           (Updated with user menu)
  │   │   ├── PrivateRoute.jsx      (Route protection)
  │   │   └── (others unchanged)
  │   └── App.jsx                   (Updated with auth routes)
  └── (others unchanged)
```

---

## 🔧 Configuration

### **Backend - .env**
```env
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this-in-production
```
⚠️ **Change this in production!** Generate a strong random string.

### **Frontend - AuthContext.jsx**
```javascript
const ACCESS_TOKEN_EXPIRES = timedelta(hours=24)  // Backend
const REFRESH_TOKEN_EXPIRES = timedelta(days=30)  // Backend
```

### **Database**
- SQLite database: `backend/ragbot.db`
- Auto-created on first run
- Tables: `users`

---

## 🧪 Testing

### **Test Signup**
```bash
curl -X POST http://localhost:8080/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "test123"
  }'
```

### **Test Login**
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'
```

### **Test Protected Route (with token)**
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## ⚙️ Next Steps (Optional Enhancements)

1. **Email verification** - Send confirmation email on signup
2. **Password reset** - Forgot password functionality
3. **Token blacklist** - Prevent token reuse after logout
4. **Rate limiting** - Prevent brute force attacks on login
5. **Admin panel** - Manage users and permissions
6. **Social login** - Google, GitHub OAuth integration
7. **Two-factor auth** - SMS/TOTP-based 2FA
8. **Session management** - Track active sessions per user

---

## 🐛 Common Issues & Fixes

### **"JWT_SECRET_KEY not set"**
- Add `JWT_SECRET_KEY` to `.env` file

### **"User already exists"**
- Username or email already registered
- Try with different credentials

### **"Invalid credentials"**
- Password incorrect or user doesn't exist
- Double-check email/username and password

### **"Token expired"**
- Access token lifetime exceeded (24 hours)
- Use refresh token to get new access token
- Frontend should handle this automatically (optional)

### **CORS errors on auth endpoints**
- Ensure Flask-CORS is enabled (it is in main.py)
- Check frontend API URL matches backend URL

---

## 🎯 Summary

✅ **Signup & Login** - Full user registration and authentication  
✅ **JWT Tokens** - Secure, stateless token-based auth  
✅ **Protected Routes** - Unauthenticated users can't access chatbot  
✅ **User Display** - Current user shown in top navigation  
✅ **Logout** - Clean session termination  
✅ **Password Hashing** - Secure password storage  
✅ **Database** - SQLite with automatic initialization  
✅ **Auto Token Refresh** - Axios interceptor for seamless UX  

Your RAG Bot is now ready for multi-user deployments! 🚀
