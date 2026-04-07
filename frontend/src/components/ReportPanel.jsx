/**
 * ReportPanel.jsx — Enhanced Overleaf-style editor + PDF preview
 * Monaco LaTeX editor (plain/no-color) + compile-to-PDF via Flask backend
 * Updated: white base text, gold accent highlights only
 */

import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";

// ── constants ──────────────────────────────────────────────────
const AGENT_STEPS = [
    { key: "fetch", icon: "◈", label: "Fetching chunks from vector DB" },
    { key: "structure", icon: "⬡", label: "Discovering PDF structure & sections" },
    { key: "fanout", icon: "⟁", label: "Spawning parallel section writers" },
    { key: "write", icon: "▦", label: "Writing sections concurrently" },
    { key: "reduce", icon: "⊟", label: "Stitching sections in order" },
    { key: "done", icon: "✦", label: "Report ready" },
];

const MAX_CUSTOM_SECTIONS = 15;
const MIN_CUSTOM_SECTIONS = 1;
const STEP_INTERVAL = 8000;
const MAX_RETRIES = 2;
const SESSION_HINT_KEY = "rp_query_hint";

// ── helpers ────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanName = (s = "") =>
    s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

// Monaco "plain" theme — bright text, no syntax coloring
const PLAIN_THEME = {
    base: "vs-dark",
    inherit: false,
    rules: [
        { token: "", foreground: "e2e0db" },
        { token: "comment", foreground: "e2e0db" },
        { token: "string", foreground: "e2e0db" },
        { token: "keyword", foreground: "e2e0db" },
        { token: "number", foreground: "e2e0db" },
        { token: "operator", foreground: "e2e0db" },
        { token: "type", foreground: "e2e0db" },
        { token: "identifier", foreground: "e2e0db" },
        { token: "delimiter", foreground: "e2e0db" },
        { token: "tag", foreground: "e2e0db" },
        { token: "attribute", foreground: "e2e0db" },
        { token: "metatag", foreground: "e2e0db" },
        { token: "variable", foreground: "e2e0db" },
        { token: "regexp", foreground: "e2e0db" },
        { token: "annotation", foreground: "e2e0db" },
    ],
    colors: {
        "editor.background": "#0d0d10",
        "editor.foreground": "#e2e0db",
        "editor.lineHighlightBackground": "#13131a",
        "editor.selectionBackground": "#252535",
        "editorCursor.foreground": "#c8a96e",
        "editorLineNumber.foreground": "#252535",
        "editorLineNumber.activeForeground": "#58586a",
        "editorIndentGuide.background": "#18181f",
        "editorIndentGuide.activeBackground": "#222230",
        "scrollbarSlider.background": "#1a1a24",
        "scrollbarSlider.hoverBackground": "#22222e",
        "scrollbarSlider.activeBackground": "#2a2a38",
    },
};

// ── component ──────────────────────────────────────────────────
export default function ReportPanel({
    filename,
    apiBase = "http://localhost:8080",
    onReportReady,
}) {
    // ── state ────────────────────────────────────────────────────
    const [tab, setTab] = useState("editor");
    const [report, setReport] = useState(null);
    const [latexSource, setLatexSource] = useState("");
    const [pdfUrl, setPdfUrl] = useState(null);
    const [compiling, setCompiling] = useState(false);
    const [compileError, setCompileError] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [stepIdx, setStepIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const [staleWarning, setStaleWarning] = useState(false);
    const [useCustomSections, setUseCustomSections] = useState(false);
    const [customSections, setCustomSections] = useState([""]);
    const [pdfModalOpen, setPdfModalOpen] = useState(false);
    const [editorReady, setEditorReady] = useState(false);
    const [queryHint, setQueryHint] = useState(() => {
        try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch { return ""; }
    });

    const stepTimer = useRef(null);
    const abortRef = useRef(null);
    const prevFile = useRef(filename);
    const pdfUrlRef = useRef(null);
    const monacoRef = useRef(null);

    const persistHint = (v) => {
        setQueryHint(v);
        try { sessionStorage.setItem(SESSION_HINT_KEY, v); } catch { }
    };

    // ── stale warning ────────────────────────────────────────────
    useEffect(() => {
        if (report && filename !== prevFile.current) setStaleWarning(true);
        prevFile.current = filename;
    }, [filename, report]);

    // ── step ticker ──────────────────────────────────────────────
    useEffect(() => {
        if (loading) {
            setStepIdx(0);
            stepTimer.current = setInterval(
                () => setStepIdx((i) => Math.min(i + 1, AGENT_STEPS.length - 2)),
                STEP_INTERVAL,
            );
        } else {
            clearInterval(stepTimer.current);
            if (!error) setStepIdx(AGENT_STEPS.length - 1);
        }
        return () => clearInterval(stepTimer.current);
    }, [loading, error]);

    // ── cleanup blob URL ─────────────────────────────────────────
    useEffect(() => {
        return () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); };
    }, []);

    // ── Escape closes modal ──────────────────────────────────────
    useEffect(() => {
        const handler = (e) => { if (e.key === "Escape") setPdfModalOpen(false); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    // ── register plain theme when Monaco mounts ──────────────────
    const handleEditorMount = (editor, monaco) => {
        monacoRef.current = monaco;
        monaco.editor.defineTheme("rp-plain", PLAIN_THEME);
        monaco.editor.setTheme("rp-plain");
        setEditorReady(true);
    };

    // ── generate report ──────────────────────────────────────────
    const generate = useCallback(async () => {
        if (!filename || loading) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoading(true);
        setError("");
        setReport(null);
        setLatexSource("");
        setPdfUrl(null);
        setCopied(false);
        setStaleWarning(false);
        setCompileError("");

        const validCustom = customSections.map((s) => s.trim()).filter(Boolean);
        const sectionsPayload = useCustomSections && validCustom.length > 0 ? validCustom : [];

        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
            try {
                if (attempt > 0) await sleep(600 * 2 ** attempt);
                const res = await fetch(`${apiBase}/generate-report`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: ctrl.signal,
                    body: JSON.stringify({ filename, query_hint: queryHint.trim(), sections: sectionsPayload }),
                });
                if (!res.ok) {
                    const retryable = res.status === 429 || res.status >= 500;
                    if (retryable && attempt < MAX_RETRIES) { attempt++; continue; }
                    const e = await res.json().catch(() => ({}));
                    throw new Error(e.error || `Server error ${res.status}`);
                }
                const data = await res.json();
                setReport(data);
                setLatexSource(data.latex || "");
                setTab("editor");
                onReportReady?.(data);
                break;
            } catch (e) {
                if (e.name === "AbortError") { setError("Cancelled."); break; }
                if (attempt >= MAX_RETRIES) {
                    setError(
                        e instanceof TypeError
                            ? "Network error — check connection."
                            : e.message || "Unexpected error.",
                    );
                    break;
                }
                attempt++;
            }
        }
        setLoading(false);
    }, [filename, loading, queryHint, customSections, useCustomSections, apiBase, onReportReady]);

    // ── compile LaTeX → PDF ──────────────────────────────────────
    const compileToPdf = useCallback(async () => {
        if (!latexSource || compiling) return;
        setCompiling(true);
        setCompileError("");
        if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
        setPdfUrl(null);

        try {
            const res = await fetch(`${apiBase}/compile-latex`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ latex: latexSource }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || `Compile failed: ${res.status}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            pdfUrlRef.current = url;
            setPdfUrl(url);
            setPdfModalOpen(true);
        } catch (e) {
            setCompileError(e.message || "Compilation failed");
        } finally {
            setCompiling(false);
        }
    }, [latexSource, compiling, apiBase]);

    const cancel = () => abortRef.current?.abort();

    // ── downloads ────────────────────────────────────────────────
    const downloadTex = () => {
        if (!latexSource) return;
        const url = URL.createObjectURL(new Blob([latexSource], { type: "text/plain" }));
        Object.assign(document.createElement("a"), { href: url, download: cleanName(filename) + "_report.tex" }).click();
        URL.revokeObjectURL(url);
    };
    const downloadPdf = () => {
        if (!pdfUrl) return;
        Object.assign(document.createElement("a"), { href: pdfUrl, download: cleanName(filename) + "_report.pdf" }).click();
    };
    const copyLatex = () => {
        if (!latexSource) return;
        navigator.clipboard.writeText(latexSource).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // ── custom sections ──────────────────────────────────────────
    const addCustom = () => customSections.length < MAX_CUSTOM_SECTIONS && setCustomSections((s) => [...s, ""]);
    const updateCustom = (i, v) => setCustomSections((s) => s.map((x, j) => (j === i ? v : x)));
    const removeCustom = (i) =>
        customSections.length > MIN_CUSTOM_SECTIONS && setCustomSections((s) => s.filter((_, j) => j !== i));

    const discoveredSections = report?.sections?.filter((s) => s?.name) || [];

    const TABS = [
        { key: "editor", label: "Editor", show: true },
        { key: "sections", label: `Sections · ${discoveredSections.length}`, show: discoveredSections.length > 0 },
        { key: "config", label: "Config", show: true },
    ].filter((t) => t.show);

    // ── render ───────────────────────────────────────────────────
    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link
                href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap"
                rel="stylesheet"
            />
            <style>{CSS}</style>

            <div className="rp-root">

                {/* ── Top bar ─────────────────────────────────────────── */}
                <header className="rp-topbar">
                    <div className="rp-brand">
                        <span className="rp-brand-icon">◈</span>
                        <span className="rp-brand-text">Report Engine</span>
                    </div>
                    <div className="rp-topbar-right">
                        {filename && (
                            <div className="rp-file-tag" title={filename}>
                                <span className="rp-file-dot" />
                                <span className="rp-file-name">{cleanName(filename)}</span>
                            </div>
                        )}
                    </div>
                </header>

                {/* ── Stale warning ───────────────────────────────────── */}
                {staleWarning && (
                    <div className="rp-stale" role="alert">
                        <span className="rp-stale-icon">⚠</span>
                        File changed — re-generate to refresh.
                    </div>
                )}

                {/* ── Main body ───────────────────────────────────────── */}
                <div className="rp-body">

                    {/* ── Left column — controls ──────────────────────── */}
                    <div className="rp-sidebar">

                        {/* Query hint */}
                        <div className="rp-field">
                            <label className="rp-label">
                                Focus / topic
                                <span className="rp-label-note">optional</span>
                            </label>
                            <input
                                className="rp-input"
                                type="text"
                                placeholder="e.g. explain each chapter in detail…"
                                value={queryHint}
                                onChange={(e) => persistHint(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && !loading && filename && generate()}
                                disabled={loading}
                            />
                        </div>

                        {/* Toggle */}
                        <label className="rp-toggle">
                            <input
                                type="checkbox"
                                checked={useCustomSections}
                                onChange={(e) => setUseCustomSections(e.target.checked)}
                                disabled={loading}
                            />
                            <span className="rp-toggle-track" />
                            <span className="rp-toggle-label">Custom sections</span>
                        </label>

                        <div className="rp-divider" />

                        {/* Generate */}
                        <button
                            className="rp-btn-primary"
                            onClick={generate}
                            disabled={loading || !filename}
                            aria-busy={loading}
                        >
                            {loading
                                ? <><span className="rp-spinner" />Generating…</>
                                : <><span className="rp-btn-icon-sym">✦</span>Generate report</>}
                        </button>

                        {loading && (
                            <button className="rp-btn-ghost rp-btn-cancel" onClick={cancel}>
                                Cancel
                            </button>
                        )}

                        {/* Compile */}
                        {latexSource && !loading && (
                            <button className="rp-btn-compile" onClick={compileToPdf} disabled={compiling}>
                                {compiling
                                    ? <><span className="rp-spinner rp-spinner--teal" />Compiling…</>
                                    : <><span className="rp-btn-icon-sym">⬡</span>Compile → PDF</>}
                            </button>
                        )}

                        {/* View PDF */}
                        {pdfUrl && !loading && (
                            <button className="rp-btn-ghost" onClick={() => setPdfModalOpen(true)}>
                                <span className="rp-btn-icon-sym">◈</span>View PDF
                            </button>
                        )}

                        {/* Download / copy row */}
                        {latexSource && !loading && (
                            <div className="rp-dl-row">
                                <button className="rp-btn-ghost rp-btn-sm" onClick={copyLatex}>
                                    {copied ? "✓ Copied" : "⊕ Copy .tex"}
                                </button>
                                <button className="rp-btn-ghost rp-btn-sm" onClick={downloadTex}>↓ .tex</button>
                                {pdfUrl && (
                                    <button className="rp-btn-ghost rp-btn-sm" onClick={downloadPdf}>↓ .pdf</button>
                                )}
                            </div>
                        )}

                        {/* Errors */}
                        {error && (
                            <div className="rp-error" role="alert">
                                <span className="rp-error-icon">✗</span>
                                <span>{error}</span>
                                {!error.includes("Cancelled") && (
                                    <button className="rp-link" onClick={generate}>Retry</button>
                                )}
                            </div>
                        )}
                        {compileError && (
                            <div className="rp-error" role="alert">
                                <span className="rp-error-icon">✗</span>
                                <span>Compile: {compileError}</span>
                            </div>
                        )}

                        {/* Progress */}
                        {loading && (
                            <div className="rp-progress" role="status" aria-live="polite">
                                <div className="rp-progress-head">
                                    <span className="rp-progress-title">Processing</span>
                                    <span className="rp-progress-sub">{AGENT_STEPS[stepIdx]?.label}</span>
                                </div>
                                <div className="rp-step-grid">
                                    {AGENT_STEPS.slice(0, -1).map((step, i) => {
                                        const active = i === stepIdx;
                                        const done = i < stepIdx;
                                        return (
                                            <div key={step.key} className={`rp-step${active ? " active" : done ? " done" : ""}`}>
                                                <span className="rp-step-icon">{step.icon}</span>
                                                <span className="rp-step-lbl">{step.label}</span>
                                                {active && <span className="rp-step-pulse" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Right column — editor + tabs ────────────────── */}
                    <div className="rp-main">

                        {/* Tab bar */}
                        <div className="rp-tabbar" role="tablist">
                            {TABS.map((t) => (
                                <button
                                    key={t.key}
                                    role="tab"
                                    aria-selected={tab === t.key}
                                    className={`rp-tab${tab === t.key ? " active" : ""}`}
                                    onClick={() => setTab(t.key)}
                                >
                                    {t.label}
                                </button>
                            ))}
                            {latexSource && (
                                <span className="rp-tab-status">
                                    {latexSource.split("\n").length.toLocaleString()} lines
                                </span>
                            )}
                        </div>

                        {/* ── Editor ──────────────────────────────────────── */}
                        {tab === "editor" && (
                            <div className="rp-editor-wrap">
                                {latexSource ? (
                                    <Editor
                                        height="100%"
                                        defaultLanguage="latex"
                                        value={latexSource}
                                        onChange={(v) => setLatexSource(v || "")}
                                        theme="rp-plain"
                                        onMount={handleEditorMount}
                                        options={{
                                            fontSize: 13.5,
                                            fontFamily: "'DM Mono', 'Fira Code', monospace",
                                            fontLigatures: true,
                                            lineNumbers: "on",
                                            minimap: { enabled: false },
                                            wordWrap: "on",
                                            scrollBeyondLastLine: false,
                                            renderLineHighlight: "line",
                                            padding: { top: 20, bottom: 20 },
                                            smoothScrolling: true,
                                            cursorBlinking: "smooth",
                                            cursorSmoothCaretAnimation: true,
                                            lineHeight: 1.75,
                                            letterSpacing: 0.3,
                                            renderWhitespace: "none",
                                            overviewRulerBorder: false,
                                            hideCursorInOverviewRuler: true,
                                            scrollbar: { verticalScrollbarSize: 3, horizontalScrollbarSize: 3 },
                                        }}
                                    />
                                ) : (
                                    <div className="rp-empty">
                                        {filename ? (
                                            <>
                                                <div className="rp-empty-glyph">∴</div>
                                                <div className="rp-empty-title">Ready to generate</div>
                                                <p className="rp-empty-desc">
                                                    Sections are auto-discovered from the PDF structure.<br />
                                                    Output will be a compilable LaTeX document.
                                                </p>
                                                <button className="rp-btn-primary" onClick={generate} style={{ marginTop: 28 }}>
                                                    <span className="rp-btn-icon-sym">✦</span>Generate report
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <div className="rp-empty-glyph">⬡</div>
                                                <div className="rp-empty-title">No document selected</div>
                                                <p className="rp-empty-desc">Select a PDF to generate a report.</p>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Sections tab ──────────────────────────────── */}
                        {tab === "sections" && discoveredSections.length > 0 && (
                            <div className="rp-tab-content">
                                <p className="rp-note">
                                    Auto-discovered {discoveredSections.length} sections from PDF structure
                                </p>
                                <div className="rp-sec-list">
                                    {discoveredSections.map((sec, i) => (
                                        <div key={i} className="rp-sec-row">
                                            <span className="rp-sec-num">{String(i + 1).padStart(2, "0")}</span>
                                            <span className="rp-sec-name">{sec.name}</span>
                                            <span className="rp-sec-meta">
                                                {(sec.text || "").length.toLocaleString()} ch
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Config tab ────────────────────────────────── */}
                        {tab === "config" && (
                            <div className="rp-tab-content">
                                {useCustomSections ? (
                                    <>
                                        <p className="rp-note">
                                            Custom sections override auto-discovery. Pages are divided evenly.
                                        </p>
                                        <div className="rp-custom-list">
                                            {customSections.map((sec, i) => (
                                                <div key={i} className="rp-custom-row">
                                                    <span className="rp-custom-num">{String(i + 1).padStart(2, "0")}</span>
                                                    <input
                                                        className="rp-input"
                                                        type="text"
                                                        value={sec}
                                                        onChange={(e) => updateCustom(i, e.target.value)}
                                                        placeholder={`Section ${i + 1}`}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button
                                                        className="rp-x-btn"
                                                        onClick={() => removeCustom(i)}
                                                        disabled={customSections.length <= MIN_CUSTOM_SECTIONS}
                                                        aria-label="Remove section"
                                                    >✕</button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="rp-custom-actions">
                                            <button className="rp-btn-ghost rp-btn-sm" onClick={addCustom}
                                                disabled={customSections.length >= MAX_CUSTOM_SECTIONS}>+ Add</button>
                                            <button className="rp-btn-ghost rp-btn-sm" onClick={() => setCustomSections([""])}>Clear all</button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="rp-auto-info">
                                        <span className="rp-auto-glyph">⬡</span>
                                        <div>
                                            <div className="rp-auto-title">Auto-discovery enabled</div>
                                            <p className="rp-auto-desc">
                                                The backend scans the PDF's content to detect real chapter and section
                                                boundaries. Enable "Custom sections" in the sidebar to override.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── PDF Modal ─────────────────────────────────────────── */}
            {pdfModalOpen && pdfUrl && (
                <div className="rp-modal-overlay" onClick={() => setPdfModalOpen(false)}>
                    <div className="rp-modal-box" onClick={(e) => e.stopPropagation()}>
                        <div className="rp-modal-header">
                            <span className="rp-modal-title">
                                <span style={{ color: "#c8a96e", marginRight: 8 }}>⬡</span>
                                {cleanName(filename)} — compiled PDF
                            </span>
                            <div className="rp-modal-actions">
                                <button className="rp-btn-ghost rp-btn-sm" onClick={downloadPdf}>↓ Download</button>
                                <button className="rp-x-btn" onClick={() => setPdfModalOpen(false)} aria-label="Close">✕</button>
                            </div>
                        </div>
                        <iframe src={pdfUrl} className="rp-modal-frame" title="Compiled PDF" />
                    </div>
                </div>
            )}
        </>
    );
}

// ── CSS ────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @keyframes spin   { to { transform: rotate(360deg); } }
  @keyframes pulse  { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  /* ── Root ─────────────────────────────────────────────────── */
  .rp-root {
    font-family: 'DM Mono', 'Fira Code', monospace;
    background: #0d0d10;
    color: #e2e0db;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    letter-spacing: 0.01em;
  }

  /* ── Top bar ─────────────────────────────────────────────── */
  .rp-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    height: 52px;
    border-bottom: 1px solid #181820;
    flex-shrink: 0;
    background: #0d0d10;
  }
  .rp-brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .rp-brand-icon {
    color: #c8a96e;
    font-size: 17px;
    line-height: 1;
  }
  .rp-brand-text {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 15px;
    font-style: italic;
    font-weight: 300;
    color: #f0ede8;
    letter-spacing: 0.02em;
  }
  .rp-topbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .rp-file-tag {
    display: flex;
    align-items: center;
    gap: 7px;
    background: #111118;
    border: 1px solid #1e1e28;
    border-radius: 5px;
    padding: 4px 12px;
    max-width: 240px;
  }
  .rp-file-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: #c8a96e; flex-shrink: 0;
  }
  .rp-file-name {
    font-size: 11.5px; color: #78788a;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ── Stale ───────────────────────────────────────────────── */
  .rp-stale {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 28px;
    background: #171209;
    border-bottom: 1px solid #2e2008;
    font-size: 11.5px; color: #c8a040;
  }
  .rp-stale-icon { font-size: 13px; }

  /* ── Body layout ─────────────────────────────────────────── */
  .rp-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Sidebar ─────────────────────────────────────────────── */
  .rp-sidebar {
    width: 252px;
    flex-shrink: 0;
    border-right: 1px solid #181820;
    padding: 22px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    background: #0b0b0e;
  }

  .rp-field { display: flex; flex-direction: column; gap: 7px; }
  .rp-label {
    font-size: 10px; color: #58586a;
    letter-spacing: 0.08em; text-transform: uppercase;
    display: flex; align-items: center; gap: 7px;
  }
  .rp-label-note {
    color: '#30303e'; font-size: 9.5px; letter-spacing: 0.04em;
    border: 1px solid #1e1e28; border-radius: 3px;
    padding: 1px 6px; color: #38384a;
  }

  .rp-divider {
    height: 1px; background: #181820;
    margin: 2px 0;
  }

  /* ── Inputs ──────────────────────────────────────────────── */
  .rp-input {
    width: 100%;
    background: #0f0f15;
    border: 1px solid #1e1e28;
    color: #e2e0db;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 5px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .rp-input:focus { border-color: rgba(200,169,110,0.4); box-shadow: 0 0 0 2px rgba(200,169,110,0.07); }
  .rp-input::placeholder { color: #2e2e3e; }

  /* ── Toggle ──────────────────────────────────────────────── */
  .rp-toggle {
    display: flex; align-items: center; gap: 9px;
    cursor: pointer; width: fit-content;
    user-select: none;
  }
  .rp-toggle input { display: none; }
  .rp-toggle-track {
    width: 28px; height: 15px; border-radius: 8px;
    background: #141420; border: 1px solid #1e1e2c;
    position: relative; transition: background .2s; flex-shrink: 0;
  }
  .rp-toggle-track::after {
    content: ''; position: absolute;
    width: 9px; height: 9px; border-radius: 50%;
    background: #28283a; top: 2px; left: 2px;
    transition: transform .2s, background .2s;
  }
  .rp-toggle input:checked ~ .rp-toggle-track {
    background: #1a1308; border-color: rgba(200,169,110,0.45);
  }
  .rp-toggle input:checked ~ .rp-toggle-track::after {
    transform: translateX(13px); background: #c8a96e;
  }
  .rp-toggle-label { font-size: 11.5px; color: #8a8a9a; }

  /* ── Buttons ─────────────────────────────────────────────── */
  .rp-btn-primary {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 7px; width: 100%;
    padding: 0 18px; height: 37px;
    font-size: 12px; font-weight: 500;
    font-family: 'DM Mono', monospace; letter-spacing: .05em;
    background: #c8a96e; color: #09090c;
    border: none; border-radius: 5px; cursor: pointer;
    transition: background .15s, opacity .15s;
  }
  .rp-btn-primary:hover:not(:disabled) { background: #d4b87a; }
  .rp-btn-primary:disabled { opacity: .3; cursor: not-allowed; }

  .rp-btn-compile {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 7px; width: 100%;
    padding: 0 18px; height: 37px;
    font-size: 12px; font-weight: 500;
    font-family: 'DM Mono', monospace; letter-spacing: .05em;
    background: rgba(78,200,200,0.08); color: #5ec8c8;
    border: 1px solid rgba(78,200,200,0.22); border-radius: 5px; cursor: pointer;
    transition: background .15s, border-color .15s, opacity .15s;
  }
  .rp-btn-compile:hover:not(:disabled) { background: rgba(78,200,200,0.14); border-color: rgba(78,200,200,0.4); }
  .rp-btn-compile:disabled { opacity: .3; cursor: not-allowed; }

  .rp-btn-ghost {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 6px;
    padding: 0 13px; height: 34px;
    font-size: 11.5px; font-family: 'DM Mono', monospace; letter-spacing: .03em;
    background: transparent; color: #8a8a9a;
    border: 1px solid #1e1e28; border-radius: 5px; cursor: pointer;
    transition: color .15s, border-color .15s, background .15s;
    white-space: nowrap;
  }
  .rp-btn-ghost:hover { color: #e2e0db; border-color: #2e2e3e; background: #17171e; }
  .rp-btn-cancel { width: 100%; }
  .rp-btn-sm     { height: 30px; font-size: 11px; padding: 0 10px; }

  .rp-btn-icon-sym { font-size: 11px; }

  .rp-x-btn {
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid #1e1e28; border-radius: 5px;
    color: '#38384a'; font-size: 10px; cursor: pointer; flex-shrink: 0;
    color: #48485a;
    transition: color .15s, border-color .15s, background .15s;
  }
  .rp-x-btn:hover:not(:disabled) { color: #e05c5c; border-color: #3a1212; background: #150a0a; }
  .rp-x-btn:disabled { opacity: .2; cursor: not-allowed; }

  .rp-link {
    background: none; border: none; cursor: pointer;
    color: #e05c5c; font-size: 11px;
    font-family: 'DM Mono', monospace;
    text-decoration: underline; padding: 0; margin-left: 8px;
  }

  /* ── Download row ────────────────────────────────────────── */
  .rp-dl-row {
    display: flex; gap: 6px; flex-wrap: wrap;
  }

  /* ── Errors ──────────────────────────────────────────────── */
  .rp-error {
    display: flex; align-items: flex-start; gap: 7px;
    padding: 10px 12px;
    background: #130a0a; border: 1px solid #381010;
    border-radius: 5px; font-size: 11.5px; color: #e05c5c;
    line-height: 1.55;
    animation: fadeUp .2s ease both;
  }
  .rp-error-icon { flex-shrink: 0; margin-top: 1px; }

  /* ── Progress ────────────────────────────────────────────── */
  .rp-progress {
    background: #0b0b10; border: 1px solid #181820;
    border-radius: 6px; overflow: hidden;
    animation: fadeUp .2s ease both;
  }
  .rp-progress-head {
    display: flex; flex-direction: column; gap: 4px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid #181820;
  }
  .rp-progress-title {
    font-family: 'Fraunces', serif;
    font-size: 12px; color: #c8a96e; font-style: italic;
  }
  .rp-progress-sub { font-size: 10px; color: #48485a; }
  .rp-step-grid { padding: 8px 4px 12px; }
  .rp-step {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 14px; opacity: .15; transition: opacity .3s;
    position: relative;
  }
  .rp-step.done   { opacity: .3; }
  .rp-step.active { opacity: 1; }
  .rp-step-icon  { font-size: 12px; color: #c8a96e; width: 16px; text-align: center; flex-shrink: 0; }
  .rp-step-lbl   { font-size: 10.5px; color: #b8b6b0; }
  .rp-step.done .rp-step-icon { color: #252535; }
  .rp-step.done .rp-step-lbl  { color: #252535; }
  .rp-step-pulse {
    position: absolute; right: 14px;
    width: 4px; height: 4px; border-radius: 50%;
    background: #c8a96e; animation: pulse 1.4s ease-in-out infinite;
  }

  /* ── Spinner ─────────────────────────────────────────────── */
  .rp-spinner {
    display: inline-block; width: 10px; height: 10px;
    border: 1.5px solid rgba(200,169,110,0.25); border-top-color: #c8a96e;
    border-radius: 50%; animation: spin .7s linear infinite;
    flex-shrink: 0;
  }
  .rp-spinner--teal {
    border-color: rgba(94,200,200,0.2); border-top-color: #5ec8c8;
  }

  /* ── Main (editor area) ──────────────────────────────────── */
  .rp-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* ── Tab bar ─────────────────────────────────────────────── */
  .rp-tabbar {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #181820;
    padding: 0 22px;
    height: 42px;
    flex-shrink: 0;
    background: #0d0d10;
    gap: 0;
  }
  .rp-tab {
    padding: 0 16px;
    height: 42px;
    font-size: 10.5px;
    font-family: 'DM Mono', monospace; letter-spacing: .07em;
    text-transform: uppercase;
    background: none; border: none; border-bottom: 1.5px solid transparent;
    color: '#38384a'; color: #48485a; cursor: pointer; margin-bottom: -1px;
    transition: color .15s, border-color .15s;
  }
  .rp-tab:hover  { color: #9a9aaa; }
  .rp-tab.active { color: #c8a96e; border-bottom-color: #c8a96e; }
  .rp-tab-status {
    margin-left: auto;
    font-size: 10px; color: #28283a;
    letter-spacing: .04em;
  }

  /* ── Editor wrap ─────────────────────────────────────────── */
  .rp-editor-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #0d0d10;
  }

  /* ── Empty state ─────────────────────────────────────────── */
  .rp-empty {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%;
    padding: 48px; text-align: center;
  }
  .rp-empty-glyph {
    font-size: 34px; color: '#1e1e28'; color: #1e1e28; margin-bottom: 20px; line-height: 1;
  }
  .rp-empty-title {
    font-family: 'Fraunces', serif;
    font-size: 18px; color: #48485a;
    font-style: italic; font-weight: 300; margin-bottom: 10px;
  }
  .rp-empty-desc {
    font-size: 11.5px; color: '#252535'; color: #252535; line-height: 1.75; max-width: 300px;
  }

  /* ── Tab content (sections / config) ─────────────────────── */
  .rp-tab-content {
    flex: 1; overflow-y: auto; padding: 20px 26px;
  }
  .rp-note {
    font-size: 10.5px; color: #48485a;
    letter-spacing: .06em; text-transform: uppercase;
    margin-bottom: 16px; line-height: 1.5;
  }

  /* ── Section list ────────────────────────────────────────── */
  .rp-sec-list { display: flex; flex-direction: column; }
  .rp-sec-row {
    display: flex; align-items: baseline; gap: 14px;
    padding: 10px 0; border-bottom: 1px solid #111118;
    animation: fadeUp .15s ease both;
  }
  .rp-sec-num  { font-size: 9.5px; color: '#252532'; color: #252535; width: 22px; flex-shrink: 0; }
  .rp-sec-name { font-size: 12.5px; color: #c8c6c1; flex: 1; line-height: 1.5; }
  .rp-sec-meta { font-size: 10px; color: '#252532'; color: #28283a; white-space: nowrap; }

  /* ── Custom sections ─────────────────────────────────────── */
  .rp-custom-list { display: flex; flex-direction: column; gap: 7px; }
  .rp-custom-row  { display: flex; align-items: center; gap: 8px; }
  .rp-custom-num  { font-size: 10px; color: '#282838'; color: #252535; width: 22px; flex-shrink: 0; }
  .rp-custom-actions {
    display: flex; gap: 8px; margin-top: 14px;
  }

  /* ── Auto-discover info ──────────────────────────────────── */
  .rp-auto-info {
    display: flex; gap: 18px; align-items: flex-start;
    padding: 20px 22px;
    background: #0b0b10; border: 1px solid #181820; border-radius: 6px;
    margin-top: 4px;
  }
  .rp-auto-glyph { font-size: 20px; color: #c8a96e; flex-shrink: 0; line-height: 1.2; }
  .rp-auto-title {
    font-family: 'Fraunces', serif;
    font-size: 13px; color: #c8a96e; margin-bottom: 7px; font-style: italic; font-weight: 300;
  }
  .rp-auto-desc { font-size: 11.5px; color: #48485a; line-height: 1.7; }

  /* ── Modal ───────────────────────────────────────────────── */
  .rp-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    padding: 28px;
    animation: fadeUp .2s ease both;
  }
  .rp-modal-box {
    background: #0d0d10;
    border: 1px solid #1e1e28;
    border-radius: 8px;
    width: 90vw; height: 90vh;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 32px 96px rgba(0,0,0,0.9);
  }
  .rp-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #181820;
    flex-shrink: 0;
  }
  .rp-modal-title {
    font-family: 'Fraunces', serif;
    font-size: 14px; color: #e2e0db;
    font-style: italic; font-weight: 300; display: flex; align-items: center;
  }
  .rp-modal-actions { display: flex; align-items: center; gap: 8px; }
  .rp-modal-frame {
    flex: 1; width: 100%; border: none; display: block; background: #fff;
  }

  /* scrollbar */
  .rp-sidebar::-webkit-scrollbar,
  .rp-tab-content::-webkit-scrollbar { width: 3px; }
  .rp-sidebar::-webkit-scrollbar-track,
  .rp-tab-content::-webkit-scrollbar-track { background: transparent; }
  .rp-sidebar::-webkit-scrollbar-thumb,
  .rp-tab-content::-webkit-scrollbar-thumb { background: #1e1e28; border-radius: 2px; }
  .rp-sidebar::-webkit-scrollbar-thumb:hover,
  .rp-tab-content::-webkit-scrollbar-thumb:hover { background: #2a2a38; }
`;