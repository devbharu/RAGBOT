"""
document_loader.py
──────────────────
PDF / TXT document loader with:
  • Selectable-text extraction  (markdown → plain-text fallback)
  • VLM page understanding      (Qwen via Ollama)  ← primary for image content
  • OCR fallback                (Tesseract)        ← only when Ollama is unreachable
  • Pages processed SEQUENTIALLY — fitz is NOT concurrency-safe
  • VLM calls are async (awaited per page) with a semaphore for rate-limiting
  • Full page-level metadata on every chunk

ROOT CAUSE OF PREVIOUS BUG:
  asyncio.gather(*all_page_tasks) fired all 60 pages at once.
  fitz.Document is NOT thread/async safe — concurrent page access
  silently corrupted page state, causing _page_has_images() to return
  False and pymupdf4llm to fall back to its own internal Tesseract OCR
  (the "Using Tesseract for OCR processing" noise in logs).
  FIX: pages are now processed one-by-one in a sequential async for loop.
  VLM HTTP calls (the only real I/O) are still async-awaited so the
  event loop stays free during network waits.

.env keys:
  OLLAMA_BASE_URL      (default http://localhost:11434)
  VLM_MODEL            (default qwen2.5vl:7b)
  VLM_TIMEOUT          (default 120 s)
  VLM_MAX_CONCURRENT   (default 3)
  PAGE_RENDER_DPI      (default 150)
  CHUNK_SIZE           (default 600)
  OCR_LANG             (default eng)
  DOCS_DIR             (default ./docs)
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import glob
import io
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from typing import Optional

import fitz             # pymupdf
import httpx
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

# ── Silence pymupdf4llm/docling internal chatter ──────────────────────────────
logging.getLogger("pymupdf4llm").setLevel(logging.ERROR)
logging.getLogger("docling").setLevel(logging.ERROR)


def _import_pymupdf4llm():
    import pymupdf4llm
    return pymupdf4llm


# ──────────────────────────────────────────────────────────────
#  Config
# ──────────────────────────────────────────────────────────────

OLLAMA_BASE_URL    = os.getenv("OLLAMA_BASE_URL",        "http://localhost:11434")
VLM_MODEL          = os.getenv("VLM_MODEL",              "qwen3-vl:235b-cloud")
VLM_TIMEOUT        = int(os.getenv("VLM_TIMEOUT",        "120"))
VLM_MAX_CONCURRENT = int(os.getenv("VLM_MAX_CONCURRENT", "3"))
PAGE_RENDER_DPI    = int(os.getenv("PAGE_RENDER_DPI",    "150"))
CHUNK_SIZE         = int(os.getenv("CHUNK_SIZE",         "600"))
OCR_LANG           = os.getenv("OCR_LANG",               "eng")
DOCS_DIR           = os.getenv("DOCS_DIR",               "./docs")

_VLM_SEMAPHORE: asyncio.Semaphore | None = None

def _get_semaphore() -> asyncio.Semaphore:
    global _VLM_SEMAPHORE
    if _VLM_SEMAPHORE is None:
        _VLM_SEMAPHORE = asyncio.Semaphore(VLM_MAX_CONCURRENT)
    return _VLM_SEMAPHORE


# ──────────────────────────────────────────────────────────────
#  Chunk dataclass
# ──────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    text:        str
    source:      str
    page:        Optional[int]
    chunk_index: int
    total_pages: int
    type:        str    # "text" | "table" | "vlm" | "ocr_fallback"
    method:      str    # "markdown" | "plain_text" | "vlm" | "ocr" | "pymupdf_table"

    def to_dict(self) -> dict:
        return {
            "text":        self.text,
            "source":      self.source,
            "page":        self.page,
            "chunk_index": self.chunk_index,
            "total_pages": self.total_pages,
            "type":        self.type,
            "method":      self.method,
        }


# ──────────────────────────────────────────────────────────────
#  Render page → base64 PNG
# ──────────────────────────────────────────────────────────────

def _page_to_base64_png(page: fitz.Page, dpi: int = PAGE_RENDER_DPI) -> str:
    zoom   = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    pix    = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
    img    = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf    = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


# ──────────────────────────────────────────────────────────────
#  Ollama availability
# ──────────────────────────────────────────────────────────────

async def _ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────
#  VLM call
# ──────────────────────────────────────────────────────────────

VLM_PROMPT = (
    "You are an expert document analyst. "
    "This image is a single page from a PDF document. "
    "Extract ALL information thoroughly:\n\n"
    "1. **Text in images/figures**: Every word visible inside photos, screenshots, diagrams.\n"
    "2. **Tables**: Reproduce every table in clean markdown (| col | col |).\n"
    "3. **Diagrams/Charts/Graphs**: Type, axis labels, trends, key values.\n"
    "4. **Any remaining page text** not covered above.\n\n"
    "Use clearly labelled sections. No opinions or summaries — extracted content only."
)

async def _call_vlm(b64_image: str, page_num: int, filename: str) -> str:
    payload = {
        "model":  VLM_MODEL,
        "stream": False,
        "messages": [{
            "role":    "user",
            "content": VLM_PROMPT,
            "images":  [b64_image],
        }],
    }

    async with _get_semaphore():
        try:
            async with httpx.AsyncClient(timeout=VLM_TIMEOUT) as client:
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
                r.raise_for_status()
                return r.json().get("message", {}).get("content", "").strip()

        except httpx.TimeoutException:
            print(f"  [VLM] ⚠ Timeout p.{page_num} {filename} (>{VLM_TIMEOUT}s)")
            return ""
        except httpx.HTTPStatusError as e:
            print(f"  [VLM] ⚠ HTTP {e.response.status_code} p.{page_num} {filename}")
            return ""
        except Exception as e:
            print(f"  [VLM] ⚠ Error p.{page_num} {filename}: {e}")
            return ""


# ──────────────────────────────────────────────────────────────
#  OCR fallback
# ──────────────────────────────────────────────────────────────

def _ocr_page_fallback(page: fitz.Page) -> str:
    try:
        import pytesseract
        zoom   = PAGE_RENDER_DPI / 72
        matrix = fitz.Matrix(zoom, zoom)
        pix    = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
        img    = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return pytesseract.image_to_string(img, lang=OCR_LANG).strip()
    except ImportError:
        print("  [OCR] pytesseract not installed")
        return ""
    except Exception as e:
        print(f"  [OCR] Failed: {e}")
        return ""


# ──────────────────────────────────────────────────────────────
#  Text extraction — stdout suppressed to hide pymupdf4llm noise
# ──────────────────────────────────────────────────────────────

@contextlib.contextmanager
def _suppress_stdout():
    with open(os.devnull, "w") as devnull:
        old, sys.stdout = sys.stdout, devnull
        try:
            yield
        finally:
            sys.stdout = old


def _extract_text(filepath: str, page: fitz.Page, page_num: int) -> tuple[str, str]:
    # Try markdown (pymupdf4llm) with stdout suppressed
    try:
        pymupdf4llm = _import_pymupdf4llm()
        with _suppress_stdout():
            md = pymupdf4llm.to_markdown(filepath, pages=[page_num - 1])
        if md and len(md.strip()) > 30:
            return md.strip(), "markdown"
    except Exception:
        pass

    # Fallback: plain text from fitz directly
    plain = page.get_text("text").strip()
    return plain, "plain_text"


# ──────────────────────────────────────────────────────────────
#  Table extraction
# ──────────────────────────────────────────────────────────────

def _extract_tables(
    page: fitz.Page, filename: str,
    page_num: int, total_pages: int, chunk_start: int
) -> list[Chunk]:
    chunks: list[Chunk] = []
    try:
        tabs = page.find_tables()
        for i, tab in enumerate(tabs):
            try:
                df = tab.to_pandas()
                if df.empty:
                    continue
                md = df.to_markdown(index=False)
                if md and md.strip():
                    chunks.append(Chunk(
                        text        = f"[TABLE {i+1} | Page {page_num}/{total_pages}]\n{md}",
                        source      = filename,
                        page        = page_num,
                        chunk_index = chunk_start + i,
                        total_pages = total_pages,
                        type        = "table",
                        method      = "pymupdf_table",
                    ))
                    print(f"  [TABLE] p.{page_num} table {i+1} → {df.shape[0]}r×{df.shape[1]}c")
            except Exception as e:
                print(f"  [TABLE] p.{page_num} table {i+1} error: {e}")
    except Exception as e:
        print(f"  [TABLE] p.{page_num} find_tables error: {e}")
    return chunks


# ──────────────────────────────────────────────────────────────
#  Image detection — safe single-page call
# ──────────────────────────────────────────────────────────────

def _page_has_images(page: fitz.Page) -> tuple[bool, int]:
    try:
        imgs = page.get_images(full=False)
        return len(imgs) > 0, len(imgs)
    except Exception:
        return False, 0


# ──────────────────────────────────────────────────────────────
#  Smart chunker
# ──────────────────────────────────────────────────────────────

def _smart_chunk(
    text:        str,
    source:      str,
    page:        Optional[int],
    total_pages: int,
    method:      str,
    chunk_start: int,
    chunk_size:  int = CHUNK_SIZE,
) -> list[Chunk]:
    chunks:  list[Chunk] = []
    blocks   = re.split(r"\n{2,}", text)
    current  = ""
    idx      = chunk_start

    for block in blocks:
        block = block.strip()
        if not block or len(block) < 30:
            continue

        is_table = block.startswith("|") or "| ---" in block or "| :---" in block

        if is_table:
            if current.strip():
                chunks.append(Chunk(current.strip(), source, page, idx, total_pages, "text", method))
                idx += 1
                current = ""
            chunks.append(Chunk(block, source, page, idx, total_pages, "table", method))
            idx += 1
            continue

        if len(current) + len(block) + 2 <= chunk_size:
            current += ("\n\n" if current else "") + block
        else:
            if current.strip():
                chunks.append(Chunk(current.strip(), source, page, idx, total_pages, "text", method))
                idx += 1
            current = block

    if current.strip():
        chunks.append(Chunk(current.strip(), source, page, idx, total_pages, "text", method))

    return chunks


# ──────────────────────────────────────────────────────────────
#  Process a single page — called sequentially, never gathered
# ──────────────────────────────────────────────────────────────

async def _process_page(
    doc:         fitz.Document,
    page_num:    int,
    total_pages: int,
    filepath:    str,
    filename:    str,
    ollama_up:   bool,
    chunk_idx:   int,
) -> list[Chunk]:

    # Safe: sequential access — only one page open at a time
    page   = doc[page_num - 1]
    chunks: list[Chunk] = []

    print(f"\n  [PAGE {page_num:>4}/{total_pages}]", end="  ")

    # ── ① Selectable text ──────────────────────────────────
    raw_text, method = _extract_text(filepath, page, page_num)
    print(f"text={method}({len(raw_text)}ch)", end="  ")

    if raw_text:
        text_chunks = _smart_chunk(raw_text, filename, page_num, total_pages, method, chunk_idx)
        chunks.extend(text_chunks)
        print(f"→ {len(text_chunks)} chunks", end="  ")

    # ── ② VLM / OCR for image content ──────────────────────
    has_images, n_images = _page_has_images(page)

    if has_images:
        print(f"| imgs={n_images}", end="  ")

        if ollama_up:
            b64 = _page_to_base64_png(page)
            print("| calling VLM…", end="  ", flush=True)
            vlm_text = await _call_vlm(b64, page_num, filename)

            if vlm_text:
                vlm_chunks = _smart_chunk(
                    text        = f"[VLM | Page {page_num}/{total_pages}]\n{vlm_text}",
                    source      = filename,
                    page        = page_num,
                    total_pages = total_pages,
                    method      = "vlm",
                    chunk_start = chunk_idx + len(chunks),
                )
                chunks.extend(vlm_chunks)
                print(f"VLM → {len(vlm_chunks)} chunks", end="  ")
            else:
                print("VLM → empty response", end="  ")

        else:
            print("| Ollama DOWN → OCR", end="  ")
            ocr_text = _ocr_page_fallback(page)
            if ocr_text:
                ocr_chunks = _smart_chunk(
                    text        = f"[OCR | Page {page_num}/{total_pages}]\n{ocr_text}",
                    source      = filename,
                    page        = page_num,
                    total_pages = total_pages,
                    method      = "ocr",
                    chunk_start = chunk_idx + len(chunks),
                )
                chunks.extend(ocr_chunks)
                print(f"OCR → {len(ocr_chunks)} chunks", end="  ")
    else:
        print("| no images", end="  ")

    # ── ③ Tables ────────────────────────────────────────────
    table_chunks = _extract_tables(page, filename, page_num, total_pages, chunk_idx + len(chunks))
    chunks.extend(table_chunks)

    return chunks


# ──────────────────────────────────────────────────────────────
#  Process a full PDF — sequential page loop
# ──────────────────────────────────────────────────────────────

async def _process_pdf(filepath: str, ollama_up: bool) -> list[Chunk]:
    filename = os.path.basename(filepath)
    print(f"\n{'═'*60}")
    print(f"[LOADER] Processing: {filename}")
    print(f"{'═'*60}")

    all_chunks: list[Chunk] = []

    try:
        doc         = fitz.open(filepath)
        total_pages = len(doc)
        print(f"  Pages  : {total_pages}")
        print(f"  VLM    : {'ON  → ' + VLM_MODEL if ollama_up else 'OFF → OCR fallback'}")
        print(f"  Mode   : sequential pages, async VLM awaits")

        running_idx = 0

        for page_num in range(1, total_pages + 1):
            page_chunks = await _process_page(
                doc         = doc,
                page_num    = page_num,
                total_pages = total_pages,
                filepath    = filepath,
                filename    = filename,
                ollama_up   = ollama_up,
                chunk_idx   = running_idx,
            )
            for c in page_chunks:
                c.chunk_index = running_idx
                running_idx  += 1
            all_chunks.extend(page_chunks)

        doc.close()

    except Exception as e:
        print(f"\n[LOADER] ✗ Failed: {filename}: {e}")
        return []

    n_text  = sum(1 for c in all_chunks if c.type == "text")
    n_table = sum(1 for c in all_chunks if c.type == "table")
    n_vlm   = sum(1 for c in all_chunks if c.type == "vlm")
    n_ocr   = sum(1 for c in all_chunks if c.type == "ocr_fallback")

    print(f"\n\n[LOADER] ✓ {filename}")
    print(f"  Total : {len(all_chunks)} chunks  "
          f"(text={n_text}  table={n_table}  vlm={n_vlm}  ocr={n_ocr})")

    return all_chunks


# ──────────────────────────────────────────────────────────────
#  Public API
# ──────────────────────────────────────────────────────────────

async def load_single_file_async(filepath: str, filename: str) -> list[dict]:
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        ollama_up   = await _ollama_available()
        print(f"[LOADER] Ollama: {'UP  → ' + VLM_MODEL if ollama_up else 'DOWN → OCR fallback'}")
        file_chunks = await _process_pdf(filepath, ollama_up)
        return [c.to_dict() for c in file_chunks]

    elif ext == ".txt":
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            chunks = _smart_chunk(content, filename, None, 1, "plain_text", 0)
            return [c.to_dict() for c in chunks]
        except Exception as e:
            print(f"[LOADER] Error: {filename}: {e}")
            return []

    else:
        print(f"[LOADER] Unsupported: {filename}")
        return []


def load_single_file(filepath: str, filename: str) -> list[dict]:
    """Sync wrapper — safe to call from Flask background threads."""
    return asyncio.run(load_single_file_async(filepath, filename))


async def load_documents_async(docs_dir: str = DOCS_DIR) -> list[dict]:
    pdf_files = sorted(glob.glob(f"{docs_dir}/**/*.pdf", recursive=True))
    txt_files = sorted(glob.glob(f"{docs_dir}/**/*.txt", recursive=True))

    print(f"\n[LOADER] {len(pdf_files)} PDF(s), {len(txt_files)} TXT(s) in '{docs_dir}'")
    ollama_up = await _ollama_available()
    print(f"[LOADER] Ollama: {'UP  → ' + VLM_MODEL if ollama_up else 'DOWN → OCR fallback'}")

    all_chunks: list[Chunk] = []

    for filepath in pdf_files:
        all_chunks.extend(await _process_pdf(filepath, ollama_up))

    for filepath in txt_files:
        filename = os.path.basename(filepath)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            chunks = _smart_chunk(content, filename, None, 1, "plain_text", 0)
            all_chunks.extend(chunks)
            print(f"[LOADER] ✓ {filename} → {len(chunks)} chunks")
        except Exception as e:
            print(f"[LOADER] ✗ {filepath}: {e}")

    print(f"\n[LOADER] TOTAL: {len(all_chunks)}  "
          f"text={sum(1 for c in all_chunks if c.type=='text')}  "
          f"table={sum(1 for c in all_chunks if c.type=='table')}  "
          f"vlm={sum(1 for c in all_chunks if c.type=='vlm')}  "
          f"ocr={sum(1 for c in all_chunks if c.type=='ocr_fallback')}")

    return [c.to_dict() for c in all_chunks]


def load_documents(docs_dir: str = DOCS_DIR) -> list[dict]:
    return asyncio.run(load_documents_async(docs_dir))


# ──────────────────────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, pprint

    p = argparse.ArgumentParser(description="Document Loader (Qwen VLM via Ollama)")
    p.add_argument("--docs-dir", default=DOCS_DIR)
    p.add_argument("--file",     default=None)
    p.add_argument("--json",     action="store_true")
    args = p.parse_args()

    chunks = (load_single_file(args.file, os.path.basename(args.file))
              if args.file else load_documents(args.docs_dir))

    if args.json:
        print(json.dumps(chunks, indent=2, ensure_ascii=False))
    else:
        print(f"\nLoaded {len(chunks)} chunks.")
        if chunks:
            print("\nFirst chunk:")
            pprint.pprint(chunks[0])