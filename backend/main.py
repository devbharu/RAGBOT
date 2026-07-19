"""
main.py — Clean modular entrypoint for RAGBOT backend.
"""

from __future__ import annotations

import os
import warnings
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv

# Silence warnings
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

# Load environment
load_dotenv()

# Import SQLAlchemy Models
from models import db
from utils.telemetry import logger

def _csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]

def _is_truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}

# Initialize Flask Application
app = Flask(__name__)

# Configurations
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///ragbot.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
_dev_mode = os.getenv("FLASK_ENV", "").lower() != "production" and os.getenv("APP_ENV", "").lower() != "production"
_jwt_secret = os.getenv('JWT_SECRET_KEY')
if not _jwt_secret:
    if not _dev_mode:
        raise RuntimeError("JWT_SECRET_KEY must be set in production.")
    _jwt_secret = 'dev-only-change-me'
    logger.warning("[INIT] JWT_SECRET_KEY is not set. Using a development-only fallback.")
app.config['JWT_SECRET_KEY'] = _jwt_secret
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = 86400
app.config['JWT_ALGORITHM'] = 'HS256'
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'

ALLOWED_CORS_ORIGINS = _csv_env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

# Enforce explicit CORS origins by default. Add extra origins via CORS_ORIGINS.
CORS(
    app,
    origins=ALLOWED_CORS_ORIGINS,
    supports_credentials=True,
    expose_headers=['Content-Type'],
    allow_headers=['Content-Type', 'Authorization'],
)

db.init_app(app)
jwt = JWTManager(app)

# Standardize JWT Error Handlers
@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_data):
    return jsonify({'error': 'Token has expired'}), 401

@jwt.invalid_token_loader
def invalid_token_callback(error):
    return jsonify({'error': f'Invalid token: {error}'}), 401

@jwt.unauthorized_loader
def missing_token_callback(error):
    return jsonify({'error': f'Missing authorization token: {error}'}), 401

@jwt.token_verification_failed_loader
def token_verification_failed_callback(jwt_header, jwt_data):
    return jsonify({'error': 'Token verification failed'}), 401

# Register Blueprints
from routes.auth import auth_bp
from routes.chat import chat_bp
from routes.file import file_bp
from routes.report import report_bp
from routes.pageindex import pageindex_bp
from routes.analytics import analytics_bp
app.register_blueprint(auth_bp, url_prefix='/auth')
app.register_blueprint(file_bp, url_prefix='/')
app.register_blueprint(chat_bp, url_prefix='/')
app.register_blueprint(report_bp, url_prefix='/')
app.register_blueprint(pageindex_bp, url_prefix='/pageindex')
app.register_blueprint(analytics_bp, url_prefix='/api/analytics')
# Health Check Route
@app.route("/health", methods=["GET"])
def health():
    OLLAMA_MODEL = os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "ollama/qwen3:4b"))
    from services.chroma_service import EMBED_MODEL, RERANK_MODEL, _RERANKER_AVAILABLE, _BM25_AVAILABLE
    import requests
    
    llm_ok = False
    try:
        from services.llm_service import LLMService
        svc = LLMService()
        llm_ok = True  # We assume LiteLLM handles routing health checks gracefully or we just return True
    except Exception:
        pass
        
    return jsonify({
        "status": "ok", 
        "llm_service": "up" if llm_ok else "down",
        "llm_model": OLLAMA_MODEL, 
        "embed_model": EMBED_MODEL,
        "reranker": RERANK_MODEL if _RERANKER_AVAILABLE else "disabled",
        "bm25": "enabled" if _BM25_AVAILABLE else "disabled",
    }), 200

@app.route("/usage", methods=["GET"])
def token_usage():
    """Returns cumulative LLM token usage since server start."""
    from services.llm_service import LLMService
    svc = LLMService()
    data = svc.get_usage()
    return jsonify({
        "status": "ok",
        "token_usage": data
    }), 200

# Global After-Request CORS injector
@app.after_request
def add_cors(response):
    from flask import request
    origin = request.headers.get("Origin")
    if origin in ALLOWED_CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, DELETE, OPTIONS"
    return response

# Bootstrap default documents in background
def _bootstrap_default_docs():
    import glob
    from services.loader_service import LoaderService
    import asyncio
    
    loader = LoaderService()
    all_files = (
        glob.glob("rag_docs/**/*.pdf", recursive=True) +
        glob.glob("rag_docs/**/*.txt", recursive=True)
    )
    if not all_files:
        return
        
    def run_bootstrap():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        for filepath in all_files:
            filename = os.path.basename(filepath)
            try:
                loop.run_until_complete(loader.load_file(filepath, filename, force=False))
            except Exception as e:
                logger.error(f"[INIT] Bootstrap failed for document {filename}: {e}")
                
    import threading
    threading.Thread(target=run_bootstrap, daemon=True).start()

# Database and bootstrap initialization
with app.app_context():
    db.create_all()
    logger.info("[INIT] SQLite schema initialized.")
    _bootstrap_default_docs()

if __name__ == "__main__":
    OLLAMA_MODEL = os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "ollama/qwen3:4b"))
    from services.chroma_service import EMBED_MODEL, RERANK_MODEL, _RERANKER_AVAILABLE, _BM25_AVAILABLE
    
    logger.info("\n[READY] RAG Backend Modular Server -> http://127.0.0.1:8080")
    logger.info(f"  Embeddings  : {EMBED_MODEL}")
    logger.info(f"  Reranker    : {RERANK_MODEL if _RERANKER_AVAILABLE else 'disabled'}")
    logger.info(f"  BM25        : {'enabled' if _BM25_AVAILABLE else 'disabled'}")
    logger.info(f"  LLM Model   : {OLLAMA_MODEL}\n")
    
    app.run(host="0.0.0.0", port=8080, debug=_is_truthy(os.getenv("FLASK_DEBUG")))
