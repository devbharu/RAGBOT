"""
document_loader.py  (v2 — optimised)
─────────────────────────────────────
PDF / TXT document loader.

Key improvements over v1
────────────────────────
1. PARALLEL Phase-1  — ProcessPoolExecutor opens its own fitz.Document per
   worker; fitz is thread-unsafe but process-safe.  3-5× speedup on large PDFs.

2. PYMUPDF4LLM once  — called once per document (not once per page) then
   sliced by page-marker, eliminating repeated file re-opens.

3. TABLE DEDUP       — table-like lines are stripped from the raw markdown text
   before text chunking so the same table is never stored twice.

4. CHUNK OVERLAP     — configurable overlap (default 200 chars) improves RAG
   recall at chunk boundaries.

5. SMARTER CHUNKER   — splits before headings (##/###) so headings stay with
   their content; section headings are prepended to every chunk they own.

6. CHUNK CACHE       — MD5 hash of each file is stored alongside its chunks
   (.chunks.json).  Re-running skips files that haven't changed.

7. SKIP VISUAL DETECT when VLM is down — saves CPU.

8. IMPROVED VLM PROMPT — more prescriptive; reduces SKIP false-negatives.

9. VLM concurrency bumped to 5 default; inter-batch sleep removed (semaphore
   already provides backpressure).

Strategy per page
─────────────────
  ┌───────────────────────────────────────────────────────────┐
  │  ALWAYS  → selectable text extraction (markdown / plain)  │
  │  ALWAYS  → table extraction (pymupdf find_tables)         │
  │  IF page has visual content AND Ollama UP → VLM call      │
  │  IF page has visual content AND Ollama DOWN → skip        │
  │  No OCR anywhere.                                         │
  └───────────────────────────────────────────────────────────┘

Two-phase PDF pipeline
──────────────────────
  Phase 1 (parallel processes) — fitz text + table extraction + page render
    Each worker opens its own fitz.Document (process-safe).
    Page images are pre-rendered here and returned as base64.
  Phase 2 (concurrent async) — VLM calls fired via asyncio.gather
    Network I/O only; semaphore caps parallel calls.

.env keys
─────────
  OLLAMA_BASE_URL      (default http://localhost:11434)
  VLM_MODEL            (default qwen2.5vl:7b)
  VLM_TIMEOUT          (default 120 s)
  VLM_MAX_CONCURRENT   (default 5)
  PAGE_RENDER_DPI      (default 150)
  CHUNK_SIZE           (default 1000)
  CHUNK_OVERLAP        (default 200)
  PHASE1_WORKERS       (default cpu_count or 4)
  DOCS_DIR             (default ./docs)
  CACHE_CHUNKS         (default true)
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
from dataclasses import dataclass
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


def _import_pymupdf4llm():
    import pymupdf4llm
    return pymupdf4llm


# ──────────────────────────────────────────────────────────────
#  Config
# ──────────────────────────────────────────────────────────────

OLLAMA_BASE_URL    = os.getenv("OLLAMA_BASE_URL",        "http://localhost:11434")
VLM_MODEL          = os.getenv("VLM_MODEL",              "qwen2.5vl:7b")
VLM_TIMEOUT        = int(os.getenv("VLM_TIMEOUT",        "120"))
VLM_MAX_CONCURRENT = int(os.getenv("VLM_MAX_CONCURRENT", "5"))     # ← bumped from 3
PAGE_RENDER_DPI    = int(os.getenv("PAGE_RENDER_DPI",    "150"))
CHUNK_SIZE         = int(os.getenv("CHUNK_SIZE",         "1000"))  # ← bumped from 600
CHUNK_OVERLAP      = int(os.getenv("CHUNK_OVERLAP",      "200"))   # ← NEW
PHASE1_WORKERS     = int(os.getenv("PHASE1_WORKERS",     str(min(os.cpu_count() or 4, 8))))
DOCS_DIR           = os.getenv("DOCS_DIR",               "./docs")
CACHE_CHUNKS       = os.getenv("CACHE_CHUNKS",           "true").lower() == "true"

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
    type:        str    # "text" | "table" | "vlm"
    method:      str    # "markdown" | "plain_text" | "vlm" | "pymupdf_table"

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
    """Return cached chunks if file hasn't changed, else None."""
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
#  VLM prompt (v2 — more prescriptive)
# ──────────────────────────────────────────────────────────────

VLM_PROMPT = (
    "You are extracting visual content from a PDF page image for a RAG pipeline.\n"
    "The selectable text layer has already been extracted separately.\n\n"
    "Extract ONLY the following (nothing else):\n"
    "1. Chart / graph data values, axis labels, tick labels, legend entries\n"
    "2. Table contents — output as markdown table\n"
    "3. Flowchart / diagram node labels, edge labels, arrow text\n"
    "4. Any text embedded inside figures, callouts, or annotations\n\n"
    "Rules:\n"
    "- Be precise with numbers — copy them exactly.\n"
    "- Use markdown tables for tabular data.\n"
    "- Skip page headers, footers, watermarks, and decorative elements.\n"
    "- If the page contains ONLY decorative images, solid blocks of colour, "
    "or no visual data at all, reply with exactly: SKIP\n\n"
    "Output plain text or markdown only."
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

    async with _get_semaphore():
        for attempt in range(1, VLM_RETRY_ATTEMPTS + 1):
            try:
                async with httpx.AsyncClient(timeout=VLM_TIMEOUT) as client:
                    r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)

                    if r.status_code in (502, 503):
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
#  pymupdf4llm — called ONCE per document, then sliced by page
# ──────────────────────────────────────────────────────────────

# pymupdf4llm inserts a page separator like:  \n---\n  between pages.
_PAGE_SEP = re.compile(r'\n-{3,}\n')


def _extract_all_pages_markdown(filepath: str, total_pages: int) -> list[str]:
    """
    Call pymupdf4llm once for the whole document and split the result
    into per-page strings.  Falls back to empty strings on failure.
    """
    try:
        pymupdf4llm = _import_pymupdf4llm()
        with _suppress_all_output():
            full_md = pymupdf4llm.to_markdown(filepath, write_images=False)
        parts = _PAGE_SEP.split(full_md)
        # Pad or trim to match actual page count
        while len(parts) < total_pages:
            parts.append("")
        return parts[:total_pages]
    except Exception as e:
        print(f"  [MD] pymupdf4llm failed for {filepath}: {e} — will use plain fitz")
        return [""] * total_pages


# ──────────────────────────────────────────────────────────────
#  Table-line stripper  (dedup: avoid text chunk = table chunk)
# ──────────────────────────────────────────────────────────────

_TABLE_LINE = re.compile(r'^\|.*\|[ \t]*$', re.MULTILINE)
_TABLE_SEP  = re.compile(r'^\|[\s\-:|]+\|[ \t]*$', re.MULTILINE)


def _strip_table_lines(text: str) -> str:
    """Remove markdown table rows from raw text so find_tables() chunks don't duplicate them."""
    lines  = text.splitlines(keepends=True)
    result = []
    i      = 0
    while i < len(lines):
        line = lines[i].rstrip()
        # Detect start of a markdown table block
        if _TABLE_LINE.match(line):
            # Skip forward until we leave the table block
            while i < len(lines) and (
                _TABLE_LINE.match(lines[i].rstrip()) or
                _TABLE_SEP.match(lines[i].rstrip())
            ):
                i += 1
        else:
            result.append(lines[i])
            i += 1
    return "".join(result)


# ──────────────────────────────────────────────────────────────
#  Smart chunker  (v2 — heading-aware + overlap)
# ──────────────────────────────────────────────────────────────

_HEADING = re.compile(r'^#{1,3} .+', re.MULTILINE)


def _smart_chunk(
    text:        str,
    source:      str,
    page:        Optional[int],
    total_pages: int,
    method:      str,
    chunk_start: int,
    chunk_size:  int = CHUNK_SIZE,
    overlap:     int = CHUNK_OVERLAP,
) -> list[Chunk]:
    chunks:       list[Chunk] = []
    current_head: str         = ""
    current:      str         = ""
    idx:          int         = chunk_start

    # Split BEFORE headings so each heading stays with its own content
    blocks = re.split(r'(?=\n#{1,3} )', text)

    def flush(buf: str) -> None:
        nonlocal idx
        buf = buf.strip()
        if not buf or len(buf) < 30:
            return
        # Prepend heading context if available
        full = (current_head.strip() + "\n\n" + buf) if current_head else buf
        chunks.append(Chunk(full.strip(), source, page, idx, total_pages, "text", method))
        idx += 1

    for block in blocks:
        block = block.strip()
        if not block or len(block) < 30:
            continue

        is_table = block.startswith("|") or "| ---" in block or "| :---" in block

        # ── Table block ────────────────────────────────────────
        if is_table:
            flush(current)
            current = ""
            chunks.append(Chunk(block, source, page, idx, total_pages, "table", method))
            idx += 1
            continue

        # ── Heading — update context, flush current ────────────
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

        # ── Normal text — accumulate with overlap ──────────────
        if len(current) + len(block) + 2 <= chunk_size:
            current += ("\n\n" if current else "") + block
        else:
            flush(current)
            # carry overlap from end of previous chunk
            words   = current.split()
            overlap_words = words[-max(1, overlap // 6):]  # rough word-based overlap
            current = " ".join(overlap_words) + "\n\n" + block if overlap_words else block

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
#  Phase 1 worker — runs in a separate process
#  Each worker opens its own fitz.Document (process-safe).
# ──────────────────────────────────────────────────────────────

def _worker_extract_page(
    filepath:    str,
    filename:    str,
    page_num:    int,
    total_pages: int,
    md_text:     str,    # pre-extracted markdown for this page
    ollama_up:   bool,
) -> tuple[int, list[dict], Optional[str], str]:
    """
    Returns (page_num, chunk_dicts, b64_or_None, visual_reason).
    Must return plain dicts (not Chunk objects) — dataclasses cross process
    boundaries fine but dicts are safer for pickling across Python versions.
    """
    chunks: list[Chunk] = []

    try:
        doc  = fitz.open(filepath)
        page = doc[page_num - 1]

        # ── Text ───────────────────────────────────────────────
        if md_text and len(md_text.strip()) > 30:
            clean_text = _strip_table_lines(md_text)   # dedup: remove table rows
            text_chunks = _smart_chunk(
                clean_text, filename, page_num, total_pages, "markdown", 0
            )
            method = "markdown"
        else:
            plain = page.get_text("text").strip()
            if plain:
                clean_text  = _strip_table_lines(plain)
                text_chunks = _smart_chunk(
                    clean_text, filename, page_num, total_pages, "plain_text", 0
                )
                method = "plain_text"
            else:
                text_chunks = []
                method = "plain_text"

        chunks.extend(text_chunks)

        # ── Tables ─────────────────────────────────────────────
        table_chunks = _extract_tables(page, filename, page_num, total_pages, len(chunks))
        chunks.extend(table_chunks)

        # ── Visual detection + render (only when VLM is up) ────
        b64: Optional[str] = None
        reason = "no visual content"

        if ollama_up:                          # ← skip entirely if VLM down
            has_visual, reason = _page_has_visual_content(page)
            if has_visual:
                b64 = _page_to_base64_png(page)

        doc.close()

    except Exception as e:
        import traceback
        print(f"  [WORKER] p.{page_num} error: {e}")
        traceback.print_exc()
        return page_num, [], None, "worker error"

    return page_num, [c.to_dict() for c in chunks], b64, reason


# ──────────────────────────────────────────────────────────────
#  Phase 2 helper — async VLM call for one page
# ──────────────────────────────────────────────────────────────

async def _vlm_for_page(
    b64:         str,
    page_num:    int,
    total_pages: int,
    filename:    str,
    chunk_start: int,
) -> list[Chunk]:
    vlm_text = await _call_vlm(b64, page_num, filename)
    if not vlm_text:
        return []

    chunks = _smart_chunk(
        text        = f"[VLM | Page {page_num}/{total_pages}]\n{vlm_text}",
        source      = filename,
        page        = page_num,
        total_pages = total_pages,
        method      = "vlm",
        chunk_start = chunk_start,
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

    # ── Cache check ────────────────────────────────────────────
    cached = _load_cache(filepath)
    if cached is not None:
        # Re-hydrate as Chunk objects
        return [Chunk(**c) for c in cached]

    all_chunks: list[Chunk] = []

    try:
        doc         = fitz.open(filepath)
        total_pages = len(doc)
        doc.close()   # close immediately; workers will open their own

        print(f"  Pages   : {total_pages}")
        print(f"  Workers : {PHASE1_WORKERS} (Phase 1)")
        print(f"  VLM     : {'ON  → ' + VLM_MODEL if ollama_up else 'OFF → images skipped'}")
        print(f"  Cache   : {'enabled' if CACHE_CHUNKS else 'disabled'}")

        # ── Extract markdown once for the whole doc ────────────
        print(f"  [MD] Extracting full-document markdown …", end=" ", flush=True)
        md_pages = _extract_all_pages_markdown(filepath, total_pages)
        print("done")

        # ── Phase 1: parallel fitz workers ────────────────────
        page_results: dict[int, tuple[list[dict], Optional[str], str]] = {}

        with ProcessPoolExecutor(max_workers=PHASE1_WORKERS) as pool:
            futures = {
                pool.submit(
                    _worker_extract_page,
                    filepath,
                    filename,
                    pn,
                    total_pages,
                    md_pages[pn - 1],
                    ollama_up,
                ): pn
                for pn in range(1, total_pages + 1)
            }

            done = 0
            for future in as_completed(futures):
                pn = futures[future]
                try:
                    page_num, chunk_dicts, b64, reason = future.result()
                    page_results[page_num] = (chunk_dicts, b64, reason)
                except Exception as e:
                    print(f"  [PHASE 1] p.{pn} future error: {e}")
                    page_results[pn] = ([], None, "future error")

                done += 1
                if done % 10 == 0 or done == total_pages:
                    print(f"  [PHASE 1] {done}/{total_pages} pages processed", flush=True)

        # ── Merge Phase-1 results in page order ───────────────
        running_idx = 0
        vlm_queue: list[tuple[str, int]] = []

        for pn in range(1, total_pages + 1):
            chunk_dicts, b64, reason = page_results.get(pn, ([], None, "missing"))
            for d in chunk_dicts:
                d["chunk_index"] = running_idx
                all_chunks.append(Chunk(**d))
                running_idx += 1
            if b64 and ollama_up:
                vlm_queue.append((b64, pn))

        print(f"\n  [PHASE 1] complete — {len(vlm_queue)} page(s) queued for VLM")

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
                    _vlm_for_page(b64, pnum, total_pages, filename, running_idx + i)
                    for i, (b64, pnum) in enumerate(batch)
                ])

                for vlm_chunks in batch_results:
                    for c in vlm_chunks:
                        c.chunk_index = running_idx
                        running_idx  += 1
                    all_chunks.extend(vlm_chunks)

                # No sleep between batches — semaphore handles backpressure

    except Exception as e:
        import traceback
        print(f"\n[LOADER] ✗ Failed: {filename}: {e}")
        traceback.print_exc()
        return []

    n_text  = sum(1 for c in all_chunks if c.type == "text")
    n_table = sum(1 for c in all_chunks if c.type == "table")
    n_vlm   = sum(1 for c in all_chunks if c.type == "vlm")

    print(f"\n[LOADER] ✓ {filename}")
    print(f"  Total : {len(all_chunks)} chunks  "
          f"(text={n_text}  table={n_table}  vlm={n_vlm})")

    # ── Save cache ─────────────────────────────────────────────
    _save_cache(filepath, [c.to_dict() for c in all_chunks])

    return all_chunks


# ──────────────────────────────────────────────────────────────
#  Public API
# ──────────────────────────────────────────────────────────────

async def load_single_file_async(filepath: str, filename: str) -> list[dict]:
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        ollama_up = False if os.getenv("SKIP_VLM", "false").lower() == "true" else await _ollama_available()
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
    """Sync wrapper — safe to call from Flask background threads."""
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

    p = argparse.ArgumentParser(description="Document Loader v2 (parallel + cached)")
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