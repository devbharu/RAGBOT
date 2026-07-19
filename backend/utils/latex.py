"""
latex.py — LaTeX PDF compilation utility using pdflatex.
"""

import os
import shutil
import tempfile
import subprocess
from utils.telemetry import logger

def compile_latex_source(latex_source: str) -> str:
    """
    Compiles LaTeX markup source code into a PDF binary.
    Returns the absolute path to the generated PDF file inside a temporary directory.
    Caller is responsible for cleaning up the directory or files.
    """
    tmp_dir = tempfile.mkdtemp()
    tex_path = os.path.join(tmp_dir, "report.tex")
    pdf_path = os.path.join(tmp_dir, "report.pdf")
    
    try:
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_source)
        
        # Compile twice to resolve cross-references/TOC
        for i in range(2):
            logger.info(f"[LATEX] pdflatex compilation run {i+1}/2...")
            result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", "-output-directory", tmp_dir, tex_path],
                capture_output=True,
                text=True,
                timeout=120,
            )
        
        if not os.path.exists(pdf_path):
            log_tail = result.stdout[-2000:] if result.stdout else result.stderr[-2000:]
            raise RuntimeError(f"pdflatex did not produce PDF output. Log: {log_tail}")
            
        return pdf_path
        
    except subprocess.TimeoutExpired as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise TimeoutError("LaTeX compilation timed out") from e
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise e
