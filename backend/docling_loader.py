"""
document_loader.py  (v5 — page image storage)
──────────────────────────────────────────────
Key changes over v4
───────────────────
1. PAGE IMAGE STORAGE  — during Phase 1, each page that has visual content
   (or ALL pages, configurable) is rendered and saved as a PNG file to
   IMAGE_DIR (default: ./page_images/<filename_stem>/page_<N>.png).
   base64 is no longer held in memory after saving — reduces RAM usage.

2. _save_page_image()  — new helper that renders a page and writes PNG to
   disk, returning the saved path. Called from _worker_extract_page.

3. IMAGE_DIR config    — set via PAGE_IMAGE_DIR env var (default: ./page_images).

4. SAVE_ALL_PAGES      — env var (default: false). When true, saves ALL pages
   as images (useful for document viewer). When false (default), only saves
   pages that have visual content detected.

5. b64 field removed from worker return tuple — replaced with image_path.
   This prevents large base64 blobs from being serialised across process
   boundaries via multiprocessing pipes (was a hidden bottleneck).

6. IMAGE PATH in chunk cache — page image path stored in chunk metadata
   (field: "image_path") so consumers know which image maps to which chunk.

ALIGNMENT WITH main.py (v4)
────────────────────────────
- _safe_filename()      : identical rule — strip ext, replace [^a-zA-Z0-9] with '_'
- _image_dir_for_file() : <PAGE_IMAGE_DIR>/<safe_stem>/
- _page_image_path()    : <PAGE_IMAGE_DIR>/<safe_stem>/page_<N>.png
- get_page_image_path() : returns path str if file exists, else None  (main.py uses None-check)
- image_path in chunks  : always set via _page_image_path() so main.py lookups always match

All v4 features retained.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import glob
import hashlib
import io
import json
import logging
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

import fitz
import httpx
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

# ── Silence noisy internal loggers ────────────────────────────
for _lg in ["pymupdf4llm", "docling", "tesseract", "PIL",
            "pdfminer", "pdfplumber", "ocrmypdf", "pluggy", "reportlab"]:
    logging.getLogger(_lg).setLevel(logging.CRITICAL)
    logging.getLogger(_lg).propagate = False


# ──────────────────────────────────────────────────────────────
#  Config
# ──────────────────────────────────────────────────────────────

OLLAMA_BASE_URL    = os.getenv("OLLAMA_BASE_URL",        "http://localhost:11434")
VLM_MODEL          = os.getenv("VLM_MODEL",              "qwen2.5vl:7b")
VLM_TIMEOUT        = int(os.getenv("VLM_TIMEOUT",        "120"))
VLM_MAX_CONCURRENT = int(os.getenv("VLM_MAX_CONCURRENT", "15"))
PAGE_RENDER_DPI    = int(os.getenv("PAGE_RENDER_DPI",    "200"))
CHUNK_SIZE         = int(os.getenv("CHUNK_SIZE",         "1000"))
CHUNK_OVERLAP      = int(os.getenv("CHUNK_OVERLAP",      "200"))
PHASE1_WORKERS     = int(os.getenv("PHASE1_WORKERS",     "6"))
DOCS_DIR           = os.getenv("DOCS_DIR",               "./docs")
CACHE_CHUNKS       = os.getenv("CACHE_CHUNKS",           "true").lower() == "true"
SKIP_PYMUPDF4LLM   = os.getenv("SKIP_PYMUPDF4LLM",       "false").lower() == "true"

# v5: image storage config
PAGE_IMAGE_DIR     = os.path.abspath(os.getenv("PAGE_IMAGE_DIR",  "./page_images"))
SAVE_ALL_PAGES     = os.getenv("SAVE_ALL_PAGES",  "false").lower() == "true"
IMAGE_DPI          = int(os.getenv("IMAGE_DPI",   "150"))   # lower than VLM DPI — saves disk space

_VLM_SEMAPHORE: asyncio.Semaphore | None = None
_VLM_CLIENT:    httpx.AsyncClient | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _VLM_SEMAPHORE
    if _VLM_SEMAPHORE is None:
        _VLM_SEMAPHORE = asyncio.Semaphore(VLM_MAX_CONCURRENT)
    return _VLM_SEMAPHORE


async def _get_client() -> httpx.AsyncClient:
    global _VLM_CLIENT
    if _VLM_CLIENT is None or _VLM_CLIENT.is_closed:
        _VLM_CLIENT = httpx.AsyncClient(
            timeout=VLM_TIMEOUT,
            limits=httpx.Limits(
                max_connections=VLM_MAX_CONCURRENT + 5,
                max_keepalive_connections=VLM_MAX_CONCURRENT,
            ),
        )
    return _VLM_CLIENT


async def _close_client() -> None:
    global _VLM_CLIENT
    if _VLM_CLIENT and not _VLM_CLIENT.is_closed:
        await _VLM_CLIENT.aclose()
        _VLM_CLIENT = None


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
    type:        str          # "text" | "table" | "vlm"
    method:      str          # "markdown" | "dict_text" | "plain_text" | "vlm" | "pymupdf_table"
    image_path:  str = ""     # v5: path to page PNG, empty if not saved

    def to_dict(self) -> dict:
        return {
            "text":        self.text,
            "source":      self.source,
            "page":        self.page,
            "chunk_index": self.chunk_index,
            "total_pages": self.total_pages,
            "type":        self.type,
            "method":      self.method,
            "image_path":  self.image_path,
        }


# ──────────────────────────────────────────────────────────────
#  Stdout/stderr suppressor
# ──────────────────────────────────────────────────────────────

@contextlib.contextmanager
def _suppress_all_output():
    with open(os.devnull, "w") as devnull:
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout = devnull
        sys.stderr = devnull
        try:
            yield
        finally:
            sys.stdout = old_out
            sys.stderr = old_err


# ──────────────────────────────────────────────────────────────
#  File hash + cache helpers
# ──────────────────────────────────────────────────────────────

def _file_md5(filepath: str) -> str:
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _cache_path(filepath: str) -> str:
    return filepath + ".chunks.json"


def _load_cache(filepath: str) -> list[dict] | None:
    if not CACHE_CHUNKS:
        return None
    cp = _cache_path(filepath)
    if not os.path.exists(cp):
        return None
    try:
        with open(cp, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("md5") == _file_md5(filepath):
            print(f"[CACHE] ✓ hit: {os.path.basename(filepath)} "
                  f"({len(data['chunks'])} chunks)")
            return data["chunks"]
    except Exception:
        pass
    return None


def _save_cache(filepath: str, chunks: list[dict]) -> None:
    if not CACHE_CHUNKS:
        return
    try:
        with open(_cache_path(filepath), "w", encoding="utf-8") as f:
            json.dump({"md5": _file_md5(filepath), "chunks": chunks}, f,
                      ensure_ascii=False)
    except Exception as e:
        print(f"[CACHE] ✗ could not write cache: {e}")


# ──────────────────────────────────────────────────────────────
#  v5: Page image helpers
#  ⚠ MUST stay in sync with the identical helpers in main.py
#  Rule: strip extension, replace every [^a-zA-Z0-9] char with '_'
#  Example: "My Doc (v2).pdf" → "My_Doc__v2_"
# ──────────────────────────────────────────────────────────────

def _safe_filename(filename: str) -> str:
    """
    Sanitise a filename into a safe directory stem.
    IDENTICAL to the function in main.py — do not diverge.
    """
    stem = os.path.splitext(filename)[0]            # drop extension
    return re.sub(r"[^a-zA-Z0-9]", "_", stem)      # sanitise


def _image_dir_for_file(filename: str) -> str:
    """
    Absolute path to the directory holding page PNGs for *filename*.
    Structure: <PAGE_IMAGE_DIR>/<safe_stem>/
    IDENTICAL to main.py.
    """
    return os.path.join(PAGE_IMAGE_DIR, _safe_filename(filename))


def _page_image_path(filename: str, page_num: int) -> str:
    """
    Canonical on-disk path for a page image.
    Structure: <PAGE_IMAGE_DIR>/<safe_stem>/page_<N>.png
    Always use this — never build the path manually elsewhere.
    """
    return os.path.join(_image_dir_for_file(filename), f"page_{page_num}.png")


def _save_page_image(page: fitz.Page, filename: str, page_num: int,
                     dpi: int = IMAGE_DPI) -> str:
    """
    Render *page* to a PNG and save it to disk.
    Returns the saved path (via _page_image_path), or "" on failure.
    Skips rendering if the file already exists on disk.
    """
    try:
        img_dir  = _image_dir_for_file(filename)
        os.makedirs(img_dir, exist_ok=True)

        out_path = _page_image_path(filename, page_num)

        # Skip if already rendered (e.g. re-index with cache disabled)
        if os.path.exists(out_path):
            return out_path

        zoom   = dpi / 72
        matrix = fitz.Matrix(zoom, zoom)
        pix    = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
        img    = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img.save(out_path, format="PNG", optimize=True)
        return out_path

    except Exception as e:
        print(f"  [IMG] Failed to save page {page_num} of {filename}: {e}")
        return ""


# ── Public helpers used by main.py ────────────────────────────

def page_image_exists(filename: str, page_num: int) -> bool:
    """Return True if the page PNG exists on disk."""
    return os.path.exists(_page_image_path(filename, page_num))


def get_page_image_path(filename: str, page_num: int) -> str | None:
    """
    Return the absolute path to page_<N>.png if it exists, else None.
    main.py uses a None-check on the return value — must stay None, not "".
    Naming follows _page_image_path() so main.py and loader always agree.
    """
    path = _page_image_path(filename, page_num)
    return path if os.path.isfile(path) else None


# ──────────────────────────────────────────────────────────────
#  Render page → base64 PNG  (kept for VLM calls only)
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
#  VLM prompt
# ──────────────────────────────────────────────────────────────

VLM_PROMPT = (
    "Extract visual content from this PDF page for a RAG system. "
    "Text is already extracted separately — focus ONLY on:\n"
    "- Charts/graphs: axis labels, tick values, legend text, data values\n"
    "- Tables: reproduce as markdown table\n"
    "- Diagrams/flowcharts: node labels, edge labels, arrow text\n"
    "- Figure annotations, callout text, embedded labels\n\n"
    "Be precise with numbers. Use markdown tables for tabular data. "
    "Ignore headers, footers, watermarks, decorative elements. "
    "If nothing visual to extract, reply: SKIP"
)

VLM_RETRY_ATTEMPTS = int(os.getenv("VLM_RETRY_ATTEMPTS", "4"))
VLM_RETRY_BASE     = float(os.getenv("VLM_RETRY_BASE",   "3.0"))


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

    client = await _get_client()

    async with _get_semaphore():
        for attempt in range(1, VLM_RETRY_ATTEMPTS + 1):
            try:
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)

                if r.status_code in (429, 502, 503):
                    if r.status_code == 429:
                        retry_after = r.headers.get("Retry-After")
                        wait = float(retry_after) if retry_after else VLM_RETRY_BASE * (2 ** (attempt - 1))
                    else:
                        wait = VLM_RETRY_BASE * (2 ** (attempt - 1))
                    print(f"  [VLM] ⚠ HTTP {r.status_code} p.{page_num} "
                          f"(attempt {attempt}/{VLM_RETRY_ATTEMPTS}) "
                          f"retrying in {wait:.0f}s…")
                    await asyncio.sleep(wait)
                    continue

                r.raise_for_status()
                result = r.json().get("message", {}).get("content", "").strip()
                return "" if result.upper() == "SKIP" else result

            except httpx.TimeoutException:
                wait = VLM_RETRY_BASE * (2 ** (attempt - 1))
                print(f"  [VLM] ⚠ Timeout p.{page_num} "
                      f"(attempt {attempt}/{VLM_RETRY_ATTEMPTS}) "
                      f"retrying in {wait:.0f}s…")
                if attempt < VLM_RETRY_ATTEMPTS:
                    await asyncio.sleep(wait)

            except httpx.HTTPStatusError as e:
                print(f"  [VLM] ⚠ HTTP {e.response.status_code} p.{page_num} {filename} — skipping")
                return ""

            except Exception as e:
                print(f"  [VLM] ⚠ Error p.{page_num} {filename}: {e} — skipping")
                return ""

        print(f"  [VLM] ✗ p.{page_num} {filename} — all {VLM_RETRY_ATTEMPTS} attempts failed")
        return ""


# ──────────────────────────────────────────────────────────────
#  C-level stderr suppressor
# ──────────────────────────────────────────────────────────────

def _suppress_c_stderr() -> int:
    sys.stdout.flush()
    sys.stderr.flush()
    devnull    = os.open(os.devnull, os.O_WRONLY)
    old_stderr = os.dup(2)
    os.dup2(devnull, 2)
    os.close(devnull)
    return old_stderr


def _restore_c_stderr(old_stderr: int) -> None:
    sys.stderr.flush()
    os.dup2(old_stderr, 2)
    os.close(old_stderr)


# ──────────────────────────────────────────────────────────────
#  Worker process initializer
# ──────────────────────────────────────────────────────────────

_worker_pymupdf4llm = None


def _worker_process_init():
    global _worker_pymupdf4llm
    if not SKIP_PYMUPDF4LLM:
        try:
            import pymupdf4llm as _m
            _worker_pymupdf4llm = _m
        except Exception:
            _worker_pymupdf4llm = None


# ──────────────────────────────────────────────────────────────
#  Extract markdown for a single page inside a worker
# ──────────────────────────────────────────────────────────────

def _extract_page_markdown(filepath: str, page_num: int) -> str:
    global _worker_pymupdf4llm
    if SKIP_PYMUPDF4LLM or _worker_pymupdf4llm is None:
        return ""
    try:
        old_stderr = _suppress_c_stderr()
        try:
            with _suppress_all_output():
                md = _worker_pymupdf4llm.to_markdown(
                    filepath,
                    pages        = [page_num - 1],
                    write_images = False,
                )
        finally:
            _restore_c_stderr(old_stderr)
        return md.strip() if md else ""
    except Exception as e:
        print(f"  [MD] p.{page_num} pymupdf4llm failed ({e}) → dict fallback")
        return ""


# ──────────────────────────────────────────────────────────────
#  Dict-mode text extractor
# ──────────────────────────────────────────────────────────────

def _extract_page_dict_text(page: fitz.Page) -> str:
    try:
        raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        blocks = sorted(
            raw.get("blocks", []),
            key=lambda b: (round(b["bbox"][1] / 20), b["bbox"][0])
        )
        lines_out: list[str] = []
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                line_text = " ".join(s.get("text", "").strip() for s in spans if s.get("text", "").strip())
                if line_text:
                    lines_out.append(line_text)
        return "\n".join(lines_out).strip()
    except Exception as e:
        print(f"  [DICT] dict extraction failed: {e}")
        return ""


# ──────────────────────────────────────────────────────────────
#  Table-line stripper
# ──────────────────────────────────────────────────────────────

_TABLE_LINE = re.compile(r'^\|.*\|[ \t]*$', re.MULTILINE)
_TABLE_SEP  = re.compile(r'^\|[\s\-:|]+\|[ \t]*$', re.MULTILINE)


def _strip_table_lines(text: str) -> str:
    lines  = text.splitlines(keepends=True)
    result = []
    i      = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if _TABLE_LINE.match(line):
            while i < len(lines) and (
                _TABLE_LINE.match(lines[i].rstrip()) or
                _TABLE_SEP.match(lines[i].rstrip())
            ):
                i += 1
        else:
            result.append(lines[i])
            i += 1
    return "".join(result)


def _excise_table_regions(page: fitz.Page, text: str) -> str:
    try:
        table_list = page.find_tables()
    except Exception:
        return text
    result = text
    for tab in table_list:
        try:
            bbox       = tab.bbox
            clip_rect  = fitz.Rect(bbox)
            table_text = page.get_text("text", clip=clip_rect).strip()
            if table_text:
                result = result.replace(table_text, "")
        except Exception:
            pass
    return result


# ──────────────────────────────────────────────────────────────
#  Smart chunker
# ──────────────────────────────────────────────────────────────

_HEADING = re.compile(r'^#{1,3} .+', re.MULTILINE)


def _smart_chunk(
    text:        str,
    source:      str,
    page:        Optional[int],
    total_pages: int,
    method:      str,
    chunk_start: int,
    image_path:  str = "",
    chunk_size:  int = CHUNK_SIZE,
    overlap:     int = CHUNK_OVERLAP,
) -> list[Chunk]:
    chunks:       list[Chunk] = []
    current_head: str         = ""
    current:      str         = ""
    idx:          int         = chunk_start

    blocks = re.split(r'(?=\n#{1,3} )', text)

    def flush(buf: str) -> None:
        nonlocal idx
        buf = buf.strip()
        if not buf or len(buf) < 30:
            return
        full = (current_head.strip() + "\n\n" + buf) if current_head else buf
        chunks.append(Chunk(full.strip(), source, page, idx, total_pages, "text", method,
                            image_path=image_path))
        idx += 1

    for block in blocks:
        block = block.strip()
        if not block or len(block) < 30:
            continue

        is_table = block.startswith("|") or "| ---" in block or "| :---" in block
        if is_table:
            flush(current)
            current = ""
            chunks.append(Chunk(block, source, page, idx, total_pages, "table", method,
                                image_path=image_path))
            idx += 1
            continue

        head_match = _HEADING.match(block)
        if head_match:
            flush(current)
            current      = ""
            current_head = head_match.group(0)
            remainder    = block[head_match.end():].strip()
            if remainder:
                block = remainder
            else:
                continue

        if len(current) + len(block) + 2 <= chunk_size:
            current += ("\n\n" if current else "") + block
        else:
            flush(current)
            words         = current.split()
            overlap_words = words[-max(1, overlap // 6):]
            current       = " ".join(overlap_words) + "\n\n" + block if overlap_words else block

    flush(current)
    return chunks


# ──────────────────────────────────────────────────────────────
#  Table extraction
# ──────────────────────────────────────────────────────────────

def _extract_tables(
    page:        fitz.Page,
    filename:    str,
    page_num:    int,
    total_pages: int,
    chunk_start: int,
    image_path:  str = "",
) -> list[Chunk]:
    chunks: list[Chunk] = []
    try:
        for i, tab in enumerate(page.find_tables()):
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
                        image_path  = image_path,
                    ))
                    print(f"  [TABLE] p.{page_num} t{i+1} → {df.shape[0]}r×{df.shape[1]}c")
            except Exception as e:
                print(f"  [TABLE] p.{page_num} t{i+1} error: {e}")
    except Exception as e:
        print(f"  [TABLE] p.{page_num} find_tables: {e}")
    return chunks


# ──────────────────────────────────────────────────────────────
#  Visual content detection
# ──────────────────────────────────────────────────────────────

MIN_IMAGE_AREA   = 500
MIN_DRAWING_AREA = 2000


def _page_has_visual_content(page: fitz.Page) -> tuple[bool, str]:
    page_area = page.rect.width * page.rect.height

    try:
        real = [i for i in page.get_image_info(xrefs=True)
                if i.get("width", 0) * i.get("height", 0) >= MIN_IMAGE_AREA]
        if real:
            return True, f"{len(real)} raster image(s)"
    except Exception:
        pass

    try:
        real = [img for img in page.get_images(full=True)
                if img[2] * img[3] >= MIN_IMAGE_AREA]
        if real:
            return True, f"{len(real)} embedded image(s)"
    except Exception:
        pass

    try:
        significant = [
            d for d in page.get_drawings()
            if d.get("rect") and
               d["rect"].width * d["rect"].height >= MIN_DRAWING_AREA and
               d["rect"].width * d["rect"].height < 0.80 * page_area
        ]
        if significant:
            return True, f"{len(significant)} vector graphic(s)/diagram(s)"
    except Exception:
        pass

    return False, "no visual content"


# ──────────────────────────────────────────────────────────────
#  Phase 1 worker  (v5 — saves images to disk, no b64 in return)
# ──────────────────────────────────────────────────────────────

_MD_MIN_LEN = 30


def _worker_extract_page(
    filepath:    str,
    filename:    str,
    page_num:    int,
    total_pages: int,
    ollama_up:   bool,
) -> tuple[int, list[dict], bool, str]:
    """
    Returns: (page_num, chunk_dicts, has_visual, image_path)

    image_path is always produced via _page_image_path() so it is
    consistent with the lookup in main.py. Caller must never build
    the path manually.
    """
    chunks: list[Chunk] = []
    image_path = ""

    try:
        doc  = fitz.open(filepath)
        page = doc[page_num - 1]

        # ── Step 1: always save page image to disk ───────────────
        # We save every page (not just visual ones) so the document
        # viewer in main.py can always serve /page-image/<file>/<N>.
        # _save_page_image is a no-op if the file already exists.
        image_path = _save_page_image(page, filename, page_num)

        # Check for visual content to decide VLM queuing
        has_visual, reason = _page_has_visual_content(page)

        # ── Step 2: tables ──────────────────────────────────────
        table_chunks = _extract_tables(page, filename, page_num, total_pages, 0,
                                       image_path=image_path)

        # ── Step 3: text extraction with 3-tier fallback ────────
        md_text = _extract_page_markdown(filepath, page_num)
        method  = "plain_text"

        if md_text and len(md_text.strip()) > _MD_MIN_LEN:
            clean_text = _strip_table_lines(md_text)
            clean_text = _excise_table_regions(page, clean_text)
            method     = "markdown"
        else:
            dict_text = _extract_page_dict_text(page)
            if dict_text and len(dict_text.strip()) > _MD_MIN_LEN:
                clean_text = _strip_table_lines(dict_text)
                clean_text = _excise_table_regions(page, clean_text)
                method     = "dict_text"
                if not md_text:
                    print(f"  [TEXT] p.{page_num} md empty → dict fallback")
            else:
                plain = page.get_text("text").strip()
                clean_text = _strip_table_lines(plain) if plain else ""
                clean_text = _excise_table_regions(page, clean_text) if clean_text else ""
                method     = "plain_text"
                if not dict_text:
                    print(f"  [TEXT] p.{page_num} dict empty → plain fallback")

        text_chunks = _smart_chunk(
            clean_text, filename, page_num, total_pages, method, 0,
            image_path=image_path,
        ) if clean_text and len(clean_text.strip()) > _MD_MIN_LEN else []

        chunks.extend(text_chunks)
        chunks.extend(table_chunks)

        doc.close()

    except Exception as e:
        import traceback
        print(f"  [WORKER] p.{page_num} error: {e}")
        traceback.print_exc()
        return page_num, [], False, ""

    return page_num, [c.to_dict() for c in chunks], has_visual, image_path


# ──────────────────────────────────────────────────────────────
#  Phase 2 helper — async VLM call for one page
#  v5: reads from saved disk image rather than receiving b64
# ──────────────────────────────────────────────────────────────

async def _vlm_for_page(
    image_path:  str,
    page_num:    int,
    total_pages: int,
    filename:    str,
) -> list[Chunk]:
    """Read PNG from disk, encode to b64, call VLM."""
    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        print(f"  [VLM] ✗ Could not read image {image_path}: {e}")
        return []

    vlm_text = await _call_vlm(b64, page_num, filename)
    if not vlm_text:
        return []

    # image_path is set via _page_image_path inside _save_page_image
    # so it is already consistent with main.py — pass it straight through
    chunks = _smart_chunk(
        text        = f"[VLM | Page {page_num}/{total_pages}]\n{vlm_text}",
        source      = filename,
        page        = page_num,
        total_pages = total_pages,
        method      = "vlm",
        chunk_start = 0,
        image_path  = image_path,
    )
    print(f"  [VLM] p.{page_num} → {len(chunks)} chunks")
    return chunks


# ──────────────────────────────────────────────────────────────
#  Process a full PDF  (two-phase pipeline)
# ──────────────────────────────────────────────────────────────

async def _process_pdf(filepath: str, ollama_up: bool) -> list[Chunk]:
    filename = os.path.basename(filepath)
    print(f"\n{'═'*60}")
    print(f"[LOADER] Processing: {filename}")
    print(f"{'═'*60}")

    cached = _load_cache(filepath)
    if cached is not None:
        return [Chunk(**c) for c in cached]

    all_chunks: list[Chunk] = []

    try:
        doc         = fitz.open(filepath)
        total_pages = len(doc)
        doc.close()

        print(f"  Pages     : {total_pages}")
        print(f"  Workers   : {PHASE1_WORKERS}")
        print(f"  VLM       : {'ON  → ' + VLM_MODEL if ollama_up else 'OFF → images skipped'}")
        print(f"  DPI       : {PAGE_RENDER_DPI} (VLM)  {IMAGE_DPI} (stored images)")
        print(f"  Image dir : {_image_dir_for_file(filename)}")
        print(f"  Save all  : {SAVE_ALL_PAGES}")
        print(f"  MD mode   : {'plain fitz' if SKIP_PYMUPDF4LLM else 'pymupdf4llm → dict → plain (3-tier)'}")
        print(f"  Cache     : {'enabled' if CACHE_CHUNKS else 'disabled'}")

        # ── Phase 1: parallel workers ──────────────────────────
        page_results: dict[int, tuple[list[dict], bool, str]] = {}

        with ProcessPoolExecutor(
            max_workers = PHASE1_WORKERS,
            initializer = _worker_process_init,
        ) as pool:
            futures = {
                pool.submit(
                    _worker_extract_page,
                    filepath, filename, pn, total_pages, ollama_up,
                ): pn
                for pn in range(1, total_pages + 1)
            }

            done = 0
            for future in as_completed(futures):
                pn = futures[future]
                try:
                    page_num, chunk_dicts, has_visual, image_path = future.result()
                    page_results[page_num] = (chunk_dicts, has_visual, image_path)
                except Exception as e:
                    print(f"  [PHASE 1] p.{pn} future error: {e}")
                    page_results[pn] = ([], False, "")

                done += 1
                if done % 50 == 0 or done == total_pages:
                    print(f"  [PHASE 1] {done}/{total_pages} pages processed", flush=True)

        # ── Merge Phase-1 results in page order ───────────────
        running_idx = 0
        vlm_queue: list[tuple[str, int]] = []   # (image_path, page_num)

        for pn in range(1, total_pages + 1):
            chunk_dicts, has_visual, image_path = page_results.get(pn, ([], False, ""))
            for d in chunk_dicts:
                d["chunk_index"] = running_idx
                all_chunks.append(Chunk(**d))
                running_idx += 1
            if has_visual and ollama_up and image_path:
                vlm_queue.append((image_path, pn))

        print(f"\n  [PHASE 1] complete — {running_idx} chunks, "
              f"{len(vlm_queue)} page(s) queued for VLM")

        # ── Phase 2: concurrent VLM calls ─────────────────────
        if vlm_queue and ollama_up:
            batch_size    = VLM_MAX_CONCURRENT
            total_batches = (len(vlm_queue) + batch_size - 1) // batch_size
            print(f"  [PHASE 2] {len(vlm_queue)} page(s) → "
                  f"{total_batches} batch(es) of ≤{batch_size}")

            for b_idx in range(0, len(vlm_queue), batch_size):
                batch     = vlm_queue[b_idx: b_idx + batch_size]
                batch_num = b_idx // batch_size + 1
                print(f"  [PHASE 2] batch {batch_num}/{total_batches} "
                      f"— pages {[pnum for _, pnum in batch]}", flush=True)

                batch_results: list[list[Chunk]] = await asyncio.gather(*[
                    _vlm_for_page(img_path, pnum, total_pages, filename)
                    for img_path, pnum in batch
                ])

                for vlm_chunks in batch_results:
                    for c in vlm_chunks:
                        c.chunk_index = running_idx
                        running_idx  += 1
                    all_chunks.extend(vlm_chunks)

    except Exception as e:
        import traceback
        print(f"\n[LOADER] ✗ Failed: {filename}: {e}")
        traceback.print_exc()
        return []
    finally:
        await _close_client()

    n_text  = sum(1 for c in all_chunks if c.type == "text")
    n_table = sum(1 for c in all_chunks if c.type == "table")
    n_vlm   = sum(1 for c in all_chunks if c.type == "vlm")

    print(f"\n[LOADER] ✓ {filename}")
    print(f"  Total : {len(all_chunks)} chunks  "
          f"(text={n_text}  table={n_table}  vlm={n_vlm})")

    _save_cache(filepath, [c.to_dict() for c in all_chunks])
    return all_chunks


# ──────────────────────────────────────────────────────────────
#  Public API
# ──────────────────────────────────────────────────────────────

async def load_single_file_async(filepath: str, filename: str) -> list[dict]:
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        ollama_up = (
            False
            if os.getenv("SKIP_VLM", "false").lower() == "true"
            else await _ollama_available()
        )
        print(f"[LOADER] Ollama: "
              f"{'UP  → ' + VLM_MODEL if ollama_up else 'DOWN → images skipped'}")
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
        print(f"[LOADER] Unsupported extension: {filename}")
        return []


def load_single_file(filepath: str, filename: str) -> list[dict]:
    return asyncio.run(load_single_file_async(filepath, filename))


async def load_documents_async(docs_dir: str = DOCS_DIR) -> list[dict]:
    pdf_files = sorted(glob.glob(f"{docs_dir}/**/*.pdf", recursive=True))
    txt_files = sorted(glob.glob(f"{docs_dir}/**/*.txt", recursive=True))

    print(f"\n[LOADER] {len(pdf_files)} PDF(s), {len(txt_files)} TXT(s) in '{docs_dir}'")
    ollama_up = await _ollama_available()
    print(f"[LOADER] Ollama: "
          f"{'UP  → ' + VLM_MODEL if ollama_up else 'DOWN → images skipped'}")

    all_chunks: list[Chunk] = []

    for filepath in pdf_files:
        all_chunks.extend(await _process_pdf(filepath, ollama_up))

    for filepath in txt_files:
        fn = os.path.basename(filepath)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            chunks = _smart_chunk(content, fn, None, 1, "plain_text", 0)
            all_chunks.extend(chunks)
            print(f"[LOADER] ✓ {fn} → {len(chunks)} chunks")
        except Exception as e:
            print(f"[LOADER] ✗ {filepath}: {e}")

    print(f"\n[LOADER] TOTAL: {len(all_chunks)}  "
          f"text={sum(1 for c in all_chunks if c.type=='text')}  "
          f"table={sum(1 for c in all_chunks if c.type=='table')}  "
          f"vlm={sum(1 for c in all_chunks if c.type=='vlm')}")

    return [c.to_dict() for c in all_chunks]


def load_documents(docs_dir: str = DOCS_DIR) -> list[dict]:
    return asyncio.run(load_documents_async(docs_dir))


# ──────────────────────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, pprint

    p = argparse.ArgumentParser(description="Document Loader v5 (page image storage)")
    p.add_argument("--docs-dir",    default=DOCS_DIR)
    p.add_argument("--file",        default=None)
    p.add_argument("--json",        action="store_true")
    p.add_argument("--no-cache",    action="store_true", help="Ignore + overwrite cache")
    args = p.parse_args()

    if args.no_cache:
        os.environ["CACHE_CHUNKS"] = "false"

    chunks = (load_single_file(args.file, os.path.basename(args.file))
              if args.file else load_documents(args.docs_dir))

    if args.json:
        print(json.dumps(chunks, indent=2, ensure_ascii=False))
    else:
        print(f"\nLoaded {len(chunks)} chunks.")
        if chunks:
            print("\nFirst chunk:")
            pprint.pprint(chunks[0])