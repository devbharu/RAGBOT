/**
 * ReportPanel.jsx — Redesigned
 * Aesthetic: dark editorial / research terminal
 * Font: DM Mono for UI, Fraunces for headings
 * All original functionality preserved + improved UX
 */

import { useState, useRef, useEffect, useCallback, useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// ── constants ──────────────────────────────────────────────────
const AGENT_STEPS = [
    { key: "fetch", icon: "◈", label: "Fetching all chunks from vector DB" },
    { key: "structure", icon: "⬡", label: "Discovering PDF structure & sections" },
    { key: "fanout", icon: "⟁", label: "Spawning parallel section writers" },
    { key: "write", icon: "▦", label: "Writing sections concurrently" },
    { key: "reduce", icon: "⊟", label: "Stitching sections in order" },
    { key: "latex", icon: "∴", label: "Rendering LaTeX output" },
    { key: "done", icon: "✦", label: "Report ready" },
];

const MAX_CUSTOM_SECTIONS = 15;
const MIN_CUSTOM_SECTIONS = 1;
const STEP_INTERVAL = 8000;
const MAX_RETRIES = 2;
const SESSION_HINT_KEY = "rp_query_hint";

// ── helpers ────────────────────────────────────────────────────
const wordCount = (t = "") => t.trim().split(/\s+/).filter(Boolean).length;
const readTime = (w) => `${Math.max(1, Math.round(w / 200))} min`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanName = (s = "") => s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

// ── component ──────────────────────────────────────────────────
export default function ReportPanel({ filename, apiBase = "http://localhost:8080", onReportReady }) {
    const uid = useId();

    const [tab, setTab] = useState("preview");
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [stepIdx, setStepIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const [staleWarning, setStaleWarning] = useState(false);
    const [useCustomSections, setUseCustomSections] = useState(false);
    const [customSections, setCustomSections] = useState([""]);
    const [queryHint, setQueryHint] = useState(() => {
        try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch { return ""; }
    });

    const stepTimer = useRef(null);
    const abortRef = useRef(null);
    const prevFile = useRef(filename);

    const persistHint = (v) => {
        setQueryHint(v);
        try { sessionStorage.setItem(SESSION_HINT_KEY, v); } catch { }
    };

    // stale warning
    useEffect(() => {
        if (report && filename !== prevFile.current) setStaleWarning(true);
        prevFile.current = filename;
    }, [filename, report]);

    // step ticker
    useEffect(() => {
        if (loading) {
            setStepIdx(0);
            stepTimer.current = setInterval(
                () => setStepIdx(i => Math.min(i + 1, AGENT_STEPS.length - 2)),
                STEP_INTERVAL,
            );
        } else {
            clearInterval(stepTimer.current);
            if (!error) setStepIdx(AGENT_STEPS.length - 1);
        }
        return () => clearInterval(stepTimer.current);
    }, [loading, error]);

    // generate
    const generate = useCallback(async () => {
        if (!filename || loading) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoading(true); setError(""); setReport(null);
        setCopied(false); setStaleWarning(false);

        const validCustom = customSections.map(s => s.trim()).filter(Boolean);
        const sectionsPayload = (useCustomSections && validCustom.length > 0) ? validCustom : [];

        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
            try {
                if (attempt > 0) await sleep(600 * 2 ** attempt);
                const res = await fetch(`${apiBase}/generate-report`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: ctrl.signal,
                    body: JSON.stringify({
                        filename,
                        query_hint: queryHint.trim(),
                        sections: sectionsPayload,
                        format: "both",
                    }),
                });
                if (!res.ok) {
                    const retryable = res.status === 429 || res.status >= 500;
                    if (retryable && attempt < MAX_RETRIES) { attempt++; continue; }
                    const e = await res.json().catch(() => ({}));
                    throw new Error(e.error || `Server error ${res.status}`);
                }
                const data = await res.json();
                setReport(data);
                setTab("preview");
                onReportReady?.(data);
                break;
            } catch (e) {
                if (e.name === "AbortError") { setError("Cancelled."); break; }
                if (attempt >= MAX_RETRIES) {
                    setError(e instanceof TypeError ? "Network error — check connection." : e.message || "Unexpected error.");
                    break;
                }
                attempt++;
            }
        }
        setLoading(false);
    }, [filename, loading, queryHint, customSections, useCustomSections, apiBase, onReportReady]);

    const cancel = () => abortRef.current?.abort();

    // downloads
    const download = (content, ext, mime) => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), {
            href: url,
            download: cleanName(filename) + "_report." + ext,
        });
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyLatex = () => {
        if (!report?.latex) return;
        navigator.clipboard.writeText(report.latex).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const printPdf = () => {
        if (!report?.markdown) return;
        const html = mdToHtml(report.markdown);
        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${cleanName(filename)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
  body{font-family:'Lora',Georgia,serif;max-width:680px;margin:48px auto;font-size:13.5px;line-height:1.85;color:#1a1a1a}
  h1{font-size:24px;font-weight:600;margin:0 0 24px;letter-spacing:-.02em}
  h2{font-size:17px;font-weight:600;margin:28px 0 10px;border-bottom:1px solid #ddd;padding-bottom:6px}
  h3{font-size:14px;font-weight:600;margin:20px 0 8px}
  code{font-family:'IBM Plex Mono',monospace;font-size:11.5px;background:#f4f4f4;padding:1px 5px;border-radius:3px}
  pre{background:#f4f4f4;padding:14px;border-radius:4px;overflow-x:auto}
  table{border-collapse:collapse;width:100%;margin:14px 0;font-size:12.5px}
  th,td{border:1px solid #ddd;padding:7px 10px}th{background:#f7f7f7;font-weight:600}
  @media print{body{margin:0}}
</style></head><body>${html}</body></html>`;
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        iframe.contentDocument.write(doc);
        iframe.contentDocument.close();
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 3000);
    };

    // custom sections helpers
    const addCustom = () => customSections.length < MAX_CUSTOM_SECTIONS && setCustomSections(s => [...s, ""]);
    const updateCustom = (i, v) => setCustomSections(s => s.map((x, j) => j === i ? v : x));
    const removeCustom = (i) => customSections.length > MIN_CUSTOM_SECTIONS && setCustomSections(s => s.filter((_, j) => j !== i));

    const wc = report?.markdown ? wordCount(report.markdown) : 0;
    const discoveredSections = report?.sections?.filter(s => s?.name) || [];

    const TABS = [
        { key: "preview", label: "Preview" },
        { key: "latex", label: "LaTeX" },
        ...(discoveredSections.length > 0 ? [{ key: "sections", label: `Sections·${discoveredSections.length}` }] : []),
        { key: "config", label: "Config" },
    ];

    // ── render ─────────────────────────────────────────────────
    return (
        <>
            {/* Google Fonts */}
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />

            <div style={$.root}>
                <style>{CSS}</style>

                {/* ── Top bar ─────────────────────────────────────── */}
                <div style={$.topbar}>
                    <div style={$.brand}>
                        <span style={$.brandIcon}>◈</span>
                        <span style={$.brandText}>Report Engine</span>
                    </div>
                    {filename && (
                        <div style={$.fileTag} title={filename}>
                            <span style={$.fileTagDot} />
                            {cleanName(filename)}
                        </div>
                    )}
                </div>

                {/* ── Stale warning ─────────────────────────────── */}
                {staleWarning && (
                    <div style={$.stale} role="alert">
                        <span style={$.staleIcon}>⚠</span>
                        File changed — re-generate to refresh.
                    </div>
                )}

                {/* ── Input area ──────────────────────────────────── */}
                <div style={$.inputBlock}>
                    <label style={$.inputLabel}>Focus / topic <span style={$.labelNote}>(optional)</span></label>
                    <div style={$.inputRow}>
                        <input
                            className="rp-input"
                            type="text"
                            placeholder="e.g. explain each chapter in detail…"
                            value={queryHint}
                            onChange={e => persistHint(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !loading && filename && generate()}
                            disabled={loading}
                            aria-label="Report focus hint"
                        />
                    </div>

                    <label className="rp-toggle">
                        <input
                            type="checkbox"
                            checked={useCustomSections}
                            onChange={e => setUseCustomSections(e.target.checked)}
                            disabled={loading}
                        />
                        <span className="rp-toggle-track" />
                        <span style={{ fontSize: 12, color: "var(--rp-muted)", userSelect: "none" }}>
                            Use custom section names
                        </span>
                    </label>
                </div>

                {/* ── Action row ──────────────────────────────────── */}
                <div style={$.actionRow}>
                    <button
                        className="rp-btn-primary"
                        onClick={generate}
                        disabled={loading || !filename}
                        aria-busy={loading}
                    >
                        {loading
                            ? <><span className="rp-spinner" /> Generating…</>
                            : <><span style={{ marginRight: 6 }}>✦</span> Generate report</>
                        }
                    </button>

                    {loading && (
                        <button className="rp-btn-ghost" onClick={cancel}>Cancel</button>
                    )}

                    {report && !loading && (
                        <div style={$.dlGroup}>
                            <button className="rp-btn-ghost" onClick={() => download(report.markdown, "md", "text/markdown")}>↓ .md</button>
                            <button className="rp-btn-ghost" onClick={() => download(report.latex, "tex", "text/plain")}>↓ .tex</button>
                            <button className="rp-btn-ghost" onClick={printPdf}>⎙ Print</button>
                        </div>
                    )}
                </div>

                {/* ── Error ───────────────────────────────────────── */}
                {error && (
                    <div style={$.errorBox} role="alert">
                        <span style={$.errorIcon}>✗</span>
                        {error}
                        {!error.includes("Cancelled") && (
                            <button className="rp-link" onClick={generate}>Retry</button>
                        )}
                    </div>
                )}

                {/* ── Progress ticker ─────────────────────────────── */}
                {loading && (
                    <div style={$.progressBox} role="status" aria-live="polite">
                        <div style={$.progressHeader}>
                            <span style={$.progressTitle}>Processing</span>
                            <span style={$.progressSub}>{AGENT_STEPS[stepIdx]?.label}</span>
                        </div>
                        <div style={$.stepGrid}>
                            {AGENT_STEPS.slice(0, -1).map((step, i) => {
                                const active = i === stepIdx;
                                const done = i < stepIdx;
                                return (
                                    <div key={step.key} className={`rp-step ${active ? "active" : done ? "done" : ""}`}>
                                        <span className="rp-step-icon">{step.icon}</span>
                                        <span className="rp-step-label">{step.label}</span>
                                        {active && <span className="rp-step-pulse" />}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Tabs ────────────────────────────────────────── */}
                {(report || !loading) && (
                    <div style={$.tabBar} role="tablist">
                        {TABS.map(t => (
                            <button
                                key={t.key}
                                role="tab"
                                aria-selected={tab === t.key}
                                className={`rp-tab ${tab === t.key ? "active" : ""}`}
                                onClick={() => setTab(t.key)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* ── Preview ─────────────────────────────────────── */}
                {tab === "preview" && report && (
                    <div>
                        <div style={$.metaRow}>
                            <span style={$.metaChip}>{wc.toLocaleString()} words</span>
                            <span style={$.metaDot}>·</span>
                            <span style={$.metaChip}>{readTime(wc)} read</span>
                            {discoveredSections.length > 0 && (
                                <><span style={$.metaDot}>·</span>
                                    <span style={$.metaChip}>{discoveredSections.length} sections</span></>
                            )}
                        </div>
                        <div className="rp-md" style={$.mdWrap}>
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {report.markdown}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}

                {/* ── LaTeX ───────────────────────────────────────── */}
                {tab === "latex" && report && (
                    <div>
                        <div style={$.latexToolbar}>
                            <button className="rp-btn-ghost" onClick={copyLatex}>
                                {copied ? "✓ Copied" : "⊕ Copy"}
                            </button>
                            <button className="rp-btn-ghost" onClick={() => download(report.latex, "tex", "text/plain")}>
                                ↓ Download .tex
                            </button>
                            <span style={$.metaChip}>{(report.latex?.length || 0).toLocaleString()} chars</span>
                        </div>
                        <pre style={$.codeBlock}>{report.latex}</pre>
                    </div>
                )}

                {/* ── Sections ────────────────────────────────────── */}
                {tab === "sections" && discoveredSections.length > 0 && (
                    <div>
                        <p style={$.sectionNote}>
                            Auto-discovered {discoveredSections.length} sections from PDF structure
                        </p>
                        <div style={$.sectionList}>
                            {discoveredSections.map((sec, i) => (
                                <div key={i} className="rp-sec-row">
                                    <span className="rp-sec-num">{String(i + 1).padStart(2, "0")}</span>
                                    <span className="rp-sec-name">{sec.name}</span>
                                    <span className="rp-sec-wc">{wordCount(sec.text || "").toLocaleString()} w</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Config ──────────────────────────────────────── */}
                {tab === "config" && (
                    <div>
                        {useCustomSections ? (
                            <>
                                <p style={$.sectionNote}>
                                    Custom sections override auto-discovery. Pages are divided evenly across them.
                                </p>
                                <div style={$.customList}>
                                    {customSections.map((sec, i) => (
                                        <div key={i} style={$.customRow}>
                                            <span style={$.customNum}>{String(i + 1).padStart(2, "0")}</span>
                                            <input
                                                className="rp-input"
                                                type="text"
                                                value={sec}
                                                onChange={e => updateCustom(i, e.target.value)}
                                                placeholder={`Section ${i + 1}`}
                                                aria-label={`Custom section ${i + 1}`}
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                className="rp-btn-icon"
                                                onClick={() => removeCustom(i)}
                                                disabled={customSections.length <= MIN_CUSTOM_SECTIONS}
                                                aria-label="Remove"
                                            >✕</button>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <button
                                        className="rp-btn-ghost"
                                        onClick={addCustom}
                                        disabled={customSections.length >= MAX_CUSTOM_SECTIONS}
                                    >+ Add</button>
                                    <button
                                        className="rp-btn-ghost"
                                        onClick={() => setCustomSections([""])}
                                    >Clear all</button>
                                </div>
                            </>
                        ) : (
                            <div style={$.autoDiscoverInfo}>
                                <span style={$.autoIcon}>⬡</span>
                                <div>
                                    <div style={$.autoTitle}>Auto-discovery enabled</div>
                                    <div style={$.autoDesc}>
                                        The backend will scan the PDF's page content to detect real chapter and section
                                        boundaries. Enable "Use custom section names" above to override.
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Empty states ────────────────────────────────── */}
                {tab === "preview" && !report && !loading && (
                    <div style={$.empty}>
                        {filename ? (
                            <>
                                <div style={$.emptyIcon}>◈</div>
                                <div style={$.emptyTitle}>Ready to generate</div>
                                <div style={$.emptyDesc}>
                                    Sections will be auto-discovered from the PDF structure.
                                    <br />No configuration needed.
                                </div>
                                <button className="rp-btn-primary" onClick={generate} style={{ marginTop: 20 }}>
                                    <span style={{ marginRight: 6 }}>✦</span> Generate report
                                </button>
                            </>
                        ) : (
                            <>
                                <div style={$.emptyIcon}>⬡</div>
                                <div style={$.emptyTitle}>No document selected</div>
                                <div style={$.emptyDesc}>Select a PDF to generate a report.</div>
                            </>
                        )}
                    </div>
                )}

                {tab === "latex" && !report && !loading && (
                    <div style={$.empty}>
                        <div style={$.emptyIcon}>∴</div>
                        <div style={$.emptyTitle}>No LaTeX yet</div>
                        <div style={$.emptyDesc}>Generate a report first.</div>
                    </div>
                )}
            </div>
        </>
    );
}

// ── Style objects ─────────────────────────────────────────────
const $ = {
    root: {
        fontFamily: "'DM Mono', 'Fira Code', monospace",
        background: "#0e0e10",
        color: "#e8e6e1",
        minHeight: "100%",
        padding: "0 0 40px",
        letterSpacing: "0.01em",
    },
    topbar: {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "20px 28px 16px",
        borderBottom: "1px solid #1e1e22",
    },
    brand: { display: "flex", alignItems: "center", gap: 8 },
    brandIcon: { color: "#c8a96e", fontSize: 18 },
    brandText: {
        fontFamily: "'Fraunces', Georgia, serif",
        fontSize: 15, fontWeight: 500,
        color: "#e8e6e1", letterSpacing: "0.02em",
    },
    fileTag: {
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 11, color: "#6e6e78",
        background: "#17171b",
        border: "1px solid #2a2a30",
        borderRadius: 4, padding: "4px 10px",
        maxWidth: 260, overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
        letterSpacing: "0.03em",
    },
    fileTagDot: {
        width: 5, height: 5, borderRadius: "50%",
        background: "#c8a96e", flexShrink: 0,
    },

    stale: {
        display: "flex", alignItems: "center", gap: 8,
        margin: "12px 28px 0",
        padding: "8px 14px",
        background: "#1e1800",
        border: "1px solid #3d3000",
        borderRadius: 4, fontSize: 12, color: "#b8960e",
    },
    staleIcon: { fontSize: 14 },

    inputBlock: {
        padding: "24px 28px 0",
        display: "flex", flexDirection: "column", gap: 10,
    },
    inputLabel: { fontSize: 11, color: "#6e6e78", letterSpacing: "0.06em", textTransform: "uppercase" },
    labelNote: { color: "#3e3e48", marginLeft: 4 },
    inputRow: { display: "flex", gap: 8 },

    actionRow: {
        display: "flex", alignItems: "center", gap: 10,
        padding: "16px 28px", flexWrap: "wrap",
    },
    dlGroup: { display: "flex", gap: 6, marginLeft: "auto" },

    errorBox: {
        display: "flex", alignItems: "center", gap: 8,
        margin: "0 28px 16px",
        padding: "10px 14px",
        background: "#1e0e0e",
        border: "1px solid #4a1010",
        borderRadius: 4, fontSize: 12, color: "#e05c5c",
    },
    errorIcon: { flexShrink: 0 },

    progressBox: {
        margin: "0 28px 20px",
        background: "#13131a",
        border: "1px solid #1e1e28",
        borderRadius: 6,
        overflow: "hidden",
    },
    progressHeader: {
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        padding: "14px 18px 10px",
        borderBottom: "1px solid #1a1a22",
    },
    progressTitle: {
        fontFamily: "'Fraunces', serif",
        fontSize: 13, color: "#c8a96e", fontStyle: "italic",
    },
    progressSub: { fontSize: 11, color: "#4e4e58" },
    stepGrid: { padding: "10px 6px 14px" },

    tabBar: {
        display: "flex",
        borderBottom: "1px solid #1e1e22",
        padding: "0 20px",
        marginBottom: 0,
    },

    metaRow: {
        display: "flex", alignItems: "center", gap: 6,
        padding: "14px 28px 10px",
    },
    metaChip: {
        fontSize: 11, color: "#5e5e68",
        background: "#17171b",
        border: "1px solid #222228",
        borderRadius: 3, padding: "2px 8px",
        letterSpacing: "0.04em",
    },
    metaDot: { color: "#2e2e38", fontSize: 16 },

    mdWrap: {
        padding: "4px 28px 28px",
        maxHeight: "62vh", overflowY: "auto",
        fontSize: 13.5, lineHeight: 1.8,
    },

    latexToolbar: {
        display: "flex", alignItems: "center", gap: 8,
        padding: "14px 28px 10px", flexWrap: "wrap",
    },
    codeBlock: {
        margin: "0 28px",
        fontFamily: "'DM Mono', monospace",
        fontSize: 11.5, lineHeight: 1.65,
        background: "#0a0a0d",
        border: "1px solid #1a1a20",
        borderRadius: 4,
        padding: "16px 18px",
        overflowX: "auto", whiteSpace: "pre",
        maxHeight: "60vh", overflowY: "auto",
        color: "#8888a8",
    },

    sectionNote: {
        fontSize: 11, color: "#4e4e58",
        padding: "14px 28px 10px", margin: 0,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
    },
    sectionList: {
        padding: "0 28px",
        display: "flex", flexDirection: "column",
    },

    customList: { display: "flex", flexDirection: "column", gap: 6, padding: "0 28px" },
    customRow: { display: "flex", alignItems: "center", gap: 8 },
    customNum: { fontSize: 11, color: "#3e3e48", width: 24, flexShrink: 0 },

    autoDiscoverInfo: {
        display: "flex", gap: 16, alignItems: "flex-start",
        margin: "16px 28px",
        padding: "18px 20px",
        background: "#0f0f14",
        border: "1px solid #1e1e28",
        borderRadius: 6,
    },
    autoIcon: { fontSize: 22, color: "#c8a96e", flexShrink: 0, lineHeight: 1 },
    autoTitle: { fontSize: 13, fontWeight: 500, color: "#c8a96e", marginBottom: 6, fontFamily: "'Fraunces', serif" },
    autoDesc: { fontSize: 12, color: "#4e4e5e", lineHeight: 1.65 },

    empty: {
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "64px 28px",
        textAlign: "center",
    },
    emptyIcon: { fontSize: 32, color: "#2a2a35", marginBottom: 18, lineHeight: 1 },
    emptyTitle: {
        fontFamily: "'Fraunces', serif",
        fontSize: 16, color: "#4a4a56",
        marginBottom: 8, fontStyle: "italic",
    },
    emptyDesc: { fontSize: 12, color: "#2e2e3a", lineHeight: 1.7, maxWidth: 320 },
};

// ── CSS string ────────────────────────────────────────────────
const CSS = `
  @keyframes spin   { to { transform: rotate(360deg); } }
  @keyframes pulse  { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  /* Input */
  .rp-input {
    width: 100%; box-sizing: border-box;
    background: #13131a; border: 1px solid #252530;
    color: #c8c6c1; font-family: 'DM Mono', monospace; font-size: 12.5px;
    padding: 9px 13px; border-radius: 4px; outline: none;
    transition: border-color .15s;
    letter-spacing: .01em;
  }
  .rp-input:focus    { border-color: #c8a96e; }
  .rp-input::placeholder { color: #333340; }

  /* Toggle */
  .rp-toggle {
    display: flex; align-items: center; gap: 8px; cursor: pointer; width: fit-content;
  }
  .rp-toggle input { display: none; }
  .rp-toggle-track {
    width: 30px; height: 16px; border-radius: 8px;
    background: #1e1e28; border: 1px solid #2a2a38;
    position: relative; transition: background .2s;
    flex-shrink: 0;
  }
  .rp-toggle-track::after {
    content: ''; position: absolute;
    width: 10px; height: 10px; border-radius: 50%;
    background: #3a3a48; top: 2px; left: 2px;
    transition: transform .2s, background .2s;
  }
  .rp-toggle input:checked ~ .rp-toggle-track { background: #2a2010; border-color: #c8a96e; }
  .rp-toggle input:checked ~ .rp-toggle-track::after { transform: translateX(14px); background: #c8a96e; }

  /* Buttons */
  .rp-btn-primary {
    display: inline-flex; align-items: center;
    padding: 0 20px; height: 36px; font-size: 12.5px; font-weight: 500;
    font-family: 'DM Mono', monospace; letter-spacing: .04em;
    background: #c8a96e; color: #0a0a0e; border: none;
    border-radius: 4px; cursor: pointer;
    transition: background .15s, opacity .15s;
    white-space: nowrap;
  }
  .rp-btn-primary:hover:not(:disabled) { background: #d4b880; }
  .rp-btn-primary:disabled { opacity: .4; cursor: not-allowed; }

  .rp-btn-ghost {
    display: inline-flex; align-items: center;
    padding: 0 14px; height: 36px; font-size: 12px;
    font-family: 'DM Mono', monospace; letter-spacing: .03em;
    background: transparent; color: #6e6e78;
    border: 1px solid #252530; border-radius: 4px;
    cursor: pointer; transition: color .15s, border-color .15s;
    white-space: nowrap;
  }
  .rp-btn-ghost:hover { color: #c8c6c1; border-color: #3a3a48; }

  .rp-btn-icon {
    width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid #222228; border-radius: 4px;
    color: #3e3e50; font-size: 12px; cursor: pointer;
    transition: color .15s, border-color .15s; flex-shrink: 0;
  }
  .rp-btn-icon:hover:not(:disabled) { color: #e05c5c; border-color: #4a1010; }
  .rp-btn-icon:disabled { opacity: .3; cursor: not-allowed; }

  .rp-link {
    background: none; border: none; cursor: pointer;
    color: #e05c5c; font-size: 12px; font-family: 'DM Mono', monospace;
    text-decoration: underline; padding: 0; margin-left: 10px;
  }

  /* Spinner */
  .rp-spinner {
    display: inline-block; width: 11px; height: 11px;
    border: 1.5px solid rgba(10,10,14,.3);
    border-top-color: #0a0a0e;
    border-radius: 50%; animation: spin .7s linear infinite;
    margin-right: 6px; flex-shrink: 0;
  }

  /* Steps */
  .rp-step {
    display: flex; align-items: center; gap: 10;
    padding: 6px 18px; opacity: .2; transition: opacity .3s;
    position: relative;
  }
  .rp-step.done   { opacity: .35; }
  .rp-step.active { opacity: 1; }
  .rp-step-icon  { font-size: 14px; color: #c8a96e; width: 20px; text-align: center; flex-shrink: 0; }
  .rp-step-label { font-size: 12px; color: #a0a0b0; letter-spacing: .03em; }
  .rp-step.done .rp-step-icon  { color: #3a3a48; }
  .rp-step.done .rp-step-label { color: #3a3a50; }
  .rp-step-pulse {
    position: absolute; right: 18px;
    width: 5px; height: 5px; border-radius: 50%;
    background: #c8a96e; animation: pulse 1.2s ease-in-out infinite;
  }

  /* Tabs */
  .rp-tab {
    padding: 11px 18px; font-size: 11.5px;
    font-family: 'DM Mono', monospace; letter-spacing: .05em;
    text-transform: uppercase;
    background: none; border: none;
    color: #3e3e50; cursor: pointer;
    border-bottom: 1.5px solid transparent;
    margin-bottom: -1px;
    transition: color .15s, border-color .15s;
  }
  .rp-tab:hover  { color: #8e8e98; }
  .rp-tab.active { color: #c8a96e; border-bottom-color: #c8a96e; }

  /* Section rows */
  .rp-sec-row {
    display: flex; align-items: baseline; gap: 12;
    padding: 10px 0; border-bottom: 1px solid #141418;
    animation: fadeIn .2s ease both;
  }
  .rp-sec-num  { font-size: 10px; color: #2e2e3a; width: 22px; flex-shrink: 0; }
  .rp-sec-name { font-size: 12.5px; color: #a0a0b0; flex: 1; line-height: 1.4; }
  .rp-sec-wc   { font-size: 10px; color: #2e2e3a; white-space: nowrap; }

  /* Markdown */
  .rp-md { color: #c8c6c1; }
  .rp-md h1 {
    font-family: 'Fraunces', serif;
    font-size: 22px; font-weight: 300; font-style: italic;
    color: #e8e6e1; margin: 0 0 24px; letter-spacing: -.01em;
    line-height: 1.3; border-bottom: 1px solid #1e1e24; padding-bottom: 16px;
  }
  .rp-md h2 {
    font-family: 'Fraunces', serif;
    font-size: 16px; font-weight: 500;
    color: #c8a96e; margin: 28px 0 10px;
    letter-spacing: .01em;
  }
  .rp-md h3 { font-size: 13px; font-weight: 500; color: #a0a08a; margin: 18px 0 6px; }
  .rp-md p  { margin: .6rem 0; color: #9090a4; line-height: 1.8; }
  .rp-md ul,.rp-md ol { padding-left: 1.4rem; margin: .5rem 0; }
  .rp-md li { margin: .3rem 0; color: #9090a4; font-size: 13px; }
  .rp-md strong { color: #c8c6c1; font-weight: 500; }
  .rp-md em     { color: #c8a96e; font-style: italic; }
  .rp-md code   {
    font-family: 'DM Mono', monospace; font-size: 11.5px;
    background: #13131a; border: 1px solid #1e1e28;
    padding: 1px 6px; border-radius: 3px; color: #a8a8c8;
  }
  .rp-md pre {
    background: #0a0a0d; border: 1px solid #1a1a20;
    border-radius: 4px; padding: 14px 16px; overflow-x: auto; margin: 12px 0;
  }
  .rp-md pre code { background: none; border: none; padding: 0; color: #8080a0; }
  .rp-md table {
    border-collapse: collapse; width: 100%;
    font-size: 12px; margin: 14px 0;
    border: 1px solid #1e1e28;
  }
  .rp-md th,.rp-md td { border: 1px solid #1e1e28; padding: 8px 12px; text-align: left; }
  .rp-md th { background: #13131a; color: #c8a96e; font-weight: 500; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
  .rp-md td { color: #7070848; }
  .rp-md blockquote {
    border-left: 2px solid #c8a96e; padding: 2px 0 2px 14px;
    margin: 10px 0; color: #5e5e70; font-style: italic;
  }
  .rp-md hr { border: none; border-top: 1px solid #1a1a22; margin: 24px 0; }
  .rp-md a  { color: #c8a96e; text-decoration: none; }
  .rp-md a:hover { text-decoration: underline; }
`;

// ── Minimal md → HTML for print ───────────────────────────────
function mdToHtml(md) {
    return md
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
        .replace(/\n{2,}/g, "</p><p>")
        .replace(/^(?!<[hul])(.+)$/gm, "<p>$1</p>");
}