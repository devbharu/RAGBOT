# 📚 CMTI Bot (formerly RAGBOT) — Hybrid RAG (Vector + PageIndex)

A full-stack, production-grade **Multi-PDF Retrieval-Augmented Generation (RAG)** system powered by a **hybrid search engine**—supporting both **ChromaDB vector similarity search** (dense embeddings + BM25 sparse lexical retrieval) and a hierarchical **PageIndex tree routing engine** (chapter → section → page routing via local LLM)—coupled with a Claude-inspired interactive frontend interface.

---

## 🏗️ Architecture

```text
RAGBOT/
├── backend/                   # Flask API + LangGraph Backend
│   ├── main.py                # App entrypoint, database init, bootstrap loader
│   ├── graphs/                # LangGraph Orchestration Workflows
│   │   ├── rag_graph.py       # Claude-inspired agentic RAG workflow
│   │   ├── report_graph.py    # Analytical reports workflow for a single document
│   │   ├── multi_pdf_report_graph.py # Cross-document analysis & report graph
│   │   └── metall_report_graph.py # Engineering/materials specification analytics
│   ├── middleware/            # JWT validation and file ownership guards
│   ├── models/                # SQLAlchemy database schema
│   ├── repositories/          # SQLite Data Access Layer (Chats, Users, Reports)
│   ├── routes/                # Blueprint controller endpoints
│   ├── services/              # Core business services
│   │   ├── docling_loader.py  # Parallel fitz thread-pool parser (OCR + VLM)
│   │   ├── chroma_service.py  # Chroma DB (Dense embeddings + BM25 sparse + RRF)
│   │   ├── llm_service.py     # LiteLLM/Ollama interface wrapper with telemetry
│   │   ├── loader_service.py  # Ingestion coordinator with checkpoints
│   │   ├── pageindex_builder.py # Hierarchical index tree constructor
│   │   ├── pageindex_search.py # Multi-pdf PageIndex tree reasoning search
│   │   └── pageindex_cache.py  # Memoized Cache layer for nodes and chunks
│   ├── utils/                 # Auxiliary tools (pdflatex compiler, telemetry)
│   ├── run_pageindex.py       # CLI index tree builder for PDF and Markdown files
│   └── uploads/               # Uploaded PDFs on-disk storage (User prefixed)
│
└── frontend/                  # React 19 + Vite + Tailwind 4 App
    ├── src/
    │   ├── components/        # Reusable UI components
    │   │   ├── Chatbot.jsx    # Main chat shell (streaming, uploads, thought logs)
    │   │   ├── Sidebar.jsx    # Responsive history sidebar
    │   │   ├── ReportPanel.jsx # LaTeX builder and multi-agent report controller
    │   │   └── chatbot/       # Subcomponents (Analytics Modal, PDF Viewer, etc.)
    │   ├── context/           # Context APIs (Auth, App State, Custom Theme)
    │   ├── pages/             # Auth Pages (Login & Signup)
    │   ├── App.jsx            # Router and Provider assembly
    │   └── index.css          # Tailwind 4 directives and theme variables
    ├── tailwind.config.js     # Tailwind configurations
    └── vite.config.js         # Vite bundler configurations
```

---

## ✨ Key Features & Capabilities

### 🧠 PageIndex Reasoning Search (Vectorless Routing)
PageIndex provides a unique hierarchical navigation approach for document RAG. Given a user question:
1. **L1 (Chapter Routing):** The LLM parses the topmost document index nodes (typically chapters of ~50 pages) and selects the relevant chapter IDs based on summaries.
2. **L2 (Section Routing):** The LLM narrows down within the sub-nodes (sections of ~10 pages) of the chosen L1 chapters.
3. **L3 (Page Routing):** The LLM selects the exact physical page numbers within those sections.
4. **Context Gathering:** Chunks corresponding to the selected pages are gathered and compiled to stream the final response.
5. **Auditable Decision Log:** All routing decisions are streamed as thought logs in real time, making the model's traversal transparent.

### ⚡ Blazing Parallel Ingestion Pipeline (`docling_loader.py`)
Highly optimized for high-performance and scanned document support:
* **GIL-Free Multi-Threading:** Replaces the heavy spawn-based python multiprocessing with a light `ThreadPoolExecutor`. Since PyMuPDF (`fitz`) releases the GIL during file I/O operations, text is parsed concurrently without interpreter overhead.
* **Shared Document Pool:** The PDF is opened once and shared across reader threads, avoiding file descriptors leak and repetitive disk I/O.
* **Intelligent OCR (PyTesseract):** Pages with low text counts are automatically OCR-ed to extract embedded information.
* **VLM Visual Parsing:** Vision models (e.g., `qwen2.5vl`) extract table content, graphs, legends, callout text, and diagrams directly as markdown tables/descriptions, merging them seamlessly into the page's text context.
* **Dual In-Memory and Disk Checkpoints:** Raw chunks are memoized in an in-memory cache and persisted alongside the PDF as `.chunks.json` to support instantaneous subsequent loads.

### 🔗 Robust Vector RAG Fallback
When not using the reasoning tree, CMTI Bot uses a hybrid sparse-dense retrieval system:
* **Dense Embedding:** Vectors are generated via `BAAI/bge-small-en-v1.5` and stored in local `ChromaDB`.
* **Sparse Index:** BM25 (using `rank_bm25`) computes exact lexical query matching on chunks.
* **Fusion:** Reciprocal Rank Fusion (RRF) fuses sparse and dense search lists.
* **Query Expansion:** Synonyms expand technical terms (e.g., `llm` expands to `large language model`).
* **Cross-Encoder Reranker:** The fused list is re-ranked using `cross-encoder/ms-marco-MiniLM-L-6-v2` for maximum relevancy.

### 🌿 LangGraph Orchestrated Workflows
* **`rag_graph.py` (Agentic Chat):** 
  - *Query Optimizer:* Bypasses MultiQuery generation for short input prompts (≤ 4 words) to prevent hallucinated variants.
  - *Parallel Retrieval:* Retrieves chunks for original query and optimized variants simultaneously.
  - *Batched Relevance Grader:* Grades all retrieved chunks at once in a single LLM call.
  - *Query Rewriter:* Triggers single-iteration re-writes on-demand if retrieved chunks fail grading thresholds.
* **`report_graph.py` & `multi_pdf_report_graph.py` (Agentic Reports):**
  - Traverses multiple documents to compile a structured outline and write specific engineering subsections based on configured materials and specification inputs.

### 📄 LaTeX PDF Reporting Engine
* Renders comprehensive multi-agent summaries into structured LaTeX documents.
* Compiles LaTeX source code directly on the server via `pdflatex` to output beautiful, print-ready PDF attachments for immediate user download.

---

## 🚀 Getting Started

### Prerequisites
* **Python 3.10+**
* **Node.js 18+**
* **pdflatex / TeX Live / MacTeX** (for LaTeX PDF compilation)
* **Tesseract OCR** (for image text extraction, optional but recommended)
* **Ollama** running locally with the target model (e.g. `qwen3:4b`)

### Backend Setup
1. Clone the repository and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Copy the environment template and customize settings:
   ```bash
   cp .env.example .env
   ```
5. Run the Flask application:
   ```bash
   python main.py
   ```
   *Note: On startup, the database `ragbot.db` is initialized and documents inside `rag_docs/` are automatically bootstrapped in the background.*

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Launch the development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:5173`.

---

## ⚙️ Environment Configurations (`.env`)

Configure the following environment variables in `backend/.env`:

| Variable | Default Value | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Endpoint of the Ollama server |
| `LLM_MODEL` | `ollama/qwen3:4b` | Model identifier used by LiteLLM / Ollama for chat and routing |
| `VLM_MODEL` | `qwen3-vl:235b-cloud` | Vision model used for visual/table extraction on pages |
| `SKIP_VLM` | `false` | Set to `true` to disable VLM visual extraction |
| `SKIP_OCR` | `false` | Set to `true` to bypass PyTesseract OCR on scanned PDFs |
| `THREAD_WORKERS` | *CPU Cores × 3* | Number of background threads to allocate for PDF ingestion |
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | Dense embedding model name |
| `RERANK_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | CrossEncoder model for re-ranking vector results |
| `JWT_SECRET_KEY` | *development fallback* | Encryption key used for JWT user signatures |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins (comma-separated) |

---

## 🛠️ CLI Utilities (`run_pageindex.py`)

You can generate index trees and structures directly from the command line:

```bash
# Generate structure from a PDF
python run_pageindex.py --pdf_path /path/to/handbook.pdf --model ollama/qwen3:4b --if-add-node-summary yes

# Generate structure from a Markdown document
python run_pageindex.py --md_path /path/to/notes.md --if-thinning yes --thinning-threshold 4000
```

Results are stored as JSON files inside the `/results` directory.

---

## 📡 API Endpoints Reference

### Authentication Blueprint (`/auth`)

| Endpoint | Method | Payload / Params | Description |
|---|---|---|---|
| `/auth/signup` | POST | `{username, email, password}` | Register a new user and generate JWT tokens |
| `/auth/login` | POST | `{email/username, password}` | Retrieve access and refresh JWT tokens |
| `/auth/refresh` | POST | *Bearer Refresh Token* | Rotate access tokens dynamically |
| `/auth/logout` | POST | *Bearer Access Token* | Invalidate current user session |
| `/auth/me` | GET | None | Fetch logged-in user profile details |

### File Management Blueprint (`/`)

| Endpoint | Method | Payload / Params | Description |
|---|---|---|---|
| `/upload` | POST | `file` (Multipart form-data) | Uploads PDF/TXT (isolated with user ID) and starts ingestion |
| `/status/<filename>` | GET | None | Fetch the ingestion checkpoint status of a document |
| `/files` | GET | None | List files owned by the user (IDs stripped in display names) |
| `/delete` | POST | `{filename}` | Remove files, Chroma collections, and PageIndex cache from disk |
| `/reindex` | POST | `{filename}` | Wipe indices and schedule a fresh, full load of a document |
| `/chunks` | GET | `?filename=name&page=N` | Inspect parsed chunks and meta tags for verification |
| `/file/<filename>` | GET | `?token=JWT_STRING` | Stream download physical PDF with JWT ownership confirmation |

### PageIndex Blueprint (`/pageindex`)

| Endpoint | Method | Payload / Params | Description |
|---|---|---|---|
| `/pageindex/build` | POST | `{filename}` | Spawns a background PageIndex hierarchical tree build job |
| `/pageindex/status/<filename>` | GET | None | Check progress and phase of the background tree builder |
| `/pageindex/tree/<filename>` | GET | None | Retrieve the document index tree structure (uses memory cache) |
| `/pageindex/chat` | POST | `{prompt, filenames: []}` | Stream hierarchical page routing SSE traces and answers |

### Agentic Chat & Analytics

| Endpoint | Method | Payload / Params | Description |
|---|---|---|---|
| `/generate` | POST | `{prompt, filename, chat_id, scope, search_mode}` | Launch background RAG chat task, returns a `task_id` |
| `/chat/stream/<task_id>` | GET | None | Stream SSE event responses (thoughts and tokens) for the chat |
| `/chats` | GET | None | Retrieve list of chat history records for the user |
| `/chat/<id>` | GET | None | Retrieve messages belonging to a chat history session |
| `/chat/<id>` | DELETE | None | Permanently delete a chat history session |
| `/api/analytics/index` | GET | None | Retrieve index state (Vector/Heuristic/Premium) of uploaded files |
| `/usage` | GET | None | Retrieve total Ollama prompt/eval token usage since startup |

### Reports Blueprint

| Endpoint | Method | Payload / Params | Description |
|---|---|---|---|
| `/report-sections` | GET | None | Fetch the list of available engineering report subsections |
| `/reports` | GET | None | List saved generated LaTeX reports for the user |
| `/reports/<id>` | DELETE | None | Delete a saved report from the database and disk |
| `/generate-report` | POST | `{filename, material_name, standard_hint}` | Stream single-PDF engineering agent workflow SSE logs |
| `/generate-multi-report` | POST | `{filenames: [], query}` | Stream cross-document agent analysis SSE logs |
| `/compile-latex` | POST | `{latex}` | Compile raw LaTeX source directly to a PDF download response |
| `/last-report` | GET | None | Retrieve the last successfully generated report |
| `/active-report` | GET | None | Retrieve active report generation status |

---

## 🔒 Security & Isolation

* **User Namespacing:** Every uploaded file is saved on disk as `<user_id>_<sanitized_filename>`. 
* **Data Privacy:** Vector store names, PageIndex tree files, and caches carry the prefix. All API endpoints validate the JWT subject before reading, deleting, or reindexing.
* **Secure File Rendering:** The inline PDF viewer loads files by requesting `/file/<user_id>_<filename>` with a temporary authorization token passed as query parameters, preventing unauthorized direct document access.

---

## 📜 License

MIT
