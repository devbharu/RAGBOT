/**
 * ReportPanel.jsx
 * ─────────────────────────────────────────────────────────────
 * Drop-in panel for the RAG frontend.
 * Calls POST /generate-report, shows markdown preview + raw LaTeX.
 * Claude-agent style: streaming status updates while generating.
 *
 * Props:
 *   filename   string   — currently selected file
 *   apiBase    string   — backend base URL, e.g. "http://localhost:8080"
 *
 * Usage in Chatbot.jsx or App.jsx:
 *   import ReportPanel from "./ReportPanel";
 *   <ReportPanel filename={selectedFile} apiBase="http://localhost:8080" />
 */

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// ── default sections (mirrors report_graph.py DEFAULT_SECTIONS) ──
const DEFAULT_SECTIONS = [
    "Abstract & Overview",
    "Key Concepts & Definitions",
    "Methodology & Approach",
    "Results & Findings",
    "Discussion & Analysis",
    "Conclusion & Future Work",
];

// ── agent steps shown while generating ──
const AGENT_STEPS = [
    { key: "retrieve", label: "Retrieving document chunks…" },
    { key: "fanout", label: "Spawning parallel section writers…" },
    { key: "write", label: "Writing sections concurrently…" },
    { key: "reduce", label: "Stitching sections together…" },
    { key: "refine", label: "Coherence pass — smoothing transitions…" },
    { key: "latex", label: "Rendering LaTeX output…" },
    { key: "done", label: "Report ready" },
];

export default function ReportPanel({ filename, apiBase = "http://localhost:8080" }) {
    const [tab, setTab] = useState("markdown");   // "markdown" | "latex" | "config"
    const [report, setReport] = useState(null);         // {markdown, latex, sections}
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [stepIdx, setStepIdx] = useState(0);
    const [queryHint, setQueryHint] = useState("");
    const [sections, setSections] = useState(DEFAULT_SECTIONS);
    const [copied, setCopied] = useState(false);
    const stepTimer = useRef(null);
    const latexRef = useRef(null);

    // Advance agent step ticker while loading
    useEffect(() => {
        if (loading) {
            setStepIdx(0);
            stepTimer.current = setInterval(() => {
                setStepIdx(i => Math.min(i + 1, AGENT_STEPS.length - 2));
            }, 4500);
        } else {
            clearInterval(stepTimer.current);
            setStepIdx(AGENT_STEPS.length - 1); // "done"
        }
        return () => clearInterval(stepTimer.current);
    }, [loading]);

    const generate = async () => {
        if (!filename) return;
        setLoading(true);
        setError("");
        setReport(null);
        setCopied(false);

        try {
            const res = await fetch(`${apiBase}/generate-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename,
                    query_hint: queryHint.trim(),
                    sections: sections.filter(s => s.trim()),
                    format: "both",
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            setReport(data);
            setTab("markdown");
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const copyLatex = () => {
        if (!report?.latex) return;
        navigator.clipboard.writeText(report.latex).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const downloadLatex = () => {
        if (!report?.latex) return;
        const blob = new Blob([report.latex], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename.replace(/\.pdf$/i, "") + "_report.tex";
        a.click();
        URL.revokeObjectURL(url);
    };

    const addSection = () => setSections(s => [...s, ""]);
    const updateSection = (i, val) => setSections(s => s.map((v, idx) => idx === i ? val : v));
    const removeSection = (i) => setSections(s => s.filter((_, idx) => idx !== i));
    const resetSections = () => setSections(DEFAULT_SECTIONS);

    // ── styles ────────────────────────────────────────────────────
    const s = {
        root: {
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-primary)",
            padding: "0",
        },
        header: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
        },
        title: {
            fontSize: "15px",
            fontWeight: "500",
            margin: "0",
        },
        fileChip: {
            fontSize: "12px",
            color: "var(--color-text-secondary)",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)",
            padding: "3px 10px",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        hintRow: {
            display: "flex",
            gap: "8px",
            marginBottom: "12px",
        },
        hintInput: {
            flex: "1",
            fontSize: "13px",
        },
        genBtn: {
            padding: "0 20px",
            height: "36px",
            fontSize: "13px",
            fontWeight: "500",
            cursor: loading || !filename ? "not-allowed" : "pointer",
            opacity: loading || !filename ? "0.5" : "1",
            whiteSpace: "nowrap",
            flexShrink: "0",
        },
        tabs: {
            display: "flex",
            gap: "0",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
            marginBottom: "16px",
        },
        tab: (active) => ({
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: active ? "500" : "400",
            color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            borderBottom: active ? "1.5px solid var(--color-text-primary)" : "1.5px solid transparent",
            cursor: "pointer",
            background: "none",
            border: "none",
            borderBottomWidth: "1.5px",
            borderBottomStyle: "solid",
            borderBottomColor: active ? "var(--color-text-primary)" : "transparent",
            marginBottom: "-0.5px",
        }),
        agentBox: {
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)",
            padding: "20px 24px",
            marginBottom: "16px",
        },
        stepRow: (active, done) => ({
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "6px 0",
            opacity: done ? "0.45" : active ? "1" : "0.3",
            transition: "opacity 0.3s",
        }),
        dot: (active, done) => ({
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            flexShrink: "0",
            background: done
                ? "var(--color-text-secondary)"
                : active
                    ? "var(--color-text-primary)"
                    : "var(--color-border-tertiary)",
            transition: "background 0.3s",
        }),
        stepLabel: {
            fontSize: "13px",
        },
        spinner: {
            width: "14px",
            height: "14px",
            border: "1.5px solid var(--color-border-tertiary)",
            borderTop: "1.5px solid var(--color-text-primary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            flexShrink: "0",
        },
        latexToolbar: {
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end",
            marginBottom: "8px",
        },
        codeBlock: {
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: "1.6",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)",
            padding: "16px",
            overflowX: "auto",
            whiteSpace: "pre",
            maxHeight: "60vh",
            overflowY: "auto",
        },
        sectionList: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "12px",
        },
        sectionRow: {
            display: "flex",
            gap: "8px",
            alignItems: "center",
        },
        removeBtn: {
            flexShrink: "0",
            padding: "0 10px",
            height: "36px",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
        },
        addBtn: {
            fontSize: "13px",
            padding: "6px 14px",
        },
        resetBtn: {
            fontSize: "13px",
            padding: "6px 14px",
            color: "var(--color-text-secondary)",
        },
        configRow: {
            display: "flex",
            gap: "8px",
            justifyContent: "flex-start",
            marginTop: "4px",
        },
        errorBox: {
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)",
            border: "0.5px solid var(--color-border-danger)",
            borderRadius: "var(--border-radius-md)",
            padding: "10px 14px",
            fontSize: "13px",
            marginBottom: "12px",
        },
        markdownWrap: {
            fontSize: "14px",
            lineHeight: "1.7",
            maxHeight: "65vh",
            overflowY: "auto",
            paddingRight: "4px",
        },
        sectionChips: {
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            marginBottom: "12px",
        },
        chip: {
            fontSize: "12px",
            padding: "3px 10px",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-tertiary)",
            background: "var(--color-background-secondary)",
            color: "var(--color-text-secondary)",
        },
    };

    return (
        <div style={s.root}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }
        .rp-md h1{font-size:18px;font-weight:500;margin:1.2rem 0 0.5rem}
        .rp-md h2{font-size:16px;font-weight:500;margin:1rem 0 0.4rem;border-bottom:0.5px solid var(--color-border-tertiary);padding-bottom:4px}
        .rp-md h3{font-size:14px;font-weight:500;margin:0.8rem 0 0.3rem}
        .rp-md p{margin:0.5rem 0}
        .rp-md ul,ol{padding-left:1.4rem;margin:0.5rem 0}
        .rp-md li{margin:0.2rem 0}
        .rp-md code{font-family:var(--font-mono);font-size:12px;background:var(--color-background-secondary);padding:1px 5px;border-radius:4px}
        .rp-md pre{background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:12px;overflow-x:auto}
        .rp-md pre code{background:none;padding:0}
        .rp-md table{border-collapse:collapse;width:100%;font-size:13px;margin:0.8rem 0}
        .rp-md th,td{border:0.5px solid var(--color-border-tertiary);padding:6px 10px;text-align:left}
        .rp-md th{background:var(--color-background-secondary);font-weight:500}
        .rp-md blockquote{border-left:2px solid var(--color-border-secondary);padding-left:12px;color:var(--color-text-secondary);margin:0.6rem 0}
      `}</style>

            {/* ── Header ─────────────────────────────────────────── */}
            <div style={s.header}>
                <p style={s.title}>Report generator</p>
                {filename && <span style={s.fileChip}>{filename}</span>}
            </div>

            {/* ── Query hint + generate button ─────────────────── */}
            <div style={s.hintRow}>
                <input
                    type="text"
                    placeholder="Report focus or topic (optional)"
                    value={queryHint}
                    onChange={e => setQueryHint(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !loading && filename && generate()}
                    style={s.hintInput}
                    disabled={loading}
                />
                <button
                    onClick={generate}
                    disabled={loading || !filename}
                    style={s.genBtn}
                >
                    {loading ? "Generating…" : "Generate report"}
                </button>
            </div>

            {/* ── Error ────────────────────────────────────────── */}
            {error && <div style={s.errorBox}>{error}</div>}

            {/* ── Agent step ticker ────────────────────────────── */}
            {loading && (
                <div style={s.agentBox}>
                    {AGENT_STEPS.slice(0, -1).map((step, i) => {
                        const active = i === stepIdx;
                        const done = i < stepIdx;
                        return (
                            <div key={step.key} style={s.stepRow(active, done)}>
                                {active
                                    ? <div style={s.spinner} />
                                    : <div style={s.dot(active, done)} />
                                }
                                <span style={s.stepLabel}>{step.label}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Tabs ─────────────────────────────────────────── */}
            {(report || !loading) && (
                <div style={s.tabs}>
                    <button style={s.tab(tab === "markdown")} onClick={() => setTab("markdown")}>
                        Preview
                    </button>
                    <button style={s.tab(tab === "latex")} onClick={() => setTab("latex")}>
                        LaTeX
                    </button>
                    <button style={s.tab(tab === "config")} onClick={() => setTab("config")}>
                        Sections
                    </button>
                </div>
            )}

            {/* ── Markdown preview ─────────────────────────────── */}
            {tab === "markdown" && report && (
                <div style={s.markdownWrap} className="rp-md">
                    <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                    >
                        {report.markdown}
                    </ReactMarkdown>
                </div>
            )}

            {/* ── LaTeX view ───────────────────────────────────── */}
            {tab === "latex" && report && (
                <>
                    <div style={s.latexToolbar}>
                        <button onClick={copyLatex} style={{ fontSize: "13px", padding: "6px 14px" }}>
                            {copied ? "Copied" : "Copy LaTeX"}
                        </button>
                        <button onClick={downloadLatex} style={{ fontSize: "13px", padding: "6px 14px" }}>
                            Download .tex
                        </button>
                    </div>
                    <pre style={s.codeBlock} ref={latexRef}>
                        {report.latex}
                    </pre>
                </>
            )}

            {/* ── Config: section editor ───────────────────────── */}
            {tab === "config" && (
                <>
                    <div style={s.sectionList}>
                        {sections.map((sec, i) => (
                            <div key={i} style={s.sectionRow}>
                                <input
                                    type="text"
                                    value={sec}
                                    onChange={e => updateSection(i, e.target.value)}
                                    placeholder={`Section ${i + 1}`}
                                    style={{ flex: 1, fontSize: "13px" }}
                                />
                                <button
                                    onClick={() => removeSection(i)}
                                    style={s.removeBtn}
                                    disabled={sections.length <= 1}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                    <div style={s.configRow}>
                        <button onClick={addSection} style={s.addBtn}>+ Add section</button>
                        <button onClick={resetSections} style={s.resetBtn}>Reset to defaults</button>
                    </div>
                </>
            )}

            {/* ── Empty state ──────────────────────────────────── */}
            {tab === "markdown" && !report && !loading && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-secondary)", fontSize: "13px" }}>
                    {filename
                        ? "Hit Generate report to create a structured LaTeX report from the document."
                        : "Select a document first, then generate a report."
                    }
                </div>
            )}
        </div>
    );
}