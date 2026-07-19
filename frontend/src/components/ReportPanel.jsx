/**
 * ReportPanel.jsx — CMTI Report Engine v12.0
 * Changes from v11.0:
 *  - DocSelectionPanel: interactive multi-PDF selector inside left sidebar
 *  - Uses toggleFileSelection / selectAllFiles / clearFileSelection from AppContext
 *  - Selected count badge, per-doc relevance dots, search filter
 *  - OCP-safe: single-mode left panel unchanged
 */

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useNavigate } from "react-router-dom";
import { useFileStore, useReportStore, API } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { ThemeToggle } from "./chatbot/ChatUtils";

/* ─── constants ─────────────────────────────────────────────── */
const SESSION_HINT_KEY = "rp_query_hint_v6";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 12000];

const SINGLE_PIPELINE_STEPS = [
    { event: "start", icon: "⬡", label: "Connecting" },
    { event: "structure", icon: "◈", label: "Reading structure" },
    { event: "section_start", icon: "⟁", label: "Extracting" },
    { event: "section_extracted", icon: "▦", label: "Writing LaTeX" },
    { event: "assembling", icon: "⊟", label: "Assembling" },
    { event: "done", icon: "✦", label: "Complete" },
];

const MULTI_PIPELINE_STEPS = [
    { event: "start", icon: "⬡", label: "Connecting" },
    { event: "doc_start", icon: "◈", label: "Analyzing documents" },
    { event: "doc_analyzed", icon: "▦", label: "Extracting findings" },
    { event: "assembling", icon: "⊟", label: "Synthesizing" },
    { event: "done", icon: "✦", label: "Complete" },
];

const cleanName = (s = "") =>
    s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

/* ─── SVG icons ──────────────────────────────────────────────── */
const Icons = {
    File: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
    FileText: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="11" x2="15" y2="11" /></svg>,
    ChevLeft: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>,
    ChevDown: (p = {}) => <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>,
    Copy: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>,
    Download: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
    Edit: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    Zap: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>,
    X: (p = {}) => <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
    Refresh: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
    Check: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
    Plus: (p = {}) => <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    Minus: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    Layers: (p = {}) => <svg width={p.size || 32} height={p.size || 32} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
    Alert: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
    Clock: (p = {}) => <svg width={p.size || 22} height={p.size || 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    ArrowLeft: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>,
    Search: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
    Filter: (p = {}) => <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
    Trash2: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>,
    Target: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
    Network: (p = {}) => <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" /></svg>,
    Document: (p = {}) => <svg width={p.size || 52} height={p.size || 52} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
};

/* ─── LaTeX syntax highlighter (colors from ThemeContext CSS vars) ─ */
function highlightLatex(code) {
    if (!code) return "";
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (code.length > 50000) {
        return `<span style="color:var(--latex-default)">${esc(code)}</span>`;
    }

    let html = esc(code);
    html = html.replace(/(%[^\n]*)/g, `<span style="color:var(--latex-comment)">$1</span>`);
    html = html.replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g, `<span style="color:var(--latex-math)">$1</span>`);
    html = html.replace(/(\\[a-zA-Z]+\*?)/g, `<span style="color:var(--latex-command)">$1</span>`);
    html = html.replace(/([{}])/g, `<span style="color:var(--latex-brace)">$1</span>`);
    html = html.replace(/(\[|\])/g, `<span style="color:var(--latex-string)">$1</span>`);
    html = html.replace(/(&amp;|_|\^|~)/g, `<span style="color:var(--latex-special)">$1</span>`);

    return `<span style="color:var(--latex-default)">${html}</span>`;
}

/* ─── LaTeX editor ───────────────────────────────────────────── */
const LaTeXEditor = forwardRef(function LaTeXEditor({ value, onChange, readOnly, fontSize = 13 }, ref) {
    const { isDark } = useTheme();
    const taRef = useRef(null);
    const preRef = useRef(null);
    const gutRef = useRef(null);
    const lh = Math.round(fontSize * 1.72);
    const count = value.split("\n").length;
    const sync = useCallback(() => {
        const ta = taRef.current; if (!ta) return;
        if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
        if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop;
    }, []);
    useEffect(() => { sync(); }, [value, sync]);

    useImperativeHandle(ref, () => ({
        scrollToLine: (lineIndex) => {
            if (taRef.current) {
                taRef.current.scrollTo({ top: lineIndex * lh, behavior: 'smooth' });
                taRef.current.focus();
                // We sync after a tiny delay so the smooth scroll can be captured
                setTimeout(sync, 50);
            }
        }
    }), [lh, sync]);

    const gutterText = useMemo(() => {
        let s = "";
        for (let i = 1; i <= count; i++) s += i + "\n";
        return s;
    }, [count]);
    const highlighted = useMemo(() => highlightLatex(value), [value, isDark]);
    const mono = { fontFamily: "var(--font-mono)", fontSize, lineHeight: `${lh}px`, tabSize: 2, whiteSpace: "pre", overflowWrap: "normal" };
    return (
        <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--ed-bg)" }}>
            <div ref={gutRef} style={{ width: 52, flexShrink: 0, background: "var(--ed-gutter)", borderRight: "1px solid var(--border)", overflowY: "hidden", overflowX: "hidden", userSelect: "none" }}>
                <div style={{ ...mono, paddingTop: 10, paddingRight: 10, textAlign: "right", color: "var(--text-faint)" }}>
                    {gutterText}
                    <div style={{ height: lh * 2 }} />
                </div>
            </div>
            <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
                <pre ref={preRef} aria-hidden style={{ ...mono, position: "absolute", inset: 0, margin: 0, padding: "10px 24px 10px 14px", overflow: "hidden", pointerEvents: "none", userSelect: "none" }} dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
                <textarea ref={taRef} value={value} onChange={readOnly ? undefined : e => onChange(e.target.value)} onScroll={sync}
                    readOnly={readOnly} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                    style={{ ...mono, position: "absolute", inset: 0, margin: 0, padding: "10px 24px 10px 14px", background: "transparent", color: "transparent", caretColor: "var(--accent)", border: "none", outline: "none", resize: "none", width: "100%", height: "100%", overflowX: "auto", overflowY: "auto" }} />
            </div>
        </div>
    );
});

/* ─── Section outline ────────────────────────────────────────── */
function Outline({ latex, onSectionClick }) {
    const sections = useMemo(() => {
        if (!latex) return [];
        const res = [], re = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}/g; let m;
        while ((m = re.exec(latex)) !== null) {
            const lineIndex = latex.substring(0, m.index).split('\n').length - 1;
            res.push({ level: m[1], title: m[2], lineIndex });
        }
        return res;
    }, [latex]);
    if (!sections.length) return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, padding: "24px 12px" }}>
            <Icons.Layers size={28} color="var(--text-faint)" />
            <p style={{ margin: 0, color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--font-ui)", textAlign: "center", lineHeight: 1.6 }}>Outline appears<br />after generation</p>
        </div>
    );
    return (
        <div style={{ overflow: "auto", flex: 1, padding: "8px 6px" }}>
            {sections.map((s, i) => {
                const isSec = s.level === "section";
                const isSub = s.level === "subsection";
                
                const indent = isSec ? 4 : isSub ? 22 : 40;
                
                return (
                    <div key={i} onClick={() => onSectionClick?.(s.lineIndex)} style={{ 
                        padding: "5px 6px", 
                        marginLeft: indent, 
                        marginRight: 2,
                        marginBottom: 1,
                        fontSize: 12, 
                        fontWeight: isSec ? 500 : 400,
                        color: isSec ? "var(--text-primary)" : "var(--text-body)", 
                        cursor: "pointer", 
                        whiteSpace: "nowrap", 
                        overflow: "hidden", 
                        textOverflow: "ellipsis", 
                        fontFamily: "var(--font-ui)",
                        borderRadius: 5,
                        transition: "background .12s ease",
                        display: "flex",
                        alignItems: "center",
                        gap: 6
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                        
                        {isSec ? (
                            <Icons.FileText size={13} color="var(--accent)" />
                        ) : (
                            <div style={{ width: 13, display: "flex", justifyContent: "center" }}>
                                <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--text-faint)" }} />
                            </div>
                        )}
                        
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.01em" }}>
                            {s.title}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Live log ───────────────────────────────────────────────── */
function LiveLog({ log, loading, detectedMeta, mode, docStatus }) {
    const endRef = useRef(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [log]);
    return (
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {mode === "multi" && docStatus && docStatus.length > 0 && (
                <div style={{ margin: "10px 10px 4px", padding: "8px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6 }}>
                    <div style={{ fontSize: 9, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6, fontFamily: "var(--font-mono)" }}>Documents</div>
                    {docStatus.map((d, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: d.done ? (d.found ? "var(--green-vivid)" : "var(--text-faint)") : "var(--accent)", animation: !d.done ? "blink 1.2s ease-in-out infinite" : "none" }} />
                            <span style={{ fontSize: 10, flex: 1, color: "var(--text-body)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.filename}>{cleanName(d.filename)}</span>
                            <span style={{ fontSize: 9, color: d.found ? "var(--green-vivid)" : d.done ? "var(--text-faint)" : "var(--accent)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                                {d.done ? (d.found ? "✓ relevant" : "— none") : "…"}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {mode === "single" && detectedMeta && (
                <div style={{ margin: "10px 10px 4px", padding: "8px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 10, fontFamily: "var(--font-mono)", lineHeight: 1.9 }}>
                    {[["Material", detectedMeta.material], ["Heat No.", detectedMeta.heat], ["Sections", (detectedMeta.sections_found || []).length], ["Chunks", (detectedMeta.total_chunks || 0).toLocaleString()]].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-faint)" }}>{k}</span>
                            <span style={{ color: "var(--accent)" }}>{v}</span>
                        </div>
                    ))}
                </div>
            )}
            {log.map((entry, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", borderBottom: "1px solid var(--border)", animation: "slideIn .15s ease both" }}>
                    <span style={{ fontSize: 11, width: 14, flexShrink: 0, color: entry.done ? "var(--text-faint)" : "var(--accent)" }}>{entry.icon}</span>
                    <span style={{ fontSize: 10, flex: 1, color: entry.done ? "var(--text-faint)" : "var(--text-body)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>{entry.label}</span>
                    {i === log.length - 1 && loading && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "blink 1.2s ease-in-out infinite" }} />}
                </div>
            ))}
            <div ref={endRef} />
            {!loading && log.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, padding: "24px 12px", color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "center" }}>
                    <Icons.Clock size={24} />
                    <span style={{ lineHeight: 1.9 }}>Generate a report<br />to see live progress</span>
                </div>
            )}
        </div>
    );
}

/* ─── DocSelectionPanel ──────────────────────────────────────── *
 * SRP  : only handles multi-PDF file selection UI               *
 * OCP  : reads context; doesn't know about report generation    *
 * DIP  : depends on context abstraction, not concrete state     *
 * ─────────────────────────────────────────────────────────────*/
function DocSelectionPanel({ docStatus, loading }) {
    const {
        files,
        selectedFiles,
        toggleFileSelection,
        selectAllFiles,
        clearFileSelection,
        handleReindex,
    } = useFileStore();

    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState(false);

    // Show all files in the selection list, not just ready ones
    const displayFiles = files;
    const indexingFiles = files.filter(f => f.status === "indexing");

    const filtered = useMemo(() =>
        displayFiles.filter(f =>
            search.trim() === "" ||
            cleanName(f.name).toLowerCase().includes(search.toLowerCase())
        ),
        [displayFiles, search]);

    const allSelected = displayFiles.length > 0 && displayFiles.every(f => selectedFiles.includes(f.name));
    const noneSelected = selectedFiles.length === 0;

    /* dot color: driven by live docStatus when generation is active */
    const dotColor = (filename) => {
        if (!loading) {
            return selectedFiles.includes(filename) ? "var(--multi-accent)" : "var(--border-mid)";
        }
        const ds = docStatus.find(d => d.filename === filename);
        if (!ds) return "var(--border-mid)";
        if (!ds.done) return "var(--accent)";
        return ds.found ? "var(--green-vivid)" : "var(--text-faint)";
    };

    const dotAnim = (filename) => {
        if (!loading) return "none";
        const ds = docStatus.find(d => d.filename === filename);
        return (ds && !ds.done) ? "blink 1.2s ease-in-out infinite" : "none";
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* ── Section header ── */}
            <div
                onClick={() => setCollapsed(c => !c)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", height: 34, cursor: "pointer", borderBottom: "1px solid var(--border)", userSelect: "none", flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Icons.Layers size={11} color="var(--multi-accent)" />
                    <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".1em", fontFamily: "var(--font-mono)" }}>
                        Documents
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* selected / total badge */}
                    <span style={{
                        fontSize: 9,
                        background: selectedFiles.length === 0 ? "var(--bg-elevated)" : "var(--multi-dim)",
                        color: selectedFiles.length === 0 ? "var(--text-faint)" : "var(--multi-accent)",
                        border: `1px solid ${selectedFiles.length === 0 ? "var(--border)" : "var(--multi-border)"}`,
                        padding: "1px 7px", borderRadius: 99, fontFamily: "var(--font-mono)",
                        transition: "all .2s",
                    }}>
                        {selectedFiles.length}/{displayFiles.length}
                    </span>
                    <span style={{ color: "var(--text-faint)", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform .2s", display: "inline-flex" }}>
                        <Icons.ChevDown size={11} />
                    </span>
                </div>
            </div>

            {!collapsed && (
                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>

                    {/* ── Search bar ── */}
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}>
                            <Icons.Search size={10} color="var(--text-faint)" />
                            <input
                                type="text"
                                placeholder="Filter docs…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-body)", minWidth: 0 }}
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center", padding: 0 }}>
                                    <Icons.X size={9} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ── Select all / none ── */}
                    <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                        <button
                            onClick={selectAllFiles}
                            disabled={allSelected || displayFiles.length === 0}
                            style={{
                                flex: 1, height: 26, background: "transparent", border: "none",
                                borderRight: "1px solid var(--border)",
                                fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em",
                                color: allSelected ? "var(--text-faint)" : "var(--multi-accent)",
                                cursor: allSelected ? "default" : "pointer",
                                fontFamily: "var(--font-mono)",
                                transition: "all .15s",
                                opacity: allSelected ? 0.4 : 1,
                            }}
                            onMouseEnter={e => { if (!allSelected) e.currentTarget.style.background = "var(--multi-dim-soft)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                            Select all
                        </button>
                        <button
                            onClick={clearFileSelection}
                            disabled={noneSelected}
                            style={{
                                flex: 1, height: 26, background: "transparent", border: "none",
                                fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em",
                                color: noneSelected ? "var(--text-faint)" : "var(--text-muted)",
                                cursor: noneSelected ? "default" : "pointer",
                                fontFamily: "var(--font-mono)",
                                transition: "all .15s",
                                opacity: noneSelected ? 0.4 : 1,
                            }}
                            onMouseEnter={e => { if (!noneSelected) e.currentTarget.style.background = "var(--bg-elevated)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                            Clear
                        </button>
                    </div>

                    {/* ── File rows ── */}
                    <div style={{ overflowY: "auto", maxHeight: 400, flexShrink: 0 }}>
                        {displayFiles.length === 0 && (
                            <div style={{ padding: "16px 10px", textAlign: "center", color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--font-mono)", lineHeight: 1.8 }}>
                                No indexed documents.<br />Upload PDFs first.
                            </div>
                        )}

                        {filtered.length === 0 && displayFiles.length > 0 && (
                            <div style={{ padding: "10px", textAlign: "center", color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                                No match for "{search}"
                            </div>
                        )}

                        {filtered.map(f => {
                            const isSelected = selectedFiles.includes(f.name);
                            const ds = docStatus.find(d => d.filename === f.name);

                            return (
                                <div
                                    key={f.name}
                                    onClick={() => !loading && toggleFileSelection(f.name)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 8,
                                        padding: "5px 10px",
                                        borderBottom: "1px solid var(--border)",
                                        cursor: loading ? "not-allowed" : "pointer",
                                        background: isSelected ? "var(--multi-dim-soft)" : "transparent",
                                        transition: "background .12s",
                                        opacity: loading ? 0.75 : 1,
                                    }}
                                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = isSelected ? "var(--multi-dim-hover)" : "var(--bg-elevated)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = isSelected ? "var(--multi-dim-soft)" : "transparent"; }}
                                    title={f.name}
                                >
                                    {/* Checkbox */}
                                    <div style={{
                                        width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                                        border: `1.5px solid ${isSelected ? "var(--multi-accent)" : "var(--border-mid)"}`,
                                        background: isSelected ? "var(--multi-accent)" : "transparent",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        transition: "all .15s",
                                    }}>
                                        {isSelected && <Icons.Check size={9} color="var(--on-multi)" />}
                                    </div>

                                    {/* Filename */}
                                    <span style={{
                                        flex: 1, fontSize: 10, fontFamily: "var(--font-mono)",
                                        color: isSelected ? "var(--multi-text)" : "var(--text-muted)",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        transition: "color .15s",
                                    }}>
                                        {cleanName(f.name)}
                                    </span>

                                    {/* Live relevance dot */}
                                    <span title={ds?.done ? (ds.found ? "Relevant" : "No data found") : loading ? "Analyzing…" : ""} style={{
                                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                        background: dotColor(f.name),
                                        animation: dotAnim(f.name),
                                        transition: "background .3s",
                                    }} />

                                    {/* Reindex Button */}
                                    <button 
                                        onClick={e => { e.stopPropagation(); handleReindex(f.name); }} 
                                        title="Re-index document"
                                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, transition: "color .12s" }}
                                        onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                                        onMouseLeave={e => e.currentTarget.style.color = "var(--text-faint)"}
                                    >
                                        <Icons.Refresh size={10} />
                                    </button>
                                </div>
                            );
                        })}

                        {indexingFiles.length > 0 && (
                            <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--border)" }}>
                                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "blink 1.2s ease-in-out infinite", flexShrink: 0 }} />
                                <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                                    {indexingFiles.length} indexing…
                                </span>
                            </div>
                        )}
                    </div>

                    {/* ── Summary footer ── */}
                    {selectedFiles.length > 0 && (
                        <div style={{ padding: "5px 10px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span style={{ fontSize: 18, color: "var(--multi-accent)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{selectedFiles.length}</span>
                            <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
                                doc{selectedFiles.length !== 1 ? "s" : ""}<br />selected
                            </span>
                            {loading && docStatus.length > 0 && (
                                <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--green-vivid)", fontFamily: "var(--font-mono)" }}>
                                    {docStatus.filter(d => d.done && d.found).length} relevant
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ─── PDF viewer ─────────────────────────────────────────────── */
function PDFViewer({ pdfUrl, compiling, onCompile, latexSource, compileError }) {
    const [zoom, setZoom] = useState(100);
    if (!pdfUrl) return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--bg-panel)" }}>
            <div style={{ opacity: 0.25 }}><Icons.Document size={52} color="var(--text-muted)" /></div>
            <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text-body)", fontWeight: 500 }}>No compiled PDF yet</p>
            <button onClick={onCompile} disabled={!latexSource || compiling} style={{ ...ab("primary"), padding: "7px 20px", marginTop: 4, opacity: (!latexSource || compiling) ? 0.4 : 1 }}>
                {compiling ? <><Spinner col="var(--on-accent)" /> Compiling…</> : <><Icons.Refresh size={13} /> Compile → PDF</>}
            </button>
            {compileError && <p style={{ margin: 0, color: "var(--red-soft)", fontSize: 12, fontFamily: "var(--font-mono)", maxWidth: 280, textAlign: "center" }}>{compileError}</p>}
        </div>
    );
    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-panel)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 44, flexShrink: 0, background: "var(--toolbar-bg)", backdropFilter: "var(--toolbar-blur)", WebkitBackdropFilter: "var(--toolbar-blur)", borderBottom: "1px solid var(--toolbar-border)", boxShadow: "var(--toolbar-shadow)", zIndex: 10 }}>
                <button onClick={onCompile} disabled={compiling} style={ab("green")}>
                    {compiling ? <><Spinner col="var(--bg-base)" /> Compiling…</> : <><Icons.Refresh size={13} /> Compile PDF</>}
                </button>
                <button onClick={() => {
                    const a = document.createElement("a");
                    a.href = pdfUrl;
                    a.download = "report.pdf";
                    a.click();
                }} style={ab("teal")}>
                    <Icons.Download size={13} /> .pdf
                </button>
                <div style={{ flex: 1 }} />
                <IBtn onClick={() => setZoom(z => Math.max(50, z - 10))}><Icons.Minus size={12} /></IBtn>
                <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 38, textAlign: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{zoom}%</span>
                <IBtn onClick={() => setZoom(z => Math.min(200, z + 10))}><Icons.Plus size={11} /></IBtn>
            </div>
            <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", background: "var(--bg-panel)", padding: "16px 0" }}>
                <iframe src={pdfUrl} title="Compiled PDF" style={{ width: `${zoom}%`, flex: "none", border: "none", background: "white", boxShadow: "var(--pdf-shadow)", minHeight: "calc(100vh - 120px)", transition: "width .2s ease" }} />
            </div>
        </div>
    );
}

/* ─── Shared atoms ───────────────────────────────────────────── */
const Spinner = ({ col = "var(--accent)" }) => (
    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "2px solid transparent", borderTopColor: col, animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
);
const Sep = () => <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />;
const IBtn = ({ onClick, children, title }) => (
    <button onClick={onClick} title={title} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", borderRadius: 5, width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all .12s", flexShrink: 0 }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.color = "var(--text-body)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
        {children}
    </button>
);
const ab = (variant = "ghost") => {
    const base = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 13, padding: "5px 12px", transition: "all .15s ease", userSelect: "none", flexShrink: 0 };
    const v = {
        primary: { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--on-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" },
        green: { background: "var(--green-vivid)", borderColor: "var(--green-vivid)", color: "var(--bg-base)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" },
        teal: { background: "var(--teal)", borderColor: "var(--teal)", color: "var(--bg-base)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" },
        multi: { background: "var(--multi-accent)", borderColor: "var(--multi-accent)", color: "var(--on-multi)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" },
        ghost: { background: "rgba(255, 255, 255, 0.04)", borderColor: "var(--border)", color: "var(--text-body)", backdropFilter: "blur(8px)" },
        danger: { background: "transparent", borderColor: "transparent", color: "var(--red-soft)" },
    };
    return { ...base, ...(v[variant] || v.ghost) };
};

/* ─── Main component ─────────────────────────────────────────── */
export default function ReportPanel() {
    const navigate = useNavigate();
    const {
        selectedFile, setSelectedFile, files,
        selectedFiles,
        handleDeleteFile, handleReindex
    } = useFileStore();

    const {
        reportLatex, setReportLatex,
        reportSections, setReportSections,
        reportQuery, setReportQuery,
        reportTitle, setReportTitle,
        reportMode, setReportMode,
        reportDocResults, setReportDocResults,

        // Persistent UI/Generation States
        reportLiveLog,
        reportActiveStep,
        reportDetectedMeta,
        reportDocStatus,
        reportLocalQuery, setReportLocalQuery,
        reportLeftTab, setReportLeftTab,
        reportQueryHint, persistHint,
        reportApproach, setReportApproach,

        // In-Memory States
        reportLoading,
        reportError,
        reportRateLimitMsg,
        reportPdfUrl,
        reportCompiling,
        reportCompileError,

        // Actions
        generateSingle, generateMulti, cancelReport, compileToPdf
    } = useReportStore();

    const filename = selectedFile;
    const isMultiMode = reportMode === "multi";

    const [leftWidth, setLeftWidth] = useState(240);
    const [editorWidth, setEditorWidth] = useState(50);
    const [editMode, setEditMode] = useState(false);
    const [fontSize, setFontSize] = useState(13);
    const [localLatex, setLocalLatex] = useState(reportLatex || "");
    const [copied, setCopied] = useState(false);
    const [showDocModal, setShowDocModal] = useState(false);

    const containerRef = useRef(null);
    const editorRef = useRef(null);

    // Sync fast local latex to global state with a 1000ms debounce (only when editing)
    useEffect(() => {
        if (!editMode) return;
        if (localLatex === reportLatex) return;
        const timer = setTimeout(() => {
            setReportLatex(localLatex);
        }, 1000);
        return () => clearTimeout(timer);
    }, [localLatex, reportLatex, setReportLatex, editMode]);

    // Instantly save edits when exiting edit mode
    useEffect(() => {
        if (!editMode && localLatex !== reportLatex) {
            setReportLatex(localLatex);
        }
    }, [editMode, localLatex, reportLatex, setReportLatex]);

    const [prevReportLatex, setPrevReportLatex] = useState(reportLatex);

    // Keep fast local state updated synchronously if reportLatex is updated externally
    // This prevents 1-frame layout flickering when starting/receiving streams
    if (reportLatex !== prevReportLatex) {
        setPrevReportLatex(reportLatex);
        setLocalLatex(reportLatex || "");
    }



    useEffect(() => {
        if (!isMultiMode && !filename) navigate("/", { replace: true });
    }, [filename, isMultiMode, navigate]);

    const PIPELINE_STEPS = isMultiMode ? MULTI_PIPELINE_STEPS : SINGLE_PIPELINE_STEPS;

    const downloadTex = () => {
        if (!localLatex) return;
        const url = URL.createObjectURL(new Blob([localLatex], { type: "text/plain" }));
        const name = isMultiMode ? `multi_report_${reportLocalQuery.slice(0, 20).replace(/\s+/g, "_")}.tex` : `${cleanName(filename)}_report.tex`;
        Object.assign(document.createElement("a"), { href: url, download: name }).click();
        URL.revokeObjectURL(url);
    };

    const downloadPdf = () => {
        if (!reportPdfUrl) return;
        const name = isMultiMode ? `multi_report.pdf` : `${cleanName(filename)}_report.pdf`;
        Object.assign(document.createElement("a"), { href: reportPdfUrl, download: name }).click();
    };

    const copyLatex = () => {
        if (!localLatex) return;
        navigator.clipboard.writeText(localLatex).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };

    const lineCount = useMemo(() => localLatex ? localLatex.split("\n").length : 0, [localLatex]);
    const charCount = localLatex.length;
    const docsInvolved = isMultiMode
        ? (selectedFiles.length > 0 ? selectedFiles : files.filter(f => f.status === "ready").map(f => f.name))
        : [];

    const startLeftDrag = e => {
        e.preventDefault();
        const start = e.clientX, startW = leftWidth;
        const mv = e2 => setLeftWidth(Math.max(180, Math.min(380, startW + e2.clientX - start)));
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    };

    const startCenterDrag = e => {
        e.preventDefault();
        const ct = containerRef.current; if (!ct) return;
        const rect = ct.getBoundingClientRect();
        const avail = rect.width - leftWidth;
        const mv = e2 => { const pct = ((e2.clientX - rect.left - leftWidth) / avail) * 100; setEditorWidth(Math.max(25, Math.min(75, pct))); };
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    };

    if (!isMultiMode && !filename) return null;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--bg-base)", color: "var(--text-body)", fontFamily: "var(--font-mono)", transition: "background .25s, color .25s" }}>
            
            <style>{`
                @keyframes slideIn { from{opacity:0;transform:translateX(-5px)} to{opacity:1;transform:none} }
                @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
                @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:.12} }
                @keyframes spin    { to{transform:rotate(360deg)} }
                @keyframes pulse   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
                @keyframes fadeSlideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
                ::-webkit-scrollbar { width:4px; height:4px; }
                ::-webkit-scrollbar-track { background:transparent; }
                ::-webkit-scrollbar-thumb { background:var(--scrollbar); border-radius:2px; }
                .dh { cursor:col-resize; }
                .dh:hover { background:var(--bg-elevated) !important; }
                .tb { background:transparent; border:none; cursor:pointer; transition:all .15s; border-radius:0; font-family:var(--font-ui); font-weight:var(--fw-label); }
                .tb:hover { background:var(--bg-elevated); }
                .seg-ctrl { display:flex; position:relative; background:var(--seg-track-bg); border-radius:8px; padding:3px; border:1px solid var(--seg-track-border); }
                .seg-btn { flex:1; position:relative; z-index:2; border:none; background:transparent; font-size:11px; font-weight:500; font-family:var(--font-ui); color:var(--seg-text-inactive); cursor:pointer; padding:5px 0; transition:color .2s ease; display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.02em; }
                .seg-btn.active { color:var(--seg-text-active); font-weight:600; }
                .seg-indicator { position:absolute; top:3px; bottom:3px; width:calc(50% - 3px); background:var(--seg-thumb-bg); border:1px solid var(--seg-thumb-border); border-radius:6px; box-shadow:var(--seg-thumb-shadow); transition:transform .25s cubic-bezier(0.4, 0.0, 0.2, 1); z-index:1; }
                .stepper-line { position:absolute; left:6px; top:12px; bottom:-12px; width:2px; background:var(--border); z-index:0; }
                .stepper-line.active { background:var(--accent); }
            `}</style>

            {/* ── Document Selection Modal ── */}
            {showDocModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm animate-[fadeIn_0.12s_ease]" style={{ background: "var(--overlay-bg)" }} onClick={() => setShowDocModal(false)}>
                    <div className="relative w-full max-w-3xl mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl animate-[fadeSlideUp_0.18s_ease]" onClick={e => e.stopPropagation()} style={{ fontFamily: "sans-serif" }}>
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-sm font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Select Document</h2>
                                <p className="text-[10px] text-[var(--text-faint)] mt-1 tracking-widest uppercase font-mono">Switch document for single-report analysis</p>
                            </div>
                            <button onClick={() => setShowDocModal(false)} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                                <Icons.X size={13} />
                            </button>
                        </div>

                        <div className="flex flex-col gap-1.5 max-h-[55vh] overflow-y-auto pr-2">
                            {files.map(f => (
                                <div key={f.name} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${selectedFile === f.name ? "bg-[var(--accent-dim)] border-[var(--accent)]/40" : "border-transparent hover:bg-[var(--bg-elevated)]"}`}>
                                    <button onClick={() => { setSelectedFile(f.name); setShowDocModal(false); }} className={`flex items-center gap-3 flex-1 text-left bg-transparent border-none cursor-pointer text-[13px] font-mono ${selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-body)]"}`}>
                                        <Icons.FileText size={14} className={selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} />
                                        <span className="flex-1 truncate">{f.name}</span>
                                        {f.status === "indexing" && <span className="text-[10px] text-[var(--accent)]/60 flex items-center gap-1 animate-pulse"><Icons.Clock size={10} />indexing</span>}
                                        {selectedFile === f.name && f.status !== "indexing" && <Icons.Check size={14} className="text-[var(--accent)]" />}
                                    </button>
                                    <div style={{ display: "flex", gap: 4 }}>
                                        <button onClick={e => { e.stopPropagation(); handleReindex(f.name); }} className="p-2 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors" title="Re-index document">
                                            <Icons.Refresh size={13} />
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); handleDeleteFile(f.name); }} className="p-2 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--red-soft)] transition-colors" title="Delete document">
                                            <Icons.Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Topbar ── */}
            <div style={{ display: "flex", alignItems: "center", height: 48, flexShrink: 0, background: "var(--toolbar-bg)", borderBottom: "1px solid var(--toolbar-border)", backdropFilter: "var(--toolbar-blur)", WebkitBackdropFilter: "var(--toolbar-blur)", boxShadow: "var(--toolbar-shadow)", padding: "0 14px", gap: 12, zIndex: 30 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 17, color: "var(--accent)", animation: reportLoading ? "pulse 2s ease-in-out infinite" : "none" }}>◈</span>
                    <span style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600 }}>CMTI</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 4 }}>
                        {isMultiMode ? "Multi-PDF Engine" : "Report Engine"}
                    </span>
                </div>
                
                <div style={{ display: "flex", flex: 1, justifyContent: "center" }}>
                    {!isMultiMode && filename && (
                        <button 
                            onClick={() => setShowDocModal(true)}
                            style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 12px", cursor: "pointer", transition: "all .12s" }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--accent-dim)"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)"; }}
                        >
                            <Icons.FileText size={12} color="var(--accent)" />
                            <span style={{ fontSize: 11, color: "var(--text-body)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{cleanName(filename)}</span>
                            <Icons.ChevDown size={10} color="var(--text-faint)" />
                        </button>
                    )}
                    {isMultiMode && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--multi-chip-bg)", border: "1px solid var(--multi-chip-border)", borderRadius: 6, padding: "3px 12px" }}>
                            <Icons.Layers size={12} color="var(--multi-accent)" />
                            <span style={{ fontSize: 11, color: "var(--text-body)", fontWeight: 500 }}>{docsInvolved.length} documents involved</span>
                        </div>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" }}>
                    <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
                        <button onClick={() => setReportMode("single")} style={{ ...ab(isMultiMode ? "ghost" : "primary"), fontSize: 10, padding: "3px 10px" }}>Single PDF</button>
                        <button onClick={() => setReportMode("multi")} style={{ ...ab(isMultiMode ? "multi" : "ghost"), fontSize: 10, padding: "3px 10px" }}>Multi PDF</button>
                    </div>
                    <ThemeToggle />
                    <button onClick={() => navigate("/")} style={{ ...ab("ghost"), gap: 6, padding: "4px 8px" }}>
                        <Icons.ArrowLeft size={13} /> Back to Chat
                    </button>
                </div>
            </div>

            {/* ── Banners ── */}
            {reportRateLimitMsg && (
                <div style={{ padding: "5px 14px", background: "var(--warn-dim)", borderBottom: "1px solid var(--warn-border)", fontSize: 10, color: "var(--warn)", fontFamily: "var(--font-mono)", display: "flex", gap: 8, alignItems: "center" }}>
                    <Spinner col="var(--warn)" /> {reportRateLimitMsg}
                </div>
            )}
            {reportError && (
                <div style={{ padding: "5px 14px", background: "var(--red-dim)", borderBottom: "1px solid var(--red-border)", fontSize: 10, color: "var(--red-soft)", fontFamily: "var(--font-mono)", display: "flex", gap: 8, alignItems: "center" }}>
                    <Icons.Alert size={12} /> {reportError}
                    {!reportError.includes("Cancelled") && (
                        <button onClick={isMultiMode ? generateMulti : generateSingle} style={{ background: "none", border: "none", color: "var(--red-soft)", cursor: "pointer", textDecoration: "underline", fontSize: 10, padding: 0 }}>Retry</button>
                    )}
                </div>
            )}
            {reportCompileError && (
                <div style={{ padding: "5px 14px", background: "var(--red-dim)", borderBottom: "1px solid var(--red-border)", fontSize: 10, color: "var(--red-soft)", fontFamily: "var(--font-mono)", display: "flex", gap: 6, alignItems: "center" }}>
                    <Icons.Alert size={12} /> Compile error: {reportCompileError}
                </div>
            )}

            {/* ── Main body ── */}
            <div ref={containerRef} style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

                {/* ── Left sidebar ── */}
                <div style={{ width: leftWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--panel-glass-bg)", borderRight: "1px solid var(--panel-glass-border)", backdropFilter: "var(--panel-blur)", WebkitBackdropFilter: "var(--panel-blur)", boxShadow: "inset -1px 0 0 var(--panel-glass-highlight)", overflow: "hidden", zIndex: 5 }}>

                    {/* ━━━ MULTI MODE: DocSelectionPanel replaces static list ━━━ */}
                    {isMultiMode
                        ? <DocSelectionPanel docStatus={reportDocStatus} loading={reportLoading} />
                        : (
                            /* Single mode: existing single-file chip */
                            <>
                                <div style={{ padding: "10px 10px 0" }}>
                                    <div style={{ fontSize: "var(--fs-label)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", fontWeight: "var(--fw-label)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>Focus hint</div>
                                    <input type="text" placeholder="HIC results, grain size…" value={reportQueryHint} onChange={e => persistHint(e.target.value)}
                                        onKeyDown={e => e.key === "Enter" && !reportLoading && filename && generateSingle()} disabled={reportLoading}
                                        style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-body)", fontFamily: "var(--font-ui)", fontSize: 13, padding: "7px 10px", borderRadius: 8, outline: "none", transition: "all .2s ease" }}
                                        onFocus={e => { e.target.style.borderColor = "var(--border-mid)"; e.target.style.boxShadow = "0 0 0 2px var(--focus-ring)"; }} onBlur={e => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }} />
                                </div>
                            </>
                        )
                    }

                    {files.length > 0 && (
                        <>

                            {/* ── Search Approach Toggle ── */}
                            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                                <div style={{ fontSize: "var(--fs-label)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", fontWeight: "var(--fw-label)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>Retrieval Approach</div>
                                <div className="seg-ctrl">
                                    <div className="seg-indicator" style={{ transform: reportApproach === "tree" ? "translateX(0)" : "translateX(100%)" }} />
                                    <button
                                        onClick={() => setReportApproach("tree")}
                                        className={`seg-btn ${reportApproach === "tree" ? "active" : ""}`}
                                        title="Use PageIndex tree router & direct PDF extraction"
                                    >
                                        <Icons.Network size={12} /> Tree Based
                                    </button>
                                    <button
                                        onClick={() => setReportApproach("vector")}
                                        className={`seg-btn ${reportApproach === "vector" ? "active" : ""}`}
                                        title="Use pure ChromaDB vector search fallback"
                                    >
                                        <Icons.Target size={12} /> Vector Based
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Multi mode: query input below selection panel */}
                    {isMultiMode && (
                        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                            <div style={{ fontSize: "var(--fs-label)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", fontWeight: "var(--fw-label)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>Multi-PDF Query</div>
                            <textarea
                                placeholder="What would you like to extract from these documents? e.g., 'Compare the mechanical properties...'"
                                value={reportLocalQuery || ""}
                                onChange={e => setReportLocalQuery(e.target.value)}
                                disabled={reportLoading}
                                style={{
                                    width: "100%", boxSizing: "border-box", background: "var(--bg-input)",
                                    border: "1px solid var(--border)", color: "var(--text-body)",
                                    fontFamily: "var(--font-ui)", fontSize: 12, padding: "8px 10px",
                                    borderRadius: 8, outline: "none", transition: "all .2s ease",
                                    resize: "vertical", minHeight: 65,
                                    lineHeight: 1.4
                                }}
                                onFocus={e => { e.target.style.borderColor = "var(--multi-accent)"; e.target.style.boxShadow = "0 0 0 2px rgba(139,92,246,0.15)"; }}
                                onBlur={e => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
                            />
                        </div>
                    )}

                    <div style={{ padding: "12px 10px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                        {isMultiMode ? (
                            <button onClick={generateMulti} disabled={reportLoading || !reportLocalQuery.trim() || selectedFiles.length === 0} style={{ ...ab("multi"), flex: 1, padding: "7px 16px", fontWeight: 500, justifyContent: "center", opacity: (reportLoading || !reportLocalQuery.trim() || selectedFiles.length === 0) ? 0.5 : 1 }}>
                                {reportLoading ? <><Spinner col="var(--multi-accent)" /> Analyzing…</> : <><Icons.Layers size={13} /> Analyze {selectedFiles.length} PDFs</>}
                            </button>
                        ) : (
                            <button onClick={generateSingle} disabled={reportLoading || !filename} style={{ ...ab("primary"), flex: 1, padding: "7px 16px", fontWeight: 500, justifyContent: "center", opacity: (reportLoading || !filename) ? 0.5 : 1 }}>
                                {reportLoading ? <><Spinner col="var(--accent)" /> Generating…</> : <><Icons.Zap size={13} /> Generate Report</>}
                            </button>
                        )}
                        {reportLoading && (
                            <button onClick={cancelReport} style={{ ...ab("danger"), padding: "7px 10px" }} title="Cancel">
                                <Icons.X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Tab strip — outline / log */}
                    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginTop: isMultiMode ? 0 : 10, padding: "0 8px 8px" }}>
                        <div style={{ display: "flex", background: "rgba(0,0,0,0.15)", borderRadius: 8, padding: 3, width: "100%", border: "1px solid var(--border-soft)", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)" }}>
                            {[["outline", "Outline"], ["log", `Log${reportLiveLog.length ? ` · ${reportLiveLog.length}` : ""}`]].map(([key, label]) => (
                                <button key={key} onClick={() => setReportLeftTab(key)}
                                    style={{ flex: 1, height: 26, fontSize: 11, fontWeight: 500, fontFamily: "var(--font-ui)", letterSpacing: "0.01em", color: reportLeftTab === key ? "var(--text-primary)" : "var(--text-muted)", background: reportLeftTab === key ? "var(--tab-active-bg)" : "var(--tab-inactive-bg)", border: `1px solid ${reportLeftTab === key ? "var(--tab-active-border)" : "transparent"}`, borderRadius: 6, boxShadow: reportLeftTab === key ? "var(--tab-active-shadow)" : "none", transition: "all .2s ease", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {label}
                                    {key === "log" && reportLoading && <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", marginLeft: 5, animation: "blink 1.2s ease-in-out infinite" }} />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        {reportLeftTab === "outline"
                            ? <Outline latex={localLatex} onSectionClick={line => editorRef.current?.scrollToLine(line)} />
                            : <LiveLog log={reportLiveLog} loading={reportLoading} detectedMeta={reportDetectedMeta} mode={isMultiMode ? "multi" : "single"} docStatus={reportDocStatus} />
                        }
                    </div>

                    {/* Pipeline progress */}
                    {reportActiveStep >= 0 && (
                        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 10px 16px", position: "relative" }}>
                            {PIPELINE_STEPS.map((step, i) => {
                                const isActive = i === reportActiveStep && reportLoading;
                                const isDone = i < reportActiveStep || (!reportLoading && reportActiveStep === PIPELINE_STEPS.length - 1);
                                
                                return (
                                    <div key={step.event} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", position: "relative", zIndex: 1 }}>
                                        {i < PIPELINE_STEPS.length - 1 && (
                                            <div className={`stepper-line ${isDone ? "active" : ""}`} />
                                        )}
                                        <div style={{
                                            width: 14, height: 14, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                            background: isDone ? "var(--accent)" : "var(--bg-panel)",
                                            border: `2px solid ${isDone || isActive ? "var(--accent)" : "var(--border-mid)"}`,
                                            position: "relative", zIndex: 2
                                        }}>
                                            {isActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite" }} />}
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500, fontFamily: "var(--font-ui)", color: isDone || isActive ? "var(--text-body)" : "var(--text-muted)", transition: "all .2s ease" }}>
                                            {step.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Left drag handle */}
                <div className="dh" onMouseDown={startLeftDrag} style={{ width: 4, flexShrink: 0, background: "var(--bg-surface)", borderRight: "1px solid var(--border)", transition: "background .12s" }} />

                {/* ── Editor ── */}
                <div style={{ width: `${editorWidth}%`, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--ed-bg)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", height: 38, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 16px", height: "100%", borderRight: "1px solid var(--border)", background: "var(--ed-bg)", borderTop: `2px solid ${isMultiMode ? "var(--multi-accent)" : "var(--accent)"}` }}>
                            <Icons.FileText size={11} color={isMultiMode ? "var(--multi-accent)" : "var(--accent)"} />
                            <span style={{ fontSize: 11, color: isMultiMode ? "var(--multi-accent)" : "var(--accent)" }}>{localLatex ? "report.tex" : "—"}</span>
                        </div>
                        
                        <div style={{ flex: 1 }} />
                        
                        {localLatex && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 12 }}>
                                <button onClick={() => setEditMode(m => !m)} style={{ ...ab(editMode ? "primary" : "ghost"), padding: "3px 10px", fontSize: 10 }}>
                                    <Icons.Edit size={11} /> {editMode ? "Read-only" : "Edit"}
                                </button>
                                <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 4px" }} />
                                <IBtn onClick={() => setFontSize(s => Math.max(10, s - 1))} title="Smaller font"><Icons.Minus size={10} /></IBtn>
                                <span style={{ fontSize: 10, color: "var(--text-faint)", minWidth: 16, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{fontSize}</span>
                                <IBtn onClick={() => setFontSize(s => Math.min(18, s + 1))} title="Larger font"><Icons.Plus size={10} /></IBtn>
                                <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 4px" }} />
                                <button onClick={copyLatex} style={{ ...ab("ghost"), color: copied ? "var(--green-vivid)" : "var(--text-muted)", padding: "3px 8px" }} title="Copy LaTeX">
                                    {copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
                                </button>
                                <button onClick={downloadTex} style={{ ...ab("ghost"), padding: "3px 8px" }} title="Download .tex">
                                    <Icons.Download size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                        <LaTeXEditor ref={editorRef} value={localLatex} onChange={setLocalLatex} readOnly={!editMode} fontSize={fontSize} />
                        
                        <div style={{
                            position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, background: "var(--ed-bg)", zIndex: 10,
                            opacity: (!localLatex || (reportLoading && !localLatex)) ? 1 : 0,
                            pointerEvents: (!localLatex || (reportLoading && !localLatex)) ? "auto" : "none",
                            transition: "opacity 0.25s ease-in-out"
                        }}>
                            {reportLoading ? (
                                <>
                                    <div style={{ fontSize: 34, color: isMultiMode ? "var(--multi-accent)" : "var(--accent)", animation: "spin 2.5s linear infinite" }}>◈</div>
                                    <p style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--text-muted)" }}>
                                        {isMultiMode ? `Analyzing ${docsInvolved.length} documents…` : "Generating report…"}
                                    </p>
                                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.9 }}>
                                        Switch to <strong style={{ color: "var(--text-muted)" }}>Log</strong> to watch live progress
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div style={{ opacity: 0.18 }}><Icons.Layers size={52} color="var(--text-muted)" /></div>
                                    <p style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--text-muted)" }}>
                                        {isMultiMode ? "Ready for multi-PDF analysis" : "Ready to generate"}
                                    </p>
                                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 2 }}>
                                        {isMultiMode
                                            ? <>Enter a query above and click <strong style={{ color: "var(--text-muted)" }}>Analyze {selectedFiles.length} PDFs</strong>.<br />The engine will extract and synthesize data from all documents.</>
                                            : <>Sections are auto-discovered from the PDF.<br />Output is a fully compilable LaTeX document.</>
                                        }
                                    </p>
                                    <button onClick={isMultiMode ? generateMulti : generateSingle}
                                        disabled={isMultiMode ? (!reportLocalQuery.trim() || selectedFiles.length === 0) : !filename}
                                        style={{ ...ab(isMultiMode ? "multi" : "primary"), marginTop: 6, padding: "7px 20px", opacity: (isMultiMode && (!reportLocalQuery.trim() || selectedFiles.length === 0)) ? 0.4 : 1 }}>
                                        {isMultiMode ? <><Icons.Layers size={13} /> Analyze {selectedFiles.length} PDFs</> : <><Icons.Zap size={13} /> Generate Report</>}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    {/* Status bar */}
                    <div style={{ display: "flex", alignItems: "center", height: 22, flexShrink: 0, background: "var(--ed-bar)", padding: "0 12px", gap: 12 }}>
                        <span style={{ fontSize: 10, color: "var(--latex-command)" }}>{localLatex ? "LaTeX" : "—"}</span>
                        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>UTF-8</span>
                        {localLatex && <>
                            <span style={{ fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{lineCount.toLocaleString()} lines</span>
                            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{(charCount / 1024).toFixed(1)} KB</span>
                        </>}

                        <div style={{ flex: 1 }} />
                        {reportLoading && <span style={{ fontSize: 10, color: isMultiMode ? "var(--multi-accent)" : "var(--accent)", display: "flex", alignItems: "center", gap: 5, animation: "blink 1.4s ease-in-out infinite" }}><Spinner col={isMultiMode ? "var(--multi-accent)" : "var(--accent)"} /> {isMultiMode ? "Analyzing" : "Generating"}</span>}
                        {reportCompiling && <span style={{ fontSize: 10, color: "var(--green-vivid)", display: "flex", alignItems: "center", gap: 5 }}><Spinner col="var(--green-vivid)" /> Compiling</span>}
                    </div>
                </div>

                {/* Center drag handle */}
                <div className="dh" onMouseDown={startCenterDrag} style={{ width: 4, flexShrink: 0, background: "var(--bg-surface)", borderRight: "1px solid var(--border)", transition: "background .12s" }} />

                {/* ── PDF viewer ── */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                    <PDFViewer pdfUrl={reportPdfUrl} compiling={reportCompiling} onCompile={compileToPdf} latexSource={localLatex} compileError={reportCompileError} />
                </div>
            </div>
        </div>
    );
}