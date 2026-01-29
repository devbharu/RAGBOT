import os
import glob
import pickle
import warnings
import time
import re
from flask import Flask, request, jsonify
from sklearn.neighbors import NearestNeighbors
from sentence_transformers import SentenceTransformer
from google import genai
from google.genai import types
from dotenv import load_dotenv
from flask_cors import CORS

# ------------------------------
# 1. Environment & Initialization
# ------------------------------
load_dotenv()
os.environ["TOKENIZERS_PARALLELISM"] = "false"
warnings.filterwarnings("ignore")

app = Flask(__name__)
CORS(app)
client = genai.Client()
embed_model = SentenceTransformer("intfloat/e5-small-v2")

DOCS_DIR = "rag_docs"
CACHE_FILE = "vector_cache.pkl"

# ------------------------------
# 2. Vector Store
# ------------------------------
class SimpleVectorStore:
    def __init__(self):
        self.documents = []
        self.vectors = None
        self.nn = None

    def build(self, docs):
        self.documents = docs
        texts = [f"passage: {d['text']}" for d in docs]
        print(f"[INIT] Encoding {len(texts)} chunks...")
        self.vectors = embed_model.encode(texts, show_progress_bar=True)
        self.nn = NearestNeighbors(n_neighbors=5, metric="cosine")
        self.nn.fit(self.vectors)

    def search(self, query, k=5):
        q_vec = embed_model.encode([f"query: {query}"])
        distances, indices = self.nn.kneighbors(q_vec, n_neighbors=k)
        return [self.documents[i] for i in indices[0]]

# ------------------------------
# 3. Load Documents
# ------------------------------
def load_docs():
    chunks = []
    os.makedirs(DOCS_DIR, exist_ok=True)
    for filepath in glob.glob(f"{DOCS_DIR}/**/*.txt", recursive=True):
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content:
                for p in content.split("\n\n"):
                    p = p.strip()
                    if p:
                        chunks.append({"text": p, "source": os.path.basename(filepath)})
    return chunks

vector_store = SimpleVectorStore()
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE, "rb") as f:
        vector_store = pickle.load(f)
    print("[SYSTEM] Loaded vector index from cache.")
else:
    docs = load_docs()
    if docs:
        vector_store.build(docs)
        with open(CACHE_FILE, "wb") as f:
            pickle.dump(vector_store, f)
        print("[SYSTEM] Vector index built and cached.")

# ------------------------------
# 4. Helper: Clean Response Text
# ------------------------------
def clean_text(text: str) -> str:
    """
    Clean raw Gemini response for frontend display:
    - Strip whitespace
    - Remove dangling markdown (*, **, `)
    - Remove repeated spaces and excessive newlines
    """
    if not text:
        return ""

    text = text.strip()

    # Remove trailing markdown symbols
    while text.endswith("*") or text.endswith("_") or text.endswith("`"):
        text = text[:-1].strip()

    # Replace multiple newlines with max 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Replace multiple spaces/tabs with single space
    text = re.sub(r'[ \t]{2,}', ' ', text)

    return text

# ------------------------------
# 5. Gemini 2.5 Flash RAG Function
# ------------------------------
def generate_gemini_response(
    query: str,
    temperature: float = 0.4,
    max_output_tokens: int =  1024,
    top_p: float = 0.9,
    retries: int = 3
):
    hits = vector_store.search(query)
    if not hits:
        return "I don't know. This information is not available in the documents."

    context_text = "\n".join([f"- {h['text']}" for h in hits])

    prompt = f"""
You are an intelligent assistant that answers questions strictly using a textbook.

Your task:
- Answer the user's question using BOTH:
  1) The retrieved textbook context (primary source)
  2) The user's question
- The textbook context is your main source of truth.
- You may intelligently rephrase, summarize, organize, and infer logically
  ONLY from the provided context.
- Do NOT add facts, events, or explanations that are not supported by the context.

Answering rules:
- If the context clearly answers the question, give a complete and clear answer.
- If the context partially answers the question, give the best possible answer
  using only the available information.
- If the question asks for a summary, you may combine multiple parts of the
  context into a coherent overview.
- If the context does NOT contain relevant information, respond EXACTLY with:
  "I don't know based on the textbook."

Textbook Context:
{context_text}

User Question:
{query}

Now provide a clear, well-structured, student-friendly answer:
"""


    # Console debug
    print(f"\n[QUERY] {query}")
    for i, hit in enumerate(hits, 1):
        print(f"[{i}] Source: {hit['source']}")
        print(f"     {hit['text'][:150]}...\n")

    for attempt in range(retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    top_p=top_p,
                    media_resolution="MEDIA_RESOLUTION_UNSPECIFIED"
                )
            )
            clean_response = clean_text(response.text)
            # Fallback if empty or incomplete
            if not clean_response:
                return "I don't know. This information is not available in the documents."
            return clean_response

        except Exception as e:
            if "503" in str(e):
                wait_time = 2 ** attempt
                print(f"[WARN] Model overloaded. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"[ERROR] {str(e)}")
                return f"Error: {str(e)}"

    return "Error: The model is currently unavailable. Please try again later."

# ------------------------------
# 6. Flask Endpoint
# ------------------------------
@app.route("/generate", methods=["POST"])
def chat():
    data = request.json
    prompt = data.get("prompt", "")
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400

    # Optional parameters from request
    temperature = float(data.get("temperature", 0.4))
    max_tokens = int(data.get("max_output_tokens", 512))
    top_p = float(data.get("top_p", 0.9))

    raw_response = generate_gemini_response(
        query=prompt,
        temperature=temperature,
        max_output_tokens=max_tokens,
        top_p=top_p
    )

    response_data = {
        "prompt": prompt,
        "response": raw_response,
        "parameters": {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
            "top_p": top_p
        }
    }

    return jsonify(response_data)

# ------------------------------
# 7. Run Flask
# ------------------------------
if __name__ == "__main__":
    print("[READY] RAG Backend active on http://127.0.0.1:8080")
    print(" - Gemini 2.5 Flash model")
    print(" - Temperature, max_output_tokens, top_p are configurable in POST request")
    app.run(host="0.0.0.0", port=8080)
